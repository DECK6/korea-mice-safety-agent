import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { samplePersonaCohort } from "../build/lib/mice-personas.js";
import { stressTestMiceSafetyPlanTool } from "../build/tools/stress-test-mice-safety-plan.js";
import { TOOLS } from "../build/tool-registry.js";

test("persona cohort sampling is deterministic and strips source identity fields", () => {
  const first = samplePersonaCohort({ preset: "national", cohortSize: 40, seed: 42, representativeLimit: 6 });
  const second = samplePersonaCohort({ preset: "national", cohortSize: 40, seed: 42, representativeLimit: 6 });
  assert.deepEqual(first.representativeProfiles, second.representativeProfiles);
  assert.equal(first.actualSize, 40);
  for (const profile of first.representativeProfiles) {
    assert.equal("uuid" in profile, false);
    assert.equal("name" in profile, false);
    assert.equal("persona" in profile, false);
  }
});

test("senior-inclusive preset meets its minimum quota", () => {
  const cohort = samplePersonaCohort({ preset: "senior_inclusive", cohortSize: 100, seed: 7 });
  assert.equal(cohort.actualSize, 100);
  assert.equal(cohort.shares.senior >= 0.4, true);
});

test("host-region preset prioritizes the normalized province", () => {
  const cohort = samplePersonaCohort({ preset: "host_region", cohortSize: 20, targetProvince: "제주특별자치도", seed: 9 });
  assert.equal((cohort.distributions.provinces.제주 ?? 0) > 0, true);
});

test("public pack records provenance and excludes raw narrative fields", () => {
  const pack = JSON.parse(readFileSync(new URL("../src/ontology/mice/nemotron-persona-sample.json", import.meta.url), "utf8"));
  assert.equal(pack.provenance.dataset, "nvidia/Nemotron-Personas-Korea");
  assert.equal(pack.provenance.license, "cc-by-4.0");
  assert.equal(pack.personas.length, 320);
  assert.equal(pack.personas.some((row) => "uuid" in row || "persona" in row || "firstName" in row), false);
});

test("persona stress test remains separate from base legal review and includes sentinels", async () => {
  const result = await stressTestMiceSafetyPlanTool.handler({
    eventName: "고령층 포함 야외축제",
    eventTypes: ["festival"],
    expectedCrowd: 3000,
    outdoorEvent: true,
    personaPreset: "senior_inclusive",
    cohortSize: 60,
    personaSeed: 11,
  });
  const structured = result.structuredContent;
  assert.equal(typeof structured.basePlanReview.score, "number");
  assert.equal(typeof structured.personaCoverage.score, "number");
  assert.equal(structured.personaCoverage.findings.some((item) => item.id === "accessibility_sentinel"), true);
  assert.equal(structured.personaCoverage.findings.some((item) => item.id === "child_guardian_sentinel"), true);
  assert.match(result.content[0].text, /법적 적합성 또는 실제 사고확률 점수가 아닙니다/);
});

test("new persona tools are registered in the MCP tool list", () => {
  const names = TOOLS.map((tool) => tool.name);
  assert.equal(names.includes("sample_mice_persona_cohort"), true);
  assert.equal(names.includes("stress_test_mice_safety_plan"), true);
});
