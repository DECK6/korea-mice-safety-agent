import { z } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import { getP0ReadinessReport, normalizeP0FixtureRecords } from "../lib/p0-ready-sources.js";
import {
  fetchFoodSafetyRecalls,
  fetchKcisaPerformanceFacilitySample,
  fetchKopisPerformanceCatalog,
  fetchNemcAedsNear,
  fetchNemcEmergencyHospitals,
  fetchTourApiFestivalCatalog,
} from "../lib/mice-public-api-clients.js";
import type { McpToolResult, ToolDefinition } from "../lib/types.js";

const inputSchema = z.object({
  dryRun: z.boolean().optional().default(true).describe("true이면 파일을 쓰거나 live API를 호출하지 않고 수집 계획만 반환"),
  liveProbe: z.boolean().optional().default(false).describe("true이면 키가 설정된 P0 API를 소량 호출해 실제 응답과 정규화 결과를 검증"),
  includeFixtures: z.boolean().optional().default(false).describe("테스트/개발용 정규화 fixture records 포함"),
  startDate: z.string().optional().default("20260501"),
  endDate: z.string().optional().default("20260531"),
  limit: z.number().int().min(1).max(20).optional().default(3),
  latitude: z.number().optional().default(37.5118),
  longitude: z.number().optional().default(127.0588),
  sido: z.string().optional().default("서울특별시"),
  sigungu: z.string().optional().default("강남구"),
});

async function runLiveProbe(input: z.infer<typeof inputSchema>) {
  if (!input.liveProbe) return [];
  const [kcisa, kopis, tour, nemcHospitals, nemcAeds, foodSafety] = await Promise.all([
    fetchKcisaPerformanceFacilitySample({ limit: input.limit }),
    fetchKopisPerformanceCatalog({ startDate: input.startDate, endDate: input.endDate, limit: input.limit }),
    fetchTourApiFestivalCatalog({ startDate: input.startDate, endDate: input.endDate, limit: input.limit }),
    fetchNemcEmergencyHospitals({ sido: input.sido, sigungu: input.sigungu, limit: input.limit }),
    fetchNemcAedsNear({ latitude: input.latitude, longitude: input.longitude, limit: input.limit }),
    fetchFoodSafetyRecalls({ limit: input.limit }),
  ]);
  return [kcisa, kopis, tour, nemcHospitals, nemcAeds, foodSafety].map((probe) => ({
    sourceId: probe.sourceId,
    status: probe.status,
    ok: probe.ok,
    totalCount: probe.totalCount,
    records: probe.records.length,
    sampleTitles: probe.records.slice(0, 3).map((record) => record.title),
    warnings: probe.warnings,
  }));
}

async function handler(rawInput: unknown): Promise<McpToolResult> {
  const input = inputSchema.parse(rawInput ?? {});
  const readiness = getP0ReadinessReport();
  const fixtureRecords = input.includeFixtures ? normalizeP0FixtureRecords(readiness.generatedAt) : [];
  const liveProbeResults = await runLiveProbe(input);
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
    liveProbeResults.length ? "\n## live probe 결과" : "",
    ...liveProbeResults.map((probe) => `- ${probe.sourceId}: ${probe.status}, records=${probe.records}, total=${probe.totalCount ?? "unknown"}${probe.warnings.length ? ` (${probe.warnings.join("; ")})` : ""}`),
    fixtureRecords.length ? `\nfixture records: ${fixtureRecords.length}건` : "",
  ].filter(Boolean).join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      input,
      readiness,
      actions,
      liveProbeResults,
      fixtureRecords,
      writesFiles: false,
      liveNetworkCalls: input.liveProbe,
      _meta: COMMON_RESPONSE_META,
    },
  };
}

export const collectMiceP0ReadySourcesTool: ToolDefinition = {
  name: "collect_mice_p0_ready_sources",
  title: "MICE P0 ready source 수집 계획/fixture 정규화",
  description:
    "available-key-first P0 source의 offline pack 준비 상태와 collector action을 반환합니다. liveProbe=true이면 준비된 키로 소량 호출해 실제 정규화 결과를 검증하며 키 값은 출력하지 않습니다.",
  inputSchema,
  handler,
};
