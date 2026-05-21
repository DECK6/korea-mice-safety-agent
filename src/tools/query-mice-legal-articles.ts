import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import { findLegalArticles } from "../lib/mice-data.js";

const inputSchema = z.object({
  lawEntryId: z.string().optional().describe("법령 ID. 예: serious_accidents_punishment_act, fire_prevention_act"),
  dutyType: z.string().optional().describe("의무 유형. 예: risk_assessment, evacuation_route_management"),
  appliesTo: z.string().optional().describe("적용 대상. 예: all_mice, exhibition, performance, temporary_electricity"),
  hazardId: z.string().optional().describe("관련 위험요인 ID. 예: blocked_evacuation_route, crowd_density_high"),
});

function formatArticle(article: ReturnType<typeof findLegalArticles>[number]): string {
  return [
    `- ${article.lawName} ${article.article} ${article.title} (${article.id})`,
    `  - 적용: ${article.appliesTo.join(", ")}`,
    `  - 의무: ${article.dutyTypes.join(", ")}`,
    `  - 요약: ${article.text}`,
    `  - 출처: ${article.sourceUrl}`,
  ].join("\n");
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const articles = findLegalArticles(input);

  const text = [
    "# MICE 법령 조문 온톨로지",
    `입력: ${JSON.stringify(input)}`,
    "",
    articles.length > 0
      ? articles.map(formatArticle).join("\n")
      : "- 조건에 맞는 오프라인 조문 없음. plan_korean_law_mcp_queries 또는 korean-law-mcp로 추가 검증 필요",
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: { input, articles, _meta: COMMON_RESPONSE_META },
  };
}

export const queryMiceLegalArticlesTool: ToolDefinition = {
  name: "query_mice_legal_articles",
  title: "MICE 법령 조문 온톨로지 조회",
  description:
    "korean-law-mcp로 확인해 로컬에 저장한 MICE 관련 핵심 조문 요약, 의무 유형, 적용 대상, 위험요인 매핑을 조회합니다.",
  inputSchema,
  handler,
};
