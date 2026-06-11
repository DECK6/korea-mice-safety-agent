import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import { objectRows, writeXlsxFile, type XlsxCell, type XlsxSheet } from "../lib/simple-xlsx.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import {
  assignAction,
  completeAction,
  recordEvidence,
  recordCommandDecision,
  registerIssue,
  reportOperations,
  resolveCommandDecision,
  updateRunsheetItem,
  upsertRunsheetItems,
  type MiceAction,
  type MiceIssue,
  type MiceRunsheetItem,
  type RunsheetStatus,
} from "../lib/mice-operations-store.js";
import {
  buildMiceVisitorNotices,
  DEFAULT_VISITOR_NOTICE_LANGUAGES,
  formatVisitorNoticesMarkdown,
  type VisitorNoticeLanguage,
} from "../lib/mice-visitor-notices.js";
import { VERSION } from "../version.js";
import communicationTemplates from "../ontology/mice/communication-templates.json" with { type: "json" };
import incidentTaxonomy from "../ontology/mice/incident-taxonomy.json" with { type: "json" };
import { generateMiceSafetyPlanTool } from "./generate-mice-safety-plan.js";

const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);
const PrioritySchema = z.enum(["low", "medium", "high", "critical"]);
const EvidenceTypeSchema = z.enum(["photo", "video", "document", "note"]);
const CommandDecisionTypeSchema = z.enum(["monitor_only", "evacuation_start", "shelter_in_place", "event_pause", "event_stop", "event_resume", "all_clear"]);
const CommandDecisionLevelSchema = z.enum(["advisory", "partial", "full"]);
const CommunicationChannelSchema = z.enum(["public_announcement", "staff_radio", "sms_push", "agency_update"]);
const VisitorNoticeLanguageSchema = z.enum(["ko", "en", "ja", "zh"]);
const RunsheetStatusSchema = z.enum(["open", "done", "blocked", "escalated"]);

const registerIssueInputSchema = z.object({
  eventName: z.string().min(1),
  issueType: z.string().min(1).describe("예: crowd_bottleneck, blocked_exit, medical, fire, food, worker_safety"),
  severity: SeveritySchema.default("medium"),
  description: z.string().min(1),
  venueId: z.string().optional(),
  jurisdiction: z.string().optional(),
  zone: z.string().optional(),
  relatedHazards: z.array(z.string()).optional().default([]),
  detectedAt: z.string().datetime().optional().describe("declared-but-untrusted ISO 시각. 감사 정렬 기준은 서버 recordedAt입니다."),
});

const recordEvidenceInputSchema = z.object({
  issueId: z.string().min(1),
  actionId: z.string().optional(),
  evidenceType: EvidenceTypeSchema.default("note"),
  localPath: z.string().optional().describe("사진/영상/문서가 로컬에 있을 때 경로만 기록합니다. 파일 복사는 하지 않습니다."),
  description: z.string().min(1),
  capturedAt: z.string().datetime().optional().describe("declared-but-untrusted ISO 시각. 감사 정렬 기준은 서버 recordedAt입니다."),
});

const assignActionInputSchema = z.object({
  issueId: z.string().min(1),
  title: z.string().min(1),
  assignee: z.string().min(1),
  team: z.string().optional(),
  priority: PrioritySchema.optional(),
  dueAt: z.string().optional(),
});

const completeActionInputSchema = z.object({
  actionId: z.string().min(1),
  completedBy: z.string().optional(),
  completionNote: z.string().min(1),
  evidenceIds: z.array(z.string()).optional().default([]),
  closeIssue: z.boolean().optional().default(true),
});

const reportInputSchema = z.object({
  issueId: z.string().optional(),
  eventName: z.string().optional(),
  includeResolved: z.boolean().optional().default(true),
});

const situationBriefInputSchema = reportInputSchema.extend({
  audience: z.enum(["multi_agency", "local_government", "fire", "police", "medical", "venue", "internal"]).optional().default("multi_agency"),
  preparedBy: z.string().optional().default("운영본부"),
  contactPoint: z.string().optional().default("운영본부"),
  requestedSupport: z.array(z.string()).optional().default([]),
  now: z.string().optional(),
});

const dashboardInputSchema = z.object({
  eventName: z.string().optional(),
  includeResolved: z.boolean().optional().default(false),
  dueSoonMinutes: z.number().int().min(1).max(240).optional().default(15),
  now: z.string().optional().describe("테스트/검증용 ISO 시각. 생략하면 현재 시각"),
});

const exportDashboardInputSchema = dashboardInputSchema.extend({
  outputDir: z.string().optional().describe("생성 파일을 둘 디렉터리. 없으면 MICE_LOCAL_DIR/operation-dashboards 아래에 만듭니다."),
});

const runsheetPlanInputSchema = z.object({
  eventName: z.string().min(1),
  date: z.string().optional(),
  location: z.string().optional(),
  organizer: z.string().optional(),
  eventTypes: z.array(z.enum(["festival", "outdoor_event", "exhibition", "conference", "performance", "food_event", "vip_event"])).optional(),
  venueId: z.string().optional(),
  jurisdiction: z.string().optional(),
  expectedCrowd: z.number().int().min(0).optional(),
  outdoor: z.boolean().optional(),
  outdoorEvent: z.boolean().optional(),
  roadUse: z.boolean().optional(),
  unhostedCrowd: z.boolean().optional(),
  temporaryStructures: z.boolean().optional(),
  temporaryElectricity: z.boolean().optional(),
  setupTeardown: z.boolean().optional(),
  workAtHeight: z.boolean().optional(),
  heavyObjectHandling: z.boolean().optional(),
  hotWork: z.boolean().optional(),
  lpgUse: z.boolean().optional(),
  foodService: z.boolean().optional(),
  performance: z.boolean().optional(),
  personalDataProcessing: z.boolean().optional(),
  vipSecurity: z.boolean().optional(),
});

const initializeRunsheetInputSchema = runsheetPlanInputSchema.extend({
  operationsRunsheetMarkdown: z.string().optional().describe("이미 생성된 현장 운영 런시트 Markdown. 없으면 같은 입력으로 generate_mice_safety_plan을 호출합니다."),
  source: z.string().optional().default("generate_mice_safety_plan"),
});

const updateRunsheetInputSchema = z.object({
  itemId: z.string().min(1),
  status: RunsheetStatusSchema,
  note: z.string().optional(),
  updatedBy: z.string().optional(),
  evidenceIds: z.array(z.string()).optional().default([]),
  linkedIssueId: z.string().optional(),
  createIssue: z.boolean().optional().default(false),
  issueType: z.string().optional(),
  severity: SeveritySchema.optional().default("medium"),
  issueDescription: z.string().optional(),
  createAction: z.boolean().optional().default(false),
  assignee: z.string().optional(),
  team: z.string().optional(),
  priority: PrioritySchema.optional(),
  dueAt: z.string().optional(),
});

const queryRunsheetInputSchema = z.object({
  eventName: z.string().optional(),
  status: RunsheetStatusSchema.optional(),
  linkedIssueId: z.string().optional(),
  includeDone: z.boolean().optional().default(true),
});

const commandDecisionInputSchema = z.object({
  eventName: z.string().min(1),
  decisionType: CommandDecisionTypeSchema,
  level: CommandDecisionLevelSchema.default("partial"),
  reason: z.string().min(1),
  decidedBy: z.string().min(1),
  issueId: z.string().optional(),
  zone: z.string().optional(),
  effectiveAt: z.string().datetime().optional().describe("declared-but-untrusted ISO 시각. 감사 정렬 기준은 서버 recordedAt입니다."),
  notifyTargets: z.array(z.string()).optional().default([]),
  conditionsForResume: z.array(z.string()).optional().default([]),
});

const resolveCommandDecisionInputSchema = z.object({
  commandDecisionId: z.string().optional().describe("닫을 active command decision ID. 생략하면 eventName/zone으로 최신 active 판단을 찾습니다."),
  eventName: z.string().optional(),
  zone: z.string().optional(),
  resolutionType: z.enum(["event_resume", "all_clear"]).optional().default("all_clear"),
  reason: z.string().min(1),
  decidedBy: z.string().min(1),
  effectiveAt: z.string().datetime().optional().describe("declared-but-untrusted ISO 시각. 감사 정렬 기준은 서버 recordedAt입니다."),
  notifyTargets: z.array(z.string()).optional().default([]),
  conditionsMet: z.array(z.string()).optional().default([]),
});

const communicationTemplateInputSchema = z.object({
  decisionType: CommandDecisionTypeSchema,
  channel: CommunicationChannelSchema.optional(),
  audience: z.string().optional(),
  eventName: z.string().optional().default("행사"),
  zone: z.string().optional().default("해당"),
  reason: z.string().optional().default("안전 확인 필요"),
  safeRoute: z.string().optional().default("지정 대피동선"),
  resumeConditions: z.array(z.string()).optional().default([]),
  contactPoint: z.string().optional().default("운영본부"),
});

const localizedTextInputSchema = z.object({
  ko: z.string().optional(),
  en: z.string().optional(),
  ja: z.string().optional(),
  zh: z.string().optional(),
});

const visitorNoticeInputSchema = z.object({
  decisionType: CommandDecisionTypeSchema,
  languages: z.array(VisitorNoticeLanguageSchema).optional().default(["ko", "en", "ja", "zh"]),
  eventName: z.string().optional().default("행사"),
  zone: z.string().optional().default("해당"),
  reason: z.string().optional().default("안전 확인 필요"),
  safeRoute: z.string().optional().default("지정 대피동선"),
  resumeConditions: z.array(z.string()).optional().default([]),
  contactPoint: z.string().optional().default("운영본부"),
  localizedPlaceholders: z.object({
    eventName: localizedTextInputSchema.optional(),
    zone: localizedTextInputSchema.optional(),
    reason: localizedTextInputSchema.optional(),
    safeRoute: localizedTextInputSchema.optional(),
    contactPoint: localizedTextInputSchema.optional(),
  }).optional().default({}),
});

function nowIso(): string {
  return new Date().toISOString();
}

// At capture time, fingerprint the referenced artifact (sha256 + byte size) so later tampering of
// the file is detectable. If the file is missing/unreadable, return nulls and continue.
function fingerprintEvidenceFile(localPath?: string): { fileSha256: string | null; fileBytes: number | null } {
  if (!localPath || !existsSync(localPath)) return { fileSha256: null, fileBytes: null };
  try {
    const stat = statSync(localPath);
    if (!stat.isFile()) return { fileSha256: null, fileBytes: null };
    const sha256 = createHash("sha256").update(readFileSync(localPath)).digest("hex");
    return { fileSha256: sha256, fileBytes: stat.size };
  } catch {
    return { fileSha256: null, fileBytes: null };
  }
}

type Severity = z.infer<typeof SeveritySchema>;
type Priority = z.infer<typeof PrioritySchema>;

interface IncidentProfile {
  id: string;
  label: string;
  relatedHazardIds: string[];
  recommendedTeam: string;
  defaultPriority: Priority;
  slaMinutesBySeverity: Record<Severity, number>;
  escalationPath: string[];
  playbookSteps: string[];
}

interface CommunicationTemplate {
  id: string;
  decisionType: string;
  channel: string;
  audience: string;
  tone: string;
  ko: string;
  en?: string;
  ja?: string;
  zh?: string;
  checkpoints: string[];
}

const incidentProfiles = (incidentTaxonomy as { issueTypes: IncidentProfile[] }).issueTypes;
const operationCommunicationTemplates = (communicationTemplates as { templates: CommunicationTemplate[] }).templates;

function addMinutesIso(startIso: string, minutes: number): string {
  return new Date(new Date(startIso).getTime() + minutes * 60_000).toISOString();
}

function incidentProfileFor(issueType: string): IncidentProfile {
  return incidentProfiles.find((profile) => profile.id === issueType)
    ?? {
      id: "general_safety_issue",
      label: "일반 안전 이슈",
      relatedHazardIds: [],
      recommendedTeam: "운영본부",
      defaultPriority: "medium",
      slaMinutesBySeverity: { critical: 10, high: 20, medium: 45, low: 120 },
      escalationPath: ["구역장", "운영본부", "안전총괄"],
      playbookSteps: ["현장 확인", "위험구역 통제", "담당자 배정", "조치 전후 기록"],
    };
}

function dispatchPriority(profile: IncidentProfile, severity: Severity): Priority {
  if (severity === "critical") return "critical";
  if (severity === "high" && ["critical", "high"].includes(profile.defaultPriority)) return "high";
  return profile.defaultPriority;
}

function slaState(issue: { status: string; firstResponseDueAt?: string }, nowMs: number, dueSoonMinutes: number): "resolved" | "overdue" | "due_soon" | "normal" | "no_sla" {
  if (["resolved", "verified"].includes(issue.status)) return "resolved";
  if (!issue.firstResponseDueAt) return "no_sla";
  const dueMs = new Date(issue.firstResponseDueAt).getTime();
  if (!Number.isFinite(dueMs)) return "no_sla";
  if (dueMs < nowMs) return "overdue";
  if (dueMs <= nowMs + dueSoonMinutes * 60_000) return "due_soon";
  return "normal";
}

function isActiveCommandDecision(decisionType: string): boolean {
  return ["evacuation_start", "shelter_in_place", "event_pause", "event_stop"].includes(decisionType);
}

function commandDecisionLabel(decisionType: string): string {
  const labels: Record<string, string> = {
    monitor_only: "관찰 강화",
    evacuation_start: "대피개시",
    shelter_in_place: "현 위치 대기",
    event_pause: "행사 일시중지",
    event_stop: "행사 중단",
    event_resume: "행사 재개승인",
    all_clear: "상황해제",
  };
  return labels[decisionType] ?? decisionType;
}

function severityRank(severity: string): number {
  const ranks: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  return ranks[severity] ?? 0;
}

function audienceLabel(audience: z.infer<typeof situationBriefInputSchema>["audience"]): string {
  const labels: Record<string, string> = {
    multi_agency: "관계기관 공통",
    local_government: "지자체",
    fire: "소방",
    police: "경찰",
    medical: "의료",
    venue: "베뉴",
    internal: "내부 운영본부",
  };
  return labels[audience ?? "multi_agency"];
}

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

function formatStorePath(dir: string): string {
  return `local store: ${dir}/operations.json`;
}

function tableRows(markdown: string): string[][] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|") && !/^\|\s*-/.test(line))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
}

function markdownTableRecords(markdown: string): Record<string, string>[] {
  const rows = tableRows(markdown);
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function parseRunsheetItems(markdown: string, source?: string): Array<Omit<MiceRunsheetItem, "id" | "eventName" | "status" | "createdAt" | "updatedAt" | "evidenceIds">> {
  return markdownTableRecords(markdown)
    .filter((record) => record["단계"] && record["확인/조치"])
    .map((record) => ({
      stage: record["단계"] ?? "",
      checkpoint: record["기준시점"] ?? "",
      recommendedDate: record["권장일자"] ?? "",
      target: record["구역/대상"] ?? "",
      task: record["확인/조치"] ?? "",
      owner: record["담당"] ?? "운영본부",
      evidenceRequired: record["증빙"] ?? "",
      escalation: record.escalation ?? record.Escalation ?? "",
      source,
    }));
}

function runsheetStatusSummary(items: MiceRunsheetItem[]): Record<RunsheetStatus, number> {
  return items.reduce<Record<RunsheetStatus, number>>((acc, item) => {
    acc[item.status] += 1;
    return acc;
  }, { open: 0, done: 0, blocked: 0, escalated: 0 });
}

function inferIssueTypeFromRunsheetItem(item: MiceRunsheetItem): string {
  const text = `${item.stage} ${item.target} ${item.task} ${item.owner}`;
  if (/무주최|합동상황반|공동 현장지휘|철도|교통 운영기관|상황 단계|해산|분산/.test(text)) return "unhosted_crowd_surge";
  if (/LPG|가스용기|가스|누출|누설|밸브|조정기|자동차단|화기/.test(text)) return "gas_lpg";
  if (/식음료|위생|식중독|푸드|케이터링|보존식|냉장|보온|영업신고|판매중지|교차오염/.test(text)) return "food_safety";
  if (/공연|무대|트러스|리깅|무대감독|스탠딩|아티스트|구조검토|방염확인|전원 차단|공연중지/.test(text)) return "stage_rigging_structure";
  if (/게이트|대기열|혼잡|인파|동선|퇴장|입퇴장|교통|도로/.test(text)) return "crowd_bottleneck";
  if (/소방|피난|비상구|소화전|화재|위험물/.test(text)) return "blocked_exit";
  if (/의료|AED|응급|119|구급/.test(text)) return "medical_emergency";
  if (/작업|철거|하역|지게차|PPE|고소|중량물|전기/.test(text)) return "worker_safety";
  if (/보안|VIP|출입통제|경비/.test(text)) return "security_access";
  return "general_safety_issue";
}

function defaultRoot(): string {
  return process.env.MICE_LOCAL_DIR ?? join(homedir(), ".korea-mice-safety-agent");
}

// Reject "../" traversal in a caller-supplied output directory and confine relative paths to
// defaultRoot(); an explicit absolute path is the operator's choice and is allowed, mirroring the
// plan-bundle export confinement.
function confineToRoot(outputDir: string): string {
  const root = resolve(defaultRoot());
  if (outputDir.split(/[\\/]/).includes("..")) {
    throw new Error(`outputDir must not contain ".." traversal segments: ${outputDir}`);
  }
  const resolved = resolve(root, outputDir);
  if (!isAbsolute(outputDir) && resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error(`outputDir escapes the allowed root (${root}): ${outputDir}`);
  }
  return resolved;
}

function safeName(value: string): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return ascii || "mice-event";
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

type DashboardInput = z.infer<typeof dashboardInputSchema>;

interface OperationTimelineEntry {
  at: string;
  eventType: "issue_detected" | "action_assigned" | "action_completed" | "evidence_recorded" | "command_decision" | "runsheet_updated";
  eventName?: string;
  issueId?: string;
  actionId?: string;
  evidenceId?: string;
  commandDecisionId?: string;
  runsheetItemId?: string;
  zone?: string;
  actor?: string;
  title: string;
  detail: string;
}

function buildOperationTimeline(result: ReturnType<typeof reportOperations>): OperationTimelineEntry[] {
  const issueById = new Map(result.issues.map((issue) => [issue.id, issue]));
  const timeline: OperationTimelineEntry[] = [];

  for (const issue of result.issues) {
    timeline.push({
      at: issue.detectedAt || issue.createdAt,
      eventType: "issue_detected",
      eventName: issue.eventName,
      issueId: issue.id,
      zone: issue.zone,
      title: `이슈 감지: ${issue.issueType}`,
      detail: `${issue.severity}/${issue.status} - ${issue.description}`,
    });
  }

  for (const action of result.actions) {
    const issue = issueById.get(action.issueId);
    timeline.push({
      at: action.assignedAt,
      eventType: "action_assigned",
      eventName: issue?.eventName,
      issueId: action.issueId,
      actionId: action.id,
      zone: issue?.zone,
      actor: action.assignee,
      title: `조치 배정: ${action.title}`,
      detail: `${action.priority}/${action.status}${action.team ? `/${action.team}` : ""}${action.dueAt ? ` due ${action.dueAt}` : ""}`,
    });
    if (action.completedAt) {
      timeline.push({
        at: action.completedAt,
        eventType: "action_completed",
        eventName: issue?.eventName,
        issueId: action.issueId,
        actionId: action.id,
        zone: issue?.zone,
        actor: action.assignee,
        title: `조치 완료: ${action.title}`,
        detail: action.completionNote ?? "완료 내용 미기록",
      });
    }
  }

  for (const evidence of result.evidences) {
    const issue = issueById.get(evidence.issueId);
    timeline.push({
      at: evidence.capturedAt || evidence.createdAt,
      eventType: "evidence_recorded",
      eventName: issue?.eventName,
      issueId: evidence.issueId,
      actionId: evidence.actionId,
      evidenceId: evidence.id,
      zone: issue?.zone,
      title: `증빙 기록: ${evidence.evidenceType}`,
      detail: `${evidence.description}${evidence.localPath ? ` (${evidence.localPath})` : ""}`,
    });
  }

  for (const decision of result.commandDecisions) {
    timeline.push({
      at: decision.effectiveAt,
      eventType: "command_decision",
      eventName: decision.eventName,
      issueId: decision.issueId,
      commandDecisionId: decision.id,
      zone: decision.zone,
      actor: decision.decidedBy,
      title: `지휘 판단: ${commandDecisionLabel(decision.decisionType)}`,
      detail: `${decision.level}/${decision.status} - ${decision.reason}`,
    });
  }

  for (const item of result.runsheetItems) {
    timeline.push({
      at: item.updatedAt,
      eventType: "runsheet_updated",
      eventName: item.eventName,
      issueId: item.linkedIssueId,
      actionId: item.actionId,
      runsheetItemId: item.id,
      zone: item.target,
      actor: item.updatedBy,
      title: `런시트 상태: ${item.stage} ${item.checkpoint}`,
      detail: `${item.status} - ${item.task}${item.note ? ` / ${item.note}` : ""}`,
    });
  }

  return timeline.sort((a, b) => a.at.localeCompare(b.at));
}

type ReportedIssue = ReturnType<typeof reportOperations>["issues"][number];

function deriveRequestedSupport(issues: ReportedIssue[], explicit: string[]): string[] {
  if (explicit.length > 0) return explicit;
  const support = new Set<string>();
  for (const issue of issues) {
    const hazards = issue.relatedHazards.join(" ");
    if (/fire|lpg|화재|가스|blocked_evacuation_route/.test(`${issue.issueType} ${hazards}`)) {
      support.add("소방: 화재·피난·가스 위험 현장 확인 및 필요 시 긴급 안전점검 지원");
    }
    if (/crowd|bottleneck|traffic|ingress|egress|security/.test(`${issue.issueType} ${hazards}`)) {
      support.add("경찰/교통: 인파 통제, 우회동선, 교통통제 및 질서유지 지원");
    }
    if (/medical|aed|injury|환자|응급/.test(`${issue.issueType} ${hazards}`)) {
      support.add("의료/119: 응급처치, 이송 동선, 병원 연계 확인");
    }
    if (/food|poison|식중독|위생/.test(`${issue.issueType} ${hazards}`)) {
      support.add("보건/위생: 식음료 구역 위생 확인 및 식중독 의심 대응 지원");
    }
    if (/worker|fall|heavy|temporary_structure|electrical/.test(`${issue.issueType} ${hazards}`)) {
      support.add("베뉴/시공사: 작업구역 통제, 전기·구조물 안전조치, 작업중지 기준 확인");
    }
  }
  if (support.size === 0) support.add("관계기관: 현장 상황 공유 및 추가 지원 필요 시 즉시 연락");
  return Array.from(support);
}

function buildSituationBrief(input: z.infer<typeof situationBriefInputSchema>) {
  const result = reportOperations({
    issueId: input.issueId,
    eventName: input.eventName,
    includeResolved: input.includeResolved,
  });
  const generatedAt = input.now ?? nowIso();
  const timeline = buildOperationTimeline(result);
  const openIssues = result.issues.filter((issue) => !["resolved", "verified"].includes(issue.status));
  const primaryIssue = [...(openIssues.length > 0 ? openIssues : result.issues)]
    .sort((a, b) => {
      const severityDelta = severityRank(b.severity) - severityRank(a.severity);
      if (severityDelta !== 0) return severityDelta;
      return String(b.detectedAt ?? b.createdAt).localeCompare(String(a.detectedAt ?? a.createdAt));
    })[0];

  const scopedIssues = primaryIssue ? result.issues.filter((issue) => issue.id === primaryIssue.id) : result.issues;
  const scopedIssueIds = new Set(scopedIssues.map((issue) => issue.id));
  const scopedActions = result.actions.filter((action) => scopedIssueIds.has(action.issueId));
  const scopedEvidences = result.evidences.filter((evidence) => scopedIssueIds.has(evidence.issueId));
  const scopedCommandDecisions = primaryIssue
    ? result.commandDecisions.filter((decision) => decision.issueId === primaryIssue.id)
    : result.commandDecisions;
  const scopedCommandDecisionIds = new Set(scopedCommandDecisions.map((decision) => decision.id));
  const scopedTimeline = primaryIssue
    ? timeline.filter((entry) =>
      entry.issueId === primaryIssue.id
      || (entry.commandDecisionId ? scopedCommandDecisionIds.has(entry.commandDecisionId) : false)
    )
    : timeline;
  const scopedOpenIssues = scopedIssues.filter((issue) => !["resolved", "verified"].includes(issue.status));
  const activeCommandDecisions = scopedCommandDecisions
    .filter((decision) => decision.status === "active")
    .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));
  const latestCommandDecision = [...scopedCommandDecisions].sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))[0];
  const completedActions = scopedActions.filter((action) => action.status === "completed");
  const openActions = scopedActions.filter((action) => !["completed", "cancelled"].includes(action.status));
  const statusLine = activeCommandDecisions.length > 0
    ? activeCommandDecisions.map((decision) => `${commandDecisionLabel(decision.decisionType)}(${decision.level}${decision.zone ? `/${decision.zone}` : ""})`).join(", ")
    : scopedOpenIssues.length > 0
      ? "조치 진행 중"
      : "상황 종료 또는 모니터링";
  const requestedSupport = deriveRequestedSupport(scopedIssues, input.requestedSupport);
  const recentTimeline = scopedTimeline.slice(-8);
  const recentActions = [...scopedActions]
    .sort((a, b) => String(a.completedAt ?? a.assignedAt).localeCompare(String(b.completedAt ?? b.assignedAt)))
    .slice(-5);
  const briefTitle = primaryIssue
    ? `${primaryIssue.eventName} ${primaryIssue.zone ? `${primaryIssue.zone} ` : ""}${primaryIssue.issueType} 상황보고`
    : `${input.eventName ?? "MICE 행사"} 상황보고`;

  const markdown = [
    `# ${briefTitle}`,
    "",
    `- 수신: ${audienceLabel(input.audience)}`,
    `- 작성시각: ${generatedAt}`,
    `- 작성: ${input.preparedBy}`,
    `- 연락창구: ${input.contactPoint}`,
    `- 보고범위: ${primaryIssue ? `주 이슈 ${primaryIssue.id} 중심` : "조건에 맞는 전체 이슈"}`,
    "",
    "## 1. 현재상황",
    `- 상태: ${statusLine}`,
    primaryIssue ? `- 주 이슈: ${primaryIssue.issueType} / ${primaryIssue.severity} / ${primaryIssue.status}` : "- 주 이슈: 미기록",
    primaryIssue ? `- 위치: ${[primaryIssue.venueId, primaryIssue.zone, primaryIssue.jurisdiction].filter(Boolean).join(" / ") || "미기록"}` : "- 위치: 미기록",
    primaryIssue ? `- 내용: ${primaryIssue.description}` : "- 내용: 조건에 맞는 이슈 없음",
    latestCommandDecision ? `- 최근 지휘 판단: ${commandDecisionLabel(latestCommandDecision.decisionType)} / ${latestCommandDecision.status} / ${latestCommandDecision.reason}` : "- 최근 지휘 판단: 없음",
    "",
    "## 2. 인명·위험·통제",
    `- 미해결 이슈: ${scopedOpenIssues.length}건 / 보고범위 이슈: ${scopedIssues.length}건 / 행사 조회 이슈: ${result.issues.length}건`,
    `- 미완료 조치: ${openActions.length}건 / 완료 조치: ${completedActions.length}건`,
    `- 증빙 기록: ${scopedEvidences.length}건`,
    primaryIssue?.relatedHazards.length ? `- 관련 위험: ${primaryIssue.relatedHazards.join(", ")}` : "- 관련 위험: 미기록",
    "",
    "## 3. 주요 조치",
    recentActions.length > 0
      ? recentActions.map((action) => `- ${action.status}: ${action.title} / 담당 ${action.assignee}${action.team ? `(${action.team})` : ""}${action.completionNote ? ` / ${action.completionNote}` : ""}`).join("\n")
      : "- 조치 기록 없음",
    "",
    "## 4. 관계기관 요청",
    ...requestedSupport.map((item) => `- ${item}`),
    "",
    "## 5. 최근 타임라인",
    recentTimeline.length > 0
      ? recentTimeline.map((entry) => `- ${entry.at}: ${entry.title} - ${entry.detail}`).join("\n")
      : "- 타임라인 이벤트 없음",
    "",
    "## 6. 다음 업데이트",
    "- 현장 상태, 통제 범위, 추가 인명피해, 관계기관 조치사항 변동 시 즉시 갱신",
    "- 상황 종료 후 상세 사고보고서와 증빙 목록 별도 공유",
  ].join("\n");

  return {
    briefTitle,
    generatedAt,
    audience: input.audience,
    statusLine,
    primaryIssue,
    latestCommandDecision,
    openIssueCount: openIssues.length,
    openActionCount: openActions.length,
    completedActionCount: completedActions.length,
    evidenceCount: scopedEvidences.length,
    reportScopeIssueId: primaryIssue?.id,
    scopedIssueCount: scopedIssues.length,
    scopedActionCount: scopedActions.length,
    totalMatchedIssueCount: result.issues.length,
    requestedSupport,
    timeline: recentTimeline,
    storeDir: result.dir,
    markdown,
  };
}

function buildDashboardData(input: DashboardInput) {
  const result = reportOperations({
    eventName: input.eventName,
    includeResolved: input.includeResolved,
  });
  const now = input.now ?? nowIso();
  const nowMs = new Date(now).getTime();
  const rows = result.issues.map((issue) => {
    const issueActions = result.actions.filter((action) => action.issueId === issue.id);
    return {
      issueId: issue.id,
      eventName: issue.eventName,
      issueType: issue.issueType,
      severity: issue.severity,
      status: issue.status,
      zone: issue.zone,
      recommendedTeam: issue.recommendedTeam ?? "미지정",
      dispatchPriority: issue.dispatchPriority ?? issue.severity,
      responseSlaMinutes: issue.responseSlaMinutes,
      firstResponseDueAt: issue.firstResponseDueAt,
      slaState: slaState(issue, nowMs, input.dueSoonMinutes),
      escalationPath: issue.escalationPath ?? [],
      openActions: issueActions.filter((action) => !["completed", "cancelled"].includes(action.status)).map((action) => ({
        actionId: action.id,
        title: action.title,
        assignee: action.assignee,
        team: action.team,
        priority: action.priority,
        status: action.status,
        dueAt: action.dueAt,
      })),
    };
  }).sort((a, b) => {
    const rank: Record<string, number> = { overdue: 0, due_soon: 1, normal: 2, no_sla: 3, resolved: 4 };
    if (rank[a.slaState] !== rank[b.slaState]) return rank[a.slaState] - rank[b.slaState];
    return String(a.firstResponseDueAt ?? "").localeCompare(String(b.firstResponseDueAt ?? ""));
  });
  const summary = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.slaState] = (acc[row.slaState] ?? 0) + 1;
    return acc;
  }, { overdue: 0, due_soon: 0, normal: 0, no_sla: 0, resolved: 0 });
  const byTeam = rows.reduce<Record<string, number>>((acc, row) => {
    if (row.slaState === "resolved") return acc;
    acc[row.recommendedTeam] = (acc[row.recommendedTeam] ?? 0) + 1;
    return acc;
  }, {});
  const activeCommandDecisions = result.commandDecisions
    .filter((decision) => decision.status === "active" && isActiveCommandDecision(decision.decisionType))
    .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));
  const commandStatusSummary = result.commandDecisions.reduce<Record<string, number>>((acc, decision) => {
    acc[decision.status] = (acc[decision.status] ?? 0) + 1;
    return acc;
  }, { active: 0, released: 0, superseded: 0, informational: 0 });
  const commandLifecycle = result.commandDecisions
    .map((decision) => ({
      id: decision.id,
      eventName: decision.eventName,
      decisionType: decision.decisionType,
      label: commandDecisionLabel(decision.decisionType),
      status: decision.status,
      level: decision.level,
      zone: decision.zone,
      effectiveAt: decision.effectiveAt,
      releasedAt: decision.releasedAt,
      releasedByDecisionId: decision.releasedByDecisionId,
      supersededAt: decision.supersededAt,
      supersededByDecisionId: decision.supersededByDecisionId,
      reason: decision.reason,
      releaseReason: decision.releaseReason,
      conditionsMet: decision.conditionsMet ?? [],
    }))
    .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));
  const runsheetItems = result.runsheetItems
    .filter((item) => input.includeResolved || item.status !== "done")
    .sort((a, b) => {
      const statusRank: Record<RunsheetStatus, number> = { escalated: 0, blocked: 1, open: 2, done: 3 };
      if (statusRank[a.status] !== statusRank[b.status]) return statusRank[a.status] - statusRank[b.status];
      return `${a.recommendedDate}|${a.checkpoint}|${a.stage}`.localeCompare(`${b.recommendedDate}|${b.checkpoint}|${b.stage}`);
    });
  const runsheetSummary = runsheetStatusSummary(result.runsheetItems);
  const timeline = buildOperationTimeline(result);
  return {
    input,
    now,
    summary,
    byTeam,
    rows,
    activeCommandDecisions,
    commandStatusSummary,
    commandLifecycle,
    runsheetSummary,
    runsheetItems,
    timeline,
    commandDecisions: result.commandDecisions,
    storeDir: result.dir,
  };
}

async function writeDashboardXlsx(dashboard: ReturnType<typeof buildDashboardData>, filePath: string): Promise<void> {
  const summaryRows: XlsxCell[][] = [
    ["Field", "Value"],
    ["GeneratedAt", dashboard.now],
    ["StoreDir", dashboard.storeDir],
    ...Object.entries(dashboard.summary).map(([state, count]) => [`SLA ${state}`, count] as XlsxCell[]),
    ...Object.entries(dashboard.byTeam).map(([team, count]) => [`Team ${team}`, count] as XlsxCell[]),
    ...Object.entries(dashboard.commandStatusSummary).map(([status, count]) => [`Command ${status}`, count] as XlsxCell[]),
    ...Object.entries(dashboard.runsheetSummary).map(([status, count]) => [`Runsheet ${status}`, count] as XlsxCell[]),
  ];

  const issueHeaders = ["slaState", "issueId", "eventName", "issueType", "severity", "status", "zone", "recommendedTeam", "dispatchPriority", "responseSlaMinutes", "firstResponseDueAt", "escalationPath"];
  const issueRows = dashboard.rows.map((row) => ({
    ...row,
    escalationPath: row.escalationPath.join(" > "),
  }));

  const actionHeaders = ["issueId", "actionId", "title", "assignee", "team", "priority", "status", "dueAt"];
  const actionRows = dashboard.rows.flatMap((row) => row.openActions.map((action) => ({
    issueId: row.issueId,
    ...action,
  })));

  const decisionHeaders = ["id", "eventName", "decisionType", "status", "level", "zone", "effectiveAt", "releasedAt", "releasedByDecisionId", "supersededAt", "supersededByDecisionId", "reason", "releaseReason", "decidedBy", "notifyTargets", "conditionsForResume", "conditionsMet"];
  const decisionRows = dashboard.commandDecisions.map((decision) => ({
    ...decision,
    decisionType: commandDecisionLabel(decision.decisionType),
    notifyTargets: decision.notifyTargets.join(", "),
    conditionsForResume: decision.conditionsForResume.join(" / "),
    conditionsMet: (decision.conditionsMet ?? []).join(" / "),
  }));

  const runsheetHeaders = ["status", "id", "eventName", "stage", "checkpoint", "recommendedDate", "target", "task", "owner", "evidenceRequired", "escalation", "linkedIssueId", "actionId", "note", "updatedAt", "updatedBy"];
  const timelineHeaders = ["at", "eventType", "eventName", "zone", "issueId", "actionId", "evidenceId", "commandDecisionId", "runsheetItemId", "actor", "title", "detail"];
  const sheets: XlsxSheet[] = [
    { name: "Summary", rows: summaryRows },
    { name: "Issues", rows: objectRows(issueHeaders, issueRows as unknown as Array<Record<string, XlsxCell>>) },
    { name: "Open Actions", rows: objectRows(actionHeaders, actionRows) },
    { name: "Command Decisions", rows: objectRows(decisionHeaders, decisionRows) },
    { name: "Runsheet Execution", rows: objectRows(runsheetHeaders, dashboard.runsheetItems as unknown as Array<Record<string, XlsxCell>>) },
    { name: "Timeline", rows: objectRows(timelineHeaders, dashboard.timeline as unknown as Array<Record<string, XlsxCell>>) },
  ];

  writeXlsxFile(filePath, sheets);
}

export const registerMiceSafetyIssueTool: ToolDefinition = {
  name: "register_mice_safety_issue",
  title: "MICE 현장 안전 이슈 등록",
  description: "군중 병목, 비상구 차단, 작업자 안전, 의료, 화재, 식음료 등 현장 안전 이슈를 로컬 저장소에 등록합니다.",
  inputSchema: registerIssueInputSchema,
  handler(rawInput: unknown): McpToolResult {
    const input = registerIssueInputSchema.parse(rawInput ?? {});
    const detectedAt = input.detectedAt ?? nowIso();
    const profile = incidentProfileFor(input.issueType);
    const responseSlaMinutes = profile.slaMinutesBySeverity[input.severity];
    const priority = dispatchPriority(profile, input.severity);
    const result = registerIssue({
      ...input,
      relatedHazards: Array.from(new Set([...input.relatedHazards, ...profile.relatedHazardIds])),
      incidentProfileId: profile.id,
      recommendedTeam: profile.recommendedTeam,
      dispatchPriority: priority,
      responseSlaMinutes,
      firstResponseDueAt: addMinutesIso(detectedAt, responseSlaMinutes),
      escalationPath: profile.escalationPath,
      playbookSteps: profile.playbookSteps,
      detectedAt,
    });
    return {
      content: [{
        type: "text",
        text: [
          "# MICE 안전 이슈 등록",
          `- issueId: ${result.issue.id}`,
          `- status: ${result.issue.status}`,
          `- routing: ${result.issue.recommendedTeam} / ${result.issue.dispatchPriority}`,
          `- SLA: ${result.issue.responseSlaMinutes}분 이내 초동, due ${result.issue.firstResponseDueAt}`,
          `- ${formatStorePath(result.dir)}`,
        ].join("\n"),
      }],
      structuredContent: {
        issue: result.issue,
        incidentProfile: profile,
        recommendedAction: {
          team: result.issue.recommendedTeam,
          priority: result.issue.dispatchPriority,
          dueAt: result.issue.firstResponseDueAt,
          playbookSteps: result.issue.playbookSteps,
        },
        storeDir: result.dir,
        _meta: COMMON_RESPONSE_META,
      },
    };
  },
};

export const recordMiceEvidenceTool: ToolDefinition = {
  name: "record_mice_evidence",
  title: "MICE 현장 증빙 기록",
  description: "사진, 영상, 문서, 메모 증빙의 로컬 경로와 설명을 안전 이슈/조치에 연결합니다. 원본 파일은 복사하지 않습니다.",
  inputSchema: recordEvidenceInputSchema,
  handler(rawInput: unknown): McpToolResult {
    const input = recordEvidenceInputSchema.parse(rawInput ?? {});
    const fingerprint = fingerprintEvidenceFile(input.localPath);
    const result = recordEvidence({
      ...input,
      capturedAt: input.capturedAt ?? nowIso(),
      fileSha256: fingerprint.fileSha256,
      fileBytes: fingerprint.fileBytes,
    });
    return {
      content: [{
        type: "text",
        text: [
          "# MICE 증빙 기록",
          `- evidenceId: ${result.evidence.id}`,
          `- issueId: ${result.evidence.issueId}`,
          `- ${formatStorePath(result.dir)}`,
        ].join("\n"),
      }],
      structuredContent: { evidence: result.evidence, storeDir: result.dir, _meta: COMMON_RESPONSE_META },
    };
  },
};

export const assignMiceStaffActionTool: ToolDefinition = {
  name: "assign_mice_staff_action",
  title: "MICE 스태프 조치 배정",
  description: "등록된 안전 이슈에 담당자/팀/우선순위/기한이 있는 조치 항목을 배정합니다.",
  inputSchema: assignActionInputSchema,
  handler(rawInput: unknown): McpToolResult {
    const input = assignActionInputSchema.parse(rawInput ?? {});
    const result = assignAction(input);
    return {
      content: [{
        type: "text",
        text: [
          "# MICE 스태프 조치 배정",
          `- actionId: ${result.action.id}`,
          `- issueId: ${result.action.issueId}`,
          `- assignee: ${result.action.assignee}${result.action.team ? ` / ${result.action.team}` : ""}`,
          `- priority/dueAt: ${result.action.priority}${result.action.dueAt ? ` / ${result.action.dueAt}` : ""}`,
          `- ${formatStorePath(result.dir)}`,
        ].join("\n"),
      }],
      structuredContent: { action: result.action, storeDir: result.dir, _meta: COMMON_RESPONSE_META },
    };
  },
};

export const completeMiceActionTool: ToolDefinition = {
  name: "complete_mice_action",
  title: "MICE 스태프 조치 완료",
  description: "배정된 조치 항목을 완료 처리하고 필요하면 연결 이슈를 resolved 상태로 전환합니다.",
  inputSchema: completeActionInputSchema,
  handler(rawInput: unknown): McpToolResult {
    const input = completeActionInputSchema.parse(rawInput ?? {});
    const result = completeAction(input);
    return {
      content: [{
        type: "text",
        text: [
          "# MICE 조치 완료",
          `- actionId: ${result.action.id}`,
          `- issueId: ${result.issue.id}`,
          `- issueStatus: ${result.issue.status}`,
          `- ${formatStorePath(result.dir)}`,
        ].join("\n"),
      }],
      structuredContent: { action: result.action, issue: result.issue, storeDir: result.dir, _meta: COMMON_RESPONSE_META },
    };
  },
};

export const generateMiceIncidentReportTool: ToolDefinition = {
  name: "generate_mice_incident_report",
  title: "MICE 이슈/조치 보고서 생성",
  description: "로컬 저장소의 안전 이슈, 스태프 조치, 증빙 기록을 Markdown 사고/조치 보고서로 생성합니다.",
  inputSchema: reportInputSchema,
  handler(rawInput: unknown): McpToolResult {
    const input = reportInputSchema.parse(rawInput ?? {});
    const result = reportOperations(input);
    const timeline = buildOperationTimeline(result);
    const markdown = [
      "# MICE 현장 이슈·조치 보고서",
      "",
      `- 생성시각: ${nowIso()}`,
      `- ${formatStorePath(result.dir)}`,
      "",
      "## 이슈",
      result.issues.length > 0
        ? result.issues.map((issue) => [
          `### ${issue.id}`,
          `- 행사: ${issue.eventName}`,
          `- 유형/심각도/상태: ${issue.issueType} / ${issue.severity} / ${issue.status}`,
          `- 라우팅/SLA: ${issue.recommendedTeam ?? "미지정"} / ${issue.dispatchPriority ?? issue.severity} / ${issue.responseSlaMinutes ? `${issue.responseSlaMinutes}분` : "미지정"}${issue.firstResponseDueAt ? ` / due ${issue.firstResponseDueAt}` : ""}`,
          `- 위치: ${[issue.venueId, issue.zone, issue.jurisdiction].filter(Boolean).join(" / ") || "미기록"}`,
          `- 내용: ${issue.description}`,
          `- 관련 위험: ${issue.relatedHazards.join(", ") || "미기록"}`,
          `- escalation: ${(issue.escalationPath ?? []).join(" > ") || "미기록"}`,
          `- 초동 playbook: ${(issue.playbookSteps ?? []).join(" / ") || "미기록"}`,
        ].join("\n")).join("\n\n")
        : "- 조건에 맞는 이슈 없음",
      "",
      "## 조치",
      result.actions.length > 0
        ? result.actions.map((action) => [
          `- ${action.id}: ${action.title}`,
          `  - issueId: ${action.issueId}`,
          `  - 담당: ${action.assignee}${action.team ? ` / ${action.team}` : ""}`,
          `  - 우선순위/상태: ${action.priority} / ${action.status}`,
          action.completionNote ? `  - 완료내용: ${action.completionNote}` : "",
        ].filter(Boolean).join("\n")).join("\n")
        : "- 조치 없음",
      "",
      "## 증빙",
      result.evidences.length > 0
        ? result.evidences.map((evidence) => `- ${evidence.id}: ${evidence.evidenceType} / ${evidence.description}${evidence.localPath ? ` / ${evidence.localPath}` : ""}`).join("\n")
        : "- 증빙 없음",
      "",
      "## 지휘 판단",
      result.commandDecisions.length > 0
        ? result.commandDecisions.map((decision) => [
          `- ${decision.id}: ${commandDecisionLabel(decision.decisionType)} / ${decision.level} / ${decision.status}`,
          `  - effectiveAt: ${decision.effectiveAt}`,
          `  - reason: ${decision.reason}`,
          `  - decidedBy: ${decision.decidedBy}`,
          `  - notify: ${decision.notifyTargets.join(", ") || "미기록"}`,
          `  - resume 조건: ${decision.conditionsForResume.join(" / ") || "미기록"}`,
          decision.releasedAt ? `  - releasedAt: ${decision.releasedAt} / releasedBy: ${decision.releasedByDecisionId ?? "미기록"}` : "",
          decision.releaseReason ? `  - releaseReason: ${decision.releaseReason}` : "",
          decision.conditionsMet?.length ? `  - conditionsMet: ${decision.conditionsMet.join(" / ")}` : "",
          decision.supersededAt ? `  - supersededAt: ${decision.supersededAt} / supersededBy: ${decision.supersededByDecisionId ?? "미기록"}` : "",
        ].filter(Boolean).join("\n")).join("\n")
        : "- 지휘 판단 기록 없음",
      "",
      "## 지휘 판단 상태 전이",
      result.commandDecisions.length > 0
        ? result.commandDecisions.map((decision) => [
          `- ${decision.id}: ${decision.status}`,
          decision.releasedByDecisionId ? `  - release decision: ${decision.releasedByDecisionId}` : "",
          decision.supersededByDecisionId ? `  - superseded by: ${decision.supersededByDecisionId}` : "",
        ].join("\n")).join("\n")
        : "- 지휘 판단 기록 없음",
      "",
      "## 시간순 타임라인",
      timeline.length > 0
        ? timeline.map((entry) => [
          `- ${entry.at} [${entry.eventType}] ${entry.title}`,
          `  - event/zone: ${entry.eventName ?? "미기록"} / ${entry.zone ?? "미기록"}`,
          `  - refs: ${[
            entry.issueId ? `issue ${entry.issueId}` : "",
            entry.actionId ? `action ${entry.actionId}` : "",
            entry.evidenceId ? `evidence ${entry.evidenceId}` : "",
            entry.commandDecisionId ? `command ${entry.commandDecisionId}` : "",
          ].filter(Boolean).join(", ") || "미기록"}`,
          `  - detail: ${entry.detail}`,
        ].join("\n")).join("\n")
        : "- 타임라인 이벤트 없음",
    ].join("\n");
    return {
      content: [{ type: "text", text: markdown }],
      structuredContent: {
        input,
        reportMarkdown: markdown,
        issues: result.issues,
        actions: result.actions,
        evidences: result.evidences,
        commandDecisions: result.commandDecisions,
        timeline,
        storeDir: result.dir,
        _meta: COMMON_RESPONSE_META,
      },
    };
  },
};

export const generateMiceSituationBriefTool: ToolDefinition = {
  name: "generate_mice_situation_brief",
  title: "MICE 관계기관 1페이지 상황보고서 생성",
  description:
    "로컬 운영 저장소의 이슈, 조치, 증빙, 지휘 판단을 바탕으로 소방·경찰·지자체·베뉴에 공유할 1페이지 상황보고서를 생성합니다.",
  inputSchema: situationBriefInputSchema,
  handler(rawInput: unknown): McpToolResult {
    const input = situationBriefInputSchema.parse(rawInput ?? {});
    const brief = buildSituationBrief(input);
    return {
      content: [{ type: "text", text: brief.markdown }],
      structuredContent: {
        input,
        briefMarkdown: brief.markdown,
        briefTitle: brief.briefTitle,
        generatedAt: brief.generatedAt,
        audience: brief.audience,
        statusLine: brief.statusLine,
        primaryIssue: brief.primaryIssue,
        latestCommandDecision: brief.latestCommandDecision,
        openIssueCount: brief.openIssueCount,
        openActionCount: brief.openActionCount,
        completedActionCount: brief.completedActionCount,
        evidenceCount: brief.evidenceCount,
        reportScopeIssueId: brief.reportScopeIssueId,
        scopedIssueCount: brief.scopedIssueCount,
        scopedActionCount: brief.scopedActionCount,
        totalMatchedIssueCount: brief.totalMatchedIssueCount,
        requestedSupport: brief.requestedSupport,
        timeline: brief.timeline,
        storeDir: brief.storeDir,
        _meta: COMMON_RESPONSE_META,
      },
    };
  },
};

export const initializeMiceRunsheetExecutionTool: ToolDefinition = {
  name: "initialize_mice_runsheet_execution",
  title: "MICE 현장 운영 런시트 실행표 초기화",
  description: "generate_mice_safety_plan의 현장 운영 런시트를 로컬 실행 상태표로 저장해 open/done/blocked/escalated 상태를 추적할 수 있게 합니다.",
  inputSchema: initializeRunsheetInputSchema,
  async handler(rawInput: unknown): Promise<McpToolResult> {
    const input = initializeRunsheetInputSchema.parse(rawInput ?? {});
    const { operationsRunsheetMarkdown, source, ...planInput } = input;
    let markdown = operationsRunsheetMarkdown;

    if (!markdown) {
      const planResult = await generateMiceSafetyPlanTool.handler(planInput);
      const documentBundle = planResult.structuredContent?.documentBundle as { operationsRunsheet?: unknown } | undefined;
      markdown = String(documentBundle?.operationsRunsheet ?? "");
    }

    const parsedItems = parseRunsheetItems(markdown ?? "", source);
    if (parsedItems.length === 0) {
      throw new Error("현장 운영 런시트 표를 찾지 못했습니다. generate_mice_safety_plan의 documentBundle.operationsRunsheet 또는 동일한 Markdown 표를 입력하세요.");
    }

    const result = upsertRunsheetItems({
      eventName: input.eventName,
      source,
      items: parsedItems,
    });
    const summary = runsheetStatusSummary(result.items);
    const preview = result.items.slice(0, 8);
    const text = [
      "# MICE 현장 운영 런시트 실행표 초기화",
      `- 행사: ${input.eventName}`,
      `- created/updated/total: ${result.createdCount} / ${result.updatedCount} / ${result.items.length}`,
      `- 상태 요약: open ${summary.open}, done ${summary.done}, blocked ${summary.blocked}, escalated ${summary.escalated}`,
      `- ${formatStorePath(result.dir)}`,
      "",
      "## 초기 항목",
      ...preview.map((item) => `- ${item.id}: ${item.stage} / ${item.checkpoint} / ${item.target} / ${item.owner} / ${item.task}`),
    ].join("\n");

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        input,
        items: result.items,
        createdCount: result.createdCount,
        updatedCount: result.updatedCount,
        summary,
        storeDir: result.dir,
        operationsRunsheetMarkdown: markdown,
        _meta: COMMON_RESPONSE_META,
      },
    };
  },
};

export const updateMiceRunsheetExecutionTool: ToolDefinition = {
  name: "update_mice_runsheet_execution",
  title: "MICE 현장 운영 런시트 상태 업데이트",
  description: "로컬 런시트 실행 항목의 상태를 갱신하고, 막힌 항목을 안전 이슈와 스태프 조치로 연결합니다.",
  inputSchema: updateRunsheetInputSchema,
  handler(rawInput: unknown): McpToolResult {
    const input = updateRunsheetInputSchema.parse(rawInput ?? {});
    const before = reportOperations({ includeResolved: true });
    const beforeItem = before.runsheetItems.find((item) => item.id === input.itemId);
    if (!beforeItem) throw new Error(`Unknown runsheet itemId: ${input.itemId}`);

    let linkedIssueId = input.linkedIssueId ?? beforeItem.linkedIssueId;
    let createdIssue: MiceIssue | undefined;
    let createdAction: MiceAction | undefined;

    if (input.createIssue) {
      const issueType = input.issueType ?? inferIssueTypeFromRunsheetItem(beforeItem);
      const profile = incidentProfileFor(issueType);
      const detectedAt = nowIso();
      const responseSlaMinutes = profile.slaMinutesBySeverity[input.severity];
      const priority = dispatchPriority(profile, input.severity);
      const issueResult = registerIssue({
        eventName: beforeItem.eventName,
        issueType,
        severity: input.severity,
        description: input.issueDescription ?? `런시트 ${beforeItem.stage}/${beforeItem.checkpoint} 지연 또는 차단: ${beforeItem.task}`,
        zone: beforeItem.target,
        relatedHazards: profile.relatedHazardIds,
        incidentProfileId: profile.id,
        recommendedTeam: profile.recommendedTeam,
        dispatchPriority: priority,
        responseSlaMinutes,
        firstResponseDueAt: addMinutesIso(detectedAt, responseSlaMinutes),
        escalationPath: profile.escalationPath,
        playbookSteps: profile.playbookSteps,
        detectedAt,
      });
      createdIssue = issueResult.issue;
      linkedIssueId = createdIssue.id;
    }

    if (input.createAction) {
      if (!linkedIssueId) {
        throw new Error("createAction=true이면 linkedIssueId를 주거나 createIssue=true로 이슈를 먼저 생성해야 합니다.");
      }
      const actionResult = assignAction({
        issueId: linkedIssueId,
        title: `런시트 조치: ${beforeItem.stage} ${beforeItem.checkpoint}`,
        assignee: input.assignee ?? beforeItem.owner ?? "운영본부",
        team: input.team,
        priority: input.priority,
        dueAt: input.dueAt,
      });
      createdAction = actionResult.action;
    }

    const result = updateRunsheetItem({
      itemId: input.itemId,
      status: input.status,
      note: input.note,
      updatedBy: input.updatedBy,
      linkedIssueId,
      actionId: createdAction?.id ?? beforeItem.actionId,
      evidenceIds: input.evidenceIds,
    });

    const text = [
      "# MICE 현장 운영 런시트 상태 업데이트",
      `- itemId: ${result.item.id}`,
      `- status: ${result.item.status}`,
      `- 행사/대상: ${result.item.eventName} / ${result.item.target}`,
      `- 항목: ${result.item.stage} / ${result.item.checkpoint} / ${result.item.task}`,
      `- issue/action: ${result.item.linkedIssueId ?? "없음"} / ${result.item.actionId ?? "없음"}`,
      result.item.note ? `- note: ${result.item.note}` : "- note: 없음",
      `- ${formatStorePath(result.dir)}`,
    ].join("\n");

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        input,
        item: result.item,
        createdIssue,
        createdAction,
        storeDir: result.dir,
        _meta: COMMON_RESPONSE_META,
      },
    };
  },
};

export const queryMiceRunsheetExecutionTool: ToolDefinition = {
  name: "query_mice_runsheet_execution",
  title: "MICE 현장 운영 런시트 실행표 조회",
  description: "로컬 저장소의 런시트 실행 항목을 행사명, 상태, 연결 이슈 기준으로 조회합니다.",
  inputSchema: queryRunsheetInputSchema,
  handler(rawInput: unknown): McpToolResult {
    const input = queryRunsheetInputSchema.parse(rawInput ?? {});
    const result = reportOperations({
      eventName: input.eventName,
      issueId: input.linkedIssueId,
      includeResolved: true,
    });
    const items = result.runsheetItems
      .filter((item) => !input.status || item.status === input.status)
      .filter((item) => input.includeDone || item.status !== "done")
      .sort((a, b) => {
        const statusRank: Record<RunsheetStatus, number> = { escalated: 0, blocked: 1, open: 2, done: 3 };
        if (statusRank[a.status] !== statusRank[b.status]) return statusRank[a.status] - statusRank[b.status];
        return `${a.recommendedDate}|${a.checkpoint}|${a.stage}`.localeCompare(`${b.recommendedDate}|${b.checkpoint}|${b.stage}`);
      });
    const summary = runsheetStatusSummary(items);
    const priorityItems = items.filter((item) => ["blocked", "escalated"].includes(item.status)).slice(0, 12);
    const text = [
      "# MICE 현장 운영 런시트 실행표",
      `- 조회범위: ${input.eventName ?? "전체 행사"} / status ${input.status ?? "전체"} / includeDone ${input.includeDone}`,
      `- 상태 요약: open ${summary.open}, done ${summary.done}, blocked ${summary.blocked}, escalated ${summary.escalated}`,
      `- ${formatStorePath(result.dir)}`,
      "",
      "## 우선 확인 항목",
      priorityItems.length > 0
        ? priorityItems.map((item) => `- ${item.id}: ${item.status} / ${item.stage} / ${item.checkpoint} / ${item.target} / ${item.task} / issue ${item.linkedIssueId ?? "없음"}`).join("\n")
        : "- blocked/escalated 항목 없음",
      "",
      "## 전체 항목",
      items.slice(0, 50).map((item) => `- ${item.id}: ${item.status} / ${item.stage} / ${item.checkpoint} / ${item.target} / ${item.owner} / ${item.task}`).join("\n") || "- 항목 없음",
    ].join("\n");

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        input,
        summary,
        items,
        storeDir: result.dir,
        _meta: COMMON_RESPONSE_META,
      },
    };
  },
};

export const queryMiceOperationsDashboardTool: ToolDefinition = {
  name: "query_mice_operations_dashboard",
  title: "MICE 운영본부 이슈/SLA 대시보드",
  description: "로컬 운영 저장소의 이슈를 SLA 초과/임박/정상/해결 상태로 집계하고, 담당팀·우선순위별 미해결 조치를 보여줍니다.",
  inputSchema: dashboardInputSchema,
  handler(rawInput: unknown): McpToolResult {
    const input = dashboardInputSchema.parse(rawInput ?? {});
    const dashboard = buildDashboardData(input);

    const text = [
      "# MICE 운영본부 이슈/SLA 대시보드",
      "",
      `- 기준시각: ${dashboard.now}`,
      `- ${formatStorePath(dashboard.storeDir)}`,
      `- SLA 요약: overdue ${dashboard.summary.overdue}, due_soon ${dashboard.summary.due_soon}, normal ${dashboard.summary.normal}, no_sla ${dashboard.summary.no_sla}, resolved ${dashboard.summary.resolved}`,
      `- 팀별 미해결: ${Object.entries(dashboard.byTeam).map(([team, count]) => `${team} ${count}`).join(", ") || "없음"}`,
      `- 활성 지휘 판단: ${dashboard.activeCommandDecisions.map((decision) => `${commandDecisionLabel(decision.decisionType)}(${decision.level}${decision.zone ? `/${decision.zone}` : ""})`).join(", ") || "없음"}`,
      `- 지휘 판단 상태: active ${dashboard.commandStatusSummary.active}, released ${dashboard.commandStatusSummary.released}, superseded ${dashboard.commandStatusSummary.superseded}, informational ${dashboard.commandStatusSummary.informational}`,
      `- 런시트 상태: open ${dashboard.runsheetSummary.open}, done ${dashboard.runsheetSummary.done}, blocked ${dashboard.runsheetSummary.blocked}, escalated ${dashboard.runsheetSummary.escalated}`,
      `- 타임라인 이벤트: ${dashboard.timeline.length}`,
      "",
      "## 런시트 우선 확인",
      dashboard.runsheetItems.filter((item) => ["blocked", "escalated"].includes(item.status)).length > 0
        ? dashboard.runsheetItems
          .filter((item) => ["blocked", "escalated"].includes(item.status))
          .slice(0, 12)
          .map((item) => `- ${item.id}: ${item.status} / ${item.stage} / ${item.checkpoint} / ${item.target} / ${item.task}${item.linkedIssueId ? ` / issue ${item.linkedIssueId}` : ""}`)
          .join("\n")
        : "- blocked/escalated 런시트 항목 없음",
      "",
      "## 우선 처리 이슈",
      dashboard.rows.length > 0
        ? dashboard.rows.slice(0, 20).map((row) => [
          `- ${row.issueId}: ${row.issueType} / ${row.severity} / ${row.slaState}`,
          `  - 담당/SLA: ${row.recommendedTeam} / ${row.responseSlaMinutes ?? "미지정"}분 / ${row.firstResponseDueAt ?? "미지정"}`,
          `  - 위치: ${row.zone ?? "미기록"} / 상태: ${row.status}`,
          `  - escalation: ${row.escalationPath.join(" > ") || "미기록"}`,
        ].join("\n")).join("\n")
        : "- 조건에 맞는 이슈 없음",
    ].join("\n");

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        ...dashboard,
        _meta: COMMON_RESPONSE_META,
      },
    };
  },
};

export const exportMiceOperationsDashboardTool: ToolDefinition = {
  name: "export_mice_operations_dashboard",
  title: "MICE 운영본부 대시보드 xlsx export",
  description: "로컬 운영 저장소의 SLA 대시보드, 미해결 조치, 지휘 판단을 xlsx 상황판과 manifest로 저장합니다.",
  inputSchema: exportDashboardInputSchema,
  async handler(rawInput: unknown): Promise<McpToolResult> {
    const input = exportDashboardInputSchema.parse(rawInput ?? {});
    const dashboard = buildDashboardData(input);
    const exportDir = input.outputDir
      ? confineToRoot(input.outputDir)
      : join(defaultRoot(), "operation-dashboards", `${safeName(input.eventName ?? "all-events")}-${nowStamp()}`);
    mkdirSync(exportDir, { recursive: true });
    const xlsxPath = join(exportDir, "operations-dashboard.xlsx");
    await writeDashboardXlsx(dashboard, xlsxPath);
    const manifest = {
      version: VERSION,
      generatedAt: new Date().toISOString(),
      input,
      exportDir,
      files: [xlsxPath],
      summary: dashboard.summary,
      activeCommandDecisionCount: dashboard.activeCommandDecisions.length,
      commandStatusSummary: dashboard.commandStatusSummary,
      runsheetSummary: dashboard.runsheetSummary,
      timelineEventCount: dashboard.timeline.length,
    };
    const manifestPath = join(exportDir, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const files = [xlsxPath, manifestPath];
    return {
      content: [{
        type: "text",
        text: [
          "# MICE 운영본부 대시보드 export",
          `- exportDir: ${exportDir}`,
          ...files.map((file) => `- ${file}`),
        ].join("\n"),
      }],
      structuredContent: {
        input,
        exportDir,
        files,
        manifest,
        dashboard,
        _meta: COMMON_RESPONSE_META,
      },
    };
  },
};

export const queryMiceCommunicationTemplatesTool: ToolDefinition = {
  name: "query_mice_communication_templates",
  title: "MICE 지휘 판단 안내문 템플릿 조회",
  description: "대피개시, 행사 일시중지, 행사 중단, 재개승인 등 지휘 판단별 방송·무전·문자·관계기관 공유 문구를 오프라인 템플릿에서 조회합니다.",
  inputSchema: communicationTemplateInputSchema,
  handler(rawInput: unknown): McpToolResult {
    const input = communicationTemplateInputSchema.parse(rawInput ?? {});
    const values = {
      eventName: input.eventName,
      zone: input.zone,
      reason: input.reason,
      safeRoute: input.safeRoute,
      resumeConditions: input.resumeConditions.length > 0 ? input.resumeConditions.join(", ") : "안전 확인 완료",
      contactPoint: input.contactPoint,
    };
    const templates = operationCommunicationTemplates
      .filter((template) => template.decisionType === input.decisionType)
      .filter((template) => !input.channel || template.channel === input.channel)
      .filter((template) => !input.audience || template.audience === input.audience)
      .map((template) => ({
        ...template,
        renderedKo: fillTemplate(template.ko, values),
      }));
    const text = [
      "# MICE 지휘 판단 안내문 템플릿",
      `- decisionType: ${commandDecisionLabel(input.decisionType)}`,
      `- channel: ${input.channel ?? "전체"}`,
      "",
      templates.length > 0
        ? templates.map((template) => [
          `## ${template.id}`,
          `- channel/audience/tone: ${template.channel} / ${template.audience} / ${template.tone}`,
          "",
          template.renderedKo,
          "",
          "체크포인트:",
          ...template.checkpoints.map((checkpoint) => `- ${checkpoint}`),
        ].join("\n")).join("\n\n")
        : "매칭 템플릿 없음",
    ].join("\n");
    return {
      content: [{ type: "text", text }],
      structuredContent: {
        input,
        templates,
        _meta: COMMON_RESPONSE_META,
      },
    };
  },
};

export const generateMiceVisitorNoticeTool: ToolDefinition = {
  name: "generate_mice_visitor_notice",
  title: "MICE 다국어 방문객 안전 안내 생성",
  description:
    "대피, 일시중지, 중단, 현 위치 대기, 재개 등 방문객 대상 현장 안내문을 한국어·영어·일본어·중국어 오프라인 템플릿으로 생성합니다.",
  inputSchema: visitorNoticeInputSchema,
  handler(rawInput: unknown): McpToolResult {
    const input = visitorNoticeInputSchema.parse(rawInput ?? {});
    const { languages, notices } = buildMiceVisitorNotices({
      decisionType: input.decisionType,
      languages: input.languages.length > 0 ? input.languages as VisitorNoticeLanguage[] : DEFAULT_VISITOR_NOTICE_LANGUAGES,
      eventName: input.eventName,
      zone: input.zone,
      reason: input.reason,
      safeRoute: input.safeRoute,
      resumeConditions: input.resumeConditions,
      contactPoint: input.contactPoint,
      localizedPlaceholders: input.localizedPlaceholders,
    });
    const text = [
      `# MICE 다국어 방문객 안전 안내`,
      `- decisionType: ${commandDecisionLabel(input.decisionType)}`,
      `- zone: ${input.zone}`,
      "",
      formatVisitorNoticesMarkdown("방문객 안전 안내문", languages, notices).replace(/^# 방문객 안전 안내문\n/, ""),
    ].join("\n");

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        input,
        languages,
        notices,
        _meta: COMMON_RESPONSE_META,
      },
    };
  },
};

export const recordMiceCommandDecisionTool: ToolDefinition = {
  name: "record_mice_command_decision",
  title: "MICE 운영본부 지휘 판단 기록",
  description: "대피개시, 현 위치 대기, 행사 일시중지, 행사 중단, 재개승인, 상황해제 같은 운영본부 command decision을 로컬 감사 로그로 기록합니다.",
  inputSchema: commandDecisionInputSchema,
  handler(rawInput: unknown): McpToolResult {
    const input = commandDecisionInputSchema.parse(rawInput ?? {});
    const effectiveAt = input.effectiveAt ?? nowIso();
    const defaultNotifyTargets = ["운영본부", "구역장", "보안팀", "의료팀", "베뉴 담당"];
    const result = recordCommandDecision({
      ...input,
      effectiveAt,
      notifyTargets: input.notifyTargets.length > 0 ? input.notifyTargets : defaultNotifyTargets,
      conditionsForResume: input.conditionsForResume,
    });
    return {
      content: [{
        type: "text",
        text: [
          "# MICE 운영본부 지휘 판단 기록",
          `- commandDecisionId: ${result.commandDecision.id}`,
          `- decision: ${commandDecisionLabel(result.commandDecision.decisionType)} / ${result.commandDecision.level}`,
          `- effectiveAt: ${result.commandDecision.effectiveAt}`,
          `- notify: ${result.commandDecision.notifyTargets.join(", ")}`,
          `- ${formatStorePath(result.dir)}`,
        ].join("\n"),
      }],
      structuredContent: {
        commandDecision: result.commandDecision,
        storeDir: result.dir,
        _meta: COMMON_RESPONSE_META,
      },
    };
  },
};

export const resolveMiceCommandDecisionTool: ToolDefinition = {
  name: "resolve_mice_command_decision",
  title: "MICE 운영본부 지휘 판단 해제/재개 처리",
  description:
    "활성 지휘 판단을 재개승인 또는 상황해제로 닫고, 원 판단은 released 상태로, 해제 판단은 별도 감사 로그로 기록합니다.",
  inputSchema: resolveCommandDecisionInputSchema,
  handler(rawInput: unknown): McpToolResult {
    const input = resolveCommandDecisionInputSchema.parse(rawInput ?? {});
    const result = resolveCommandDecision({
      ...input,
      notifyTargets: input.notifyTargets.length > 0 ? input.notifyTargets : undefined,
      conditionsMet: input.conditionsMet,
    });
    return {
      content: [{
        type: "text",
        text: [
          "# MICE 운영본부 지휘 판단 해제/재개 처리",
          `- targetDecisionId: ${result.targetDecision.id}`,
          `- targetStatus: ${result.targetDecision.status}`,
          `- resolutionDecisionId: ${result.resolutionDecision.id}`,
          `- resolution: ${commandDecisionLabel(result.resolutionDecision.decisionType)} / ${result.resolutionDecision.level}`,
          `- effectiveAt: ${result.resolutionDecision.effectiveAt}`,
          `- conditionsMet: ${result.targetDecision.conditionsMet?.join(" / ") || "미기록"}`,
          `- ${formatStorePath(result.dir)}`,
        ].join("\n"),
      }],
      structuredContent: {
        targetDecision: result.targetDecision,
        resolutionDecision: result.resolutionDecision,
        storeDir: result.dir,
        _meta: COMMON_RESPONSE_META,
      },
    };
  },
};
