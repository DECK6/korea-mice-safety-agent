#!/usr/bin/env node
// One-way sync: src/ontology/mice -> public static site data dir.
// local-ordinance-pack.json is field-projected (article extracts stay out of the public bundle).
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ontologyDir = resolve(here, "../src/ontology/mice");
const targetDir = resolve(process.argv[2] ?? resolve(here, "../../adxdeck/mice-safety/data"));

const COPY_FILES = [
  "mice-safety-applicability.json",
  "law-registry.json",
  "mice-duty-master.json",
  "hazard-controls.json",
  "venue-safety-rules.json",
  "kopis-venue-directory.json",
  "worker-safety-references.json",
  "source-registry.json",
];

const ORDINANCE_RECORD_FIELDS = [
  "id", "jurisdiction", "name", "ordinanceName", "categoryId", "categoryLabel",
  "eventTypes", "dutyIds", "hazardIds", "structuredStatus", "submissionDeadline",
  "effectiveAt", "appliesWhen", "sourceUrl", "currentAsOf", "reviewBy", "freshnessStatus",
];

const report = (name, bytes) => console.log(`${name}: ${(bytes / 1024).toFixed(0)} KB`);

for (const file of COPY_FILES) {
  const raw = readFileSync(join(ontologyDir, file), "utf8");
  JSON.parse(raw);
  writeFileSync(join(targetDir, file), raw);
  report(file, statSync(join(targetDir, file)).size);
}

const pack = JSON.parse(readFileSync(join(ontologyDir, "local-ordinance-pack.json"), "utf8"));
const projected = {
  version: pack.version,
  versionType: pack.versionType,
  generatedAt: pack.generatedAt,
  records: pack.records.map((record) => Object.fromEntries(
    ORDINANCE_RECORD_FIELDS.filter((key) => record[key] !== undefined).map((key) => [key, record[key]])
  )),
};
const out = JSON.stringify(projected);
if (Buffer.byteLength(out) > 1024 * 1024) {
  console.error(`FAIL: projected local-ordinance-pack.json is ${Buffer.byteLength(out)} bytes (> 1MB)`);
  process.exit(1);
}
writeFileSync(join(targetDir, "local-ordinance-pack.json"), out);
report("local-ordinance-pack.json (projected)", Buffer.byteLength(out));
console.log("sync-public-site: done");
