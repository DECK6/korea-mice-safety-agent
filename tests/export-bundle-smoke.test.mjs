import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The bundle writes under MICE_LOCAL_DIR, so isolate it before the tool module loads.
const localDir = mkdtempSync(join(tmpdir(), "mice-bundle-"));
process.env.MICE_LOCAL_DIR = localDir;

const { exportMiceSafetyPlanBundleTool } = await import("../build/tools/export-mice-safety-plan-bundle.js");

after(() => {
  rmSync(localDir, { recursive: true, force: true });
});

// The README's worked example: an outdoor food festival with road use, LPG and setup/teardown,
// which is the input that exercises the widest set of documents in the bundle.
const eventInput = {
  eventName: "고양 야외 푸드 페스티벌",
  eventDate: "2026-06-20",
  eventTypes: ["festival", "food_event"],
  jurisdiction: "경기도 고양시",
  expectedCrowd: 5000,
  outdoorEvent: true,
  roadUse: true,
  foodService: true,
  lpgUse: true,
  temporaryStructures: true,
  temporaryElectricity: true,
  setupTeardown: true,
  workAtHeight: true,
  heavyObjectHandling: true,
  outputDir: "smoke-bundle",
};

let structured;

before(async () => {
  const result = await exportMiceSafetyPlanBundleTool.handler(eventInput);
  structured = result.structuredContent;
}, { timeout: 120_000 });

test("the bundle reports a directory inside the isolated local root", () => {
  assert.equal(structured.bundleDir, join(localDir, "smoke-bundle"));
  assert.equal(Array.isArray(structured.files), true);
  assert.equal(structured.files.length > 20, true, `expected a multi-document bundle, got ${structured.files.length} files`);
});

test("every reported file exists on disk and is not empty", () => {
  const broken = structured.files
    .map((file) => {
      try {
        return statSync(file).size > 0 ? null : `${file} -> 0 bytes`;
      } catch {
        return `${file} -> missing`;
      }
    })
    .filter(Boolean);
  assert.deepEqual(broken, []);
});

test("the executive report is written in both Markdown and HTML", () => {
  assert.equal(structured.files.includes(structured.executiveReportPath), true);
  assert.equal(structured.files.includes(structured.executiveHtmlReportPath), true);
  assert.equal(readFileSync(structured.executiveReportPath, "utf8").includes(eventInput.eventName), true);
  assert.equal(readFileSync(structured.executiveHtmlReportPath, "utf8").startsWith("<!doctype html>"), true);
});

test("the xlsx and docx outputs start with the zip signature", () => {
  const packaged = structured.files.filter((file) => file.endsWith(".xlsx") || file.endsWith(".docx"));
  assert.equal(packaged.length >= 2, true, "expected at least one xlsx and one docx");
  for (const file of packaged) {
    assert.equal(readFileSync(file).subarray(0, 2).toString("latin1"), "PK", `${file} is not a zip container`);
  }
});

test("the manifest lists the same files the tool returned", () => {
  const manifest = JSON.parse(readFileSync(join(structured.bundleDir, "bundle/metadata/manifest.json"), "utf8"));
  assert.deepEqual(manifest.files.slice().sort(), structured.files.slice().sort());
});
