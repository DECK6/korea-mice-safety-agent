import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hasEnvValue, loadEnvOnce } from "./env.js";
import {
  fetchSktPlaceCongestion,
  SKT_CONGESTION_LEVELS,
  type ApiClientOptions,
  type SktCongestionState,
} from "./mice-public-api-clients.js";
import poiIndex from "../ontology/mice/skt-place-poi-index.json" with { type: "json" };

// 무료 플랜은 모든 puzzle POI 엔드포인트(메타 목록 포함)를 합산해 월 10건이고 초과하면 자동 차단된다.
// 그래서 실호출 직전에 로컬 원장을 올리고, 한도에 닿으면 아예 호출하지 않는다.
export const SKT_MONTHLY_CALL_LIMIT = 10;

// 같은 장소를 연타해도 쿼터가 녹지 않도록 하는 최소 보호 장치.
const CACHE_TTL_MS = 10 * 60_000;

export const SKT_QUOTA_NOTE =
  "월 사용량은 이 머신의 로컬 추정치(수동 프로브 미포함)입니다. SK 콘솔 사용량이 실제 기준입니다.";

export const SKT_CONGESTION_DISCLAIMER =
  "SKT 지오비전 퍼즐 장소 혼잡도는 통신 기지국 기반 추정치이며 법령 판단 근거가 아닙니다. 무료 플랜 월 10건 한도라 자동 갱신에 넣지 않고 수동 조회로만 씁니다. 현장 판단은 게이트 계수·CCTV 관제·관계기관 협의로 확인하세요.";

export const SKT_POI_SEARCH_NOTE =
  "번들된 오프라인 POI 인덱스 로컬 검색이라 API 호출과 쿼터를 쓰지 않습니다.";

export const SKT_OUT_OF_INDEX_NOTE =
  "오프라인 POI 인덱스(상위 1,000곳)에 없는 장소입니다. SKT 메타 API에는 이름 검색 파라미터가 없어 즉석 조회가 불가능하고, 인덱스 확장은 npm run collect:skt-pois로 쿼터를 써야 합니다.";

export interface SktPoi {
  poiId: string;
  poiName: string;
}

export interface SktQuota {
  month: string;
  used: number;
  limit: number;
  estimated: true;
}

export type SktCongestionStatus =
  | "ok"
  | "not_configured"
  | "quota_exhausted"
  | "unknown_poi"
  | "live_error";

export interface SktCongestionResponse {
  status: SktCongestionStatus;
  poi: SktPoi | null;
  level: number | null;
  levelLabel: string | null;
  densityBand: string | null;
  congestion: number | null;
  datetime: string | null;
  state: SktCongestionState | "unknown";
  quota: SktQuota;
  quotaNote: string;
  cached: boolean;
  fetchedAt: string | null;
  message: string;
  warnings: string[];
  disclaimer: string;
}

const POIS = poiIndex.pois as SktPoi[];

export const SKT_POI_INDEX_META = {
  version: poiIndex.version,
  collectedAt: poiIndex.collectedAt,
  indexedCount: POIS.length,
  totalAvailable: poiIndex.totalAvailable,
  coverage: poiIndex.coverage,
};

function normalizeName(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

// 오프라인 부분일치 검색. 메타 API에 이름 검색이 없어서 존재하는 인덱스이므로, 여기서 쿼터를 쓰면 안 된다.
export function searchSktPois(query: string, limit = 20): SktPoi[] {
  const needle = normalizeName(query);
  if (!needle) return [];
  return POIS.filter((poi) => normalizeName(poi.poiName).includes(needle)).slice(0, limit);
}

export function findSktPoi(poiId: string): SktPoi | undefined {
  return POIS.find((poi) => poi.poiId === poiId);
}

function quotaDir(): string {
  return process.env.MICE_LOCAL_DIR ?? join(homedir(), ".korea-mice-safety-agent");
}

function quotaPath(): string {
  return join(quotaDir(), "skt-quota.json");
}

// SK 플랜 카운터는 한국 달력 기준으로 리셋된다.
function kstMonth(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60_000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}`;
}

function quotaOf(month: string, used: number): SktQuota {
  return { month, used, limit: SKT_MONTHLY_CALL_LIMIT, estimated: true };
}

export function readSktQuota(now = new Date()): SktQuota {
  const month = kstMonth(now);
  const path = quotaPath();
  if (!existsSync(path)) return quotaOf(month, 0);
  try {
    const stored = JSON.parse(readFileSync(path, "utf8")) as { month?: string; used?: number };
    // 달이 바뀌면 플랜 카운터가 리셋되므로 지난달 원장은 0에서 다시 센다.
    if (stored.month !== month) return quotaOf(month, 0);
    return quotaOf(month, Math.max(Number(stored.used) || 0, 0));
  } catch {
    // 읽을 수 없는 원장을 "0건 사용"으로 보면 한도를 넘길 수 있다. 막는 쪽으로 기운다.
    return quotaOf(month, SKT_MONTHLY_CALL_LIMIT);
  }
}

function writeSktQuota(quota: SktQuota): void {
  const dir = quotaDir();
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `skt-quota.json.tmp-${process.pid}`);
  writeFileSync(tmpPath, `${JSON.stringify({ month: quota.month, used: quota.used }, null, 2)}\n`);
  renameSync(tmpPath, quotaPath());
}

// 실호출 직전에만 부른다. 실패한 호출도 제공기관은 1건으로 세므로 되돌리지 않는다.
export function consumeSktQuota(now = new Date()): SktQuota {
  const next = quotaOf(kstMonth(now), readSktQuota(now).used + 1);
  writeSktQuota(next);
  return next;
}

interface CacheEntry {
  expiresAt: number;
  fetchedAt: string;
  reading: Pick<SktCongestionResponse, "level" | "levelLabel" | "densityBand" | "congestion" | "datetime" | "state">;
}

const readingCache = new Map<string, CacheEntry>();

function congestionState(value: unknown): SktCongestionState | "unknown" {
  return value === "normal" || value === "watch" || value === "critical" ? value : "unknown";
}

function appKeyConfigured(env?: NodeJS.ProcessEnv): boolean {
  if (!env) loadEnvOnce();
  return hasEnvValue("SK_OPEN_API_APP_KEY", env ?? process.env);
}

function response(
  status: SktCongestionStatus,
  poi: SktPoi | null,
  quota: SktQuota,
  message: string,
  extra: Partial<SktCongestionResponse> = {},
): SktCongestionResponse {
  return {
    status,
    poi,
    level: null,
    levelLabel: null,
    densityBand: null,
    congestion: null,
    datetime: null,
    state: "unknown",
    quota,
    quotaNote: SKT_QUOTA_NOTE,
    cached: false,
    fetchedAt: null,
    message,
    warnings: [],
    disclaimer: SKT_CONGESTION_DISCLAIMER,
    ...extra,
  };
}

export async function getSktCongestion(options: ApiClientOptions & {
  poiId: string;
  now?: Date;
}): Promise<SktCongestionResponse> {
  const now = options.now ?? new Date();
  const poiId = options.poiId.trim();
  const quota = readSktQuota(now);

  const poi = poiId ? findSktPoi(poiId) : undefined;
  if (!poi) {
    return response("unknown_poi", null, quota, poiId
      ? SKT_OUT_OF_INDEX_NOTE
      : "조회할 장소를 먼저 선택하세요.");
  }

  const cached = readingCache.get(poi.poiId);
  if (cached && cached.expiresAt > now.getTime()) {
    return response("ok", poi, quota, `${poi.poiName} 혼잡도 ${cached.reading.levelLabel ?? "-"} (10분 캐시, 쿼터 미사용)`, {
      ...cached.reading,
      cached: true,
      fetchedAt: cached.fetchedAt,
    });
  }

  if (!appKeyConfigured(options.env)) {
    return response("not_configured", poi, quota,
      "SK_OPEN_API_APP_KEY 미설정 상태라 전국 혼잡도를 조회할 수 없습니다. SK open API 콘솔에서 appKey를 발급해 .env에 넣으세요.");
  }

  if (quota.used >= quota.limit) {
    return response("quota_exhausted", poi, quota,
      `이번 달 추정 사용량이 한도(${quota.limit}건)에 닿아 호출하지 않았습니다. 무료 플랜은 다음 달 1일에 리셋됩니다. 그 전까지는 서울 실시간 도시데이터와 현장 계수로 판단하세요.`);
  }

  const spent = consumeSktQuota(now);
  const live = await fetchSktPlaceCongestion({ ...options, poiId: poi.poiId });
  if (live.status !== "live_verified" || live.records.length === 0) {
    return response("live_error", poi, spent,
      "SKT 혼잡도 조회에 실패했습니다. 실패한 호출도 제공기관 사용량에는 포함됩니다.", {
        warnings: live.warnings,
      });
  }

  const fields = live.records[0].fields as {
    congestionLevel?: number;
    congestionLabel?: string;
    densityBand?: string;
    riskState?: string;
    congestion?: number;
    datetime?: string;
  };
  const reading = {
    level: fields.congestionLevel ?? null,
    levelLabel: fields.congestionLabel ?? null,
    densityBand: fields.densityBand ?? null,
    congestion: fields.congestion ?? null,
    datetime: fields.datetime ?? null,
    state: congestionState(fields.riskState),
  };
  const fetchedAt = live.capturedAt;
  readingCache.set(poi.poiId, { expiresAt: now.getTime() + CACHE_TTL_MS, fetchedAt, reading });

  return response("ok", poi, spent,
    `${poi.poiName} 혼잡도 ${reading.levelLabel ?? "-"}${reading.levelLabel === SKT_CONGESTION_LEVELS[4].label ? " — 입장 조절·우회 동선 검토 구간" : ""}`, {
      ...reading,
      fetchedAt,
      warnings: live.warnings,
    });
}
