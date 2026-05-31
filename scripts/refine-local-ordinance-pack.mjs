#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packPath = join(root, "src/ontology/mice/local-ordinance-pack.json");
const DEFAULT_OUTDOOR_THRESHOLD = "다수 조례에서 순간 최대 500명 이상 또는 500명 이상 1,000명 미만 옥외행사를 별도 관리하고, 1,000명 이상은 재난안전법/공연법 연계를 요구";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(items) {
  return Array.from(new Set(items.map((item) => cleanText(item)).filter(Boolean)));
}

function numberFromKoreanCount(value) {
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function thresholdTextLooksBroken(value) {
  const text = cleanText(value);
  if (!text) return false;
  const slashCount = (text.match(/\//g) ?? []).length;
  return text.length > 500
    || /조제\d/.test(text)
    || /최\s*\//.test(text)
    || /\/\s*장/.test(text)
    || /(?<![,\d])0명\s*미만/.test(text)
    || slashCount >= 4;
}

function articleText(record) {
  return (record.articleExtracts ?? [])
    .map((article) => `${article.article ?? ""} ${article.title ?? ""} ${article.textExcerpt ?? ""}`)
    .join(" ");
}

function sourceArticles(record) {
  return unique((record.articleExtracts ?? [])
    .map((article) => article.article || article.title)
    .filter(Boolean));
}

function extractCrowdSignals(text) {
  const normalized = cleanText(text);
  const rawPhrases = [];
  let minCrowd = null;
  let maxCrowdExclusive = null;
  let maxCrowdInclusive = null;
  for (const match of normalized.matchAll(/(\d{1,3}(?:,\d{3})?|\d{3,5})\s*명\s*(이상|미만|초과|이하)?/g)) {
    const value = numberFromKoreanCount(match[1]);
    if (value === null) continue;
    const operator = match[2] ?? "";
    rawPhrases.push(match[0]);
    if (operator === "이상") minCrowd = minCrowd === null ? value : Math.min(minCrowd, value);
    if (operator === "초과") minCrowd = minCrowd === null ? value + 1 : Math.min(minCrowd, value + 1);
    if (operator === "미만") maxCrowdExclusive = maxCrowdExclusive === null ? value : Math.max(maxCrowdExclusive, value);
    if (operator === "이하") maxCrowdInclusive = maxCrowdInclusive === null ? value : Math.max(maxCrowdInclusive, value);
  }
  const density = normalized.match(/(?:단위면적당|1\s*제곱미터당|㎡당)\s*(\d+(?:\.\d+)?)\s*명/);
  const eventKinds = [
    /공연장\s*외|실내공연장\s*외/.test(normalized) ? "performance_outside_registered_venue" : undefined,
    /축제/.test(normalized) ? "festival" : undefined,
    /체육/.test(normalized) ? "sports_event" : undefined,
    /전시|박람/.test(normalized) ? "exhibition_like_event" : undefined,
    /주최자|주관자/.test(normalized) ? "hosted_or_unhosted_condition" : undefined,
    /자발|불분명|없으나/.test(normalized) ? "unhosted_crowd" : undefined,
  ].filter(Boolean);
  return {
    minCrowd,
    maxCrowdExclusive,
    maxCrowdInclusive,
    densityLimitPersonsPerSqm: density ? Number(density[1]) : null,
    eventKinds: unique(eventKinds),
    rawPhrases: unique(rawPhrases).slice(0, 8),
  };
}

function categoryThreshold(record, defaults) {
  const category = record.categoryId ?? record.category;
  if (category === "road_occupancy") {
    return {
      kind: "road_occupancy_condition",
      summary: "인원 기준이 아니라 도로관리청 허가 대상 시설, 점용 면적, 점용 기간, 교통 영향, 원상복구 조건으로 판단",
      basis: "road_manager_permit_condition",
      confidence: "condition_based",
      sourceArticles: sourceArticles(record),
      rawPhrases: [],
    };
  }
  if (category === "outdoor_advertising") {
    return {
      kind: "outdoor_advertising_condition",
      summary: "인원 기준이 아니라 현수막·배너·안내판·애드벌룬·전광류의 종류, 크기, 위치, 게시기간, 전기 사용, 보행·피난 방해 여부로 판단",
      basis: "advertising_type_installation_condition",
      confidence: "condition_based",
      sourceArticles: sourceArticles(record),
      rawPhrases: [],
    };
  }
  if (category === "regional_festival_safety") {
    return {
      kind: "regional_festival_safety_condition",
      summary: "지역축제 안전관리계획 대상 여부는 행사 성격, 주최·주관, 예상 인원, 장소, 지자체 지침과 재난안전법 기준을 함께 확인",
      basis: "festival_safety_plan_condition",
      confidence: sourceArticles(record).length > 0 ? "article_structured" : "category_default",
      sourceArticles: sourceArticles(record),
      rawPhrases: [],
    };
  }
  return {
    kind: "crowd_threshold",
    summary: defaults.crowdThreshold ?? DEFAULT_OUTDOOR_THRESHOLD,
    minCrowd: 500,
    maxCrowdExclusive: null,
    maxCrowdInclusive: null,
    eventKinds: ["outdoor_event"],
    basis: "category_default",
    confidence: "category_default",
    sourceArticles: sourceArticles(record),
    rawPhrases: [],
  };
}

function structuredThreshold(record) {
  const text = articleText(record);
  const defaults = categoryThreshold(record, {});
  const broken = thresholdTextLooksBroken(record.crowdThreshold) || thresholdTextLooksBroken(record.threshold);
  if (!text || !["outdoor_event_safety"].includes(String(record.categoryId ?? record.category))) {
    return {
      thresholdStructured: defaults,
      crowdThreshold: defaults.summary,
      threshold: defaults.summary,
      broken,
    };
  }

  const signals = extractCrowdSignals(text);
  const minLabel = signals.minCrowd !== null ? `${signals.minCrowd.toLocaleString("ko-KR")}명 이상` : "인원 기준 원문 확인";
  const maxLabel = signals.maxCrowdExclusive !== null
    ? ` ${signals.maxCrowdExclusive.toLocaleString("ko-KR")}명 미만`
    : signals.maxCrowdInclusive !== null
      ? ` ${signals.maxCrowdInclusive.toLocaleString("ko-KR")}명 이하`
      : "";
  const densityLabel = signals.densityLimitPersonsPerSqm
    ? `, 밀집도 ${signals.densityLimitPersonsPerSqm}명/㎡ 기준 후보`
    : "";
  const summary = `${minLabel}${maxLabel} 옥외행사${densityLabel}. 공연장 외 공연, 축제, 체육행사, 무주최 다중운집 등 세부 적용유형은 조례 원문으로 확인`;

  return {
    thresholdStructured: {
      kind: "crowd_threshold",
      summary,
      minCrowd: signals.minCrowd,
      maxCrowdExclusive: signals.maxCrowdExclusive,
      maxCrowdInclusive: signals.maxCrowdInclusive,
      densityLimitPersonsPerSqm: signals.densityLimitPersonsPerSqm,
      eventKinds: signals.eventKinds.length > 0 ? signals.eventKinds : ["outdoor_event"],
      basis: broken ? "article_signal_from_broken_extract" : "article_signal",
      confidence: broken ? "needs_review" : "article_structured",
      sourceArticles: sourceArticles(record),
      rawPhrases: signals.rawPhrases,
      reviewNotes: broken
        ? ["이전 crowdThreshold 문자열이 중복·절단되어 있었으므로 원문 조문 재확인이 필요하다."]
        : [],
    },
    crowdThreshold: summary,
    threshold: summary,
    broken,
  };
}

function refineRecord(record) {
  const { thresholdStructured, crowdThreshold, threshold, broken } = structuredThreshold(record);
  const hasArticles = (record.articleExtracts ?? []).length > 0;
  const verificationStatus = broken
    ? "needs_review"
    : hasArticles
      ? "article_verified"
      : "source_verified";
  return {
    ...record,
    crowdThreshold,
    threshold,
    thresholdStructured,
    verificationStatus,
    sourceConfidence: broken
      ? "official_law_go_offline_snapshot_threshold_needs_review"
      : record.sourceConfidence ?? "official_law_go_offline_snapshot",
    verificationChecks: {
      source: "law_go_ordinance_snapshot",
      articles: hasArticles ? "article_extract_present" : "search_result_only",
      threshold: thresholdStructured.confidence,
      actionMapping: "category_rule_inferred",
    },
  };
}

const pack = JSON.parse(readFileSync(packPath, "utf8"));
const before = pack.records ?? [];
pack.records = before.map(refineRecord);
pack.qualityPolicy = {
  verificationStatusMeaning: {
    source_verified: "공식 자치법규 검색 결과와 메타데이터를 확인했지만 조문·threshold 세부 구조화는 기본값 또는 후속 확인 대상",
    article_verified: "조문 발췌를 바탕으로 적용조건·제출기한·threshold 후보를 구조화",
    needs_review: "오프라인 조문 추출 또는 threshold 신호에 중복·절단·모호성이 있어 원문 재확인 필요",
  },
  thresholdStructuredRequired: true,
  generatedBy: "scripts/refine-local-ordinance-pack.mjs",
};
pack.refinedAt = new Date().toISOString().slice(0, 10);
writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`);

const counts = pack.records.reduce((acc, record) => {
  acc[record.verificationStatus] = (acc[record.verificationStatus] ?? 0) + 1;
  const confidence = record.thresholdStructured?.confidence ?? "missing";
  acc[`threshold:${confidence}`] = (acc[`threshold:${confidence}`] ?? 0) + 1;
  return acc;
}, {});

const categoryLabels = Object.fromEntries((pack.categories ?? []).map((category) => [category.categoryId, category.label]));
const categoryCounts = pack.records.reduce((acc, record) => {
  const category = record.categoryId ?? record.category;
  acc[category] ??= { total: 0, article_verified: 0, source_verified: 0, needs_review: 0 };
  acc[category].total += 1;
  acc[category][record.verificationStatus] = (acc[category][record.verificationStatus] ?? 0) + 1;
  return acc;
}, {});

const mdPath = join(root, "data/markdown/legal/local-ordinance-pack.md");
mkdirSync(dirname(mdPath), { recursive: true });
const mdLines = [
  "---",
  'title: "MICE 지역 조례 오프라인 팩"',
  `generatedAt: "${pack.refinedAt}"`,
  'status: "offline_article_verified_pack"',
  "---",
  "",
  "# MICE 지역 조례 오프라인 팩",
  "",
  "법제처 자치법규 공식 HTML에서 행사 안전과 직접 연결되는 조례 조문 발췌를 수집해 로컬 온톨로지로 저장했다. LAW_OC 값은 저장하지 않는다.",
  "",
  "## 검증 요약",
  "",
  `- 전체 조례: ${pack.records.length}건`,
  `- article_verified: ${counts.article_verified ?? 0}건`,
  `- source_verified: ${counts.source_verified ?? 0}건`,
  `- needs_review: ${counts.needs_review ?? 0}건`,
  `- article verification coverage: ${pack.articleVerificationSummary?.coveragePct ?? ""}%`,
  `- verification method: ${pack.articleVerificationSummary?.method ?? "law.go.kr official HTML snapshot"}`,
  "",
  "## 범주별 현황",
  "",
  ...Object.entries(categoryCounts).map(([category, value]) => `- ${categoryLabels[category] ?? category}: ${value.total}건, article_verified ${value.article_verified ?? 0}건`),
  "",
  "## 공통 조문 패턴",
  "",
  ...(pack.articlePatterns ?? []).flatMap((pattern) => [
    `### ${pattern.categoryId}`,
    `- 조문 주제: ${pattern.commonArticleThemes.join(", ")}`,
    `- MICE 의무 매핑: ${pattern.miceDutyMapping.join(", ")}`,
    "",
  ]),
  "## 조례별 핵심 발췌",
  "",
  ...pack.records.flatMap((record) => [
    `### ${record.jurisdiction} - ${record.ordinanceName ?? record.name}`,
    `- 범주: ${record.categoryLabel ?? categoryLabels[record.categoryId] ?? record.categoryId}`,
    `- 시행일: ${record.effectiveAt || "확인 필요"}`,
    `- 검증: ${record.verificationStatus}`,
    `- 적용: ${record.appliesWhen}`,
    `- 인원/조건: ${record.threshold ?? record.crowdThreshold}`,
    `- 제출기한: ${record.submissionDeadline}`,
    `- 필요 항목: ${(record.requiredPlanItems ?? []).join(", ")}`,
    `- 점검: ${(record.inspectionRules ?? []).join(", ")}`,
    `- 관계기관: ${(record.agencyCoordination ?? []).join(", ")}`,
    `- 원문: ${record.sourceUrl}`,
    ...(record.articleExtracts ?? []).slice(0, 3).map((article) => `- ${cleanText(article.title || article.article)}: ${cleanText(article.textExcerpt)}`),
    "",
  ]),
];
writeFileSync(mdPath, `${mdLines.join("\n")}\n`, "utf8");
console.log(JSON.stringify({ records: pack.records.length, counts }, null, 2));
