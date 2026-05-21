#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const manifestPath = join(root, "data/venue-pdf-manifest.json");
const markdownIndexPath = join(root, "data/markdown/venue-manuals/index.json");
const sourceRegistryPath = join(root, "src/ontology/mice/source-registry.json");
const venueRulesPath = join(root, "src/ontology/mice/venue-safety-rules.json");
const facilityIndexPath = join(root, "src/ontology/mice/venue-facility-index.json");
const outputJsonPath = join(root, "data/venue-corpus-audit-report.json");
const outputMdPath = join(root, "docs/VENUE_CORPUS_AUDIT.md");

const SAFETY_KEYWORDS = [
  "안전",
  "소방",
  "비상구",
  "피난",
  "대피",
  "소화전",
  "전기",
  "하역",
  "반입",
  "반출",
  "부스",
  "철거",
  "위험물",
  "가스",
  "LPG",
  "하중",
  "작업",
  "보호구",
];

const REQUIRED_MANIFEST_FIELDS = ["id", "venueId", "sourceId", "title", "url", "filename"];
const FACILITY_CATEGORIES = [
  "capacity",
  "electricity",
  "fireLane",
  "evacuationRoutes",
  "boothRules",
  "safetyDocuments",
];
const CORE_EXCLUSION_PATTERNS = [/모집/, /공고/, /선발/, /업체\s*모집/, /등록업체\s*모집/];
const MIN_EXTRACT_CHARS = 1500;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function relative(path) {
  return path.replace(`${root}/`, "");
}

function fileBytes(path) {
  return existsSync(path) ? readFileSync(path).length : 0;
}

function isValidDocument(path, format) {
  if (!existsSync(path)) return false;
  const buf = readFileSync(path);
  if (format === "hwp") return buf.includes(Buffer.from("HWP Document File", "utf8"));
  return buf.subarray(0, 4).toString("utf8") === "%PDF";
}

function markdownBodyChars(markdown) {
  const body = markdown.split("## Extracted Text").slice(1).join("## Extracted Text");
  return (body || markdown).replace(/^---[\s\S]*?---/, "").trim().length;
}

function keywordHits(text) {
  return SAFETY_KEYWORDS.filter((keyword) => text.includes(keyword));
}

function addFinding(findings, severity, category, id, message) {
  findings.push({ severity, category, id, message });
}

const manifest = readJson(manifestPath);
const markdownIndex = readJson(markdownIndexPath);
const sourceRegistry = readJson(sourceRegistryPath);
const venueRules = readJson(venueRulesPath);
const facilityIndex = readJson(facilityIndexPath);

const findings = [];
const markdownIndexById = new Map((markdownIndex.items ?? []).map((item) => [item.id, item]));
const sourceById = new Map(sourceRegistry.sources.map((source) => [source.id, source]));
const facilityByVenue = new Map(facilityIndex.venues.map((venue) => [venue.venueId, venue]));
const venueById = new Map(venueRules.venues.map((venue) => [venue.id, venue]));

const manifestRows = [];
for (const item of manifest.items ?? []) {
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!item[field]) {
      addFinding(findings, "error", "manifest_schema", item.id ?? item.filename ?? "unknown", `missing field: ${field}`);
    }
  }

  const format = item.format ?? "pdf";
  const rawDir = format === "hwp" ? "data/raw/venue-hwp" : "data/raw/venue-pdfs";
  const documentPath = join(root, rawDir, item.filename);
  const indexItem = markdownIndexById.get(item.id);
  const markdownPath = indexItem?.markdown ? join(root, indexItem.markdown) : join(root, "data/markdown/venue-manuals", `${item.filename.replace(/\.[^.]+$/, "")}.md`);
  const source = sourceById.get(item.sourceId);
  const text = existsSync(markdownPath) ? readFileSync(markdownPath, "utf8") : "";
  const chars = markdownBodyChars(text);
  const hits = keywordHits(text);
  const rawBytes = fileBytes(documentPath);

  if (!existsSync(documentPath)) addFinding(findings, "error", "raw_document", item.id, `missing raw document: ${relative(documentPath)}`);
  if (existsSync(documentPath) && !isValidDocument(documentPath, format)) {
    addFinding(findings, "error", "raw_document", item.id, `invalid ${format} header: ${relative(documentPath)}`);
  }
  if (!existsSync(markdownPath)) addFinding(findings, "error", "markdown_extract", item.id, `missing markdown extract: ${relative(markdownPath)}`);
  if (existsSync(markdownPath) && chars < MIN_EXTRACT_CHARS) {
    addFinding(findings, "warning", "markdown_extract", item.id, `short markdown extract: ${chars} chars`);
  }
  if (existsSync(markdownPath) && /pdftotext failed|hwp5txt failed|_No extractable text/i.test(text)) {
    addFinding(findings, "warning", "markdown_extract", item.id, "extract contains converter failure marker or no-text marker");
  }
  if (existsSync(markdownPath) && hits.length < 2) {
    addFinding(findings, "warning", "safety_signal", item.id, `low safety keyword coverage: ${hits.join(", ") || "none"}`);
  }
  if (!source) {
    addFinding(findings, "error", "source_registry", item.id, `sourceId not found in source-registry: ${item.sourceId}`);
  } else {
    if (source.localDocumentPath && source.localDocumentPath !== relative(documentPath)) {
      addFinding(findings, "warning", "source_registry", item.id, `source localDocumentPath differs: ${source.localDocumentPath} vs ${relative(documentPath)}`);
    }
    if (source.localMarkdownPath && source.localMarkdownPath !== relative(markdownPath)) {
      addFinding(findings, "warning", "source_registry", item.id, `source localMarkdownPath differs: ${source.localMarkdownPath} vs ${relative(markdownPath)}`);
    }
    if (!["extracted", "offline_derived"].includes(source.offlineTextStatus ?? "")) {
      addFinding(findings, "warning", "source_registry", item.id, `offlineTextStatus is not extracted/offline_derived: ${source.offlineTextStatus ?? "missing"}`);
    }
  }
  if (CORE_EXCLUSION_PATTERNS.some((pattern) => pattern.test(item.title))) {
    addFinding(findings, "error", "corpus_scope", item.id, "core venue corpus appears to include recruitment/selection notice material");
  }

  manifestRows.push({
    id: item.id,
    venueId: item.venueId,
    sourceId: item.sourceId,
    format,
    rawDocument: relative(documentPath),
    markdown: relative(markdownPath),
    rawBytes,
    chars,
    safetyKeywordHits: hits,
    sourceRegistered: Boolean(source),
  });
}

const sourceRefs = new Set();
for (const venue of venueRules.venues ?? []) {
  const facility = facilityByVenue.get(venue.id);
  if (!facility) {
    addFinding(findings, "error", "facility_index", venue.id, "venue missing in venue-facility-index");
    continue;
  }
  for (const sourceRef of venue.sourceRefs ?? []) {
    sourceRefs.add(sourceRef);
    if (!sourceById.has(sourceRef)) {
      addFinding(findings, "error", "venue_source_refs", venue.id, `sourceRef not found in source-registry: ${sourceRef}`);
    }
  }
  for (const category of FACILITY_CATEGORIES) {
    const count = facility.categoryCounts?.[category] ?? 0;
    const hasOfflineDocument = (venue.sourceRefs ?? []).some((sourceRef) => {
      const source = sourceById.get(sourceRef);
      return source?.localMarkdownPath || source?.offlineTextStatus === "offline_derived";
    });
    if (hasOfflineDocument && count === 0) {
      addFinding(findings, "warning", "facility_category_coverage", venue.id, `no ${category} entries in facility index`);
    }
  }
}

for (const source of sourceRegistry.sources) {
  if (source.documentFormat && source.localDocumentPath && !existsSync(join(root, source.localDocumentPath))) {
    addFinding(findings, "warning", "source_registry", source.id, `localDocumentPath does not exist: ${source.localDocumentPath}`);
  }
  if (source.localMarkdownPath && !existsSync(join(root, source.localMarkdownPath))) {
    addFinding(findings, "warning", "source_registry", source.id, `localMarkdownPath does not exist: ${source.localMarkdownPath}`);
  }
}

const venues = (venueRules.venues ?? []).map((venue) => {
  const facility = facilityByVenue.get(venue.id);
  const entries = facility?.entries ?? [];
  const sourceRefsWithMarkdown = (venue.sourceRefs ?? []).filter((sourceRef) => {
    const source = sourceById.get(sourceRef);
    return source?.localMarkdownPath || source?.offlineTextStatus === "offline_derived";
  });
  return {
    venueId: venue.id,
    name: venue.name,
    region: venue.region,
    sourceRefCount: venue.sourceRefs?.length ?? 0,
    offlineSourceRefCount: sourceRefsWithMarkdown.length,
    facilityEntryCount: entries.length,
    categoryCounts: facility?.categoryCounts ?? {},
    hasCoreRules: (venue.rules ?? []).length > 0,
  };
});

const counts = {
  manifestItems: manifest.items?.length ?? 0,
  markdownIndexItems: markdownIndex.items?.length ?? 0,
  sourceRegistrySources: sourceRegistry.sources?.length ?? 0,
  venues: venueRules.venues?.length ?? 0,
  facilityIndexedVenues: facilityIndex.venues?.length ?? 0,
  facilityEntries: facilityIndex.venues.reduce((sum, venue) => sum + (venue.entries?.length ?? 0), 0),
  errors: findings.filter((finding) => finding.severity === "error").length,
  warnings: findings.filter((finding) => finding.severity === "warning").length,
};

const report = {
  version: "1.0.0",
  generatedAt: new Date().toISOString(),
  policy:
    "Venue source documents stay offline as raw PDF/HWP plus Markdown extracts. The ontology stores compact operational facts and source spans; recruitment/selection notices are excluded from the core safety corpus.",
  thresholds: {
    minExtractChars: MIN_EXTRACT_CHARS,
    safetyKeywords: SAFETY_KEYWORDS,
    facilityCategories: FACILITY_CATEGORIES,
  },
  counts,
  manifestItems: manifestRows,
  venues,
  findings,
};

mkdirSync(dirname(outputJsonPath), { recursive: true });
mkdirSync(dirname(outputMdPath), { recursive: true });
writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`);

const markdown = [
  "# Venue Corpus Audit",
  "",
  report.policy,
  "",
  "## Counts",
  "",
  ...Object.entries(counts).map(([key, value]) => `- ${key}: ${value}`),
  "",
  "## Venue Coverage",
  "",
  "| Venue | Region | Sources | Offline sources | Facility entries | Core rules |",
  "| --- | --- | ---: | ---: | ---: | --- |",
  ...venues.map((venue) => `| ${venue.name} (${venue.venueId}) | ${venue.region} | ${venue.sourceRefCount} | ${venue.offlineSourceRefCount} | ${venue.facilityEntryCount} | ${venue.hasCoreRules ? "yes" : "no"} |`),
  "",
  "## Raw/Markdown Manifest",
  "",
  "| ID | Venue | Format | Raw bytes | Markdown chars | Safety hits |",
  "| --- | --- | --- | ---: | ---: | --- |",
  ...manifestRows.map((item) => `| ${item.id} | ${item.venueId} | ${item.format} | ${item.rawBytes} | ${item.chars} | ${item.safetyKeywordHits.slice(0, 8).join(", ")} |`),
  "",
  "## Findings",
  "",
  findings.length > 0
    ? findings.map((finding) => `- ${finding.severity.toUpperCase()} [${finding.category}] ${finding.id}: ${finding.message}`).join("\n")
    : "- No findings.",
  "",
  "## Notes",
  "",
  "- 원본 PDF/HWP는 로컬 연구·검증용으로 보관하고, 배포 산출물에는 요약 체크포인트와 출처 링크 중심으로 반영한다.",
  "- 이미지 기반 PDF나 짧은 추출본은 `offline_derived` 구조화 요약 또는 직접 OCR/시각 판독으로 보강해야 한다.",
  "- 지정등록업체 모집, 등록업체 선발 공고 등 공고성 문서는 core safety corpus에 넣지 않는다.",
].join("\n");

writeFileSync(outputMdPath, `${markdown}\n`);

console.log(`wrote ${relative(outputJsonPath)}`);
console.log(`wrote ${relative(outputMdPath)}`);
console.log(`venue corpus: ${counts.venues} venues, ${counts.manifestItems} raw docs, ${counts.facilityEntries} facility entries`);

if (counts.errors > 0) {
  console.error(`venue corpus validation failed: ${counts.errors} errors, ${counts.warnings} warnings`);
  process.exit(1);
}

if (counts.warnings > 0) {
  console.warn(`venue corpus validation passed with ${counts.warnings} warnings`);
}
