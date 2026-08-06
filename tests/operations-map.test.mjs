import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The store and the pin file both resolve MICE_LOCAL_DIR at call time, so the isolation has to be
// in place before the modules load — hence the dynamic imports below.
const storeDir = mkdtempSync(join(tmpdir(), "mice-ops-map-"));
process.env.MICE_LOCAL_DIR = storeDir;

const { buildOperationsMap } = await import("../build/lib/operations-map.js");
const { startWebServer } = await import("../build/web/server.js");
const {
  assignMiceStaffActionTool,
  initializeMiceRunsheetExecutionTool,
  recordMiceCommandDecisionTool,
  registerMiceSafetyIssueTool,
  updateMiceRunsheetExecutionTool,
} = await import("../build/tools/mice-operations.js");

const cleanupDirs = [storeDir];
after(() => {
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
});

// Captured before anything is registered: a fresh store has to produce an empty board.
const emptyBoard = buildOperationsMap();

const STOPPED_EVENT = "코엑스 국제전시";
const WATCH_EVENT = "킨텍스 산업박람회";
const CALM_EVENT = "수원 컨벤션 시민포럼";

const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const sixHoursOut = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

// critical severity carries a 10 minute SLA, so a detection two hours back is already overdue.
const stoppedIssue = registerMiceSafetyIssueTool.handler({
  eventName: STOPPED_EVENT,
  issueType: "crowd_bottleneck",
  severity: "critical",
  description: "A게이트 대기열이 보행동선을 침범해 압박 발생",
  zone: "A게이트",
  detectedAt: twoHoursAgo,
}).structuredContent.issue;

assignMiceStaffActionTool.handler({
  issueId: stoppedIssue.id,
  title: "A게이트 대기열 분산 배치",
  assignee: "현장1팀",
  dueAt: sixHoursOut,
});

recordMiceCommandDecisionTool.handler({
  eventName: STOPPED_EVENT,
  decisionType: "event_stop",
  level: "full",
  reason: "A게이트 압박으로 입장 중단",
  decidedBy: "안전총괄",
  zone: "A게이트",
});

registerMiceSafetyIssueTool.handler({
  eventName: WATCH_EVENT,
  issueType: "worker_safety",
  severity: "high",
  description: "부스 철거 구역 고소작업 안전대 미착용",
  zone: "3홀",
});

const RUNSHEET_MARKDOWN = [
  "| 단계 | 기준시점 | 권장일자 | 구역/대상 | 확인/조치 | 담당 | 증빙 |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  "| 준비 | D-7 | 2026-08-10 | 전시홀 | 피난통로 유효폭 확인 | 안전관리자 | 점검표 |",
  "| 준비 | D-1 | 2026-08-16 | 게이트 | 대기열 동선 표지 설치 | 운영본부 | 사진 |",
  "| 당일 | D-Day | 2026-08-17 | 전시홀 | 소화기·비상구 최종 확인 | 소방담당 | 점검표 |",
  "| 당일 | D-Day | 2026-08-17 | 의무실 | AED 위치 안내 게시 | 의료팀 | 사진 |",
].join("\n");

const runsheet = (await initializeMiceRunsheetExecutionTool.handler({
  eventName: CALM_EVENT,
  operationsRunsheetMarkdown: RUNSHEET_MARKDOWN,
})).structuredContent;

updateMiceRunsheetExecutionTool.handler({
  itemId: runsheet.items[0].id,
  status: "done",
  updatedBy: "안전관리자",
});

async function withServer(run) {
  const server = await startWebServer({ host: "127.0.0.1", port: 0 });
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

const findEvent = (board, name) => board.events.find((event) => event.eventName === name);

test("an empty store yields an empty board instead of a demo event", async () => {
  assert.deepEqual(emptyBoard.events, []);
  assert.deepEqual(emptyBoard.unlocatedEvents, []);
  assert.equal(emptyBoard.summary.events, 0);
  assert(emptyBoard.emptyNote.includes("register_mice_safety_issue"));
  assert(emptyBoard.emptyNote.includes("initialize_mice_runsheet_execution"));

  // Same answer over HTTP: point the server at a second, untouched store directory.
  const emptyDir = mkdtempSync(join(tmpdir(), "mice-ops-map-empty-"));
  cleanupDirs.push(emptyDir);
  process.env.MICE_LOCAL_DIR = emptyDir;
  try {
    await withServer(async (base) => {
      const response = await fetch(`${base}/api/operations-map`);
      const json = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(json.events, []);
      assert.equal(json.summary.located, 0);
      assert(json.venueOptions.length > 0, "venue choices must exist even with no events");
    });
  } finally {
    process.env.MICE_LOCAL_DIR = storeDir;
  }
});

test("events are aggregated from issues, actions, runsheet items and command decisions", () => {
  const board = buildOperationsMap();
  assert.deepEqual(
    board.events.map((event) => event.eventName).sort(),
    [STOPPED_EVENT, WATCH_EVENT, CALM_EVENT].sort(),
  );

  const stopped = findEvent(board, STOPPED_EVENT);
  assert.equal(stopped.issues.open, 1);
  assert.equal(stopped.issues.bySeverity.critical, 1);
  assert.equal(stopped.actions.open, 1);
  assert.equal(stopped.sla.overdue, 1, "the two-hour-old critical issue is past its 10 minute SLA");
  assert.equal(stopped.sla.worst, "overdue");
  assert.equal(stopped.activeCommandDecisions.length, 1);
  assert.equal(stopped.activeCommandDecisions[0].decisionType, "event_stop");
  assert.equal(stopped.activeCommandDecisions[0].label, "행사 중단");
  assert(stopped.lastActivityAt);

  const calm = findEvent(board, CALM_EVENT);
  assert.equal(calm.runsheet.total, 4);
  assert.equal(calm.runsheet.done, 1);
  assert.equal(calm.runsheet.blocked, 0);
  assert.equal(calm.issues.open, 0);
});

test("state judgment separates a stopped event from a watch and a quiet one", () => {
  const board = buildOperationsMap();
  assert.equal(findEvent(board, STOPPED_EVENT).state, "critical");
  assert.equal(findEvent(board, WATCH_EVENT).state, "watch");
  assert.equal(findEvent(board, CALM_EVENT).state, "normal");

  const reasons = findEvent(board, STOPPED_EVENT).stateReasons.join(" ");
  assert(reasons.includes("행사 중단"), reasons);
  assert(reasons.includes("critical 이슈 SLA 초과"), reasons);
  assert(findEvent(board, WATCH_EVENT).stateReasons.join(" ").includes("high 이슈"));

  // Worst state first, so the board opens on the event that needs a decision.
  assert.equal(board.events[0].eventName, STOPPED_EVENT);
  assert.equal(board.summary.critical, 1);
  assert.equal(board.summary.watch, 1);
});

test("the task strip mixes issues and actions, most urgent first", () => {
  const stopped = findEvent(buildOperationsMap(), STOPPED_EVENT);
  assert.equal(stopped.tasks.length, 2);

  const [first, second] = stopped.tasks;
  assert.equal(first.kind, "issue");
  assert.equal(first.slaState, "overdue");
  assert.equal(first.team, "인파·동선팀");
  assert.equal(first.zone, "A게이트");
  assert.equal(second.kind, "action");
  assert.equal(second.slaState, "normal", "the action is due in six hours");
  assert.equal(second.title, "A게이트 대기열 분산 배치");
  assert.equal(second.dueAt, sixHoursOut);
});

test("pinning an event writes event-locations.json and puts it on the map", async () => {
  await withServer(async (base) => {
    const before = await (await fetch(`${base}/api/operations-map`)).json();
    assert.equal(before.summary.located, 0);
    assert.deepEqual(before.unlocatedEvents.sort(), [STOPPED_EVENT, WATCH_EVENT, CALM_EVENT].sort());

    const response = await fetch(`${base}/api/operations-map/location`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventName: STOPPED_EVENT, venueId: "coex" }),
    });
    const saved = await response.json();
    assert.equal(response.status, 200);
    assert.equal(saved.location.venueId, "coex");
    assert.equal(saved.location.label, "코엑스");
    assert.equal(typeof saved.location.lat, "number");

    const pinFile = JSON.parse(readFileSync(join(storeDir, "event-locations.json"), "utf8"));
    assert.equal(pinFile[STOPPED_EVENT].venueId, "coex");

    const after = await (await fetch(`${base}/api/operations-map`)).json();
    assert.equal(after.summary.located, 1);
    assert.equal(findEvent(after, STOPPED_EVENT).location.venueId, "coex");
    assert.equal(findEvent(after, WATCH_EVENT).location, null);
    assert.deepEqual(after.unlocatedEvents.sort(), [WATCH_EVENT, CALM_EVENT].sort());

    // A raw coordinate is accepted too; an unknown venue is rejected rather than guessed.
    const byCoords = await fetch(`${base}/api/operations-map/location`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventName: WATCH_EVENT, lat: 37.6683, lng: 126.7449, label: "킨텍스 제1전시장" }),
    });
    assert.equal(byCoords.status, 200);
    assert.equal((await byCoords.json()).location.source, "coords");

    const rejected = await fetch(`${base}/api/operations-map/location`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventName: CALM_EVENT, venueId: "no_such_venue" }),
    });
    assert.equal(rejected.status, 400);
    assert.equal((await (await fetch(`${base}/api/operations-map`)).json()).summary.located, 2);
  });
});

test("a blocked runsheet item moves a quiet event to watch", () => {
  updateMiceRunsheetExecutionTool.handler({
    itemId: runsheet.items[1].id,
    status: "blocked",
    note: "표지 자재 미입고",
    updatedBy: "운영본부",
  });
  const calm = findEvent(buildOperationsMap(), CALM_EVENT);
  assert.equal(calm.runsheet.blocked, 1);
  assert.equal(calm.state, "watch");
  assert(calm.stateReasons.join(" ").includes("런시트 막힘"));
});

test("/live opens on a three-tab board with the map on the home tab", async () => {
  await withServer(async (base) => {
    const page = await fetch(`${base}/live`);
    const html = await page.text();
    assert.equal(page.status, 200);

    assert(html.includes('data-tab="home"'));
    assert(html.includes('data-tab="live"'));
    assert(html.includes('data-tab="laws"'));
    assert(html.includes('id="tab-home"'));
    assert(html.includes('id="tab-live"'));
    assert(html.includes('id="tab-laws"'));

    // Home is the default: it is the only tab that is not hidden in the served markup.
    assert(html.includes('<button class="tab-btn active" type="button" role="tab" aria-selected="true" aria-controls="tab-home" data-tab="home">'));
    assert(html.includes('<div id="tab-home" class="tab-panel" role="tabpanel">'));
    assert(html.includes('<div id="tab-live" class="tab-panel" role="tabpanel" hidden>'));
    assert(html.includes('<div id="tab-laws" class="tab-panel" role="tabpanel" hidden>'));

    // The map belongs to the home tab and re-measures when that tab becomes visible again.
    assert(html.indexOf('id="tab-home"') < html.indexOf('<div id="map"></div>'));
    assert(html.indexOf('<div id="map"></div>') < html.indexOf('id="tab-live"'));
    assert(html.includes("map.invalidateSize()"));

    // Home polls the local store on the same cycle; the SKT probe and the briefing stay manual.
    assert(html.includes('fetch("/api/operations-map")'));
    assert(html.includes("setInterval(loadOps, REFRESH_MS)"));
    assert(html.includes("/api/operations-map/location"));
    assert.equal(html.includes("setInterval(requestSktCongestion"), false);
    assert.equal(html.includes("setInterval(requestBriefing"), false);

    // The live signal cards stay on their own tab, in their existing order.
    assert(html.indexOf('id="tab-live"') < html.indexOf('id="sktSection"'));
    assert(html.indexOf('id="sktSection"') < html.indexOf('id="panels"'));
  });
});
