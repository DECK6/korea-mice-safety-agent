import test from "node:test";
import assert from "node:assert/strict";

import { getApiAccessStatus } from "../build/lib/api-access-status.js";
import { generateEventDaySnapshot, isSnapshotStale } from "../build/lib/event-day-snapshot.js";
import { queryLiveOperationsStatus } from "../build/lib/live-operations-adapters.js";
import { getP0ReadinessReport, normalizeP0FixtureRecords } from "../build/lib/p0-ready-sources.js";

test("API access status never serializes key values", () => {
  const secret = "SECRET-VALUE-DO-NOT-LEAK";
  const report = getApiAccessStatus({
    loadDotEnv: false,
    generatedAt: "2026-05-30T00:00:00.000Z",
    env: {
      KOPIS_SERVICE_KEY: secret,
      SEOUL_OPENAPI_KEY: "SEOUL-SECRET",
      LAW_OC: "LAW-SECRET",
    },
  });
  const serialized = JSON.stringify(report);
  assert.equal(report.policy.keyValuesIncluded, false);
  assert.equal(report.items.find((item) => item.envVar === "KOPIS_SERVICE_KEY")?.status, "configured");
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("SEOUL-SECRET"), false);
  assert.equal(serialized.includes("LAW-SECRET"), false);
});

test("P0 readiness uses offline pack and fixture normalization without network", () => {
  const report = getP0ReadinessReport({
    generatedAt: "2026-05-30T00:00:00.000Z",
    env: {
      KCISA_KOPIS_FACILITY_KEY: "x",
      KOPIS_SERVICE_KEY: "x",
      TOUR_API_SERVICE_KEY: "x",
      NEMC_SERVICE_KEY: "x",
      FOOD_SAFETY_API_KEY: "x",
    },
  });
  const facility = report.sources.find((source) => source.sourceId === "KCISA_KOPIS_PERFORMANCE_FACILITY");
  assert.equal(report.offlineRuntimeOnly, true);
  assert.equal(facility?.records, 2111);
  assert.equal(facility?.collectionStatus, "collected");

  const fixtures = normalizeP0FixtureRecords("2026-05-30T00:00:00.000Z");
  assert.equal(fixtures.length, 4);
  assert(fixtures.every((record) => record.sourceConfidence === "fixture"));
});

test("P1 snapshot exposes stale calculation and pending-key fallbacks", () => {
  assert.equal(isSnapshotStale("2026-05-30T00:10:00.000Z", new Date("2026-05-30T00:11:00.000Z")), true);
  assert.equal(isSnapshotStale("2026-05-30T00:10:00.000Z", new Date("2026-05-30T00:09:00.000Z")), false);

  const snapshot = generateEventDaySnapshot({
    jurisdiction: "서울특별시 서초구",
    capturedAt: "2026-05-30T00:00:00.000Z",
    ttlMinutes: 30,
    env: {
      SEOUL_OPENAPI_KEY: "x",
      AIRKOREA_SERVICE_KEY: "x",
    },
  });
  assert.equal(snapshot.capturedAt, "2026-05-30T00:00:00.000Z");
  assert.equal(snapshot.expiresAt, "2026-05-30T00:30:00.000Z");
  assert.equal(snapshot.sources.find((source) => source.sourceId === "SEOUL_REALTIME_CITY_DATA")?.status, "configured");
  assert.equal(snapshot.sources.find((source) => source.sourceId === "ITS_TRAFFIC_OPENAPI")?.status, "pending_key");
  assert.equal(snapshot.sources.find((source) => source.sourceId === "SAFETY_DATA_DISASTER_MESSAGE")?.status, "pending_key");
});

test("P2 live operations aggregates partial operationalEvidence and no legalBasis", () => {
  const status = queryLiveOperationsStatus({
    jurisdiction: "부산광역시 해운대구",
    env: {
      KMA_APIHUB_KEY: "x",
      AIRKOREA_SERVICE_KEY: "x",
    },
  });
  assert.equal("legalBasis" in status, false);
  assert(Array.isArray(status.operationalEvidence));
  assert.equal(status.operationalEvidence.find((item) => item.sourceId === "KMA_APIHUB_WEATHER")?.status, "configured");
  assert.equal(status.operationalEvidence.find((item) => item.sourceId === "SEOUL_REALTIME_CITY_DATA")?.status, "unsupported_region");
  assert.equal(status.operationalEvidence.find((item) => item.sourceId === "ITS_TRAFFIC_OPENAPI")?.status, "pending_key");
  assert.equal(status.operationalEvidence.find((item) => item.sourceId === "SAFETY_DATA_DISASTER_MESSAGE")?.status, "pending_key");
  assert(status.warnings.some((warning) => warning.includes("서울 지역이 아니므로")));
});
