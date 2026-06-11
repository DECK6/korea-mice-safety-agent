import { loadEnvOnce } from "./env.js";

// Match requestText() in mice-public-api-clients.ts: a hung upstream must not block forever,
// and an unbounded body must not exhaust memory.
const KCISA_TIMEOUT_MS = 12_000;
const KCISA_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

// 문체부 문화데이터 오픈API (KCISA 한국문화정보원) 클라이언트.
// 예술경영지원센터 KOPIS 공연시설별 상세정보(전국 약 2,111곳)를 venue 인덱스로 가져온다.
// 내장 fetch만 사용하며, 응답은 XML이므로 평면 <item> 레코드를 정규화한다.

export const KCISA_KOPIS_FACILITY_URL =
  "https://api.kcisa.kr/openapi/service/rest/meta16/getkopis04";

export interface KcisaPage {
  resultCode: string;
  resultMsg: string;
  totalCount: number;
  pageNo: number;
  numOfRows: number;
  items: Array<Record<string, string>>;
  raw: string;
}

export interface KcisaQuery {
  numOfRows?: number;
  pageNo?: number;
  keyword?: string;
}

function requireKey(name: string): string {
  loadEnvOnce();
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name}가 설정되지 않았습니다. .env 또는 환경변수에 KCISA 서비스키를 넣으세요. (.env.example 참고)`,
    );
  }
  return value;
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

function extractScalar(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1].trim() : undefined;
}

// 평면 <item> 레코드 배열 + 페이지네이션 헤더를 정규화한다.
export function parseKcisaXml(xml: string): KcisaPage {
  const items: Array<Record<string, string>> = [];
  for (const itemMatch of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const record: Record<string, string> = {};
    for (const field of itemMatch[1].matchAll(/<([A-Za-z][\w]*)>([\s\S]*?)<\/\1>/g)) {
      const value = decodeEntities(field[2]).trim();
      if (value) record[field[1]] = value;
    }
    items.push(record);
  }
  return {
    resultCode: extractScalar(xml, "resultCode") ?? "",
    resultMsg: extractScalar(xml, "resultMsg") ?? "",
    totalCount: Number(extractScalar(xml, "totalCount") ?? "0"),
    pageNo: Number(extractScalar(xml, "pageNo") ?? "0"),
    numOfRows: Number(extractScalar(xml, "numOfRows") ?? "0"),
    items,
    raw: xml,
  };
}

const RESULT_CODE_HINTS: Record<string, string> = {
  F2013: "호출 실패(F2013) — 서비스키/파라미터를 확인하세요.",
  "9999": "서비스 점검중(9999) — 잠시 후 다시 시도하세요.",
};

async function callKcisa(
  url: string,
  serviceKey: string,
  query: KcisaQuery,
): Promise<KcisaPage> {
  const params = new URLSearchParams({
    serviceKey,
    numOfRows: String(query.numOfRows ?? 100),
    pageNo: String(query.pageNo ?? 1),
  });
  // 사이트 안내: 조건이 없어도 keyword 파라미터는 포함해 호출한다.
  params.set("keyword", query.keyword ?? "");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KCISA_TIMEOUT_MS);
  let xml: string;
  try {
    const response = await fetch(`${url}?${params.toString()}`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`KCISA HTTP ${response.status} ${response.statusText}`);
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > KCISA_MAX_RESPONSE_BYTES) {
      throw new Error(`KCISA response body too large (${declared} bytes > ${KCISA_MAX_RESPONSE_BYTES})`);
    }
    xml = (await response.text()).slice(0, KCISA_MAX_RESPONSE_BYTES);
  } finally {
    clearTimeout(timer);
  }
  const page = parseKcisaXml(xml);
  if (page.resultCode !== "0000") {
    const hint = RESULT_CODE_HINTS[page.resultCode] ?? page.resultMsg;
    throw new Error(`KCISA resultCode ${page.resultCode}: ${hint}`);
  }
  return page;
}

// KOPIS 공연시설별 상세정보 (전국 공연시설 약 2,111곳)
export function fetchPerformanceFacilities(query: KcisaQuery = {}): Promise<KcisaPage> {
  return callKcisa(
    KCISA_KOPIS_FACILITY_URL,
    requireKey("KCISA_KOPIS_FACILITY_KEY"),
    query,
  );
}
