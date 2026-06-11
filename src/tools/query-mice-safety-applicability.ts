import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import {
  findDuties,
  findHazards,
  findPerformanceVenue,
  findLaws,
  findLocalOrdinances,
  findSources,
  findWorkerSafetyReferences,
  MICE_DATA,
  strictnessLabel,
  strictnessRank,
  uniqueById,
} from "../lib/mice-data.js";

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
  eventTypes: z.array(EventTypeSchema).optional().describe("MICE 행사 유형. 예: festival, outdoor_event, exhibition, conference, performance"),
  venueId: z.string().optional().describe("거점 베뉴 ID. 예: coex, kintex, bexco, ceco, exco, osco, icc_jeju"),
  jurisdiction: z.string().optional().describe("관할 광역/기초 지자체명. 예: 경기도 고양시, 부산광역시, 광주광역시 서구"),
  expectedCrowd: z.number().int().min(0).optional().describe("예상 최대 동시/일 방문 인원"),
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

function eventTypeFromFlags(input: Input): string[] {
  const inferred: string[] = [];
  const explicitEventTypes = new Set((input.eventTypes ?? []).map(normalizeEventType));
  const hasFestivalContext = explicitEventTypes.has("festival") || input.outdoor || input.outdoorEvent || input.roadUse;
  if (input.outdoor || input.outdoorEvent || input.roadUse) inferred.push("festival");
  if ((input.temporaryStructures || input.setupTeardown || input.workAtHeight || input.heavyObjectHandling || input.hotWork || input.temporaryElectricity) && !hasFestivalContext && !input.performance) {
    inferred.push("exhibition");
  }
  if (input.performance) inferred.push("performance");
  if (input.foodService || input.lpgUse) inferred.push("food_event");
  if (input.vipSecurity) inferred.push("vip_event");
  return inferred;
}

function normalizeEventType(eventType: string): string {
  if (eventType === "outdoor_event") return "festival";
  return eventType;
}

function isFeatureMatched(rule: (typeof MICE_DATA.applicability.featureRules)[number], input: Input): boolean {
  if (rule.match.flag) return input[rule.match.flag as keyof Input] === true;
  if (rule.match.field === "expectedCrowd" && rule.match.operator === ">=" && typeof rule.match.value === "number") {
    return typeof input.expectedCrowd === "number" && input.expectedCrowd >= rule.match.value;
  }
  return false;
}

function sourceIdsFromItems(items: Array<{ sourceRefs?: string[] }>): string[] {
  return Array.from(new Set(items.flatMap((item) => item.sourceRefs ?? [])));
}

function lawRefsFromDutiesAndHazards(items: Array<{ lawRefs?: string[] }>): string[] {
  return Array.from(new Set(items.flatMap((item) => item.lawRefs ?? [])));
}

function lawIdFromRef(ref: string): string {
  return ref.split(":")[0] ?? ref;
}

function formatLaw(law: ReturnType<typeof findLaws>[number]): string {
  const articlePart = law.articles.length > 0
    ? ` 핵심 조문: ${law.articles.map((article) => `${article.article} ${article.title}`).join(", ")}.`
    : " 핵심 조문: 추가 검토 필요.";
  return `- ${law.name} (${law.id}) — ${law.verificationStatus}: ${law.miceUse}.${articlePart}`;
}

function formatDuty(duty: ReturnType<typeof findDuties>[number]): string {
  return `- ${duty.title} (${duty.id}) — ${strictnessLabel(duty.strictness)}: ${duty.requiredWhen}`;
}

function formatHazard(hazard: ReturnType<typeof findHazards>[number]): string {
  return `- ${hazard.label} (${hazard.id}) — ${hazard.riskLevel}: ${hazard.controls[0]}`;
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const requestedEventTypes = Array.from(new Set([
    ...(input.eventTypes ?? []).map(normalizeEventType),
    ...eventTypeFromFlags(input),
  ]));

  const matchedEvents = MICE_DATA.applicability.eventTypes.filter((event) => requestedEventTypes.includes(event.id));
  const matchedFeatureRules = MICE_DATA.applicability.featureRules.filter((rule) => isFeatureMatched(rule, input));
  const venue = input.venueId ? MICE_DATA.venues.find((item) => item.id === input.venueId) : undefined;
  const performanceVenue = input.venueId ? findPerformanceVenue(input.venueId) : undefined;
  const resolvedJurisdiction = input.jurisdiction ?? performanceVenue?.jurisdiction;
  const resolvedVenue = venue
    ? {
      id: venue.id,
      name: venue.name,
      region: venue.region,
      website: venue.website,
      facilityFacts: venue.facilityFacts ?? [],
      safetyProfile: venue.safetyProfile ?? null,
      source: "venue_safety_rules",
    }
    : performanceVenue
      ? {
        id: performanceVenue.venueId,
        name: performanceVenue.name,
        region: performanceVenue.jurisdiction || performanceVenue.sido,
        website: performanceVenue.sourceUrl,
        address: performanceVenue.address,
        jurisdiction: performanceVenue.jurisdiction,
        category: performanceVenue.category,
        contact: performanceVenue.contact,
        facilityFacts: [
          performanceVenue.address ? `주소: ${performanceVenue.address}` : undefined,
          performanceVenue.category ? `KOPIS 시설 분류: ${performanceVenue.category}` : undefined,
          performanceVenue.contact ? `대표 연락처: ${performanceVenue.contact}` : undefined,
        ].filter((item): item is string => Boolean(item)),
        safetyProfile: {
          offlineCoverage: ["KOPIS 공연시설명·주소·관할·분류·연락처"],
          gaps: ["수용인원, 피난·소방 도면, 대관/반입/작업 안전 규정은 해당 시설 원문으로 별도 확인 필요"],
          lastReviewedAt: "KOPIS offline directory",
        },
        source: "kopis_performance_facility",
      }
      : null;

  const scopeWarnings: string[] = [];
  if (input.venueId && !resolvedVenue) {
    scopeWarnings.push(`지정한 베뉴 ID '${input.venueId}'를 찾을 수 없습니다 (오타 또는 미지원 베뉴). 베뉴 규정은 결과에 반영되지 않았습니다.`);
  }
  if (typeof input.expectedCrowd === "number" && input.expectedCrowd > 100000) {
    scopeWarnings.push(`예상 인원 ${input.expectedCrowd.toLocaleString("ko-KR")}명은 본 도구의 검증 범위(약 10만 명)를 초과합니다. 초대형 다중운집은 별도 정밀 계획과 관계기관 사전협의가 필요합니다.`);
  }
  const knownKeys = new Set(Object.keys(inputSchema.shape));
  const ignoredKeys = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
    ? Object.keys(rawInput as Record<string, unknown>).filter((key) => !knownKeys.has(key))
    : [];
  if (ignoredKeys.length > 0) {
    scopeWarnings.push(`인식하지 못해 무시된 입력 항목: ${ignoredKeys.join(", ")}. 드론·불꽃·발파 등 별도 법령이 적용되는 조건이면 해당 법령을 직접 확인하세요.`);
  }

  const commonLaws = findLaws(MICE_DATA.applicability.commonLawIds);
  const conditionalLawIds = [
    ...matchedEvents.flatMap((event) => event.conditionalLawIds),
    ...matchedFeatureRules.flatMap((rule) => rule.lawIds),
  ];
  const duties = uniqueById(findDuties([
    ...matchedEvents.flatMap((event) => event.dutyIds),
    ...matchedFeatureRules.flatMap((rule) => rule.dutyIds),
  ])).sort((a, b) => strictnessRank(a.strictness) - strictnessRank(b.strictness));
  const hazards = uniqueById(findHazards([
    ...matchedEvents.flatMap((event) => event.hazardIds),
    ...matchedFeatureRules.flatMap((rule) => rule.hazardIds),
  ]));

  const lawIdsFromRefs = lawRefsFromDutiesAndHazards([...duties, ...hazards]).map(lawIdFromRef);
  const laws = uniqueById(findLaws([...MICE_DATA.applicability.commonLawIds, ...conditionalLawIds, ...lawIdsFromRefs]));
  const sourceIds = Array.from(new Set([
    ...sourceIdsFromItems(duties),
    ...sourceIdsFromItems(hazards),
    ...(venue?.sourceRefs ?? []),
    ...(performanceVenue ? ["KCISA_KOPIS_PERFORMANCE_FACILITY"] : []),
    ...(resolvedJurisdiction || requestedEventTypes.includes("festival") ? ["LOCAL_ORDINANCE_PACK_2026"] : []),
  ]));
  const sources = findSources(sourceIds);
  const venueRules = venue?.rules ?? [];
  const workerSafetyReferences = uniqueById([
    ...duties.flatMap((duty) => findWorkerSafetyReferences({ dutyId: duty.id })),
    ...hazards.flatMap((hazard) => findWorkerSafetyReferences({ hazardId: hazard.id })),
  ]);
  const localOrdinances = findLocalOrdinances({
    jurisdiction: resolvedJurisdiction,
    venueId: input.venueId,
    eventType: requestedEventTypes.includes("festival") ? "festival" : requestedEventTypes[0],
    eventTypes: requestedEventTypes,
    roadUse: input.roadUse,
    outdoor: input.outdoor,
    outdoorEvent: input.outdoorEvent,
    temporaryStructures: input.temporaryStructures,
    limit: input.jurisdiction ? 30 : 12,
  });

  const needsReview = laws
    .filter((law) => ["needs_article_review", "needs_source_review", "todo"].includes(law.verificationStatus))
    .map((law) => ({
      id: law.id,
      name: law.name,
      verificationStatus: law.verificationStatus,
      next: law.mst
        ? `LAW_OC=... node /Volumes/data/Dev/korean-law-mcp/build/cli.js get_law_text --mst ${law.mst}`
        : "korean-law-mcp로 원문 재조회 필요",
    }));

  const structuredContent = {
    version: MICE_DATA.applicability.version,
    input,
    resolvedJurisdiction,
    matchedEventTypes: matchedEvents.map((event) => ({ id: event.id, label: event.label, conditions: event.conditions })),
    matchedFeatureRules: matchedFeatureRules.map((rule) => ({ id: rule.id, label: rule.label })),
    venue: resolvedVenue,
    laws,
    duties,
    hazards,
    venueRules,
    workerSafetyReferences,
    localOrdinances,
    sources,
    needsReview,
    scopeWarnings,
    _meta: COMMON_RESPONSE_META,
  };

  const text = [
    "# MICE 안전 적용성 결과",
    `입력: ${JSON.stringify(input)}`,
    scopeWarnings.length > 0 ? `\n## ⚠ 검증 범위 경고\n${scopeWarnings.map((warning) => `- ${warning}`).join("\n")}` : "",
    `\n> 데이터 기준일 ${COMMON_RESPONSE_META.dataAsOf} · ${COMMON_RESPONSE_META.freshnessWarning}`,
    "",
    "## 행사 유형",
    matchedEvents.length > 0
      ? matchedEvents.map((event) => `- ${event.label} (${event.id})`).join("\n")
      : "- 특정 유형 없음. 공통 법령 후보만 반환",
    matchedFeatureRules.length > 0 ? matchedFeatureRules.map((rule) => `- ${rule.label} (${rule.id})`).join("\n") : "",
    resolvedVenue ? `- 베뉴: ${resolvedVenue.name} (${resolvedVenue.id})` : "",
    resolvedVenue?.facilityFacts?.length ? resolvedVenue.facilityFacts.map((fact) => `- 베뉴 시설: ${fact}`).join("\n") : "",
    "",
    "## 법령 후보",
    ...laws.map(formatLaw),
    "",
    "## 필요/권장 문서",
    duties.length > 0 ? duties.map(formatDuty).join("\n") : "- 조건부 문서 없음",
    "",
    "## 주요 위험요인",
    hazards.length > 0 ? hazards.map(formatHazard).join("\n") : "- 조건부 위험요인 없음",
    "",
    "## 베뉴 체크포인트",
    venueRules.length > 0
      ? venueRules.map((rule) => `- ${rule.summary} (${rule.id})`).join("\n")
      : "- 베뉴 미지정 또는 베뉴 규정 없음",
    "",
    "## 작업자 안전/KOSHA·산안기준규칙",
    workerSafetyReferences.length > 0
      ? workerSafetyReferences.map((ref) => `- ${ref.title} (${ref.id}) — ${ref.summary}`).join("\n")
      : "- 설치·철거/고소/전기/화기/중량물 작업자 안전 레이어 조건 없음",
    "",
    "## 지자체 조례 후보",
    localOrdinances.length > 0
      ? localOrdinances.map((item) => `- ${item.jurisdiction} — ${item.name} (${item.categoryLabel}, ${item.effectiveAt || "시행일 확인 필요"}, 우선순위 ${item.priorityBand}/${item.priorityScore})`).join("\n")
      : "- 관할 지자체명 미입력 또는 매칭 조례 없음. 옥외행사·도로점용·옥외광고물은 관할 지자체 확인 필요",
    "",
    "## 출처",
    sources.map((source) => `- ${source.title} — ${source.publisher}: ${source.url}`).join("\n"),
    needsReview.length > 0 ? `\n검토 필요: ${needsReview.map((item) => item.id).join(", ")}` : "",
  ].filter(Boolean).join("\n");

  return { content: [{ type: "text", text }], structuredContent };
}

export const queryMiceSafetyApplicabilityTool: ToolDefinition = {
  name: "query_mice_safety_applicability",
  title: "MICE 행사 안전·법령 적용성 조회",
  description:
    "행사 유형, 예상 인파, 현장 특징, 베뉴 ID를 입력하면 MICE 공통/조건부 법령, 문서 의무, 위험요인, 베뉴 체크포인트를 로컬 온톨로지에서 결정론적으로 반환합니다.",
  inputSchema,
  handler,
};
