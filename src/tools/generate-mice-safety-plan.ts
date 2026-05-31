import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import { baseMiceEventInputSchema, type MiceEventType } from "../lib/mice-event-input-schema.js";
import type { McpToolResult, Strictness, ToolDefinition } from "../lib/types.js";
import { findLegalAnnexes, strictnessLabel, uniqueById } from "../lib/mice-data.js";
import { buildDefaultMiceVisitorNoticeBundle } from "../lib/mice-visitor-notices.js";
import { buildPublicApiOperationalEvidence, type PublicApiOperationalEvidenceBundle } from "../lib/public-api-operational-evidence.js";
import submissionActionRules from "../ontology/mice/submission-action-rules.json" with { type: "json" };
import venueFacilityIndex from "../ontology/mice/venue-facility-index.json" with { type: "json" };
import { queryMiceSafetyApplicabilityTool } from "./query-mice-safety-applicability.js";

const inputSchema = baseMiceEventInputSchema.extend({
  output: z.enum(["markdown", "structured"]).optional().default("markdown"),
});

type Input = z.infer<typeof inputSchema>;

type AnyRecord = Record<string, unknown>;

interface FacilityIndexEntry {
  id: string;
  venueId: string;
  category: string;
  value: string;
  sourceRef: string;
  localMarkdownPath: string;
  line: number | null;
  confidence: number;
}

const facilityIndexData = venueFacilityIndex as {
  venues: Array<{ venueId: string; entries: FacilityIndexEntry[] }>;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function lineList(items: string[], fallback: string): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : [`- ${fallback}`];
}

function uniqueStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function facilityEntriesForVenue(venueId: string | undefined): FacilityIndexEntry[] {
  if (!venueId) return [];
  return facilityIndexData.venues.find((venue) => venue.venueId === venueId)?.entries ?? [];
}

function valuesFor(entries: FacilityIndexEntry[], category: string, limit = 5): string[] {
  return uniqueStrings(entries
    .filter((entry) => entry.category === category)
    .sort((a, b) => b.confidence - a.confidence)
    .map((entry) => entry.value))
    .slice(0, limit);
}

function sourceSpansFor(entries: FacilityIndexEntry[], categories: string[], limit = 10): FacilityIndexEntry[] {
  const categorySet = new Set(categories);
  return entries
    .filter((entry) => categorySet.has(entry.category))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

function maxNumberByPattern(values: string[], pattern: RegExp): number | null {
  const matches = values.flatMap((value) => Array.from(value.matchAll(pattern)))
    .map((match) => Number(String(match[1]).replace(/,/g, "")))
    .filter((value) => Number.isFinite(value));
  return matches.length > 0 ? Math.max(...matches) : null;
}

function formatMaybe(value: number | null, suffix: string, digits = 0): string | null {
  if (value === null) return null;
  return `${value.toFixed(digits)}${suffix}`;
}

function firstSpan(sourceSpans: FacilityIndexEntry[], category: string): Record<string, unknown> | undefined {
  const span = sourceSpans.find((entry) => entry.category === category);
  if (!span) return undefined;
  return {
    sourceRef: span.sourceRef,
    localMarkdownPath: span.localMarkdownPath,
    line: span.line,
    confidence: span.confidence,
  };
}

function numericFact(value: number | null, unit: string, category: string, sourceSpans: FacilityIndexEntry[], note: string): Record<string, unknown> | undefined {
  if (value === null) return undefined;
  return {
    value,
    unit,
    category,
    sourceSpan: firstSpan(sourceSpans, category),
    confidence: firstSpan(sourceSpans, category) ? "derived_from_structured_extract" : "derived_from_text",
    note,
  };
}

function buildVenueFacilitySummary(input: Input, venue: AnyRecord | null | undefined) {
  const entries = facilityEntriesForVenue(input.venueId);
  const capacity = valuesFor(entries, "capacity", 5);
  const floorLoad = valuesFor(entries, "floorLoad", 5);
  const ceilingHeight = valuesFor(entries, "ceilingHeight", 4);
  const freightEntrance = valuesFor(entries, "freightEntrance", 4);
  const loadingDock = valuesFor(entries, "loadingDock", 4);
  const electricity = valuesFor(entries, "electricity", 5);
  const fireLane = valuesFor(entries, "fireLane", 4);
  const evacuationRoutes = valuesFor(entries, "evacuationRoutes", 4);
  const restrictedItems = valuesFor(entries, "restrictedItems", 4);
  const boothRules = valuesFor(entries, "boothRules", 4);
  const riggingRules = valuesFor(entries, "riggingRules", 4);
  const foodRules = valuesFor(entries, "foodRules", 4);
  const safetyDocuments = valuesFor(entries, "safetyDocuments", 5);

  const areaSqm = maxNumberByPattern(capacity, /([\d,]+(?:\.\d+)?)\s*㎡/g);
  const capacityPersons = maxNumberByPattern(capacity, /([\d,]+(?:\.\d+)?)\s*명/g);
  const boothCount = maxNumberByPattern(capacity, /(?:최대\s*)?([\d,]+)\s*부스/g);
  const floorLoadKgPerSqm = maxNumberByPattern(floorLoad, /([\d,]+(?:\.\d+)?)\s*(?:kg|㎏|kgf)\s*\/?\s*(?:㎡|m2|m²)/gi);
  const ceilingHeightM = maxNumberByPattern(ceilingHeight, /([\d,]+(?:\.\d+)?)\s*(?:m|M|미터)/g);
  const estimatedDensity = areaSqm && input.expectedCrowd !== undefined ? input.expectedCrowd / areaSqm : null;
  const fireAnnex7Capacity = areaSqm ? Math.floor(areaSqm / 4.6) : null;

  const derived = [
    areaSqm ? `면적 추출값: ${formatMaybe(areaSqm, "㎡")}` : undefined,
    boothCount ? `부스 수 추출값: 최대 ${formatMaybe(boothCount, "부스")}` : undefined,
    estimatedDensity !== null ? `예상 인원/추출 면적 기준 추정 밀도: ${estimatedDensity.toFixed(2)}명/㎡` : undefined,
    fireAnnex7Capacity !== null ? `소방시설법 시행령 별표 7 면적 산정 참고값: 약 ${fireAnnex7Capacity.toLocaleString("ko-KR")}명(면적/4.6㎡, 실제 동시 체류·좌석·도면 기준 재확인 필요)` : undefined,
    estimatedDensity !== null && estimatedDensity > 0.5 ? "피크 동시인원, 게이트 처리량, 대기열, 피난폭을 베뉴 도면 기준으로 별도 재산정한다." : undefined,
  ].filter((item): item is string => Boolean(item));

  const sourceSpans = sourceSpansFor(entries, [
    "capacity",
    "floorLoad",
    "ceilingHeight",
    "freightEntrance",
    "loadingDock",
    "electricity",
    "fireLane",
    "evacuationRoutes",
    "restrictedItems",
    "boothRules",
    "riggingRules",
    "foodRules",
    "safetyDocuments",
  ]);
  const numericFacts = {
    areaSqm: numericFact(areaSqm, "sqm", "capacity", sourceSpans, "베뉴 capacity 텍스트에서 추출한 최대 면적 후보. 홀별 실제 사용면적은 도면과 베뉴 담당자로 재확인한다."),
    capacityPersons: numericFact(capacityPersons, "persons", "capacity", sourceSpans, "베뉴 capacity 텍스트에서 추출한 인원 후보. 피크 동시 체류 인원과 좌석/스탠딩 구성을 별도 확인한다."),
    boothCount: numericFact(boothCount, "booths", "capacity", sourceSpans, "베뉴 capacity 텍스트에서 추출한 최대 부스 수 후보."),
    floorLoadKgPerSqm: numericFact(floorLoadKgPerSqm, "kg_per_sqm", "floorLoad", sourceSpans, "바닥하중 텍스트에서 추출한 kg/㎡ 후보. 중량물 반입 전 하중분산계획과 베뉴 승인이 필요하다."),
    ceilingHeightM: numericFact(ceilingHeightM, "m", "ceilingHeight", sourceSpans, "층고 텍스트에서 추출한 m 후보. 리깅·현수막·고소작업 전 현장 실측과 승인 조건을 확인한다."),
    estimatedDensity: numericFact(estimatedDensity, "persons_per_sqm", "capacity", sourceSpans, "expectedCrowd / areaSqm 단순 계산값. 법적 수용인원이나 피난 산정을 대체하지 않는다."),
    fireAnnex7Capacity: numericFact(fireAnnex7Capacity, "persons", "capacity", sourceSpans, "면적/4.6㎡ 참고 계산값. 실제 특정소방대상물 수용인원 산정은 용도·좌석·도면 기준으로 재확인한다."),
  };

  return {
    venueName: String(venue?.name ?? input.venueId ?? "베뉴 미지정"),
    venueId: input.venueId,
    capacity,
    floorLoad,
    ceilingHeight,
    freightEntrance,
    loadingDock,
    electricity,
    fireLane,
    evacuationRoutes,
    restrictedItems,
    boothRules,
    riggingRules,
    foodRules,
    safetyDocuments,
    derived,
    numericFacts,
    sourceSpans,
  };
}

function flagSummary(input: Input): string[] {
  const flags: string[] = [];
  if (input.outdoor || input.outdoorEvent) flags.push("옥외행사");
  if (input.roadUse) flags.push("도로점용/교통통제");
  if (input.outdoorAdvertising) flags.push("옥외광고물/외부 안내표지");
  if (input.unhostedCrowd) flags.push("무주최 다중운집");
  if (input.temporaryStructures) flags.push("임시구조물/부스/무대");
  if (input.temporaryElectricity) flags.push("임시전기");
  if (input.setupTeardown) flags.push("설치·철거");
  if (input.workAtHeight) flags.push("고소작업");
  if (input.heavyObjectHandling) flags.push("중량물");
  if (input.hotWork) flags.push("화기작업");
  if (input.lpgUse) flags.push("LPG/가스");
  if (input.foodService) flags.push("식음료");
  if (input.personalDataProcessing) flags.push("개인정보/CCTV");
  if (input.vipSecurity) flags.push("VIP/보안");
  return flags;
}

function formatLaw(law: AnyRecord): string {
  const articles = asArray<AnyRecord>(law.articles)
    .slice(0, 4)
    .map((article) => `${article.article ?? ""} ${article.title ?? ""}`.trim())
    .filter(Boolean)
    .join(", ");
  return `${law.name ?? law.id} (${law.shortName ?? law.id})${articles ? `: ${articles}` : ""}`;
}

function formatDuty(duty: AnyRecord): string {
  const strictness = typeof duty.strictness === "string" ? strictnessLabel(duty.strictness as Strictness) : "구분 없음";
  return `${duty.title ?? duty.id} — ${strictness}: ${duty.requiredWhen ?? ""}`;
}

function formatHazard(hazard: AnyRecord): string {
  const controls = asArray<string>(hazard.controls).slice(0, 3);
  return [
    `${hazard.label ?? hazard.id} (${hazard.riskLevel ?? "risk"})`,
    ...controls.map((control) => `  - ${control}`),
  ].join("\n");
}

function formatVenueRule(rule: AnyRecord): string {
  const checkpoints = asArray<string>(rule.checkpoints).slice(0, 4);
  return [
    `${rule.summary ?? rule.id}`,
    ...checkpoints.map((checkpoint) => `  - ${checkpoint}`),
  ].join("\n");
}

function formatLocalOrdinance(record: AnyRecord): string {
  const extracts = asArray<AnyRecord>(record.articleExtracts)
    .slice(0, 1)
    .map((article) => {
      const excerpt = String(article.textExcerpt ?? "");
      return `  - 핵심 발췌: ${article.title ?? article.article}: ${excerpt.length > 180 ? `${excerpt.slice(0, 180)}...` : excerpt}`;
    });
  const priorityReasons = asArray<string>(record.priorityReasons);
  const thresholdStructured = record.thresholdStructured as AnyRecord | undefined;
  const thresholdSummary = String(thresholdStructured?.summary ?? record.crowdThreshold ?? "확인 필요");
  const thresholdConfidence = String(thresholdStructured?.confidence ?? "확인 필요");
  const verificationStatus = String(record.verificationStatus ?? "확인 필요");
  const basisLevel = localOrdinanceBasisLevel(record);
  return [
    `${record.jurisdiction ?? ""} — ${record.name ?? ""} (${record.categoryLabel ?? ""}, 시행 ${record.effectiveAt ?? "확인 필요"})`,
    `  - 조례 우선순위: ${record.priorityBand ?? "reference"} / ${record.priorityScore ?? 0}점${priorityReasons.length > 0 ? ` — ${priorityReasons.join("; ")}` : ""}`,
    `  - 검증상태: ${verificationStatus} / threshold: ${thresholdConfidence}`,
    `  - 근거수준: ${basisLevel}`,
    `  - 적용: ${record.appliesWhen ?? "확인 필요"}`,
    `  - 인원/조건: ${thresholdSummary}`,
    `  - 제출기한: ${record.submissionDeadline ?? "확인 필요"}`,
    ...extracts,
  ].join("\n");
}

function localOrdinanceBasisLevel(record: AnyRecord): string {
  const verificationStatus = String(record.verificationStatus ?? "");
  const thresholdStructured = record.thresholdStructured as AnyRecord | undefined;
  if (verificationStatus === "article_verified") {
    return "조문 발췌 확인(article_verified). 제출 전 최신 시행일과 관할기관 해석은 재확인";
  }
  if (verificationStatus === "source_verified") {
    return "공식 출처 확인(source_verified). 적용 기준·제출기한·인원 threshold는 원문 조문 확인 필요";
  }
  if (verificationStatus === "needs_review" || thresholdStructured?.confidence === "needs_review") {
    return "needs_review. threshold/조문 추출 품질 확인 후 제출 여부 판단";
  }
  return "검증 등급 확인 필요. 제출 전 원문과 관할기관 답변으로 보정";
}

function localOrdinanceTitle(record: AnyRecord): string {
  const jurisdiction = String(record.jurisdiction ?? "").trim();
  const name = String(record.name ?? record.ordinanceName ?? "조례").trim();
  if (!jurisdiction || name.startsWith(jurisdiction)) return name;
  return `${jurisdiction} ${name}`;
}

function localOrdinanceBand(record: AnyRecord): string {
  const band = String(record.priorityBand ?? "reference");
  return ["primary", "secondary", "reference"].includes(band) ? band : "reference";
}

function formatLocalOrdinanceGroup(records: AnyRecord[], bands: string[]): string[] {
  return records
    .filter((record) => bands.includes(localOrdinanceBand(record)))
    .map(formatLocalOrdinance);
}

function isLocalOrdinanceApplicableToInput(record: AnyRecord, input: Input): boolean {
  const category = String(record.categoryId ?? record.category ?? "");
  const hasOutdoor = Boolean(input.outdoor || input.outdoorEvent || inputHasEvent(input, "festival") || inputHasEvent(input, "outdoor_event"));
  const hasRoadUse = input.roadUse === true;
  if (["outdoor_event_safety", "regional_festival_safety"].includes(category)) return hasOutdoor;
  if (category === "road_occupancy") return hasRoadUse;
  if (category === "outdoor_advertising") return hasOutdoor || hasRoadUse;
  return true;
}

function filterLocalOrdinancesForInput(records: AnyRecord[], input: Input): AnyRecord[] {
  return records.filter((record) => isLocalOrdinanceApplicableToInput(record, input));
}

function markdownTable(headers: string[], rows: string[][]): string[] {
  return [
    `| ${headers.map(tableCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(tableCell).join(" | ")} |`),
  ];
}

function formatWorkerRef(ref: AnyRecord): string {
  return `${ref.title ?? ref.id}: ${ref.summary ?? ""}`;
}

function formatLegalAnnex(annex: AnyRecord): string {
  const checkpoints = asArray<string>(annex.checklistItems).slice(0, 4);
  return [
    `${annex.lawName ?? annex.lawEntryId} ${annex.annexNo ?? ""} ${annex.title ?? ""}: ${annex.summary ?? ""}`.trim(),
    ...checkpoints.map((checkpoint) => `  - ${checkpoint}`),
  ].join("\n");
}

function formatChecklist(title: string, items: string[]): string {
  return [
    `## ${title}`,
    ...lineList(items, "해당 조건 없음"),
  ].join("\n");
}

function publicApiLinesFor(evidence: PublicApiOperationalEvidenceBundle, sourceIds: string[]): string[] {
  const sourceSet = new Set(sourceIds);
  return evidence.selectedSources
    .filter((source) => sourceSet.has(source.sourceId))
    .flatMap((source) => [
      `${source.label}: ${source.operationalUse}`,
      ...source.planningActions.map((action) => `실행(${source.sourceId}): ${action}`),
      ...source.limitations.map((limitation) => `한계(${source.sourceId}): ${limitation}`),
    ]);
}

interface SubmissionActionRule {
  id: string;
  condition: string;
  audience: string;
  document: string;
  appliesWhen: string;
  timing: string;
  basis: string;
  status: string;
}

function renderRuleTemplate(value: string, replacements: Record<string, string>): string {
  return value.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, key: string) => replacements[key] ?? "");
}

function buildSubmissionRowsFromRules(args: {
  flags: Record<string, boolean>;
  replacements: Record<string, string>;
}): string[][] {
  const rules = (submissionActionRules as { rules: SubmissionActionRule[] }).rules;
  return rules
    .filter((rule) => args.flags[rule.condition])
    .map((rule) => [
      renderRuleTemplate(rule.audience, args.replacements),
      renderRuleTemplate(rule.document, args.replacements),
      renderRuleTemplate(rule.appliesWhen, args.replacements),
      renderRuleTemplate(rule.timing, args.replacements),
      renderRuleTemplate(rule.basis, args.replacements),
      rule.status,
    ]);
}

function formatPublicApiOperationalEvidence(evidence: PublicApiOperationalEvidenceBundle): string {
  return [
    "# 공공 API 운영 증거",
    "",
    `- 오프라인 스냅샷 생성: ${evidence.generatedAt}`,
    `- 검증상태: ${evidence.verificationStatus}`,
    "- 성격: 법령·조례 근거가 아니라 행사 전/당일 운영 판단을 보강하는 증거다.",
    "",
    "## 적용 API 증거",
    ...lineList(evidence.applicableLines, "현재 입력 조건에 맞는 공공 API 운영 증거 없음"),
    "",
    "## 실무 액션",
    ...lineList(evidence.actionLines, "공공 API 기반 실무 액션 없음"),
    "",
    "## 한계와 재확인",
    ...lineList(evidence.cautionLines, "최신 live 조회와 관할기관 확인 필요"),
  ].join("\n");
}

function tableCell(value: string | undefined): string {
  return (value ?? "확인 필요").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

function formatSubmissionChecklist(rows: string[][]): string {
  return [
    "# 행사 제출·협의 체크리스트",
    "",
    "| No | 제출/확인처 | 문서/서식 | 조건 | 기한/시점 | 근거/메모 | 상태 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row, index) => `| ${index + 1} | ${row.map(tableCell).join(" | ")} |`),
  ].join("\n");
}

function parseEventDate(value: string | undefined): Date | null {
  const match = value?.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function eventDateValue(input: Pick<Input, "date" | "eventDate">): string | undefined {
  return input.date ?? input.eventDate;
}

function eventDateLabel(input: Input, offsetDays: number, fallback: string): string {
  const eventDate = parseEventDate(eventDateValue(input));
  if (!eventDate) return fallback;
  const date = new Date(eventDate.getTime());
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function formatOperationsRunsheet(input: Input, rows: string[][]): string {
  return [
    "# 현장 운영 런시트",
    "",
    `- 행사명: ${input.eventName}`,
    eventDateValue(input) ? `- 행사일: ${eventDateValue(input)}` : "- 행사일: 미입력",
    "- 기준: 실제 개장/폐장/공연 시작 시각은 현장 운영본부 런시트에 맞춰 치환한다.",
    "- 증빙: 각 단계 완료 시 담당자, 시간, 사진/점검표/무전 로그를 운영본부 증빙철에 남긴다.",
    "",
    "| 단계 | 기준시점 | 권장일자 | 구역/대상 | 확인/조치 | 담당 | 증빙 | escalation |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.map(tableCell).join(" | ")} |`),
  ].join("\n");
}

function decisionRowsForInput(input: Input): string[][] {
  const isPerformance = Boolean(input.performance || inputHasEvent(input, "performance"));
  const hasFood = Boolean(input.foodService || inputHasEvent(input, "food_event"));
  const hasWorker = Boolean(input.setupTeardown || input.temporaryStructures || input.temporaryElectricity || input.workAtHeight || input.heavyObjectHandling || input.hotWork);
  const hasOutdoor = Boolean(input.outdoor || input.outdoorEvent || inputHasEvent(input, "festival") || inputHasEvent(input, "outdoor_event"));
  return [
    ["공연법/공연 안전", isPerformance ? "적용" : "비적용", isPerformance ? "공연 프로그램, 무대, 공연장 외 공연 조건이 있음" : "공연 조건이 입력되지 않았으므로 필수 제출 액션으로 올리지 않음"],
    ["도로점용/교통통제", input.roadUse ? "적용" : hasOutdoor ? "조건부" : "비적용", input.roadUse ? "도로·보도·광장 점용 또는 통행 제한 조건이 있음" : hasOutdoor ? "옥외행사 외부 대기열·승하차·비상차량 접근 영향은 현장 확인 후보" : "도로점용 조건 없는 실내 행사로 필수 허가 액션 제외"],
    ["식품위생/LPG", hasFood || input.lpgUse ? "적용" : "비적용", hasFood || input.lpgUse ? "식음료 판매·시식·케이터링 또는 LPG/화기 조건이 있음" : "식음료·LPG 조건이 입력되지 않아 필수 점검표만 전환 후보로 둠"],
    ["설치·철거 작업자 안전", hasWorker ? "적용" : "비적용", hasWorker ? "설치·철거, 임시전기, 고소, 중량물, 화기 등 작업 위험 조건이 있음" : "작업 조건이 입력되지 않아 worker_safety_work_plan을 필수로 올리지 않음"],
    ["개인정보/CCTV", input.personalDataProcessing ? "적용" : "조건부", input.personalDataProcessing ? "참가자 등록, 출입증, CCTV 또는 개인정보 처리 조건이 있음" : "현장 등록·촬영·CCTV 운영이 확정되면 개인정보 고지와 위탁/보존 기준으로 전환"],
    ["VIP/보안검색/경비", input.vipSecurity ? "적용" : "비적용", input.vipSecurity ? "VIP, 출입통제, 보안검색 또는 민간경비 조건이 있음" : "VIP/보안검색 조건이 없어 경비업 하위기준을 제출 액션으로 올리지 않음"],
    ["무주최 다중운집", input.unhostedCrowd ? "적용" : "조건부", input.unhostedCrowd ? "주최자 없음 또는 책임 공백형 다중운집 조건이 있음" : "주최자 통제 밖 군중 급증이 관찰될 때 공동대응계획으로 전환"],
  ];
}

function conditionalRowsForInput(input: Input, localOrdinances: AnyRecord[]): string[][] {
  const needsOrdinanceReview = localOrdinances.some((record) => {
    const thresholdStructured = record.thresholdStructured as AnyRecord | undefined;
    return record.verificationStatus === "needs_review" || thresholdStructured?.confidence === "needs_review";
  });
  const hasSourceVerifiedPriorityOrdinance = localOrdinances.some((record) => {
    const band = localOrdinanceBand(record);
    return ["primary", "secondary"].includes(band) && record.verificationStatus === "source_verified";
  });
  const rows: Array<string[] | undefined> = [
    !input.roadUse ? ["도로점용", "대기열·안내시설·차량통제가 도로·보도·광장으로 확장", "점용구간 도면, 경찰·도로관리청 협의 메모"] : undefined,
    !input.foodService && !input.lpgUse ? ["식음료/LPG", "푸드부스, 푸드트럭, 시식, 임시조리, LPG 용기 반입 추가", "영업신고/허가, 보존식, 온도기록, 가스점검 증빙"] : undefined,
    !input.performance ? ["공연·무대", "공연 프로그램, 야외무대, 스탠딩 관객, 리깅/특수효과 추가", "공연 재해대처계획, 무대·트러스 구조검토, 피난안내"] : undefined,
    !input.personalDataProcessing ? ["개인정보/CCTV", "사전등록, QR/출입증, 촬영, CCTV 모니터링, 명단 위탁 처리", "개인정보 처리 고지, 수탁자, 보관·파기 기준"] : undefined,
    hasSourceVerifiedPriorityOrdinance ? ["source_verified 조례 원문 조문 확인", "우선 조례 후보가 공식 출처 확인 상태이나 article_verified는 아님", "자치법규 원문 조문 캡처, 시행일, 제출기한, 담당자 회신"] : undefined,
    needsOrdinanceReview ? ["조례 threshold 원문확인", "조례 threshold 구조화가 needs_review인 후보가 계획서에 포함됨", "법제처 원문, 관할 지자체 담당자 회신, 최종 제출기한 메모"] : undefined,
  ];
  return rows.filter((row): row is string[] => Array.isArray(row));
}

function actionOwner(audience: string, document: string): string {
  const text = `${audience} ${document}`;
  if (/소방|피난|화재|방염/.test(text)) return "방재·시설 담당";
  if (/경찰|도로|교통/.test(text)) return "교통·대외협력 담당";
  if (/보건|식품|LPG|가스|의료|AED|응급/.test(text)) return "의료/F&B/시설 담당";
  if (/개인정보|CCTV|보안|VIP|경비/.test(text)) return "등록·보안 담당";
  if (/작업|철거|설치|전기|구조/.test(text)) return "작업안전 담당";
  return "안전총괄";
}

function actionEvidence(document: string): string {
  if (/계획|대책|도면/.test(document)) return "제출본, 회신, 도면 revision";
  if (/점검|체크/.test(document)) return "점검표, 사진, 담당자 서명";
  if (/교육/.test(document)) return "교육명단, 교육자료, 참석 확인";
  if (/신고|허가|승인/.test(document)) return "허가증, 신고수리, 담당자 회신";
  return "담당자 확인 메모, 사진, 회의록";
}

function priorityActionRowsFromChecklist(markdown: string, limit = 6): string[][] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .slice(0, limit)
    .map((line) => line.split("|").map((cell) => cell.trim()).filter(Boolean))
    .map((cells) => {
      const audience = cells[1] ?? "확인처";
      const document = cells[2] ?? "문서/서식";
      const trigger = cells[3] ?? "조건 확인";
      const timing = cells[4] ?? "기한 확인";
      return [audience, document, actionOwner(audience, document), timing, actionEvidence(document), trigger];
    });
}

function buildExecutiveSummaryMarkdown(input: Input, sections: Record<string, string[]>, documentBundle: Record<string, unknown>, localOrdinances: AnyRecord[]): string {
  const keyRiskRows = sections.hazardControls.slice(0, 5).map((item) => {
    const firstLine = item.split(/\r?\n/)[0] ?? item;
    return [firstLine, "운영본부", "도면·사진·점검표로 통제 확인"];
  });
  const applicableBasis = [
    ...sections.legalBasis.slice(0, 5),
    ...sections.primaryLocalOrdinances.slice(0, 4),
    ...sections.venueRules.slice(0, 3),
  ];
  const nonApplicable = decisionRowsForInput(input).filter((row) => row[1] === "비적용");
  const conditional = conditionalRowsForInput(input, localOrdinances);
  const actions = priorityActionRowsFromChecklist(String(documentBundle.submissionChecklist ?? ""), 7);
  const threeMinuteRows = actions.slice(0, 5).map((row) => [
    row[1] ?? "해야 할 일",
    row[2] ?? "담당 확인",
    row[3] ?? "기한 확인",
    row[4] ?? "증빙 확인",
  ]);
  const remainingRisks = [
    "자동 생성 결과는 법률 자문이 아니며, 최신 법령 원문·조례 시행일·관할기관 접수창구 답변으로 보정해야 한다.",
    localOrdinances.some((record) => record.verificationStatus === "needs_review")
      ? "일부 조례 threshold가 needs_review이므로 제출 전 원문 조문과 담당자 회신으로 확정해야 한다."
      : "조례 threshold는 오프라인 구조화 기준이며, 관할 지자체 해석으로 최종 확정해야 한다.",
    localOrdinances.some((record) => record.verificationStatus === "source_verified")
      ? "source_verified 조례는 공식 출처 확인 상태이며, 제출기한·인원 기준·필수 서류는 원문 조문과 관할 담당자 회신으로 확정해야 한다."
      : undefined,
    "실제 도면, 부스 배치, 피난폭, 비상차량 접근로, 스태프 배치 인원은 현장 실측값으로 대체해야 한다.",
  ].filter((item): item is string => Boolean(item));

  return [
    "## 먼저 읽는 요약 보고서",
    "",
    "### 결론",
    `- 행사: ${input.eventName} / ${eventDateValue(input) ?? "일자 미입력"} / ${input.location ?? "장소 미입력"}`,
    `- 관할·베뉴: ${input.jurisdiction ?? "관할 미입력"} / ${input.venueId ?? "베뉴 미지정"}`,
    "- 이 문서는 안전관리 실무 초안이며, 제출·승인 전 책임자와 관할기관 확인이 필요하다.",
    "- 자동 점수와 검수는 법적 적합성 판정이 아니라 입력 조건 대비 커버리지 점검이다.",
    "",
    "### 3분 판단용 실행 요약",
    ...markdownTable(["먼저 할 일", "담당", "기한", "증빙"], threeMinuteRows.length > 0 ? threeMinuteRows : [["관할기관/베뉴 제출 대상 확인", "안전총괄", "기한 확인", "담당자 회신"]]),
    "",
    "### 이 행사에서 실제로 중요한 위험",
    ...markdownTable(["위험", "담당", "확인 증빙"], keyRiskRows.length > 0 ? keyRiskRows : [["행사 기본 리스크", "안전총괄", "인원·동선·피난·응급동선 현장 도면 확인"]]),
    "",
    "### 적용되는 법령·조례·베뉴 규정",
    ...lineList(applicableBasis, "적용 근거 후보 없음. 행사 유형·관할·베뉴 입력을 보강해야 함"),
    "",
    "### 적용되지 않는 법령과 이유",
    ...markdownTable(["영역", "판단", "이유"], nonApplicable.length > 0 ? nonApplicable : [["비적용 항목 없음", "확인", "현재 입력 조건에서는 명시적 비적용 후보 없음"]]),
    "",
    "### 조건부 확인 항목",
    ...markdownTable(["항목", "전환 기준", "확인할 증빙"], conditional.length > 0 ? conditional : [["조건부 항목 없음", "현재 입력 조건 기준 추가 전환 후보 없음", "-"]]),
    "",
    "### 제출·협의 액션",
    ...markdownTable(["확인처", "해야 할 일", "담당", "기한", "증빙", "적용 조건"], actions.length > 0 ? actions : [["관할기관/베뉴", "제출 대상 확인", "안전총괄", "기한 확인", "담당자 회신", "행사 조건 입력 보강"]]),
    "",
    "### 남은 리스크와 최종 확인",
    ...lineList(remainingRisks, "남은 리스크 없음"),
  ].join("\n");
}

function formatRoadTrafficControlPlan(input: Input, options: {
  hasRoad: boolean;
  hasOutdoor: boolean;
  roadAnnexItems: string[];
  localOrdinances: AnyRecord[];
  hasAdvertisingOrdinance: boolean;
}): string {
  if (!options.hasRoad && !options.hasOutdoor) {
    return [
      `# ${input.eventName} 외부 동선·교통 영향 확인 메모`,
      "",
      "- 현재 입력에서는 도로점용·교통통제 조건이 명시되지 않았다.",
      "- 실내 베뉴 행사라도 택시/버스 승하차, 주차장 진입 대기열, 보행자 유입 동선이 생기면 별도 교통·대외협력 담당을 지정해 현장 확인한다.",
      "- 도로, 보도, 광장, 차로, 공원, 공개공지, 셔틀 승하차장을 점용하거나 통행 제한이 생기면 도로·교통 실행계획으로 전환한다.",
    ].join("\n");
  }

  const roadOrdinanceCategories = input.roadUse
    ? ["road_occupancy", "outdoor_advertising", "outdoor_event_safety", "regional_festival_safety"]
    : ["outdoor_advertising", "outdoor_event_safety", "regional_festival_safety"];
  const roadOrdinances = options.localOrdinances
    .filter((item) => roadOrdinanceCategories.includes(String(item.categoryId ?? item.category)))
    .slice(0, 6)
    .map((item) => `- ${localOrdinanceTitle(item)}: ${item.appliesWhen ?? "적용조건 확인"} / 제출기한 ${item.submissionDeadline ?? "확인 필요"}`);
  const title = input.roadUse ? "도로·교통 실행계획" : "외부 동선·교통 영향 확인 계획";
  const coordinationLines = input.roadUse
    ? [
      "- 도로관리청/교통부서/경찰과 도로점용허가, 교통소통대책, 차로·보도 통제, 원상복구 범위를 확인한다.",
      "- 통행금지·차량 운행 제한이 있으면 공고, 우회도로, 문의처, 비상차량 접근로를 사전 고지한다.",
      "- 지자체 옥외행사 안전관리계획과 도로점용/교통소통 조례의 제출기한을 제출 일정·RACI에 반영한다.",
    ]
    : [
      "- 현재 입력에서는 도로점용·교통통제 조건이 확정되지 않았다.",
      "- 외부 대기열, 승하차장, 보행자 흐름, 비상차량 접근로를 현장 확인하고, 도로·보도·광장 점용이나 통행 제한이 확정될 때만 도로점용허가·교통소통대책 제출 액션으로 전환한다.",
      "- 전환 전에는 관할기관 제출 의무가 아니라 운영본부 확인후보로 관리한다.",
    ];
  const evidenceLines = input.roadUse
    ? [
      "- 도로점용허가증 또는 협의 회신",
      "- 교통소통대책/통제 도면",
      "- 통행금지·차량 운행 제한 공고 또는 안내 캡처",
      "- 경찰·도로관리청·지자체 협의 메모",
      "- 현장 설치 전/후 사진과 원상복구 확인 사진",
    ]
    : [
      "- 외부 대기열·승하차장·비상차량 접근로 확인 사진",
      "- 도로·보도·광장 점용 없음 또는 조건부 전환 판단 메모",
      "- 현장 변경 시 관할 도로관리청/경찰 협의 기록",
    ];

  return [
    `# ${input.eventName} ${title}`,
    "",
    "## 적용 조건",
    input.roadUse ? "- 도로·보도·광장 점용 또는 통행 제한 조건 있음" : "- 옥외행사/축제 조건으로 도로·보도·광장 영향 가능성을 조건부 확인",
    options.hasOutdoor ? "- 행사장 외부 보행자 유입, 대기열, 주차장·대중교통 접근 동선 확인 필요" : "- 외부 교통영향은 입력 조건 추가 시 재검토",
    "",
    "## 허가·협의",
    ...coordinationLines,
    ...roadOrdinances,
    ...(input.roadUse ? options.roadAnnexItems.map((item) => `- ${item}`) : []),
    "",
    "## 교통통제 도면",
    "- 교통통제 도면에는 통제구간, 보행자 동선, 차량 우회동선, 비상차량 접근로, 하역/반입 동선, 셔틀·택시·버스 승하차 지점을 한 도면에 표시한다.",
    "- 보행자 대기열이 차도, 자전거도로, 소방차 진입로, 지하철 출입구, 횡단보도, 버스정류장을 침범하지 않도록 통제선을 설치한다.",
    "- 야간·우천 조건에서는 조명, 미끄럼, 시야차단, 우산 대기열, 노점/불법주정차 병목을 별도 점검한다.",
    "",
    "## 현장 운영 체크",
    "- 개장 전: 통제표지, 라바콘/펜스, 안내요원, 우회 안내판, 무전 채널, 경찰/지자체 연락선을 확인한다.",
    "- 운영 중: 대기열 길이, 횡단보도 대기, 셔틀·주차장 진입 대기, 응급차 접근 지연, 우회동선 이탈을 30분 간격으로 보고한다.",
    "- 피크/폐장: 퇴장 분산 방송, 역·버스정류장·주차장 대기열 분리, 승하차장 혼잡 완화, 보행자 역류 방지 기준을 실행한다.",
    "- 종료 후: 도로·보도·시설물 원상복구, 통제물 철거, 노면 오염·파손 사진, 민원·사고 기록을 증빙철에 보관한다.",
    "",
    "## 옥외광고물·안내표지",
    options.hasAdvertisingOrdinance ? "- 현수막, 배너, 안내판, 지주형 표시물, 전광류/전기 사용 광고물은 관할 옥외광고 담당부서와 베뉴 설치 승인을 확인한다." : "- 임시 안내표지와 현수막은 설치 위치·고정방식·보행 방해 여부를 현장 확인한다.",
    "- 안내표지는 피난유도등, 소화전, 비상구, 교통표지, 신호등, CCTV, 점자블록을 가리지 않게 설치한다.",
    "",
    "## 필수 증빙",
    ...evidenceLines,
  ].join("\n");
}

function formatUnhostedCrowdResponsePlan(input: Input, options: {
  isUnhosted: boolean;
  hazards: AnyRecord[];
  localOrdinances: AnyRecord[];
}): string {
  if (!options.isUnhosted) {
    return [
      `# ${input.eventName} 무주최 다중운집 전환 기준 메모`,
      "",
      "- 현재 입력에서는 무주최 다중운집 조건이 명시되지 않았다.",
      "- 행사 운영 중 주최자 통제 밖의 자발적 집결, 역세권·광장·상권 유입, SNS 기반 군중 급증이 관찰되면 무주최 다중운집 대응계획으로 전환한다.",
      "- 전환 시 지자체·경찰·소방·시설관리자·교통 운영기관의 공동 현장지휘 체계를 즉시 확인한다.",
    ].join("\n");
  }

  const ordinanceLines = options.localOrdinances
    .filter((item) => ["outdoor_event_safety", "regional_festival_safety"].includes(String(item.categoryId ?? item.category)))
    .slice(0, 5)
    .map((item) => `${item.jurisdiction ?? "관할"} ${item.name ?? item.ordinanceName ?? "조례"}: ${item.appliesWhen ?? "적용조건 확인"} / ${item.agencyCoordination ?? "관계기관 협의 확인"}`);
  const hazardLines = options.hazards
    .filter((hazard) => ["crowd_density_high", "ingress_egress_bottleneck", "unhosted_crowd_governance_gap", "medical_emergency", "weather_outdoor_event"].includes(String(hazard.id)))
    .flatMap((hazard) => asArray<string>(hazard.controls).slice(0, 2).map((control) => `${hazard.label ?? hazard.id}: ${control}`));

  return [
    `# ${input.eventName} 무주최 다중운집 관계기관 공동대응계획`,
    "",
    "## 적용 조건",
    "- 주최자 없음 또는 주최자 통제 밖 자발적 다중운집으로 책임 공백이 발생할 수 있다.",
    "- 역세권, 광장, 상권, 하천변, 도로변, 공개공지처럼 관리주체가 나뉘는 장소를 대상으로 한다.",
    "- 행사명은 현장 상황 식별용이며 법적 주최자 존재를 의미하지 않는다.",
    "",
    "## 공동 현장지휘/RACI",
    "- Responsible: 현장 합동상황반이 인파 상태, 통제선, 방송·전광판·SNS 안내, 증빙 기록을 실행한다.",
    "- Accountable: 관할 지자체 재난안전상황실 또는 현장 책임자가 상황 단계 상향, 통제 확대, 관계기관 요청을 승인한다.",
    "- Consulted: 경찰 현장지휘, 소방 현장지휘, 119/의료, 철도·버스·택시 등 교통 운영기관, 시설관리자, 상가·민간시설 관리주체.",
    "- Informed: 인근 상인회, 대중교통 안내센터, 민원/콜센터, 언론 대응 창구, 현장 스태프.",
    "",
    "## 권한 경계와 관리주체",
    "- 역사 출입구, 광장, 보도, 차도, 상가 출입구, 공원/공개공지, 지하연결통로 등 구역별 관리주체와 연락처를 도면에 표시한다.",
    "- 관리주체가 다른 구간을 넘나드는 통제선은 경찰·지자체·시설관리자 합의 없이는 독단적으로 확장하지 않는다.",
    "- 도로점용이 없더라도 보행자 대기열이 차도·횡단보도·버스정류장으로 번지면 교통부서/경찰 협의로 전환한다.",
    "",
    "## 상황 단계와 실행 기준",
    "- 관찰: 체류 인원·대기열·밀집 구역을 15분 간격으로 확인하고 현장 사진과 위치를 기록한다.",
    "- 주의: 병목 또는 역류가 보이면 일방통행, 대기열 절단, 우회 안내, 전광판·방송 안내를 시행한다.",
    "- 경계: 압박, 넘어짐, 호흡곤란, 응급환자, 출입구 포화가 보이면 출입 제한, 현 위치 대기, 대중교통 운영 조정 요청을 시행한다.",
    "- 심각: 연쇄 넘어짐, 구조 지연, 통제선 붕괴, 다수 환자가 발생하면 대피개시 또는 구역 폐쇄를 공동 현장지휘로 결정한다.",
    "- 해산·분산: 위험 완화 후에도 잔여 병목, 대중교통 대기열, 응급환자, 민원 지점을 확인하면서 통제선을 단계적으로 해제한다.",
    "",
    "## 관계기관 연락·상황전파",
    "- 지자체 재난안전상황실, 경찰, 소방, 119, 철도/도시철도/버스/택시 운영기관, 시설관리자 간 단일 상황방을 둔다.",
    "- 외부 안내는 '주최자 없는 다중운집 안전관리'임을 명확히 하고, 확정되지 않은 원인·책임 표현은 피한다.",
    "- 방문객 안내는 방송, 전광판, 역사 안내, SNS, 문자, 현장 안내요원 문구를 같은 내용으로 맞춘다.",
    "",
    "## 현장 증빙·사후 기록",
    "- 시각, 위치, 추정 인원, 밀집도, 병목 원인, 통제선 변경, 관계기관 요청, 방송/문자/전광판 송출 시각을 기록한다.",
    "- 현장 사진은 군중 전체 식별이 아니라 병목, 통제선, 대기열 방향, 응급차 접근로, 조치 전후 중심으로 남긴다.",
    "- 상황 종료 후 공동 현장지휘 판단, 관계기관 요청, 조치 결과, 민원·인명피해 여부를 사고보고서에 연결한다.",
    "",
    "## 관련 위험·조례 확인",
    ...lineList([...hazardLines, ...ordinanceLines], "무주최 다중운집 관련 위험·조례 후보 없음. 행안부 다중운집 가이드라인과 관할 지자체 판단 기준 확인 필요"),
  ].join("\n");
}

function formatFoodLpgExecutionChecklist(input: Input, options: {
  hasFood: boolean;
  hasLpg: boolean;
  foodHazards: AnyRecord[];
  foodLpgAnnexItems: string[];
  venueFacility: ReturnType<typeof buildVenueFacilitySummary>;
  publicApiLines: string[];
}): string {
  if (!options.hasFood && !options.hasLpg) {
    return [
      "## 식음료·LPG 점검표",
      "- 현재 입력에서는 식음료 판매·시식·케이터링 또는 LPG/가스 사용 조건이 명시되지 않았다.",
      "- 현장 변경으로 푸드부스, 푸드트럭, 임시 조리, 시식, LPG 용기·배관·화기 사용이 추가되면 즉시 식음료·LPG 현장 실행 상태표로 전환한다.",
    ].join("\n");
  }

  const rows = ([
    options.hasFood ? ["사전", "D-1", "식음료 운영자", "영업신고증·허가, 메뉴/알레르기 표시, 보존식 담당, 식중독 신고 연락망 확인", "open", "미제출 업체는 판매 준비 보류", "영업신고증/메뉴표/연락망"] : undefined,
    options.hasFood ? ["반입", "개장 T-120", "식음료 구역", "냉장·보온 보관, 손위생, 교차오염 방지, 보존식 용기·라벨 준비", "open", "온도 이탈·라벨 누락 시 반입 보류", "냉장·보온 온도기록/보존식 라벨 사진"] : undefined,
    options.hasFood ? ["운영 중", "60분 간격", "식음료 구역", "냉장·보온 온도기록, 보존식 채취, 조리도구 세척·살균, 판매중지 기준 확인", "open", "식중독 의심 또는 온도 이탈 시 판매중지·보존식/검체 확보·보건소 연락", "온도기록지/보존식 채취기록/조치 전후 사진"] : undefined,
    options.hasLpg ? ["사전", "D-1", "LPG·화기 운영자", "LPG 검사증명서, 보험, 가스공급자 안전점검, 가스용기 반입대장 확인", "open", "증빙 미제출 시 LPG 반입·사용 금지", "검사증명서/보험증빙/반입대장"] : undefined,
    options.hasLpg ? ["반입", "개장 T-120", "LPG 용기·배관", "용기 전도방지, 호스/조정기, 자동차단밸브, 가스누설탐지기·경보기, 누설점검 확인", "open", "누설 의심 시 밸브 차단, 환기, 화기 사용 즉시 중지, 공급자 재점검", "누설점검표/용기 고정 사진/경보기 확인"] : undefined,
    options.hasLpg ? ["운영 중", "30분 간격", "LPG·화기 구역", "밸브 상태, 냄새·누설, 환기, 화기 이격거리, 소화기, 화기감시자 확인", "open", "가스 냄새·화기 이격 위반 시 화기 사용 즉시 중지, 밸브 차단, 관람객 통제", "순찰 로그/소화기 위치 사진/무전 기록"] : undefined,
    options.hasFood || options.hasLpg ? ["부적합", "즉시", "식음료·LPG 공통", "판매중지, 화기 사용 즉시 중지, 밸브 차단, 환기, 보존식/검체, 환자정보·섭취이력, 보건소·119·가스공급자 연락", "open", "운영본부 이슈 등록 후 재개 승인 전까지 해당 구역 운영 중지", "이슈번호/조치 전후 사진/기관 연락 기록"] : undefined,
    options.hasFood || options.hasLpg ? ["종료", "폐장 후", "식음료·LPG 구역", "밸브 잠금, 잔량·용기 반출, 폐기물·오염 제거, 보존식/기록 보관, 조치 전후 사진 정리", "open", "잔류 용기·오염·미해결 이슈는 베뉴/운영본부 공동 확인", "폐장 확인서/반출 사진/기록철"] : undefined,
  ] as Array<string[] | undefined>).filter((row): row is string[] => Array.isArray(row));

  const venueFoodRules = options.venueFacility.foodRules.slice(0, 4).map((rule) => `베뉴 식음료 규정: ${rule}`);
  const hazardControls = options.foodHazards
    .flatMap((hazard) => asArray<string>(hazard.controls).slice(0, 3))
    .map((control) => `위험통제: ${control}`);

  return [
    "## 식음료·LPG 점검표",
    "",
    "## 현장 실행 상태표",
    "| 단계 | 시점 | 대상 | 점검항목 | 판정 | 부적합 조치 | 증빙 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.map(tableCell).join(" | ")} |`),
    "",
    "## 부적합 조치 기준",
    ...(options.hasFood ? [
      "- 식중독 의심, 이물·변질, 냉장·보온 온도 이탈, 보존식 누락, 교차오염 가능성이 있으면 즉시 판매중지하고 보존식/검체, 환자정보, 섭취이력을 분리 기록한다.",
      "- 환자 발생 또는 다수 민원은 운영본부, 의료팀, 관할 보건소에 공유하고 보건소 조사 전 임의 폐기하지 않는다.",
    ] : []),
    ...(options.hasLpg ? [
      "- 가스 냄새, 누설경보, 호스·조정기 손상, 용기 전도, 환기 불량, 화기 이격거리 위반이 있으면 화기 사용 즉시 중지, 밸브 차단, 환기, 주변 인파 통제를 우선한다.",
      "- LPG 재개는 가스공급자 또는 시설·소방 담당의 재점검과 운영본부 승인 후에만 허용한다.",
    ] : []),
    "- 모든 부적합은 현장 이슈로 등록하고 담당자, 시각, 구역, 조치 전후 사진, 재개 승인자를 남긴다.",
    "",
    "## 필수 증빙",
    ...(options.hasFood ? [
      "- 영업신고증·허가 또는 임시영업 확인",
      "- 냉장·보온 온도기록",
      "- 보존식 라벨과 보존식 채취기록",
      "- 판매중지·보건소 연락·환자정보/섭취이력 기록",
    ] : []),
    ...(options.hasLpg ? [
      "- LPG 검사증명서, 보험증빙, 공급자 안전점검 기록",
      "- 가스용기 반입대장",
      "- 누설점검표, 밸브 차단·환기 조치 기록",
      "- 화기 이격거리, 소화기, 화기감시자 배치 사진",
    ] : []),
    "- 조치 전후 사진과 운영본부 확인 메모",
    "",
    "## 공공 API 운영 증거",
    ...lineList(options.publicApiLines, "식음료/LPG 조건에 연결된 공공 API 증거 없음. 식음료가 추가되면 식품안전나라 회수·판매중지 조회를 수행"),
    "",
    "## 법령·별표 체크포인트",
    ...lineList([
      ...hazardControls,
      ...options.foodLpgAnnexItems,
      ...venueFoodRules,
    ], "식음료/LPG 관련 별표·베뉴 규정 후보 없음. 관할 보건소, 가스공급자, 베뉴 방재실 확인 필요"),
  ].join("\n");
}

function formatPerformanceStageExecutionPlan(input: Input, options: {
  isPerformance: boolean;
  performanceAnnexItems: string[];
  stageHazards: AnyRecord[];
  venueFacility: ReturnType<typeof buildVenueFacilitySummary>;
  publicApiLines: string[];
}): string {
  if (!options.isPerformance) {
    return [
      `# ${input.eventName} 공연·무대 실행계획 전환 메모`,
      "",
      "- 현재 입력에서는 공연 프로그램 또는 공연장/공연장 외 공연 조건이 명시되지 않았다.",
      "- 무대, 트러스, 스탠딩 관객, 공연 리허설, 특수효과, 음향·조명 운영이 추가되면 공연·무대 실행계획으로 전환한다.",
    ].join("\n");
  }

  const venueRiggingRules = options.venueFacility.riggingRules.slice(0, 5).map((rule) => `베뉴 리깅·무대 규정: ${rule}`);
  const venueElectricalRules = options.venueFacility.electricity.slice(0, 3).map((rule) => `베뉴 전기 규정: ${rule}`);
  const hazardControls = options.stageHazards
    .flatMap((hazard) => asArray<string>(hazard.controls).slice(0, 3))
    .map((control) => `위험통제: ${control}`);
  const rows = [
    ["사전", "D-14~D-7", "공연 운영본부", "공연 재해대처계획, 안전관리조직, 안전교육, 피난안내문, 무대·트러스 구조검토, 전기·음향·조명 도면 확인", "open", "제출·수리·승인 전까지 무대 시공·관객 입장 계획 확정 보류", "재해대처계획/안전교육 명단/구조검토서/도면"],
    ["사전", "D-1", "무대·트러스·리깅", "리깅 승인, 방염확인서, 하중·고정점, 낙하물 방지, 발전차·분전반, 비상방송·피난안내 리허설 확인", "open", "리깅·방염·전기 증빙 미흡 시 리허설 또는 개장 보류", "리깅 승인서/방염확인서/전기점검표/리허설 로그"],
    ["개장 전", "개장 T-180", "무대 구조·상부장치", "트러스·LED·스피커·조명 고정, 안전핀·와이어, 처짐·흔들림, 무대 하부·후면 출입통제 확인", "open", "흔들림·고정 불량·낙하 위험 시 무대 접근통제와 보강 완료 전 개장 금지", "구조·리깅 체크 사진/출입통제 사진"],
    ["개장 전", "개장 T-90", "객석·스탠딩 구역", "스탠딩 펜스, 무대 전면 압박 완충, 피난통로, 보안·의료 전진배치, 피난안내 방송문 확인", "open", "압박 완충·피난통로 미확보 시 입장 지연과 구역 재배치", "객석 도면/펜스 사진/무전 체크"],
    ["공연 직전", "공연 T-15", "무대감독·운영본부", "공연중지 기준, 아티스트/무대감독 중지 신호, 전원 차단, 비상방송, 관객 현 위치 대기·분산 문구 공유", "open", "중지 신호·전파체계 미확인 시 공연 시작 보류", "무대감독 체크/방송문 승인/무전 로그"],
    ["공연 중", "15분 간격", "무대 전면·스탠딩 구역", "무대 전면 압박, 펜스 변형, 관객 쓰러짐, 역류, 응급환자, 구조물 흔들림, 전기 이상 징후 보고", "open", "압박·구조·전기 이상 시 곡간 멘트 또는 즉시 공연 일시중지, 관객 현 위치 대기, 의료·보안 투입", "순찰 로그/현장 사진/의료·보안 출동 기록"],
    ["야외·기상", "상시", "야외 무대·트러스", "강풍·우천·낙뢰, 무대 미끄럼, 전기 방수, 현수막·스크린 흔들림, 작업중지/공연중지 풍속 기준 확인", "open", "기상 기준 초과 또는 낙뢰 위험 시 공연 일시중지·대피개시 검토", "기상 확인/중지 판단 기록/조치 사진"],
    ["종료", "공연 종료 후", "퇴장·무대 구역", "퇴장 분산, 무대 접근통제, 전원 차단, 특수효과·화기 종료, 철거 전 관객 완전 분리 확인", "open", "관객 잔류 또는 전원 미차단 시 철거 착수 금지", "퇴장 로그/전원 차단 확인/철거 전 사진"],
  ];

  return [
    `# ${input.eventName} 공연·무대 실행계획`,
    "",
    "## 적용 조건",
    "- 공연 프로그램, 스탠딩 관객, 무대·트러스·LED·음향·조명, 공연장 외 공연 또는 야외 무대가 포함된다.",
    "- 공연법 재해대처계획, 안전관리조직, 안전교육, 피난안내, 무대·트러스 작업자 안전계획을 함께 관리한다.",
    "",
    "## 현장 실행 상태표",
    "| 단계 | 시점 | 대상 | 점검항목 | 판정 | 부적합 조치 | 증빙 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.map(tableCell).join(" | ")} |`),
    "",
    "## 공연중지·재개 기준",
    "- 무대 구조 흔들림, 리깅 이탈, 낙하물, 전기 이상, 화재·연기, 압박·연쇄 넘어짐, 응급환자 다발, 기상 기준 초과가 있으면 공연 일시중지 또는 행사 중단 후보로 즉시 상향한다.",
    "- 재개는 무대감독, 안전총괄, 시설·전기·방재, 의료·보안, 필요 시 경찰·소방 확인 후 운영본부가 승인한다.",
    "- 방문객 안내는 피난안내, 현 위치 대기, 분산 퇴장, 운영 재개 문구를 사전 승인된 다국어 템플릿으로 송출한다.",
    "",
    "## 필수 증빙",
    "- 공연 재해대처계획 제출·수리 또는 대상 확인",
    "- 안전관리조직, 안전교육 명단, 피난안내문",
    "- 무대·트러스 구조검토서, 리깅 승인서, 방염확인서",
    "- 전기·음향·조명 도면, 발전차·분전반 점검, 전원 차단 확인",
    "- 공연중지 판단, 아티스트/무대감독 중지 신호, 조치 전후 사진",
    "",
    "## 공공 API 운영 증거",
    ...lineList(options.publicApiLines, "공연 조건에 연결된 공공 API 증거 없음. 공연 프로그램이 추가되면 KOPIS catalog와 베뉴 공연시설 정보를 확인"),
    "",
    "## 법령·별표·베뉴 체크포인트",
    ...lineList([
      ...options.performanceAnnexItems,
      ...hazardControls,
      ...venueRiggingRules,
      ...venueElectricalRules,
    ], "공연·무대 별표·베뉴 규정 후보 없음. 공연법 재해대처계획, 베뉴 기술지원/리깅 승인, 무대 구조검토 필요 여부 확인"),
  ].join("\n");
}

function buildOperationsRunsheetRows(input: Input, options: {
  hasWorker: boolean;
  hasFood: boolean;
  hasLpg: boolean;
  hasRoad: boolean;
  hasSecurity: boolean;
  hasPrivacy: boolean;
  hasVenue: boolean;
  hasOutdoor: boolean;
  hasUnhostedCrowd: boolean;
  hasPerformance: boolean;
  venueName: string;
}): string[][] {
  const dMinus7 = eventDateLabel(input, -7, "D-7");
  const dMinus1 = eventDateLabel(input, -1, "D-1");
  const dDay = eventDateLabel(input, 0, "D-day");
  const dPlus1 = eventDateLabel(input, 1, "D+1");
  const rows: Array<string[] | undefined> = [
    options.hasPerformance ? ["사전", "D-7 16:00", dMinus7, "공연 운영본부", "공연 재해대처계획, 안전관리조직, 안전교육, 피난안내문, 무대·트러스 구조검토, 전기·음향·조명 도면 확인", "공연안전 담당", "재해대처계획/안전교육 명단/구조검토서/도면", "운영총괄/지자체/베뉴"] : undefined,
    ["사전", "D-1 15:00", dMinus1, "운영본부", "관계기관 협의, 제출 승인, 비상연락망, 지휘 판단권자, 행사중지/재개 기준 최종 확인", "안전총괄", "승인본/연락망/지휘권자 확인 메모", "운영총괄"],
    options.hasUnhostedCrowd ? ["사전", "D-1 16:00", dMinus1, "역세권·광장·상권 경계", "무주최 다중운집 공동 현장지휘, 지자체·경찰·소방·시설관리자·교통 운영기관 연락선과 권한 경계 확인", "관계기관 합동상황반", "공동 현장지휘 RACI/연락망/구역도", "지자체 재난안전상황실/경찰/소방"] : undefined,
    options.hasVenue ? ["사전", "D-1 17:00", dMinus1, options.venueName, "베뉴 시설·전기·방재 담당자와 반입/하역, 비상구, 소방통로, 전기투입, 금지물품 기준 재확인", "시설·방재 담당", "베뉴 확인 메모/현장 사진", "베뉴 담당/안전총괄"] : undefined,
    options.hasPerformance ? ["사전", "D-1 17:30", dMinus1, "무대·트러스·리깅", "리깅 승인, 방염확인서, 하중·고정점, 낙하물 방지, 발전차·분전반, 비상방송·피난안내 리허설 확인", "공연안전 담당", "리깅 승인서/방염확인서/전기점검표/리허설 로그", "베뉴 기술지원/안전총괄"] : undefined,
    options.hasRoad ? ["사전", "D-1 18:00", dMinus1, "도로·교통통제 구역", "교통통제 고지, 우회동선, 비상차량 접근로, 경찰/도로관리청 연락 기준 확인", "교통·대외협력 담당", "통제 도면/고지 캡처/현장 사진", "경찰/지자체/안전총괄"] : undefined,
    options.hasRoad ? ["개장 전", "개장 T-150", dDay, "통제구간·승하차장·주차장", "통제표지, 라바콘/펜스, 우회 안내판, 셔틀·택시·버스 승하차장, 비상차량 접근로 설치 확인", "교통·대외협력 담당", "교통통제 도면/현장 사진", "경찰/도로관리청/안전총괄"] : undefined,
    ["개장 전", "개장 T-180", dDay, "게이트·대기열·주요 동선", "게이트 처리량, 대기열 펜스, 우회동선, 안내표지, 혼잡 단계별 통제 기준 설치 확인", "구역장", "설치 사진/도면 체크", "안전총괄/보안팀"],
    options.hasPerformance ? ["개장 전", "개장 T-180", dDay, "무대 구조·상부장치", "트러스·LED·스피커·조명 고정, 안전핀·와이어, 처짐·흔들림, 무대 하부·후면 출입통제 확인", "공연안전 담당", "구조·리깅 체크 사진/출입통제 사진", "무대감독/시설·전기/안전총괄"] : undefined,
    ["개장 전", "개장 T-150", dDay, "소방·피난", "비상구, 피난통로, 소화전, 방화문, 소방차 진입로, 임시구조물 차단 여부 확인", "시설·방재 담당", "소방·피난 점검표/사진", "베뉴 방재실/소방서"],
    ["개장 전", "개장 T-120", dDay, "의료·AED", "AED 위치, 의무실, 응급처치자, 구급차 접근동선, 119 신고 기준, 이송병원 연락 확인", "의료담당", "AED 점검표/연락망", "119/안전총괄"],
    options.hasWorker ? ["개장 전", "개장 T-120", dDay, "설치·철거 작업구역", "작업 종료, 잔여 공구·케이블·고소작업 장비 철수, 관람객 동선과 작업구역 분리 확인", "작업책임자", "작업종료 확인서/현장 사진", "안전총괄/시설담당"] : undefined,
    options.hasFood ? ["사전", "D-1 18:30", dMinus1, "식음료 운영자", "영업신고증·허가, 메뉴/알레르기 표시, 보존식 담당, 식중독 신고 연락망 확인", "F&B 담당", "영업신고증/메뉴표/연락망", "보건소/안전총괄"] : undefined,
    options.hasLpg ? ["사전", "D-1 19:00", dMinus1, "LPG·화기 운영자", "LPG 검사증명서, 보험, 가스공급자 안전점검, 가스용기 반입대장 확인", "F&B 담당", "검사증명서/보험증빙/반입대장", "가스공급자/소방/안전총괄"] : undefined,
    options.hasFood ? ["개장 전", "개장 T-120", dDay, "식음료 구역", "냉장·보온 보관, 손위생, 교차오염 방지, 보존식 용기·라벨 준비 확인", "F&B 담당", "냉장·보온 온도기록/보존식 라벨 사진", "보건소/안전총괄"] : undefined,
    options.hasLpg ? ["개장 전", "개장 T-120", dDay, "LPG 용기·배관", "가스용기 반입대장, 용기 전도방지, 호스/조정기, 자동차단밸브, 가스누설탐지기·경보기, 누설점검 확인", "F&B 담당", "누설점검표/용기 고정 사진/경보기 확인", "가스공급자/소방"] : undefined,
    options.hasSecurity ? ["개장 전", "개장 T-75", dDay, "출입통제·VIP·보안검색", "보안검색 위치, 검색 예외, VIP 동선, 경비원 명부, 경찰·베뉴 보안실 연락 기준 확인", "보안팀장", "보안 배치표/명부/무전망", "경찰/안전총괄"] : undefined,
    options.hasPrivacy ? ["개장 전", "개장 T-60", dDay, "등록·CCTV·촬영", "개인정보 고지, CCTV 안내판, 촬영 고지, 현장 단말 잠금, 접근권한, 접속기록 담당 확인", "개인정보보호책임자", "고지문/안내판 사진/권한 점검표", "운영총괄/보안책임자"] : undefined,
    options.hasPerformance ? ["개장 전", "개장 T-60", dDay, "객석·스탠딩 구역", "스탠딩 펜스, 무대 전면 압박 완충, 피난통로, 보안·의료 전진배치, 피난안내 방송문 확인", "공연안전 담당", "객석 도면/펜스 사진/무전 체크", "보안팀/의료팀/안전총괄"] : undefined,
    ["개장 전", "개장 T-45", dDay, "전체 스태프", "안전 브리핑, 구역별 보고선, 무전 채널, 대피/중지/재개 방송문, 미아·분실·민원 처리 기준 공유", "안전총괄", "브리핑 참석명단/무전 체크", "운영총괄"],
    options.hasPerformance ? ["공연 직전", "공연 T-15", dDay, "무대감독·운영본부", "공연중지 기준, 아티스트/무대감독 중지 신호, 전원 차단, 비상방송, 관객 현 위치 대기·분산 문구 공유", "무대감독", "무대감독 체크/방송문 승인/무전 로그", "운영총괄/안전총괄"] : undefined,
    ["개장 전", "개장 T-15", dDay, "운영본부", "개장 승인 hold point: 소방·피난, 의료, 보안, 동선, 전기, 식음료, 작업구역 이상 없음 확인 후 개장", "운영총괄", "개장 승인 체크/무전 로그", "안전총괄"],
    ["운영 중", "30분 간격", dDay, "게이트·혼잡 구역", "구역별 체류 인원, 대기열 길이, 병목, 우회동선, 스태프 피로도, 위험 신고를 주기 보고", "구역장", "순찰 로그/사진", "안전총괄/보안팀"],
    options.hasUnhostedCrowd ? ["운영 중", "15분 간격", dDay, "무주최 다중운집 구역", "관찰/주의/경계/심각 단계, 대기열 역류, 압박 징후, 출입구 포화, 철도·버스 연계 혼잡을 공동 상황방에 보고", "관계기관 합동상황반", "현장 사진/무전 로그/단계 판단 기록", "지자체/경찰/소방/교통 운영기관"] : undefined,
    options.hasRoad ? ["운영 중", "30분 간격", dDay, "도로·교통통제 구역", "보행자 대기열, 횡단보도 대기, 셔틀·주차장 진입 대기, 불법주정차, 응급차 접근 지연 여부 보고", "교통·대외협력 담당", "순찰 로그/사진/무전 기록", "경찰/도로관리청/안전총괄"] : undefined,
    options.hasOutdoor ? ["운영 중", "60분 간격", dDay, "옥외 구역", "기상, 강풍·우천·폭염, 임시구조물 흔들림, 전기 방수, 미끄럼 위험 확인", "시설·방재 담당", "기상 확인/현장 사진", "운영총괄/지자체"] : undefined,
    options.hasFood ? ["운영 중", "60분 간격", dDay, "식음료 구역", "냉장·보온 온도기록, 보존식 채취, 조리도구 세척·살균, 판매중지 기준 확인", "F&B 담당", "온도기록지/보존식 채취기록/조치 전후 사진", "보건소/의료팀/안전총괄"] : undefined,
    options.hasLpg ? ["운영 중", "30분 간격", dDay, "LPG·화기 구역", "밸브 상태, 냄새·누설, 환기, 화기 이격거리, 소화기, 화기감시자 확인", "F&B 담당", "순찰 로그/소화기 위치 사진/무전 기록", "가스공급자/소방/안전총괄"] : undefined,
    options.hasPerformance ? ["공연 중", "15분 간격", dDay, "무대 전면·스탠딩 구역", "무대 전면 압박, 펜스 변형, 관객 쓰러짐, 역류, 응급환자, 구조물 흔들림, 전기 이상 징후 보고", "공연안전 담당", "순찰 로그/현장 사진/의료·보안 출동 기록", "무대감독/안전총괄/의료·보안"] : undefined,
    options.hasPerformance && options.hasOutdoor ? ["야외·기상", "상시", dDay, "야외 무대·트러스", "강풍·우천·낙뢰, 무대 미끄럼, 전기 방수, 현수막·스크린 흔들림, 작업중지/공연중지 풍속 기준 확인", "시설·방재 담당", "기상 확인/중지 판단 기록/조치 사진", "운영총괄/지자체/소방"] : undefined,
    ["피크", "피크 T-30~T+30", dDay, "주요 입퇴장 동선", "혼잡 단계 상향 기준, 입장 속도 조절, 우회 안내, 의료·보안 전진 배치, 방송문 준비", "안전총괄", "피크 점검 로그/방송 승인", "운영총괄/경찰·소방"],
    ["폐장", "폐장 T-30", dDay, "퇴장 동선", "퇴장 분산 방송, 역/주차장/셔틀 대기열, 야간 조명, 우회동선, 미아·응급 잔여 이슈 확인", "구역장", "폐장 전 점검표/방송 로그", "안전총괄"],
    options.hasUnhostedCrowd ? ["분산", "상황 완화 시", dDay, "역사·광장·상권 연결부", "해산·분산 방송, 대중교통 분산 안내, 통제선 단계적 해제, 잔여 병목과 응급환자 여부 확인", "관계기관 합동상황반", "분산 안내 캡처/해제 판단 기록", "지자체/경찰/소방/교통 운영기관"] : undefined,
    options.hasRoad ? ["폐장", "폐장 T+60", dDay, "도로·교통통제 구역", "통제물 철거, 원상복구, 노면 오염·파손, 민원·사고 기록, 통제 해제 관계기관 공유", "교통·대외협력 담당", "원상복구 사진/해제 공유 기록", "도로관리청/경찰/운영총괄"] : undefined,
    options.hasFood ? ["폐장", "폐장 후 T+20", dDay, "식음료 구역", "판매중지 이슈, 보존식/온도기록 보관, 폐기물·오염 제거, 조치 전후 사진 정리", "F&B 담당", "폐장 확인서/보존식 기록/사진", "보건소/안전총괄"] : undefined,
    options.hasLpg ? ["폐장", "폐장 후 T+30", dDay, "LPG·화기 구역", "밸브 잠금, 잔량·용기 반출, 누설 재점검, 화기 사용 종료, 가스용기 반입대장 마감", "F&B 담당", "반출 사진/누설점검표/반입대장 마감", "가스공급자/소방"] : undefined,
    options.hasPerformance ? ["종료", "공연 종료 후", dDay, "퇴장·무대 구역", "퇴장 분산, 무대 접근통제, 전원 차단, 특수효과·화기 종료, 철거 전 관객 완전 분리 확인", "공연안전 담당", "퇴장 로그/전원 차단 확인/철거 전 사진", "무대감독/안전총괄"] : undefined,
    ["폐장", "폐장 후 T+30", dDay, "운영본부", "사고·응급·민원·분실·미아 기록 취합, 미해결 조치 담당자 지정, 관계기관 종료 공유", "운영본부 기록담당", "일일 운영 종료 보고", "운영총괄"],
    options.hasWorker ? ["철거", "철거 전", dDay, "작업구역", "관람객 완전 분리, 전기 차단/투입 승인, 작업허가, PPE, 추락·중량물·화기 작업 통제선 확인", "작업책임자", "작업허가/교육명단/사진", "안전총괄/베뉴 담당"] : undefined,
    options.hasWorker ? ["철거", "철거 중", dDay, "하역·반출 동선", "지게차·하역장·차량 동선과 보행동선 분리, 하중분산, 잔재물 낙하·전도 위험 확인", "하역책임자", "하역 순찰 로그/사진", "시설담당/안전총괄"] : undefined,
    ["종료", "D+1", dPlus1, "운영본부", "사고보고서, 조치 전후 사진, 제출·승인 증빙, 개인정보 파기/보존, 베뉴 원상복구 확인 정리", "운영본부 기록담당", "종료 보고서/증빙철", "운영총괄"],
  ];
  return rows.filter((row): row is string[] => Array.isArray(row));
}

function inputHasEvent(input: Input, eventType: string): boolean {
  return (input.eventTypes ?? []).includes(eventType as MiceEventType);
}

function isLegalAnnexApplicable(annex: AnyRecord, input: Input): boolean {
  const lawEntryId = String(annex.lawEntryId ?? "");
  const annexId = String(annex.id ?? "");
  const isFestival = inputHasEvent(input, "festival") || inputHasEvent(input, "outdoor_event") || input.outdoor || input.outdoorEvent;
  const isPerformance = inputHasEvent(input, "performance") || input.performance;
  const isFood = inputHasEvent(input, "food_event") || input.foodService;
  const isIndoorMice = inputHasEvent(input, "exhibition") || inputHasEvent(input, "conference") || Boolean(input.venueId);
  const hasWorkerWork = Boolean(input.setupTeardown || input.temporaryStructures || input.temporaryElectricity || input.workAtHeight || input.heavyObjectHandling || input.hotWork);

  if (lawEntryId.startsWith("performance_act")) return Boolean(isPerformance);
  if (lawEntryId === "food_sanitation_act_enforcement_rule") return Boolean(isFood);
  if (lawEntryId === "lp_gas_safety_act_enforcement_rule") return Boolean(input.lpgUse);
  if (lawEntryId === "road_act_enforcement_decree") return Boolean(input.roadUse);
  if (lawEntryId === "road_act_enforcement_rule") return Boolean(input.roadUse);
  if (lawEntryId === "building_act_enforcement_rule") return Boolean(input.temporaryStructures || isIndoorMice || isPerformance || hasWorkerWork);
  if (lawEntryId.startsWith("security_services_industry")) return Boolean(input.vipSecurity || inputHasEvent(input, "vip_event"));
  if (lawEntryId === "fire_prevention_act_enforcement_decree") return Boolean(isIndoorMice || isPerformance);
  if (annexId === "fire_facilities_act_enforcement_decree__annex_8") return hasWorkerWork;
  if (lawEntryId === "fire_facilities_act_enforcement_decree") {
    return Boolean(isIndoorMice || isPerformance || isFestival || isFood || (typeof input.expectedCrowd === "number" && input.expectedCrowd >= 1000));
  }
  return true;
}

function buildDocumentBundle(input: Input, sections: Record<string, string[]>, data: Record<string, unknown>) {
  const venue = data.venue as AnyRecord | null | undefined;
  const localOrdinances = asArray<AnyRecord>(data.localOrdinances);
  const venueRules = asArray<AnyRecord>(data.venueRules);
  const laws = asArray<AnyRecord>(data.laws);
  const hazards = asArray<AnyRecord>(data.hazards);
  const legalAnnexes = asArray<AnyRecord>(data.legalAnnexes);
  const venueFacility = buildVenueFacilitySummary(input, venue);
  const isPerformance = Boolean(input.performance || inputHasEvent(input, "performance"));
  const publicApiEvidence = buildPublicApiOperationalEvidence(input);
  const publicApiOperationalEvidence = formatPublicApiOperationalEvidence(publicApiEvidence);
  const medicalPublicApiLines = publicApiLinesFor(publicApiEvidence, ["NEMC_EMERGENCY_MEDICAL", "NEMC_AED"]);
  const foodPublicApiLines = publicApiLinesFor(publicApiEvidence, ["FOOD_SAFETY_KOREA"]);
  const performancePublicApiLines = publicApiLinesFor(publicApiEvidence, ["KOPIS_PERFORMANCE_CATALOG", "KCISA_KOPIS_PERFORMANCE_FACILITY"]);
  const operationsPublicApiLines = publicApiLinesFor(publicApiEvidence, ["KMA_APIHUB_WEATHER", "SEOUL_REALTIME_CITY_DATA", "AIRKOREA_AIR_QUALITY"]);

  const crowdHazards = hazards.filter((hazard) => ["crowd_density_high", "ingress_egress_bottleneck", "weather_outdoor_event"].includes(String(hazard.id)));
  const foodHazards = hazards.filter((hazard) => ["food_poisoning", "fire_hazard_hot_work_lpg"].includes(String(hazard.id)));
  const stageHazards = hazards.filter((hazard) => ["temporary_structure_collapse", "worker_fall_height", "heavy_object_handling", "temporary_electrical_fire_shock", "crowd_density_high", "blocked_evacuation_route", "medical_emergency", "weather_outdoor_event"].includes(String(hazard.id)));
  const privacyHazards = hazards.filter((hazard) => String(hazard.id) === "personal_data_cctv_privacy");
  const securityHazards = hazards.filter((hazard) => String(hazard.id) === "security_access_control_gap");
  const medicalHazards = hazards.filter((hazard) => String(hazard.id) === "medical_emergency");
  const workerHazards = hazards.filter((hazard) => ["worker_fall_height", "heavy_object_handling", "temporary_structure_collapse", "temporary_electrical_fire_shock"].includes(String(hazard.id)));
  const medicalLawItems = laws
    .filter((law) => ["emergency_medical_service_act", "emergency_medical_service_act_enforcement_decree", "emergency_medical_service_act_enforcement_rule"].includes(String(law.id)))
    .flatMap((law) => asArray<AnyRecord>(law.articles).slice(0, 5).map((article) => `${law.shortName ?? law.name ?? law.id} ${article.article ?? ""}: ${article.summary ?? article.title ?? ""}`));
  const privacyLawItems = laws
    .filter((law) => ["personal_information_protection_act", "personal_information_protection_act_enforcement_decree"].includes(String(law.id)))
    .flatMap((law) => asArray<AnyRecord>(law.articles).slice(0, 6).map((article) => `${law.shortName ?? law.name ?? law.id} ${article.article ?? ""}: ${article.summary ?? article.title ?? ""}`));
  const securityLawItems = laws
    .filter((law) => ["security_services_industry_act", "security_services_industry_act_enforcement_decree", "security_services_industry_act_enforcement_rule"].includes(String(law.id)))
    .flatMap((law) => asArray<AnyRecord>(law.articles).slice(0, 5).map((article) => `${law.shortName ?? law.name ?? law.id} ${article.article ?? ""}: ${article.summary ?? article.title ?? ""}`));
  const foodLpgAnnexItems = legalAnnexes
    .filter((annex) => ["food_sanitation_act_enforcement_rule", "lp_gas_safety_act_enforcement_rule"].includes(String(annex.lawEntryId)))
    .flatMap((annex) => asArray<string>(annex.checklistItems).slice(0, 4).map((item) => `${annex.lawName ?? annex.lawEntryId} ${annex.annexNo ?? ""}: ${item}`));
  const performanceAnnexItems = legalAnnexes
    .filter((annex) => String(annex.lawEntryId).startsWith("performance_act"))
    .flatMap((annex) => asArray<string>(annex.checklistItems).slice(0, 4).map((item) => `${annex.lawName ?? annex.lawEntryId} ${annex.annexNo ?? ""}: ${item}`));
  const roadAnnexItems = legalAnnexes
    .filter((annex) => ["road_act_enforcement_decree", "road_act_enforcement_rule"].includes(String(annex.lawEntryId)))
    .flatMap((annex) => asArray<string>(annex.checklistItems).slice(0, 5).map((item) => `${annex.lawName ?? annex.lawEntryId} ${annex.annexNo ?? ""}: ${item}`));
  const fireAnnexItems = legalAnnexes
    .filter((annex) => ["fire_prevention_act_enforcement_decree", "fire_facilities_act_enforcement_decree"].includes(String(annex.lawEntryId)))
    .flatMap((annex) => asArray<string>(annex.checklistItems).slice(0, 3).map((item) => `${annex.lawName ?? annex.lawEntryId} ${annex.annexNo ?? ""}: ${item}`));
  const buildingAnnexItems = legalAnnexes
    .filter((annex) => String(annex.lawEntryId) === "building_act_enforcement_rule")
    .flatMap((annex) => asArray<string>(annex.checklistItems).slice(0, 3).map((item) => `${annex.lawName ?? annex.lawEntryId} ${annex.annexNo ?? ""}: ${item}`));
  const securityAnnexItems = legalAnnexes
    .filter((annex) => String(annex.lawEntryId).startsWith("security_services_industry"))
    .flatMap((annex) => asArray<string>(annex.checklistItems).slice(0, 4).map((item) => `${annex.lawName ?? annex.lawEntryId} ${annex.annexNo ?? ""}: ${item}`));
  const medicalAnnexItems = legalAnnexes
    .filter((annex) => String(annex.lawEntryId) === "emergency_medical_service_act_enforcement_rule")
    .flatMap((annex) => asArray<string>(annex.checklistItems).slice(0, 4).map((item) => `${annex.lawName ?? annex.lawEntryId} ${annex.annexNo ?? ""}: ${item}`));
  const hasOutdoor = Boolean(input.outdoor || input.outdoorEvent || inputHasEvent(input, "festival") || inputHasEvent(input, "outdoor_event"));
  const hasRoadUse = input.roadUse === true;
  const hasOutdoorAdvertising = input.outdoorAdvertising === true;
  const hasPrivacyInput = Boolean(input.personalDataProcessing || inputHasEvent(input, "conference") || inputHasEvent(input, "vip_event"));
  const hasSecurityInput = Boolean(input.vipSecurity || inputHasEvent(input, "vip_event"));
  const relevantOutdoorOrdinances = hasOutdoor
    ? localOrdinances.filter((item) => ["outdoor_event_safety", "regional_festival_safety"].includes(String(item.categoryId ?? item.category)))
    : [];
  const localOrdinanceDeadline = relevantOutdoorOrdinances.find((item) => String(item.submissionDeadline ?? "").trim())?.submissionDeadline;
  const hasLocalOutdoorOrdinance = localOrdinances.some((item) => ["outdoor_event_safety", "regional_festival_safety"].includes(String(item.categoryId ?? item.category)));
  const hasRoadOrdinance = localOrdinances.some((item) => String(item.categoryId ?? item.category) === "road_occupancy");
  const hasAdvertisingOrdinance = localOrdinances.some((item) => String(item.categoryId ?? item.category) === "outdoor_advertising");
  const hasBuildingAnnex = buildingAnnexItems.length > 0;
  const hasRoadAnnex = roadAnnexItems.length > 0;
  const hasSecurity = hasSecurityInput;
  const hasMedical = medicalHazards.length > 0 || medicalLawItems.length > 0 || (typeof input.expectedCrowd === "number" && input.expectedCrowd >= 1000);
  const hasPrivacy = hasPrivacyInput;
  const hasWorker = workerHazards.length > 0 || sections.workerSafety.length > 0;
  const hasFood = Boolean(input.foodService || inputHasEvent(input, "food_event"));
  const hasRoad = Boolean(hasRoadUse || (hasOutdoor && (hasRoadOrdinance || hasRoadAnnex)));
  const hasUnhostedCrowd = Boolean(input.unhostedCrowd);
  const roadTrafficControlPlan = formatRoadTrafficControlPlan(input, {
    hasRoad,
    hasOutdoor,
    roadAnnexItems,
    localOrdinances,
    hasAdvertisingOrdinance,
  });
  const unhostedCrowdResponsePlan = formatUnhostedCrowdResponsePlan(input, {
    isUnhosted: hasUnhostedCrowd,
    hazards,
    localOrdinances,
  });
  const submissionRows = buildSubmissionRowsFromRules({
    flags: {
      hasUnhostedCrowd,
      isPerformance,
      hasOutdoorAndLocalOutdoorOrdinance: hasOutdoor && hasLocalOutdoorOrdinance,
      hasRoadUse,
      hasOutdoorAdvertisingAndAdvertisingOrdinance: hasOutdoorAdvertising && hasAdvertisingOrdinance,
      hasBuildingAnnex,
      hasVenue: Boolean(input.venueId),
      hasFireOrHotWorkOrLpg: fireAnnexItems.length > 0 || Boolean(input.hotWork || input.lpgUse),
      hasLpgUse: Boolean(input.lpgUse),
      hasFoodService: Boolean(input.foodService),
      hasPrivacy,
      hasSecurity,
      hasMedical,
      hasWorker,
    },
    replacements: {
      jurisdictionOrDefault: input.jurisdiction ?? "관할 지자체",
      localOrdinanceDeadline: String(localOrdinanceDeadline ?? "행사 5~21일 전 또는 조례별 기한 확인"),
      venueName: String(venue?.name ?? input.venueId ?? "베뉴"),
    },
  });

  const eventSafetyPlan = [
    `# ${input.eventName} 행사 안전관리계획서`,
    "",
    "## 행사 개요",
    ...lineList(sections.overview, "행사 개요 입력 필요"),
    "",
    "## 적용 법령·조례",
    ...lineList([...sections.legalBasis.slice(0, 12), ...sections.localOrdinances.slice(0, 8)], "법령/조례 매칭 없음"),
    "",
    "## 하위 별표·서식 체크포인트",
    ...lineList(sections.legalAnnexes.slice(0, 8), "별표·서식 조건 없음"),
    "",
    "## 안전관리 조직",
    "- 안전총괄책임자, 운영본부장, 구역장, 보안팀장, 의료담당, 시설/전기/소방 담당을 지정한다.",
    "- 베뉴 담당자와 관할 지자체, 소방, 경찰, 의료기관 연락체계를 운영본부에 비치한다.",
    ...(hasUnhostedCrowd ? [
      "- 무주최 다중운집은 주최자 없음 또는 책임 공백을 전제로 관계기관 합동상황반과 공동 현장지휘/RACI를 우선 적용한다.",
      "- 지자체, 경찰, 소방, 시설관리자, 철도/교통 운영기관의 권한 경계를 구역도와 연락망에 표시한다.",
    ] : []),
    "",
    "## 주요 위험과 통제",
    ...lineList(sections.hazardControls.slice(0, 10), "조건부 위험요인 없음"),
    "",
    "## 공공 API 운영 증거 요약",
    ...lineList(publicApiEvidence.applicableLines.slice(0, 8), "현재 입력 조건에 맞는 공공 API 운영 증거 없음"),
  ].join("\n");

  const crowdFlowPlan = [
    `# ${input.eventName} 인파·동선 관리계획`,
    "",
    ...lineList(crowdHazards.map(formatHazard), "인파·동선 조건 없음"),
    "- 게이트별 처리량, 대기열 길이, 혼잡 단계, 우회 동선, 피난 동선을 도면에 표시한다.",
    "- 순간 최대 인원과 구역별 수용능력 기준을 운영본부에서 모니터링한다.",
    "- 무주최/자발적 다중운집 가능성이 있으면 지자체·경찰·소방과 현장 통제 기준을 사전 합의한다.",
    ...(hasUnhostedCrowd ? [
      "- 무주최 다중운집 구역은 관찰/주의/경계/심각 단계별로 현 위치 대기, 일방통행, 출입구 제한, 해산·분산 안내 기준을 둔다.",
      "- 철도/버스/택시 등 교통 운영기관과 대기열 분산, 무정차·증편·승하차장 분리 요청 기준을 사전 합의한다.",
    ] : []),
    ...roadAnnexItems.map((item) => `- ${item}`),
  ].join("\n");

  const workerSafetyPlan = [
    `# ${input.eventName} 설치·철거 작업자 안전계획서`,
    "",
    ...lineList(sections.workerSafety, "설치·철거/고소/전기/화기/중량물 작업자 안전 조건 없음"),
    "",
    ...lineList(workerHazards.map(formatHazard), "작업자 위험요인 없음"),
    "- 작업계획서에는 작업명, 일시, 장소, 책임자, 작업자, 사전조사, 작업순서, 보호구, 작업중지 기준, 비상연락망을 포함한다.",
    "- 관람객 운영 시간과 설치·철거 작업 시간을 분리하고, 불가피한 혼재 구간은 통제선을 설치한다.",
  ].join("\n");

  const venueFacilityPlan = [
    `# ${input.eventName} 베뉴 시설·수용·하역·전기 제약 체크`,
    "",
    `- 베뉴: ${venueFacility.venueName}${venueFacility.venueId ? ` (${venueFacility.venueId})` : ""}`,
    "",
    "## 수용·면적·부스",
    ...lineList([...venueFacility.capacity, ...venueFacility.derived], "베뉴 수용/면적 데이터 없음. 홀별 도면과 베뉴 담당자 확인 필요"),
    "",
    "## 층고·리깅·천장 제한",
    ...lineList([...venueFacility.ceilingHeight, ...venueFacility.riggingRules], "층고/리깅 데이터 없음. 현수막·트러스·천장 작업은 베뉴 사전 승인 필요"),
    "",
    "## 바닥하중·중량물",
    ...lineList(venueFacility.floorLoad, "바닥하중 데이터 없음. 중량물 반입 전 하중분산계획과 베뉴 승인 필요"),
    "",
    "## 반입·하역·화물동선",
    ...lineList([...venueFacility.freightEntrance, ...venueFacility.loadingDock], "반입/하역 데이터 없음. 하역장, 화물출입구, 반입시간, 관람객 동선 분리 확인 필요"),
    "",
    "## 전기·유틸리티",
    ...lineList(venueFacility.electricity, "전기 데이터 없음. 전기설비도면, 분전반, 접지, 누전차단, 작업승인 확인 필요"),
    "",
    "## 소방·피난·제한물품",
    ...lineList([...venueFacility.fireLane, ...venueFacility.evacuationRoutes, ...venueFacility.restrictedItems], "소방·피난/제한물품 데이터 없음. 비상구, 소화전, 소방통로, 반입금지품 확인 필요"),
    "",
    "## 부스·식음료·제출서류",
    ...lineList([...venueFacility.boothRules, ...venueFacility.foodRules, ...venueFacility.safetyDocuments], "부스/식음료/제출서류 데이터 없음. 운영규정과 주최자 매뉴얼 확인 필요"),
    "",
    "## 근거 위치",
    ...lineList(
      venueFacility.sourceSpans.slice(0, 10).map((span) => `${span.category}: ${span.value} (${span.localMarkdownPath}${span.line ? `:${span.line}` : ""}, confidence ${span.confidence})`),
      "sourceSpan 없음",
    ),
  ].join("\n");

  const fireEvacuationChecklist = formatChecklist("소방·피난 점검표", [
    "비상구, 피난통로, 방화문, 방화셔터, 방화구획 주변 적재물 없음",
    "소화전, 소화기, 자동화재탐지설비, 비상방송 접근성 확인",
    "임시구조물·부스가 피난동선 또는 소방활동 공간을 침범하지 않음",
    "화기·위험물·가스 반입 승인 및 화재감시 체계 확인",
    "개장 전/피크 전/철거 전 사진 증빙 확보",
    ...fireAnnexItems,
    ...buildingAnnexItems,
  ]);

  const foodLpgChecklist = formatFoodLpgExecutionChecklist(input, {
    hasFood,
    hasLpg: Boolean(input.lpgUse),
    foodHazards,
    foodLpgAnnexItems,
    venueFacility,
    publicApiLines: foodPublicApiLines,
  });

  const performanceStagePlan = formatPerformanceStageExecutionPlan(input, {
    isPerformance,
    performanceAnnexItems,
    stageHazards,
    venueFacility,
    publicApiLines: performancePublicApiLines,
  });

  const privacyChecklist = formatChecklist("개인정보·CCTV 점검표", [
    ...(input.personalDataProcessing ? [
      "수집항목, 목적, 보관기간, 파기 기준 고지",
      "필수/선택 동의, 제3자 제공, 홍보성 이용 동의 항목 분리",
      "출입증/QR/등록 위탁 처리 계약과 수탁자 공개 확인",
      "행사 촬영·홍보 이용 고지 또는 동의 확인",
      "접근권한, 접속기록, 암호화, 현장 단말 잠금, 보관장소 등 안전성 확보 조치 확인",
    ] : []),
    ...privacyHazards.flatMap((hazard) => asArray<string>(hazard.controls).slice(0, 2)),
    ...privacyLawItems,
  ]);

  const securityAccessPlan = [
    `# ${input.eventName} 출입통제·보안검색·VIP 동선 계획`,
    "",
    ...lineList(securityHazards.map(formatHazard), "VIP/보안검색/민간경비 조건 없음"),
    "- 보안검색 위치, 대기열, 우회동선, 피난동선, 비상차량 접근동선이 충돌하지 않도록 도면에 표시한다.",
    "- VIP 동선, 반입금지품, 검색 예외, 돌발 민원, 미디어 동선, 경찰·소방·베뉴 보안실 연락 기준을 사전 합의한다.",
    "- 민간경비를 쓰는 경우 허가 업무 범위, 경비지도사, 신임교육, 경비원 명부, 배치신고 대상 여부를 확인한다.",
    ...securityLawItems.map((item) => `- ${item}`),
    ...securityAnnexItems.map((item) => `- ${item}`),
  ].join("\n");

  const medicalResponsePlan = [
    `# ${input.eventName} 응급의료·AED·구급 이송 계획`,
    "",
    ...lineList(medicalHazards.map(formatHazard), "응급의료/AED 조건 없음"),
    "- 의무실 또는 응급처치 지점, AED 위치, 구급차 접근동선, 이송병원, 119 신고 기준을 도면과 연락망에 표시한다.",
    "- AED 관리책임자, 월 1회 이상 점검, 사용교육, 관리서류 비치, 사용 시 응급의료지원센터 통보 절차를 확인한다.",
    "- 폭염, 고령자/영유아/장애인 참가, 스탠딩 공연, 야간·우천 행사 등 고위험 조건별 응급대응 인력을 조정한다.",
    "- 구급차 또는 이송 협력기관을 두는 경우 장비·의약품·통신장비, 소독, 연료, 보험, 운행기록 보관 기준을 확인한다.",
    "",
    "## 공공 API 운영 증거",
    ...lineList(medicalPublicApiLines, "대규모/공연/옥외/식음료 조건이 아니면 NEMC/AED 후보 조회는 조건부 확인으로 둔다"),
    "",
    ...medicalLawItems.map((item) => `- ${item}`),
    ...medicalAnnexItems.map((item) => `- ${item}`),
  ].join("\n");

  const staffAssignment = [
    `# ${input.eventName} 스태프 배치표`,
    "",
    "| 역할 | 담당 | 위치 | 주요 임무 | 보고 |",
    "| --- | --- | --- | --- | --- |",
    "| 안전총괄 | TBD | 운영본부 | 의사결정, 관계기관 협의, 중지 판단 | 총괄책임자 |",
    "| 구역장 | TBD | 주요 구역 | 인파·동선·위험요인 확인 | 안전총괄 |",
    "| 보안 | TBD | 게이트/혼잡구역 | 출입통제, 보안검색, 질서유지, 위험구역 통제 | 구역장 |",
    "| 경비지도사/경비업체 | TBD | 통제구역 | 경비원 교육·순회점검·경찰/소방 연락방법 지도 | 안전총괄 |",
    "| 의료 | TBD | 의무실/AED | 응급처치, 119 연계, 이송 기록 | 운영본부 |",
    "| 시설/전기 | TBD | 무대/부스/분전반 | 임시전기, 구조물, 소방통로 점검 | 안전총괄 |",
    ...(isPerformance ? [
      "| 공연안전 담당 | TBD | 무대·객석 | 공연 재해대처계획, 안전교육, 피난안내, 공연중지 기준 실행 | 안전총괄 |",
      "| 무대감독 | TBD | 무대 | 리허설, 아티스트/무대 중지 신호, 전원 차단, 공연 재개 확인 | 운영본부 |",
    ] : []),
    ...(hasUnhostedCrowd ? [
      "| 관계기관 합동상황반 | TBD | 현장지휘소 | 무주최 다중운집 단계 판단, 기관별 통제 권한 조정, 상황전파 | 지자체 재난안전상황실 |",
      "| 교통 운영기관 연락관 | TBD | 역사/정류장/승하차장 | 철도·버스·택시 대기열, 증편·무정차·출입구 조정 협의 | 합동상황반 |",
      "| 시설관리자 연락관 | TBD | 광장/상가/공개공지 | 관리주체 경계, 출입구, 통제선, 안내방송 협조 | 합동상황반 |",
    ] : []),
  ].join("\n");

  const emergencyContacts = [
    `# ${input.eventName} 비상연락망`,
    "",
    "- 운영본부: TBD",
    "- 안전총괄: TBD",
    "- 베뉴 담당: " + (venue?.name ? `${venue.name} 담당자 TBD` : "TBD"),
    "- 관할 지자체: " + (input.jurisdiction ?? "TBD"),
    "- 소방/119: TBD",
    "- 경찰: TBD",
    ...(hasUnhostedCrowd ? [
      "- 지자체 재난안전상황실: TBD",
      "- 철도/도시철도/버스/택시 운영기관: TBD",
      "- 광장/상가/공개공지 시설관리자: TBD",
      "- 현장 합동상황반 단일 상황방: TBD",
    ] : []),
    "- 의료기관/구급 이송: TBD",
    "- AED 위치/관리담당: TBD",
    "- 전기/가스/시설 긴급조치: TBD",
  ].join("\n");

  const dailySafetyChecklist = formatChecklist("일일 안전점검표", [
    "개장 전 비상구·소방시설·피난통로 확인",
    "게이트·대기열·혼잡 구역 스태프 배치 확인",
    "임시전기, 케이블 보호, 분전반 접근통제 확인",
    "부스·무대·트러스·현수막 전도/낙하 위험 확인",
    "AED, 의무실, 구급차 접근동선 확인",
    ...operationsPublicApiLines.slice(0, 6).map((line) => `공공 API 운영증거: ${line}`),
    "식음료·LPG·화기 구역 점검",
    ...(isPerformance ? ["공연중지 기준, 무대감독 중지 신호, 스탠딩 펜스, 피난안내 방송문 확인"] : []),
    ...(hasUnhostedCrowd ? ["무주최 다중운집 단계 판단, 공동 상황방, 기관별 통제 권한, 해산·분산 안내 기준 확인"] : []),
    "조치 전/후 사진과 담당자 기록",
    ...venueRules.slice(0, 4).map((rule) => String(rule.summary ?? rule.id)),
  ]);

  const incidentReportTemplate = [
    `# ${input.eventName} 사고보고서 템플릿`,
    "",
    "- 사고 일시:",
    "- 사고 장소:",
    "- 사고 유형:",
    "- 인명피해/물적피해:",
    "- 최초 신고자/접수자:",
    "- 초동조치:",
    "- 관계기관 신고:",
    "- 현장 통제/대피:",
    "- 사진/영상/증빙:",
    "- 원인 추정:",
    "- 재발방지 조치:",
    "- 종료 확인자:",
  ].join("\n");

  const submissionChecklist = formatSubmissionChecklist(submissionRows);
  const operationsRunsheet = formatOperationsRunsheet(input, buildOperationsRunsheetRows(input, {
    hasWorker,
    hasFood,
    hasLpg: Boolean(input.lpgUse),
    hasRoad,
    hasSecurity,
    hasPrivacy,
    hasVenue: Boolean(input.venueId),
    hasOutdoor,
    hasUnhostedCrowd,
    hasPerformance: isPerformance,
    venueName: venueFacility.venueName,
  }));
  const visitorSafetyNotices = buildDefaultMiceVisitorNoticeBundle(input).markdown;

  return {
    publicApiOperationalEvidence,
    eventSafetyPlan,
    crowdFlowPlan,
    roadTrafficControlPlan,
    unhostedCrowdResponsePlan,
    venueFacilityPlan,
    workerSafetyPlan,
    performanceStagePlan,
    fireEvacuationChecklist,
    foodLpgChecklist,
    privacyCctvChecklist: privacyChecklist,
    securityAccessPlan,
    medicalResponsePlan,
    staffAssignment,
    emergencyContacts,
    dailySafetyChecklist,
    operationsRunsheet,
    submissionChecklist,
    incidentReportTemplate,
    visitorSafetyNotices,
    localOrdinanceSummary: localOrdinances.map(formatLocalOrdinance),
  };
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const applicability = await queryMiceSafetyApplicabilityTool.handler(input);
  const data = applicability.structuredContent ?? {};

  const matchedEvents = asArray<AnyRecord>(data.matchedEventTypes);
  const laws = asArray<AnyRecord>(data.laws);
  const duties = asArray<AnyRecord>(data.duties);
  const hazards = asArray<AnyRecord>(data.hazards);
  const venueRules = asArray<AnyRecord>(data.venueRules);
  const workerSafetyReferences = asArray<AnyRecord>(data.workerSafetyReferences);
  const localOrdinances = asArray<AnyRecord>(data.localOrdinances);
  const documentLocalOrdinances = filterLocalOrdinancesForInput(localOrdinances, input);
  const venue = data.venue as AnyRecord | null | undefined;
  const venueFacility = buildVenueFacilitySummary(input, venue);
  const legalAnnexes = uniqueById([
    ...laws.flatMap((law) => findLegalAnnexes({ lawEntryId: String(law.id ?? "") })),
    ...duties.flatMap((duty) => findLegalAnnexes({ dutyId: String(duty.id ?? "") })),
    ...hazards.flatMap((hazard) => findLegalAnnexes({ hazardId: String(hazard.id ?? "") })),
  ]).filter((annex) => isLegalAnnexApplicable(annex as unknown as AnyRecord, input));

  const sections = {
    overview: [
      `행사명: ${input.eventName}`,
      eventDateValue(input) ? `일자: ${eventDateValue(input)}` : undefined,
      input.location ? `장소: ${input.location}` : undefined,
      input.organizer ? `주최/주관: ${input.organizer}` : undefined,
      input.expectedCrowd !== undefined ? `예상 인원: ${input.expectedCrowd}` : undefined,
      matchedEvents.length > 0 ? `행사 유형: ${matchedEvents.map((event) => event.label ?? event.id).join(", ")}` : undefined,
      flagSummary(input).length > 0 ? `핵심 조건: ${flagSummary(input).join(", ")}` : undefined,
      venue ? `베뉴: ${venue.name ?? input.venueId}` : undefined,
      input.jurisdiction ? `관할 지자체: ${input.jurisdiction}` : undefined,
    ].filter((item): item is string => Boolean(item)),
    legalBasis: laws.map(formatLaw),
    legalAnnexes: legalAnnexes.map((annex) => formatLegalAnnex(annex as unknown as AnyRecord)),
    localOrdinances: documentLocalOrdinances.map(formatLocalOrdinance),
    primaryLocalOrdinances: formatLocalOrdinanceGroup(documentLocalOrdinances, ["primary", "secondary"]),
    referenceLocalOrdinances: formatLocalOrdinanceGroup(documentLocalOrdinances, ["reference"]),
    requiredDocuments: duties.map(formatDuty),
    hazardControls: hazards.map(formatHazard),
    venueRules: [
      ...asArray<string>(venue?.facilityFacts).map((fact) => `시설정보: ${fact}`),
      ...venueFacility.derived.map((item) => `시설계산: ${item}`),
      ...venueFacility.floorLoad.slice(0, 3).map((item) => `바닥하중: ${item}`),
      ...venueFacility.electricity.slice(0, 3).map((item) => `전기: ${item}`),
      ...venueFacility.loadingDock.slice(0, 3).map((item) => `하역: ${item}`),
      ...venueRules.map(formatVenueRule),
    ],
    workerSafety: workerSafetyReferences.map(formatWorkerRef),
  };
  const documentBundle = buildDocumentBundle(input, sections, { ...data, localOrdinances: documentLocalOrdinances, legalAnnexes });
  const executiveSummary = buildExecutiveSummaryMarkdown(input, sections, documentBundle, documentLocalOrdinances);

  const markdown = [
    `# ${input.eventName} 안전관리계획서 초안`,
    "",
    "> 이 문서는 로컬 MICE 안전 온톨로지 기반 초안입니다. 제출·승인 전 관할 지자체, 베뉴, 소방·경찰, 최신 법령 원문으로 확인해야 합니다.",
    "",
    executiveSummary,
    "",
    "## 1. 행사 개요",
    ...lineList(sections.overview, "행사 개요 입력 필요"),
    "",
    "## 2. 공공 API 운영 증거",
    ...documentBundle.publicApiOperationalEvidence.split(/\r?\n/).filter((line) => line.trim()).slice(3, 18),
    "",
    "## 3. 적용 법령·근거",
    ...lineList(sections.legalBasis, "공통 법령 외 조건부 법령 없음"),
    "",
    "## 4. 하위 별표·서식 체크포인트",
    ...lineList(sections.legalAnnexes, "조건부 별표·서식 없음"),
    "",
    "## 5. 지자체 조례·인허가 확인",
    "### 우선 적용 조례 후보",
    ...lineList(sections.primaryLocalOrdinances, "우선 적용 조례 후보 없음. 관할 지자체와 베뉴 소재지를 확인하세요"),
    "",
    "### 참고 후보",
    ...lineList(sections.referenceLocalOrdinances, "참고 후보 없음"),
    "",
    "## 6. 제출·승인 문서",
    ...lineList(sections.requiredDocuments, "조건부 제출 문서 없음"),
    "",
    "## 7. 주요 위험요인 및 통제대책",
    ...lineList(sections.hazardControls, "조건부 위험요인 없음"),
    "",
    "## 8. 베뉴·시설 체크",
    ...lineList(sections.venueRules, "베뉴 미지정 또는 베뉴 규정 없음"),
    "",
    "## 9. 설치·철거 작업자 안전",
    ...lineList(sections.workerSafety, "설치·철거/고소/전기/화기/중량물 작업자 안전 조건 없음"),
    "",
    "## 10. 인파·동선 운영",
    "- 구역별 수용인원, 게이트 처리량, 대기열, 우회동선, 피난동선을 도면에 표시한다.",
    "- 피크 시간대 스태프 배치와 혼잡 단계별 안내 문구를 운영본부가 사전 승인한다.",
    "- 비상구, 소화전, 후면 소방통로, 구급차 접근동선은 설치·운영·철거 전 기간 차단하지 않는다.",
    ...(input.unhostedCrowd ? ["- 무주최 다중운집은 주최자 없음, 공동 현장지휘, 기관별 권한 경계, 해산·분산 안내 기준을 별도 문서로 관리한다."] : []),
    "",
    "## 11. 소방·응급·상황전파",
    "- 소방시설, 피난시설, 화기·가스 반입, 임시전기, AED, 의무실, 119 신고·이송 동선을 일일 점검한다.",
    "- 운영본부, 안전총괄, 구역장, 보안, 의료, 베뉴, 소방·경찰 연락체계를 하나의 연락망으로 배포한다.",
    "- 사고 발생 시 신고, 현장통제, 응급처치, 기록, 재발방지 조치 담당을 분리한다.",
    "",
    "## 12. 증빙·기록",
    "- 안전관리계획서, 인파관리계획, 작업자 안전계획, 체크리스트, 교육명단, 현장사진, 개선조치 기록을 행사 종료 후 보존한다.",
    "- 법령·조례·베뉴 규정 인용은 최종 제출 전 원문 URL과 시행일을 재확인한다.",
    "",
    "# 부록: 실무 문서 묶음",
    "",
    documentBundle.publicApiOperationalEvidence,
    "",
    documentBundle.eventSafetyPlan,
    "",
    documentBundle.crowdFlowPlan,
    "",
    documentBundle.roadTrafficControlPlan,
    "",
    documentBundle.unhostedCrowdResponsePlan,
    "",
    documentBundle.venueFacilityPlan,
    "",
    documentBundle.workerSafetyPlan,
    "",
    documentBundle.performanceStagePlan,
    "",
    documentBundle.fireEvacuationChecklist,
    "",
    documentBundle.foodLpgChecklist,
    "",
    documentBundle.privacyCctvChecklist,
    "",
    documentBundle.securityAccessPlan,
    "",
    documentBundle.medicalResponsePlan,
    "",
    documentBundle.staffAssignment,
    "",
    documentBundle.emergencyContacts,
    "",
    documentBundle.dailySafetyChecklist,
    "",
    documentBundle.operationsRunsheet,
    "",
    documentBundle.submissionChecklist,
    "",
    documentBundle.incidentReportTemplate,
    "",
    documentBundle.visitorSafetyNotices,
  ].join("\n");

  return {
    content: [{ type: "text", text: markdown }],
	    structuredContent: {
	      input,
	      sections,
	      executiveSummary,
	      documentBundle,
	      venueFacility,
      applicability: data,
      planMarkdown: markdown,
      _meta: COMMON_RESPONSE_META,
    },
  };
}

export const generateMiceSafetyPlanTool: ToolDefinition = {
  name: "generate_mice_safety_plan",
  title: "MICE 안전관리계획서 초안 생성",
  description:
    "행사 유형·베뉴·관할 지자체·위험 조건을 입력하면 오프라인 법령/조례/베뉴/KOSHA 온톨로지와 공공 API 운영 증거 스냅샷에 기반한 안전관리계획서, 도로·교통 실행계획, 무주최 다중운집 대응계획, 런시트를 Markdown으로 생성합니다.",
  inputSchema,
  handler,
};
