import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

function limit(items, count) {
  return Array.isArray(items) ? items.slice(0, count) : [];
}

function groupTopEntries(entries = []) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.category)) groups.set(entry.category, []);
    const bucket = groups.get(entry.category);
    if (bucket.length < 2) {
      bucket.push({
        category: entry.category,
        value: entry.value,
        sourceRef: entry.sourceRef,
        confidence: entry.confidence,
      });
    }
  }
  return Object.fromEntries(groups);
}

const sourceRegistry = readJson("src/ontology/mice/source-registry.json");
const venueRules = readJson("src/ontology/mice/venue-safety-rules.json");
const venueFacilities = readJson("src/ontology/mice/venue-facility-index.json");
const packageJson = readJson("package.json");

const sourceById = new Map(sourceRegistry.sources.map((source) => [source.id, source]));
const facilityByVenueId = new Map(venueFacilities.venues.map((venue) => [venue.venueId, venue]));

const output = {
  version: packageJson.version,
  versionType: "public_safe_summary",
  sourceOntologyVersion: venueRules.version,
  generatedAt: new Date().toISOString(),
  distributionPolicy: {
    publicPackage: "structured summaries and checklist facts only",
    internalCorpus: "full extracted venue Markdown remains in data/markdown/venue-manuals for local validation and is not included in npm package",
    useRestriction: "venue rules are operational draft support; confirm current requirements with the venue before submission or construction",
  },
  venues: venueRules.venues.map((venue) => {
    const facility = facilityByVenueId.get(venue.id);
    const sources = venue.sourceRefs.map((sourceRef) => {
      const source = sourceById.get(sourceRef);
      return {
        id: sourceRef,
        title: source?.title ?? sourceRef,
        publisher: source?.publisher,
        url: source?.url,
        verificationStatus: source?.verificationStatus ?? "source_verified",
        offlineTextStatus: source?.offlineTextStatus,
        currentAsOf: source?.currentAsOf,
        reviewBy: source?.reviewBy,
        freshnessStatus: source?.freshnessStatus,
        linkVerificationStatus: source?.linkVerification?.status,
        linkCheckedAt: source?.linkVerification?.checkedAt,
        linkHttpStatus: source?.linkVerification?.httpStatus,
        releasePolicy: "summary_only",
        reuseCaution: source?.reuseCaution ?? "원문 복제보다 링크와 체크포인트 요약 사용",
      };
    });

    return {
      venueId: venue.id,
      name: venue.name,
      region: venue.region,
      operator: venue.operator,
      website: venue.website,
      verificationStatus: venue.safetyProfile?.gaps?.length ? "needs_review" : "source_verified",
      lastReviewedAt: venue.safetyProfile?.lastReviewedAt,
      reviewBy: venue.safetyProfile?.reviewBy,
      freshnessStatus: venue.safetyProfile?.freshnessStatus,
      officialSourceVerification: venue.safetyProfile?.officialSourceVerification,
      sources,
      spaces: limit(venue.spaces, 5).map((space) => ({
        id: space.id,
        name: space.name,
        facts: limit(space.facts, 5),
        sourceUrl: space.sourceUrl,
      })),
      facilitySummary: {
        categoryCounts: facility?.categoryCounts ?? {},
        representativeEntries: groupTopEntries(facility?.entries),
      },
      safetyRules: limit(venue.rules, 12).map((rule) => ({
        id: rule.id,
        category: rule.category,
        summary: rule.summary,
        checkpoints: limit(rule.checkpoints, 8),
        sourceRefs: rule.sourceRefs,
        verificationStatus: rule.verificationStatus,
      })),
      reviewNotice: "베뉴 운영규정·작업 매뉴얼은 최신 개정 여부와 행사별 승인 조건을 베뉴 담당자에게 확인해야 한다.",
    };
  }),
};

const jsonPath = join(root, "data/public/venue-safety-summaries.json");
const mdPath = join(root, "data/markdown/public/venue-safety-summaries.md");
mkdirSync(dirname(jsonPath), { recursive: true });
mkdirSync(dirname(mdPath), { recursive: true });
writeFileSync(jsonPath, `${JSON.stringify(output, null, 2)}\n`);

const lines = [
  "# Public Venue Safety Summaries",
  "",
  "이 파일은 공개 패키지에 포함할 수 있는 베뉴 안전 요약본이다. 원본 PDF/HWP 및 full extracted Markdown은 내부 검증 코퍼스로만 유지하며 npm package에 포함하지 않는다.",
  "",
  `Generated at: ${output.generatedAt}`,
  "",
];

for (const venue of output.venues) {
  lines.push(`## ${venue.name} (${venue.venueId})`);
  lines.push("");
  lines.push(`- Region: ${venue.region ?? "unknown"}`);
  lines.push(`- Verification: ${venue.verificationStatus}`);
  if (venue.lastReviewedAt) lines.push(`- Last reviewed: ${venue.lastReviewedAt}`);
  if (venue.reviewBy) lines.push(`- Review by: ${venue.reviewBy}`);
  if (venue.freshnessStatus) lines.push(`- Freshness: ${venue.freshnessStatus}`);
  if (venue.officialSourceVerification) {
    lines.push(`- Official source links: ${venue.officialSourceVerification.reachableSourceRefs}/${venue.officialSourceVerification.sourceRefs} reachable, checked ${venue.officialSourceVerification.checkedAt}`);
  }
  lines.push("- Sources:");
  for (const source of venue.sources) {
    const freshness = [
      source.currentAsOf ? `currentAsOf=${source.currentAsOf}` : "",
      source.reviewBy ? `reviewBy=${source.reviewBy}` : "",
      source.freshnessStatus ? `freshness=${source.freshnessStatus}` : "",
      source.linkVerificationStatus ? `link=${source.linkVerificationStatus}/${source.linkHttpStatus ?? ""}` : "",
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(`  - ${source.id}: ${source.title}${source.url ? ` (${source.url})` : ""}${freshness ? ` [${freshness}]` : ""}`);
  }
  if (venue.spaces.length) {
    lines.push("- Spaces:");
    for (const space of venue.spaces) {
      lines.push(`  - ${space.name}: ${space.facts.join("; ")}`);
    }
  }
  lines.push("- Safety checkpoints:");
  for (const rule of venue.safetyRules) {
    lines.push(`  - ${rule.category}: ${rule.summary}`);
    for (const checkpoint of limit(rule.checkpoints, 3)) {
      lines.push(`    - ${checkpoint}`);
    }
  }
  lines.push(`- Review notice: ${venue.reviewNotice}`);
  lines.push("");
}

writeFileSync(mdPath, `${lines.join("\n")}\n`);
console.log(`wrote ${jsonPath}`);
console.log(`wrote ${mdPath}`);
