import { fetchPerformanceFacilities } from "./kcisa-client.js";

// KOPIS 공연시설별상세정보 → 오프라인 venue 디렉터리(전국 공연시설 인덱스).
// 기존 19개 거점 베뉴(venue-facility-index)와 별개로, 관할·주소·분류·연락처 수준의
// 광역 인덱스를 제공해 행사 입력 시 관할(jurisdiction) 자동 보강에 쓴다.

export interface VenueDirectoryEntry {
  venueId: string;
  name: string;
  sido: string;
  sigungu: string;
  jurisdiction: string;
  address: string;
  category: string;
  contact: string;
  sourceUrl: string;
}

export interface VenueDirectory {
  provider: string;
  sourceUrl: string;
  resultCode: string;
  totalCount: number;
  fetchedCount: number;
  venues: VenueDirectoryEntry[];
}

// 주소(예 "경기도 남양주시 호평로68번길 21 (호평동)")에서 시·도 / 시·군·구를 추출.
export function extractRegion(address: string | undefined): { sido: string; sigungu: string; jurisdiction: string } {
  const tokens = (address ?? "").trim().split(/\s+/).filter(Boolean);
  const sido = tokens[0] ?? "";
  const sigungu = tokens[1] && /[시군구]$/.test(tokens[1]) ? tokens[1] : "";
  const jurisdiction = [sido, sigungu].filter(Boolean).join(" ");
  return { sido, sigungu, jurisdiction };
}

function normalizeFacility(record: Record<string, string>, sequence: number): VenueDirectoryEntry {
  const { sido, sigungu, jurisdiction } = extractRegion(record.spatialCoverage);
  return {
    venueId: `kopis_${String(sequence).padStart(5, "0")}`,
    name: record.title ?? "시설명 미상",
    sido,
    sigungu,
    jurisdiction,
    address: record.spatialCoverage ?? "",
    category: record.subjectCategory ?? "",
    contact: record.sourceTitle ?? "",
    sourceUrl: record.url ?? "",
  };
}

export interface BuildOptions {
  numOfRows?: number;
  maxPages?: number;
  onRawPage?: (pageNo: number, xml: string) => Promise<void> | void;
  onProgress?: (pageNo: number, fetched: number, totalCount: number) => void;
}

// 전체 공연시설을 페이지 단위로 순회해 디렉터리를 구축한다.
export async function buildVenueDirectory(options: BuildOptions = {}): Promise<VenueDirectory> {
  const numOfRows = options.numOfRows ?? 100;
  const venues: VenueDirectoryEntry[] = [];
  let pageNo = 1;
  let totalCount = 0;
  let resultCode = "";

  while (true) {
    const page = await fetchPerformanceFacilities({ numOfRows, pageNo });
    resultCode = page.resultCode;
    totalCount = page.totalCount;
    await options.onRawPage?.(pageNo, page.raw);
    for (const record of page.items) {
      venues.push(normalizeFacility(record, venues.length + 1));
    }
    options.onProgress?.(pageNo, venues.length, totalCount);

    if (page.items.length === 0) break;
    if (venues.length >= totalCount) break;
    if (options.maxPages && pageNo >= options.maxPages) break;
    pageNo += 1;
  }

  return {
    provider: "예술경영지원센터 KOPIS-공연시설별상세정보 (문체부 문화데이터 / KCISA 한국문화정보원)",
    sourceUrl: "https://api.kcisa.kr/openapi/service/rest/meta16/getkopis04",
    resultCode,
    totalCount,
    fetchedCount: venues.length,
    venues,
  };
}

export interface VenueSearch {
  query?: string;
  region?: string;
  category?: string;
  limit?: number;
}

// 오프라인 디렉터리에서 시설명/지역/분류로 검색한다(네트워크 호출 없음).
export function searchVenueDirectory(directory: VenueDirectory, search: VenueSearch): VenueDirectoryEntry[] {
  const query = search.query?.trim();
  const region = search.region?.trim();
  const category = search.category?.trim();
  const limit = search.limit ?? 20;

  const results = directory.venues.filter((venue) => {
    if (query && !venue.name.includes(query)) return false;
    if (region && !(venue.jurisdiction.includes(region) || venue.address.includes(region))) return false;
    if (category && !venue.category.includes(category)) return false;
    return true;
  });
  return results.slice(0, limit);
}
