import { statusForEnvVar } from "./api-access-status.js";
import type { EnvLike } from "./env.js";
import {
  fetchAirKoreaStation,
  fetchKmaUltraShort,
  fetchSeoulCityData,
  type LiveApiResult,
  type NormalizedExternalRecord,
} from "./mice-public-api-clients.js";
import {
  isSeoulJurisdiction,
  sourceStatusFromApiAccess,
  type OperationalEvidenceFreshness,
  type OperationalEvidenceLocation,
  type OperationalFreshnessMode,
  type OperationalSourceStatus,
} from "./operational-evidence-model.js";

export type LiveAdapterStatus = OperationalSourceStatus;

export interface OperationalEvidence {
  sourceId: string;
  label: string;
  status: LiveAdapterStatus;
  capturedAt: string;
  freshness: OperationalEvidenceFreshness;
  coverage: string[];
  warnings: string[];
  recommendations: string[];
  data: Record<string, unknown> | null;
}

export interface LiveOperationsStatus {
  generatedAt: string;
  location: OperationalEvidenceLocation;
  operationalEvidence: OperationalEvidence[];
  warnings: string[];
  legalBasis?: never;
}

function evidence(args: {
  sourceId: string;
  label: string;
  status: LiveAdapterStatus;
  capturedAt: string;
  ttlMinutes?: number;
  coverage: string[];
  warnings?: string[];
  recommendations?: string[];
  data?: Record<string, unknown> | null;
  freshnessMode?: OperationalFreshnessMode;
}): OperationalEvidence {
  const collected = args.status === "configured" && args.data;
  const freshnessMode = args.freshnessMode ?? (collected ? "live" : args.status === "configured" ? "not_collected" : "fallback");
  return {
    sourceId: args.sourceId,
    label: args.label,
    status: args.status,
    capturedAt: args.capturedAt,
    freshness: {
      mode: freshnessMode,
      ttlMinutes: args.ttlMinutes ?? 10,
      isStale: freshnessMode !== "live",
    },
    coverage: args.coverage,
    warnings: args.warnings ?? [],
    recommendations: args.recommendations ?? [],
    data: args.data ?? null,
  };
}

function riskFromKma(record?: NormalizedExternalRecord): { state: string; summary: string } {
  const fields = record?.fields ?? {};
  const wind = Number(fields.windSpeedMs);
  const rain = Number(fields.precipitationMm);
  const pty = String(fields.precipitationType ?? "0");
  const risks: string[] = [];
  if (Number.isFinite(wind) && wind >= 8) risks.push(`풍속 ${wind}m/s`);
  if (Number.isFinite(rain) && rain > 0) risks.push(`강수 ${rain}mm`);
  if (pty !== "0") risks.push(`강수형태 ${pty}`);
  return {
    state: risks.length ? "watch" : "normal",
    summary: risks.length ? risks.join(", ") : "초단기실황 기준 즉시 중지 수준 기상 신호 없음",
  };
}

function riskFromSeoul(record?: NormalizedExternalRecord): { state: string; summary: string } {
  const level = String(record?.fields.congestionLevel ?? "");
  if (/붐빔/.test(level)) return { state: "critical", summary: `서울 실시간 혼잡도 ${level}` };
  if (/약간/.test(level)) return { state: "watch", summary: `서울 실시간 혼잡도 ${level}` };
  return { state: "normal", summary: `서울 실시간 혼잡도 ${level || "확인 필요"}` };
}

function riskFromAir(record?: NormalizedExternalRecord): { state: string; summary: string } {
  const grade = Number(record?.fields.khaiGrade);
  if (grade >= 4) return { state: "critical", summary: `통합대기환경지수 등급 ${grade}` };
  if (grade >= 3) return { state: "warning", summary: `통합대기환경지수 등급 ${grade}` };
  if (grade >= 2) return { state: "watch", summary: `통합대기환경지수 등급 ${grade}` };
  return { state: "normal", summary: `통합대기환경지수 등급 ${Number.isFinite(grade) ? grade : "확인 필요"}` };
}

function warningsFromProbe(probe?: LiveApiResult<NormalizedExternalRecord>): string[] {
  return probe?.warnings ?? [];
}

export async function queryLiveOperationsStatus(input: {
  venueId?: string;
  jurisdiction?: string;
  latitude?: number;
  longitude?: number;
  env?: EnvLike;
  useFixtures?: boolean;
  live?: boolean;
  seoulAreaName?: string;
  airStationName?: string;
  nx?: number;
  ny?: number;
} = {}): Promise<LiveOperationsStatus> {
  const capturedAt = new Date().toISOString();
  const env = input.env;
  const live = input.live ?? !input.useFixtures;
  const usingFixtureFallback = input.useFixtures && !live;
  const weatherStatus = sourceStatusFromApiAccess(statusForEnvVar("KMA_APIHUB_KEY", env));
  const crowdStatus = isSeoulJurisdiction(input.jurisdiction)
    ? sourceStatusFromApiAccess(statusForEnvVar("SEOUL_OPENAPI_KEY", env))
    : "unsupported_region";
  const airStatus = sourceStatusFromApiAccess(statusForEnvVar("AIRKOREA_SERVICE_KEY", env));
  const safetyStatus = sourceStatusFromApiAccess(statusForEnvVar("SAFETY_DATA_API_KEY", env));
  const itsStatus = sourceStatusFromApiAccess(statusForEnvVar("ITS_OPENAPI_KEY", env));
  const [weatherProbe, crowdProbe, airProbe] = await Promise.all([
    live && weatherStatus === "configured"
      ? fetchKmaUltraShort({ nx: input.nx, ny: input.ny, env: env as NodeJS.ProcessEnv | undefined })
      : Promise.resolve(undefined),
    live && crowdStatus === "configured"
      ? fetchSeoulCityData({ areaName: input.seoulAreaName, env: env as NodeJS.ProcessEnv | undefined })
      : Promise.resolve(undefined),
    live && airStatus === "configured"
      ? fetchAirKoreaStation({ stationName: input.airStationName, env: env as NodeJS.ProcessEnv | undefined })
      : Promise.resolve(undefined),
  ]);
  const weatherRecord = weatherProbe?.records[0];
  const crowdRecord = crowdProbe?.records[0];
  const airRecord = airProbe?.records[0];
  const weatherRisk = riskFromKma(weatherRecord);
  const crowdRisk = riskFromSeoul(crowdRecord);
  const airRisk = riskFromAir(airRecord);

  const operationalEvidence: OperationalEvidence[] = [
    evidence({
      sourceId: "KMA_APIHUB_WEATHER",
      label: "기상청 API Hub live weather risk",
      status: weatherProbe?.status === "live_error" ? "live_error" : weatherStatus,
      capturedAt,
      ttlMinutes: 10,
      coverage: ["short_forecast", "ultra_short_forecast", "mid_forecast", "weather_warning", "impact_forecast", "aws", "radar", "lightning", "lifestyle_health_indices"],
      warnings: weatherStatus === "not_configured"
        ? ["KMA_APIHUB_KEY 미설정: 기상 live adapter는 fallback만 반환"]
        : warningsFromProbe(weatherProbe),
      recommendations: ["야외 무대·트러스·현수막·임시전기 조건에서는 강풍/호우/낙뢰 특보를 행사중지 기준과 연결한다."],
      freshnessMode: usingFixtureFallback ? "fallback" : undefined,
      data: weatherProbe?.ok
        ? { riskState: weatherRisk.state, summary: weatherRisk.summary, record: weatherRecord }
        : usingFixtureFallback && weatherStatus === "configured"
        ? { riskState: "normal", summary: "fixture weather normal" }
        : null,
    }),
    evidence({
      sourceId: "SEOUL_REALTIME_CITY_DATA",
      label: "서울 실시간 도시/인구 live crowd signal",
      status: crowdProbe?.status === "live_error" ? "live_error" : crowdStatus,
      capturedAt,
      ttlMinutes: 5,
      coverage: ["seoul_hotspot_population", "crowd_level", "city_signal"],
      warnings: crowdStatus === "unsupported_region"
        ? ["서울 지역이 아니므로 서울 실시간 도시데이터를 일반 적용하지 않는다."]
        : crowdStatus === "not_configured"
          ? ["SEOUL_OPENAPI_KEY 미설정: 서울 live crowd adapter는 fallback만 반환"]
          : warningsFromProbe(crowdProbe),
      recommendations: ["혼잡도 급상승 시 입장 제한, 우회동선, 안내방송, 스태프 추가 투입 기준과 연결한다."],
      freshnessMode: usingFixtureFallback ? "fallback" : undefined,
      data: crowdProbe?.ok
        ? { riskState: crowdRisk.state, summary: crowdRisk.summary, record: crowdRecord }
        : usingFixtureFallback && crowdStatus === "configured"
        ? { riskState: "watch", summary: "fixture Seoul crowd watch" }
        : null,
    }),
    evidence({
      sourceId: "AIRKOREA_AIR_QUALITY",
      label: "에어코리아 live air quality",
      status: airProbe?.status === "live_error" ? "live_error" : airStatus,
      capturedAt,
      ttlMinutes: 15,
      coverage: ["pm10", "pm25", "ozone", "station_air_quality"],
      warnings: airStatus === "not_configured" ? ["AIRKOREA_SERVICE_KEY 미설정: 대기질 adapter는 fallback만 반환"] : warningsFromProbe(airProbe),
      recommendations: ["미세먼지/오존 악화 시 취약자 보호, 야외 대기열 완화, 마스크 안내를 검토한다."],
      freshnessMode: usingFixtureFallback ? "fallback" : undefined,
      data: airProbe?.ok
        ? { riskState: airRisk.state, summary: airRisk.summary, record: airRecord }
        : usingFixtureFallback && airStatus === "configured"
        ? { riskState: "normal", summary: "fixture air quality normal" }
        : null,
    }),
    evidence({
      sourceId: "SAFETY_DATA_DISASTER_MESSAGE",
      label: "재난안전데이터 긴급재난문자",
      status: safetyStatus,
      capturedAt,
      ttlMinutes: 5,
      coverage: ["emergency_disaster_message"],
      warnings: safetyStatus === "pending_key"
        ? ["SAFETY_DATA_API_KEY 발급 대기: 행정안전부 긴급재난문자 skeleton만 제공"]
        : safetyStatus === "not_configured"
          ? ["SAFETY_DATA_API_KEY 미설정"]
          : [],
      recommendations: ["행사장 위치 기반 재난문자가 있으면 운영본부 상황판단 로그와 안내방송 템플릿에 연결한다."],
    }),
    evidence({
      sourceId: "ITS_TRAFFIC_OPENAPI",
      label: "국가교통정보센터 ITS live traffic",
      status: itsStatus,
      capturedAt,
      ttlMinutes: 5,
      coverage: ["traffic_flow", "incident", "vms", "cctv_metadata"],
      warnings: itsStatus === "pending_key"
        ? ["ITS_OPENAPI_KEY 발급 대기: 교통소통/돌발/CCTV/VMS skeleton만 제공"]
        : itsStatus === "not_configured"
          ? ["ITS_OPENAPI_KEY 미설정"]
          : ["CCTV 영상은 저장하지 않고 메타데이터/상태만 사용한다."],
      recommendations: ["도로점용·셔틀·비상차량 접근 계획은 교통 돌발과 우회로 상태를 반영해 재확인한다."],
    }),
  ];

  return {
    generatedAt: capturedAt,
    location: {
      venueId: input.venueId,
      jurisdiction: input.jurisdiction,
      latitude: input.latitude,
      longitude: input.longitude,
    },
    operationalEvidence,
    warnings: operationalEvidence.flatMap((item) => item.warnings),
  };
}
