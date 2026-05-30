import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import { queryLiveOperationsStatus } from "../lib/live-operations-adapters.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";

const inputSchema = z.object({
  venueId: z.string().optional(),
  jurisdiction: z.string().optional().describe("예: 서울특별시 서초구, 부산광역시 해운대구"),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  useFixtures: z.boolean().optional().default(false),
  live: z.boolean().optional().default(true),
  seoulAreaName: z.string().optional().describe("서울 실시간 도시데이터 장소명. 예: 강남역, 여의도한강공원"),
  airStationName: z.string().optional().describe("에어코리아 측정소명. 예: 종로구"),
  nx: z.number().int().optional().describe("기상청 동네예보 격자 X. 미입력 시 서울권 기본값"),
  ny: z.number().int().optional().describe("기상청 동네예보 격자 Y. 미입력 시 서울권 기본값"),
});

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const status = await queryLiveOperationsStatus(input);
  const text = [
    "# MICE live operations status",
    `- generatedAt: ${status.generatedAt}`,
    `- location: ${status.location.jurisdiction ?? status.location.venueId ?? "미입력"}`,
    "- 법령 근거가 아니라 운영 판단 보조 데이터입니다.",
    "",
    ...status.operationalEvidence.map((item) => `- ${item.sourceId}: ${item.status}, mode=${item.freshness.mode} / ${item.coverage.join(", ")}${item.warnings.length ? ` / ${item.warnings.join("; ")}` : ""}`),
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: { ...status, _meta: COMMON_RESPONSE_META },
  };
}

export const queryMiceLiveOperationsStatusTool: ToolDefinition = {
  name: "query_mice_live_operations_status",
  title: "MICE P2 live 운영 상태 조회",
  description:
    "기상청, 서울 실시간 도시데이터, 에어코리아, 재난문자, ITS adapter 상태를 operationalEvidence로 반환합니다. live=true이면 준비된 API를 실제 호출하고 missing/pending key는 실패하지 않고 fallback으로 반환합니다.",
  inputSchema,
  handler,
};
