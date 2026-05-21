import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import { findSources, MICE_DATA } from "../lib/mice-data.js";
import venueFacilityIndex from "../ontology/mice/venue-facility-index.json" with { type: "json" };

const inputSchema = z.object({
  venueId: z.string().optional().describe("베뉴 ID. 예: coex, kintex, bexco, setec, songdo_convensia, ceco"),
  category: z.string().optional().describe("필터 예: egress_fire_lane, temporary_structure, construction_safety, privacy_cctv"),
});

function formatSource(source: ReturnType<typeof findSources>[number]): string {
  const local = source.localMarkdownPath ? ` (offline: ${source.localMarkdownPath})` : "";
  return `- ${source.title}: ${source.url}${local}`;
}

function pickLines(lines: string[], patterns: RegExp[], limit = 8): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (!patterns.some((pattern) => pattern.test(line))) continue;
    if (!out.includes(line)) out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}

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
  version: string;
  generatedAt: string;
  venues: Array<{ venueId: string; entries: FacilityIndexEntry[] }>;
};

function facilityEntriesForVenue(venueId: string): FacilityIndexEntry[] {
  return facilityIndexData.venues.find((venue) => venue.venueId === venueId)?.entries ?? [];
}

function valuesFor(entries: FacilityIndexEntry[], category: string, limit = 8): string[] {
  return entries
    .filter((entry) => entry.category === category)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit)
    .map((entry) => entry.value);
}

function spansFor(entries: FacilityIndexEntry[], categories: string[], limit = 20): FacilityIndexEntry[] {
  const categorySet = new Set(categories);
  return entries
    .filter((entry) => categorySet.has(entry.category))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

function buildFacilityProfile(venue: (typeof MICE_DATA.venues)[number], sources: ReturnType<typeof findSources>) {
  const rules = venue.rules.flatMap((rule) => [rule.summary, ...rule.checkpoints]);
  const entries = facilityEntriesForVenue(venue.id);
  const facts = [
    ...(venue.facilityFacts ?? []),
    ...(venue.spaces ?? []).flatMap((space) => [`${space.name}: ${space.facts.join("; ")}`, ...space.facts]),
    ...rules,
  ];
  return {
    region: venue.region,
    province: venue.province ?? venue.region.split(" ")[0] ?? "확인 필요",
    city: venue.city ?? venue.region.split(" ")[1] ?? "확인 필요",
    halls: (venue.spaces ?? []).map((space) => ({
      id: space.id,
      name: space.name,
      facts: space.facts,
      sourceUrl: space.sourceUrl,
    })),
    capacity: [...pickLines(facts, [/수용|부스|면적|전시홀|hall|㎡/i], 3), ...valuesFor(entries, "capacity", 6)],
    ceilingHeight: [...pickLines(facts, [/천정|천장|천고|제한높이|height/i], 2), ...valuesFor(entries, "ceilingHeight", 4)],
    floorLoad: [...pickLines(facts, [/하중|ton|t\/㎡|kg\/㎡|중량/i], 2), ...valuesFor(entries, "floorLoad", 6)],
    freightEntrance: [...pickLines(facts, [/화물출입|화물차|반입|반출|도크|loading/i], 2), ...valuesFor(entries, "freightEntrance", 6)],
    loadingDock: [...pickLines(facts, [/로딩|도크|화물차|상하차|하역|반입|반출/i], 2), ...valuesFor(entries, "loadingDock", 6)],
    electricity: [...pickLines(facts, [/전기|전원|분전|전열|접지|누전|설비도면/i], 2), ...valuesFor(entries, "electricity", 8)],
    fireLane: [...pickLines(facts, [/소방통로|소화전|소화기|방화|화재|소방차/i], 2), ...valuesFor(entries, "fireLane", 8)],
    evacuationRoutes: [...pickLines(facts, [/피난|대피|비상구|비상통로|유도등|출입구/i], 2), ...valuesFor(entries, "evacuationRoutes", 8)],
    restrictedItems: [...pickLines(facts, [/금지|제한|위험물|화기|가스|LPG|흡연|음주|전기톱|그라인더/i], 2), ...valuesFor(entries, "restrictedItems", 8)],
    boothRules: [...pickLines(facts, [/부스|독립|복층|구조물|시공|장치|철거/i], 2), ...valuesFor(entries, "boothRules", 8)],
    riggingRules: [...pickLines(facts, [/리깅|트러스|천정|천장|현수막|배너|광고|고정/i], 2), ...valuesFor(entries, "riggingRules", 6)],
    foodRules: [...pickLines(facts, [/식음료|조리|외부음식|푸드|LPG|가스|위생/i], 2), ...valuesFor(entries, "foodRules", 6)],
    safetyDocuments: [...pickLines(facts, [/신청서|허가서|작업신고|안전|계획서|도면|증빙|명단/i], 2), ...valuesFor(entries, "safetyDocuments", 8)],
    sourceRefs: venue.sourceRefs,
    localMarkdownPath: sources.map((source) => source.localMarkdownPath).filter((path): path is string => Boolean(path)),
    sourceSpans: spansFor(entries, [
      "capacity",
      "floorLoad",
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
    ]),
    verificationStatus: venue.safetyProfile?.gaps.length ? "needs_review" : "source_verified",
  };
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const venues = input.venueId
    ? MICE_DATA.venues.filter((venue) => venue.id === input.venueId)
    : MICE_DATA.venues;

  const items = venues.map((venue) => {
    const sources = findSources(venue.sourceRefs);
    const rules = input.category
      ? venue.rules.filter((rule) => rule.category === input.category)
      : venue.rules;
    return {
      ...venue,
      rules,
      sources,
      facilityProfile: buildFacilityProfile(venue, sources),
    };
  });

  const text = [
    "# MICE 베뉴 안전수칙",
    ...items.flatMap((venue) => [
      "",
      `## ${venue.name} (${venue.id})`,
      `- 지역: ${venue.region}`,
      `- 웹사이트: ${venue.website}`,
      venue.facilityFacts && venue.facilityFacts.length > 0
        ? ["시설/운영 사실:", ...venue.facilityFacts.map((fact) => `- ${fact}`)].join("\n")
        : "",
      venue.safetyProfile
        ? [
          "오프라인 커버리지:",
          ...venue.safetyProfile.offlineCoverage.map((item) => `- ${item}`),
          venue.safetyProfile.gaps.length > 0 ? "남은 갭:" : "",
          ...venue.safetyProfile.gaps.map((gap) => `- ${gap}`),
        ].filter(Boolean).join("\n")
        : "",
      "공통 시설 스키마:",
      `- 수용/면적: ${venue.facilityProfile.capacity.join(" / ") || "확인 필요"}`,
      `- 바닥하중: ${venue.facilityProfile.floorLoad.join(" / ") || "확인 필요"}`,
      `- 천장고/제한높이: ${venue.facilityProfile.ceilingHeight.join(" / ") || "확인 필요"}`,
      `- 반입·하역: ${venue.facilityProfile.loadingDock.join(" / ") || "확인 필요"}`,
      `- 전기: ${venue.facilityProfile.electricity.join(" / ") || "확인 필요"}`,
      `- 소방·피난: ${[...venue.facilityProfile.fireLane, ...venue.facilityProfile.evacuationRoutes].slice(0, 6).join(" / ") || "확인 필요"}`,
      `- 제한·금지: ${venue.facilityProfile.restrictedItems.join(" / ") || "확인 필요"}`,
      `- 로컬 MD: ${venue.facilityProfile.localMarkdownPath.join(", ") || "없음"}`,
      venue.facilityProfile.sourceSpans.length > 0
        ? [
          "주요 근거 위치:",
          ...venue.facilityProfile.sourceSpans.slice(0, 8).map((span) => `- ${span.category}: ${span.localMarkdownPath}${span.line ? `:${span.line}` : ""} (${span.confidence})`),
        ].join("\n")
        : "",
      venue.rules.length > 0
        ? venue.rules.map((rule) => [
          `- ${rule.summary} (${rule.id}, ${rule.category}, ${rule.verificationStatus})`,
          ...rule.checkpoints.map((checkpoint) => `  - ${checkpoint}`),
        ].join("\n")).join("\n")
        : "- 필터에 맞는 수칙 없음",
      "출처:",
      ...venue.sources.map(formatSource),
    ]),
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: { input, venues: items, _meta: COMMON_RESPONSE_META },
  };
}

export const queryMiceVenueSafetyRulesTool: ToolDefinition = {
  name: "query_mice_venue_safety_rules",
  title: "MICE 거점 베뉴 안전수칙 조회",
  description:
    "지역별 MICE 거점 베뉴의 수집된 공식 출처, 오프라인화된 운영/안전 문서, 시설정보, 안전 체크포인트를 조회합니다.",
  inputSchema,
  handler,
};
