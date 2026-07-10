#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATASET = "nvidia/Nemotron-Personas-Korea";
const CONFIG = "default";
const SPLIT = "train";
const DATASET_URL = `https://huggingface.co/datasets/${DATASET}`;
const NGC_EXTENDED_URL = "https://catalog.ngc.nvidia.com/orgs/nvidia/nemotron-personas/resources/nemotron-personas-dataset-ko_kr/-";
const API_URL = `https://huggingface.co/api/datasets/${DATASET}`;
const ROWS_URL = "https://datasets-server.huggingface.co/rows";
const SAMPLE_COUNT = 320;
const BATCH_COUNT = 20;
const BATCH_SIZE = SAMPLE_COUNT / BATCH_COUNT;
const TOTAL_ROWS = 1_000_000;

const here = dirname(fileURLToPath(import.meta.url));
const defaultOutput = resolve(here, "../src/ontology/mice/nemotron-persona-sample.json");
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const positionalOutput = args.find((arg, index) =>
  !arg.startsWith("--") && !["--output", "--input-json"].includes(args[index - 1])
);
const outputPath = resolve(valueAfter("--output") ?? positionalOutput ?? defaultOutput);
const inputPathValue = valueAfter("--input-json");
const inputPath = inputPathValue ? resolve(inputPathValue) : undefined;

function compact(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function optionalField(row, key) {
  const value = row[key];
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "number" ? value : compact(String(value));
}

function normalizeRow(row, index) {
  const normalized = {
    id: `nemotron-ko-${String(index + 1).padStart(4, "0")}`,
    age: Number(row.age),
    sex: compact(row.sex),
    province: compact(row.province),
    district: compact(row.district),
    educationLevel: compact(row.education_level ?? row.educationLevel),
    familyType: compact(row.family_type ?? row.familyType),
    occupation: compact(row.occupation),
  };
  const optional = {
    economicActivityStatus: optionalField(row, "economic_activity_status") ?? optionalField(row, "economicActivityStatus"),
    incomeBracket: optionalField(row, "income_bracket") ?? optionalField(row, "incomeBracket"),
    bmiStatus: optionalField(row, "bmi_status") ?? optionalField(row, "bmiStatus"),
    bloodPressureStatus: optionalField(row, "blood_pressure_status") ?? optionalField(row, "bloodPressureStatus"),
    bloodSugarStatus: optionalField(row, "blood_sugar_status") ?? optionalField(row, "bloodSugarStatus"),
    waistStatus: optionalField(row, "waist_status") ?? optionalField(row, "waistStatus"),
    healthcarePersona: optionalField(row, "healthcare_persona") ?? optionalField(row, "healthcarePersona"),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) normalized[key] = value;
  }
  if (!Number.isInteger(normalized.age) || normalized.age < 19) {
    throw new Error(`Unexpected age at sample ${index}: ${row.age}`);
  }
  return normalized;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "user-agent": "korea-mice-safety-agent/1.0" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

let rows = [];
let provenance;
if (inputPath) {
  const raw = readFileSync(inputPath, "utf8");
  const parsed = inputPath.endsWith(".jsonl")
    ? raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    : JSON.parse(raw);
  const sourceRows = Array.isArray(parsed) ? parsed : parsed.rows ?? parsed.personas;
  if (!Array.isArray(sourceRows) || sourceRows.length < SAMPLE_COUNT) {
    throw new Error(`--input-json must contain at least ${SAMPLE_COUNT} rows as an array, .rows, or .personas`);
  }
  const indices = Array.from({ length: SAMPLE_COUNT }, (_, index) =>
    Math.floor((index * (sourceRows.length - 1)) / (SAMPLE_COUNT - 1))
  );
  rows = indices.map((index) => sourceRows[index]);
  provenance = {
    title: "Nemotron-Personas-Korea-Extended normalized local sample",
    dataset: "nvidia/Nemotron-Personas-Korea-Extended",
    sourceUrl: NGC_EXTENDED_URL,
    revision: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
    license: "NVIDIA Dataset License Agreement",
    sourceRowCount: sourceRows.length,
    sampledRowCount: SAMPLE_COUNT,
    samplingMethod: "deterministic evenly-spaced rows from a user-supplied NGC Extended JSON/JSONL export",
    variant: "ngc-extended-51-field",
    sourceSchemaFields: Object.keys(sourceRows[0] ?? {}).sort(),
  };
} else {
  const metadata = await fetchJson(API_URL);
  const offsets = Array.from({ length: BATCH_COUNT }, (_, index) =>
    Math.floor((index * (TOTAL_ROWS - BATCH_SIZE)) / (BATCH_COUNT - 1))
  );
  for (const offset of offsets) {
    const query = new URLSearchParams({
      dataset: DATASET,
      config: CONFIG,
      split: SPLIT,
      offset: String(offset),
      length: String(BATCH_SIZE),
    });
    const batch = await fetchJson(`${ROWS_URL}?${query}`);
    rows.push(...batch.rows.map((item) => item.row));
  }
  provenance = {
    title: "Nemotron-Personas-Korea public core sample",
    dataset: DATASET,
    sourceUrl: DATASET_URL,
    revision: metadata.sha,
    license: metadata.cardData?.license ?? "cc-by-4.0",
    sourceRowCount: metadata.cardData?.dataset_info?.splits?.[0]?.num_examples ?? TOTAL_ROWS,
    sampledRowCount: SAMPLE_COUNT,
    samplingMethod: `deterministic evenly-spaced offsets (${BATCH_COUNT} x ${BATCH_SIZE}) via Hugging Face datasets-server`,
    variant: "public-core-26-field",
  };
}

if (rows.length !== SAMPLE_COUNT) {
  throw new Error(`Expected ${SAMPLE_COUNT} rows, received ${rows.length}`);
}

const pack = {
  version: "1.0.0",
  generatedAt: new Date().toISOString(),
  provenance,
  usageBoundary: {
    purpose: "Synthetic cohort safety-plan QA; not attendance, behavior, medical, or incident prediction.",
    browserPolicy: "Only normalized demographic fields are shipped. Synthetic names, UUIDs, and narrative personas are excluded.",
    legalBoundary: "Persona results must not change statutory applicability decisions.",
  },
  limitations: [
    "The source contains synthetic adults aged 19 and older; it does not cover children.",
    "The public core variant does not provide validated disability, mobility, language-proficiency, or event-attendance labels.",
    "A 320-row deterministic sample is for product QA, not official population estimation.",
    "Rare but safety-critical needs must be tested with explicit sentinel scenarios regardless of sample prevalence.",
  ],
  personas: rows.map(normalizeRow),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(pack, null, 2)}\n`);
console.log(`wrote ${pack.personas.length} normalized personas to ${outputPath}`);
console.log(`source revision: ${pack.provenance.revision}`);
