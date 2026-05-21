import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";
import { MICE_DATA } from "../lib/mice-data.js";

const inputSchema = z.object({
  onlyNeedsReview: z.boolean().optional().default(true),
  includeVerified: z.boolean().optional().default(false),
});

function commandsForLaw(law: (typeof MICE_DATA.laws)[number]): string[] {
  const base = "/Volumes/data/Dev/korean-law-mcp/build/cli.js";
  const commands = [`LAW_OC=\"$LAW_OC\" node ${base} search_law --query "${law.name}" --display 5`];
  if (law.mst) {
    if (law.articles.length > 0) {
      for (const article of law.articles) {
        commands.push(`LAW_OC=\"$LAW_OC\" node ${base} get_law_text --mst ${law.mst} --jo "${article.article}"`);
      }
    } else {
      commands.push(`LAW_OC=\"$LAW_OC\" node ${base} get_law_text --mst ${law.mst}`);
    }
  }
  return commands;
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const laws = MICE_DATA.laws.filter((law) => {
    if (input.includeVerified) return true;
    if (input.onlyNeedsReview) return law.verificationStatus !== "verified";
    return true;
  });
  const plan = laws.map((law) => ({
    id: law.id,
    name: law.name,
    verificationStatus: law.verificationStatus,
    commands: commandsForLaw(law),
  }));

  const text = [
    "# korean-law-mcp 조사 명령 계획",
    "키는 레포에 저장하지 말고 실행 환경에만 넣으세요. 예: `export LAW_OC=...`",
    "",
    ...plan.flatMap((item) => [
      `## ${item.name} (${item.id}, ${item.verificationStatus})`,
      ...item.commands.map((cmd) => `- ${cmd}`),
    ]),
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: { input, plan, _meta: COMMON_RESPONSE_META },
  };
}

export const planKoreanLawMcpQueriesTool: ToolDefinition = {
  name: "plan_korean_law_mcp_queries",
  title: "korean-law-mcp 법령 조사 명령 생성",
  description: "MICE 법령 레지스트리 중 추가 검토가 필요한 항목에 대해 korean-law-mcp CLI 명령 계획을 생성합니다. LAW_OC 값은 출력하지 않습니다.",
  inputSchema,
  handler,
};

