import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import { MICE_DATA, normalizeEventTypeForLookup } from "../lib/mice-data.js";

const inputSchema = z.object({
  eventType: z.string().optional(),
  riskLevel: z.enum(["high", "medium", "low"]).optional(),
  trigger: z.string().optional().describe("트리거 태그. 예: temporaryStructures, foodService, expectedCrowd>=1000"),
});

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const normalizedEventType = input.eventType ? normalizeEventTypeForLookup(input.eventType) : undefined;
  const hazards = MICE_DATA.hazards
    .filter((hazard) => !normalizedEventType || hazard.eventTypes.some((type) => normalizeEventTypeForLookup(type) === normalizedEventType))
    .filter((hazard) => !input.riskLevel || hazard.riskLevel === input.riskLevel)
    .filter((hazard) => !input.trigger || hazard.triggers.includes(input.trigger));

  const text = [
    "# MICE 위험요인·통제대책",
    ...hazards.map((hazard) => [
      `## ${hazard.label} (${hazard.id})`,
      `- 위험도: ${hazard.riskLevel}`,
      `- 트리거: ${hazard.triggers.join(", ")}`,
      "- 통제대책:",
      ...hazard.controls.map((control) => `  - ${control}`),
      `- 법령: ${hazard.lawRefs.join(", ")}`,
      `- 출처: ${hazard.sourceRefs.join(", ")}`,
    ].join("\n")),
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: { input, hazards, _meta: COMMON_RESPONSE_META },
  };
}

export const queryMiceHazardControlsTool: ToolDefinition = {
  name: "query_mice_hazard_controls",
  title: "MICE 위험요인·통제대책 조회",
  description: "군중 밀집, 병목, 피난통로, 임시구조물, 임시전기, 화기/LPG, 식중독, 응급, 개인정보 등 위험요인과 통제대책을 조회합니다.",
  inputSchema,
  handler,
};

