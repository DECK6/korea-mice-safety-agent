import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Paragraph as DocxParagraph } from "docx";
import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import { objectRows, writeXlsxFile, type XlsxCell, type XlsxSheet } from "../lib/simple-xlsx.js";
import {
  buildDefaultMiceVisitorNoticeBundle,
  type VisitorNoticeBundle,
} from "../lib/mice-visitor-notices.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import { VERSION } from "../version.js";
import { generateMiceSafetyPlanTool } from "./generate-mice-safety-plan.js";
import { reviewMiceSafetyPlanTool } from "./review-mice-safety-plan.js";

const EventTypeSchema = z.enum([
  "festival",
  "outdoor_event",
  "exhibition",
  "conference",
  "performance",
  "food_event",
  "vip_event",
]);

const inputSchema = z.object({
  eventName: z.string().optional().default("행사명 미정"),
  date: z.string().optional(),
  eventDate: z.string().optional().describe("행사일 YYYY-MM-DD. date와 같은 의미의 alias입니다."),
  location: z.string().optional(),
  organizer: z.string().optional(),
  eventTypes: z.array(EventTypeSchema).optional(),
  venueId: z.string().optional(),
  jurisdiction: z.string().optional(),
  expectedCrowd: z.number().int().min(0).optional(),
  outdoor: z.boolean().optional(),
  outdoorEvent: z.boolean().optional(),
  roadUse: z.boolean().optional(),
  unhostedCrowd: z.boolean().optional().describe("주최자·주관자 없이 자발적/예측형 다중운집이 발생하는 상황"),
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
  outputDir: z.string().optional().describe("생성 파일을 둘 디렉터리. 없으면 MICE_LOCAL_DIR/plan-bundles 아래에 만듭니다."),
});

type AnyRecord = Record<string, unknown>;
type SharingScope = "public_agency" | "venue_facility" | "emergency_agency" | "contractor" | "restricted_internal";
type RedactionLevel = "none" | "summary_only" | "limited_external" | "restricted_internal";

interface SubmissionPackage {
  id: string;
  title: string;
  audience: string;
  description: string;
  sharingScope: SharingScope;
  redactionLevel: RedactionLevel;
  redactionNotes: string[];
  fileName: string;
  documentKeys: string[];
  coverageIds: string[];
  markdown: string;
}

interface SubmissionScheduleItem {
  no: string;
  audience: string;
  document: string;
  condition: string;
  timing: string;
  basis: string;
  status: string;
  packageIds: string[];
  recommendedDueLabel: string;
  recommendedDueDate: string;
  finalCheckpoint: string;
  responsible: string;
  accountable: string;
  consulted: string;
  informed: string;
  requiredEvidence: string;
}

const documentFileNames: Record<string, string> = {
  eventSafetyPlan: "01-event-safety-plan.md",
  crowdFlowPlan: "02-crowd-flow-plan.md",
  roadTrafficControlPlan: "19-road-traffic-control-plan.md",
  unhostedCrowdResponsePlan: "20-unhosted-crowd-response-plan.md",
  venueFacilityPlan: "03-venue-facility-plan.md",
  workerSafetyPlan: "04-worker-safety-plan.md",
  performanceStagePlan: "21-performance-stage-execution-plan.md",
  fireEvacuationChecklist: "05-fire-evacuation-checklist.md",
  foodLpgChecklist: "06-food-lpg-checklist.md",
  privacyCctvChecklist: "07-privacy-cctv-checklist.md",
  securityAccessPlan: "08-security-access-plan.md",
  medicalResponsePlan: "09-medical-response-plan.md",
  staffAssignment: "10-staff-assignment.md",
  emergencyContacts: "11-emergency-contacts.md",
  dailySafetyChecklist: "12-daily-safety-checklist.md",
  submissionChecklist: "13-submission-checklist.md",
  incidentReportTemplate: "14-incident-report-template.md",
  visitorSafetyNotices: "15-visitor-safety-notices.md",
  operationsRunsheet: "16-operations-runsheet.md",
};

const documentTitles: Record<string, string> = {
  eventSafetyPlan: "행사 안전관리계획서",
  crowdFlowPlan: "인파·동선 관리계획",
  roadTrafficControlPlan: "도로·교통 실행계획",
  unhostedCrowdResponsePlan: "무주최 다중운집 관계기관 공동대응계획",
  venueFacilityPlan: "베뉴 시설·수용·하역·전기 제약 체크",
  workerSafetyPlan: "설치·철거 작업자 안전계획서",
  performanceStagePlan: "공연·무대 실행계획",
  fireEvacuationChecklist: "소방·피난 점검표",
  foodLpgChecklist: "식음료/LPG 점검표",
  privacyCctvChecklist: "개인정보/CCTV 점검표",
  securityAccessPlan: "출입통제·보안검색·VIP 동선 계획",
  medicalResponsePlan: "응급의료·AED·구급 이송 계획",
  staffAssignment: "스태프 배치표",
  emergencyContacts: "비상연락망",
  dailySafetyChecklist: "일일 안전점검표",
  submissionChecklist: "제출·협의 체크리스트",
  incidentReportTemplate: "사고보고서 템플릿",
  visitorSafetyNotices: "다국어 방문객 안전 안내문",
  operationsRunsheet: "현장 운영 런시트",
};

function defaultRoot(): string {
  return process.env.MICE_LOCAL_DIR ?? join(homedir(), ".korea-mice-safety-agent");
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

function csvEscape(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function bulletsToCsv(markdown: string, title: string): string {
  const rows = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line, index) => [String(index + 1), title, line.slice(2), "TBD", "open"]);
  return [["No", "Sheet", "Item", "Owner", "Status"], ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
}

function markdownToDocxParagraphs(markdown: string, docx: typeof import("docx")): DocxParagraph[] {
  const { HeadingLevel, Paragraph, TextRun } = docx;
  const paragraphs: DocxParagraph[] = [];
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      paragraphs.push(new Paragraph({ text: "" }));
      continue;
    }
    if (line.startsWith("# ")) {
      paragraphs.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }));
      continue;
    }
    if (line.startsWith("## ")) {
      paragraphs.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }));
      continue;
    }
    if (line.startsWith("### ")) {
      paragraphs.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 }));
      continue;
    }
    if (line.startsWith("- ")) {
      paragraphs.push(new Paragraph({
        children: [new TextRun(line.slice(2))],
        bullet: { level: 0 },
      }));
      continue;
    }
    paragraphs.push(new Paragraph({ children: [new TextRun(line)] }));
  }
  return paragraphs;
}

async function importDocx(): Promise<typeof import("docx")> {
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  if (localStorageDescriptor?.get) {
    Object.defineProperty(globalThis, "localStorage", {
      value: undefined,
      configurable: true,
    });
  }
  try {
    return await import("docx");
  } finally {
    if (localStorageDescriptor) {
      Object.defineProperty(globalThis, "localStorage", localStorageDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  }
}

async function writeDocx(markdown: string, filePath: string): Promise<void> {
  const docx = await importDocx();
  const doc = new docx.Document({
    creator: "korea-mice-safety-agent",
    title: "MICE Safety Plan",
    description: "Offline ontology-based MICE safety plan draft",
    sections: [
      {
        properties: {},
        children: markdownToDocxParagraphs(markdown, docx),
      },
    ],
  });
  const buffer = await docx.Packer.toBuffer(doc);
  writeFileSync(filePath, buffer);
}

function bulletRows(markdown: string, sheet: string): Array<Record<string, string>> {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line, index) => ({
      No: String(index + 1),
      Sheet: sheet,
      Item: line.slice(2),
      Owner: "TBD",
      Status: "open",
      Evidence: "",
    }));
}

function tableRows(markdown: string): string[][] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|") && !/^\|\s*-/.test(line))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()));
}

function tableToCsv(markdown: string): string {
  const rows = tableRows(markdown);
  if (rows.length === 0) return "";
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function markdownTableCell(value: string): string {
  return (value || "확인 필요").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

function markdownTableRecords(markdown: string): AnyRecord[] {
  const rows = tableRows(markdown);
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function addRowsSheet(sheets: XlsxSheet[], name: string, rows: Array<Record<string, string>>): void {
  sheets.push({
    name,
    rows: objectRows(["No", "Sheet", "Item", "Owner", "Status", "Evidence"], rows),
  });
}

function addTableSheet(sheets: XlsxSheet[], name: string, rows: string[][]): void {
  sheets.push({ name, rows });
}

function addVisitorNoticeSheet(sheets: XlsxSheet[], noticeBundle: VisitorNoticeBundle): void {
  const rows: Array<Record<string, string>> = [];
  for (const notice of noticeBundle.notices) {
    for (const language of noticeBundle.languages) {
      const text = notice.localizations[language];
      if (!text) continue;
      rows.push({
        Scenario: notice.scenario,
        TemplateID: notice.id,
        Language: language,
        Notice: text,
        Checkpoints: notice.checkpoints.join(" | "),
      });
    }
  }
  sheets.push({
    name: "Visitor Notices",
    rows: objectRows(["Scenario", "TemplateID", "Language", "Notice", "Checkpoints"], rows),
  });
}

function addReviewSheets(sheets: XlsxSheet[], review: AnyRecord): void {
  const findings = Array.isArray(review.findings) ? review.findings as AnyRecord[] : [];
  const coverage = Array.isArray(review.documentCoverageMatrix) ? review.documentCoverageMatrix as AnyRecord[] : [];
  sheets.push({
    name: "Review Summary",
    rows: [
      ["Field", "Value"],
      ["verdict", String(review.verdict ?? "")],
      ["score", String(review.score ?? "")],
      ["grade", String(review.grade ?? "")],
      ["error", String((review.counts as AnyRecord | undefined)?.error ?? "")],
      ["warning", String((review.counts as AnyRecord | undefined)?.warning ?? "")],
      ["total findings", String((review.counts as AnyRecord | undefined)?.total ?? "")],
    ],
  });

  const coverageRows: Array<Record<string, string>> = [];
  for (const row of coverage) {
    coverageRows.push({
      DocumentID: String(row.documentId ?? ""),
      Title: String(row.title ?? ""),
      Requirement: String(row.requirement ?? ""),
      Status: String(row.status ?? ""),
      AppliesWhen: String(row.appliesWhen ?? ""),
      EvidenceLine: String((row.evidence as AnyRecord | undefined)?.line ?? ""),
    });
  }
  sheets.push({
    name: "Review Coverage",
    rows: objectRows(["DocumentID", "Title", "Requirement", "Status", "AppliesWhen", "EvidenceLine"], coverageRows),
  });

  const findingRows: Array<Record<string, string>> = [];
  for (const finding of findings) {
    findingRows.push({
      RequirementID: String(finding.requirementId ?? ""),
      Severity: String(finding.severity ?? ""),
      Category: String(finding.category ?? ""),
      Message: String(finding.message ?? ""),
      Recommendation: String(finding.recommendation ?? ""),
      EvidenceLine: String((finding.evidence as AnyRecord | undefined)?.line ?? ""),
    });
  }
  sheets.push({
    name: "Review Findings",
    rows: objectRows(["RequirementID", "Severity", "Category", "Message", "Recommendation", "EvidenceLine"], findingRows),
  });
}

function addSubmissionPackageSheet(sheets: XlsxSheet[], packages: SubmissionPackage[]): void {
  const rows: Array<Record<string, string>> = [];
  for (const item of packages) {
    rows.push({
      PackageID: item.id,
      Title: item.title,
      Audience: item.audience,
      SharingScope: item.sharingScope,
      RedactionLevel: item.redactionLevel,
      File: item.fileName,
      Documents: item.documentKeys.map((key) => documentTitles[key] ?? key).join(" | "),
      RedactionNotes: item.redactionNotes.join(" | "),
    });
  }
  sheets.push({
    name: "Submission Packages",
    rows: objectRows(["PackageID", "Title", "Audience", "SharingScope", "RedactionLevel", "File", "Documents", "RedactionNotes"], rows),
  });
}

function addSubmissionScheduleSheet(sheets: XlsxSheet[], scheduleItems: SubmissionScheduleItem[]): void {
  const rows: Array<Record<string, string>> = [];
  for (const item of scheduleItems) {
    rows.push({
      No: item.no,
      Audience: item.audience,
      Document: item.document,
      PackageIDs: item.packageIds.join(" | "),
      DueLabel: item.recommendedDueLabel,
      DueDate: item.recommendedDueDate,
      FinalCheckpoint: item.finalCheckpoint,
      Responsible: item.responsible,
      Accountable: item.accountable,
      Consulted: item.consulted,
      Informed: item.informed,
      RequiredEvidence: item.requiredEvidence,
      Status: item.status,
    });
  }
  sheets.push({
    name: "Submission RACI",
    rows: objectRows(["No", "Audience", "Document", "PackageIDs", "DueLabel", "DueDate", "FinalCheckpoint", "Responsible", "Accountable", "Consulted", "Informed", "RequiredEvidence", "Status"], rows),
  });
}

function packageSection(title: string, markdown: unknown): string {
  const text = String(markdown ?? "").trim();
  return [
    `## ${title}`,
    "",
    text || "- 해당 문서 없음",
  ].join("\n");
}

function redactionReplacement(category: string): string {
  return `- [공유범위 제한] ${category}: 별도 승인된 내부/전용 패키지에서만 공유`;
}

function collapseRepeatedRedactions(lines: string[]): string[] {
  const output: string[] = [];
  for (const line of lines) {
    if (line.startsWith("- [공유범위 제한]") && output[output.length - 1] === line) continue;
    output.push(line);
  }
  return output;
}

function sanitizeMarkdownForPackage(markdown: unknown, documentKey: string, packageMeta: Omit<SubmissionPackage, "markdown">): string {
  const text = String(markdown ?? "").trim();
  if (!text || packageMeta.redactionLevel === "none" || packageMeta.sharingScope === "restricted_internal") return text;
  const lines = text.split(/\r?\n/).map((line) => {
    const normalized = line.replace(/\s+/g, " ");
    if (/^#+\s|^-\s*행사명\s*:/.test(normalized)) return line;
    if (packageMeta.sharingScope !== "public_agency" && /개인정보|CCTV|QR|출입증|수탁자|접속기록|처리방침|촬영|동의/.test(normalized)) {
      return redactionReplacement("개인정보/CCTV/등록 세부 항목");
    }
    if (packageMeta.sharingScope !== "restricted_internal" && /VIP|보안검색|경비업|경비지도사|경비원 명부|배치신고|출입통제/.test(normalized)) {
      return redactionReplacement("VIP/보안/경비 세부 항목");
    }
    if (packageMeta.sharingScope === "contractor" && documentKey === "emergencyContacts" && /관할 지자체|경찰|소방\/119|의료기관|구급 이송/.test(normalized)) {
      return redactionReplacement("관계기관 직접 연락망");
    }
    if (packageMeta.sharingScope === "venue_facility" && /환불|재입장|공식 채널/.test(normalized)) {
      return redactionReplacement("주최자 운영정책 세부 항목");
    }
    return line;
  });
  return collapseRepeatedRedactions(lines).join("\n");
}

function parseEventDate(value: string | undefined): Date | null {
  const match = value?.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function eventDateValue(input: Pick<z.infer<typeof inputSchema>, "date" | "eventDate">): string | undefined {
  return input.date ?? input.eventDate;
}

function formatDate(date: Date | null, offsetDays: number): string {
  if (!date) return "";
  const shifted = new Date(date.getTime());
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);
  return shifted.toISOString().slice(0, 10);
}

function dueMeta(timing: string, eventDate: Date | null): Pick<SubmissionScheduleItem, "recommendedDueLabel" | "recommendedDueDate" | "finalCheckpoint"> {
  if (/5\s*[~-]\s*21일|5~21일|5-21일/.test(timing)) {
    return {
      recommendedDueLabel: "T-21 착수 / T-5 최종제출",
      recommendedDueDate: formatDate(eventDate, -21),
      finalCheckpoint: eventDate ? `${formatDate(eventDate, -5)} 최종 제출 확인` : "T-5 최종 제출 확인",
    };
  }
  if (/수집 전|위탁|보안점검/.test(timing)) {
    return {
      recommendedDueLabel: "T-14 사전점검",
      recommendedDueDate: formatDate(eventDate, -14),
      finalCheckpoint: eventDate ? `${formatDate(eventDate, -1)} 고지·권한 최종 확인` : "T-1 고지·권한 최종 확인",
    };
  }
  if (/도로점용허가|통제 시행 전|운행 제한|사전 공고/.test(timing)) {
    return {
      recommendedDueLabel: "T-14 협의 착수 / T-7 현장공고",
      recommendedDueDate: formatDate(eventDate, -14),
      finalCheckpoint: eventDate ? `${formatDate(eventDate, -7)} 통제·우회 안내 확인` : "T-7 통제·우회 안내 확인",
    };
  }
  if (/영업 전|신고\/허가|신고\/허가 확인/.test(timing)) {
    return {
      recommendedDueLabel: "T-7 영업 전 확인",
      recommendedDueDate: formatDate(eventDate, -7),
      finalCheckpoint: eventDate ? `${formatDate(eventDate, -1)} 개장 전 위생 확인` : "T-1 개장 전 위생 확인",
    };
  }
  if (/설치 전|작업 전/.test(timing)) {
    return {
      recommendedDueLabel: "T-7 설치·작업 전 승인",
      recommendedDueDate: formatDate(eventDate, -7),
      finalCheckpoint: eventDate ? `${formatDate(eventDate, -1)} 개장 전 현장 확인` : "T-1 개장 전 현장 확인",
    };
  }
  if (/개장 전|피크 전|검사|증빙 확보/.test(timing)) {
    return {
      recommendedDueLabel: "T-1 개장 전 확인",
      recommendedDueDate: formatDate(eventDate, -1),
      finalCheckpoint: eventDate ? `${formatDate(eventDate, 0)} 운영 중 재점검` : "D-day 운영 중 재점검",
    };
  }
  if (/종료 후|파기|원상복구/.test(timing)) {
    return {
      recommendedDueLabel: "D+1 종료 후 정리",
      recommendedDueDate: formatDate(eventDate, 1),
      finalCheckpoint: eventDate ? `${formatDate(eventDate, 7)} 보존·파기 확인` : "D+7 보존·파기 확인",
    };
  }
  return {
    recommendedDueLabel: "T-7 담당기관 확인",
    recommendedDueDate: formatDate(eventDate, -7),
    finalCheckpoint: eventDate ? `${formatDate(eventDate, -1)} 최종 확인` : "T-1 최종 확인",
  };
}

function availablePackageIds(input: z.infer<typeof inputSchema>): Set<string> {
  const ids = new Set(["local_government", "venue", "fire_police_medical"]);
  const hasWorker = Boolean(input.setupTeardown || input.temporaryStructures || input.temporaryElectricity || input.workAtHeight || input.heavyObjectHandling || input.hotWork);
  const hasPrivacyOrSecurity = Boolean(input.personalDataProcessing || input.vipSecurity || hasEvent(input, "conference") || hasEvent(input, "vip_event"));
  if (hasWorker) ids.add("worker_contractor");
  if (hasPrivacyOrSecurity) ids.add("privacy_security");
  return ids;
}

function inferPackageIds(input: z.infer<typeof inputSchema>, audience: string, document: string, condition: string, basis: string): string[] {
  const text = `${audience} ${document} ${condition} ${basis}`;
  const candidates: string[] = [];
  if (/지자체|도로|광고|보건|위생|건축|조례|허가|신고|공고/.test(text)) candidates.push("local_government");
  if (/베뉴|방재실|시설팀|하역|전기|가설건축물|피난안전|광고물|소방/.test(text)) candidates.push("venue");
  if (/소방|피난|AED|의료|119|응급|구급|경찰|통제/.test(text)) candidates.push("fire_police_medical");
  if (/시공|하역|작업자|작업계획|철거|무대|트러스|고소|중량물|화기|임시전기|설치·철거/.test(text)) candidates.push("worker_contractor");
  if (/개인정보|CCTV|보안|경비|VIP|출입증|QR|접속기록|위탁/.test(text)) candidates.push("privacy_security");
  const available = availablePackageIds(input);
  const filtered = [...new Set(candidates)].filter((id) => available.has(id));
  return filtered.length > 0 ? filtered : ["local_government"];
}

function inferRaci(audience: string, document: string, condition: string): Pick<SubmissionScheduleItem, "responsible" | "accountable" | "consulted" | "informed"> {
  const text = `${audience} ${document} ${condition}`;
  if (/개인정보|CCTV|QR|출입증|접속기록|위탁/.test(text)) {
    return { responsible: "개인정보보호책임자", accountable: "개인정보보호책임자", consulted: "등록 대행사/보안 담당", informed: "운영본부" };
  }
  if (/LPG|가스|식품|위생|푸드|케이터링|시식/.test(text)) {
    return { responsible: "F&B 담당", accountable: "안전총괄", consulted: "보건/위생 담당부서/가스공급자", informed: "운영본부/부스운영자" };
  }
  if (/도로|교통|통행|차로|보도|퍼레이드|공고/.test(text)) {
    return { responsible: "교통·대외협력 담당", accountable: "안전총괄", consulted: "도로관리청/경찰/지자체", informed: "운영본부/안내팀" };
  }
  if (/의료|AED|119|구급|이송/.test(text)) {
    return { responsible: "의료담당", accountable: "안전총괄", consulted: "119/이송병원/AED 관리책임자", informed: "운영본부/구역장" };
  }
  if (/소방|피난|방재|위험물|가설건축물/.test(text)) {
    return { responsible: "시설·방재 담당", accountable: "안전총괄", consulted: "소방서/베뉴 방재실/시설팀", informed: "운영본부/구역장" };
  }
  if (/시공|하역|작업자|작업계획|철거|무대|트러스|고소|중량물|화기|임시전기|설치·철거/.test(text)) {
    return { responsible: "작업책임자", accountable: "안전총괄", consulted: "시공/하역/전기 협력사", informed: "운영본부/구역장" };
  }
  if (/시설팀|전기/.test(text)) {
    return { responsible: "시설·방재 담당", accountable: "안전총괄", consulted: "소방서/베뉴 방재실/시설팀", informed: "운영본부/구역장" };
  }
  if (/옥외광고|현수막|배너|안내판|전광/.test(text)) {
    return { responsible: "홍보·시설 담당", accountable: "운영총괄", consulted: "옥외광고 담당부서/베뉴", informed: "운영본부/안내팀" };
  }
  return { responsible: "안전총괄", accountable: "운영총괄", consulted: audience || "관계기관", informed: "운영본부/협력사" };
}

function evidenceFor(document: string, audience: string): string {
  const text = `${document} ${audience}`;
  if (/도로|교통|통행/.test(text)) return "도로점용허가증/교통소통대책 승인/통제 공고 캡처";
  if (/옥외광고|현수막|배너|안내판|전광/.test(text)) return "광고물 허가·신고필증/베뉴 설치 승인/설치 사진";
  if (/가설건축물|피난안전|임시사용/.test(text)) return "가설건축물 신고필증/피난안전 확인서/임시사용 승인 확인";
  if (/소방|피난|화기|위험물/.test(text)) return "소방·피난 점검표/위험물 반입 승인/개장 전 사진";
  if (/LPG|가스/.test(text)) return "검사증명서/보험증빙/공급자 안전점검표";
  if (/식품|위생|푸드|케이터링|시식/.test(text)) return "영업 신고·허가 확인/위생점검표/보존식 기록";
  if (/개인정보|CCTV|QR|출입증|접속기록|위탁/.test(text)) return "처리방침/위탁계약/안내문/CCTV 고지 사진/접속기록 점검표";
  if (/의료|AED|119|구급|이송/.test(text)) return "AED 점검표/응급인력 배치표/119·이송병원 협의 기록";
  if (/작업자|작업계획|시공|하역|철거|부스|무대/.test(text)) return "작업계획서/교육명단/PPE 지급/작업허가·작업중지 기준";
  return "제출본 PDF/접수증/승인메일/담당자 확인 메모";
}

function buildSubmissionSchedule(input: z.infer<typeof inputSchema>, submissionChecklist: unknown): SubmissionScheduleItem[] {
  const records = markdownTableRecords(String(submissionChecklist ?? ""));
  const eventDate = parseEventDate(eventDateValue(input));
  return records.map((record, index) => {
    const audience = String(record["제출/확인처"] ?? "");
    const document = String(record["문서/서식"] ?? "");
    const condition = String(record["조건"] ?? "");
    const timing = String(record["기한/시점"] ?? "");
    const basis = String(record["근거/메모"] ?? "");
    const status = String(record["상태"] ?? "open");
    return {
      no: String(record.No ?? index + 1),
      audience,
      document,
      condition,
      timing,
      basis,
      status,
      packageIds: inferPackageIds(input, audience, document, condition, basis),
      ...dueMeta(timing, eventDate),
      ...inferRaci(audience, document, condition),
      requiredEvidence: evidenceFor(document, audience),
    };
  });
}

function submissionScheduleRows(items: SubmissionScheduleItem[]): string[][] {
  return [
    ["No", "제출/확인처", "문서/서식", "제출 패키지", "권장기한", "권장일자", "최종 체크포인트", "R", "A", "C", "I", "필수 증빙", "상태"],
    ...items.map((item) => [
      item.no,
      item.audience,
      item.document,
      item.packageIds.join(" | "),
      item.recommendedDueLabel,
      item.recommendedDueDate || "행사일 입력 시 계산",
      item.finalCheckpoint,
      item.responsible,
      item.accountable,
      item.consulted,
      item.informed,
      item.requiredEvidence,
      item.status,
    ]),
  ];
}

function submissionScheduleMarkdown(input: z.infer<typeof inputSchema>, items: SubmissionScheduleItem[]): string {
  const rows = submissionScheduleRows(items);
  return [
    "# 제출 일정·RACI·증빙 매트릭스",
    "",
    `- 행사명: ${input.eventName}`,
    eventDateValue(input) ? `- 행사일: ${eventDateValue(input)}` : "- 행사일: 미입력",
    "- 기준: T는 행사일 기준, D-day는 행사 당일 기준. 관할기관 최신 서식·접수창구·마감일은 제출 직전 재확인한다.",
    "- 용도: 제출·협의 체크리스트를 실행 일정, 담당 책임, 협의 대상, 보관 증빙으로 정규화한 운영본부용 매트릭스.",
    "",
    `| ${rows[0].join(" | ")} |`,
    `| ${rows[0].map(() => "---").join(" | ")} |`,
    ...rows.slice(1).map((row) => `| ${row.map((cell) => markdownTableCell(cell)).join(" | ")} |`),
  ].filter((item): item is string => Boolean(item)).join("\n");
}

function packageScheduleSummary(items: SubmissionScheduleItem[], packageId: string): string[] {
  const scoped = items.filter((item) => item.packageIds.includes(packageId));
  if (scoped.length === 0) return ["- 해당 패키지에 연결된 제출 일정 없음. 전체 제출 일정·RACI 매트릭스를 확인한다."];
  return scoped.slice(0, 8).map((item) => {
    const due = item.recommendedDueDate ? `${item.recommendedDueLabel} (${item.recommendedDueDate})` : item.recommendedDueLabel;
    return `- ${due}: ${item.document} / R ${item.responsible} / 증빙 ${item.requiredEvidence}`;
  });
}

function coverageSummary(review: AnyRecord, coverageIds: string[]): string[] {
  const coverage = Array.isArray(review.documentCoverageMatrix) ? review.documentCoverageMatrix as AnyRecord[] : [];
  const idSet = new Set(coverageIds);
  const rows = coverage.filter((row) => idSet.has(String(row.documentId ?? "")));
  if (rows.length === 0) return ["- 커버리지 정보 없음"];
  return rows.map((row) => `- ${row.title ?? row.documentId}: ${row.requirement ?? ""}/${row.status ?? ""}${(row.evidence as AnyRecord | undefined)?.line ? ` (line ${(row.evidence as AnyRecord).line})` : ""}`);
}

function hasEvent(input: z.infer<typeof inputSchema>, eventType: string): boolean {
  return (input.eventTypes ?? []).includes(eventType as z.infer<typeof EventTypeSchema>);
}

function buildPackageMarkdown(
  input: z.infer<typeof inputSchema>,
  docs: AnyRecord,
  review: AnyRecord,
  packageMeta: Omit<SubmissionPackage, "markdown">,
  scheduleItems: SubmissionScheduleItem[],
): string {
  const reviewCounts = review.counts as AnyRecord | undefined;
  return [
    `# ${packageMeta.title}`,
    "",
    `- 수신/검토: ${packageMeta.audience}`,
    `- 행사명: ${input.eventName}`,
    eventDateValue(input) ? `- 일자: ${eventDateValue(input)}` : undefined,
    input.location ? `- 장소: ${input.location}` : undefined,
    input.organizer ? `- 주최/주관: ${input.organizer}` : undefined,
    `- 목적: ${packageMeta.description}`,
    `- 공유등급: ${packageMeta.sharingScope} / ${packageMeta.redactionLevel}`,
    `- 자체 검수: ${review.verdict ?? "미실행"} / 점수 ${review.score ?? "미기록"} / finding ${reviewCounts?.total ?? "미기록"}건`,
    "",
    "## 공유범위·민감정보 처리",
    ...packageMeta.redactionNotes.map((note) => `- ${note}`),
    "",
    "## 포함 문서",
    ...packageMeta.documentKeys.map((key) => `- ${documentTitles[key] ?? key}`),
    "",
    "## 문서 커버리지",
    ...coverageSummary(review, packageMeta.coverageIds),
    "",
    "## 제출 일정·RACI",
    ...packageScheduleSummary(scheduleItems, packageMeta.id),
    "",
    "## 제출 전 확인",
    "- 담당기관 최신 서식, 접수 방식, 제출기한, 담당자 연락처는 제출 직전 재확인한다.",
    "- 이 패키지는 실무 검토용 초안이며, 법령·조례·베뉴 승인·관계기관 협의를 대체하지 않는다.",
    "",
    ...packageMeta.documentKeys.map((key) => packageSection(documentTitles[key] ?? key, sanitizeMarkdownForPackage(docs[key], key, packageMeta))),
  ].filter((item): item is string => Boolean(item)).join("\n");
}

function buildSubmissionPackages(
  input: z.infer<typeof inputSchema>,
  docs: AnyRecord,
  review: AnyRecord,
  scheduleItems: SubmissionScheduleItem[],
): SubmissionPackage[] {
  const hasWorker = Boolean(input.setupTeardown || input.temporaryStructures || input.temporaryElectricity || input.workAtHeight || input.heavyObjectHandling || input.hotWork);
  const hasFoodOrLpg = Boolean(input.foodService || input.lpgUse || hasEvent(input, "food_event"));
  const hasPerformance = Boolean(input.performance || hasEvent(input, "performance"));
  const hasPrivacyOrSecurity = Boolean(input.personalDataProcessing || input.vipSecurity || hasEvent(input, "conference") || hasEvent(input, "vip_event"));
  const hasUnhostedCrowd = Boolean(input.unhostedCrowd);
  const packageMetas: Array<Omit<SubmissionPackage, "markdown"> & { include: boolean }> = [
    {
      id: "local_government",
      title: "지자체 제출 패키지",
      audience: input.jurisdiction ?? "관할 지자체",
      description: "옥외행사·지역축제 안전관리계획, 도로점용·교통통제, 관계기관 협의 확인용",
      sharingScope: "public_agency",
      redactionLevel: "summary_only",
      redactionNotes: [
        "법령·조례·안전관리 요약 중심으로 공유",
        "VIP 세부 동선, 개인정보 원자료, 내부 보안 운영 세부는 별도 전용 패키지에서만 공유",
      ],
      fileName: "01-local-government-package.md",
      documentKeys: ["eventSafetyPlan", "crowdFlowPlan", "roadTrafficControlPlan", ...(hasUnhostedCrowd ? ["unhostedCrowdResponsePlan"] : []), ...(hasPerformance ? ["performanceStagePlan"] : []), "submissionChecklist", "operationsRunsheet", "medicalResponsePlan", "fireEvacuationChecklist", "incidentReportTemplate", "visitorSafetyNotices"],
      coverageIds: ["event_safety_plan", "crowd_flow_plan", "road_traffic_control_plan", ...(hasUnhostedCrowd ? ["unhosted_crowd_response_plan"] : []), ...(hasPerformance ? ["performance_stage_execution_plan"] : []), "submission_checklist", "operations_runsheet", "medical_response_plan", "fire_evacuation_checklist", "incident_report_template", "visitor_safety_notices"],
      include: true,
    },
    {
      id: "venue",
      title: "베뉴·현장 시설 제출 패키지",
      audience: input.venueId ?? "현장 시설/전기/방재 담당",
      description: "베뉴 또는 옥외 현장 시설 제약, 하역·전기·방재·부스 운영 승인 확인용",
      sharingScope: "venue_facility",
      redactionLevel: "limited_external",
      redactionNotes: [
        "시설·전기·방재·하역 승인에 필요한 범위로 공유",
        "개인정보/CCTV 세부, VIP/보안검색 세부, 주최자 환불·입장 정책은 제한",
      ],
      fileName: "02-venue-package.md",
      documentKeys: ["eventSafetyPlan", "venueFacilityPlan", "roadTrafficControlPlan", ...(hasUnhostedCrowd ? ["unhostedCrowdResponsePlan"] : []), ...(hasPerformance ? ["performanceStagePlan"] : []), "operationsRunsheet", "fireEvacuationChecklist", "dailySafetyChecklist", "staffAssignment", "emergencyContacts", ...(hasFoodOrLpg ? ["foodLpgChecklist"] : [])],
      coverageIds: ["event_safety_plan", "venue_facility_plan", "road_traffic_control_plan", ...(hasUnhostedCrowd ? ["unhosted_crowd_response_plan"] : []), ...(hasPerformance ? ["performance_stage_execution_plan"] : []), "operations_runsheet", "fire_evacuation_checklist", "daily_safety_checklist", "staff_assignment", "emergency_contacts", ...(hasFoodOrLpg ? ["food_lpg_checklist"] : [])],
      include: true,
    },
    {
      id: "fire_police_medical",
      title: "소방·경찰·의료 협의 패키지",
      audience: "소방서/경찰/119·의료기관",
      description: "인파·동선, 소방·피난, 응급의료, 상황전파 및 현장 통제 협의용",
      sharingScope: "emergency_agency",
      redactionLevel: "summary_only",
      redactionNotes: [
        "인파·피난·응급·상황전파와 현장 통제에 필요한 범위로 공유",
        "개인정보 원자료, VIP 세부 동선, 내부 보안검색 운영 세부는 제한",
      ],
      fileName: "03-fire-police-medical-package.md",
      documentKeys: ["crowdFlowPlan", "roadTrafficControlPlan", ...(hasUnhostedCrowd ? ["unhostedCrowdResponsePlan"] : []), ...(hasPerformance ? ["performanceStagePlan"] : []), "operationsRunsheet", "fireEvacuationChecklist", "medicalResponsePlan", "staffAssignment", "emergencyContacts", "visitorSafetyNotices", "incidentReportTemplate"],
      coverageIds: ["crowd_flow_plan", "road_traffic_control_plan", ...(hasUnhostedCrowd ? ["unhosted_crowd_response_plan"] : []), ...(hasPerformance ? ["performance_stage_execution_plan"] : []), "operations_runsheet", "fire_evacuation_checklist", "medical_response_plan", "staff_assignment", "emergency_contacts", "visitor_safety_notices", "incident_report_template"],
      include: true,
    },
    {
      id: "worker_contractor",
      title: "협력사 작업자 안전 패키지",
      audience: "시공/하역/전기/무대/부스 협력사",
      description: "설치·철거 작업자 안전, 작업중지 기준, 베뉴 시설 제약, 전기·화기·하역 작업 확인용",
      sharingScope: "contractor",
      redactionLevel: "limited_external",
      redactionNotes: [
        "작업계획, 작업중지 기준, 하역·전기·화기·소방통로 확인에 필요한 범위로 공유",
        "관계기관 직접 연락망, 개인정보/CCTV, VIP/보안 세부는 운영본부 승인 없이 공유하지 않음",
      ],
      fileName: "04-worker-contractor-package.md",
      documentKeys: ["workerSafetyPlan", ...(hasPerformance ? ["performanceStagePlan"] : []), "venueFacilityPlan", "operationsRunsheet", "fireEvacuationChecklist", "dailySafetyChecklist", "emergencyContacts", ...(hasFoodOrLpg ? ["foodLpgChecklist"] : [])],
      coverageIds: ["worker_safety_plan", ...(hasPerformance ? ["performance_stage_execution_plan"] : []), "venue_facility_plan", "operations_runsheet", "fire_evacuation_checklist", "daily_safety_checklist", "emergency_contacts", ...(hasFoodOrLpg ? ["food_lpg_checklist"] : [])],
      include: hasWorker,
    },
    {
      id: "privacy_security",
      title: "개인정보·보안 제출 패키지",
      audience: "개인정보보호책임자/보안·경비 담당",
      description: "등록·QR·CCTV·촬영·VIP 보안검색·민간경비 운영 확인용",
      sharingScope: "restricted_internal",
      redactionLevel: "none",
      redactionNotes: [
        "개인정보/CCTV/VIP/경비업 세부 검토 전용",
        "외부 공유 전 개인정보보호책임자와 보안책임자의 재검토 필요",
      ],
      fileName: "05-privacy-security-package.md",
      documentKeys: ["privacyCctvChecklist", "securityAccessPlan", "staffAssignment", "emergencyContacts", "incidentReportTemplate"],
      coverageIds: ["privacy_cctv_checklist", "security_access_plan", "staff_assignment", "emergency_contacts", "incident_report_template"],
      include: hasPrivacyOrSecurity,
    },
  ];
  return packageMetas
    .filter((item) => item.include)
    .map((item) => ({
      ...item,
      markdown: buildPackageMarkdown(input, docs, review, item, scheduleItems),
    }));
}

async function writeXlsx(
  documentBundle: AnyRecord,
  input: z.infer<typeof inputSchema>,
  filePath: string,
  noticeBundle?: VisitorNoticeBundle,
  review?: AnyRecord,
  submissionPackages: SubmissionPackage[] = [],
  submissionSchedule: SubmissionScheduleItem[] = [],
): Promise<void> {
  const sheets: XlsxSheet[] = [];
  const overview: XlsxCell[][] = [["Field", "Value"]];
  for (const [key, value] of Object.entries(input)) {
    overview.push([key, Array.isArray(value) ? value.join(", ") : String(value ?? "")]);
  }
  sheets.push({ name: "Overview", rows: overview });

  addRowsSheet(sheets, "Venue Facility", bulletRows(String(documentBundle.venueFacilityPlan ?? ""), "베뉴 시설"));
  addRowsSheet(sheets, "Road Traffic", bulletRows(String(documentBundle.roadTrafficControlPlan ?? ""), "도로·교통"));
  addRowsSheet(sheets, "Unhosted Crowd", bulletRows(String(documentBundle.unhostedCrowdResponsePlan ?? ""), "무주최 다중운집"));
  addRowsSheet(sheets, "Performance Stage", bulletRows(String(documentBundle.performanceStagePlan ?? ""), "공연·무대"));
  const performanceStageRows = tableRows(String(documentBundle.performanceStagePlan ?? ""));
  if (performanceStageRows.length > 0) addTableSheet(sheets, "Stage Exec", performanceStageRows);
  addRowsSheet(sheets, "Fire Evacuation", bulletRows(String(documentBundle.fireEvacuationChecklist ?? ""), "소방·피난"));
  addRowsSheet(sheets, "Food LPG", bulletRows(String(documentBundle.foodLpgChecklist ?? ""), "식음료·LPG"));
  const foodLpgExecutionRows = tableRows(String(documentBundle.foodLpgChecklist ?? ""));
  if (foodLpgExecutionRows.length > 0) addTableSheet(sheets, "Food LPG Exec", foodLpgExecutionRows);
  addRowsSheet(sheets, "Privacy CCTV", bulletRows(String(documentBundle.privacyCctvChecklist ?? ""), "개인정보·CCTV"));
  addRowsSheet(sheets, "Security Access", bulletRows(String(documentBundle.securityAccessPlan ?? ""), "출입통제·보안"));
  addRowsSheet(sheets, "Medical AED", bulletRows(String(documentBundle.medicalResponsePlan ?? ""), "응급의료·AED"));
  addRowsSheet(sheets, "Daily Safety", bulletRows(String(documentBundle.dailySafetyChecklist ?? ""), "일일 안전점검"));
  const operationsRows = tableRows(String(documentBundle.operationsRunsheet ?? ""));
  if (operationsRows.length > 0) addTableSheet(sheets, "Operations Runsheet", operationsRows);

  const submissionRows = tableRows(String(documentBundle.submissionChecklist ?? ""));
  if (submissionRows.length > 0) addTableSheet(sheets, "Submission Checklist", submissionRows);

  const staffRows = tableRows(String(documentBundle.staffAssignment ?? ""));
  if (staffRows.length > 0) addTableSheet(sheets, "Staff Assignment", staffRows);

  const contactRows = bulletRows(String(documentBundle.emergencyContacts ?? ""), "비상연락망");
  addRowsSheet(sheets, "Emergency Contacts", contactRows);
  if (noticeBundle) addVisitorNoticeSheet(sheets, noticeBundle);
  if (review) addReviewSheets(sheets, review);
  if (submissionPackages.length > 0) addSubmissionPackageSheet(sheets, submissionPackages);
  if (submissionSchedule.length > 0) addSubmissionScheduleSheet(sheets, submissionSchedule);

  writeXlsxFile(filePath, sheets);
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const generated = await generateMiceSafetyPlanTool.handler(input);
  const structured = generated.structuredContent ?? {};
  const planMarkdown = String(structured.planMarkdown ?? generated.content[0]?.text ?? "");
  const reviewResult = await reviewMiceSafetyPlanTool.handler({
    ...input,
    planMarkdown,
  });
  const review = (reviewResult.structuredContent ?? {}) as AnyRecord;
  const reviewMarkdown = String(reviewResult.content[0]?.text ?? "");
  const documentBundle = (structured.documentBundle ?? {}) as AnyRecord;
  const noticeBundle = buildDefaultMiceVisitorNoticeBundle(input);
  const exportDocumentBundle: AnyRecord = {
    ...documentBundle,
    visitorSafetyNotices: noticeBundle.markdown,
  };
  const submissionSchedule = buildSubmissionSchedule(input, exportDocumentBundle.submissionChecklist);
  const submissionPackages = buildSubmissionPackages(input, exportDocumentBundle, review, submissionSchedule);
  const bundleDir = input.outputDir ?? join(defaultRoot(), "plan-bundles", `${safeName(input.eventName)}-${nowStamp()}`);
  mkdirSync(bundleDir, { recursive: true });

  const files: string[] = [];
  const fullPlanPath = join(bundleDir, "00-full-safety-plan.md");
  writeFileSync(fullPlanPath, `${planMarkdown}\n`);
  files.push(fullPlanPath);

  const docxPath = join(bundleDir, "safety-plan.docx");
  await writeDocx(planMarkdown, docxPath);
  files.push(docxPath);

  for (const [key, fileName] of Object.entries(documentFileNames)) {
    const value = exportDocumentBundle[key];
    if (typeof value !== "string" || value.trim().length === 0) continue;
    const filePath = join(bundleDir, fileName);
    writeFileSync(filePath, `${value}\n`);
    files.push(filePath);
  }

  const checklistSources = [
    ["venue-facility-plan.csv", "베뉴 시설", String(documentBundle.venueFacilityPlan ?? "")],
    ["road-traffic-control-plan.csv", "도로·교통", String(documentBundle.roadTrafficControlPlan ?? "")],
    ["unhosted-crowd-response-plan.csv", "무주최 다중운집", String(documentBundle.unhostedCrowdResponsePlan ?? "")],
    ["performance-stage-execution-plan.csv", "공연·무대", String(documentBundle.performanceStagePlan ?? "")],
    ["fire-evacuation-checklist.csv", "소방·피난", String(documentBundle.fireEvacuationChecklist ?? "")],
    ["food-lpg-checklist.csv", "식음료·LPG", String(documentBundle.foodLpgChecklist ?? "")],
    ["privacy-cctv-checklist.csv", "개인정보·CCTV", String(documentBundle.privacyCctvChecklist ?? "")],
    ["security-access-plan.csv", "출입통제·보안", String(documentBundle.securityAccessPlan ?? "")],
    ["medical-response-plan.csv", "응급의료·AED", String(documentBundle.medicalResponsePlan ?? "")],
    ["daily-safety-checklist.csv", "일일 안전점검", String(documentBundle.dailySafetyChecklist ?? "")],
    ["submission-checklist.csv", "제출·협의", String(documentBundle.submissionChecklist ?? "")],
    ["operations-runsheet.csv", "현장 운영 런시트", String(documentBundle.operationsRunsheet ?? "")],
  ];
  for (const [fileName, title, markdown] of checklistSources) {
    if (!markdown.trim()) continue;
    const filePath = join(bundleDir, fileName);
    const csv = fileName === "submission-checklist.csv" || fileName === "operations-runsheet.csv" ? tableToCsv(markdown) : bulletsToCsv(markdown, title);
    writeFileSync(filePath, `${csv}\n`);
    files.push(filePath);
  }

  const foodLpgExecutionCsv = tableToCsv(String(documentBundle.foodLpgChecklist ?? ""));
  if (foodLpgExecutionCsv.trim()) {
    const filePath = join(bundleDir, "food-lpg-execution.csv");
    writeFileSync(filePath, `${foodLpgExecutionCsv}\n`);
    files.push(filePath);
  }
  const performanceStageExecutionCsv = tableToCsv(String(documentBundle.performanceStagePlan ?? ""));
  if (performanceStageExecutionCsv.trim()) {
    const filePath = join(bundleDir, "performance-stage-execution.csv");
    writeFileSync(filePath, `${performanceStageExecutionCsv}\n`);
    files.push(filePath);
  }

  const visitorNoticesCsvPath = join(bundleDir, "visitor-safety-notices.csv");
  const visitorNoticeRows = [
    ["Scenario", "Template ID", "Language", "Notice", "Checkpoints"],
    ...noticeBundle.notices.flatMap((notice) => noticeBundle.languages
      .map((language) => [
        notice.scenario,
        notice.id,
        language,
        notice.localizations[language] ?? "",
        notice.checkpoints.join(" | "),
      ])
      .filter((row) => row[3])),
  ];
  writeFileSync(visitorNoticesCsvPath, `${visitorNoticeRows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`);
  files.push(visitorNoticesCsvPath);

  const reviewSummaryPath = join(bundleDir, "17-review-summary.md");
  writeFileSync(reviewSummaryPath, `${reviewMarkdown}\n`);
  files.push(reviewSummaryPath);

  const reviewCoveragePath = join(bundleDir, "review-coverage-matrix.csv");
  const coverageRows = [
    ["Document ID", "Title", "Requirement", "Status", "Applies When", "Evidence Line"],
    ...(Array.isArray(review.documentCoverageMatrix) ? review.documentCoverageMatrix as AnyRecord[] : []).map((row) => [
      String(row.documentId ?? ""),
      String(row.title ?? ""),
      String(row.requirement ?? ""),
      String(row.status ?? ""),
      String(row.appliesWhen ?? ""),
      String((row.evidence as AnyRecord | undefined)?.line ?? ""),
    ]),
  ];
  writeFileSync(reviewCoveragePath, `${coverageRows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`);
  files.push(reviewCoveragePath);

  const reviewFindingsPath = join(bundleDir, "review-findings.csv");
  const findingRows = [
    ["Requirement ID", "Severity", "Category", "Message", "Recommendation", "Evidence Line"],
    ...(Array.isArray(review.findings) ? review.findings as AnyRecord[] : []).map((finding) => [
      String(finding.requirementId ?? ""),
      String(finding.severity ?? ""),
      String(finding.category ?? ""),
      String(finding.message ?? ""),
      String(finding.recommendation ?? ""),
      String((finding.evidence as AnyRecord | undefined)?.line ?? ""),
    ]),
  ];
  writeFileSync(reviewFindingsPath, `${findingRows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`);
  files.push(reviewFindingsPath);

  const submissionSchedulePath = join(bundleDir, "18-submission-raci-calendar.md");
  writeFileSync(submissionSchedulePath, `${submissionScheduleMarkdown(input, submissionSchedule)}\n`);
  files.push(submissionSchedulePath);

  const submissionScheduleCsvPath = join(bundleDir, "submission-raci-calendar.csv");
  const submissionScheduleCsv = submissionScheduleRows(submissionSchedule)
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
  writeFileSync(submissionScheduleCsvPath, `${submissionScheduleCsv}\n`);
  files.push(submissionScheduleCsvPath);

  const packageDir = join(bundleDir, "submission-packages");
  mkdirSync(packageDir, { recursive: true });
  const packageIndexRows = [
    ["Package ID", "Title", "Audience", "Sharing Scope", "Redaction Level", "File", "Documents", "Redaction Notes"],
    ...submissionPackages.map((item) => [
      item.id,
      item.title,
      item.audience,
      item.sharingScope,
      item.redactionLevel,
      item.fileName,
      item.documentKeys.map((key) => documentTitles[key] ?? key).join(" | "),
      item.redactionNotes.join(" | "),
    ]),
  ];
  const packageIndexPath = join(packageDir, "package-index.csv");
  writeFileSync(packageIndexPath, `${packageIndexRows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`);
  files.push(packageIndexPath);

  const packageManifest = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    eventName: input.eventName,
    packages: submissionPackages.map((item) => ({
      id: item.id,
      title: item.title,
      audience: item.audience,
      sharingScope: item.sharingScope,
      redactionLevel: item.redactionLevel,
      redactionNotes: item.redactionNotes,
      fileName: item.fileName,
      documents: item.documentKeys.map((key) => documentTitles[key] ?? key),
      coverageIds: item.coverageIds,
      scheduleItemNos: submissionSchedule.filter((scheduleItem) => scheduleItem.packageIds.includes(item.id)).map((scheduleItem) => scheduleItem.no),
    })),
  };
  const packageManifestPath = join(packageDir, "manifest.json");
  writeFileSync(packageManifestPath, `${JSON.stringify(packageManifest, null, 2)}\n`);
  files.push(packageManifestPath);

  for (const item of submissionPackages) {
    const filePath = join(packageDir, item.fileName);
    writeFileSync(filePath, `${item.markdown}\n`);
    files.push(filePath);
  }

  const xlsxPath = join(bundleDir, "safety-checklists.xlsx");
  await writeXlsx(exportDocumentBundle, input, xlsxPath, noticeBundle, review, submissionPackages, submissionSchedule);
  files.push(xlsxPath);

  const operationsRunsheetCount = Math.max(0, tableRows(String(exportDocumentBundle.operationsRunsheet ?? "")).length - 1);
  const manifestPath = join(bundleDir, "manifest.json");
  const manifestFiles = [...files, manifestPath];
  const manifest = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    input,
    bundleDir,
    files: manifestFiles,
    visitorNoticeCount: noticeBundle.notices.length,
    visitorNoticeLanguages: noticeBundle.languages,
    operationsRunsheetCount,
    reviewVerdict: review.verdict,
    reviewScore: review.score,
    reviewFindingCount: (review.counts as AnyRecord | undefined)?.total,
    submissionScheduleCount: submissionSchedule.length,
    submissionPackageCount: submissionPackages.length,
    submissionSchedule: submissionSchedule.map((item) => ({
      no: item.no,
      audience: item.audience,
      document: item.document,
      packageIds: item.packageIds,
      recommendedDueLabel: item.recommendedDueLabel,
      recommendedDueDate: item.recommendedDueDate,
      finalCheckpoint: item.finalCheckpoint,
      responsible: item.responsible,
      accountable: item.accountable,
      requiredEvidence: item.requiredEvidence,
      status: item.status,
    })),
    submissionPackages: submissionPackages.map((item) => ({
      id: item.id,
      title: item.title,
      audience: item.audience,
      sharingScope: item.sharingScope,
      redactionLevel: item.redactionLevel,
      redactionNotes: item.redactionNotes,
      fileName: item.fileName,
      documents: item.documentKeys,
    })),
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  files.push(manifestPath);

  const text = [
    "# MICE 안전계획 파일 묶음 export",
    `- bundleDir: ${bundleDir}`,
    ...files.map((file) => `- ${file}`),
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      input,
      bundleDir,
      files,
      manifest,
      visitorNoticeCount: noticeBundle.notices.length,
      visitorNoticeLanguages: noticeBundle.languages,
      operationsRunsheetCount,
      review: {
        verdict: review.verdict,
        score: review.score,
        grade: review.grade,
        counts: review.counts,
        documentCoverageMatrix: review.documentCoverageMatrix,
      },
      submissionSchedule,
      submissionPackages: submissionPackages.map((item) => ({
        id: item.id,
        title: item.title,
        audience: item.audience,
        sharingScope: item.sharingScope,
        redactionLevel: item.redactionLevel,
        redactionNotes: item.redactionNotes,
        fileName: item.fileName,
        documentKeys: item.documentKeys,
      })),
      _meta: COMMON_RESPONSE_META,
    },
  };
}

export const exportMiceSafetyPlanBundleTool: ToolDefinition = {
  name: "export_mice_safety_plan_bundle",
  title: "MICE 안전계획 파일 묶음 export",
  description:
    "generate_mice_safety_plan 결과를 로컬 디렉터리에 Markdown 문서 묶음, CSV 체크리스트, 도로·교통 실행계획, 무주최 다중운집 대응계획, 현장 운영 런시트, 다국어 방문객 안내문, 자체 검수 요약, docx/xlsx로 저장합니다.",
  inputSchema,
  handler,
};
