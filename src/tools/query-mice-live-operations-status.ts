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
});

function handler(rawInput: unknown): McpToolResult {
  const input = inputSchema.parse(rawInput ?? {});
  const status = queryLiveOperationsStatus(input);
  const text = [
    "# MICE live operations status",
    `- generatedAt: ${status.generatedAt}`,
    `- location: ${status.location.jurisdiction ?? status.location.venueId ?? "미입력"}`,
    "- 법령 근거가 아니라 운영 판단 보조 데이터입니다.",
    "",
    ...status.operationalEvidence.map((item) => `- ${item.sourceId}: ${item.status} / ${item.coverage.join(", ")}${item.warnings.length ? ` / ${item.warnings.join("; ")}` : ""}`),
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
    "기상청, 서울 실시간 도시데이터, 에어코리아, 재난문자, ITS adapter 상태를 operationalEvidence로 반환합니다. missing/pending key는 실패하지 않고 fallback으로 반환합니다.",
  inputSchema,
  handler,
};
