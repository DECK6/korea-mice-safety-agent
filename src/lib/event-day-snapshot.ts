import { statusForEnvVar } from "./api-access-status.js";
import type { EnvLike } from "./env.js";
import {
  fetchAirKoreaStation,
  fetchSeoulCityData,
  type LiveApiResult,
  type NormalizedExternalRecord,
} from "./mice-public-api-clients.js";
import {
  addMinutes,
  isExpired,
  isSeoulJurisdiction,
  sourceStatusFromApiAccess,
  type OperationalEvidenceLocation,
  type OperationalObservation,
  type OperationalObservationLevel,
  type OperationalSourceStatus,
} from "./operational-evidence-model.js";

export type SnapshotSourceStatus = OperationalSourceStatus;

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
  observations: OperationalObservation[];
  records?: NormalizedExternalRecord[];
}

export interface EventDaySnapshot {
  generatedAt: string;
  capturedAt: string;
  expiresAt: string;
  isStale: boolean;
  location: OperationalEvidenceLocation;
  sources: SnapshotSourceResult[];
  warnings: string[];
}

export function isSnapshotStale(expiresAt: string, now = new Date()): boolean {
  return isExpired(expiresAt, now);
}

function levelFromSeoulCongestion(level?: unknown): OperationalObservationLevel {
  const value = String(level ?? "");
  if (/붐빔/.test(value)) return "critical";
  if (/약간/.test(value)) return "watch";
  return "info";
}

function levelFromAirGrade(grade?: unknown): OperationalObservationLevel {
  const value = Number(grade);
  if (value >= 4) return "critical";
  if (value >= 3) return "warning";
  if (value >= 2) return "watch";
  return "info";
}

function sourceFromProbe(args: {
  sourceId: string;
  label: string;
  envVar: string;
  status: SnapshotSourceStatus;
  capturedAt: string;
  expiresAt: string;
  stale: boolean;
  query: Record<string, unknown>;
  probe?: LiveApiResult<NormalizedExternalRecord>;
  warnings?: string[];
  observations?: SnapshotSourceResult["observations"];
}): SnapshotSourceResult {
  const status = args.probe
    ? args.probe.status === "live_verified" ? args.status : "live_error"
    : args.status;
  return {
    sourceId: args.sourceId,
    label: args.label,
    envVar: args.envVar,
    status,
    capturedAt: args.capturedAt,
    expiresAt: args.expiresAt,
    isStale: args.stale,
    query: args.query,
    warnings: [...(args.warnings ?? []), ...(args.probe?.warnings ?? [])],
    observations: args.observations ?? [],
    records: args.probe?.records,
  };
}

export async function generateEventDaySnapshot(input: {
  venueId?: string;
  jurisdiction?: string;
  latitude?: number;
  longitude?: number;
  capturedAt?: string;
  ttlMinutes?: number;
  env?: EnvLike;
  useFixtures?: boolean;
  live?: boolean;
  seoulAreaName?: string;
  airStationName?: string;
} = {}): Promise<EventDaySnapshot> {
  const captured = input.capturedAt ? new Date(input.capturedAt) : new Date();
  const ttlMinutes = input.ttlMinutes ?? 30;
  const capturedAt = captured.toISOString();
  const expiresAt = addMinutes(captured, ttlMinutes).toISOString();
  const stale = isSnapshotStale(expiresAt);
  const env = input.env;
  const live = input.live ?? !input.useFixtures;
  const query = {
    venueId: input.venueId,
    jurisdiction: input.jurisdiction,
    latitude: input.latitude,
    longitude: input.longitude,
    seoulAreaName: input.seoulAreaName,
    airStationName: input.airStationName,
  };

  const seoulStatus = isSeoulJurisdiction(input.jurisdiction)
    ? sourceStatusFromApiAccess(statusForEnvVar("SEOUL_OPENAPI_KEY", env))
    : "unsupported_region";
  const airStatus = sourceStatusFromApiAccess(statusForEnvVar("AIRKOREA_SERVICE_KEY", env));
  const itsStatus = sourceStatusFromApiAccess(statusForEnvVar("ITS_OPENAPI_KEY", env));
  const safetyStatus = sourceStatusFromApiAccess(statusForEnvVar("SAFETY_DATA_API_KEY", env));
  const [seoulProbe, airProbe] = await Promise.all([
    live && seoulStatus === "configured"
      ? fetchSeoulCityData({ areaName: input.seoulAreaName, env: env as NodeJS.ProcessEnv | undefined })
      : Promise.resolve(undefined),
    live && airStatus === "configured"
      ? fetchAirKoreaStation({ stationName: input.airStationName, env: env as NodeJS.ProcessEnv | undefined })
      : Promise.resolve(undefined),
  ]);

  const seoulRecord = seoulProbe?.records[0];
  const airRecord = airProbe?.records[0];

  const sources: SnapshotSourceResult[] = [
    sourceFromProbe({
      sourceId: "SEOUL_REALTIME_CITY_DATA",
      label: "서울 실시간 도시/인구 데이터",
      envVar: "SEOUL_OPENAPI_KEY",
      status: seoulStatus,
      capturedAt,
      expiresAt,
      query,
      stale,
      warnings: seoulStatus === "unsupported_region"
        ? ["서울 지역이 아니므로 서울 실시간 도시데이터를 일반 적용하지 않는다."]
        : seoulStatus === "not_configured"
          ? ["SEOUL_OPENAPI_KEY 미설정: snapshot 수집 없이 fallback만 반환한다."]
          : [],
      probe: seoulProbe,
      observations: seoulProbe?.ok && seoulRecord
        ? [{
          kind: "crowd",
          level: levelFromSeoulCongestion(seoulRecord.fields.congestionLevel),
          summary: `${seoulRecord.title} 혼잡도: ${seoulRecord.fields.congestionLevel ?? "확인 필요"} (${seoulRecord.fields.minPopulation ?? "?"}-${seoulRecord.fields.maxPopulation ?? "?"}명)`,
          advisoryOnly: true,
        }]
        : input.useFixtures && seoulStatus === "configured"
        ? [{ kind: "crowd", level: "info", summary: "fixture 서울 혼잡도 정상", advisoryOnly: true }]
        : [],
    }),
    sourceFromProbe({
      sourceId: "AIRKOREA_AIR_QUALITY",
      label: "에어코리아 대기질",
      envVar: "AIRKOREA_SERVICE_KEY",
      status: airStatus,
      capturedAt,
      expiresAt,
      query,
      stale,
      warnings: airStatus === "not_configured" ? ["AIRKOREA_SERVICE_KEY 미설정: 대기질 snapshot 미수집"] : [],
      probe: airProbe,
      observations: airProbe?.ok && airRecord
        ? [{
          kind: "air_quality",
          level: levelFromAirGrade(airRecord.fields.khaiGrade),
          summary: `${input.airStationName ?? "측정소"} 통합대기환경지수 등급 ${airRecord.fields.khaiGrade ?? "확인 필요"}, PM10 ${airRecord.fields.pm10Value ?? "?"}, PM2.5 ${airRecord.fields.pm25Value ?? "?"}`,
          advisoryOnly: true,
        }]
        : input.useFixtures && airStatus === "configured"
        ? [{ kind: "air_quality", level: "info", summary: "fixture 대기질 보통", advisoryOnly: true }]
        : [],
    }),
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
