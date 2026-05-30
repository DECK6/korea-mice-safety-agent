import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import { searchVenueDirectory, type VenueDirectory } from "../lib/kopis-venue-directory.js";
import venueDirectory from "../ontology/mice/kopis-venue-directory.json" with { type: "json" };

const directory = venueDirectory as VenueDirectory;

const inputSchema = z.object({
  query: z.string().optional().describe("공연시설명 부분일치 검색어 (예: 아트센터)"),
  region: z.string().optional().describe("시·도 또는 시·군·구 (예: 서울특별시, 경기도 수원시)"),
  category: z.string().optional().describe("시설 분류 (예: 공공(문예회관), 국립, 민간(대학로))"),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

function handler(rawInput: unknown): McpToolResult {
  const input = inputSchema.parse(rawInput ?? {});
  const matches = searchVenueDirectory(directory, input);

  const lines = matches.length > 0
    ? matches.map((venue, index) =>
        `${index + 1}. ${venue.name} — ${venue.jurisdiction || "관할 미상"} · ${venue.category || "분류 미상"}${venue.contact ? ` · ${venue.contact}` : ""}\n   ${venue.address}`)
    : ["조건에 맞는 공연시설이 없습니다."];

  const text = [
    `# 공연시설 검색 결과 (${matches.length}건)`,
    `> 원천: ${directory.provider} · 전국 ${directory.totalCount.toLocaleString("ko-KR")}곳 오프라인 인덱스`,
    "",
    ...lines,
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      query: input,
      totalIndexed: directory.totalCount,
      matchCount: matches.length,
      venues: matches,
      _meta: COMMON_RESPONSE_META,
    },
  };
}

export const queryPerformanceVenuesTool: ToolDefinition = {
  name: "query_performance_venues",
  title: "공연시설 인덱스 검색 (KOPIS 오프라인 온톨로지)",
  description:
    "문체부 문화데이터(KOPIS 공연시설별상세, 전국 약 2,111곳)를 오프라인 온톨로지로 구축한 인덱스에서 시설명·지역·분류로 공연시설을 검색합니다. 행사 입력 시 관할 지자체(jurisdiction)·주소 보강에 사용합니다.",
  inputSchema,
  handler,
};
