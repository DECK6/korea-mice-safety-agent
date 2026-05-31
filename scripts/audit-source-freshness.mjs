#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const today = new Date().toISOString().slice(0, 10);

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

function isFresh(reviewBy) {
  if (reviewBy === "event-day live only") return true;
  return isDate(reviewBy) && reviewBy >= today;
}

const failures = [];
const warnings = [];

const sourceRegistry = readJson("src/ontology/mice/source-registry.json");
for (const source of sourceRegistry.sources ?? []) {
  for (const field of ["currentAsOf", "reviewBy", "freshnessStatus"]) {
    if (!source[field]) failures.push(`source:${source.id}:missing_${field}`);
  }
  if (!isFresh(source.reviewBy)) failures.push(`source:${source.id}:reviewBy_stale:${source.reviewBy}`);
  if (source.freshnessStatus === "live_only" && source.reviewBy !== "event-day live only") {
    failures.push(`source:${source.id}:live_only_reviewBy_mismatch`);
  }
}

const ordinancePack = readJson("src/ontology/mice/local-ordinance-pack.json");
const ordinanceStatusCounts = {};
for (const record of ordinancePack.records ?? []) {
  ordinanceStatusCounts[record.verificationStatus] = (ordinanceStatusCounts[record.verificationStatus] ?? 0) + 1;
  for (const field of ["currentAsOf", "reviewBy", "freshnessStatus"]) {
    if (!record[field]) failures.push(`ordinance:${record.id}:missing_${field}`);
  }
  if (!isFresh(record.reviewBy)) failures.push(`ordinance:${record.id}:reviewBy_stale:${record.reviewBy}`);
}
if ((ordinanceStatusCounts.article_verified ?? 0) < 100) {
  failures.push(`ordinance_article_verified_below_90_gate:${ordinanceStatusCounts.article_verified ?? 0}<100`);
}
if ((ordinanceStatusCounts.article_verified ?? 0) < 750) {
  failures.push(`ordinance_article_verified_below_95_gate:${ordinanceStatusCounts.article_verified ?? 0}<750`);
}
if ((ordinancePack.priorityArticleVerification?.verifiedRecords ?? 0) < 35) {
  failures.push(`priority_article_verification_below_90_gate:${ordinancePack.priorityArticleVerification?.verifiedRecords ?? 0}<35`);
}
if ((ordinancePack.priorityArticleVerification?.verifiedRecords ?? 0) < 750) {
  failures.push(`priority_article_verification_below_95_gate:${ordinancePack.priorityArticleVerification?.verifiedRecords ?? 0}<750`);
}
if ((ordinancePack.articleVerificationSummary?.totalArticleVerified ?? 0) < 750) {
  failures.push(`article_verification_summary_below_95_gate:${ordinancePack.articleVerificationSummary?.totalArticleVerified ?? 0}<750`);
}
if ((ordinancePack.articleVerificationSummary?.failedRecords ?? 0) > 0) {
  failures.push(`article_verification_summary_failed_records:${ordinancePack.articleVerificationSummary.failedRecords}`);
}
if ((ordinanceStatusCounts.needs_review ?? 0) > 0) {
  warnings.push(`ordinance_needs_review_remaining:${ordinanceStatusCounts.needs_review}`);
}

const venueRules = readJson("src/ontology/mice/venue-safety-rules.json");
const sourceById = new Map((sourceRegistry.sources ?? []).map((source) => [source.id, source]));
const venueSourceRefs = new Set();
for (const venue of venueRules.venues ?? []) {
  const profile = venue.safetyProfile ?? {};
  for (const field of ["lastReviewedAt", "reviewBy", "freshnessStatus"]) {
    if (!profile[field]) failures.push(`venue:${venue.id}:missing_${field}`);
  }
  if (!isFresh(profile.reviewBy)) failures.push(`venue:${venue.id}:reviewBy_stale:${profile.reviewBy}`);
  const verification = profile.officialSourceVerification;
  if (!verification) {
    failures.push(`venue:${venue.id}:missing_officialSourceVerification`);
  } else {
    if (verification.sourceRefs !== (venue.sourceRefs?.length ?? 0)) failures.push(`venue:${venue.id}:officialSourceVerification_source_count_mismatch`);
    if ((verification.manualReviewSourceRefs?.length ?? 0) > 0) failures.push(`venue:${venue.id}:officialSourceVerification_manual_review:${verification.manualReviewSourceRefs.join(",")}`);
    if (verification.reachableSourceRefs !== verification.sourceRefs) failures.push(`venue:${venue.id}:officialSourceVerification_not_all_reachable`);
  }
  for (const sourceRef of venue.sourceRefs ?? []) venueSourceRefs.add(sourceRef);
}
for (const sourceRef of venueSourceRefs) {
  const source = sourceById.get(sourceRef);
  if (!source) {
    failures.push(`venue_source:${sourceRef}:missing_source_registry`);
    continue;
  }
  if (source.linkVerification?.status !== "reachable") {
    failures.push(`venue_source:${sourceRef}:link_not_reachable:${source.linkVerification?.status ?? "missing"}`);
  }
  if (!source.linkVerification?.checkedAt) failures.push(`venue_source:${sourceRef}:missing_link_checkedAt`);
}

const legalArticles = readJson("src/ontology/mice/legal-article-ontology.json");
if (!legalArticles.freshnessPolicy?.reviewBy || !isFresh(legalArticles.freshnessPolicy.reviewBy)) {
  failures.push("legal_article_ontology:freshnessPolicy_reviewBy_missing_or_stale");
}

const summary = {
  checkedAt: today,
  sources: sourceRegistry.sources?.length ?? 0,
  ordinances: ordinancePack.records?.length ?? 0,
  ordinanceStatusCounts,
  priorityArticleVerification: ordinancePack.priorityArticleVerification,
  articleVerificationSummary: ordinancePack.articleVerificationSummary,
  venues: venueRules.venues?.length ?? 0,
  venueSourceRefs: venueSourceRefs.size,
  warnings,
  failures,
};

if (failures.length > 0) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));
