import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import { generateMiceSafetyPlanTool } from "./generate-mice-safety-plan.js";

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
  planMarkdown: z.string().optional().describe("검수할 계획서 Markdown. 없으면 같은 입력으로 generate_mice_safety_plan을 먼저 호출합니다."),
  eventName: z.string().optional(),
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
  outdoorAdvertising: z.boolean().optional().describe("현수막, 배너, 지주형 안내판, 전광류 등 옥외광고물/외부 안내표지 설치 여부"),
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
});

type Input = z.infer<typeof inputSchema>;

type Severity = "error" | "warning" | "info";

interface Finding {
  requirementId: string;
  severity: Severity;
  category: string;
  message: string;
  recommendation: string;
  weight: number;
  evidence?: {
    line: number;
    excerpt: string;
  };
}

type CoverageRequirement = "required" | "conditional" | "not_applicable";
type CoverageStatus = "present" | "missing" | "not_applicable";

interface DocumentCoverageRow {
  documentId: string;
  title: string;
  requirement: CoverageRequirement;
  status: CoverageStatus;
  appliesWhen: string;
  missingSeverity?: Severity;
  evidence?: Finding["evidence"];
}

interface ReviewContext {
  isOutdoor: boolean;
  isExhibition: boolean;
  isConference: boolean;
  isPerformance: boolean;
  hasFood: boolean;
  hasWorkerWork: boolean;
  hasPrivacy: boolean;
  hasVipSecurity: boolean;
  hasVenue: boolean;
  largeCrowd: boolean;
  roadUse: boolean;
  unhostedCrowd: boolean;
}

interface DocumentCoverageDefinition {
  documentId: string;
  title: string;
  terms: string[];
  appliesWhen: string;
  requirement: (input: Input, context: ReviewContext) => CoverageRequirement;
  missingSeverity?: Severity;
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function includesAll(text: string, terms: string[]): boolean {
  return terms.every((term) => text.includes(term));
}

function locateEvidence(text: string, terms: string[]): Finding["evidence"] | undefined {
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => terms.some((term) => line.includes(term)));
  if (index < 0) return undefined;
  return {
    line: index + 1,
    excerpt: lines[index].trim().slice(0, 180),
  };
}

function findingWeight(severity: Severity): number {
  if (severity === "error") return 15;
  if (severity === "warning") return 5;
  return 1;
}

function addFinding(
  findings: Finding[],
  condition: boolean,
  severity: Severity,
  category: string,
  message: string,
  recommendation: string,
  options?: { requirementId?: string; evidenceTerms?: string[]; text?: string },
): void {
  if (!condition) return;
  findings.push({
    requirementId: options?.requirementId ?? category,
    severity,
    category,
    message,
    recommendation,
    weight: findingWeight(severity),
    evidence: options?.text && options.evidenceTerms ? locateEvidence(options.text, options.evidenceTerms) : undefined,
  });
}

function hasEvent(input: Input, eventType: string): boolean {
  return (input.eventTypes ?? []).includes(eventType as z.infer<typeof EventTypeSchema>);
}

function buildReviewContext(input: Input): ReviewContext {
  const isOutdoor = Boolean(input.outdoor || input.outdoorEvent || hasEvent(input, "festival") || hasEvent(input, "outdoor_event"));
  const isExhibition = hasEvent(input, "exhibition");
  const isConference = hasEvent(input, "conference");
  const isPerformance = Boolean(input.performance || hasEvent(input, "performance"));
  const hasFood = Boolean(input.foodService || input.lpgUse || hasEvent(input, "food_event"));
  const hasWorkerWork = Boolean(input.setupTeardown || input.temporaryStructures || input.temporaryElectricity || input.workAtHeight || input.heavyObjectHandling || input.hotWork);
  const hasPrivacy = Boolean(input.personalDataProcessing || hasEvent(input, "conference") || hasEvent(input, "vip_event"));
  const hasVipSecurity = Boolean(input.vipSecurity || hasEvent(input, "vip_event"));
  const hasVenue = Boolean(input.venueId || isExhibition || isConference || isPerformance);
  const largeCrowd = typeof input.expectedCrowd === "number" && input.expectedCrowd >= 1000;
  return {
    isOutdoor,
    isExhibition,
    isConference,
    isPerformance,
    hasFood,
    hasWorkerWork,
    hasPrivacy,
    hasVipSecurity,
    hasVenue,
    largeCrowd,
    roadUse: input.roadUse === true,
    unhostedCrowd: input.unhostedCrowd === true,
  };
}

const documentCoverageDefinitions: DocumentCoverageDefinition[] = [
  {
    documentId: "event_safety_plan",
    title: "행사 안전관리계획서",
    terms: ["행사 안전관리계획서", "안전관리계획서"],
    appliesWhen: "모든 MICE/옥외행사",
    requirement: () => "required",
    missingSeverity: "error",
  },
  {
    documentId: "crowd_flow_plan",
    title: "인파·동선 관리계획",
    terms: ["인파·동선 관리계획", "인파·동선", "혼잡 단계", "대기열"],
    appliesWhen: "전시장, 옥외축제, 공연, 대규모 또는 도로점용 행사",
    requirement: (_input, ctx) => (ctx.largeCrowd || ctx.isOutdoor || ctx.isExhibition || ctx.isPerformance || ctx.roadUse ? "required" : "conditional"),
    missingSeverity: "error",
  },
  {
    documentId: "road_traffic_control_plan",
    title: "도로·교통 실행계획",
    terms: ["도로·교통 실행계획", "교통통제 도면", "비상차량 접근로", "셔틀·택시·버스 승하차"],
    appliesWhen: "도로점용, 교통통제, 옥외축제, 퍼레이드, 셔틀/주차/승하차 또는 행사장 외부 대기열이 있는 경우",
    requirement: (_input, ctx) => (ctx.roadUse ? "required" : ctx.isOutdoor || ctx.largeCrowd ? "conditional" : "not_applicable"),
    missingSeverity: "error",
  },
  {
    documentId: "venue_facility_plan",
    title: "베뉴 시설·수용·하역·전기 제약 체크",
    terms: ["베뉴 시설·수용·하역·전기 제약 체크", "베뉴 시설·수용"],
    appliesWhen: "전시장/컨벤션센터/공연장 등 베뉴 사용 또는 임시구조물 설치",
    requirement: (_input, ctx) => (ctx.hasVenue ? "required" : ctx.hasWorkerWork ? "conditional" : "not_applicable"),
    missingSeverity: "warning",
  },
  {
    documentId: "unhosted_crowd_response_plan",
    title: "무주최 다중운집 관계기관 공동대응계획",
    terms: ["무주최 다중운집 관계기관 공동대응계획", "공동 현장지휘", "관계기관 합동상황반", "주최자 없음"],
    appliesWhen: "주최자 없음, 자발적 군중, 역세권·광장·상권 등 관리주체가 나뉘는 다중운집",
    requirement: (_input, ctx) => (ctx.unhostedCrowd ? "required" : "not_applicable"),
    missingSeverity: "error",
  },
  {
    documentId: "worker_safety_plan",
    title: "설치·철거 작업자 안전계획서",
    terms: ["설치·철거 작업자 안전계획서", "작업자 안전계획서"],
    appliesWhen: "설치·철거, 임시구조물, 임시전기, 고소, 중량물, 화기작업",
    requirement: (_input, ctx) => (ctx.hasWorkerWork ? "required" : "not_applicable"),
    missingSeverity: "error",
  },
  {
    documentId: "performance_stage_execution_plan",
    title: "공연·무대 실행계획",
    terms: ["공연·무대 실행계획", "공연중지 기준", "무대감독", "리깅 승인"],
    appliesWhen: "공연, 야외 무대, 스탠딩 관객, 무대·트러스·음향·조명 운영",
    requirement: (_input, ctx) => (ctx.isPerformance ? "required" : "not_applicable"),
    missingSeverity: "error",
  },
  {
    documentId: "fire_evacuation_checklist",
    title: "소방·피난 점검표",
    terms: ["소방·피난 점검표"],
    appliesWhen: "모든 행사. 특히 실내 베뉴, 대규모, 공연, 식음료, 임시구조물",
    requirement: () => "required",
    missingSeverity: "error",
  },
  {
    documentId: "food_lpg_checklist",
    title: "식음료/LPG 점검표",
    terms: ["식음료·LPG 점검표", "식음료/LPG 점검표"],
    appliesWhen: "식음료, 시식, 푸드트럭, 케이터링, LPG/가스 사용",
    requirement: (_input, ctx) => (ctx.hasFood ? "required" : "not_applicable"),
    missingSeverity: "error",
  },
  {
    documentId: "privacy_cctv_checklist",
    title: "개인정보/CCTV 점검표",
    terms: ["개인정보·CCTV 점검표", "개인정보/CCTV 점검표"],
    appliesWhen: "등록, QR/출입증, CCTV, 촬영, 앱 신고, 컨벤션/VIP",
    requirement: (_input, ctx) => (ctx.hasPrivacy ? "required" : "conditional"),
    missingSeverity: "warning",
  },
  {
    documentId: "security_access_plan",
    title: "출입통제·보안검색·VIP 동선 계획",
    terms: ["출입통제·보안검색·VIP 동선 계획"],
    appliesWhen: "VIP/보안검색/민간경비, 대규모 공연·컨벤션",
    requirement: (_input, ctx) => (ctx.hasVipSecurity ? "required" : ctx.largeCrowd || ctx.isPerformance ? "conditional" : "not_applicable"),
    missingSeverity: "error",
  },
  {
    documentId: "medical_response_plan",
    title: "응급의료·AED·구급 이송 계획",
    terms: ["응급의료·AED·구급 이송 계획"],
    appliesWhen: "대규모, 옥외, 공연, 식음료, 야간/우천/폭염 등 위험 조건",
    requirement: (_input, ctx) => (ctx.largeCrowd || ctx.isOutdoor || ctx.isPerformance ? "required" : "conditional"),
    missingSeverity: "warning",
  },
  {
    documentId: "staff_assignment",
    title: "스태프 배치표",
    terms: ["스태프 배치표"],
    appliesWhen: "모든 운영 행사",
    requirement: () => "required",
    missingSeverity: "error",
  },
  {
    documentId: "emergency_contacts",
    title: "비상연락망",
    terms: ["비상연락망"],
    appliesWhen: "모든 운영 행사",
    requirement: () => "required",
    missingSeverity: "error",
  },
  {
    documentId: "daily_safety_checklist",
    title: "일일 안전점검표",
    terms: ["일일 안전점검표", "개장 전", "일일 점검"],
    appliesWhen: "모든 운영 행사",
    requirement: () => "required",
    missingSeverity: "warning",
  },
  {
    documentId: "operations_runsheet",
    title: "현장 운영 런시트",
    terms: ["현장 운영 런시트", "개장 승인 hold point", "피크 T-30", "폐장 T-30"],
    appliesWhen: "방문객 운영이 있는 모든 행사. 개장 전, 운영 중, 피크, 폐장, 철거 단계별 실행 확인용",
    requirement: () => "required",
    missingSeverity: "warning",
  },
  {
    documentId: "submission_checklist",
    title: "제출·협의 체크리스트",
    terms: ["제출·협의 체크리스트", "제출/확인처", "기한/시점"],
    appliesWhen: "모든 행사. 관할기관·베뉴·협력사 확인용",
    requirement: () => "required",
    missingSeverity: "warning",
  },
  {
    documentId: "incident_report_template",
    title: "사고보고서 템플릿",
    terms: ["사고보고서 템플릿", "사고 일시", "초동조치", "재발방지"],
    appliesWhen: "모든 운영 행사",
    requirement: () => "required",
    missingSeverity: "warning",
  },
  {
    documentId: "visitor_safety_notices",
    title: "다국어 방문객 안전 안내문",
    terms: ["다국어 방문객 안전 안내문", "English", "日本語", "中文"],
    appliesWhen: "방문객이 있는 모든 행사. 대규모/옥외/국제행사는 필수에 가깝게 검토",
    requirement: (_input, ctx) => (ctx.largeCrowd || ctx.isOutdoor || ctx.isExhibition || ctx.isConference || ctx.isPerformance ? "required" : "conditional"),
    missingSeverity: "warning",
  },
];

function buildDocumentCoverageMatrix(text: string, input: Input): DocumentCoverageRow[] {
  const context = buildReviewContext(input);
  return documentCoverageDefinitions.map((definition) => {
    const requirement = definition.requirement(input, context);
    const evidence = locateEvidence(text, definition.terms);
    const status: CoverageStatus = requirement === "not_applicable"
      ? "not_applicable"
      : evidence ? "present" : "missing";
    return {
      documentId: definition.documentId,
      title: definition.title,
      requirement,
      status,
      appliesWhen: definition.appliesWhen,
      missingSeverity: definition.missingSeverity,
      evidence,
    };
  });
}

function formatDocumentCoverageMarkdown(rows: DocumentCoverageRow[]): string {
  return [
    "## 문서 커버리지 매트릭스",
    "| 문서 | 필요도 | 상태 | 적용 조건 | 근거 |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.title} | ${row.requirement} | ${row.status} | ${row.appliesWhen.replace(/\|/g, "/")} | ${row.evidence ? `line ${row.evidence.line}` : ""} |`),
  ].join("\n");
}

function addCoverageFindings(findings: Finding[], coverageRows: DocumentCoverageRow[]): void {
  for (const row of coverageRows) {
    if (row.status !== "missing" || row.requirement === "not_applicable") continue;
    const severity = row.requirement === "required" ? row.missingSeverity ?? "warning" : "info";
    addFinding(
      findings,
      true,
      severity,
      "document_coverage",
      `${row.title} 문서가 커버리지 매트릭스에서 ${row.requirement}인데 누락됐습니다.`,
      `${row.appliesWhen} 조건에 맞는 문서 섹션 또는 별도 파일을 추가하세요.`,
      { requirementId: `REQ_DOC_${row.documentId.toUpperCase()}` },
    );
  }
}

async function resolvePlan(input: Input): Promise<string> {
  if (input.planMarkdown?.trim()) return input.planMarkdown;
  const generated = await generateMiceSafetyPlanTool.handler(input);
  return String(generated.structuredContent?.planMarkdown ?? generated.content[0]?.text ?? "");
}

function review(text: string, input: Input): { findings: Finding[]; documentCoverageMatrix: DocumentCoverageRow[] } {
  const findings: Finding[] = [];
  const context = buildReviewContext(input);
  const isOutdoor = context.isOutdoor;
  const isPerformance = context.isPerformance;
  const hasFood = context.hasFood;
  const hasFoodService = Boolean(input.foodService || hasEvent(input, "food_event"));
  const hasLpg = input.lpgUse === true;
  const hasWorkerWork = context.hasWorkerWork;
  const largeCrowd = context.largeCrowd;
  const unhostedCrowd = context.unhostedCrowd;
  const needsBuildingEgressReview = Boolean(input.venueId || context.isExhibition || context.isConference || input.temporaryStructures);
  const documentCoverageMatrix = buildDocumentCoverageMatrix(text, input);

  addFinding(findings, !includesAny(text, ["행사 개요", "행사명"]), "error", "plan_structure", "행사 개요가 부족합니다.", "행사명, 일자, 장소, 주최/주관, 예상 인원, 행사 유형을 포함하세요.", { requirementId: "REQ_PLAN_OVERVIEW" });
  addFinding(findings, !includesAny(text, ["적용 법령", "법령·근거"]), "error", "legal_basis", "적용 법령 섹션이 없습니다.", "법령/조례/베뉴 규정의 근거 섹션을 추가하세요.", { requirementId: "REQ_LEGAL_BASIS" });
  addFinding(findings, !includesAny(text, ["제출·승인", "안전관리계획서"]), "error", "document_duty", "제출·승인 문서가 부족합니다.", "행사 안전관리계획서, 인파관리계획, 작업자 안전계획, 점검표를 문서 단위로 분리하세요.", { requirementId: "REQ_DOCUMENT_BUNDLE" });
  addFinding(findings, !includesAny(text, ["제출·협의 체크리스트", "제출/확인처", "기한/시점"]), "warning", "submission_checklist", "제출·협의 체크리스트가 부족합니다.", "지자체, 도로관리청, 소방, 베뉴, 위생, 가스, 개인정보, 경비, 의료, 시공협력사별 제출/확인 문서를 표로 정리하세요.", { requirementId: "REQ_SUBMISSION_CHECKLIST" });
  addFinding(findings, !includesAny(text, ["증빙", "기록", "보존"]), "warning", "recordkeeping", "증빙/기록 보존 기준이 약합니다.", "사진, 점검표, 교육명단, 조치 기록, 사고보고서 보존 항목을 넣으세요.", { requirementId: "REQ_RECORDKEEPING" });
  addFinding(findings, !includesAny(text, ["다국어 방문객 안전 안내문", "English", "日本語", "中文", "현장 방송"]), "warning", "visitor_notice", "방문객 안전 안내문이 부족합니다.", "대피, 일시중지, 중단, 현 위치 대기, 운영 재개 시나리오별 한국어/영어/일본어/중국어 안내문을 포함하세요.", { requirementId: "REQ_VISITOR_NOTICE" });
  addFinding(findings, includesAny(text, ["구역 구역", "area area", "エリアエリア", "区域区域"]), "warning", "visitor_notice_quality", "방문객 안내문에 중복 표현이 있습니다.", "구역명 placeholder와 템플릿 접미어가 중복되지 않도록 현지화 문구를 교정하세요.", { requirementId: "REQ_VISITOR_NOTICE_QUALITY", evidenceTerms: ["구역 구역", "area area", "エリアエリア", "区域区域"], text });

  addFinding(findings, isOutdoor && !includesAny(text, ["지자체 조례", "옥외행사 안전관리 조례", "지역축제"]), "error", "local_ordinance", "옥외행사/축제 조례 근거가 누락됐습니다.", "관할 광역/기초 지자체의 옥외행사·지역축제 안전관리 조례 후보를 넣으세요.", { requirementId: "REQ_LOCAL_ORDINANCE" });
  addFinding(findings, isOutdoor && !includesAny(text, ["조례 우선순위", "우선순위 primary", "우선순위 secondary"]), "warning", "local_ordinance_priority", "조례 후보 우선순위 근거가 약합니다.", "베뉴 소재지, 관할 지자체, 옥외행사/도로점용/옥외광고물 조건별로 광역·기초 조례 우선순위를 표시하세요.", { requirementId: "REQ_LOCAL_ORDINANCE_PRIORITY" });
  addFinding(findings, isOutdoor && !includesAny(text, ["제출기한", "일 전", "신고"]), "warning", "submission_deadline", "지자체 제출기한 또는 신고기한이 명확하지 않습니다.", "조례의 행사 개시 전 제출/신고 기한을 계획서 요약에 표시하세요.", { requirementId: "REQ_LOCAL_DEADLINE" });
  addFinding(findings, isOutdoor && !includesAny(text, ["관계기관", "경찰", "소방", "합동점검"]), "warning", "agency_coordination", "관계기관 협의 내용이 부족합니다.", "관할 지자체, 경찰, 소방, 의료/보건, 시설 관계자 협의 항목을 넣으세요.", { requirementId: "REQ_AGENCY_COORDINATION" });
  addFinding(findings, !isOutdoor && includesAny(text, ["옥외행사·지역축제 안전관리계획서"]), "warning", "over_application", "실내/비옥외 행사인데 옥외행사·지역축제 안전관리계획서가 제출 액션처럼 보입니다.", "옥외/축제 조건이 없으면 옥외행사 조례는 참고 후보로 내리거나 제거하세요.", { requirementId: "REQ_NO_OUTDOOR_ORDINANCE_OVERAPPLY", evidenceTerms: ["옥외행사·지역축제 안전관리계획서"], text });

  addFinding(findings, unhostedCrowd && !includesAny(text, ["무주최 다중운집 관계기관 공동대응계획", "주최자 없음", "공동 현장지휘"]), "error", "unhosted_crowd_governance", "무주최 다중운집 공동대응계획이 부족합니다.", "주최자 없음, 책임 공백, 공동 현장지휘, 관계기관 합동상황반, 기관별 권한 경계를 별도 문서로 분리하세요.", { requirementId: "REQ_UNHOSTED_CROWD_RESPONSE" });
  addFinding(findings, unhostedCrowd && !includesAny(text, ["지자체 재난안전상황실", "경찰 현장지휘", "소방 현장지휘", "시설관리자", "교통 운영기관"]), "error", "unhosted_crowd_raci", "무주최 상황의 기관별 RACI가 부족합니다.", "지자체, 경찰, 소방, 시설관리자, 철도/버스/택시 등 교통 운영기관의 Responsible/Accountable/Consulted/Informed를 명시하세요.", { requirementId: "REQ_UNHOSTED_CROWD_RACI" });
  addFinding(findings, unhostedCrowd && !includesAny(text, ["관찰", "주의", "경계", "심각", "해산·분산"]), "warning", "unhosted_crowd_threshold", "무주최 다중운집 상황 단계와 분산 기준이 약합니다.", "관찰/주의/경계/심각 단계별 출입 제한, 현 위치 대기, 대중교통 조정, 대피개시, 해산·분산 안내 기준을 넣으세요.", { requirementId: "REQ_UNHOSTED_CROWD_THRESHOLDS" });
  addFinding(findings, unhostedCrowd && !includesAny(text, ["방송", "전광판", "SNS", "문자", "상황전파"]), "warning", "unhosted_crowd_public_notice", "무주최 다중운집 외부 안내 채널이 부족합니다.", "주최자가 없는 상황에서도 방송, 전광판, 역사 안내, SNS, 문자, 현장 안내요원 문구를 일관되게 관리하세요.", { requirementId: "REQ_UNHOSTED_CROWD_NOTICE" });

  addFinding(findings, largeCrowd && !includesAny(text, ["인파", "동선", "혼잡", "밀집"]), "error", "crowd_control", "대규모 인파 관리계획이 누락됐습니다.", "구역별 수용능력, 게이트 처리량, 대기열, 우회동선, 혼잡 단계별 통제 기준을 넣으세요.", { requirementId: "REQ_CROWD_FLOW" });
  addFinding(findings, largeCrowd && !includesAny(text, ["AED", "응급", "의무실", "119"]), "warning", "medical_response", "응급의료/AED 대응이 부족합니다.", "AED, 의무실, 119 신고, 구급차 접근동선, 이송병원 정보를 넣으세요.", { requirementId: "REQ_MEDICAL_RESPONSE" });
  addFinding(findings, largeCrowd && !includesAny(text, ["관리책임자", "월 1회", "사용교육", "응급장비", "구급차"]), "warning", "medical_aed_management", "AED 관리책임자·점검·사용교육 또는 구급 이송 기준이 부족합니다.", "AED 관리책임자, 월 1회 점검, 사용교육, 관리서류, 구급차 장비·소독·통신·운행기록 기준을 넣으세요.", { requirementId: "REQ_MEDICAL_AED_MANAGEMENT" });
  addFinding(findings, largeCrowd && !includesAny(text, ["특정소방대상물", "수용인원", "별표 7", "소방안전관리자"]), "warning", "fire_evacuation_annex", "대규모 행사 소방 하위기준 체크포인트가 부족합니다.", "특정소방대상물, 수용인원 산정, 소방시설, 소방안전관리자/보조자 기준을 점검표에 반영하세요.", { requirementId: "REQ_FIRE_FACILITY_ANNEX" });
  addFinding(findings, needsBuildingEgressReview && !includesAny(text, ["직통계단", "피난계단", "옥외 피난계단", "피난층", "가설건축물", "피난안전 확인서", "임시사용승인"]), "warning", "building_egress", "건축 피난시설 근거가 약합니다.", "직통계단, 피난계단, 옥외 피난계단, 가설건축물 피난안전 확인, 임시사용승인 등 건축 하위 기준을 확인하세요.", { requirementId: "REQ_BUILDING_EGRESS" });

  addFinding(findings, input.roadUse === true && !includesAny(text, ["도로점용", "도로법", "교통통제"]), "error", "road_occupancy", "도로점용/교통통제 조건이 누락됐습니다.", "도로점용허가, 교통소통대책, 경찰 협의, 보행자 안전대책을 넣으세요.", { requirementId: "REQ_ROAD_OCCUPANCY" });
  addFinding(findings, input.roadUse === true && !includesAny(text, ["도로공사 시행 허가 신청서", "통행의 금지", "차량의 운행 제한", "도로공사 착수 신고서", "준공검사 신청서"]), "warning", "road_forms", "도로점용/교통통제 제출서식 체크포인트가 약합니다.", "도로공사 시행 허가, 착수 신고, 준공검사, 통행 금지·차량 운행 제한 공고 서식 대상 여부를 확인하세요.", { requirementId: "REQ_ROAD_FORMS" });
  addFinding(findings, input.roadUse === true && !includesAny(text, ["도로·교통 실행계획", "교통통제 도면", "비상차량 접근로", "원상복구"]), "error", "road_traffic_execution", "도로·교통 실행계획 문서가 부족합니다.", "통제구간, 우회동선, 비상차량 접근로, 셔틀·승하차, 원상복구, 증빙을 별도 실행계획으로 분리하세요.", { requirementId: "REQ_ROAD_TRAFFIC_EXECUTION" });
  addFinding(findings, input.roadUse === true && !includesAny(text, ["셔틀", "주차장", "승하차", "버스정류장", "택시"]), "warning", "external_queue_transport", "외부 교통·승하차·주차 대기열 관리가 부족합니다.", "셔틀·택시·버스 승하차장, 주차장 진입 대기, 역/정류장 대기열, 보행자 역류 방지 기준을 넣으세요.", { requirementId: "REQ_EXTERNAL_QUEUE_TRANSPORT" });
  addFinding(findings, input.roadUse === true && !includesAny(text, ["옥외광고물", "현수막", "배너", "안내판", "전광"]), "warning", "outdoor_signage", "옥외광고물·임시 안내표지 기준이 부족합니다.", "현수막, 배너, 안내판, 지주형 표시물, 전광류/전기 사용 광고물의 허가·신고·고정·보행 방해 여부를 확인하세요.", { requirementId: "REQ_OUTDOOR_SIGNAGE" });
  addFinding(findings, input.roadUse !== true && includesAny(text, ["도로법", "도로점용허가"]) && !isOutdoor, "warning", "over_application", "도로점용 조건이 없는데 도로 법령이 적용됐을 수 있습니다.", "실내행사 또는 도로 미사용 행사라면 도로점용 법령을 조건부 후보로 낮추세요.", { requirementId: "REQ_NO_ROAD_OVERAPPLY", evidenceTerms: ["도로법", "도로점용허가"], text });
  addFinding(findings, input.roadUse !== true && includesAny(text, ["| 도로관리청/교통부서/경찰 | 도로점용허가", "도로관리청/교통부서/경찰,도로점용허가"]), "warning", "over_application", "도로점용 조건이 없는데 도로점용허가가 제출 일정으로 승격됐습니다.", "도로·보도·광장 점용 또는 통행 제한이 확정될 때만 제출 액션으로 올리고, 그 전에는 조건부 확인으로 유지하세요.", { requirementId: "REQ_NO_ROAD_SUBMISSION_OVERAPPLY", evidenceTerms: ["도로관리청/교통부서/경찰"], text });
  addFinding(findings, input.outdoorAdvertising !== true && includesAny(text, ["| 옥외광고 담당부서/베뉴 | 현수막", "옥외광고 담당부서/베뉴,현수막"]), "warning", "over_application", "옥외광고물 설치 조건이 없는데 허가/신고가 제출 일정으로 승격됐습니다.", "현수막, 배너, 지주형 표시물, 전광류 설치가 확정될 때만 제출 액션으로 올리고, 그 전에는 조건부 확인으로 유지하세요.", { requirementId: "REQ_NO_OUTDOOR_AD_SUBMISSION_OVERAPPLY", evidenceTerms: ["옥외광고 담당부서/베뉴"], text });

  addFinding(findings, hasFood && !includesAny(text, ["식품위생", "식중독"]), "error", "food_safety", "식음료/식중독 관리가 누락됐습니다.", "영업허가·신고, 위생, 냉장/보온, 식중독 보고 절차를 넣으세요.", { requirementId: "REQ_FOOD_SAFETY" });
  addFinding(findings, input.lpgUse === true && !includesAny(text, ["LPG", "액화석유가스", "가스용기"]), "error", "gas_safety", "LPG/가스 안전 항목이 누락됐습니다.", "가스용기 전도방지, 누출점검, 이격거리, 소화기, 베뉴 반입승인을 넣으세요.", { requirementId: "REQ_LPG_GAS" });
  addFinding(findings, hasFood && !includesAny(text, ["식품등의 위생적인 취급", "별표 1", "별표 17", "별표 20", "하위 별표"]), "warning", "legal_annex", "식품/LPG 별표 체크포인트가 부족합니다.", "식품위생 취급기준, LPG 용기 안전점검기준, LPG 사용시설 시설·기술·검사기준을 점검표에 반영하세요.", { requirementId: "REQ_FOOD_LPG_ANNEX" });
  addFinding(findings, input.lpgUse === true && !includesAny(text, ["완성, 정기", "검사증명서", "가스공급자의 안전점검기준", "보험금액", "공사계획"]), "warning", "lpg_forms", "LPG 검사·보험·공사계획 서식 체크포인트가 약합니다.", "완성/정기검사 신청서, 검사증명서, 공급자 안전점검기준, 공사계획 승인·신고, 보험금액 기준을 반영하세요.", { requirementId: "REQ_LPG_FORMS" });
  addFinding(findings, hasFoodService && !includesAll(text, ["현장 실행 상태표", "보존식", "냉장·보온 온도기록", "판매중지", "보건소"]), "warning", "food_field_execution", "식음료 현장 실행 기준이 부족합니다.", "현장 실행 상태표에 보존식, 냉장·보온 온도기록, 판매중지 기준, 보건소 연락 기준을 넣으세요.", { requirementId: "REQ_FOOD_FIELD_EXECUTION", evidenceTerms: ["현장 실행 상태표", "보존식", "냉장·보온 온도기록", "판매중지", "보건소"], text });
  addFinding(findings, hasLpg && !includesAll(text, ["가스용기 반입대장", "누설점검", "밸브 차단", "환기", "화기 사용 즉시 중지", "소화기", "화기 이격거리"]), "warning", "lpg_field_execution", "LPG 현장 실행 기준이 부족합니다.", "가스용기 반입대장, 누설점검, 밸브 차단, 환기, 화기 사용 즉시 중지, 소화기, 화기 이격거리 기준을 넣으세요.", { requirementId: "REQ_LPG_FIELD_EXECUTION", evidenceTerms: ["가스용기 반입대장", "누설점검", "밸브 차단", "환기", "화기 사용 즉시 중지", "소화기", "화기 이격거리"], text });
  addFinding(findings, (hasFoodService || hasLpg) && !includesAll(text, ["조치 전후 사진", "온도기록", "검사증명", "보존식 라벨"]), "warning", "food_lpg_evidence", "식음료/LPG 증빙 기준이 약합니다.", "온도기록, 검사증명, 보존식 라벨, 조치 전후 사진을 증빙 항목으로 명시하세요.", { requirementId: "REQ_FOOD_LPG_EVIDENCE", evidenceTerms: ["조치 전후 사진", "온도기록", "검사증명", "보존식 라벨"], text });
  addFinding(findings, !hasFood && includesAny(text, ["식품위생법", "액화석유가스법", "식중독"]), "warning", "over_application", "식음료 조건이 없는데 식품/LPG 법령이 적용됐을 수 있습니다.", "식음료가 없는 행사라면 해당 법령을 제거하거나 조건부 후보로 표시하세요.", { requirementId: "REQ_NO_FOOD_OVERAPPLY", evidenceTerms: ["식품위생법", "액화석유가스법", "식중독"], text });

  addFinding(findings, isPerformance && !includesAny(text, ["공연법", "재해대처계획", "피난안내"]), "error", "performance_safety", "공연 안전 법령/재해대처계획이 누락됐습니다.", "공연법 재해대처계획, 안전관리조직, 안전교육, 피난안내를 넣으세요.", { requirementId: "REQ_PERFORMANCE_SAFETY" });
  addFinding(findings, isPerformance && !includesAny(text, ["별표 1", "별표 1의2", "별지 제13호의3", "하위 별표"]), "warning", "legal_annex", "공연법 시행령 별표/시행규칙 서식 체크포인트가 부족합니다.", "안전관리조직 설치기준, 안전교육 내용, 재해대처계획 신고서식 첨부서류를 반영하세요.", { requirementId: "REQ_PERFORMANCE_ANNEX_FORM" });
  addFinding(findings, isPerformance && !includesAll(text, ["공연·무대 실행계획", "현장 실행 상태표", "무대·트러스 구조검토", "리깅 승인", "방염확인서", "스탠딩 펜스", "피난안내", "공연중지 기준", "무대감독"]), "warning", "performance_stage_execution", "공연·무대 현장 실행 기준이 부족합니다.", "공연·무대 실행계획에 무대·트러스 구조검토, 리깅 승인, 방염확인서, 스탠딩 펜스, 피난안내, 공연중지 기준, 무대감독 중지 신호를 넣으세요.", { requirementId: "REQ_PERFORMANCE_STAGE_EXECUTION", evidenceTerms: ["공연·무대 실행계획", "현장 실행 상태표", "무대·트러스 구조검토", "리깅 승인", "방염확인서", "스탠딩 펜스", "피난안내", "공연중지 기준", "무대감독"], text });
  addFinding(findings, isPerformance && !includesAll(text, ["무대 전면 압박", "아티스트/무대감독 중지 신호", "전원 차단", "관객 현 위치 대기", "조치 전후 사진"]), "warning", "performance_stop_resume", "공연 중지·재개 증빙 기준이 약합니다.", "무대 전면 압박, 아티스트/무대감독 중지 신호, 전원 차단, 관객 현 위치 대기, 조치 전후 사진 기준을 명시하세요.", { requirementId: "REQ_PERFORMANCE_STOP_RESUME", evidenceTerms: ["무대 전면 압박", "아티스트/무대감독 중지 신호", "전원 차단", "관객 현 위치 대기", "조치 전후 사진"], text });
  addFinding(findings, !isPerformance && includesAny(text, ["공연법 시행령", "공연법 시행규칙", "공연 재해대처계획"]), "warning", "over_application", "공연 조건이 없는데 공연법이 적용됐을 수 있습니다.", "공연 프로그램이 없다면 공연법 항목을 제거하거나 조건부 후보로 낮추세요.", { requirementId: "REQ_NO_PERFORMANCE_OVERAPPLY", evidenceTerms: ["공연법 시행령", "공연법 시행규칙", "공연 재해대처계획"], text });

  addFinding(findings, hasWorkerWork && !includesAny(text, ["산업안전보건기준", "산안기준규칙", "KOSHA", "작업자 안전계획서"]), "error", "worker_safety", "설치·철거 작업자 안전계획이 누락됐습니다.", "산안기준규칙 제38조/제42조, KOSHA Guide, 작업계획서, 보호구, 작업중지 기준을 넣으세요.", { requirementId: "REQ_WORKER_SAFETY" });
  addFinding(findings, input.workAtHeight === true && !includesAny(text, ["추락", "사다리", "고소작업대", "안전대"]), "error", "fall_prevention", "고소작업/추락 방지 항목이 부족합니다.", "사다리, 고소작업대, 작업발판, 안전대, 작업구역 통제 기준을 넣으세요.", { requirementId: "REQ_FALL_PREVENTION" });
  addFinding(findings, input.heavyObjectHandling === true && !includesAny(text, ["중량물", "하역", "줄걸이", "지게차"]), "error", "heavy_object", "중량물/하역 안전 항목이 부족합니다.", "중량, 무게중심, 운반경로, 작업지휘자, 하부 출입금지, 장비 점검을 넣으세요.", { requirementId: "REQ_HEAVY_OBJECT" });
  addFinding(findings, !hasWorkerWork && includesAny(text, ["설치·철거 작업자 안전계획서 — 법정 의무", "worker_safety_work_plan"]), "warning", "over_application", "설치·철거 조건이 없는데 작업자 안전계획이 필수로 적용됐을 수 있습니다.", "작업 조건이 없으면 worker_safety_work_plan을 조건부 후보로 낮추세요.", { requirementId: "REQ_NO_WORKER_OVERAPPLY", evidenceTerms: ["설치·철거 작업자 안전계획서", "worker_safety_work_plan"], text });

  addFinding(findings, input.personalDataProcessing === true && !includesAny(text, ["개인정보", "CCTV", "출입증", "QR"]), "error", "privacy", "개인정보/CCTV 처리 항목이 누락됐습니다.", "수집항목, 목적, 보관기간, 위탁, CCTV 안내, 촬영 고지를 넣으세요.", { requirementId: "REQ_PRIVACY_CCTV" });
  addFinding(findings, input.personalDataProcessing === true && !includesAny(text, ["처리방침", "수탁자", "접근권한", "접속기록", "암호화"]), "warning", "privacy_security", "개인정보 처리방침/위탁/안전성 확보 조치가 약합니다.", "등록·QR·출입증 위탁, 수탁자 공개, 접근권한, 접속기록, 암호화, 현장 단말 잠금 기준을 넣으세요.", { requirementId: "REQ_PRIVACY_SECURITY" });
  addFinding(findings, !context.hasPrivacy && includesAny(text, ["개인정보 보호책임자/등록 대행사/보안 담당"]), "warning", "over_application", "개인정보 처리 조건이 없는데 개인정보 제출 액션이 생성됐습니다.", "등록, QR/출입증, CCTV, 촬영, 앱 신고, VIP/초청자 명단 처리 조건이 확인될 때만 제출 액션으로 올리세요.", { requirementId: "REQ_NO_PRIVACY_SUBMISSION_OVERAPPLY", evidenceTerms: ["개인정보 보호책임자/등록 대행사/보안 담당"], text });
  addFinding(findings, Boolean(input.vipSecurity || hasEvent(input, "vip_event")) && !includesAny(text, ["경비업법", "경비지도사", "경비원 명부", "배치신고", "보안검색"]), "error", "security_access", "VIP/보안검색 조건인데 경비업·출입통제 계획이 부족합니다.", "민간경비 허가 업무 범위, 경비지도사, 경비원 교육·명부, 배치신고, 경찰·소방·베뉴 보안실 연락 기준을 넣으세요.", { requirementId: "REQ_SECURITY_ACCESS_CONTROL" });
  addFinding(findings, !Boolean(input.vipSecurity || hasEvent(input, "vip_event")) && includesAny(text, ["경비업법 시행령 별표", "경비원 배치·배치폐지 신고서"]), "warning", "over_application", "VIP/민간경비 조건이 없는데 경비업 하위기준이 적용됐을 수 있습니다.", "단순 안내 스태프만 배치하는 행사라면 경비업법 하위기준을 조건부 후보로 낮추세요.", { requirementId: "REQ_NO_SECURITY_OVERAPPLY", evidenceTerms: ["경비업법 시행령 별표", "경비원 배치·배치폐지 신고서"], text });
  addFinding(findings, !context.hasVipSecurity && includesAny(text, ["| 경찰/경비업체/베뉴 보안실 | 경비업 허가 범위", "경찰/경비업체/베뉴 보안실,경비업 허가 범위"]), "warning", "over_application", "VIP/민간경비 조건이 없는데 경비업 제출 액션이 생성됐습니다.", "VIP, 보안검색, 민간경비, 혼잡·교통유도경비가 확정될 때만 경비업 제출 액션으로 올리세요.", { requirementId: "REQ_NO_SECURITY_SUBMISSION_OVERAPPLY", evidenceTerms: ["경찰/경비업체/베뉴 보안실"], text });
  addFinding(findings, Boolean(input.venueId) && !includesAny(text, ["베뉴", "시설 체크", "금지", "반입", "운영규정"]), "warning", "venue_rules", "베뉴 규정 반영이 약합니다.", "venueId에 해당하는 베뉴 금지물품, 반입/하역, 소방통로, 작업승인 규정을 넣으세요.", { requirementId: "REQ_VENUE_RULES" });
  addFinding(findings, Boolean(input.venueId) && !includesAny(text, ["베뉴 시설·수용", "바닥하중", "하역", "전기", "추정 밀도"]), "warning", "venue_facility_constraints", "베뉴 수용/하중/전기/하역 제약 반영이 약합니다.", "venue-facility-index의 수용·면적, 바닥하중, 층고, 반입·하역, 전기, 소방·피난 sourceSpan을 계획서에 반영하세요.", { requirementId: "REQ_VENUE_FACILITY_CONSTRAINTS" });
  addCoverageFindings(findings, documentCoverageMatrix);

  return { findings, documentCoverageMatrix };
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const planMarkdown = await resolvePlan(input);
  const reviewOutput = review(planMarkdown, input);
  const { findings, documentCoverageMatrix } = reviewOutput;
  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const verdict = errorCount > 0 ? "needs_revision" : warningCount > 0 ? "usable_with_review" : "usable";
  const penalty = findings.reduce((sum, finding) => sum + finding.weight, 0);
  const score = Math.max(0, 100 - penalty);
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

  const text = [
    "# MICE 안전계획 검수 결과",
    `판정: ${verdict} / 점수: ${score} (${grade}) / error=${errorCount}, warning=${warningCount}`,
    "",
    "> 점수는 법적 적합성 점수가 아니라 입력 조건 대비 문서·항목 커버리지 자동 점검값입니다. 최종 제출 전 최신 법령 원문, 조례, 관할기관 답변, 베뉴 승인조건으로 확인해야 합니다.",
    "",
    formatDocumentCoverageMarkdown(documentCoverageMatrix),
    "",
    findings.length > 0
      ? findings.map((finding) => {
        const evidence = finding.evidence ? ` (근거 위치: line ${finding.evidence.line})` : "";
        return `- [${finding.severity}] ${finding.requirementId}/${finding.category}: ${finding.message}${evidence} → ${finding.recommendation}`;
      }).join("\n")
      : "- 주요 누락 없음",
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      input,
      verdict,
      score,
      grade,
      counts: { error: errorCount, warning: warningCount, total: findings.length },
      findings,
      documentCoverageMatrix,
      planMarkdown,
      _meta: COMMON_RESPONSE_META,
    },
  };
}

export const reviewMiceSafetyPlanTool: ToolDefinition = {
  name: "review_mice_safety_plan",
  title: "MICE 안전계획 검수",
  description:
    "생성된 MICE 안전관리계획서가 법령/조례/베뉴/작업자 안전/도로·교통/무주최 다중운집/인파/소방/응급/증빙 요건을 충족하는지 검수하고 과잉 적용 후보를 지적합니다.",
  inputSchema,
  handler,
};
