import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import { MICE_DATA, verificationRank } from "../lib/mice-data.js";

const inputSchema = z.object({
  appliesTo: z.string().optional().describe("appliesTo 태그 필터. 예: large_crowd, food_booth, performance"),
  onlyNeedsReview: z.boolean().optional().describe("검토 필요 법령만 반환"),
});

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const laws = MICE_DATA.laws
    .filter((law) => !input.appliesTo || law.appliesTo.includes(input.appliesTo))
    .filter((law) => !input.onlyNeedsReview || law.verificationStatus !== "verified")
    .sort((a, b) => verificationRank(a.verificationStatus) - verificationRank(b.verificationStatus) || a.id.localeCompare(b.id));

  const text = [
    "# MICE 법령 레지스트리",
    `필터: ${JSON.stringify(input)}`,
    "",
    ...laws.map((law) => [
      `## ${law.name} (${law.id})`,
      `- 상태: ${law.verificationStatus}`,
      `- 법령ID/MST: ${law.lawId ?? law.ruleId ?? "-"} / ${law.mst ?? law.serialNo ?? "-"}`,
      `- MICE 용도: ${law.miceUse}`,
      law.articles.length > 0
        ? `- 핵심 조문: ${law.articles.map((article) => `${article.article} ${article.title}`).join(", ")}`
        : "- 핵심 조문: 추가 조사 필요",
      `- 원문: ${law.sourceUrl}`,
    ].join("\n")),
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: { input, laws, _meta: COMMON_RESPONSE_META },
  };
}

export const listMiceLawsTool: ToolDefinition = {
  name: "list_mice_laws",
  title: "MICE 법령 레지스트리 조회",
  description: "MICE 도메인팩의 법령, MST/법령ID, 적용 태그, 핵심 조문 검증 상태를 조회합니다.",
  inputSchema,
  handler,
};

