import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Reads src/ontology/mice/*.json directly so reference integrity is checked without a build step.
const readOntology = (fileName) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../src/ontology/mice/${fileName}`, import.meta.url)), "utf8"));

const applicability = readOntology("mice-safety-applicability.json");
const dutyMaster = readOntology("mice-duty-master.json");
const hazardControls = readOntology("hazard-controls.json");
const lawRegistry = readOntology("law-registry.json");
const sourceRegistry = readOntology("source-registry.json");
const incidentTaxonomy = readOntology("incident-taxonomy.json");
const workerSafetyReferences = readOntology("worker-safety-references.json");
const legalArticleOntology = readOntology("legal-article-ontology.json");
const legalAnnexOntology = readOntology("legal-annex-ontology.json");
const localOrdinancePack = readOntology("local-ordinance-pack.json");

const dutyIds = new Set(dutyMaster.duties.map((duty) => duty.id));
const hazardIds = new Set(hazardControls.hazards.map((hazard) => hazard.id));
const lawIds = new Set(lawRegistry.laws.map((law) => law.id));
const sourceIds = new Set(sourceRegistry.sources.map((source) => source.id));

const lawIdFromRef = (ref) => String(ref).split(":")[0];

function dangling(refs, knownIds, label) {
  return (refs ?? []).filter((ref) => !knownIds.has(ref)).map((ref) => `${label} -> ${ref}`);
}

test("applicability event types reference existing duties, hazards and laws", () => {
  const missing = applicability.eventTypes.flatMap((event) => [
    ...dangling(event.dutyIds, dutyIds, `eventType ${event.id} dutyIds`),
    ...dangling(event.hazardIds, hazardIds, `eventType ${event.id} hazardIds`),
    ...dangling(event.conditionalLawIds, lawIds, `eventType ${event.id} conditionalLawIds`),
  ]);
  assert.deepEqual(missing, []);
});

test("applicability feature rules reference existing duties, hazards and laws", () => {
  const missing = [
    ...dangling(applicability.commonLawIds, lawIds, "commonLawIds"),
    ...applicability.featureRules.flatMap((rule) => [
      ...dangling(rule.dutyIds, dutyIds, `featureRule ${rule.id} dutyIds`),
      ...dangling(rule.hazardIds, hazardIds, `featureRule ${rule.id} hazardIds`),
      ...dangling(rule.lawIds, lawIds, `featureRule ${rule.id} lawIds`),
    ]),
  ];
  assert.deepEqual(missing, []);
});

test("expectedCrowd feature rules carry numeric thresholds for crowdThresholds", () => {
  const crowdRules = applicability.featureRules.filter((rule) => rule.match.field === "expectedCrowd");
  const broken = crowdRules
    .filter((rule) => rule.match.operator !== ">=" || typeof rule.match.value !== "number")
    .map((rule) => `featureRule ${rule.id} match -> ${JSON.stringify(rule.match)}`);
  assert.deepEqual(broken, []);
  const ruleIds = crowdRules.map((rule) => rule.id);
  assert.equal(ruleIds.includes("large_crowd_rule"), true);
  assert.equal(ruleIds.includes("mid_crowd_rule"), true);
});

test("duty master law and source references resolve", () => {
  const missing = dutyMaster.duties.flatMap((duty) => [
    ...dangling(duty.lawRefs.map(lawIdFromRef), lawIds, `duty ${duty.id} lawRefs`),
    ...dangling(duty.sourceRefs, sourceIds, `duty ${duty.id} sourceRefs`),
  ]);
  assert.deepEqual(missing, []);
});

test("hazard control law and source references resolve", () => {
  const missing = hazardControls.hazards.flatMap((hazard) => [
    ...dangling(hazard.lawRefs.map(lawIdFromRef), lawIds, `hazard ${hazard.id} lawRefs`),
    ...dangling(hazard.sourceRefs, sourceIds, `hazard ${hazard.id} sourceRefs`),
  ]);
  assert.deepEqual(missing, []);
});

test("incident taxonomy issue types reference existing hazards and duties", () => {
  const missing = incidentTaxonomy.issueTypes.flatMap((issueType) => [
    ...dangling(issueType.relatedHazardIds ?? issueType.relatedHazards, hazardIds, `issueType ${issueType.id} relatedHazardIds`),
    ...dangling(issueType.relatedDutyIds ?? issueType.relatedDuties, dutyIds, `issueType ${issueType.id} relatedDutyIds`),
  ]);
  assert.deepEqual(missing, []);
});

test("worker safety references resolve to duties, hazards and laws", () => {
  const missing = workerSafetyReferences.references.flatMap((reference) => [
    ...dangling(reference.relatedDutyIds, dutyIds, `workerSafety ${reference.id} relatedDutyIds`),
    ...dangling(reference.relatedHazardIds, hazardIds, `workerSafety ${reference.id} relatedHazardIds`),
    ...dangling(reference.relatedLawRefs.map(lawIdFromRef), lawIds, `workerSafety ${reference.id} relatedLawRefs`),
  ]);
  assert.deepEqual(missing, []);
});

test("legal article and annex ontologies resolve to duties, hazards and laws", () => {
  const missing = [
    ...legalArticleOntology.articles.flatMap((article) => [
      ...dangling([article.lawEntryId], lawIds, `article ${article.id} lawEntryId`),
      ...dangling(article.relatedDutyIds, dutyIds, `article ${article.id} relatedDutyIds`),
      ...dangling(article.relatedHazardIds, hazardIds, `article ${article.id} relatedHazardIds`),
    ]),
    ...legalAnnexOntology.annexes.flatMap((annex) => [
      ...dangling([annex.lawEntryId], lawIds, `annex ${annex.id} lawEntryId`),
      ...dangling(annex.relatedDutyIds, dutyIds, `annex ${annex.id} relatedDutyIds`),
      ...dangling(annex.relatedHazardIds, hazardIds, `annex ${annex.id} relatedHazardIds`),
    ]),
  ];
  assert.deepEqual(missing, []);
});

test("local ordinance categories and records resolve to duties and hazards", () => {
  const missing = [
    ...localOrdinancePack.categories.flatMap((category) => [
      ...dangling(category.dutyIds, dutyIds, `ordinanceCategory ${category.id} dutyIds`),
      ...dangling(category.hazardIds, hazardIds, `ordinanceCategory ${category.id} hazardIds`),
    ]),
    ...localOrdinancePack.records.flatMap((record) => [
      ...dangling(record.dutyIds, dutyIds, `ordinance ${record.id} dutyIds`),
      ...dangling(record.hazardIds, hazardIds, `ordinance ${record.id} hazardIds`),
      ...dangling(record.relatedDuties, dutyIds, `ordinance ${record.id} relatedDuties`),
      ...dangling(record.relatedHazards, hazardIds, `ordinance ${record.id} relatedHazards`),
    ]),
  ];
  assert.deepEqual(missing, []);
});

test("every duty id is reachable from applicability event types or feature rules", () => {
  const referenced = new Set([
    ...applicability.eventTypes.flatMap((event) => event.dutyIds),
    ...applicability.featureRules.flatMap((rule) => rule.dutyIds),
  ]);
  const unreachable = dutyMaster.duties.map((duty) => duty.id).filter((id) => !referenced.has(id));
  assert.deepEqual(unreachable, []);
});
