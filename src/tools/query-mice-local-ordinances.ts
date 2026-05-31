import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import { findLocalOrdinances, MICE_DATA } from "../lib/mice-data.js";

const inputSchema = z.object({
  categoryId: z.enum(["regional_festival_safety", "outdoor_event_safety", "road_occupancy", "outdoor_advertising"]).optional(),
  jurisdiction: z.string().optional().describe("광역/기초 지자체명. 예: 경기도 고양시, 부산광역시, 광주광역시 서구"),
  venueId: z.string().optional().describe("베뉴 ID. 입력하면 베뉴 소재 지자체를 우선순위 힌트로 사용"),
  eventType: z.string().optional().describe("festival, outdoor_event, exhibition, performance 등"),
  eventTypes: z.array(z.string()).optional().describe("여러 행사 유형을 동시에 반영"),
  dutyId: z.string().optional(),
  hazardId: z.string().optional(),
  query: z.string().optional().describe("조례명/지역명 부분 검색어"),
  roadUse: z.boolean().optional().describe("도로점용/교통통제 조건"),
  outdoor: z.boolean().optional(),
  outdoorEvent: z.boolean().optional(),
  temporaryStructures: z.boolean().optional(),
  includeArticles: z.boolean().optional().default(false).describe("우선 지자체에 수집된 조문 발췌 포함"),
  limit: z.number().int().min(1).max(100).optional().default(30),
});

function formatRecord(record: ReturnType<typeof findLocalOrdinances>[number], includeArticles: boolean): string {
  const thresholdStructured = record.thresholdStructured;
  const articleLines = includeArticles && record.articleExtracts.length > 0
    ? [
      "  조문 발췌:",
      ...record.articleExtracts.slice(0, 6).map((article) => `  - ${article.title || article.article}: ${article.textExcerpt}`),
    ]
    : [];
  return [
    `- ${record.jurisdiction} — ${record.name}`,
    `  우선순위: ${record.priorityBand} / ${record.priorityScore}점${record.priorityReasons.length > 0 ? ` — ${record.priorityReasons.join("; ")}` : ""}`,
    `  범주: ${record.categoryLabel} / 시행일: ${record.effectiveAt || "확인 필요"} / ordinSeq: ${record.ordinSeq}`,
    `  검증: ${record.verificationStatus} / threshold ${thresholdStructured?.confidence ?? "확인 필요"}`,
    `  인원/조건: ${thresholdStructured?.summary ?? record.threshold ?? record.crowdThreshold}`,
    `  원문: ${record.sourceUrl}`,
    ...articleLines,
  ].join("\n");
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const records = findLocalOrdinances(input);
  const categories = MICE_DATA.localOrdinances.categories;
  const patterns = input.categoryId
    ? MICE_DATA.localOrdinances.articlePatterns.filter((pattern) => pattern.categoryId === input.categoryId)
    : MICE_DATA.localOrdinances.articlePatterns;

  const text = [
    "# MICE 지자체 조례 오프라인 조회",
    `입력: ${JSON.stringify(input)}`,
    "",
    "## 수집 범주",
    ...categories.map((category) => `- ${category.label} (${category.id}): ${category.matchedRecords}/${category.totalSearchHits}건`),
    "",
    "## 공통 조문 패턴",
    ...patterns.map((pattern) => `- ${pattern.categoryId}: ${pattern.commonArticleThemes.join(", ")} / MICE 매핑: ${pattern.miceDutyMapping.join(", ")}`),
    "",
    "## 매칭 조례",
    records.length > 0
      ? records.map((record) => formatRecord(record, input.includeArticles ?? false)).join("\n")
      : "- 매칭 없음. 더 넓은 jurisdiction 또는 categoryId 없이 재조회하세요.",
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      input,
      categories,
      articlePatterns: patterns,
      prioritySummary: records.slice(0, 10).map((record) => ({
        id: record.id,
        jurisdiction: record.jurisdiction,
        categoryId: record.categoryId,
        priorityScore: record.priorityScore,
        priorityBand: record.priorityBand,
        priorityReasons: record.priorityReasons,
      })),
      records,
      _meta: COMMON_RESPONSE_META,
    },
  };
}

export const queryMiceLocalOrdinancesTool: ToolDefinition = {
  name: "query_mice_local_ordinances",
  title: "MICE 지자체 조례 오프라인 조회",
  description:
    "지역축제/옥외행사 안전관리 조례, 도로점용, 옥외광고물 조례의 오프라인 인덱스와 우선 지자체 조문 발췌를 조회합니다. 네트워크 없이 로컬 JSON만 사용합니다.",
  inputSchema,
  handler,
};
