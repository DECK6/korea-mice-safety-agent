import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import { getApiAccessStatus } from "../lib/api-access-status.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";

const inputSchema = z.object({
  phase: z.enum(["P0", "P1", "P2", "support"]).optional(),
  requiredOnly: z.boolean().optional().default(false),
});

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    configured: "configured",
    missing: "missing",
    pending: "pending_key",
    externally_available: "externally_available",
    no_key_required: "no_key_required",
  };
  return labels[status] ?? status;
}

function handler(rawInput: unknown): McpToolResult {
  const input = inputSchema.parse(rawInput ?? {});
  const report = getApiAccessStatus();
  const items = report.items.filter((item) => {
    if (input.phase && item.phase !== input.phase) return false;
    if (input.requiredOnly && !item.requiredForHappyPath) return false;
    return true;
  });

  const text = [
    "# MICE API 접근 상태",
    "- 실제 키 값은 출력하지 않습니다.",
    `- summary: ${Object.entries(report.summary).map(([key, value]) => `${key}=${value}`).join(", ")}`,
    "",
    ...items.map((item) => `- ${item.id} (${item.envVar ?? "no key"}): ${statusLabel(item.status)} / ${item.offlineMode} / ${item.notes}`),
  ].join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: { input, summary: report.summary, items, policy: report.policy, _meta: COMMON_RESPONSE_META },
  };
}

export const queryMiceApiAccessStatusTool: ToolDefinition = {
  name: "query_mice_api_access_status",
  title: "MICE P0/P1/P2 API 접근 상태 조회",
  description:
    "P0/P1/P2 개발에 필요한 API 키의 configured/missing/pending/externally_available/no_key_required 상태를 키 값 없이 조회합니다.",
  inputSchema,
  handler,
};
