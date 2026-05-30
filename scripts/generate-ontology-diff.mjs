#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const baselinePath = join(root, "data/snapshots/ontology-baseline.json");
const reportJsonPath = join(root, "data/ontology-diff-report.json");
const reportMdPath = join(root, "docs/ONTOLOGY_DIFF.md");
const writeBaseline = process.argv.includes("--write-baseline");

const sources = [
  {
    key: "laws",
    file: "src/ontology/mice/law-registry.json",
    path: ["laws"],
    idField: "id",
    labelFields: ["name", "shortName", "verificationStatus"],
  },
  {
    key: "legalArticles",
    file: "src/ontology/mice/legal-article-ontology.json",
    path: ["articles"],
    idField: "id",
    labelFields: ["lawName", "article", "title", "verificationStatus"],
  },
  {
    key: "legalAnnexes",
    file: "src/ontology/mice/legal-annex-ontology.json",
    path: ["annexes"],
    idField: "id",
    labelFields: ["lawName", "annexNo", "title", "verificationStatus"],
  },
  {
    key: "localOrdinances",
    file: "src/ontology/mice/local-ordinance-pack.json",
    path: ["records"],
    idField: "id",
    labelFields: ["jurisdiction", "ordinanceName", "category", "effectiveAt", "verificationStatus"],
  },
  {
    key: "workerSafetyReferences",
    file: "src/ontology/mice/worker-safety-references.json",
    path: ["references"],
    idField: "id",
    labelFields: ["title", "kind", "verificationStatus"],
  },
  {
    key: "venueRules",
    file: "src/ontology/mice/venue-safety-rules.json",
    path: ["venues"],
    idField: "id",
    labelFields: ["name", "region"],
  },
  {
    key: "venueFacilityIndex",
    file: "src/ontology/mice/venue-facility-index.json",
    path: ["venues"],
    idField: "venueId",
    labelFields: ["name", "region"],
    mapItem: (venue) => ({
      id: venue.venueId,
      name: venue.name,
      region: venue.region,
      entryCount: venue.entries.length,
      categoryCounts: venue.categoryCounts,
      entryHashes: venue.entries.map((entry) => `${entry.id}:${hashObject(entry)}`),
    }),
  },
  {
    key: "kopisVenueDirectory",
    file: "src/ontology/mice/kopis-venue-directory.json",
    path: ["venues"],
    idField: "venueId",
    labelFields: ["name", "jurisdiction", "category"],
  },
  {
    key: "p0OfflineEvidencePack",
    file: "src/ontology/mice/p0-offline-evidence-pack.json",
    path: ["sources"],
    idField: "sourceId",
    labelFields: ["label", "collectionStatus", "verificationStatus"],
  },
  {
    key: "incidentTaxonomy",
    file: "src/ontology/mice/incident-taxonomy.json",
    path: ["issueTypes"],
    idField: "id",
    labelFields: ["label", "recommendedTeam", "defaultPriority"],
  },
  {
    key: "communicationTemplates",
    file: "src/ontology/mice/communication-templates.json",
    path: ["templates"],
    idField: "id",
    labelFields: ["decisionType", "channel", "audience"],
  },
];

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

function getPath(value, path) {
  return path.reduce((cur, key) => cur?.[key], value);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashObject(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);
}

function labelFor(item, labelFields) {
  return labelFields
    .map((field) => item[field])
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join(" / ");
}

function normalizeSource(source) {
  const raw = readJson(source.file);
  const items = getPath(raw, source.path) ?? [];
  return items.map((item) => {
    const mapped = source.mapItem ? source.mapItem(item) : item;
    const id = mapped[source.idField] ?? mapped.id;
    return {
      id,
      label: labelFor(mapped, source.labelFields),
      hash: hashObject(mapped),
    };
  }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function buildSnapshot() {
  const collections = Object.fromEntries(
    sources.map((source) => [source.key, normalizeSource(source)]),
  );
  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    collections,
  };
}

function diffCollection(beforeItems = [], afterItems = []) {
  const before = new Map(beforeItems.map((item) => [item.id, item]));
  const after = new Map(afterItems.map((item) => [item.id, item]));
  const added = [];
  const removed = [];
  const changed = [];

  for (const item of afterItems) {
    const previous = before.get(item.id);
    if (!previous) {
      added.push(item);
    } else if (previous.hash !== item.hash) {
      changed.push({ before: previous, after: item });
    }
  }
  for (const item of beforeItems) {
    if (!after.has(item.id)) removed.push(item);
  }
  return { added, removed, changed };
}

function buildReport(baseline, current) {
  const collections = {};
  for (const source of sources) {
    collections[source.key] = diffCollection(
      baseline?.collections?.[source.key] ?? [],
      current.collections[source.key] ?? [],
    );
  }
  const summary = Object.fromEntries(
    Object.entries(collections).map(([key, diff]) => [key, {
      added: diff.added.length,
      removed: diff.removed.length,
      changed: diff.changed.length,
    }]),
  );
  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    baselineGeneratedAt: baseline?.generatedAt ?? null,
    currentGeneratedAt: current.generatedAt,
    summary,
    collections,
  };
}

function writeReport(report) {
  mkdirSync(dirname(reportJsonPath), { recursive: true });
  mkdirSync(dirname(reportMdPath), { recursive: true });
  writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# Ontology Diff Report",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- baselineGeneratedAt: ${report.baselineGeneratedAt ?? "none"}`,
    "",
    "## Summary",
    "",
    "| Collection | Added | Removed | Changed |",
    "| --- | ---: | ---: | ---: |",
    ...Object.entries(report.summary).map(([key, value]) => `| ${key} | ${value.added} | ${value.removed} | ${value.changed} |`),
    "",
    "## Notes",
    "",
    "- `npm run snapshot:ontology` updates the baseline after an intentional data refresh.",
    "- `npm run diff:ontology` compares current offline law/ordinance/venue/worker-safety packs against the baseline.",
    "- The diff stores fingerprints and labels, not API keys or `LAW_OC` values.",
  ];
  writeFileSync(reportMdPath, `${lines.join("\n")}\n`);
}

const current = buildSnapshot();
let baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, "utf8"))
  : null;

if (writeBaseline || !baseline) {
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  baseline = current;
}

const report = buildReport(baseline, current);
writeReport(report);

console.log(`baseline ${writeBaseline ? "updated" : baseline ? "loaded" : "created"}: ${baselinePath}`);
console.log(`wrote ${reportJsonPath}`);
console.log(`wrote ${reportMdPath}`);
