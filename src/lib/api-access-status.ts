import { hasEnvValue, loadEnvOnce, type EnvLike } from "./env.js";

export type ApiAccessPhase = "P0" | "P1" | "P2" | "support";
export type ApiAccessStatus =
  | "configured"
  | "missing"
  | "pending"
  | "externally_available"
  | "no_key_required";

export interface ApiAccessDefinition {
  id: string;
  label: string;
  phase: ApiAccessPhase;
  envVar?: string;
  statusWhenUnset: ApiAccessStatus;
  requiredForHappyPath: boolean;
  offlineMode: "offline_pack" | "snapshot" | "live_adapter" | "no_key_public";
  notes: string;
}

export interface ApiAccessReportItem extends ApiAccessDefinition {
  status: ApiAccessStatus;
  configured: boolean;
}

export interface ApiAccessReport {
  generatedAt: string;
  policy: {
    secretsSerialized: false;
    keyValuesIncluded: false;
  };
  summary: Record<ApiAccessStatus, number>;
  items: ApiAccessReportItem[];
}

export const API_ACCESS_DEFINITIONS: ApiAccessDefinition[] = [
  {
    id: "law_oc",
    label: "국가법령정보 공동활용 Open API",
    phase: "P0",
    envVar: "LAW_OC",
    statusWhenUnset: "externally_available",
    requiredForHappyPath: true,
    offlineMode: "offline_pack",
    notes: "DECK 외부 환경에서 사용 가능할 수 있다. 런타임은 이미 수집된 offline law/ordinance pack을 사용한다.",
  },
  {
    id: "kcisa_kopis_facility",
    label: "KCISA KOPIS 공연시설별상세정보",
    phase: "P0",
    envVar: "KCISA_KOPIS_FACILITY_KEY",
    statusWhenUnset: "missing",
    requiredForHappyPath: true,
    offlineMode: "offline_pack",
    notes: "전국 공연시설 2,111곳 offline directory 갱신에 사용한다.",
  },
  {
    id: "kopis_catalog",
    label: "KOPIS 공연/축제 catalog",
    phase: "P0",
    envVar: "KOPIS_SERVICE_KEY",
    statusWhenUnset: "missing",
    requiredForHappyPath: true,
    offlineMode: "offline_pack",
    notes: "공연 여부, 공연장/공연장 외, 기간, 지역 catalog 수집에 사용한다.",
  },
  {
    id: "tour_api_catalog",
    label: "한국관광공사 TourAPI 행사/축제 catalog",
    phase: "P0",
    envVar: "TOUR_API_SERVICE_KEY",
    statusWhenUnset: "missing",
    requiredForHappyPath: true,
    offlineMode: "offline_pack",
    notes: "실존 축제·행사 catalog와 관할 보강 snapshot에 사용한다.",
  },
  {
    id: "nemc_medical",
    label: "응급의료기관/AED 정보",
    phase: "P0",
    envVar: "NEMC_SERVICE_KEY",
    statusWhenUnset: "missing",
    requiredForHappyPath: true,
    offlineMode: "offline_pack",
    notes: "응급의료기관, AED, 이송 후보 pack에 사용한다.",
  },
  {
    id: "food_safety",
    label: "식품안전나라 F&B/HACCP/회수정보",
    phase: "P0",
    envVar: "FOOD_SAFETY_API_KEY",
    statusWhenUnset: "missing",
    requiredForHappyPath: true,
    offlineMode: "offline_pack",
    notes: "식음료/F&B 조건에서만 적용하는 offline/snapshot pack에 사용한다.",
  },
  {
    id: "venue_public_docs",
    label: "베뉴 운영규정/PDF/HWP",
    phase: "P0",
    statusWhenUnset: "no_key_required",
    requiredForHappyPath: true,
    offlineMode: "no_key_public",
    notes: "공개 문서 다운로드·Markdown 변환·structured extract 대상이다.",
  },
  {
    id: "seoul_realtime_city",
    label: "서울 실시간 도시/인구 데이터",
    phase: "P1",
    envVar: "SEOUL_OPENAPI_KEY",
    statusWhenUnset: "missing",
    requiredForHappyPath: true,
    offlineMode: "snapshot",
    notes: "서울 장소별 인파·도시 데이터 snapshot 및 P2 live crowd adapter에 사용한다.",
  },
  {
    id: "airkorea_air_quality",
    label: "에어코리아 대기질",
    phase: "P1",
    envVar: "AIRKOREA_SERVICE_KEY",
    statusWhenUnset: "missing",
    requiredForHappyPath: true,
    offlineMode: "snapshot",
    notes: "대기질 snapshot 및 P2 live air-quality adapter에 사용한다.",
  },
  {
    id: "kma_weather",
    label: "기상청 API Hub",
    phase: "P2",
    envVar: "KMA_APIHUB_KEY",
    statusWhenUnset: "missing",
    requiredForHappyPath: true,
    offlineMode: "live_adapter",
    notes: "단기/초단기/중기예보, 특보, 영향예보, AWS, 레이더, 낙뢰, 생활·보건기상지수 adapter에 사용한다.",
  },
  {
    id: "its_traffic",
    label: "국가교통정보센터 ITS",
    phase: "P1",
    envVar: "ITS_OPENAPI_KEY",
    statusWhenUnset: "pending",
    requiredForHappyPath: false,
    offlineMode: "snapshot",
    notes: "신청 완료, key pending. 교통소통/돌발/CCTV/VMS는 pending_key fallback만 제공한다.",
  },
  {
    id: "safety_data_disaster_message",
    label: "재난안전데이터 긴급재난문자",
    phase: "P1",
    envVar: "SAFETY_DATA_API_KEY",
    statusWhenUnset: "pending",
    requiredForHappyPath: false,
    offlineMode: "snapshot",
    notes: "신청 완료, key pending. 행정안전부 긴급재난문자 skeleton만 제공한다.",
  },
  {
    id: "eshare_public_facility",
    label: "공유누리/공공시설 자원",
    phase: "support",
    envVar: "ESHARE_SERVICE_KEY",
    statusWhenUnset: "missing",
    requiredForHappyPath: false,
    offlineMode: "snapshot",
    notes: "후순위. 명시적 unavailable 상태만 제공한다.",
  },
  {
    id: "kcisa_festival",
    label: "KCISA 지역축제정보",
    phase: "support",
    envVar: "KCISA_FESTIVAL_KEY",
    statusWhenUnset: "missing",
    requiredForHappyPath: false,
    offlineMode: "offline_pack",
    notes: "현재 available-key-first happy path에서는 TourAPI/KOPIS catalog를 우선 사용한다.",
  },
  {
    id: "local_license",
    label: "지방행정인허가",
    phase: "support",
    envVar: "LOCAL_LICENSE_SERVICE_KEY",
    statusWhenUnset: "missing",
    requiredForHappyPath: false,
    offlineMode: "offline_pack",
    notes: "후순위. 식품안전나라와 지자체 인허가 보강 이후 검토한다.",
  },
];

export function getApiAccessStatus(options: {
  env?: EnvLike;
  loadDotEnv?: boolean;
  generatedAt?: string;
} = {}): ApiAccessReport {
  const env = options.env ?? process.env;
  if (options.loadDotEnv !== false && env === process.env) {
    loadEnvOnce();
  }

  const items = API_ACCESS_DEFINITIONS.map((definition) => {
    const configured = definition.envVar ? hasEnvValue(definition.envVar, env) : false;
    const status = definition.envVar
      ? configured ? "configured" : definition.statusWhenUnset
      : definition.statusWhenUnset;
    return {
      ...definition,
      status,
      configured,
    };
  });

  const summary = {
    configured: 0,
    missing: 0,
    pending: 0,
    externally_available: 0,
    no_key_required: 0,
  } satisfies Record<ApiAccessStatus, number>;
  for (const item of items) {
    summary[item.status] += 1;
  }

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    policy: {
      secretsSerialized: false,
      keyValuesIncluded: false,
    },
    summary,
    items,
  };
}

export function statusForEnvVar(envVar: string, env: EnvLike = process.env): ApiAccessStatus {
  if (env === process.env) {
    loadEnvOnce();
  }
  const definition = API_ACCESS_DEFINITIONS.find((item) => item.envVar === envVar);
  if (!definition) return hasEnvValue(envVar, env) ? "configured" : "missing";
  return hasEnvValue(envVar, env) ? "configured" : definition.statusWhenUnset;
}
