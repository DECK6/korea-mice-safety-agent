import { z } from "zod";
import { loadEnvOnce } from "./env.js";
import { fetchPerformanceFacilities } from "./kcisa-client.js";

type FetchLike = typeof fetch;

export interface ApiClientOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export interface NormalizedExternalRecord {
  sourceId: string;
  recordType: string;
  title: string;
  jurisdiction?: string;
  location?: string;
  eventStartDate?: string;
  eventEndDate?: string;
  summary?: string;
  sourceConfidence: "low" | "medium" | "high";
  verificationStatus: "live_verified" | "source_verified" | "needs_source_review";
  fields: Record<string, unknown>;
}

export interface LiveApiResult<T> {
  ok: boolean;
  status: "live_verified" | "not_configured" | "live_error";
  sourceId: string;
  capturedAt: string;
  records: T[];
  totalCount?: number;
  warnings: string[];
}

interface RequestResult {
  ok: boolean;
  httpStatus: number;
  text: string;
}

// Light schemas guarding only the fields actually read below. Upstream payloads
// are validated before mapping so a malformed/hostile response cannot be cast
// straight into a record stamped as verified.
const RecordObject = z.record(z.string(), z.unknown());

const TourApiSchema = z.object({
  response: z.object({
    header: z.object({ resultCode: z.string().optional(), resultMsg: z.string().optional() }).optional(),
    body: z.object({
      totalCount: z.number().optional(),
      items: z.object({ item: z.union([RecordObject, z.array(RecordObject)]).optional() }).optional(),
    }).optional(),
  }).optional(),
});

const FoodSafetySchema = z.object({
  I0490: z.object({
    total_count: z.string().optional(),
    RESULT: z.object({ CODE: z.string().optional(), MSG: z.string().optional() }).optional(),
    row: z.array(RecordObject).optional(),
  }).optional(),
});

const SeoulCityDataSchema = z.object({
  RESULT: z.object({ "RESULT.CODE": z.string().optional(), "RESULT.MESSAGE": z.string().optional() }).optional(),
  CITYDATA: z.object({
    AREA_NM: z.string().optional(),
    AREA_CD: z.string().optional(),
    LIVE_PPLTN_STTS: z.array(RecordObject).optional(),
  }).optional(),
});

const SktStatusSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
  totalCount: z.number().optional(),
});

const SktPlacePoiSchema = z.object({
  status: SktStatusSchema.optional(),
  contents: z.array(z.object({ poiId: z.string(), poiName: z.string() })).optional(),
});

const SktPlaceCongestionSchema = z.object({
  status: SktStatusSchema.optional(),
  contents: z.object({
    poiId: z.string().optional(),
    poiName: z.string().optional(),
    rltm: z.array(z.object({
      datetime: z.string().optional(),
      congestion: z.number().optional(),
      congestionLevel: z.number().optional(),
      type: z.number().optional(),
    })).optional(),
  }).optional(),
});

export type SktCongestionState = "normal" | "watch" | "critical";

// SK open API PUZZLE-POI 문서의 혼잡도 등급 정의. 밀도 구간은 문서 원문 값이며,
// 운영 판단용 state는 4등급만 즉시 대응(critical), 3등급은 감시(watch)로 좁혀 매핑한다.
export const SKT_CONGESTION_LEVELS: Record<number, { label: string; densityBand: string; state: SktCongestionState }> = {
  1: { label: "여유", densityBand: "0.025명/㎡ 미만", state: "normal" },
  2: { label: "보통", densityBand: "0.025~0.05명/㎡", state: "normal" },
  3: { label: "혼잡", densityBand: "0.05~0.3명/㎡", state: "watch" },
  4: { label: "매우 혼잡", densityBand: "0.3명/㎡ 이상", state: "critical" },
};

function envValue(name: string, env?: NodeJS.ProcessEnv): string | undefined {
  if (!env) loadEnvOnce();
  return (env ?? process.env)[name];
}

// 에러 메시지에서 키/시크릿이 새지 않도록 마스킹한다.
// 쿼리 파라미터(serviceKey/authKey/service/*Key/*key)와 URL 경로에 박힌
// 키 세그먼트(FoodSafety: /api/<key>/..., Seoul: /<key>/json/...)를 모두 가린다.
function safeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message
    // service=<key>, serviceKey=<key>, authKey=<key>, anything ending in Key/key.
    .replace(/(\b[\w-]*(?:[Kk]ey)\b)=[^&\s]+/g, "$1=[redacted]")
    .replace(/(\bservice)=[^&\s]+/gi, "$1=[redacted]")
    // path-embedded keys: long opaque segments inside a URL path leak the raw key.
    .replace(/(https?:\/\/[^\s/]+\/)([^/\s?#]{16,})/gi, "$1[redacted]")
    .replace(/(\/api\/)[^/\s?#]+/gi, "$1[redacted]");
}

// Cap response bodies so a hostile/misbehaving upstream cannot exhaust memory.
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export async function readTextCapped(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`response body too large (${declared} bytes > ${maxBytes})`);
  }
  if (!response.body) return (await response.text()).slice(0, maxBytes);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`response body too large (> ${maxBytes} bytes)`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

async function requestText(url: string, options: ApiClientOptions = {}, headers?: Record<string, string>): Promise<RequestResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers });
    const text = await readTextCapped(response);
    return { ok: response.ok, httpStatus: response.status, text };
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseXmlRecords(xml: string, itemTag: "item" | "db" = "item"): Array<Record<string, string>> {
  const records: Array<Record<string, string>> = [];
  const pattern = new RegExp(`<${itemTag}>([\\s\\S]*?)</${itemTag}>`, "g");
  for (const itemMatch of xml.matchAll(pattern)) {
    const record: Record<string, string> = {};
    for (const field of itemMatch[1].matchAll(/<([A-Za-z][\w]*)>([\s\S]*?)<\/\1>/g)) {
      const value = decodeEntities(field[2]).trim();
      if (value) record[field[1]] = value;
    }
    records.push(record);
  }
  return records;
}

function xmlScalar(xml: string, tag: string): string | undefined {
  return xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim();
}

function normalizeDate(value?: string): string | undefined {
  if (!value) return undefined;
  const compact = value.replace(/[^\d]/g, "");
  if (compact.length < 8) return value;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function jurisdictionFromAddress(address?: string): string | undefined {
  const tokens = (address ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return undefined;
  const [sido, sigungu] = tokens;
  return [sido, /[시군구]$/.test(sigungu ?? "") ? sigungu : undefined].filter(Boolean).join(" ");
}

function result<T>(sourceId: string, records: T[], options: {
  totalCount?: number;
  warnings?: string[];
  status?: LiveApiResult<T>["status"];
} = {}): LiveApiResult<T> {
  return {
    ok: options.status ? options.status === "live_verified" : true,
    status: options.status ?? "live_verified",
    sourceId,
    capturedAt: new Date().toISOString(),
    records,
    totalCount: options.totalCount,
    warnings: options.warnings ?? [],
  };
}

function missing<T>(sourceId: string, envVar: string): LiveApiResult<T> {
  return result<T>(sourceId, [], {
    status: "not_configured",
    warnings: [`${envVar} 미설정`],
  });
}

function failed<T>(sourceId: string, err: unknown): LiveApiResult<T> {
  return result<T>(sourceId, [], {
    status: "live_error",
    warnings: [safeError(err)],
  });
}

export async function fetchKcisaPerformanceFacilitySample(options: ApiClientOptions & {
  limit?: number;
} = {}): Promise<LiveApiResult<NormalizedExternalRecord>> {
  try {
    const page = await fetchPerformanceFacilities({ numOfRows: options.limit ?? 3, pageNo: 1 });
    const records = page.items.map((item) => ({
      sourceId: "KCISA_KOPIS_PERFORMANCE_FACILITY",
      recordType: "performance_facility",
      title: item.title ?? "시설명 미상",
      jurisdiction: jurisdictionFromAddress(item.spatialCoverage),
      location: item.spatialCoverage,
      sourceConfidence: "high" as const,
      verificationStatus: "live_verified" as const,
      fields: {
        category: item.subjectCategory,
        contact: item.sourceTitle,
        sourceUrl: item.url,
      },
    }));
    return result("KCISA_KOPIS_PERFORMANCE_FACILITY", records, { totalCount: page.totalCount });
  } catch (err) {
    return failed("KCISA_KOPIS_PERFORMANCE_FACILITY", err);
  }
}

export async function fetchKopisPerformanceCatalog(options: ApiClientOptions & {
  startDate?: string;
  endDate?: string;
  limit?: number;
} = {}): Promise<LiveApiResult<NormalizedExternalRecord>> {
  const key = envValue("KOPIS_SERVICE_KEY", options.env);
  if (!key) return missing("KOPIS_PERFORMANCE_CATALOG", "KOPIS_SERVICE_KEY");
  const params = new URLSearchParams({
    service: key,
    stdate: (options.startDate ?? "20260501").replace(/[^\d]/g, ""),
    eddate: (options.endDate ?? "20260531").replace(/[^\d]/g, ""),
    cpage: "1",
    rows: String(options.limit ?? 5),
  });
  try {
    const response = await requestText(`https://www.kopis.or.kr/openApi/restful/pblprfr?${params.toString()}`, options);
    if (!response.ok) throw new Error(`KOPIS HTTP ${response.httpStatus}`);
    const items = parseXmlRecords(response.text, "db");
    const records = items.map((item) => ({
      sourceId: "KOPIS_PERFORMANCE_CATALOG",
      recordType: "performance_or_festival_event",
      title: item.prfnm ?? "공연명 미상",
      jurisdiction: item.area,
      location: item.fcltynm,
      eventStartDate: normalizeDate(item.prfpdfrom),
      eventEndDate: normalizeDate(item.prfpdto),
      sourceConfidence: "high" as const,
      verificationStatus: "live_verified" as const,
      fields: {
        kopisId: item.mt20id,
        venueName: item.fcltynm,
        genre: item.genrenm,
        state: item.prfstate,
        poster: item.poster,
      },
    }));
    return result("KOPIS_PERFORMANCE_CATALOG", records, { totalCount: records.length });
  } catch (err) {
    return failed("KOPIS_PERFORMANCE_CATALOG", err);
  }
}

export async function fetchTourApiFestivalCatalog(options: ApiClientOptions & {
  startDate?: string;
  endDate?: string;
  limit?: number;
} = {}): Promise<LiveApiResult<NormalizedExternalRecord>> {
  const key = envValue("TOUR_API_SERVICE_KEY", options.env);
  if (!key) return missing("TOUR_API_EVENT_CATALOG", "TOUR_API_SERVICE_KEY");
  const url = [
    "https://apis.data.go.kr/B551011/KorService2/searchFestival2",
    `?serviceKey=${key}`,
    `&numOfRows=${options.limit ?? 5}`,
    "&pageNo=1&MobileOS=ETC&MobileApp=korea-mice-safety-agent&_type=json",
    `&eventStartDate=${(options.startDate ?? "20260501").replace(/[^\d]/g, "")}`,
    `&eventEndDate=${(options.endDate ?? "20260531").replace(/[^\d]/g, "")}`,
  ].join("");
  try {
    const response = await requestText(url, options);
    if (!response.ok) throw new Error(`TourAPI HTTP ${response.httpStatus}`);
    const parsed = TourApiSchema.parse(JSON.parse(response.text));
    const header = parsed.response?.header;
    if (header?.resultCode !== "0000") throw new Error(`TourAPI resultCode ${header?.resultCode ?? "unknown"}: ${header?.resultMsg ?? ""}`);
    const rawItems = parsed.response?.body?.items?.item;
    const items = (Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : []) as Array<Record<string, string>>;
    const records = items.map((item) => ({
      sourceId: "TOUR_API_EVENT_CATALOG",
      recordType: "tourism_event",
      title: item.title ?? "행사명 미상",
      jurisdiction: jurisdictionFromAddress(item.addr1),
      location: [item.addr1, item.addr2].filter(Boolean).join(" "),
      eventStartDate: normalizeDate(item.eventstartdate),
      eventEndDate: normalizeDate(item.eventenddate),
      sourceConfidence: "high" as const,
      verificationStatus: "live_verified" as const,
      fields: {
        contentId: item.contentid,
        contentTypeId: item.contenttypeid,
        tel: item.tel,
        firstImage: item.firstimage,
      },
    }));
    return result("TOUR_API_EVENT_CATALOG", records, { totalCount: parsed.response?.body?.totalCount });
  } catch (err) {
    return failed("TOUR_API_EVENT_CATALOG", err);
  }
}

export async function fetchNemcEmergencyHospitals(options: ApiClientOptions & {
  sido?: string;
  sigungu?: string;
  limit?: number;
} = {}): Promise<LiveApiResult<NormalizedExternalRecord>> {
  const key = envValue("NEMC_SERVICE_KEY", options.env);
  if (!key) return missing("NEMC_EMERGENCY_MEDICAL", "NEMC_SERVICE_KEY");
  const url = [
    "https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEgytListInfoInqire",
    `?serviceKey=${key}`,
    `&Q0=${encodeURIComponent(options.sido ?? "서울특별시")}`,
    `&Q1=${encodeURIComponent(options.sigungu ?? "강남구")}`,
    "&pageNo=1",
    `&numOfRows=${options.limit ?? 5}`,
  ].join("");
  try {
    const response = await requestText(url, options);
    if (!response.ok) throw new Error(`NEMC HTTP ${response.httpStatus}`);
    const code = xmlScalar(response.text, "resultCode");
    if (code !== "00") throw new Error(`NEMC resultCode ${code ?? "unknown"}: ${xmlScalar(response.text, "resultMsg") ?? ""}`);
    const records = parseXmlRecords(response.text).map((item) => ({
      sourceId: "NEMC_EMERGENCY_MEDICAL",
      recordType: "emergency_medical_resource",
      title: item.dutyName ?? "응급의료기관명 미상",
      jurisdiction: jurisdictionFromAddress(item.dutyAddr),
      location: item.dutyAddr,
      sourceConfidence: "high" as const,
      verificationStatus: "live_verified" as const,
      fields: {
        className: item.dutyEmclsName,
        tel: item.dutyTel1,
        emergencyTel: item.dutyTel3,
        lat: item.wgs84Lat,
        lon: item.wgs84Lon,
      },
    }));
    return result("NEMC_EMERGENCY_MEDICAL", records, { totalCount: Number(xmlScalar(response.text, "totalCount") ?? records.length) });
  } catch (err) {
    return failed("NEMC_EMERGENCY_MEDICAL", err);
  }
}

export async function fetchNemcAedsNear(options: ApiClientOptions & {
  latitude?: number;
  longitude?: number;
  limit?: number;
} = {}): Promise<LiveApiResult<NormalizedExternalRecord>> {
  const key = envValue("NEMC_SERVICE_KEY", options.env);
  if (!key) return missing("NEMC_AED", "NEMC_SERVICE_KEY");
  const url = [
    "https://apis.data.go.kr/B552657/AEDInfoInqireService/getAedLcinfoInqire",
    `?serviceKey=${key}`,
    `&WGS84_LON=${options.longitude ?? 127.0588}`,
    `&WGS84_LAT=${options.latitude ?? 37.5118}`,
    "&pageNo=1",
    `&numOfRows=${options.limit ?? 5}`,
  ].join("");
  try {
    const response = await requestText(url, options);
    if (!response.ok) throw new Error(`NEMC AED HTTP ${response.httpStatus}`);
    const code = xmlScalar(response.text, "resultCode");
    if (code !== "00") throw new Error(`NEMC AED resultCode ${code ?? "unknown"}: ${xmlScalar(response.text, "resultMsg") ?? ""}`);
    const records = parseXmlRecords(response.text).map((item) => ({
      sourceId: "NEMC_AED",
      recordType: "aed_resource",
      title: [item.buildPlace, item.org].filter(Boolean).join(" / ") || "AED 위치명 미상",
      jurisdiction: jurisdictionFromAddress(item.buildAddress),
      location: item.buildAddress,
      sourceConfidence: "high" as const,
      verificationStatus: "live_verified" as const,
      fields: {
        manager: item.manager,
        tel: item.clerkTel,
        lat: item.wgs84Lat,
        lon: item.wgs84Lon,
      },
    }));
    return result("NEMC_AED", records, { totalCount: Number(xmlScalar(response.text, "totalCount") ?? records.length) });
  } catch (err) {
    return failed("NEMC_AED", err);
  }
}

export async function fetchFoodSafetyRecalls(options: ApiClientOptions & {
  limit?: number;
} = {}): Promise<LiveApiResult<NormalizedExternalRecord>> {
  const key = envValue("FOOD_SAFETY_API_KEY", options.env);
  if (!key) return missing("FOOD_SAFETY_KOREA", "FOOD_SAFETY_API_KEY");
  try {
    const response = await requestText(`https://openapi.foodsafetykorea.go.kr/api/${encodeURIComponent(key)}/I0490/json/1/${options.limit ?? 5}`, options);
    if (!response.ok) throw new Error(`FoodSafety HTTP ${response.httpStatus}`);
    const parsed = FoodSafetySchema.parse(JSON.parse(response.text));
    const body = parsed.I0490;
    if (!body) throw new Error("FoodSafety I0490 response missing");
    const records = ((body.row ?? []) as Array<Record<string, string>>).map((item) => ({
      sourceId: "FOOD_SAFETY_KOREA",
      recordType: "food_recall",
      title: item.PRDTNM ?? item.PRDLST_NM ?? item.PRDT_NM ?? "회수 제품명 미상",
      summary: item.RTRVLPRVNS ?? item.RTRVL_GRD ?? undefined,
      sourceConfidence: "medium" as const,
      verificationStatus: "source_verified" as const,
      fields: {
        reportNo: item.PRDLST_REPORT_NO,
        company: item.BSSHNM ?? item.BSSH_NM,
        address: item.ADDR,
        productType: item.PRDLST_CD_NM ?? item.PRDLST_TYPE,
        grade: item.RTRVL_GRDCD_NM,
        recallReason: item.RTRVLPRVNS,
        createdAt: item.CRET_DTM,
      },
    }));
    return result("FOOD_SAFETY_KOREA", records, { totalCount: Number(body.total_count ?? records.length) });
  } catch (err) {
    return failed("FOOD_SAFETY_KOREA", err);
  }
}

export async function fetchSeoulCityData(options: ApiClientOptions & {
  areaName?: string;
} = {}): Promise<LiveApiResult<NormalizedExternalRecord>> {
  const key = envValue("SEOUL_OPENAPI_KEY", options.env);
  if (!key) return missing("SEOUL_REALTIME_CITY_DATA", "SEOUL_OPENAPI_KEY");
  try {
    const areaName = options.areaName ?? "강남역";
    // openapi.seoul.go.kr serves plain HTTP on 8088 and does not answer on 443, so an https URL
    // fails the TLS handshake (ERR_SSL_WRONG_VERSION_NUMBER) instead of protecting anything. The
    // key travels in the path in cleartext; switch back to https only after Seoul offers TLS.
    const response = await requestText(`http://openapi.seoul.go.kr:8088/${key}/json/citydata/1/5/${encodeURIComponent(areaName)}`, options);
    if (!response.ok) throw new Error(`Seoul OpenAPI HTTP ${response.httpStatus}`);
    const parsed = SeoulCityDataSchema.parse(JSON.parse(response.text));
    if (parsed.RESULT?.["RESULT.CODE"] !== "INFO-000") {
      throw new Error(`Seoul OpenAPI ${parsed.RESULT?.["RESULT.CODE"] ?? "unknown"}: ${parsed.RESULT?.["RESULT.MESSAGE"] ?? ""}`);
    }
    const population = parsed.CITYDATA?.LIVE_PPLTN_STTS?.[0] ?? {};
    return result("SEOUL_REALTIME_CITY_DATA", [{
      sourceId: "SEOUL_REALTIME_CITY_DATA",
      recordType: "realtime_city_crowd",
      title: parsed.CITYDATA?.AREA_NM ?? areaName,
      jurisdiction: "서울특별시",
      sourceConfidence: "medium",
      verificationStatus: "source_verified",
      fields: {
        areaCode: parsed.CITYDATA?.AREA_CD,
        congestionLevel: population.AREA_CONGEST_LVL,
        congestionMessage: population.AREA_CONGEST_MSG,
        minPopulation: population.AREA_PPLTN_MIN,
        maxPopulation: population.AREA_PPLTN_MAX,
        updatedAt: population.PPLTN_TIME,
      },
    }], { totalCount: 1 });
  } catch (err) {
    return failed("SEOUL_REALTIME_CITY_DATA", err);
  }
}

// SKT 지오비전 퍼즐 장소 혼잡도: 서울 밖까지 커버하는 기지국 기반 실시간 인파.
// 무료 플랜은 모든 puzzle POI 엔드포인트 합산 월 10건이라, 호출 예산은 이 모듈이 아니라
// skt-place-congestion 원장이 관리한다. 여기서는 정규화만 한다.
export async function fetchSktPlaceCongestion(options: ApiClientOptions & {
  poiId: string;
}): Promise<LiveApiResult<NormalizedExternalRecord>> {
  const key = envValue("SK_OPEN_API_APP_KEY", options.env);
  if (!key) return missing("SKT_PUZZLE_PLACE_CONGESTION", "SK_OPEN_API_APP_KEY");
  try {
    const url = `https://apis.openapi.sk.com/puzzle/place/congestion/rltm/pois/${encodeURIComponent(options.poiId)}`;
    const response = await requestText(url, options, { appKey: key, accept: "application/json" });
    if (!response.ok) throw new Error(`SKT puzzle HTTP ${response.httpStatus}`);
    const parsed = SktPlaceCongestionSchema.parse(JSON.parse(response.text));
    if (parsed.status?.code !== "00") {
      throw new Error(`SKT puzzle status ${parsed.status?.code ?? "unknown"}: ${parsed.status?.message ?? ""}`);
    }
    const latest = parsed.contents?.rltm?.[0];
    if (!latest) throw new Error("SKT puzzle 응답에 실시간 관측치(rltm)가 없습니다");
    const level = SKT_CONGESTION_LEVELS[latest.congestionLevel ?? 0];
    return result("SKT_PUZZLE_PLACE_CONGESTION", [{
      sourceId: "SKT_PUZZLE_PLACE_CONGESTION",
      recordType: "realtime_place_congestion",
      title: parsed.contents?.poiName ?? options.poiId,
      sourceConfidence: "medium",
      verificationStatus: "source_verified",
      fields: {
        poiId: parsed.contents?.poiId ?? options.poiId,
        congestionLevel: latest.congestionLevel,
        congestionLabel: level?.label,
        densityBand: level?.densityBand,
        riskState: level?.state ?? "unknown",
        congestion: latest.congestion,
        datetime: latest.datetime,
        type: latest.type,
      },
    }], { totalCount: 1 });
  } catch (err) {
    return failed("SKT_PUZZLE_PLACE_CONGESTION", err);
  }
}

// 장소 메타 목록. 이름 검색 파라미터가 없어 offset/limit 순회로만 받을 수 있고,
// 그래서 결과를 오프라인 인덱스로 저장해 대시보드 검색은 쿼터 없이 처리한다.
export async function fetchSktPlacePois(options: ApiClientOptions & {
  offset?: number;
  limit?: number;
} = {}): Promise<LiveApiResult<NormalizedExternalRecord>> {
  const key = envValue("SK_OPEN_API_APP_KEY", options.env);
  if (!key) return missing("SKT_PUZZLE_PLACE_POI_META", "SK_OPEN_API_APP_KEY");
  const params = new URLSearchParams({
    offset: String(Math.max(options.offset ?? 0, 0)),
    limit: String(Math.min(Math.max(options.limit ?? 100, 1), 1000)),
  });
  try {
    const response = await requestText(
      `https://apis.openapi.sk.com/puzzle/place/meta/pois?${params.toString()}`,
      options,
      { appKey: key, accept: "application/json" },
    );
    if (!response.ok) throw new Error(`SKT puzzle meta HTTP ${response.httpStatus}`);
    const parsed = SktPlacePoiSchema.parse(JSON.parse(response.text));
    if (parsed.status?.code !== "00") {
      throw new Error(`SKT puzzle meta status ${parsed.status?.code ?? "unknown"}: ${parsed.status?.message ?? ""}`);
    }
    const records = (parsed.contents ?? []).map((poi) => ({
      sourceId: "SKT_PUZZLE_PLACE_POI_META",
      recordType: "place_poi_meta",
      title: poi.poiName,
      sourceConfidence: "high" as const,
      verificationStatus: "live_verified" as const,
      fields: { poiId: poi.poiId },
    }));
    return result("SKT_PUZZLE_PLACE_POI_META", records, { totalCount: parsed.status?.totalCount ?? records.length });
  } catch (err) {
    return failed("SKT_PUZZLE_PLACE_POI_META", err);
  }
}

export async function fetchAirKoreaStation(options: ApiClientOptions & {
  stationName?: string;
} = {}): Promise<LiveApiResult<NormalizedExternalRecord>> {
  const key = envValue("AIRKOREA_SERVICE_KEY", options.env);
  if (!key) return missing("AIRKOREA_AIR_QUALITY", "AIRKOREA_SERVICE_KEY");
  try {
    const stationName = options.stationName ?? "종로구";
    const url = [
      "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty",
      `?serviceKey=${key}`,
      "&returnType=json&numOfRows=1&pageNo=1",
      `&stationName=${encodeURIComponent(stationName)}`,
      "&dataTerm=DAILY&ver=1.3",
    ].join("");
    const response = await requestText(url, options);
    if (!response.ok) throw new Error(`AirKorea HTTP ${response.httpStatus}`);
    const parsed = JSON.parse(response.text) as {
      response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { totalCount?: number; items?: Array<Record<string, string>> } };
    };
    const header = parsed.response?.header;
    if (header?.resultCode !== "00") throw new Error(`AirKorea resultCode ${header?.resultCode ?? "unknown"}: ${header?.resultMsg ?? ""}`);
    const item = parsed.response?.body?.items?.[0];
    const records = item ? [{
      sourceId: "AIRKOREA_AIR_QUALITY",
      recordType: "station_air_quality",
      title: stationName,
      sourceConfidence: "high" as const,
      verificationStatus: "live_verified" as const,
      fields: {
        dataTime: item.dataTime,
        khaiGrade: item.khaiGrade,
        khaiValue: item.khaiValue,
        pm10Value: item.pm10Value,
        pm25Value: item.pm25Value,
        o3Value: item.o3Value,
        no2Value: item.no2Value,
      },
    }] : [];
    return result("AIRKOREA_AIR_QUALITY", records, { totalCount: parsed.response?.body?.totalCount });
  } catch (err) {
    return failed("AIRKOREA_AIR_QUALITY", err);
  }
}

function kstDate(now = new Date()): Date {
  return new Date(now.getTime() + 9 * 60 * 60_000);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function ymd(date: Date): string {
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`;
}

function hhmm(date: Date): string {
  return `${pad2(date.getUTCHours())}00`;
}

function latestUltraShortBase(now = new Date()): { baseDate: string; baseTime: string } {
  const date = kstDate(now);
  date.setUTCMinutes(0, 0, 0);
  if (kstDate(now).getUTCMinutes() < 45) {
    date.setUTCHours(date.getUTCHours() - 1);
  }
  return { baseDate: ymd(date), baseTime: hhmm(date) };
}

export async function fetchKmaUltraShort(options: ApiClientOptions & {
  nx?: number;
  ny?: number;
  now?: Date;
} = {}): Promise<LiveApiResult<NormalizedExternalRecord>> {
  const key = envValue("KMA_APIHUB_KEY", options.env);
  if (!key) return missing("KMA_APIHUB_WEATHER", "KMA_APIHUB_KEY");
  const { baseDate, baseTime } = latestUltraShortBase(options.now);
  try {
    const url = [
      "https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getUltraSrtNcst",
      "?pageNo=1&numOfRows=20&dataType=JSON",
      `&base_date=${baseDate}&base_time=${baseTime}`,
      `&nx=${options.nx ?? 61}&ny=${options.ny ?? 125}`,
      `&authKey=${encodeURIComponent(key)}`,
    ].join("");
    const response = await requestText(url, options);
    if (!response.ok) throw new Error(`KMA APIHub HTTP ${response.httpStatus}`);
    const parsed = JSON.parse(response.text) as {
      response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: { item?: Array<Record<string, string | number>> } } };
      result?: { status?: number; message?: string };
    };
    if (parsed.result?.status) throw new Error(`KMA APIHub ${parsed.result.status}: ${parsed.result.message ?? ""}`);
    const header = parsed.response?.header;
    if (header?.resultCode !== "00") throw new Error(`KMA APIHub resultCode ${header?.resultCode ?? "unknown"}: ${header?.resultMsg ?? ""}`);
    const items = parsed.response?.body?.items?.item ?? [];
    const byCategory = Object.fromEntries(items.map((item) => [String(item.category), item.obsrValue]));
    return result("KMA_APIHUB_WEATHER", [{
      sourceId: "KMA_APIHUB_WEATHER",
      recordType: "ultra_short_weather_observation",
      title: `격자 ${options.nx ?? 61},${options.ny ?? 125} 초단기실황`,
      sourceConfidence: "high",
      verificationStatus: "live_verified",
      fields: {
        baseDate,
        baseTime,
        nx: options.nx ?? 61,
        ny: options.ny ?? 125,
        temperatureC: byCategory.T1H,
        precipitationType: byCategory.PTY,
        precipitationMm: byCategory.RN1,
        humidityPct: byCategory.REH,
        windSpeedMs: byCategory.WSD,
        windDirection: byCategory.VEC,
      },
    }], { totalCount: items.length });
  } catch (err) {
    return failed("KMA_APIHUB_WEATHER", err);
  }
}
