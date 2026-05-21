import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import { findLegalAnnexes } from "../lib/mice-data.js";

const inputSchema = z.object({
  lawEntryId: z.string().optional().describe("법령 ID. 예: performance_act_enforcement_decree"),
  dutyType: z.string().optional().describe("의무 유형. 예: staff_deployment, inspection, plan_submission"),
  appliesTo: z.string().optional().describe("적용 대상. 예: performance, food_truck, road_use"),
  dutyId: z.string().optional().describe("관련 문서/의무 ID. 예: performance_safety_org_and_training"),
  hazardId: z.string().optional().describe("관련 위험요인 ID. 예: fire_hazard_hot_work_lpg"),
  annexType: z.enum(["annex", "form"]).optional().describe("별표 또는 서식"),
});

function formatAnnex(annex: ReturnType<typeof findLegalAnnexes>[number]): string {
  return [
    `- ${annex.lawName} ${annex.annexNo} ${annex.title} (${annex.id})`,
    `  - 유형: ${annex.annexType} / bylSeq: ${annex.bylSeq}`,
    `  - 적용: ${annex.appliesTo.join(", ")}`,
    `  - 의무: ${annex.dutyTypes.join(", ")}`,
    `  - 요약: ${annex.summary}`,
    ...annex.checklistItems.slice(0, 8).map((item) => `  - 체크: ${item}`),
    `  - 출처: ${annex.sourceUrl}`,
  ].join("\n");
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const annexes = findLegalAnnexes(input);

  const text = [
    "# MICE 법령 별표·서식 온톨로지",
    `입력: ${JSON.stringify(input)}`,
    "",
    annexes.length > 0
      ? annexes.map(formatAnnex).join("\n")
      : "- 조건에 맞는 오프라인 별표·서식 없음. korean-law-mcp get_annexes로 추가 검증 필요",
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: { input, annexes, _meta: COMMON_RESPONSE_META },
  };
}

export const queryMiceLegalAnnexesTool: ToolDefinition = {
  name: "query_mice_legal_annexes",
  title: "MICE 법령 별표·서식 온톨로지 조회",
  description:
    "korean-law-mcp get_annexes로 확인해 로컬에 저장한 MICE 관련 별표·서식 요약과 체크리스트 항목을 조회합니다.",
  inputSchema,
  handler,
};
