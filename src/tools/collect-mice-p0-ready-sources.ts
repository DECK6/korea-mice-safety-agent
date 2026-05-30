import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import { getP0ReadinessReport, normalizeP0FixtureRecords } from "../lib/p0-ready-sources.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";

const inputSchema = z.object({
  dryRun: z.boolean().optional().default(true).describe("true이면 파일을 쓰거나 live API를 호출하지 않고 수집 계획만 반환"),
  includeFixtures: z.boolean().optional().default(false).describe("테스트/개발용 정규화 fixture records 포함"),
});

function handler(rawInput: unknown): McpToolResult {
  const input = inputSchema.parse(rawInput ?? {});
  const readiness = getP0ReadinessReport();
  const fixtureRecords = input.includeFixtures ? normalizeP0FixtureRecords(readiness.generatedAt) : [];
  const actions = readiness.sources.map((source) => ({
    sourceId: source.sourceId,
    action: source.collectionStatus === "collected" || source.collectionStatus === "collected_partial"
      ? "use_existing_offline_pack"
      : source.collectionStatus === "collector_ready"
        ? input.dryRun ? "collector_ready_dry_run" : "collector_ready_live_refresh_requires_endpoint_confirmation"
        : source.collectionStatus,
    offlinePackPath: source.offlinePackPath,
    warnings: source.warnings,
  }));

  const text = [
    "# P0 ready source 수집 계획",
    `- dryRun: ${input.dryRun}`,
    `- offline runtime only: ${readiness.offlineRuntimeOnly}`,
    "",
    ...actions.map((action) => `- ${action.sourceId}: ${action.action} -> ${action.offlinePackPath}${action.warnings.length ? ` (${action.warnings.join("; ")})` : ""}`),
    fixtureRecords.length ? `\nfixture records: ${fixtureRecords.length}건` : "",
  ].filter(Boolean).join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      input,
      readiness,
      actions,
      fixtureRecords,
      writesFiles: false,
      liveNetworkCalls: false,
      _meta: COMMON_RESPONSE_META,
    },
  };
}

export const collectMiceP0ReadySourcesTool: ToolDefinition = {
  name: "collect_mice_p0_ready_sources",
  title: "MICE P0 ready source 수집 계획/fixture 정규화",
  description:
    "available-key-first P0 source의 offline pack 준비 상태와 collector action을 반환합니다. 기본값은 dry-run이며 live API를 호출하거나 키 값을 출력하지 않습니다.",
  inputSchema,
  handler,
};
