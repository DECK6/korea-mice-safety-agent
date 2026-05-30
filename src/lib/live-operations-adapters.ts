import { statusForEnvVar, type ApiAccessStatus } from "./api-access-status.js";
import type { EnvLike } from "./env.js";

export type LiveAdapterStatus =
  | "configured"
  | "not_configured"
  | "pending_key"
  | "unsupported_region"
  | "live_call_skipped";

export interface OperationalEvidence {
  sourceId: string;
  label: string;
  status: LiveAdapterStatus;
  capturedAt: string;
  freshness: {
    mode: "live" | "fallback" | "not_collected";
    ttlMinutes: number;
    isStale: boolean;
  };
  coverage: string[];
  warnings: string[];
  recommendations: string[];
  data: Record<string, unknown> | null;
}

export interface LiveOperationsStatus {
  generatedAt: string;
  location: {
    venueId?: string;
    jurisdiction?: string;
    latitude?: number;
    longitude?: number;
  };
  operationalEvidence: OperationalEvidence[];
  warnings: string[];
  legalBasis?: never;
}

function adapterStatus(status: ApiAccessStatus): LiveAdapterStatus {
  if (status === "configured") return "configured";
  if (status === "pending") return "pending_key";
  return "not_configured";
}

function isSeoul(jurisdiction?: string): boolean {
  return Boolean(jurisdiction && /서울/.test(jurisdiction));
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
}): OperationalEvidence {
  return {
    sourceId: args.sourceId,
    label: args.label,
    status: args.status,
    capturedAt: args.capturedAt,
    freshness: {
      mode: args.status === "configured" ? "not_collected" : "fallback",
      ttlMinutes: args.ttlMinutes ?? 10,
      isStale: args.status !== "configured",
    },
    coverage: args.coverage,
    warnings: args.warnings ?? [],
    recommendations: args.recommendations ?? [],
    data: args.data ?? null,
  };
}

export function queryLiveOperationsStatus(input: {
  venueId?: string;
  jurisdiction?: string;
  latitude?: number;
  longitude?: number;
  env?: EnvLike;
  useFixtures?: boolean;
} = {}): LiveOperationsStatus {
  const capturedAt = new Date().toISOString();
  const env = input.env;
  const weatherStatus = adapterStatus(statusForEnvVar("KMA_APIHUB_KEY", env));
  const crowdStatus = isSeoul(input.jurisdiction)
    ? adapterStatus(statusForEnvVar("SEOUL_OPENAPI_KEY", env))
    : "unsupported_region";
  const airStatus = adapterStatus(statusForEnvVar("AIRKOREA_SERVICE_KEY", env));
  const safetyStatus = adapterStatus(statusForEnvVar("SAFETY_DATA_API_KEY", env));
  const itsStatus = adapterStatus(statusForEnvVar("ITS_OPENAPI_KEY", env));

  const operationalEvidence: OperationalEvidence[] = [
    evidence({
      sourceId: "KMA_APIHUB_WEATHER",
      label: "기상청 API Hub live weather risk",
      status: weatherStatus,
      capturedAt,
      ttlMinutes: 10,
      coverage: ["short_forecast", "ultra_short_forecast", "mid_forecast", "weather_warning", "impact_forecast", "aws", "radar", "lightning", "lifestyle_health_indices"],
      warnings: weatherStatus === "not_configured"
        ? ["KMA_APIHUB_KEY 미설정: 기상 live adapter는 fallback만 반환"]
        : ["endpoint detail TODO: 운영 전 단기/특보 endpoint별 파라미터를 확정해야 함"],
      recommendations: ["야외 무대·트러스·현수막·임시전기 조건에서는 강풍/호우/낙뢰 특보를 행사중지 기준과 연결한다."],
      data: input.useFixtures && weatherStatus === "configured"
        ? { riskState: "normal", summary: "fixture weather normal" }
        : null,
    }),
    evidence({
      sourceId: "SEOUL_REALTIME_CITY_DATA",
      label: "서울 실시간 도시/인구 live crowd signal",
      status: crowdStatus,
      capturedAt,
      ttlMinutes: 5,
      coverage: ["seoul_hotspot_population", "crowd_level", "city_signal"],
      warnings: crowdStatus === "unsupported_region"
        ? ["서울 지역이 아니므로 서울 실시간 도시데이터를 일반 적용하지 않는다."]
        : crowdStatus === "not_configured"
          ? ["SEOUL_OPENAPI_KEY 미설정: 서울 live crowd adapter는 fallback만 반환"]
          : [],
      recommendations: ["혼잡도 급상승 시 입장 제한, 우회동선, 안내방송, 스태프 추가 투입 기준과 연결한다."],
      data: input.useFixtures && crowdStatus === "configured"
        ? { riskState: "watch", summary: "fixture Seoul crowd watch" }
        : null,
    }),
    evidence({
      sourceId: "AIRKOREA_AIR_QUALITY",
      label: "에어코리아 live air quality",
      status: airStatus,
      capturedAt,
      ttlMinutes: 15,
      coverage: ["pm10", "pm25", "ozone", "station_air_quality"],
      warnings: airStatus === "not_configured" ? ["AIRKOREA_SERVICE_KEY 미설정: 대기질 adapter는 fallback만 반환"] : [],
      recommendations: ["미세먼지/오존 악화 시 취약자 보호, 야외 대기열 완화, 마스크 안내를 검토한다."],
      data: input.useFixtures && airStatus === "configured"
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
