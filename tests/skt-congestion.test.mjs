import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The quota ledger lives under MICE_LOCAL_DIR, so the isolation has to be in place before the
// module reads it — hence the dynamic import below (same pattern as operations-store.test.mjs).
const quotaDir = mkdtempSync(join(tmpdir(), "mice-skt-"));
process.env.MICE_LOCAL_DIR = quotaDir;

const { fetchSktPlaceCongestion, fetchSktPlacePois } = await import("../build/lib/mice-public-api-clients.js");
const {
  getSktCongestion,
  readSktQuota,
  searchSktPois,
  SKT_MONTHLY_CALL_LIMIT,
} = await import("../build/lib/skt-place-congestion.js");
const { startWebServer } = await import("../build/web/server.js");

after(() => {
  rmSync(quotaDir, { recursive: true, force: true });
});

const APP_KEY = "SKT-APPKEY-SECRET";
const SKT_ENV = { SK_OPEN_API_APP_KEY: APP_KEY };
const quotaPath = join(quotaDir, "skt-quota.json");

// Every test drives its own poiId so the 10-minute reading cache never leaks across cases.
const COEX = "187757";
const KINTEX = "729930";
const BEXCO = "385078";
const EVERLAND = "387701";
const STARFIELD = "5411247";
const IKEA = "5830423";

function seedQuota(month, used) {
  writeFileSync(quotaPath, `${JSON.stringify({ month, used })}\n`);
}

function congestionResponse(poiId, poiName, congestionLevel, congestion) {
  return new Response(JSON.stringify({
    status: { code: "00", message: "success" },
    contents: {
      poiId,
      poiName,
      rltm: [{ datetime: "20260804185000", congestion, congestionLevel, type: 1 }],
    },
  }));
}

function countingFetch(poiId, poiName, level = 4, congestion = 0.3613897815) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return congestionResponse(poiId, poiName, level, congestion);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test("congestion client normalizes level 4 to the critical band and sends appKey as a header", async () => {
  const fetchImpl = countingFetch(STARFIELD, "스타필드하남");
  const live = await fetchSktPlaceCongestion({ poiId: STARFIELD, env: SKT_ENV, fetchImpl });

  assert.equal(live.status, "live_verified");
  assert.equal(live.records.length, 1);
  const record = live.records[0];
  assert.equal(record.sourceId, "SKT_PUZZLE_PLACE_CONGESTION");
  assert.equal(record.title, "스타필드하남");
  assert.equal(record.fields.congestionLevel, 4);
  assert.equal(record.fields.congestionLabel, "매우 혼잡");
  assert.equal(record.fields.riskState, "critical");
  assert.equal(record.fields.congestion, 0.3613897815);
  assert.equal(record.fields.datetime, "20260804185000");

  assert.equal(fetchImpl.calls.length, 1);
  assert(fetchImpl.calls[0].url.endsWith(`/puzzle/place/congestion/rltm/pois/${STARFIELD}`));
  assert.equal(fetchImpl.calls[0].init.headers.appKey, APP_KEY);
  assert.equal(JSON.stringify(live).includes(APP_KEY), false);
});

test("congestion client maps the lower levels to watch and normal", async () => {
  for (const [level, label, state] of [[1, "여유", "normal"], [2, "보통", "normal"], [3, "혼잡", "watch"]]) {
    const live = await fetchSktPlaceCongestion({
      poiId: IKEA,
      env: SKT_ENV,
      fetchImpl: countingFetch(IKEA, "이케아광명점", level, 0.01),
    });
    assert.equal(live.records[0].fields.congestionLabel, label);
    assert.equal(live.records[0].fields.riskState, state);
  }
});

test("congestion client reports a missing key instead of calling upstream", async () => {
  const fetchImpl = countingFetch(COEX, "코엑스");
  const live = await fetchSktPlaceCongestion({ poiId: COEX, env: {}, fetchImpl });
  assert.equal(live.status, "not_configured");
  assert.equal(fetchImpl.calls.length, 0);
  assert(live.warnings[0].includes("SK_OPEN_API_APP_KEY"));
});

test("poi meta client normalizes the offline index rows it collects", async () => {
  const calls = [];
  const live = await fetchSktPlacePois({
    offset: 1000,
    limit: 1000,
    env: SKT_ENV,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        status: { code: "00", message: "success", totalCount: 33647, offset: 1000, limit: 1000 },
        contents: [{ poiId: "999001", poiName: "대전컨벤션센터" }, { poiId: "999002", poiName: "송도컨벤시아" }],
      }));
    },
  });

  assert.equal(live.status, "live_verified");
  assert.equal(live.totalCount, 33647);
  assert.deepEqual(live.records.map((record) => record.title), ["대전컨벤션센터", "송도컨벤시아"]);
  assert.equal(live.records[0].fields.poiId, "999001");
  assert(calls[0].url.includes("offset=1000"));
  assert(calls[0].url.includes("limit=1000"));
  assert.equal(calls[0].init.headers.appKey, APP_KEY);
});

test("a probe increments the local quota ledger before the call", async () => {
  seedQuota("2026-08", 4);
  const now = new Date("2026-08-04T10:00:00.000Z");
  const fetchImpl = countingFetch(COEX, "코엑스");

  const result = await getSktCongestion({ poiId: COEX, now, env: SKT_ENV, fetchImpl });

  assert.equal(result.status, "ok");
  assert.equal(result.poi.poiName, "코엑스");
  assert.equal(result.state, "critical");
  assert.equal(result.levelLabel, "매우 혼잡");
  assert.equal(result.cached, false);
  assert.deepEqual(result.quota, { month: "2026-08", used: 5, limit: SKT_MONTHLY_CALL_LIMIT, estimated: true });
  assert(result.quotaNote.includes("로컬 추정치(수동 프로브 미포함)"));
  assert.deepEqual(JSON.parse(readFileSync(quotaPath, "utf8")), { month: "2026-08", used: 5 });
  assert.equal(fetchImpl.calls.length, 1);
});

test("a cache hit inside the TTL answers without spending quota", async () => {
  seedQuota("2026-08", 0);
  const fetchImpl = countingFetch(KINTEX, "킨텍스제1전시장", 3, 0.12);
  const first = await getSktCongestion({
    poiId: KINTEX,
    now: new Date("2026-08-04T10:00:00.000Z"),
    env: SKT_ENV,
    fetchImpl,
  });
  const second = await getSktCongestion({
    poiId: KINTEX,
    now: new Date("2026-08-04T10:09:00.000Z"),
    env: SKT_ENV,
    fetchImpl,
  });

  assert.equal(first.cached, false);
  assert.equal(first.quota.used, 1);
  assert.equal(second.cached, true);
  assert.equal(second.state, "watch");
  assert.equal(second.fetchedAt, first.fetchedAt);
  assert.equal(second.quota.used, 1, "a cached reading must not move the ledger");
  assert.equal(fetchImpl.calls.length, 1, "the TTL cache must absorb the second probe");
  assert.deepEqual(JSON.parse(readFileSync(quotaPath, "utf8")), { month: "2026-08", used: 1 });
});

test("the tenth recorded call blocks any further probe until the month rolls over", async () => {
  seedQuota("2026-08", SKT_MONTHLY_CALL_LIMIT);
  const fetchImpl = countingFetch(BEXCO, "벡스코제1전시장");

  const blocked = await getSktCongestion({
    poiId: BEXCO,
    now: new Date("2026-08-20T02:00:00.000Z"),
    env: SKT_ENV,
    fetchImpl,
  });

  assert.equal(blocked.status, "quota_exhausted");
  assert.equal(blocked.state, "unknown");
  assert.equal(blocked.level, null);
  assert.equal(fetchImpl.calls.length, 0, "an exhausted quota must never reach the network");
  assert(blocked.message.includes("다음 달"));
  assert.equal(blocked.quota.used, SKT_MONTHLY_CALL_LIMIT);
});

test("a new month resets the ledger and unblocks probes", async () => {
  seedQuota("2026-08", SKT_MONTHLY_CALL_LIMIT);
  const september = new Date("2026-09-01T03:00:00.000Z");
  assert.deepEqual(readSktQuota(september), {
    month: "2026-09",
    used: 0,
    limit: SKT_MONTHLY_CALL_LIMIT,
    estimated: true,
  });

  const fetchImpl = countingFetch(EVERLAND, "에버랜드", 2, 0.03);
  const result = await getSktCongestion({ poiId: EVERLAND, now: september, env: SKT_ENV, fetchImpl });

  assert.equal(result.status, "ok");
  assert.equal(result.state, "normal");
  assert.equal(result.quota.month, "2026-09");
  assert.equal(result.quota.used, 1);
  assert.equal(fetchImpl.calls.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(quotaPath, "utf8")), { month: "2026-09", used: 1 });
});

test("a place outside the offline index is refused without spending quota", async () => {
  seedQuota("2026-08", 0);
  const fetchImpl = countingFetch("404404", "인덱스 밖");
  const result = await getSktCongestion({
    poiId: "404404",
    now: new Date("2026-08-04T10:00:00.000Z"),
    env: SKT_ENV,
    fetchImpl,
  });

  assert.equal(result.status, "unknown_poi");
  assert.equal(result.poi, null);
  assert.equal(fetchImpl.calls.length, 0);
  assert(result.message.includes("상위 1,000곳"));
  assert.equal(readSktQuota(new Date("2026-08-04T10:00:00.000Z")).used, 0);
});

test("offline search finds MICE venues by partial name at zero quota cost", () => {
  seedQuota("2026-08", 0);
  const coex = searchSktPois("코엑스");
  assert(coex.some((poi) => poi.poiId === COEX && poi.poiName === "코엑스"));

  assert(searchSktPois("킨텍스").some((poi) => poi.poiId === KINTEX));
  assert(searchSktPois(" 벡 스 코 ").some((poi) => poi.poiId === BEXCO), "공백은 무시하고 매칭해야 한다");
  assert.equal(searchSktPois("").length, 0);
  assert.equal(searchSktPois("존재하지않는장소명").length, 0);
  assert.equal(searchSktPois("백화점", 5).length, 5, "결과는 요청한 상한까지만 돌려준다");
  assert.equal(readSktQuota(new Date("2026-08-04T10:00:00.000Z")).used, 0);
});

test("/api/skt-pois searches the bundled index without touching the ledger", async () => {
  seedQuota("2026-08", 2);
  const server = await startWebServer({ host: "127.0.0.1", port: 0 });
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/skt-pois?q=${encodeURIComponent("벡스코")}`);
    const json = await response.json();

    assert.equal(response.status, 200);
    assert.equal(json.query, "벡스코");
    assert(json.pois.some((poi) => poi.poiId === BEXCO && poi.poiName === "벡스코제1전시장"));
    assert(json.pois.length <= 20);
    assert.equal(json.index.indexedCount, 1000);
    assert(json.note.includes("쿼터"));
    assert(json.outOfIndexNote.includes("이름 검색"));
    assert.deepEqual(JSON.parse(readFileSync(quotaPath, "utf8")), { month: "2026-08", used: 2 });

    const empty = await fetch(`http://127.0.0.1:${port}/api/skt-pois?q=`);
    assert.deepEqual((await empty.json()).pois, []);
  } finally {
    server.close();
  }
});

// Exercises the route wiring on the one branch that never reaches SKT: an id outside the bundled
// index. Anything further would spend a real call from the ten the plan allows per month.
test("/api/skt-congestion answers an out-of-index poiId without calling SKT", async () => {
  seedQuota("2026-08", 3);
  const server = await startWebServer({ host: "127.0.0.1", port: 0 });
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/skt-congestion?poiId=404404`);
    const json = await response.json();

    assert.equal(response.status, 200);
    assert.equal(json.status, "unknown_poi");
    assert.equal(json.poi, null);
    assert.equal(json.state, "unknown");
    assert.equal(json.cached, false);
    assert.deepEqual(json.quota, { month: "2026-08", used: 3, limit: SKT_MONTHLY_CALL_LIMIT, estimated: true });
    assert(json.disclaimer.includes("월 10건"));
    assert(typeof json.version === "string" && json.version.length > 0, "버전 필드가 스프레드에 덮이면 안 된다");
    assert.deepEqual(JSON.parse(readFileSync(quotaPath, "utf8")), { month: "2026-08", used: 3 });

    const empty = await fetch(`http://127.0.0.1:${port}/api/skt-congestion?poiId=`);
    assert.equal((await empty.json()).status, "unknown_poi");
    assert.deepEqual(JSON.parse(readFileSync(quotaPath, "utf8")), { month: "2026-08", used: 3 });
  } finally {
    server.close();
  }
});

test("/live ships the national mode switch and its manual probe button", async () => {
  const server = await startWebServer({ host: "127.0.0.1", port: 0 });
  const { port } = server.address();
  try {
    const html = await (await fetch(`http://127.0.0.1:${port}/live`)).text();
    assert(html.includes("전국 SKT(수동)"));
    assert(html.includes("혼잡도 조회"));
    assert(html.includes("/api/skt-pois"));
    assert(html.includes("/api/skt-congestion"));
    // The manual probe must stay out of the 60s cycle: only load() may be scheduled.
    assert(html.includes("setInterval(load, REFRESH_MS)"));
    assert.equal(/setInterval\([^)]*[sS]kt/.test(html), false);
  } finally {
    server.close();
  }
});
