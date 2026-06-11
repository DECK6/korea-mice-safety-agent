import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { Paragraph as DocxParagraph } from "docx";
import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import { baseMiceEventInputSchema, type MiceEventType } from "../lib/mice-event-input-schema.js";
import { objectRows, writeXlsxFile, type XlsxCell, type XlsxSheet } from "../lib/simple-xlsx.js";
import {
  buildDefaultMiceVisitorNoticeBundle,
  type VisitorNoticeBundle,
} from "../lib/mice-visitor-notices.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import { VERSION } from "../version.js";
import { generateMiceSafetyPlanTool } from "./generate-mice-safety-plan.js";
import { reviewMiceSafetyPlanTool } from "./review-mice-safety-plan.js";

const inputSchema = baseMiceEventInputSchema.extend({
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
  publicApiOperationalEvidence: "22-public-api-operational-evidence.md",
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
  publicApiOperationalEvidence: "공공 API 운영 증거",
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
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (neutralized === value && !/[",\n]/.test(value)) return value;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  writeFileSync(filePath, buffer, { flag: "wx" });
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

function recordArray(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value as AnyRecord[] : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function yesNo(value: boolean): string {
  return value ? "적용" : "비적용";
}

function formatCrowd(value: unknown): string {
  if (typeof value !== "number") return "미입력";
  return `${value.toLocaleString("ko-KR")}명`;
}

function eventDateLabelForBrief(input: { date?: string; eventDate?: string }): string {
  return input.date ?? input.eventDate ?? "미입력";
}

function compactList(items: string[], fallback: string, limit = 8): string[] {
  const unique = Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
  if (unique.length === 0) return [`- ${fallback}`];
  return unique.slice(0, limit).map((item) => `- ${item}`);
}

function confidenceLabel(value: string): string {
  switch (value) {
    case "official_law_go_offline_snapshot":
      return "법제처 오프라인 스냅샷";
    case "official_law_go_verified_article":
      return "법제처 조문 검증";
    case "needs_review":
      return "원문 재확인 필요";
    case "summary_only":
      return "요약 전용";
    default:
      return value || "미표시";
  }
}

function hasEventType(input: AnyRecord, eventType: string): boolean {
  return Array.isArray(input.eventTypes) && input.eventTypes.includes(eventType);
}

function inputFlagSummary(input: AnyRecord): string[] {
  const flags: string[] = [];
  if (input.venueId) flags.push(`베뉴 규정: ${input.venueId}`);
  if (input.outdoor || input.outdoorEvent || hasEventType(input, "festival") || hasEventType(input, "outdoor_event")) flags.push("옥외/축제");
  if (input.roadUse) flags.push("도로점용/교통통제");
  if (input.outdoorAdvertising) flags.push("옥외광고물/외부 안내표지");
  if (input.performance || hasEventType(input, "performance")) flags.push("공연/무대");
  if (input.foodService || hasEventType(input, "food_event")) flags.push("식음료");
  if (input.lpgUse) flags.push("LPG/가스");
  if (input.temporaryStructures) flags.push("임시구조물");
  if (input.temporaryElectricity) flags.push("임시전기");
  if (input.setupTeardown) flags.push("설치·철거");
  if (input.workAtHeight) flags.push("고소작업");
  if (input.heavyObjectHandling) flags.push("중량물/하역");
  if (input.personalDataProcessing) flags.push("개인정보/CCTV");
  if (input.vipSecurity || hasEventType(input, "vip_event")) flags.push("VIP/보안");
  if (input.unhostedCrowd) flags.push("무주최 다중운집");
  return flags;
}

function localOrdinanceLabel(item: AnyRecord): string {
  const jurisdiction = String(item.jurisdiction ?? "").trim();
  const name = String(item.name ?? item.ordinanceName ?? "조례").trim();
  if (!jurisdiction || name.startsWith(jurisdiction)) return name;
  return `${jurisdiction} ${name}`;
}

function ordinancePriorityForInput(item: AnyRecord, input: AnyRecord): number {
  const target = String(input.jurisdiction ?? "").trim();
  if (!target) return Number(item.priorityScore ?? 0);
  const jurisdiction = String(item.jurisdiction ?? "").trim();
  const matchedHints = stringArray(item.matchedJurisdictionHints);
  const [province, cityOrDistrict] = target.split(/\s+/);
  let score = 0;
  if (jurisdiction === target) score += 1000;
  if (matchedHints.includes(target)) score += 800;
  if (cityOrDistrict && jurisdiction.includes(cityOrDistrict)) score += 600;
  if (province && jurisdiction === province) score += 500;
  if (province && jurisdiction.startsWith(province)) score += 200;
  if (String(item.priorityBand ?? "") === "primary") score += 50;
  if (String(item.priorityBand ?? "") === "secondary") score += 20;
  score += Math.min(Number(item.priorityScore ?? 0), 99);
  return score;
}

function primaryLocalOrdinancesForBrief(items: AnyRecord[], input: AnyRecord): AnyRecord[] {
  const target = String(input.jurisdiction ?? "").trim();
  const [province] = target.split(/\s+/);
  const hasOutdoor = Boolean(input.outdoor || input.outdoorEvent || hasEventType(input, "festival") || hasEventType(input, "outdoor_event"));
  const hasRoadUse = input.roadUse === true;
  const allowedByInput = (item: AnyRecord): boolean => {
    const category = String(item.categoryId ?? item.category ?? "");
    if (["outdoor_event_safety", "regional_festival_safety"].includes(category)) return hasOutdoor;
    if (category === "road_occupancy") return hasRoadUse;
    if (category === "outdoor_advertising") return hasOutdoor || hasRoadUse;
    return true;
  };
  const ranked = items
    .filter(allowedByInput)
    .map((item) => ({ item, score: ordinancePriorityForInput(item, input) }))
    .filter(({ item, score }) => {
      if (!target) return true;
      const jurisdiction = String(item.jurisdiction ?? "");
      return score >= 500 || jurisdiction === province || jurisdiction === target;
    })
    .sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const unique: AnyRecord[] = [];
  for (const { item } of ranked) {
    const key = `${String(item.jurisdiction ?? "")}:${String(item.name ?? item.ordinanceName ?? "")}:${String(item.categoryId ?? item.category ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function actionRowsFromSchedule(items: SubmissionScheduleItem[]): string[][] {
  return items.map((item) => [
    item.audience,
    item.document,
    item.condition,
    item.recommendedDueDate ? `${item.recommendedDueLabel} / ${item.recommendedDueDate}` : item.recommendedDueLabel,
    item.requiredEvidence,
  ]);
}

function executiveActionPriority(item: SubmissionScheduleItem): number {
  const document = item.document;
  const audience = item.audience;
  const text = `${audience} ${document} ${item.condition} ${item.basis}`;
  if (/도로점용허가|교통소통대책|통행금지|차량 운행 제한/.test(document)) return 100;
  if (/옥외행사|지역축제/.test(document)) return 95;
  if (/LPG|가스|식품|위생|푸드|케이터링|시식/.test(document)) return 92;
  if (/공연 재해대처|공연·무대 실행|무대 실행계획/.test(document)) return 90;
  if (/설치·철거 작업자|작업자 안전계획|작업계획서/.test(document)) return 88;
  if (/소방|피난|방재|위험물/.test(document)) return 86;
  if (/가설건축물|피난안전|임시사용/.test(document)) return 82;
  if (/응급의료|AED|구급|이송/.test(document)) return 78;
  if (/베뉴 운영|부스 시공|반입제한|제출 안전서류/.test(text)) return 72;
  if (/개인정보|CCTV|QR|출입증|위탁|접속기록/.test(document)) return 70;
  if (/경비|보안|VIP/.test(document)) return 68;
  if (/옥외광고|현수막|배너|안내판|전광/.test(document)) return 55;
  return 50;
}

function selectExecutiveActions(items: SubmissionScheduleItem[], limit = 8): SubmissionScheduleItem[] {
  return [...items]
    .map((item, index) => ({ item, index, priority: executiveActionPriority(item) }))
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .slice(0, limit)
    .map(({ item }) => item);
}

function buildDecisionRows(input: AnyRecord): string[][] {
  const hasOutdoor = Boolean(input.outdoor || input.outdoorEvent || hasEventType(input, "festival") || hasEventType(input, "outdoor_event"));
  const hasPerformance = Boolean(input.performance || hasEventType(input, "performance"));
  const hasFood = Boolean(input.foodService || hasEventType(input, "food_event"));
  const hasWorker = Boolean(input.setupTeardown || input.temporaryStructures || input.temporaryElectricity || input.workAtHeight || input.heavyObjectHandling || input.hotWork);
  const hasPrivacy = Boolean(input.personalDataProcessing || hasEventType(input, "conference") || hasEventType(input, "vip_event"));
  const hasOutdoorAdvertising = input.outdoorAdvertising === true;
  return [
    ["지자체 옥외행사/지역축제 안전관리", yesNo(hasOutdoor), hasOutdoor ? "옥외·축제 조건이 있어 관할 지자체 안전관리계획 제출/협의 후보" : "실내 행사만 입력됨"],
    ["도로점용/교통통제", input.roadUse ? "필수" : hasOutdoor ? "조건부 확인" : "비적용", input.roadUse ? "도로·보도·광장 점용 또는 통행 제한 입력됨" : hasOutdoor ? "옥외행사라 외부 대기열·승하차·보도 점용 여부 확인 필요" : "도로점용 조건 없음"],
    ["옥외광고물/외부 안내표지", hasOutdoorAdvertising ? "적용" : hasOutdoor ? "조건부 확인" : "비적용", hasOutdoorAdvertising ? "현수막·배너·지주형 표시물·전광류 등 외부 안내물 설치 조건 입력됨" : hasOutdoor ? "옥외 안내물 설치 여부가 미확정이면 허가/신고가 아니라 확인후보로 유지" : "옥외 광고물 조건 없음"],
    ["공연법/공연 재해대처계획", yesNo(hasPerformance), hasPerformance ? "공연·무대·스탠딩/무대장치 조건 입력됨" : "공연 조건 없음. 필수 적용하지 않음"],
    ["식품위생/LPG", hasFood || input.lpgUse ? "적용" : "비적용", hasFood || input.lpgUse ? "식음료·LPG 조건 입력됨" : "식음료·LPG 조건 없음. 필수 적용하지 않음"],
    ["설치·철거 작업자 안전계획", yesNo(hasWorker), hasWorker ? "부스·무대·전기·하역·고소·중량물 작업 조건 입력됨" : "설치·철거 위험 조건 없음. 필수 적용하지 않음"],
    ["개인정보/CCTV", yesNo(hasPrivacy), hasPrivacy ? "등록·QR·CCTV·컨벤션/VIP 조건으로 고지·위탁·접근권한 점검 필요" : "개인정보 처리 조건 없음"],
  ];
}

function buildConditionalRows(input: AnyRecord): string[][] {
  const hasOutdoor = Boolean(input.outdoor || input.outdoorEvent || hasEventType(input, "festival") || hasEventType(input, "outdoor_event"));
  const hasFood = Boolean(input.foodService || input.lpgUse || hasEventType(input, "food_event"));
  const hasPrivacy = Boolean(input.personalDataProcessing || hasEventType(input, "conference") || hasEventType(input, "vip_event"));
  const hasWorker = Boolean(input.setupTeardown || input.temporaryStructures || input.temporaryElectricity || input.workAtHeight || input.heavyObjectHandling || input.hotWork);
  const rows: string[][] = [];
  if (hasOutdoor && input.roadUse !== true) {
    rows.push(["도로점용/교통통제", "보도·차도·광장 점용, 차 없는 거리, 퍼레이드, 승하차장 통제가 확정될 때 제출 액션으로 전환", "통제구간 도면, 경찰·도로관리청 회신, 비상차량 접근로"]);
  }
  if (hasOutdoor && input.outdoorAdvertising !== true) {
    rows.push(["옥외광고물/안내표지", "현수막·배너·지주형 표시물·전광류 설치가 확정될 때 허가/신고 후보로 전환", "설치 위치·규격·수량, 고정방식, 베뉴/지자체 승인"]);
  }
  if (!hasFood) {
    rows.push(["식음료/LPG", "푸드트럭, 시식, 케이터링, LPG 조리가 추가될 때만 식품위생/LPG 패키지로 전환", "입점업체 목록, 조리 방식, 가스 사용 여부"]);
  }
  if (!hasPrivacy) {
    rows.push(["개인정보/CCTV", "QR 등록, 출입증, 앱 신고, 촬영·CCTV 운영이 확정될 때만 개인정보 패키지로 전환", "수집항목, 위탁사, 촬영 고지, 보관·파기 기준"]);
  }
  if (!hasWorker) {
    rows.push(["설치·철거 작업자 안전", "부스·무대·전기·하역·고소·중량물 작업이 생길 때만 작업자 안전계획 필수 전환", "작업 범위, 협력사, 작업시간, 장비·PPE"]);
  }
  return rows.slice(0, 5);
}

function buildRiskRows(input: AnyRecord, hazards: AnyRecord[]): string[][] {
  const evidenceByHazard: Record<string, string> = {
    crowd_density_high: "구역별 수용인원표, 피크시간 인원계수 로그, 밀집 단계별 방송·통제 기록",
    ingress_egress_bottleneck: "게이트 처리량 산정표, 대기열 배치도, 피크 전·후 현장 사진",
    blocked_evacuation_route: "개장 전·피크 전 비상구/소화전/피난통로 사진, 점검자 서명표",
    temporary_structure_collapse: "베뉴 승인서, 구조검토/설치확인서, 설치 완료 사진",
    temporary_electrical_fire_shock: "분전반·누전차단기 점검표, 케이블 보호 사진, 전기 작업자 확인",
    worker_fall_height: "작업계획서, TBM 기록, PPE 착용 사진, 작업구역 통제 사진",
    heavy_object_handling: "중량물 작업계획서, 장비 점검표, 신호수 배치 사진",
    fire_hazard_hot_work_lpg: "화기/LPG 반입 승인, 소화기 배치 사진, 누출·차단 점검표",
    food_poisoning: "영업신고/위생점검표, 보관온도 기록, 조리구역 사진",
    medical_emergency: "AED 점검표, 의료부스 위치도, 이송병원·119 연락 기록",
    weather_outdoor_event: "기상 모니터링 로그, 풍속·호우 중지 기준, 구조물 보강 확인",
    personal_data_cctv_privacy: "개인정보 처리 고지, 위탁계약, CCTV 안내문, 접근권한 점검 기록",
    security_access_control_gap: "경비 배치표, 출입통제 구역도, 보안검색 절차 기록",
    unhosted_crowd_governance_gap: "공동대응 연락망, 상황 단계별 의사결정 로그, 안내방송·문자 기록",
  };
  const priorityIds = [
    "crowd_density_high",
    "ingress_egress_bottleneck",
    "blocked_evacuation_route",
    "temporary_structure_collapse",
    "temporary_electrical_fire_shock",
    "worker_fall_height",
    "heavy_object_handling",
    "fire_hazard_hot_work_lpg",
    "food_poisoning",
    "medical_emergency",
    "weather_outdoor_event",
    "personal_data_cctv_privacy",
    "security_access_control_gap",
    "unhosted_crowd_governance_gap",
  ];
  const byId = new Map(hazards.map((hazard) => [String(hazard.id ?? ""), hazard]));
  const rows = priorityIds
    .map((id) => byId.get(id))
    .filter((hazard): hazard is AnyRecord => Boolean(hazard))
    .slice(0, 7)
    .map((hazard) => {
      const controls = stringArray(hazard.controls);
      const hazardId = String(hazard.id ?? "");
      return [
        String(hazard.label ?? hazard.id ?? "위험요인"),
        String(hazard.riskLevel ?? "확인"),
        controls[0] ?? "현장 통제대책 지정 필요",
        evidenceByHazard[hazardId] ?? "점검표, 사진, 담당자 서명, 관할·베뉴 확인 기록",
      ];
    });
  if (rows.length > 0) return rows;
  return [[
    input.expectedCrowd ? "인파·동선 기본 리스크" : "행사 기본 리스크",
    "확인",
    "예상 인원, 구역별 수용능력, 피난동선, 응급동선을 현장 도면으로 재확인",
    "관할기관·베뉴·운영본부 확인 기록 보관",
  ]];
}

function buildExecutiveReport(options: {
  input: AnyRecord;
  structured: AnyRecord;
  review: AnyRecord;
  submissionSchedule: SubmissionScheduleItem[];
  submissionPackages: SubmissionPackage[];
}): string {
  const { input, structured, review, submissionSchedule, submissionPackages } = options;
  const applicability = (structured.applicability ?? {}) as AnyRecord;
  const hazards = recordArray(applicability.hazards);
  const venueRules = recordArray(applicability.venueRules);
  const localOrdinances = recordArray(applicability.localOrdinances);
  const primaryLocalOrdinances = primaryLocalOrdinancesForBrief(localOrdinances, input);
  const decisionRows = buildDecisionRows(input);
  const conditionalRows = buildConditionalRows(input);
  const riskRows = buildRiskRows(input, hazards);
  const urgentActionRows = actionRowsFromSchedule(selectExecutiveActions(submissionSchedule));
  const packageRows = submissionPackages.map((item) => [
    item.title,
    item.audience,
    item.fileName,
    item.redactionLevel,
  ]);
  const sourceConfidence = localOrdinances
    .map((item) => String(item.sourceConfidence ?? ""))
    .filter(Boolean);
  const sourceConfidenceLabels = Array.from(new Set(sourceConfidence.map(confidenceLabel)));
  const reviewCounts = review.counts as AnyRecord | undefined;
  const reviewFindingCount = Number(reviewCounts?.total ?? 0);
  const reviewStatus = review.verdict === "needs_revision"
    ? "수정 필요"
    : review.verdict === "usable_with_review"
      ? "조건부 검토 가능"
      : review.verdict === "usable"
        ? "초안 검토 가능"
        : "미검수";

  return [
    `# ${input.eventName ?? "행사명 미정"} 핵심 안전 브리프`,
    "",
    "> 먼저 읽는 요약 보고서입니다. 법령 조항 원문과 체크리스트는 뒤 파일에 두고, 여기서는 현장 의사결정과 제출 액션만 요약합니다.",
    "",
    "## 결론",
    `- 초안 상태: ${reviewStatus} (자동 커버리지 검수 finding ${reviewFindingCount}건)`,
    "- 자동 검수는 법적 적합성 점수가 아니라 입력 조건 대비 문서·조건 커버리지 점검입니다.",
    `- 행사일/장소: ${eventDateLabelForBrief(input)} / ${input.location ?? "미입력"}`,
    `- 관할/베뉴: ${input.jurisdiction ?? "미입력"} / ${input.venueId ?? "베뉴 미지정"}`,
    `- 예상 인원: ${formatCrowd(input.expectedCrowd)}${typeof input.expectedCrowd === "number" ? " (공개자료 미확인 시 안전계획용 가정값)" : ""}`,
    `- 입력 조건: ${inputFlagSummary(input).join(", ") || "특이 조건 미입력"}`,
    "",
    "## 운영자가 먼저 결정할 것",
    "- 관할기관 제출 대상과 제출기한을 실제 접수창구 기준으로 확정한다.",
    "- 피크 시간대, 병목 구역, 퇴장 동선, 비상차량 접근로를 한 장 도면으로 확정한다.",
    "- 안전총괄, 구역장, 의료, 시설·전기, 보안, 교통 담당의 현장 의사결정 권한을 문서에 적는다.",
    "- 행사 중지, 입장 제한, 현 위치 대기, 우회 안내, 대피개시 기준을 운영본부가 사전 승인한다.",
    "- 법령·조례 적용 여부는 자동 후보이며, 최종 제출 전 최신 원문과 관할 담당자 답변으로 확정한다.",
    "",
    "## 핵심 위험 우선순위",
    "| 위험 | 수준 | 바로 할 통제 | 남길 증빙 |",
    "| --- | --- | --- | --- |",
    ...riskRows.map((row) => `| ${row.map(markdownTableCell).join(" | ")} |`),
    "",
    "## 적용/비적용 판단",
    "| 영역 | 판단 | 이유 |",
    "| --- | --- | --- |",
    ...decisionRows.map((row) => `| ${row.map(markdownTableCell).join(" | ")} |`),
    "",
    "## 조건부 확인 항목",
    "| 항목 | 전환 기준 | 확인할 증빙 |",
    "| --- | --- | --- |",
    ...(conditionalRows.length > 0
      ? conditionalRows.map((row) => `| ${row.map(markdownTableCell).join(" | ")} |`)
      : ["| 조건부 항목 없음 | 현재 입력 조건 기준 추가 전환 후보 없음 | - |"]),
    "",
    "## 제출·협의 우선 액션",
    "| 확인처 | 해야 할 일 | 적용 트리거 | 기한 | 보관 증빙 |",
    "| --- | --- | --- | --- | --- |",
    ...(urgentActionRows.length > 0
      ? urgentActionRows.map((row) => `| ${row.map(markdownTableCell).join(" | ")} |`)
      : ["| - | 제출·협의 일정 없음 | 행사 조건 입력과 관할기관 확인 필요 | - | - |"]),
    "",
    "## 현장 실행 패키지",
    "| 패키지 | 대상 | 파일 | 공유 수준 |",
    "| --- | --- | --- | --- |",
    ...packageRows.map((row) => `| ${row.map(markdownTableCell).join(" | ")} |`),
    "",
    "## 베뉴·조례 확인 포인트",
    ...compactList([
      ...venueRules.slice(0, 4).map((item) => `베뉴: ${String(item.summary ?? item.id ?? "규정 확인")}`),
      ...primaryLocalOrdinances.slice(0, 6).map((item) => `조례: ${localOrdinanceLabel(item)} / ${String(item.submissionDeadline ?? "제출기한 확인 필요")}`),
    ], "베뉴 또는 조례 후보 없음. 관할/베뉴 입력을 보강해야 함", 8),
    "",
    "## 바로 열어볼 파일",
    "- `bundle/documents/01-event-safety-plan.md`: 제출용 안전관리계획서 뼈대",
    "- `bundle/documents/02-crowd-flow-plan.md`: 인파·동선 운영계획",
    "- `bundle/documents/18-submission-raci-calendar.md`: 제출 일정·담당·증빙 매트릭스",
    "- `bundle/documents/16-operations-runsheet.md`: 당일 운영 런시트",
    "- `bundle/documents/17-review-summary.md`: 자동 검수 결과",
    "- `bundle/submission-packages/`: 지자체, 베뉴, 소방·경찰·의료, 협력사용 분리 패키지",
    "",
    "## 신뢰도와 남은 리스크",
    `- 조례 출처 신뢰도: ${sourceConfidenceLabels.slice(0, 5).join(", ") || "미표시"}`,
    `- 베뉴 규정 수: ${venueRules.length}건 / 우선 조례 후보 수: ${primaryLocalOrdinances.length}건 / 전체 조례 후보 수: ${localOrdinances.length}건 / 위험요인 수: ${hazards.length}건`,
    `- 상세 커버리지 점수: ${review.score ?? "미산정"}점. 누락 탐지 보조값이며 법령 적합성 보증이 아니다.`,
    "- 예상 인원, 세부 도면, 실제 교통통제 여부, 무대/부스 배치, 식음료·LPG 유무, 개인정보 수집 방식은 주최 측 최신 운영계획으로 대체해야 한다.",
    "- 이 보고서는 안전관리 실무 초안이며 법률 자문이나 관할기관 승인을 대체하지 않는다.",
  ].join("\n");
}

function decisionTone(value: string): string {
  if (/비적용/.test(value)) return "tone-muted";
  if (/조건부|확인/.test(value)) return "tone-warning";
  if (/필수|적용/.test(value)) return "tone-good";
  return "tone-muted";
}

function riskTone(value: string): string {
  if (/critical|high|긴급|높|상|심각/i.test(value)) return "tone-danger";
  if (/medium|보통|중|확인/i.test(value)) return "tone-warning";
  return "tone-muted";
}

function renderHtmlChips(items: string[]): string {
  if (items.length === 0) return `<span class="chip tone-muted">특이 조건 미입력</span>`;
  return items.map((item) => `<span class="chip">${htmlEscape(item)}</span>`).join("\n");
}

function renderHtmlTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return `<p class="muted">표시할 항목이 없습니다.</p>`;
  return [
    `<div class="table-wrap">`,
    `<table>`,
    `<thead><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join("")}</tr></thead>`,
    `<tbody>`,
    ...rows.map((row) => `<tr>${row.map((cell) => `<td>${htmlEscape(cell || "확인 필요")}</td>`).join("")}</tr>`),
    `</tbody>`,
    `</table>`,
    `</div>`,
  ].join("\n");
}

function renderRiskCards(rows: string[][]): string {
  return rows.map((row) => [
    `<article class="mini-card risk-card ${riskTone(row[1] ?? "")}">`,
    `<div class="card-topline"><strong>${htmlEscape(row[0])}</strong><span class="pill">${htmlEscape(row[1] || "확인")}</span></div>`,
    `<p>${htmlEscape(row[2] || "현장 통제대책 지정 필요")}</p>`,
    `<small>증빙: ${htmlEscape(row[3] || "점검표, 사진, 담당자 확인 기록")}</small>`,
    `</article>`,
  ].join("\n")).join("\n");
}

function renderDecisionCards(rows: string[][]): string {
  return rows.map((row) => [
    `<article class="mini-card decision-card ${decisionTone(row[1] ?? "")}">`,
    `<div class="card-topline"><strong>${htmlEscape(row[0])}</strong><span class="pill">${htmlEscape(row[1] || "확인")}</span></div>`,
    `<p>${htmlEscape(row[2] || "판단 근거 확인 필요")}</p>`,
    `</article>`,
  ].join("\n")).join("\n");
}

function buildExecutiveHtmlReport(options: {
  input: AnyRecord;
  structured: AnyRecord;
  review: AnyRecord;
  submissionSchedule: SubmissionScheduleItem[];
  submissionPackages: SubmissionPackage[];
}): string {
  const { input, structured, review, submissionSchedule, submissionPackages } = options;
  const applicability = (structured.applicability ?? {}) as AnyRecord;
  const hazards = recordArray(applicability.hazards);
  const venueRules = recordArray(applicability.venueRules);
  const localOrdinances = recordArray(applicability.localOrdinances);
  const primaryLocalOrdinances = primaryLocalOrdinancesForBrief(localOrdinances, input);
  const decisionRows = buildDecisionRows(input);
  const conditionalRows = buildConditionalRows(input);
  const riskRows = buildRiskRows(input, hazards);
  const selectedActions = selectExecutiveActions(submissionSchedule);
  const urgentActionRows = actionRowsFromSchedule(selectedActions);
  const sourceConfidence = localOrdinances
    .map((item) => String(item.sourceConfidence ?? ""))
    .filter(Boolean);
  const sourceConfidenceLabels = Array.from(new Set(sourceConfidence.map(confidenceLabel)));
  const reviewCounts = review.counts as AnyRecord | undefined;
  const reviewFindingCount = Number(reviewCounts?.total ?? 0);
  const reviewStatus = review.verdict === "needs_revision"
    ? "수정 필요"
    : review.verdict === "usable_with_review"
      ? "조건부 검토 가능"
      : review.verdict === "usable"
        ? "초안 검토 가능"
        : "미검수";
  const venueAndOrdinancePoints = [
    ...venueRules.slice(0, 4).map((item) => `베뉴: ${String(item.summary ?? item.id ?? "규정 확인")}`),
    ...primaryLocalOrdinances.slice(0, 6).map((item) => `조례: ${localOrdinanceLabel(item)} / ${String(item.submissionDeadline ?? "제출기한 확인 필요")}`),
  ];
  const quickFiles = [
    ["bundle/documents/01-event-safety-plan.md", "행사 안전관리계획서"],
    ["bundle/documents/02-crowd-flow-plan.md", "인파·동선 운영계획"],
    ["bundle/documents/18-submission-raci-calendar.md", "제출 일정·담당·증빙 매트릭스"],
    ["bundle/documents/16-operations-runsheet.md", "당일 운영 런시트"],
    ["bundle/documents/17-review-summary.md", "자동 검수 결과"],
    ["bundle/submission-packages/", "대상별 제출 패키지"],
  ];

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(input.eventName ?? "행사명 미정")} 핵심 안전 브리프</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fb;
      --paper: #ffffff;
      --ink: #172033;
      --muted: #667085;
      --line: #d9e0ea;
      --blue: #315fc7;
      --blue-soft: #eaf1ff;
      --green: #157a4f;
      --green-soft: #eaf8f1;
      --yellow: #98690a;
      --yellow-soft: #fff5d6;
      --red: #c23a3a;
      --red-soft: #fff0ee;
      --shadow: 0 18px 50px rgba(39, 51, 82, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif;
      line-height: 1.58;
      letter-spacing: 0;
    }
    a { color: var(--blue); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .page { max-width: 1180px; margin: 0 auto; padding: 32px 24px 56px; }
    .toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 18px; }
    .badge, .button-link {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 6px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper);
      color: #334155;
      font-size: 13px;
      font-weight: 700;
    }
    .badge.primary { color: var(--blue); border-color: #b9c9f5; background: var(--blue-soft); }
    .button-link { cursor: pointer; margin-left: auto; }
    .hero, .card, .mini-card {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }
    .hero { padding: 30px; margin-bottom: 18px; }
    h1 { margin: 0 0 10px; font-size: clamp(30px, 5vw, 52px); line-height: 1.08; }
    h2 { margin: 0 0 16px; font-size: 22px; line-height: 1.22; }
    h3 { margin: 0 0 8px; font-size: 16px; }
    p { margin: 0 0 10px; }
    .lead { color: var(--muted); font-size: 18px; max-width: 900px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
    .chip, .pill {
      display: inline-flex;
      align-items: center;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      color: #334155;
      padding: 5px 9px;
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
    }
    .pill { font-size: 12px; padding: 4px 8px; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 18px 0; }
    .stat { padding: 18px; }
    .stat strong { display: block; font-size: 27px; line-height: 1.15; color: var(--blue); }
    .stat span { color: var(--muted); font-size: 13px; font-weight: 700; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .card { padding: 22px; margin-bottom: 16px; }
    .mini-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .mini-card { padding: 16px; box-shadow: none; }
    .card-topline { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
    .mini-card p { color: #334155; margin-bottom: 8px; }
    .mini-card small { color: var(--muted); display: block; }
    .tone-good { border-color: #93d5b7; background: var(--green-soft); }
    .tone-good .pill, .tone-good strong { color: var(--green); }
    .tone-warning { border-color: #ead28a; background: var(--yellow-soft); }
    .tone-warning .pill, .tone-warning strong { color: var(--yellow); }
    .tone-danger { border-color: #f1a5a5; background: var(--red-soft); }
    .tone-danger .pill, .tone-danger strong { color: var(--red); }
    .tone-muted { border-color: var(--line); background: #f8fafc; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); }
    table { width: 100%; border-collapse: collapse; min-width: 760px; }
    th, td { padding: 12px 13px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { background: #f8fafc; color: #475569; font-size: 13px; }
    tr:last-child td { border-bottom: 0; }
    ul { margin: 0; padding-left: 20px; }
    li + li { margin-top: 7px; }
    .file-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
    .file-list a { display: block; border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: #fbfdff; font-weight: 700; }
    .muted { color: var(--muted); }
    .notice { border-left: 4px solid var(--yellow); background: #fffaf0; padding: 14px 16px; border-radius: 8px; color: #56410c; }
    @media (max-width: 820px) {
      .page { padding: 22px 14px 40px; }
      .hero { padding: 22px; }
      .stats, .grid, .mini-grid, .file-list { grid-template-columns: 1fr; }
      .button-link { margin-left: 0; }
    }
    @media print {
      body { background: #fff; }
      .page { max-width: none; padding: 0; }
      .toolbar, .button-link { display: none; }
      .hero, .card, .mini-card { box-shadow: none; break-inside: avoid; }
      a { color: inherit; text-decoration: none; }
    }
  </style>
</head>
<body>
  <main class="page">
    <div class="toolbar">
      <span class="badge primary">korea-mice-safety-agent v${htmlEscape(VERSION)}</span>
      <span class="badge">export_mice_safety_plan_bundle</span>
      <a class="badge" href="00-executive-report.md">Markdown 보기</a>
      <button class="button-link" type="button" onclick="window.print()">인쇄</button>
    </div>

    <section class="hero">
      <h1>${htmlEscape(input.eventName ?? "행사명 미정")} 핵심 안전 브리프</h1>
      <p class="lead">법령 조항 원문과 체크리스트는 뒤 파일에 두고, 여기서는 현장 의사결정·제출 액션·남은 확인사항만 먼저 보여줍니다.</p>
      <div class="chips">${renderHtmlChips(inputFlagSummary(input))}</div>
    </section>

    <section class="stats">
      <div class="card stat"><strong>${htmlEscape(reviewStatus)}</strong><span>초안 상태</span></div>
      <div class="card stat"><strong>${htmlEscape(reviewFindingCount)}</strong><span>커버리지 finding</span></div>
      <div class="card stat"><strong>${htmlEscape(formatCrowd(input.expectedCrowd))}</strong><span>예상 인원</span></div>
      <div class="card stat"><strong>${htmlEscape(hazards.length)}</strong><span>도출 위험요인</span></div>
    </section>

    <section class="grid">
      <div class="card">
        <h2>결론</h2>
        <ul>
          <li>행사일/장소: ${htmlEscape(eventDateLabelForBrief(input))} / ${htmlEscape(input.location ?? "미입력")}</li>
          <li>관할/베뉴: ${htmlEscape(input.jurisdiction ?? "미입력")} / ${htmlEscape(input.venueId ?? "베뉴 미지정")}</li>
          <li>자동 검수는 법적 적합성 점수가 아니라 입력 조건 대비 커버리지 점검입니다.</li>
          <li>최종 제출 전 최신 원문, 행사 도면, 관할기관 답변으로 보정해야 합니다.</li>
        </ul>
      </div>
      <div class="card">
        <h2>먼저 결정할 것</h2>
        <ul>
          <li>관할기관 제출 대상과 제출기한을 실제 접수창구 기준으로 확정</li>
          <li>피크 시간대, 병목 구역, 퇴장 동선, 비상차량 접근로를 한 장 도면으로 확정</li>
          <li>안전총괄, 구역장, 의료, 시설·전기, 보안, 교통 담당 권한 확정</li>
          <li>행사 중지, 입장 제한, 우회 안내, 대피개시 기준 사전 승인</li>
        </ul>
      </div>
    </section>

    <section class="card">
      <h2>핵심 위험 우선순위</h2>
      <div class="mini-grid">${renderRiskCards(riskRows)}</div>
    </section>

    <section class="card">
      <h2>적용/비적용 판단</h2>
      <div class="mini-grid">${renderDecisionCards(decisionRows)}</div>
    </section>

    <section class="grid">
      <div class="card">
        <h2>조건부 확인 항목</h2>
        ${renderHtmlTable(["항목", "전환 기준", "확인할 증빙"], conditionalRows.length > 0 ? conditionalRows : [["조건부 항목 없음", "현재 입력 조건 기준 추가 전환 후보 없음", "-"]])}
      </div>
      <div class="card">
        <h2>베뉴·조례 확인 포인트</h2>
        <ul>${(venueAndOrdinancePoints.length > 0 ? venueAndOrdinancePoints.slice(0, 8) : ["베뉴 또는 조례 후보 없음. 관할/베뉴 입력을 보강해야 함"]).map((item) => `<li>${htmlEscape(item)}</li>`).join("")}</ul>
      </div>
    </section>

    <section class="card">
      <h2>제출·협의 우선 액션</h2>
      ${renderHtmlTable(["확인처", "해야 할 일", "적용 트리거", "기한", "보관 증빙"], urgentActionRows)}
    </section>

    <section class="grid">
      <div class="card">
        <h2>바로 열어볼 파일</h2>
        <ul class="file-list">${quickFiles.map(([href, label]) => `<li><a href="${htmlEscape(href)}">${htmlEscape(label)}</a></li>`).join("")}</ul>
      </div>
      <div class="card">
        <h2>대상별 제출 패키지</h2>
        <ul class="file-list">${submissionPackages.map((item) => `<li><a href="bundle/submission-packages/${htmlEscape(item.fileName)}">${htmlEscape(item.title)}<br><span class="muted">${htmlEscape(item.audience)} · ${htmlEscape(item.redactionLevel)}</span></a></li>`).join("")}</ul>
      </div>
    </section>

    <section class="card">
      <h2>신뢰도와 남은 리스크</h2>
      <p>조례 출처 신뢰도: ${htmlEscape(sourceConfidenceLabels.slice(0, 5).join(", ") || "미표시")}</p>
      <p>베뉴 규정 수: ${htmlEscape(venueRules.length)}건 / 우선 조례 후보 수: ${htmlEscape(primaryLocalOrdinances.length)}건 / 전체 조례 후보 수: ${htmlEscape(localOrdinances.length)}건 / 커버리지 점수: ${htmlEscape(review.score ?? "미산정")}점</p>
      <div class="notice">이 보고서는 안전관리 실무 초안입니다. 법률 자문이나 관할기관 승인을 대체하지 않으며, 실제 배치도·운영계획·관할기관 답변으로 최종 보정해야 합니다.</div>
    </section>
  </main>
</body>
</html>`;
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
  if (/공연 재해대처|공연·무대 실행|무대 실행계획/.test(document)) {
    return { responsible: "공연안전 담당", accountable: "안전총괄", consulted: "공연/문화 담당부서·베뉴 기술지원", informed: "운영본부/무대감독/보안·의료팀" };
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
  if (/공연|재해대처|무대 실행|무대장치|스탠딩|리깅/.test(text)) return "공연 재해대처계획/안전교육 명단/무대·리깅 승인/공연중지 기준";
  if (/가설건축물|피난안전|임시사용/.test(text)) return "가설건축물 신고필증/피난안전 확인서/임시사용 승인 확인";
  if (/베뉴 운영|부스 시공|반입제한|제출 안전서류/.test(text)) return "베뉴 제출 승인서/부스·전기 신청서/반입·하역 승인/현장 확인 사진";
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
  return (input.eventTypes ?? []).includes(eventType as MiceEventType);
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
    `- 자체 검수: ${review.verdict ?? "미실행"} / 커버리지 점수 ${review.score ?? "미기록"} / finding ${reviewCounts?.total ?? "미기록"}건`,
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
      documentKeys: ["eventSafetyPlan", "publicApiOperationalEvidence", "crowdFlowPlan", "roadTrafficControlPlan", ...(hasUnhostedCrowd ? ["unhostedCrowdResponsePlan"] : []), ...(hasPerformance ? ["performanceStagePlan"] : []), "submissionChecklist", "operationsRunsheet", "medicalResponsePlan", "fireEvacuationChecklist", "incidentReportTemplate", "visitorSafetyNotices"],
      coverageIds: ["event_safety_plan", "public_api_operational_evidence", "crowd_flow_plan", "road_traffic_control_plan", ...(hasUnhostedCrowd ? ["unhosted_crowd_response_plan"] : []), ...(hasPerformance ? ["performance_stage_execution_plan"] : []), "submission_checklist", "operations_runsheet", "medical_response_plan", "fire_evacuation_checklist", "incident_report_template", "visitor_safety_notices"],
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
      documentKeys: ["eventSafetyPlan", "publicApiOperationalEvidence", "venueFacilityPlan", "roadTrafficControlPlan", ...(hasUnhostedCrowd ? ["unhostedCrowdResponsePlan"] : []), ...(hasPerformance ? ["performanceStagePlan"] : []), "operationsRunsheet", "fireEvacuationChecklist", "dailySafetyChecklist", "staffAssignment", "emergencyContacts", ...(hasFoodOrLpg ? ["foodLpgChecklist"] : [])],
      coverageIds: ["event_safety_plan", "public_api_operational_evidence", "venue_facility_plan", "road_traffic_control_plan", ...(hasUnhostedCrowd ? ["unhosted_crowd_response_plan"] : []), ...(hasPerformance ? ["performance_stage_execution_plan"] : []), "operations_runsheet", "fire_evacuation_checklist", "daily_safety_checklist", "staff_assignment", "emergency_contacts", ...(hasFoodOrLpg ? ["food_lpg_checklist"] : [])],
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
      documentKeys: ["publicApiOperationalEvidence", "crowdFlowPlan", "roadTrafficControlPlan", ...(hasUnhostedCrowd ? ["unhostedCrowdResponsePlan"] : []), ...(hasPerformance ? ["performanceStagePlan"] : []), "operationsRunsheet", "fireEvacuationChecklist", "medicalResponsePlan", "staffAssignment", "emergencyContacts", "visitorSafetyNotices", "incidentReportTemplate"],
      coverageIds: ["public_api_operational_evidence", "crowd_flow_plan", "road_traffic_control_plan", ...(hasUnhostedCrowd ? ["unhosted_crowd_response_plan"] : []), ...(hasPerformance ? ["performance_stage_execution_plan"] : []), "operations_runsheet", "fire_evacuation_checklist", "medical_response_plan", "staff_assignment", "emergency_contacts", "visitor_safety_notices", "incident_report_template"],
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
      documentKeys: ["workerSafetyPlan", "publicApiOperationalEvidence", ...(hasPerformance ? ["performanceStagePlan"] : []), "venueFacilityPlan", "operationsRunsheet", "fireEvacuationChecklist", "dailySafetyChecklist", "emergencyContacts", ...(hasFoodOrLpg ? ["foodLpgChecklist"] : [])],
      coverageIds: ["worker_safety_plan", "public_api_operational_evidence", ...(hasPerformance ? ["performance_stage_execution_plan"] : []), "venue_facility_plan", "operations_runsheet", "fire_evacuation_checklist", "daily_safety_checklist", "emergency_contacts", ...(hasFoodOrLpg ? ["food_lpg_checklist"] : [])],
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

  addRowsSheet(sheets, "Public API Evidence", bulletRows(String(documentBundle.publicApiOperationalEvidence ?? ""), "공공 API 운영 증거"));
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
    documentBundle: structured.documentBundle,
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
  const root = defaultRoot();
  let bundleDir: string;
  if (input.outputDir) {
    if (input.outputDir.split(/[\\/]/).includes("..")) throw new Error("outputDir에 상위 경로 이동(..)은 허용되지 않습니다");
    const resolved = resolve(root, input.outputDir);
    if (!isAbsolute(input.outputDir) && resolved !== root && !resolved.startsWith(root + sep)) {
      throw new Error("outputDir가 허용 루트를 벗어났습니다");
    }
    bundleDir = resolved;
  } else {
    bundleDir = join(root, "plan-bundles", `${safeName(input.eventName)}-${nowStamp()}`);
  }
  mkdirSync(bundleDir, { recursive: true });
  if (lstatSync(bundleDir).isSymbolicLink()) throw new Error("bundleDir가 심볼릭 링크입니다");
  const detailsDir = join(bundleDir, "bundle");
  const documentsDir = join(detailsDir, "documents");
  const tablesDir = join(detailsDir, "tables");
  const metadataDir = join(detailsDir, "metadata");
  mkdirSync(documentsDir, { recursive: true });
  mkdirSync(tablesDir, { recursive: true });
  mkdirSync(metadataDir, { recursive: true });

  const files: string[] = [];
  const executiveReport = buildExecutiveReport({
    input: input as AnyRecord,
    structured: structured as AnyRecord,
    review,
    submissionSchedule,
    submissionPackages,
  });
  const executiveHtmlReport = buildExecutiveHtmlReport({
    input: input as AnyRecord,
    structured: structured as AnyRecord,
    review,
    submissionSchedule,
    submissionPackages,
  });
  const executiveReportPath = join(bundleDir, "00-executive-report.md");
  writeFileSync(executiveReportPath, `${executiveReport}\n`, { flag: "wx" });
  files.push(executiveReportPath);
  const executiveHtmlReportPath = join(bundleDir, "00-executive-report.html");
  writeFileSync(executiveHtmlReportPath, `${executiveHtmlReport}\n`, { flag: "wx" });
  files.push(executiveHtmlReportPath);

  const fullPlanPath = join(documentsDir, "00-full-safety-plan.md");
  writeFileSync(fullPlanPath, `${planMarkdown}\n`, { flag: "wx" });
  files.push(fullPlanPath);

  const docxPath = join(documentsDir, "safety-plan.docx");
  await writeDocx(planMarkdown, docxPath);
  files.push(docxPath);

  for (const [key, fileName] of Object.entries(documentFileNames)) {
    const value = exportDocumentBundle[key];
    if (typeof value !== "string" || value.trim().length === 0) continue;
    const filePath = join(documentsDir, fileName);
    writeFileSync(filePath, `${value}\n`, { flag: "wx" });
    files.push(filePath);
  }

  const checklistSources = [
    ["public-api-operational-evidence.csv", "공공 API 운영 증거", String(documentBundle.publicApiOperationalEvidence ?? "")],
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
    const filePath = join(tablesDir, fileName);
    const csv = fileName === "submission-checklist.csv" || fileName === "operations-runsheet.csv" ? tableToCsv(markdown) : bulletsToCsv(markdown, title);
    writeFileSync(filePath, `${csv}\n`, { flag: "wx" });
    files.push(filePath);
  }

  const foodLpgExecutionCsv = tableToCsv(String(documentBundle.foodLpgChecklist ?? ""));
  if (foodLpgExecutionCsv.trim()) {
    const filePath = join(tablesDir, "food-lpg-execution.csv");
    writeFileSync(filePath, `${foodLpgExecutionCsv}\n`, { flag: "wx" });
    files.push(filePath);
  }
  const performanceStageExecutionCsv = tableToCsv(String(documentBundle.performanceStagePlan ?? ""));
  if (performanceStageExecutionCsv.trim()) {
    const filePath = join(tablesDir, "performance-stage-execution.csv");
    writeFileSync(filePath, `${performanceStageExecutionCsv}\n`, { flag: "wx" });
    files.push(filePath);
  }

  const visitorNoticesCsvPath = join(tablesDir, "visitor-safety-notices.csv");
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
  writeFileSync(visitorNoticesCsvPath, `${visitorNoticeRows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`, { flag: "wx" });
  files.push(visitorNoticesCsvPath);

  const reviewSummaryPath = join(documentsDir, "17-review-summary.md");
  writeFileSync(reviewSummaryPath, `${reviewMarkdown}\n`, { flag: "wx" });
  files.push(reviewSummaryPath);

  const reviewCoveragePath = join(tablesDir, "review-coverage-matrix.csv");
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
  writeFileSync(reviewCoveragePath, `${coverageRows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`, { flag: "wx" });
  files.push(reviewCoveragePath);

  const reviewFindingsPath = join(tablesDir, "review-findings.csv");
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
  writeFileSync(reviewFindingsPath, `${findingRows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`, { flag: "wx" });
  files.push(reviewFindingsPath);

  const submissionSchedulePath = join(documentsDir, "18-submission-raci-calendar.md");
  writeFileSync(submissionSchedulePath, `${submissionScheduleMarkdown(input, submissionSchedule)}\n`, { flag: "wx" });
  files.push(submissionSchedulePath);

  const submissionScheduleCsvPath = join(tablesDir, "submission-raci-calendar.csv");
  const submissionScheduleCsv = submissionScheduleRows(submissionSchedule)
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
  writeFileSync(submissionScheduleCsvPath, `${submissionScheduleCsv}\n`, { flag: "wx" });
  files.push(submissionScheduleCsvPath);

  const packageDir = join(detailsDir, "submission-packages");
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
  writeFileSync(packageIndexPath, `${packageIndexRows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`, { flag: "wx" });
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
  writeFileSync(packageManifestPath, `${JSON.stringify(packageManifest, null, 2)}\n`, { flag: "wx" });
  files.push(packageManifestPath);

  for (const item of submissionPackages) {
    const filePath = join(packageDir, item.fileName);
    writeFileSync(filePath, `${item.markdown}\n`, { flag: "wx" });
    files.push(filePath);
  }

  const xlsxPath = join(tablesDir, "safety-checklists.xlsx");
  await writeXlsx(exportDocumentBundle, input, xlsxPath, noticeBundle, review, submissionPackages, submissionSchedule);
  files.push(xlsxPath);

  const operationsRunsheetCount = Math.max(0, tableRows(String(exportDocumentBundle.operationsRunsheet ?? "")).length - 1);
  const manifestPath = join(metadataDir, "manifest.json");
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
    executiveReportPath,
    executiveHtmlReportPath,
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
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
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
      executiveReportPath,
      executiveHtmlReportPath,
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
    "generate_mice_safety_plan 결과를 로컬 디렉터리에 Markdown 문서 묶음, 공공 API 운영 증거, CSV 체크리스트, 도로·교통 실행계획, 무주최 다중운집 대응계획, 현장 운영 런시트, 다국어 방문객 안내문, 자체 검수 요약, docx/xlsx로 저장합니다.",
  inputSchema,
  handler,
};
