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
if ((ordinancePack.priorityArticleVerification?.verifiedRecords ?? 0) < 35) {
  failures.push(`priority_article_verification_below_90_gate:${ordinancePack.priorityArticleVerification?.verifiedRecords ?? 0}<35`);
}
if ((ordinanceStatusCounts.needs_review ?? 0) > 0) {
  warnings.push(`ordinance_needs_review_remaining:${ordinanceStatusCounts.needs_review}`);
}

const venueRules = readJson("src/ontology/mice/venue-safety-rules.json");
for (const venue of venueRules.venues ?? []) {
  const profile = venue.safetyProfile ?? {};
  for (const field of ["lastReviewedAt", "reviewBy", "freshnessStatus"]) {
    if (!profile[field]) failures.push(`venue:${venue.id}:missing_${field}`);
  }
  if (!isFresh(profile.reviewBy)) failures.push(`venue:${venue.id}:reviewBy_stale:${profile.reviewBy}`);
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
  venues: venueRules.venues?.length ?? 0,
  warnings,
  failures,
};

if (failures.length > 0) {
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(summary, null, 2));
