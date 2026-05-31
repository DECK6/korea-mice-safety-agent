#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const today = new Date().toISOString().slice(0, 10);
const defaultReviewBy = "2026-08-31";
const eventDayReviewBy = "event-day live only";

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

function writeJson(relativePath, data) {
  writeFileSync(join(root, relativePath), `${JSON.stringify(data, null, 2)}\n`);
}

function sourceReviewBy(source) {
  if (source.offlineTextStatus === "live_snapshot_only" || source.currentAsOf === "event-day live only") return eventDayReviewBy;
  if (source.documentFormat === "api") return "2026-06-30";
  if (source.documentFormat === "pdf" || source.documentFormat === "hwp") return defaultReviewBy;
  return defaultReviewBy;
}

const sourceRegistry = readJson("src/ontology/mice/source-registry.json");
sourceRegistry.freshnessPolicy = {
  appliedAt: today,
  defaultReviewBy,
  meaning: {
    currentAsOf: "로컬 온톨로지 또는 sanitized snapshot이 마지막으로 출처 상태를 확인한 날짜",
    reviewBy: "이 날짜 이후에는 최신 원문/공식 API/베뉴 담당자 재확인을 요구",
    freshnessStatus: "current, live_only, review_due, stale_review_required 중 하나",
  },
};
sourceRegistry.sources = sourceRegistry.sources.map((source) => {
  const reviewBy = source.reviewBy ?? sourceReviewBy(source);
  return {
    ...source,
    currentAsOf: source.currentAsOf ?? source.liveProbeAt?.slice(0, 10) ?? today,
    reviewBy,
    freshnessStatus: reviewBy === eventDayReviewBy ? "live_only" : "current",
  };
});
writeJson("src/ontology/mice/source-registry.json", sourceRegistry);

const ordinancePack = readJson("src/ontology/mice/local-ordinance-pack.json");
ordinancePack.freshnessPolicy = {
  appliedAt: today,
  currentAsOf: ordinancePack.refinedAt ?? ordinancePack.generatedAt ?? today,
  reviewBy: defaultReviewBy,
  note: "자치법규는 시행일과 조문 개정 가능성이 있으므로 실제 제출 전 law.go.kr 원문과 관할 담당자 회신으로 재확인한다.",
};
ordinancePack.records = ordinancePack.records.map((record) => ({
  ...record,
  currentAsOf: record.currentAsOf ?? ordinancePack.freshnessPolicy.currentAsOf,
  reviewBy: record.reviewBy ?? defaultReviewBy,
  freshnessStatus: record.freshnessStatus ?? "current",
}));
writeJson("src/ontology/mice/local-ordinance-pack.json", ordinancePack);

const venueRules = readJson("src/ontology/mice/venue-safety-rules.json");
venueRules.freshnessPolicy = {
  appliedAt: today,
  defaultReviewBy,
  note: "베뉴 규정·시설 수치는 행사 신청 전 최신 운영규정, 도면, 베뉴 담당자 확인으로 보정한다.",
};
venueRules.venues = venueRules.venues.map((venue) => ({
  ...venue,
  safetyProfile: {
    ...(venue.safetyProfile ?? {}),
    lastReviewedAt: venue.safetyProfile?.lastReviewedAt ?? today,
    reviewBy: venue.safetyProfile?.reviewBy ?? defaultReviewBy,
    freshnessStatus: venue.safetyProfile?.freshnessStatus ?? "current",
  },
}));
writeJson("src/ontology/mice/venue-safety-rules.json", venueRules);

const legalArticleOntology = readJson("src/ontology/mice/legal-article-ontology.json");
legalArticleOntology.freshnessPolicy = legalArticleOntology.freshnessPolicy ?? {
  appliedAt: today,
  currentAsOf: legalArticleOntology.generatedAt ?? today,
  reviewBy: defaultReviewBy,
  note: "법령 조문 요약은 제출 전 최신 시행 법령 원문으로 재확인한다.",
};
writeJson("src/ontology/mice/legal-article-ontology.json", legalArticleOntology);

console.log(JSON.stringify({
  appliedAt: today,
  sources: sourceRegistry.sources.length,
  ordinances: ordinancePack.records.length,
  venues: venueRules.venues.length,
}, null, 2));
