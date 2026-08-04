import test from "node:test";
import assert from "node:assert/strict";

import { queryLiveOperationsStatus } from "../build/lib/live-operations-adapters.js";
import { buildLiveStatusPayload, startWebServer } from "../build/web/server.js";

const LIVE_ENV = {
  KMA_APIHUB_KEY: "WEATHER-SECRET",
  SEOUL_OPENAPI_KEY: "SEOUL-SECRET",
  AIRKOREA_SERVICE_KEY: "AIR-SECRET",
};

// 붐빔 crowd level, 35℃/70% heat and a 나쁨 air grade: the combination an operator must not miss.
const fetchImpl = async (url) => {
  const requestUrl = String(url);
  if (requestUrl.includes("/json/citydata/")) {
    return new Response(JSON.stringify({
      RESULT: { "RESULT.CODE": "INFO-000", "RESULT.MESSAGE": "정상 처리되었습니다" },
      CITYDATA: {
        AREA_NM: "강남역",
        AREA_CD: "POI014",
        LIVE_PPLTN_STTS: [{
          AREA_CONGEST_LVL: "붐빔",
          AREA_CONGEST_MSG: "사람이 많아 이동이 불편합니다.",
          AREA_PPLTN_MIN: "52000",
          AREA_PPLTN_MAX: "54000",
          PPLTN_TIME: "2026-08-04 15:00",
        }],
      },
    }));
  }
  if (requestUrl.includes("getUltraSrtNcst")) {
    return new Response(JSON.stringify({
      response: {
        header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
        body: {
          items: {
            item: [
              { category: "T1H", obsrValue: "35.0" },
              { category: "REH", obsrValue: "70" },
              { category: "WSD", obsrValue: "1.2" },
              { category: "PTY", obsrValue: "0" },
              { category: "RN1", obsrValue: "0" },
            ],
          },
        },
      },
    }));
  }
  return new Response(JSON.stringify({
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
      body: {
        totalCount: 1,
        items: [{
          dataTime: "2026-08-04 15:00",
          khaiGrade: "3",
          khaiValue: "120",
          pm10Value: "90",
          pm25Value: "55",
          o3Value: "0.085",
        }],
      },
    },
  }));
};

test("live dashboard maps 붐빔 crowd and 폭염경보급 heat to critical/warning panels", async () => {
  const status = await queryLiveOperationsStatus({
    jurisdiction: "서울특별시",
    seoulAreaName: "강남역",
    airStationName: "종로구",
    live: true,
    env: LIVE_ENV,
    fetchImpl,
  });
  const payload = buildLiveStatusPayload(status, { areaName: "강남역", stationName: "종로구", live: true });

  assert.equal(payload.crowd.state, "critical");
  assert(payload.crowd.summary.includes("붐빔"));
  assert(payload.crowd.metrics.some((metric) => metric.value === "52,000~54,000명"));
  assert.equal(payload.crowd.nationwideGuidance, null);

  assert.equal(payload.weather.state, "warning");
  assert.equal(payload.weather.heat.level, "warning");
  assert.equal(payload.weather.heat.label, "폭염경보급");
  assert(payload.weather.heat.apparentTemperatureC >= 35);

  assert.equal(payload.air.state, "warning");
  assert(payload.air.metrics.some((metric) => metric.value.includes("나쁨")));

  assert(payload.disclaimer.includes("법령 적용 근거가 아니라"));
  assert(payload.generatedAt);

  const serialized = JSON.stringify(payload);
  for (const secret of Object.values(LIVE_ENV)) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("live dashboard keeps 약간 붐빔 below the critical crowd band", async () => {
  const softerCrowd = async (url) => {
    if (!String(url).includes("/json/citydata/")) return fetchImpl(url);
    return new Response(JSON.stringify({
      RESULT: { "RESULT.CODE": "INFO-000" },
      CITYDATA: {
        AREA_NM: "강남 MICE 관광특구",
        LIVE_PPLTN_STTS: [{ AREA_CONGEST_LVL: "약간 붐빔", AREA_PPLTN_MIN: "28000", AREA_PPLTN_MAX: "30000" }],
      },
    }));
  };
  const status = await queryLiveOperationsStatus({
    jurisdiction: "서울특별시",
    seoulAreaName: "강남 MICE 관광특구",
    live: true,
    env: LIVE_ENV,
    fetchImpl: softerCrowd,
  });
  const payload = buildLiveStatusPayload(status, { areaName: "강남 MICE 관광특구", stationName: "종로구", live: true });
  assert.equal(payload.crowd.state, "watch");
});

test("live dashboard reports missing keys per panel instead of failing", async () => {
  const status = await queryLiveOperationsStatus({
    jurisdiction: "서울특별시",
    seoulAreaName: "강남역",
    live: true,
    env: {},
  });
  const payload = buildLiveStatusPayload(status, { areaName: "강남역", stationName: "종로구", live: true });

  for (const panel of [payload.crowd, payload.weather, payload.air]) {
    assert.equal(panel.status, "not_configured");
    assert.equal(panel.state, "unknown");
    assert(panel.summary.includes("API 키 미설정"));
  }
  // Only the echoed query targets survive; no measured value may appear without a key.
  assert.equal(payload.weather.metrics.length, 0);
  assert.equal(payload.crowd.metrics.some((metric) => metric.label === "혼잡도 등급"), false);
  assert.equal(payload.air.metrics.some((metric) => metric.label === "통합대기환경지수"), false);
  assert.equal(payload.weather.heat.label, "관측 없음");
  assert.equal(payload.traffic.status, "pending_key");
  assert.equal(payload.disasterMessage.status, "pending_key");
  assert(payload.traffic.summary.includes("발급 대기"));
});

test("live dashboard sends non-Seoul areas to the situation-room channel", async () => {
  const status = await queryLiveOperationsStatus({ live: false, env: { SEOUL_OPENAPI_KEY: "SEOUL-SECRET" } });
  const payload = buildLiveStatusPayload(status, { areaName: undefined, stationName: "종로구", live: false });

  assert.equal(payload.query.areaName, null);
  assert.equal(payload.crowd.status, "unsupported_region");
  assert(payload.crowd.nationwideGuidance.includes("인파관리지원시스템"));
  assert(payload.crowd.nationwideGuidance.includes("재난상황실"));
  assert(payload.crowd.note.includes("서울 실시간 도시데이터"));
});

test("web server serves /live and /api/live-status without network calls", async () => {
  const server = await startWebServer({ host: "127.0.0.1", port: 0 });
  const { port } = server.address();
  try {
    const page = await fetch(`http://127.0.0.1:${port}/live`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert(html.includes("현장 운영 라이브 대시보드"));
    assert(html.includes("강남역"));

    const response = await fetch(`http://127.0.0.1:${port}/api/live-status?live=false&areaName=`);
    const json = await response.json();
    assert.equal(response.status, 200);
    assert.equal(json.query.live, false);
    assert.equal(json.query.areaName, null);
    assert.equal(json.crowd.status, "unsupported_region");
    assert(json.crowd.nationwideGuidance);
    assert(json.disclaimer);
    for (const key of ["crowd", "weather", "air", "traffic", "disasterMessage"]) {
      assert.equal(typeof json[key].state, "string");
      assert.equal(typeof json[key].summary, "string");
    }
  } finally {
    server.close();
  }
});

test("/live carries both tabs and wires the law tab to /api/simulate", async () => {
  const server = await startWebServer({ host: "127.0.0.1", port: 0 });
  const { port } = server.address();
  try {
    const page = await fetch(`http://127.0.0.1:${port}/live`);
    const html = await page.text();
    assert.equal(page.status, 200);

    assert(html.includes(">실시간 현황<"));
    assert(html.includes(">법령·의무 문서<"));
    assert(html.includes('id="tab-live"'));
    assert(html.includes('id="tab-laws"'));
    // The law lookup is button-triggered against the offline ontology, not part of the 60s cycle.
    assert(html.includes("function requestLaws"));
    assert(html.includes('fetch("/api/simulate"'));
    assert(html.includes("function showTab"));
    // The national SKT card must keep its own DOM outside the auto-refreshed #panels.
    assert(html.indexOf('id="sktSection"') < html.indexOf('id="panels"'));
    assert(html.includes("REFRESH_MS"));
  } finally {
    server.close();
  }
});

test("law tab lookup returns 적용 법령 and 의무 문서 for 축제+옥외+5000명", async () => {
  const server = await startWebServer({ host: "127.0.0.1", port: 0 });
  const { port } = server.address();
  try {
    // The exact body the law tab sends with its default selections.
    const response = await fetch(`http://127.0.0.1:${port}/api/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventTypes: ["festival"],
        jurisdiction: "경기도 고양시",
        expectedCrowd: 5000,
        outdoorEvent: true,
        outdoor: true,
      }),
    });
    const json = await response.json();
    assert.equal(response.status, 200);

    const { laws, duties, localOrdinances, scopeWarnings } = json.applicability;
    assert(laws.length > 0);
    assert(duties.length > 0);
    assert(duties.every((duty) => duty.title && duty.strictnessLabel && duty.requiredWhen));
    // UI-only keys are filtered before the tool runs, so a plain lookup must not warn about scope.
    assert.deepEqual(scopeWarnings, []);
    // 우선/참고 split the law tab renders.
    assert(localOrdinances.some((item) => item.priorityBand === "primary"));
    assert(localOrdinances.some((item) => item.jurisdiction === "경기도 고양시"));
    assert(json.summary.inputFlags.includes("옥외"));
  } finally {
    server.close();
  }
});
