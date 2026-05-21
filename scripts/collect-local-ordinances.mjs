#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const lawApiBase = "https://www.law.go.kr/DRF";
const oc = process.env.LAW_OC;

if (!oc) {
  console.error("LAW_OC 환경변수가 필요합니다. 키 값은 파일에 저장하지 않습니다.");
  process.exit(1);
}

const categories = [
  {
    id: "regional_festival_safety",
    label: "지역축제 안전관리 조례",
    query: "지역축제 안전관리 조례",
    match: (name) => name.includes("지역축제") && name.includes("안전관리"),
    eventTypes: ["festival", "outdoor_event"],
    dutyIds: ["mice_event_safety_management_plan", "mice_crowd_management_plan"],
    hazardIds: ["crowd_density_high", "ingress_egress_bottleneck", "weather_outdoor_event"],
  },
  {
    id: "outdoor_event_safety",
    label: "옥외행사 안전관리 조례",
    query: "옥외행사 안전관리 조례",
    match: (name) => /옥외\s*행사|옥외행사/.test(name) && name.includes("안전관리"),
    eventTypes: ["festival", "outdoor_event", "performance"],
    dutyIds: ["mice_event_safety_management_plan", "mice_crowd_management_plan"],
    hazardIds: ["crowd_density_high", "ingress_egress_bottleneck", "weather_outdoor_event", "medical_emergency"],
  },
  {
    id: "road_occupancy",
    label: "도로점용·교통소통 조례",
    query: "도로점용 조례",
    match: (name) => name.includes("도로점용") && /(점용료|점용허가|교통소통)/.test(name),
    eventTypes: ["festival", "outdoor_event"],
    dutyIds: ["road_traffic_and_outdoor_signage_permit"],
    hazardIds: ["ingress_egress_bottleneck"],
  },
  {
    id: "outdoor_advertising",
    label: "옥외광고물 관리 조례",
    query: "옥외광고물 조례",
    match: (name) =>
      name.includes("옥외광고물") &&
      name.includes("관리") &&
      name.includes("옥외광고산업") &&
      !name.includes("기금") &&
      !name.includes("시행규칙") &&
      !name.includes("시행세칙") &&
      !name.includes("위원회"),
    eventTypes: ["festival", "outdoor_event", "exhibition", "performance"],
    dutyIds: ["road_traffic_and_outdoor_signage_permit"],
    hazardIds: ["weather_outdoor_event"],
  },
];

const categoryDefaults = {
  regional_festival_safety: {
    appliesWhen: "지방자치단체 또는 민간이 지역축제를 개최하고 관할 시장·군수·구청장 통보, 지역안전관리위원회/관계기관 협의, 안전관리계획 심의·보완이 필요한 경우",
    crowdThreshold: "재난안전법 시행령상 지역축제 기준과 관할 조례를 함께 확인",
    submissionDeadline: "관할 조례 또는 지자체 고시 기준 확인",
    requiredPlanItems: ["행사 개요", "장소·주변 위험요소", "인파·동선 관리", "안전관리 인력", "화재·응급·교통 대책", "관계기관 연락체계"],
    inspectionRules: ["지역안전관리위원회 또는 관계기관 합동점검 대상 여부 확인", "보완 요구 시 조치 이행 증빙"],
    agencyCoordination: ["관할 지자체", "경찰", "소방", "의료/보건", "시설관리자"],
    insuranceOrLiability: "민간 주최, 후원, 보조금 행사일 경우 보험·배상책임 조건을 관할 조례와 계약서에서 확인",
  },
  outdoor_event_safety: {
    appliesWhen: "천장이 없거나 사방이 폐쇄되지 않은 장소에서 불특정 다수가 참여하는 공연·축제·체육·전시성 행사",
    crowdThreshold: "다수 조례에서 순간 최대 500명 이상 또는 500명 이상 1,000명 미만 옥외행사를 별도 관리하고, 1,000명 이상은 재난안전법/공연법 연계를 요구",
    submissionDeadline: "다수 조례에서 행사 5~21일 전 안전관리계획 수립·신고 또는 제출 요구",
    requiredPlanItems: ["행사 개요", "장소 및 주변시설 위험요소", "안전관리조직·임무", "안전관리요원 배치", "화재예방", "비상대응", "담당기관 연락처", "접근경로·교통대책"],
    inspectionRules: ["행사 개시 전 안전점검", "필요 시 소방·경찰·구청/시청 합동점검", "보완사항 시정 확인"],
    agencyCoordination: ["관할 지자체", "소방서", "경찰서", "의료기관", "시설 관계인"],
    insuranceOrLiability: "조례별 보험가입 조항 또는 보조금/후원 조건을 확인",
  },
  road_occupancy: {
    appliesWhen: "도로·보도·광장 등에 임시시설, 안내물, 부스, 무대, 대기열, 셔틀 승하차장, 행진·퍼레이드, 차량통제 구역을 설치하거나 도로를 점용하는 경우",
    crowdThreshold: "인원 기준보다 도로관리청 허가 대상 시설·점용 면적·점용 기간·교통 영향 기준 확인",
    submissionDeadline: "도로점용허가 신청 및 교통소통대책 제출 기한은 관할 도로관리청 기준 확인",
    requiredPlanItems: ["점용 위치·면적·기간", "임시시설 도면", "보행자 안전대책", "차량 우회·통제 계획", "안내표지", "원상회복 계획"],
    inspectionRules: ["허가조건 이행 점검", "보행자 안전시설", "우회안내", "원상회복 확인"],
    agencyCoordination: ["도로관리청", "경찰", "교통부서", "시설관리자"],
    insuranceOrLiability: "도로 훼손, 보행자 사고, 원상회복 비용 부담 조건 확인",
  },
  outdoor_advertising: {
    appliesWhen: "행사 홍보·안내를 위해 현수막, 배너, 안내판, 지주형 표시물, 전광류·전기 사용 광고물을 옥외에 표시·설치하는 경우",
    crowdThreshold: "인원 기준보다 표시 장소, 광고물 종류, 크기, 기간, 전기 사용 여부, 안전점검 대상 여부 확인",
    submissionDeadline: "표시·설치 전 허가/신고 및 게시대 신청 기한을 관할 지자체 기준으로 확인",
    requiredPlanItems: ["광고물 종류", "표시 위치", "규격·수량", "설치 기간", "고정·전도방지", "전기 사용", "철거·원상복구"],
    inspectionRules: ["강풍·낙하·전도 위험 점검", "전기 사용 광고물 안전점검", "허가 기간 종료 후 철거"],
    agencyCoordination: ["옥외광고 담당부서", "도로관리청", "시설관리자"],
    insuranceOrLiability: "낙하물·전도·시설훼손 책임 및 철거비용 부담 조건 확인",
  },
};

const priorityJurisdictions = new Set([
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "광주광역시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
  "경기도",
  "강원특별자치도",
  "충청북도",
  "충청남도",
  "전북특별자치도",
  "전라남도",
  "경상북도",
  "경상남도",
  "제주특별자치도",
  "고양시",
  "수원시",
  "창원시",
  "광주광역시 서구",
  "대전광역시 유성구",
  "인천광역시 연수구",
  "경주시",
  "구미시",
  "여수시",
  "군산시",
  "포항시",
]);

function stripCdata(value) {
  return String(value ?? "").replace(/^<!\[CDATA\[(.*)\]\]>$/s, "$1").trim();
}

function cleanText(value) {
  return stripCdata(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uniqueNonEmpty(items) {
  return [...new Set(items.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function tag(content, name) {
  const match = content.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? stripCdata(match[1]) : "";
}

async function lawSearch(query, page) {
  const params = new URLSearchParams({
    OC: oc,
    target: "ordin",
    type: "XML",
    query,
    display: "100",
    page: String(page),
  });
  const res = await fetch(`${lawApiBase}/lawSearch.do?${params.toString()}`);
  if (!res.ok) throw new Error(`lawSearch failed: ${res.status} ${query}`);
  const xml = await res.text();
  const total = Number(tag(xml, "totalCnt") || 0);
  const items = [...xml.matchAll(/<law(?:\s[^>]*)?>([\s\S]*?)<\/law>/g)].map((match) => {
    const content = match[1];
    const name = tag(content, "자치법규명");
    const ordinSeq = tag(content, "자치법규일련번호");
    return {
      ordinSeq,
      name,
      jurisdiction: tag(content, "지자체기관명"),
      promulgatedAt: tag(content, "공포일자"),
      effectiveAt: tag(content, "시행일자"),
      sourceUrl: `https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=${ordinSeq}`,
    };
  });
  return { total, items };
}

async function searchAll(category) {
  const out = [];
  let total = 0;
  for (let page = 1; page <= 20; page += 1) {
    const result = await lawSearch(category.query, page);
    total = result.total;
    out.push(...result.items);
    if (out.length >= total || result.items.length === 0) break;
  }
  const dedup = new Map();
  for (const item of out) {
    if (!item.ordinSeq || !category.match(item.name)) continue;
    dedup.set(item.ordinSeq, {
      id: `${category.id}:${item.ordinSeq}`,
      categoryId: category.id,
      categoryLabel: category.label,
      eventTypes: category.eventTypes,
      dutyIds: category.dutyIds,
      hazardIds: category.hazardIds,
      ...item,
      articleExtracts: [],
      verificationStatus: "verified",
      sourceConfidence: "official_law_go_search_result",
    });
  }
  return { total, matched: [...dedup.values()] };
}

async function getOrdinanceArticles(ordinSeq) {
  const params = new URLSearchParams({
    OC: oc,
    target: "ordin",
    type: "JSON",
    MST: ordinSeq,
  });
  const res = await fetch(`${lawApiBase}/lawService.do?${params.toString()}`);
  if (!res.ok) return [];
  const json = await res.json();
  const raw = json?.LawService?.조문?.조;
  const articles = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return articles
    .map((article) => {
      const title = cleanText(article.조제목 ?? "");
      const text = cleanText(article.조내용 ?? "");
      const articleNo = text.match(/^제\d+조(?:의\d+)?/)?.[0] ?? title.match(/^제\d+조(?:의\d+)?/)?.[0] ?? "";
      return {
        article: articleNo,
        title,
        textExcerpt: text.length > 320 ? `${text.slice(0, 320)}...` : text,
      };
    })
    .filter((article) => article.title || article.textExcerpt)
    .slice(0, 18);
}

function extractDeadline(text) {
  const matches = [...text.matchAll(/(?:개최|개시|행사)\s*(\d+)\s*일\s*전/g)].map((match) => `${match[1]}일 전`);
  return uniqueNonEmpty(matches).slice(0, 4);
}

function extractCrowdThreshold(text) {
  const matches = [...text.matchAll(/(?:순간\s*최대\s*)?(?:관람객|참여인원|인원|관람|참여)?\s*(\d{2,3}(?:,\d{3})?|\d{3,5})\s*명\s*(?:이상|미만|초과|이하)?/g)]
    .map((match) => {
      const start = Math.max(0, match.index - 30);
      const end = Math.min(text.length, match.index + match[0].length + 30);
      return text.slice(start, end).replace(/\s+/g, " ");
    });
  return uniqueNonEmpty(matches).slice(0, 5);
}

function extractPlanItems(articles, defaults) {
  const planArticle = articles.find((article) => /안전관리계획|교통소통대책|허가|신고/.test(`${article.title} ${article.textExcerpt}`));
  if (!planArticle) return defaults.requiredPlanItems;
  const text = planArticle.textExcerpt;
  const matches = [...text.matchAll(/\d+\.\s*([^0-9]+?)(?=\d+\.|$)/g)]
    .map((match) => match[1].replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 3 && item.length <= 80);
  return uniqueNonEmpty(matches).slice(0, 10).length > 0 ? uniqueNonEmpty(matches).slice(0, 10) : defaults.requiredPlanItems;
}

function extractInspectionRules(articles, defaults) {
  const text = articles
    .filter((article) => /안전점검|점검|시정|보완|원상회복/.test(`${article.title} ${article.textExcerpt}`))
    .map((article) => article.textExcerpt)
    .join(" ");
  const rules = [];
  if (/1일\s*전/.test(text)) rules.push("행사 개시 1일 전 안전점검 조항 확인");
  if (/합동\s*안전점검|합동점검/.test(text)) rules.push("소방·경찰·지자체 등 합동점검 요청 가능성 확인");
  if (/보완|시정/.test(text)) rules.push("점검 보완·시정 요구 시 조치 완료 증빙");
  if (/원상회복/.test(text)) rules.push("행사 종료 후 원상회복 확인");
  return uniqueNonEmpty([...rules, ...defaults.inspectionRules]).slice(0, 8);
}

function extractAgencyCoordination(articles, defaults) {
  const text = articles.map((article) => `${article.title} ${article.textExcerpt}`).join(" ");
  const agencies = [];
  if (/소방/.test(text)) agencies.push("소방서");
  if (/경찰/.test(text)) agencies.push("경찰서");
  if (/의료|응급|보건/.test(text)) agencies.push("의료/보건");
  if (/시장|군수|구청장|도지사|지자체|관할/.test(text)) agencies.push("관할 지자체");
  if (/관계인|시설/.test(text)) agencies.push("시설 관계인");
  return uniqueNonEmpty([...agencies, ...defaults.agencyCoordination]).slice(0, 8);
}

function extractInsuranceOrLiability(articles, defaults) {
  const insuranceArticle = articles.find((article) => /보험|배상|책임|원상회복/.test(`${article.title} ${article.textExcerpt}`));
  if (!insuranceArticle) return defaults.insuranceOrLiability;
  return insuranceArticle.textExcerpt.length > 220 ? `${insuranceArticle.textExcerpt.slice(0, 220)}...` : insuranceArticle.textExcerpt;
}

function classifyRoadOccupancy(record) {
  if (record.categoryId !== "road_occupancy") return undefined;
  if (record.name.includes("교통소통대책")) return "construction_traffic_plan";
  if (record.name.includes("점용허가")) return "road_occupancy_permit";
  if (record.name.includes("점용료")) return "fee_collection";
  return "road_occupancy_general";
}

function classifyOutdoorAdvertising(record) {
  if (record.categoryId !== "outdoor_advertising") return undefined;
  return ["banner", "temporary_signage", "standing_sign", "electric_display", "event_wayfinding"];
}

function enrichOrdinanceRecord(record) {
  const defaults = categoryDefaults[record.categoryId] ?? categoryDefaults.outdoor_event_safety;
  const text = (record.articleExtracts ?? []).map((article) => `${article.title} ${article.textExcerpt}`).join(" ");
  const deadlines = extractDeadline(text);
  const crowd = extractCrowdThreshold(text);
  return {
    ...record,
    category: record.categoryId,
    ordinanceName: record.name,
    lawOrOrdinanceName: record.name,
    sourceId: record.ordinSeq,
    appliesWhen: defaults.appliesWhen,
    crowdThreshold: crowd.length > 0 ? crowd.join(" / ") : defaults.crowdThreshold,
    threshold: crowd.length > 0 ? crowd.join(" / ") : defaults.crowdThreshold,
    submissionDeadline: deadlines.length > 0 ? deadlines.join(" / ") : defaults.submissionDeadline,
    requiredPlanItems: extractPlanItems(record.articleExtracts ?? [], defaults),
    inspectionRules: extractInspectionRules(record.articleExtracts ?? [], defaults),
    agencyCoordination: extractAgencyCoordination(record.articleExtracts ?? [], defaults),
    insuranceOrLiability: extractInsuranceOrLiability(record.articleExtracts ?? [], defaults),
    relatedDuties: record.dutyIds,
    relatedHazards: record.hazardIds,
    roadOccupancySubtype: classifyRoadOccupancy(record),
    outdoorAdvertisingTypes: classifyOutdoorAdvertising(record),
    structuredStatus: (record.articleExtracts ?? []).length > 0 ? "article_extracted" : "category_default",
  };
}

function buildArticlePatterns() {
  return [
    {
      categoryId: "outdoor_event_safety",
      commonArticleThemes: ["목적", "적용범위", "안전관리계획", "안전점검", "관계기관 협조", "보험가입", "준용"],
      miceDutyMapping: ["행사 안전관리계획서", "인파·동선 관리계획", "관계기관 협의", "현장점검 증빙"],
    },
    {
      categoryId: "regional_festival_safety",
      commonArticleThemes: ["안전관리위원회", "지역축제 안전관리계획", "심의·보완", "관계기관 협조"],
      miceDutyMapping: ["지역축제 안전관리계획", "지자체 사전 통보", "소방·경찰 역할분담"],
    },
    {
      categoryId: "road_occupancy",
      commonArticleThemes: ["도로점용허가", "점용료", "감면", "원상회복", "교통소통대책"],
      miceDutyMapping: ["도로점용 허가", "차량·보행 동선 분리", "행사 후 원상복구"],
    },
    {
      categoryId: "outdoor_advertising",
      commonArticleThemes: ["허가·신고", "표시방법", "안전점검", "금지광고물", "제거·원상복구"],
      miceDutyMapping: ["현수막·배너 허가", "임시 안내물 설치 기준", "강풍·낙하물 점검"],
    },
  ];
}

const categoryResults = [];
const records = [];
for (const category of categories) {
  const result = await searchAll(category);
  categoryResults.push({
    id: category.id,
    label: category.label,
    query: category.query,
    totalSearchHits: result.total,
    matchedRecords: result.matched.length,
    eventTypes: category.eventTypes,
    dutyIds: category.dutyIds,
    hazardIds: category.hazardIds,
  });
  records.push(...result.matched);
}

const priorityRecords = records.filter((record) => priorityJurisdictions.has(record.jurisdiction));
for (const record of priorityRecords) {
  record.articleExtracts = await getOrdinanceArticles(record.ordinSeq);
}

const enrichedRecords = records
  .map(enrichOrdinanceRecord)
  .sort((a, b) => a.categoryId.localeCompare(b.categoryId) || a.jurisdiction.localeCompare(b.jurisdiction, "ko") || a.name.localeCompare(b.name, "ko"));

const pack = {
  version: "0.2.0",
  generatedAt: new Date().toISOString().slice(0, 10),
  sourceTool: "law.go.kr DRF local ordinance API via collect-local-ordinances.mjs",
  storagePolicy: "LAW_OC is used only at collection time. Runtime tools answer from this offline JSON without network calls.",
  scope: "Local ordinance index and selected article extracts for regional festival safety, outdoor event safety, road occupancy, and outdoor advertising duties relevant to Korean MICE/outdoor events.",
  categories: categoryResults,
  articlePatterns: buildArticlePatterns(),
  records: enrichedRecords,
};

const jsonPath = join(root, "src/ontology/mice/local-ordinance-pack.json");
writeFileSync(jsonPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");

const mdPath = join(root, "data/markdown/legal/local-ordinance-pack.md");
mkdirSync(dirname(mdPath), { recursive: true });
const lines = [
  "---",
  'title: "MICE 지역 조례 오프라인 팩"',
  `generatedAt: "${pack.generatedAt}"`,
  'status: "offline_index_with_priority_article_extracts"',
  "---",
  "",
  "# MICE 지역 조례 오프라인 팩",
  "",
  "법제처 자치법규 API에서 행사 안전과 직접 연결되는 조례 인덱스를 수집해 로컬 온톨로지로 저장했다. LAW_OC 값은 저장하지 않는다.",
  "",
  "## 범주별 수집 현황",
  "",
  ...pack.categories.map((category) => `- ${category.label}: 검색 ${category.totalSearchHits}건, 필터 후 ${category.matchedRecords}건`),
  "",
  "## 공통 조문 패턴",
  "",
  ...pack.articlePatterns.flatMap((pattern) => [
    `### ${pattern.categoryId}`,
    `- 조문 주제: ${pattern.commonArticleThemes.join(", ")}`,
    `- MICE 의무 매핑: ${pattern.miceDutyMapping.join(", ")}`,
    "",
  ]),
  "## 우선 지자체 조문 발췌",
  "",
  ...enrichedRecords.filter((record) => record.structuredStatus === "article_extracted").flatMap((record) => [
    `### ${record.jurisdiction} - ${record.name}`,
    `- 범주: ${record.categoryLabel}`,
    `- 시행일: ${record.effectiveAt || "확인 필요"}`,
    `- 적용: ${record.appliesWhen}`,
    `- 인원/조건: ${record.crowdThreshold}`,
    `- 제출기한: ${record.submissionDeadline}`,
    `- 필요 항목: ${record.requiredPlanItems.join(", ")}`,
    `- 점검: ${record.inspectionRules.join(", ")}`,
    `- 관계기관: ${record.agencyCoordination.join(", ")}`,
    `- 원문: ${record.sourceUrl}`,
    ...(record.articleExtracts ?? []).slice(0, 8).map((article) => `- ${article.title || article.article}: ${article.textExcerpt}`),
    "",
  ]),
];
writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8");

console.log(`wrote ${jsonPath}`);
console.log(`wrote ${mdPath}`);
console.log(`records=${enrichedRecords.length}, priorityArticleRecords=${priorityRecords.length}`);
