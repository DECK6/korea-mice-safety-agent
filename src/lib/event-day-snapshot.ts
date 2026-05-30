import { statusForEnvVar, type ApiAccessStatus } from "./api-access-status.js";
import type { EnvLike } from "./env.js";

export type SnapshotSourceStatus =
  | "configured"
  | "not_configured"
  | "pending_key"
  | "unsupported_region"
  | "unavailable"
  | "live_call_skipped";

export interface SnapshotSourceResult {
  sourceId: string;
  label: string;
  envVar?: string;
  status: SnapshotSourceStatus;
  capturedAt: string;
  expiresAt: string;
  isStale: boolean;
  query: Record<string, unknown>;
  warnings: string[];
  observations: Array<{
    kind: string;
    level: "info" | "watch" | "warning" | "critical";
    summary: string;
    advisoryOnly: true;
  }>;
}

export interface EventDaySnapshot {
  generatedAt: string;
  capturedAt: string;
  expiresAt: string;
  isStale: boolean;
  location: {
    venueId?: string;
    jurisdiction?: string;
    latitude?: number;
    longitude?: number;
  };
  sources: SnapshotSourceResult[];
  warnings: string[];
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function isSnapshotStale(expiresAt: string, now = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}

function isSeoul(jurisdiction?: string): boolean {
  return Boolean(jurisdiction && /서울/.test(jurisdiction));
}

function sourceStatusFromAccess(status: ApiAccessStatus): SnapshotSourceStatus {
  if (status === "configured") return "configured";
  if (status === "pending") return "pending_key";
  return "not_configured";
}

export function generateEventDaySnapshot(input: {
  venueId?: string;
  jurisdiction?: string;
  latitude?: number;
  longitude?: number;
  capturedAt?: string;
  ttlMinutes?: number;
  env?: EnvLike;
  useFixtures?: boolean;
} = {}): EventDaySnapshot {
  const captured = input.capturedAt ? new Date(input.capturedAt) : new Date();
  const ttlMinutes = input.ttlMinutes ?? 30;
  const capturedAt = captured.toISOString();
  const expiresAt = addMinutes(captured, ttlMinutes).toISOString();
  const stale = isSnapshotStale(expiresAt);
  const env = input.env;
  const query = {
    venueId: input.venueId,
    jurisdiction: input.jurisdiction,
    latitude: input.latitude,
    longitude: input.longitude,
  };

  const seoulStatus = isSeoul(input.jurisdiction)
    ? sourceStatusFromAccess(statusForEnvVar("SEOUL_OPENAPI_KEY", env))
    : "unsupported_region";
  const airStatus = sourceStatusFromAccess(statusForEnvVar("AIRKOREA_SERVICE_KEY", env));
  const itsStatus = sourceStatusFromAccess(statusForEnvVar("ITS_OPENAPI_KEY", env));
  const safetyStatus = sourceStatusFromAccess(statusForEnvVar("SAFETY_DATA_API_KEY", env));

  const sources: SnapshotSourceResult[] = [
    {
      sourceId: "SEOUL_REALTIME_CITY_DATA",
      label: "서울 실시간 도시/인구 데이터",
      envVar: "SEOUL_OPENAPI_KEY",
      status: seoulStatus,
      capturedAt,
      expiresAt,
      isStale: stale,
      query,
      warnings: seoulStatus === "unsupported_region"
        ? ["서울 지역이 아니므로 서울 실시간 도시데이터를 일반 적용하지 않는다."]
        : seoulStatus === "not_configured"
          ? ["SEOUL_OPENAPI_KEY 미설정: snapshot 수집 없이 fallback만 반환한다."]
          : [],
      observations: input.useFixtures && seoulStatus === "configured"
        ? [{ kind: "crowd", level: "info", summary: "fixture 서울 혼잡도 정상", advisoryOnly: true }]
        : [],
    },
    {
      sourceId: "AIRKOREA_AIR_QUALITY",
      label: "에어코리아 대기질",
      envVar: "AIRKOREA_SERVICE_KEY",
      status: airStatus,
      capturedAt,
      expiresAt,
      isStale: stale,
      query,
      warnings: airStatus === "not_configured" ? ["AIRKOREA_SERVICE_KEY 미설정: 대기질 snapshot 미수집"] : [],
      observations: input.useFixtures && airStatus === "configured"
        ? [{ kind: "air_quality", level: "info", summary: "fixture 대기질 보통", advisoryOnly: true }]
        : [],
    },
    {
      sourceId: "ITS_TRAFFIC_OPENAPI",
      label: "국가교통정보센터 ITS",
      envVar: "ITS_OPENAPI_KEY",
      status: itsStatus,
      capturedAt,
      expiresAt,
      isStale: stale,
      query,
      warnings: itsStatus === "pending_key"
        ? ["ITS_OPENAPI_KEY 발급 대기: 교통소통/돌발/CCTV/VMS는 pending_key fallback"]
        : itsStatus === "not_configured"
          ? ["ITS_OPENAPI_KEY 미설정"]
          : [],
      observations: [],
    },
    {
      sourceId: "SAFETY_DATA_DISASTER_MESSAGE",
      label: "재난안전데이터 긴급재난문자",
      envVar: "SAFETY_DATA_API_KEY",
      status: safetyStatus,
      capturedAt,
      expiresAt,
      isStale: stale,
      query,
      warnings: safetyStatus === "pending_key"
        ? ["SAFETY_DATA_API_KEY 발급 대기: 긴급재난문자는 pending_key fallback"]
        : safetyStatus === "not_configured"
          ? ["SAFETY_DATA_API_KEY 미설정"]
          : [],
      observations: [],
    },
    {
      sourceId: "ESHARE_PUBLIC_FACILITY",
      label: "공유누리/공공시설 자원",
      envVar: "ESHARE_SERVICE_KEY",
      status: "unavailable",
      capturedAt,
      expiresAt,
      isStale: stale,
      query,
      warnings: ["후순위 source: P0/P1/P2 happy path에서 사용하지 않는다."],
      observations: [],
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    capturedAt,
    expiresAt,
    isStale: stale,
    location: {
      venueId: input.venueId,
      jurisdiction: input.jurisdiction,
      latitude: input.latitude,
      longitude: input.longitude,
    },
    sources,
    warnings: sources.flatMap((source) => source.warnings),
  };
}
