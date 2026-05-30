import { getApiAccessStatus, type ApiAccessStatus } from "./api-access-status.js";
import type { EnvLike } from "./env.js";
import p0Pack from "../ontology/mice/p0-offline-evidence-pack.json" with { type: "json" };
import kopisVenueDirectory from "../ontology/mice/kopis-venue-directory.json" with { type: "json" };

export type P0CollectionStatus =
  | "collected"
  | "collected_partial"
  | "collector_ready"
  | "not_configured"
  | "pending_key"
  | "no_key_required";

export interface P0SourceReadiness {
  sourceId: string;
  label: string;
  envVar: string | null;
  keyStatus: ApiAccessStatus;
  collectionStatus: P0CollectionStatus;
  offlinePackPath: string;
  recordType: string;
  records: number;
  retrievedAt: string | null;
  currentAsOf: string | null;
  licensePolicy: string;
  verificationStatus: string;
  sourceConfidence: string;
  warnings: string[];
}

export interface P0ReadinessReport {
  generatedAt: string;
  offlineRuntimeOnly: true;
  sources: P0SourceReadiness[];
  summary: {
    collected: number;
    collectorReady: number;
    notConfigured: number;
    pending: number;
  };
}

type P0Pack = typeof p0Pack;
type P0PackSource = P0Pack["sources"][number];

function keyStatusForSource(source: P0PackSource, env?: EnvLike): ApiAccessStatus {
  if (!source.envVar) return "no_key_required";
  const report = getApiAccessStatus({ env, loadDotEnv: env ? false : undefined });
  return report.items.find((item) => item.envVar === source.envVar)?.status ?? "missing";
}

function effectiveRecordCount(source: P0PackSource): number {
  if (source.sourceId === "KCISA_KOPIS_PERFORMANCE_FACILITY") {
    return kopisVenueDirectory.venues.length;
  }
  return source.records;
}

export function getP0ReadinessReport(options: {
  env?: EnvLike;
  generatedAt?: string;
} = {}): P0ReadinessReport {
  const sources = p0Pack.sources.map((source) => {
    const keyStatus = keyStatusForSource(source, options.env);
    const collectionStatus: P0CollectionStatus =
      source.collectionStatus === "collected" || source.collectionStatus === "collected_partial"
        ? source.collectionStatus
        : keyStatus === "configured" || keyStatus === "externally_available" || keyStatus === "no_key_required"
          ? "collector_ready"
          : keyStatus === "pending"
            ? "pending_key"
            : "not_configured";
    const warnings: string[] = [];
    if (collectionStatus === "not_configured") warnings.push(`${source.envVar} 미설정: live refresh 없이 기존 offline pack 또는 fixture만 사용 가능`);
    if (collectionStatus === "pending_key") warnings.push(`${source.envVar} 발급 대기: pending_key fallback만 제공`);
    if (source.verificationStatus !== "source_verified") warnings.push("원천/API endpoint와 이용조건 재확인 필요");
    if (source.records === 0 && collectionStatus === "collector_ready") warnings.push("collector path는 준비됐지만 production offline records는 아직 미생성");

    return {
      sourceId: source.sourceId,
      label: source.label,
      envVar: source.envVar,
      keyStatus,
      collectionStatus,
      offlinePackPath: source.offlinePackPath,
      recordType: source.recordType,
      records: effectiveRecordCount(source),
      retrievedAt: source.retrievedAt,
      currentAsOf: source.currentAsOf,
      licensePolicy: source.licensePolicy,
      verificationStatus: source.verificationStatus,
      sourceConfidence: source.sourceConfidence,
      warnings,
    };
  });

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    offlineRuntimeOnly: true,
    sources,
    summary: {
      collected: sources.filter((source) => source.collectionStatus === "collected").length,
      collectorReady: sources.filter((source) => source.collectionStatus === "collector_ready").length,
      notConfigured: sources.filter((source) => source.collectionStatus === "not_configured").length,
      pending: sources.filter((source) => source.collectionStatus === "pending_key").length,
    },
  };
}

export interface NormalizedP0FixtureRecord {
  sourceId: string;
  recordType: string;
  title: string;
  jurisdiction?: string;
  appliesTo: string[];
  retrievedAt: string;
  currentAsOf: string;
  sourceConfidence: "fixture" | "low" | "medium" | "high";
  verificationStatus: "fixture" | "needs_source_review" | "source_verified";
  summary: string;
}

export function normalizeP0FixtureRecords(retrievedAt = new Date().toISOString()): NormalizedP0FixtureRecord[] {
  const currentAsOf = retrievedAt.slice(0, 10);
  return [
    {
      sourceId: "KOPIS_PERFORMANCE_CATALOG",
      recordType: "performance_or_festival_event",
      title: "fixture 공연 catalog",
      jurisdiction: "서울특별시",
      appliesTo: ["performance"],
      retrievedAt,
      currentAsOf,
      sourceConfidence: "fixture",
      verificationStatus: "fixture",
      summary: "KOPIS 공연 catalog collector의 정규화 테스트용 fixture다. 실제 운영 pack으로 사용하지 않는다.",
    },
    {
      sourceId: "TOUR_API_EVENT_CATALOG",
      recordType: "tourism_event",
      title: "fixture 지역축제 catalog",
      jurisdiction: "경기도 고양시",
      appliesTo: ["festival", "outdoor_event"],
      retrievedAt,
      currentAsOf,
      sourceConfidence: "fixture",
      verificationStatus: "fixture",
      summary: "TourAPI 행사/축제 collector의 정규화 테스트용 fixture다.",
    },
    {
      sourceId: "NEMC_EMERGENCY_MEDICAL",
      recordType: "emergency_medical_resource",
      title: "fixture 응급의료기관/AED resource",
      jurisdiction: "서울특별시 서초구",
      appliesTo: ["medical_response"],
      retrievedAt,
      currentAsOf,
      sourceConfidence: "fixture",
      verificationStatus: "fixture",
      summary: "응급의료기관/AED collector의 필드 정규화 테스트용 fixture다.",
    },
    {
      sourceId: "FOOD_SAFETY_KOREA",
      recordType: "food_safety_reference",
      title: "fixture 식품안전 reference",
      appliesTo: ["food_event"],
      retrievedAt,
      currentAsOf,
      sourceConfidence: "fixture",
      verificationStatus: "fixture",
      summary: "식품안전나라 F&B/HACCP/회수정보 collector의 정규화 테스트용 fixture다.",
    },
  ];
}
