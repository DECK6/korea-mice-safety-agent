import test from "node:test";
import assert from "node:assert/strict";

import { queryMiceSafetyApplicabilityTool } from "../build/tools/query-mice-safety-applicability.js";
import { queryMiceHazardControlsTool } from "../build/tools/query-mice-hazard-controls.js";

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
