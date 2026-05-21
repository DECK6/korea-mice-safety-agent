import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import { MICE_DATA, strictnessLabel, strictnessRank } from "../lib/mice-data.js";

const inputSchema = z.object({
  eventType: z.string().optional().describe("행사 유형 필터. 예: festival, exhibition, performance"),
  strictness: z.string().optional().describe("strictness 필터. 예: statutory_required, venue_required"),
});

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const duties = MICE_DATA.duties
    .filter((duty) => !input.eventType || duty.eventTypes.includes(input.eventType))
    .filter((duty) => !input.strictness || duty.strictness === input.strictness)
    .sort((a, b) => strictnessRank(a.strictness) - strictnessRank(b.strictness) || a.id.localeCompare(b.id));

  const text = [
    "# MICE 의무/문서 마스터",
    ...duties.map((duty) => [
      `- ${duty.title} (${duty.id})`,
      `  - 수준: ${strictnessLabel(duty.strictness)} / 주기: ${duty.cycle}`,
      `  - 조건: ${duty.requiredWhen}`,
      `  - 법령: ${duty.lawRefs.join(", ")}`,
    ].join("\n")),
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: { input, duties, _meta: COMMON_RESPONSE_META },
  };
}

export const listMiceDutiesTool: ToolDefinition = {
  name: "list_mice_duties",
  title: "MICE 의무/문서 마스터 조회",
  description: "행사 유형별 안전관리계획, 인파관리, 공연 재해대처계획, 베뉴 작업허가 등 문서 의무를 조회합니다.",
  inputSchema,
  handler,
};

