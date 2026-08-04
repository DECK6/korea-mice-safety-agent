import test from "node:test";
import assert from "node:assert/strict";

import { queryMiceSafetyApplicabilityTool } from "../build/tools/query-mice-safety-applicability.js";
import { queryMiceHazardControlsTool } from "../build/tools/query-mice-hazard-controls.js";
import { crowdThresholds, findLocalOrdinances } from "../build/lib/mice-data.js";

const hasId = (items, id) => items.some((item) => item.id === id);

test("outdoorAdvertising surfaces the Outdoor Advertisements Act and signage permit duty (no road use)", async () => {
  const { structuredContent } = await queryMiceSafetyApplicabilityTool.handler({ outdoorAdvertising: true });
  assert.equal(hasId(structuredContent.laws, "outdoor_advertisements_act"), true);
  assert.equal(hasId(structuredContent.duties, "road_traffic_and_outdoor_signage_permit"), true);
});

test("hotWork-only request infers an event type so fire/evacuation-scoped duties are not dropped", async () => {
  const { structuredContent } = await queryMiceSafetyApplicabilityTool.handler({ hotWork: true });
  assert.equal(structuredContent.matchedEventTypes.some((event) => event.id === "exhibition"), true);
  assert.equal(hasId(structuredContent.duties, "fire_and_hazardous_material_permit_check"), true);
});

test("mid-size crowd (>=300, <1000) surfaces crowd-management and medical duties", async () => {
  const { structuredContent } = await queryMiceSafetyApplicabilityTool.handler({ expectedCrowd: 500 });
  assert.equal(hasId(structuredContent.duties, "mice_crowd_management_plan"), true);
  assert.equal(hasId(structuredContent.duties, "medical_aed_response_plan"), true);
});

test("crowd thresholds come from the ontology feature rules", () => {
  assert.equal(crowdThresholds.mid, 300);
  assert.equal(crowdThresholds.large, 1000);
});

test("299 stays below the mid-crowd threshold and 300 crosses it", async () => {
  const below = await queryMiceSafetyApplicabilityTool.handler({ expectedCrowd: crowdThresholds.mid - 1 });
  assert.equal(hasId(below.structuredContent.duties, "mice_crowd_management_plan"), false);
  const atThreshold = await queryMiceSafetyApplicabilityTool.handler({ expectedCrowd: crowdThresholds.mid });
  assert.equal(hasId(atThreshold.structuredContent.duties, "mice_crowd_management_plan"), true);
  assert.equal(hasId(atThreshold.structuredContent.duties, "medical_aed_response_plan"), true);
});

test("999 stays mid-crowd and 1000 escalates to the large-crowd duties", async () => {
  const below = await queryMiceSafetyApplicabilityTool.handler({ expectedCrowd: crowdThresholds.large - 1 });
  assert.equal(hasId(below.structuredContent.duties, "mice_crowd_management_plan"), true);
  assert.equal(hasId(below.structuredContent.duties, "elevator_escalator_crowd_control"), false);
  const atThreshold = await queryMiceSafetyApplicabilityTool.handler({ expectedCrowd: crowdThresholds.large });
  assert.equal(hasId(atThreshold.structuredContent.duties, "elevator_escalator_crowd_control"), true);
});

test("vipSecurity keeps the staff assignment roster duty instead of dropping a dangling id", async () => {
  const { structuredContent } = await queryMiceSafetyApplicabilityTool.handler({ vipSecurity: true });
  assert.equal(hasId(structuredContent.duties, "staff_assignment_roster"), true);
  assert.equal(hasId(structuredContent.duties, "security_access_control_plan"), true);
});

test("ordinances above the input crowd size are shown as reference, not silently dropped", () => {
  const ordinanceId = "outdoor_event_safety:1844457";
  const filters = { jurisdiction: "강원특별자치도", categoryId: "outdoor_event_safety", limit: 100 };

  const applied = findLocalOrdinances({ ...filters, expectedCrowd: 500 });
  const appliedRecord = applied.find((record) => record.id === ordinanceId);
  assert.equal(appliedRecord.thresholdStructured.minCrowd, 500);
  assert.equal(appliedRecord.crowdThresholdNote, undefined);
  assert.equal(appliedRecord.priorityBand, "primary");

  const belowThreshold = findLocalOrdinances({ ...filters, expectedCrowd: 50 });
  const belowRecord = belowThreshold.find((record) => record.id === ordinanceId);
  assert.equal(belowThreshold.length, applied.length);
  assert.equal(belowRecord.priorityBand, "reference");
  assert.equal(belowRecord.crowdThresholdNote.includes("500명 이상"), true);
  assert.equal(belowRecord.priorityReasons.includes(belowRecord.crowdThresholdNote), true);
});

test("ordinance crowd filtering stays inert when no expectedCrowd is given", () => {
  const records = findLocalOrdinances({ jurisdiction: "강원특별자치도", categoryId: "outdoor_event_safety", limit: 100 });
  assert.equal(records.every((record) => record.crowdThresholdNote === undefined), true);
});

test("personalDataProcessing alone keeps privacy duty but does not fabricate a full conference event", async () => {
  const { structuredContent } = await queryMiceSafetyApplicabilityTool.handler({ personalDataProcessing: true });
  assert.equal(hasId(structuredContent.duties, "privacy_cctv_registration_check"), true);
  assert.equal(structuredContent.matchedEventTypes.some((event) => event.id === "conference"), false);
});

test("unknown venueId produces a scope warning instead of silently degrading", async () => {
  const { structuredContent } = await queryMiceSafetyApplicabilityTool.handler({ venueId: "no_such_venue_xyz" });
  assert.equal(structuredContent.scopeWarnings.some((warning) => warning.includes("no_such_venue_xyz")), true);
});

test("unrecognized high-risk input keys are reported as out-of-scope, not dropped silently", async () => {
  const { structuredContent } = await queryMiceSafetyApplicabilityTool.handler({ fireworks: true, droneShow: true });
  assert.equal(structuredContent.scopeWarnings.length > 0, true);
});

test("hazard query normalizes outdoor_event<->festival so crowd hazards are not lost by label choice", async () => {
  const festival = await queryMiceHazardControlsTool.handler({ eventType: "festival" });
  const outdoor = await queryMiceHazardControlsTool.handler({ eventType: "outdoor_event" });
  const festivalIds = festival.structuredContent.hazards.map((hazard) => hazard.id).sort();
  const outdoorIds = outdoor.structuredContent.hazards.map((hazard) => hazard.id).sort();
  assert.deepEqual(festivalIds, outdoorIds);
  assert.equal(festivalIds.includes("crowd_density_high"), true);
});
