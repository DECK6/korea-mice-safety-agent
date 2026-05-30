import test from "node:test";
import assert from "node:assert/strict";

import { getApiAccessStatus } from "../build/lib/api-access-status.js";
import { generateEventDaySnapshot, isSnapshotStale } from "../build/lib/event-day-snapshot.js";
import { queryLiveOperationsStatus } from "../build/lib/live-operations-adapters.js";
import { fetchFoodSafetyRecalls, fetchKmaUltraShort, fetchTourApiFestivalCatalog, parseXmlRecords } from "../build/lib/mice-public-api-clients.js";
import { getP0ReadinessReport, normalizeP0FixtureRecords } from "../build/lib/p0-ready-sources.js";
import { buildPublicApiOperationalEvidence } from "../build/lib/public-api-operational-evidence.js";

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

test("P1 snapshot exposes stale calculation and pending-key fallbacks", async () => {
  assert.equal(isSnapshotStale("2026-05-30T00:10:00.000Z", new Date("2026-05-30T00:11:00.000Z")), true);
  assert.equal(isSnapshotStale("2026-05-30T00:10:00.000Z", new Date("2026-05-30T00:09:00.000Z")), false);

  const snapshot = await generateEventDaySnapshot({
    jurisdiction: "서울특별시 서초구",
    capturedAt: "2026-05-30T00:00:00.000Z",
    ttlMinutes: 30,
    live: false,
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

test("P2 live operations aggregates partial operationalEvidence and no legalBasis", async () => {
  const status = await queryLiveOperationsStatus({
    jurisdiction: "부산광역시 해운대구",
    live: false,
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

test("public API clients normalize real provider response shapes without leaking keys", async () => {
  const xmlRecords = parseXmlRecords("<dbs><db><prfnm>테스트 공연</prfnm><area>서울</area></db></dbs>", "db");
  assert.equal(xmlRecords[0].prfnm, "테스트 공연");

  const secret = "SECRET-API-KEY";
  const fetchImpl = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes("searchFestival2")) {
      return new Response(JSON.stringify({
        response: {
          header: { resultCode: "0000", resultMsg: "OK" },
          body: {
            totalCount: 1,
            items: { item: [{ title: "테스트 축제", addr1: "서울특별시 강남구 테헤란로", eventstartdate: "20260501", eventenddate: "20260503" }] },
          },
        },
      }));
    }
    if (requestUrl.includes("I0490")) {
      return new Response(JSON.stringify({
        I0490: {
          total_count: "1",
          row: [{ PRDTNM: "테스트 식품", BSSHNM: "테스트 업체", RTRVLPRVNS: "테스트 사유", CRET_DTM: "2026-05-30" }],
        },
      }));
    }
    return new Response(JSON.stringify({
      response: {
        header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
        body: { items: { item: [{ category: "T1H", obsrValue: "22.0" }, { category: "WSD", obsrValue: "1.1" }] } },
      },
    }));
  };

  const tour = await fetchTourApiFestivalCatalog({ env: { TOUR_API_SERVICE_KEY: secret }, fetchImpl, limit: 1 });
  const food = await fetchFoodSafetyRecalls({ env: { FOOD_SAFETY_API_KEY: secret }, fetchImpl, limit: 1 });
  const weather = await fetchKmaUltraShort({ env: { KMA_APIHUB_KEY: secret }, fetchImpl, now: new Date("2026-05-30T12:00:00.000Z") });
  const serialized = JSON.stringify({ tour, food, weather });
  assert.equal(tour.records[0].title, "테스트 축제");
  assert.equal(food.records[0].title, "테스트 식품");
  assert.equal(weather.records[0].fields.temperatureC, "22.0");
  assert.equal(serialized.includes(secret), false);
});

test("public API operational evidence selects purpose-fit offline sources", () => {
  const outdoorFood = buildPublicApiOperationalEvidence({
    eventTypes: ["festival", "food_event"],
    jurisdiction: "서울특별시 강남구",
    expectedCrowd: 5000,
    outdoorEvent: true,
    roadUse: true,
    foodService: true,
    lpgUse: true,
  });
  const outdoorSourceIds = new Set(outdoorFood.selectedSources.map((source) => source.sourceId));
  assert(outdoorSourceIds.has("TOUR_API_EVENT_CATALOG"));
  assert(outdoorSourceIds.has("NEMC_EMERGENCY_MEDICAL"));
  assert(outdoorSourceIds.has("NEMC_AED"));
  assert(outdoorSourceIds.has("FOOD_SAFETY_KOREA"));
  assert(outdoorSourceIds.has("KMA_APIHUB_WEATHER"));
  assert(outdoorSourceIds.has("SEOUL_REALTIME_CITY_DATA"));
  assert(outdoorSourceIds.has("AIRKOREA_AIR_QUALITY"));
  assert.equal(outdoorSourceIds.has("KOPIS_PERFORMANCE_CATALOG"), false);

  const indoorConference = buildPublicApiOperationalEvidence({
    eventTypes: ["conference"],
    expectedCrowd: 300,
    roadUse: false,
    foodService: false,
    lpgUse: false,
  });
  const indoorSourceIds = new Set(indoorConference.selectedSources.map((source) => source.sourceId));
  assert.equal(indoorSourceIds.has("FOOD_SAFETY_KOREA"), false);
  assert.equal(indoorSourceIds.has("KOPIS_PERFORMANCE_CATALOG"), false);
  assert.equal(indoorSourceIds.has("TOUR_API_EVENT_CATALOG"), false);
});
