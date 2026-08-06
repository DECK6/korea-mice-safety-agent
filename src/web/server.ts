import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { ZodError, type AnyZodObject } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import {
  AI_BRIEFING_DISCLAIMER,
  AiBridgeError,
  buildBriefingPrompt,
  detectEngines,
  runBriefing,
} from "../lib/ai-bridge.js";
import { assessHeatRisk } from "../lib/heat-thresholds.js";
import { queryLiveOperationsStatus, type LiveOperationsStatus, type OperationalEvidence } from "../lib/live-operations-adapters.js";
import { baseMiceEventInputSchema } from "../lib/mice-event-input-schema.js";
import { MICE_DATA, strictnessLabel } from "../lib/mice-data.js";
import { PERSONA_PRESETS } from "../lib/mice-personas.js";
import { buildOperationsMap, saveEventLocation } from "../lib/operations-map.js";
import {
  getSktCongestion,
  searchSktPois,
  SKT_OUT_OF_INDEX_NOTE,
  SKT_POI_INDEX_META,
  SKT_POI_SEARCH_NOTE,
} from "../lib/skt-place-congestion.js";
import type { Strictness } from "../lib/types.js";
import { generateMiceSafetyPlanTool } from "../tools/generate-mice-safety-plan.js";
import { queryMiceSafetyApplicabilityTool } from "../tools/query-mice-safety-applicability.js";
import { reviewMiceSafetyPlanTool } from "../tools/review-mice-safety-plan.js";
import { stressTestMiceSafetyPlanTool } from "../tools/stress-test-mice-safety-plan.js";
import { SERVER_NAME, VERSION } from "../version.js";

type AnyRecord = Record<string, unknown>;

interface WebServerOptions {
  host?: string;
  port?: number;
}

function toArray(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value as AnyRecord[] : [];
}

function isPlainRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function strictnessValue(value: unknown): Strictness {
  const text = String(value ?? "needs_review");
  if ([
    "statutory_required",
    "administrative_rule",
    "local_required",
    "venue_required",
    "common_best_practice",
    "needs_review",
  ].includes(text)) {
    return text as Strictness;
  }
  return "needs_review";
}

const SHARED_STYLE = `    :root {
      color-scheme: light;
      --bg: #f6f8fb;
      --paper: #ffffff;
      --ink: #172033;
      --muted: #667085;
      --line: #d9e0ea;
      --blue: #315fc7;
      --blue-soft: #eaf1ff;
      --green: #157a4f;
      --green-soft: #eaf8f1;
      --yellow: #98690a;
      --yellow-soft: #fff5d6;
      --red: #c23a3a;
      --red-soft: #fff0ee;
      --shadow: 0 18px 50px rgba(39, 51, 82, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif;
      line-height: 1.55;
      letter-spacing: 0;
    }
    button, input, select {
      font: inherit;
    }
    button {
      min-height: 38px;
      border: 1px solid #b8c7e6;
      border-radius: 8px;
      background: var(--blue);
      color: #fff;
      font-weight: 800;
      cursor: pointer;
      padding: 8px 13px;
    }
    button.secondary {
      background: #fff;
      color: #334155;
      border-color: var(--line);
    }
    button:disabled { opacity: .6; cursor: not-allowed; }
    .page { max-width: 1240px; margin: 0 auto; padding: 28px 22px 54px; }
    .topbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 18px; }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 6px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--paper);
      color: #334155;
      font-size: 13px;
      font-weight: 800;
    }
    .badge.primary { color: var(--blue); border-color: #b9c9f5; background: var(--blue-soft); }
    a.badge { text-decoration: none; }
    .heading {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: flex-start;
      margin-bottom: 18px;
    }
    h1 { margin: 0; font-size: clamp(30px, 4vw, 48px); line-height: 1.08; }
    h2 { margin: 0 0 14px; font-size: 21px; line-height: 1.25; }
    h3 { margin: 0 0 8px; font-size: 16px; }
    p { margin: 0 0 10px; }
    .muted { color: var(--muted); }
    .layout { display: grid; grid-template-columns: minmax(320px, 430px) 1fr; gap: 18px; align-items: start; }
    .card, .mini-card, .empty {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }
    .card { padding: 20px; margin-bottom: 16px; }
    .mini-card { padding: 15px; box-shadow: none; }
    .form-grid { display: grid; gap: 14px; }
    label { display: block; color: #475569; font-size: 13px; font-weight: 800; margin-bottom: 6px; }
    input[type="text"], input[type="number"], select {
      width: 100%;
      min-height: 40px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      padding: 8px 10px;
    }
    .checkbox-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .check {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
      background: #fbfdff;
      color: #334155;
      font-weight: 700;
      font-size: 13px;
    }
    .check input { accent-color: var(--blue); }
    .sample-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat strong { display: block; font-size: clamp(18px, 3vw, 30px); color: var(--blue); line-height: 1.05; overflow-wrap: anywhere; }
    .stat span { color: var(--muted); font-size: 13px; font-weight: 800; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .card-topline { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; margin-bottom: 8px; }
    .pill, .chip {
      display: inline-flex;
      align-items: center;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      color: #334155;
      padding: 5px 8px;
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 7px; }
    .tone-good { border-color: #93d5b7; background: var(--green-soft); }
    .tone-good .pill, .tone-good strong, .chip.good { color: var(--green); }
    .tone-warning { border-color: #ead28a; background: var(--yellow-soft); }
    .tone-warning .pill, .tone-warning strong, .chip.warn { color: var(--yellow); }
    .tone-danger { border-color: #f1a5a5; background: var(--red-soft); }
    .tone-danger .pill, .tone-danger strong, .chip.danger { color: var(--red); }
    .tone-muted { border-color: var(--line); background: #f8fafc; }
    .list { display: grid; gap: 10px; }
    .compact-list { margin: 0; padding-left: 18px; }
    .compact-list li + li { margin-top: 5px; }
    .empty { padding: 34px; color: var(--muted); text-align: center; }
    .notice { border-left: 4px solid var(--yellow); background: #fffaf0; padding: 13px 15px; border-radius: 8px; color: #56410c; }
    .error { border-left-color: var(--red); background: var(--red-soft); color: #7f1d1d; }
    @media (max-width: 980px) {
      .layout { grid-template-columns: 1fr; }
      .heading { display: block; }
    }
    @media (max-width: 720px) {
      .page { padding: 18px 12px 42px; }
      .stats, .grid, .checkbox-grid { grid-template-columns: 1fr; }
    }
    @media print {
      body { background: #fff; }
      .page { max-width: none; padding: 0; }
      .topbar, .input-panel, .actions, .sample-row { display: none; }
      .layout { display: block; }
      .card, .mini-card, .empty { box-shadow: none; break-inside: avoid; }
    }`;

// Both the simulator form and the live dashboard's law tab offer the same event-type choices, so
// the list lives here instead of drifting apart in two inline scripts.
const EVENT_TYPE_OPTIONS: Array<[string, string]> = [
  ["exhibition", "전시·박람회"],
  ["conference", "컨벤션·회의"],
  ["festival", "축제"],
  ["outdoor_event", "옥외행사"],
  ["performance", "공연"],
  ["food_event", "식음료"],
  ["vip_event", "VIP"],
];

function htmlPage(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MICE 행사 안전 적용성 체크리스트</title>
  <style>
${SHARED_STYLE}
  </style>
</head>
<body>
  <main class="page">
    <div class="topbar">
      <span class="badge primary">${SERVER_NAME} v${VERSION}</span>
      <span class="badge">offline ontology web simulator</span>
      <span class="badge">query_mice_safety_applicability</span>
      <span class="badge">generate/review plan</span>
      <a class="badge primary" href="/live">현장 라이브 대시보드 →</a>
    </div>
    <section class="heading">
      <div>
        <h1>MICE 행사 안전 적용성 체크리스트</h1>
        <p class="muted">행사 조건을 입력하면 적용 법령·조례 후보, 의무 문서, 위험요인, 베뉴 체크포인트가 카드로 정리됩니다.</p>
      </div>
    </section>
    <section class="layout">
      <aside class="card input-panel">
        <h2>행사 조건</h2>
        <form id="sim-form" class="form-grid">
          <div>
            <label for="eventName">행사명</label>
            <input id="eventName" name="eventName" type="text" placeholder="예: 고양 야외 푸드 페스티벌">
          </div>
          <div>
            <label>행사 유형</label>
            <div id="eventTypes" class="checkbox-grid"></div>
          </div>
          <div>
            <label for="expectedCrowd">예상 인파 수</label>
            <input id="expectedCrowd" name="expectedCrowd" type="number" min="0" step="100" value="5000">
          </div>
          <div>
            <label for="venueId">베뉴</label>
            <select id="venueId" name="venueId"></select>
          </div>
          <div>
            <label for="jurisdiction">관할 지자체</label>
            <input id="jurisdiction" name="jurisdiction" type="text" list="jurisdictionOptions" placeholder="예: 경기도 고양시">
            <datalist id="jurisdictionOptions"></datalist>
          </div>
          <div>
            <label>특수 조건</label>
            <div id="featureFlags" class="checkbox-grid"></div>
          </div>
          <div>
            <label for="personaPreset">합성 관람객 안전 QA</label>
            <select id="personaPreset" name="personaPreset"></select>
            <label for="cohortSize" style="margin-top:8px">코호트 크기</label>
            <input id="cohortSize" name="cohortSize" type="number" min="10" max="200" step="10" value="100">
            <p class="muted">실제 참석자 예측이 아니라 계획서 사각지대를 찾는 합성 테스트입니다.</p>
          </div>
          <div class="sample-row" aria-label="샘플 입력">
            <button class="secondary" type="button" data-sample="indoor">실내 전시</button>
            <button class="secondary" type="button" data-sample="festival">옥외축제</button>
            <button class="secondary" type="button" data-sample="vip">VIP 컨벤션</button>
            <button class="secondary" type="button" data-sample="unhosted">무주최 운집</button>
          </div>
          <div class="actions">
            <button id="submitBtn" type="submit">체크리스트 생성</button>
            <button class="secondary" type="button" id="planBtn">계획서 요약·검수</button>
            <button class="secondary" type="button" id="personaBtn">관람객 스트레스 테스트</button>
            <button class="secondary" type="button" id="printBtn">인쇄</button>
            <span id="status" class="muted"></span>
          </div>
        </form>
      </aside>
      <section id="result" aria-live="polite">
        <div class="empty">
          <strong>입력 후 체크리스트를 생성하세요.</strong>
          <p>결과는 현재 repo에 포함된 오프라인 온톨로지에서만 계산됩니다.</p>
        </div>
      </section>
    </section>
  </main>
  <script>
    const EVENT_TYPES = ${JSON.stringify(EVENT_TYPE_OPTIONS)};
    const FEATURES = [
      ["outdoorEvent", "완전/부분 옥외"],
      ["roadUse", "도로점용·교통통제"],
      ["temporaryStructures", "임시구조물"],
      ["temporaryElectricity", "임시전기"],
      ["setupTeardown", "설치·철거 작업"],
      ["workAtHeight", "고소작업"],
      ["heavyObjectHandling", "중량물·하역"],
      ["hotWork", "화기작업"],
      ["foodService", "식음료 판매"],
      ["lpgUse", "LPG 사용"],
      ["performance", "무대·공연"],
      ["personalDataProcessing", "개인정보 처리"],
      ["vipSecurity", "VIP·보안검색"],
      ["unhostedCrowd", "무주최 다중운집"]
    ];
    const SAMPLES = {
      indoor: {
        eventName: "실내 전시회 시뮬레이션",
        eventTypes: ["exhibition"],
        venueId: "coex",
        jurisdiction: "서울특별시 강남구",
        expectedCrowd: 6000,
        temporaryStructures: true,
        temporaryElectricity: true,
        setupTeardown: true,
        workAtHeight: true,
        heavyObjectHandling: true,
        personalDataProcessing: true
      },
      festival: {
        eventName: "옥외축제 시뮬레이션",
        eventTypes: ["festival", "outdoor_event", "food_event"],
        jurisdiction: "경기도 고양시",
        expectedCrowd: 8000,
        outdoorEvent: true,
        roadUse: true,
        temporaryStructures: true,
        temporaryElectricity: true,
        setupTeardown: true,
        foodService: true,
        lpgUse: true
      },
      vip: {
        eventName: "VIP 컨벤션 시뮬레이션",
        eventTypes: ["conference", "vip_event"],
        venueId: "kintex",
        jurisdiction: "경기도 고양시",
        expectedCrowd: 1200,
        personalDataProcessing: true,
        vipSecurity: true
      },
      unhosted: {
        eventName: "역세권 무주최 다중운집 시뮬레이션",
        eventTypes: ["outdoor_event"],
        jurisdiction: "서울특별시 중구",
        expectedCrowd: 10000,
        outdoorEvent: true,
        unhostedCrowd: true
      }
    };
    const $ = (selector) => document.querySelector(selector);
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
    const toneForRisk = (level) => /high|높|상|critical|긴급/i.test(level) ? "tone-danger" : /medium|중|보통|확인/i.test(level) ? "tone-warning" : "tone-muted";
    const toneForDecision = (status) => /비적용/.test(status) ? "tone-muted" : /조건부|확인/.test(status) ? "tone-warning" : "tone-good";
    function chip(label, cls = "") {
      return '<span class="chip ' + cls + '">' + escapeHtml(label) + '</span>';
    }
    function card(title, status, body, tone = "tone-muted") {
      return '<article class="mini-card ' + tone + '"><div class="card-topline"><strong>' + escapeHtml(title) + '</strong><span class="pill">' + escapeHtml(status) + '</span></div><p>' + escapeHtml(body) + '</p></article>';
    }
    function list(items) {
      return '<ul class="compact-list">' + items.map((item) => '<li>' + escapeHtml(item) + '</li>').join("") + '</ul>';
    }
    function renderCheckboxes(target, items, checked = []) {
      target.innerHTML = items.map(([value, label]) =>
        '<label class="check"><input type="checkbox" value="' + escapeHtml(value) + '"' + (checked.includes(value) ? " checked" : "") + '> ' + escapeHtml(label) + '</label>'
      ).join("");
    }
    function formInput() {
      const eventTypes = Array.from(document.querySelectorAll("#eventTypes input:checked")).map((item) => item.value);
      const input = {
        eventName: $("#eventName").value.trim() || undefined,
        eventTypes,
        venueId: $("#venueId").value || undefined,
        jurisdiction: $("#jurisdiction").value.trim() || undefined,
        expectedCrowd: $("#expectedCrowd").value ? Number($("#expectedCrowd").value) : undefined,
        personaPreset: $("#personaPreset").value || "national",
        cohortSize: $("#cohortSize").value ? Number($("#cohortSize").value) : 100,
        targetProvince: $("#jurisdiction").value.trim() || undefined
      };
      for (const [key] of FEATURES) {
        input[key] = Boolean(document.querySelector('#featureFlags input[value="' + key + '"]')?.checked);
      }
      if (input.outdoorEvent) input.outdoor = true;
      return input;
    }
    function applyInput(input) {
      $("#eventName").value = input.eventName || "";
      $("#expectedCrowd").value = input.expectedCrowd ?? "";
      $("#venueId").value = input.venueId || "";
      $("#jurisdiction").value = input.jurisdiction || "";
      if (input.personaPreset) $("#personaPreset").value = input.personaPreset;
      if (input.cohortSize) $("#cohortSize").value = input.cohortSize;
      for (const box of document.querySelectorAll("#eventTypes input")) box.checked = (input.eventTypes || []).includes(box.value);
      for (const box of document.querySelectorAll("#featureFlags input")) box.checked = Boolean(input[box.value]);
    }
    function renderResult(payload) {
      const summary = payload.summary;
      const data = payload.applicability;
      const laws = data.laws || [];
      const duties = data.duties || [];
      const hazards = data.hazards || [];
      const venueRules = data.venueRules || [];
      const ordinances = data.localOrdinances || [];
      const workerRefs = data.workerSafetyReferences || [];
      const decisions = summary.decisions || [];
      const actions = summary.priorityActions || [];
      const scopeWarnings = data.scopeWarnings || [];
      $("#result").innerHTML = [
        scopeWarnings.length
          ? '<section class="card"><div class="list">' + scopeWarnings.map((warning) => '<div class="notice error">⚠ ' + escapeHtml(warning) + '</div>').join("") + '</div></section>'
          : "",
        '<section class="stats">',
        '<div class="card stat"><strong>' + laws.length + '</strong><span>적용 법령·지침</span></div>',
        '<div class="card stat"><strong>' + duties.length + '</strong><span>의무·문서</span></div>',
        '<div class="card stat"><strong>' + hazards.length + '</strong><span>위험요인</span></div>',
        '<div class="card stat"><strong>' + ordinances.length + '</strong><span>조례 후보</span></div>',
        '</section>',
        '<section class="card">',
        '<h2>' + escapeHtml(payload.input.eventName || "시뮬레이션 결과") + '</h2>',
        '<div class="chips">' + summary.inputFlags.map((item) => chip(item)).join("") + '</div>',
        '<p class="muted">자동 점수는 법적 적합성 점수가 아니라 입력 조건 대비 커버리지 점검값입니다. 최종 적용은 관할기관과 최신 원문 확인이 필요합니다.</p>',
        '</section>',
        '<section class="card"><h2>적용/비적용 판단</h2><div class="grid">',
        decisions.map((item) => card(item.title, item.status, item.reason, toneForDecision(item.status))).join(""),
        '</div></section>',
        '<section class="card"><h2>우선 액션</h2>',
        actions.length ? list(actions.map((item) => item.title + " — " + item.detail)) : '<p class="muted">우선 액션 후보가 없습니다.</p>',
        '</section>',
        '<section class="card"><h2>주요 위험요인</h2><div class="grid">',
        hazards.slice(0, 8).map((h) => card(h.label || h.id, h.riskLevel || "확인", (h.controls || [])[0] || "통제대책 확인 필요", toneForRisk(h.riskLevel))).join("") || '<p class="muted">조건부 위험요인 없음</p>',
        '</div></section>',
        '<section class="card"><h2>의무 문서·체크리스트</h2><div class="list">',
        duties.slice(0, 10).map((d) => card(d.title || d.id, d.strictnessLabel || d.strictness || "확인", d.requiredWhen || "적용 조건 확인 필요", d.strictness === "statutory_required" || d.strictness === "local_required" ? "tone-good" : "tone-muted")).join("") || '<p class="muted">조건부 문서 없음</p>',
        '</div></section>',
        '<section class="card"><h2>법령·조례 근거</h2><div class="grid">',
        laws.slice(0, 10).map((law) => card(law.shortName || law.name || law.id, law.verificationStatus || "확인", law.miceUse || "MICE 적용 근거 확인 필요", "tone-muted")).join(""),
        ordinances.slice(0, 6).map((ord) => card(ord.jurisdiction || "지자체", ord.categoryLabel || "조례", (ord.name || ord.ordinanceName || "조례") + " / 제출기한: " + (ord.submissionDeadline || "확인 필요"), ord.priorityBand === "primary" ? "tone-warning" : "tone-muted")).join(""),
        '</div></section>',
        '<section class="grid">',
        '<div class="card"><h2>베뉴 체크포인트</h2>' + (venueRules.length ? list(venueRules.slice(0, 8).map((r) => r.summary || r.id)) : '<p class="muted">베뉴 미지정 또는 규정 후보 없음</p>') + '</div>',
        '<div class="card"><h2>작업자 안전 근거</h2>' + (workerRefs.length ? list(workerRefs.slice(0, 8).map((r) => r.title + " — " + r.summary)) : '<p class="muted">설치·철거/고소/전기/화기/중량물 조건 없음</p>') + '</div>',
        '</section>',
        '<section class="card"><div class="notice">이 결과는 안전관리 실무 초안입니다. 법률 자문이나 관할기관 승인을 대체하지 않으며, 실제 도면·배치·운영계획으로 보정해야 합니다.</div></section>'
      ].join("");
    }
    function renderPlanReview(payload) {
      const review = payload.review || {};
      const plan = payload.plan || {};
      const summary = plan.executiveSummary || {};
      const findings = review.topFindings || [];
      $("#result").innerHTML = [
        '<section class="stats">',
        '<div class="card stat"><strong>' + escapeHtml(review.verdict || "review") + '</strong><span>검수 판정</span></div>',
        '<div class="card stat"><strong>' + escapeHtml(review.score ?? "-") + '</strong><span>커버리지 점수</span></div>',
        '<div class="card stat"><strong>' + escapeHtml(plan.documentCount || 0) + '</strong><span>문서 묶음</span></div>',
        '<div class="card stat"><strong>' + escapeHtml((review.counts && review.counts.warning) || 0) + '</strong><span>warning</span></div>',
        '</section>',
        '<section class="card">',
        '<h2>' + escapeHtml(payload.input.eventName || "계획서 요약") + '</h2>',
        '<p class="muted">생성 계획서 전문보다 먼저 보는 실무 판단 요약입니다. 법적 효력 판단이 아니라 제출 준비용 초안 검수입니다.</p>',
        '</section>',
        '<section class="grid">',
        '<div class="card"><h2>핵심 위험</h2>' + (summary.keyRisks && summary.keyRisks.length ? list(summary.keyRisks) : '<p class="muted">핵심 위험 후보 없음</p>') + '</div>',
        '<div class="card"><h2>적용 근거</h2>' + (summary.applicableBasis && summary.applicableBasis.length ? list(summary.applicableBasis) : '<p class="muted">적용 근거 후보 없음</p>') + '</div>',
        '</section>',
        '<section class="card"><h2>제출·협의 액션</h2>' + (summary.submissionActions && summary.submissionActions.length ? list(summary.submissionActions) : '<p class="muted">제출·협의 액션 후보 없음</p>') + '</section>',
        '<section class="card"><h2>검수 지적</h2><div class="list">',
        findings.length ? findings.map((f) => card(f.requirementId || f.category || "finding", f.severity || "info", f.message || f.recommendation || "확인 필요", f.severity === "error" ? "tone-danger" : f.severity === "warning" ? "tone-warning" : "tone-muted")).join("") : '<p class="muted">상위 지적 없음</p>',
        '</div></section>',
        '<section class="card"><h2>문서 묶음</h2><div class="chips">' + (plan.documentKeys || []).map((key) => chip(key)).join("") + '</div></section>',
        '<section class="card"><div class="notice">전문 Markdown, CSV, DOCX/XLSX 내보내기는 CLI의 export_mice_safety_plan_bundle에서 수행합니다. 이 화면은 공개 접근용 빠른 시뮬레이터입니다.</div></section>'
      ].join("");
    }
    function renderPersonaStress(payload) {
      const cohort = payload.cohort || {};
      const shares = cohort.shares || {};
      const coverage = payload.personaCoverage || {};
      const base = payload.basePlanReview || {};
      const findings = coverage.findings || [];
      const gaps = findings.filter((item) => item.status === "gap");
      const covered = findings.filter((item) => item.status === "covered");
      const profiles = cohort.representativeProfiles || [];
      const pct = (value) => Math.round(Number(value || 0) * 100) + "%";
      $("#result").innerHTML = [
        '<section class="stats">',
        '<div class="card stat"><strong>' + escapeHtml(cohort.actualSize || 0) + '</strong><span>합성 코호트</span></div>',
        '<div class="card stat"><strong>' + escapeHtml(coverage.score ?? "-") + '</strong><span>사람 중심 QA</span></div>',
        '<div class="card stat"><strong>' + escapeHtml(base.score ?? "-") + '</strong><span>기존 문서 커버리지</span></div>',
        '<div class="card stat"><strong>' + escapeHtml(gaps.length) + '</strong><span>보완 필요</span></div>',
        '</section>',
        '<section class="card">',
        '<h2>' + escapeHtml(cohort.presetLabel || "합성 관람객") + '</h2>',
        '<div class="chips">' + [
          '고령층 ' + pct(shares.senior),
          '가족·보호자 ' + pct(shares.familyCoordination),
          '쉬운 안내 지원 ' + pct(shares.plainLanguageSupport),
          '현장 직군 ' + pct(shares.operationsWorkforce)
        ].map((item) => chip(item)).join("") + '</div>',
        '<p class="muted">Nemotron-Personas-Korea 비식별 소형 샘플 기반 합성 QA입니다. 실제 참석자·행동·의료·사고 확률을 예측하지 않습니다.</p>',
        '</section>',
        '<section class="card"><h2>보완 필요</h2><div class="list">',
        gaps.length ? gaps.map((f) => card(f.title, f.sentinel ? "필수 센티널" : f.priority, f.recommendation, f.priority === "high" ? "tone-danger" : "tone-warning")).join("") : '<p class="muted">주요 페르소나 QA 공백 없음</p>',
        '</div></section>',
        '<section class="card"><h2>확인된 항목</h2><div class="chips">' + (covered.length ? covered.map((f) => chip(f.title, "good")).join("") : '<span class="muted">확인된 항목 없음</span>') + '</div></section>',
        '<section class="card"><h2>대표 합성 프로필</h2><div class="grid">',
        profiles.map((profile) => card(profile.ageBand + " · " + profile.province, profile.occupationGroup, [profile.familyType, profile.educationLevel, profile.occupation].filter(Boolean).join(" / "), "tone-muted")).join(""),
        '</div></section>',
        '<section class="card"><div class="notice">아동·장애 접근성·비한국어 방문객은 표본 빈도와 무관하게 필수 센티널로 검사합니다. 이 결과는 법령 적용 판단을 변경하지 않습니다.</div></section>'
      ].join("");
    }
    async function simulate(event) {
      event?.preventDefault();
      $("#submitBtn").disabled = true;
      $("#status").textContent = "계산 중";
      try {
        const res = await fetch("/api/simulate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(formInput())
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "요청 실패");
        renderResult(json);
        $("#status").textContent = "완료";
      } catch (err) {
        $("#result").innerHTML = '<div class="notice error">' + escapeHtml(err.message || err) + '</div>';
        $("#status").textContent = "오류";
      } finally {
        $("#submitBtn").disabled = false;
      }
    }
    async function generatePlanReview() {
      $("#planBtn").disabled = true;
      $("#status").textContent = "계획서 생성·검수 중";
      try {
        const res = await fetch("/api/plan-review", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(formInput())
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "요청 실패");
        renderPlanReview(json);
        $("#status").textContent = "완료";
      } catch (err) {
        $("#result").innerHTML = '<div class="notice error">' + escapeHtml(err.message || err) + '</div>';
        $("#status").textContent = "오류";
      } finally {
        $("#planBtn").disabled = false;
      }
    }
    async function runPersonaStress() {
      $("#personaBtn").disabled = true;
      $("#status").textContent = "합성 관람객 QA 중";
      try {
        const res = await fetch("/api/persona-stress-test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(formInput())
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "요청 실패");
        renderPersonaStress(json);
        $("#status").textContent = "완료";
      } catch (err) {
        $("#result").innerHTML = '<div class="notice error">' + escapeHtml(err.message || err) + '</div>';
        $("#status").textContent = "오류";
      } finally {
        $("#personaBtn").disabled = false;
      }
    }
    async function init() {
      renderCheckboxes($("#eventTypes"), EVENT_TYPES, ["exhibition"]);
      renderCheckboxes($("#featureFlags"), FEATURES);
      const options = await fetch("/api/options").then((res) => res.json());
      $("#venueId").innerHTML = '<option value="">베뉴 미지정</option>' + options.venues.map((venue) =>
        '<option value="' + escapeHtml(venue.id) + '">' + escapeHtml(venue.name + " / " + venue.region) + '</option>'
      ).join("");
      $("#jurisdictionOptions").innerHTML = options.jurisdictions.map((item) => '<option value="' + escapeHtml(item) + '"></option>').join("");
      $("#personaPreset").innerHTML = options.personaPresets.map((item) =>
        '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(item.label) + '</option>'
      ).join("");
      applyInput(SAMPLES.indoor);
      $("#sim-form").addEventListener("submit", simulate);
      $("#planBtn").addEventListener("click", generatePlanReview);
      $("#personaBtn").addEventListener("click", runPersonaStress);
      $("#printBtn").addEventListener("click", () => window.print());
      for (const button of document.querySelectorAll("[data-sample]")) {
        button.addEventListener("click", () => applyInput(SAMPLES[button.dataset.sample]));
      }
      simulate();
    }
    init();
  </script>
</body>
</html>`;
}

// Seoul is the only jurisdiction that publishes a realtime, base-station backed crowd API, so the
// dashboard ships its area names as presets. Any other place has to come through the local
// government situation room, which is what NATIONWIDE_CROWD_GUIDANCE tells the operator.
// Every name below returned INFO-000 from citydata on 2026-08-04; the API rejects unlisted names,
// so a name that is not a registered POI (e.g. 코엑스, which sits inside 강남 MICE 관광특구) must not
// be added here without checking it first.
const SEOUL_LIVE_HOTSPOTS = [
  "강남역",
  "강남 MICE 관광특구",
  "잠실 관광특구",
  "잠실종합운동장",
  "잠실한강공원",
  "여의도한강공원",
  "반포한강공원",
  "뚝섬한강공원",
  "서울숲공원",
  "월드컵공원",
  "광화문·덕수궁",
  "명동 관광특구",
  "이태원 관광특구",
  "홍대 관광특구",
  "신촌·이대역",
  "DDP(동대문디자인플라자)",
  "성수카페거리",
  "서울역",
  "고속터미널역",
  "건대입구역",
];

const DEFAULT_SEOUL_AREA = "강남역";
const DEFAULT_AIR_STATION = "종로구";
const SEOUL_JURISDICTION = "서울특별시";

const LIVE_DISCLAIMER =
  "이 화면의 값은 법령 적용 근거가 아니라 현장 운영 판단을 돕는 보조 데이터입니다. 중지·우회·입장제한 결정은 현장 책임자 판단과 경찰·소방·지자체 협의로 확정하고, 수치는 각 제공기관 원본으로 재확인하세요.";

const NATIONWIDE_CROWD_GUIDANCE =
  "무료로 쓸 수 있는 실시간 기지국 인파 API는 서울 실시간 도시데이터(자동 갱신)와 SKT 지오비전 퍼즐 장소 혼잡도(월 10건 한도, 전국 모드 수동 조회) 둘뿐입니다. 전국 중점관리지역 약 100곳을 다루는 행정안전부 인파관리지원시스템은 지자체·경찰·소방 상황실 전용이라 공개 API가 없습니다. 둘 다 커버하지 못하는 장소는 관할 지자체 재난상황실과 공동대응 협의를 열어 행사기간 인파 정보 공유를 요청하고, 현장 계수·CCTV 관제·게이트 카운트로 보완하세요.";

const CROWD_COVERAGE_NOTE = "이 카드의 자동 갱신 값은 서울 실시간 도시데이터(기지국 기반) 제공 지역만 조회합니다. 서울 밖은 전국 SKT(수동) 모드로 전환하세요.";

type LivePanelState = "critical" | "warning" | "watch" | "normal" | "unknown";

interface LiveMetric {
  label: string;
  value: string;
}

interface LivePanel {
  id: string;
  label: string;
  state: LivePanelState;
  status: string;
  mode: string;
  summary: string;
  metrics: LiveMetric[];
  warnings: string[];
  note?: string;
}

function findEvidence(status: LiveOperationsStatus, sourceId: string): OperationalEvidence | undefined {
  return status.operationalEvidence.find((item) => item.sourceId === sourceId);
}

function evidenceRecord(item?: OperationalEvidence): AnyRecord {
  const data = item?.data;
  const record = isPlainRecord(data) ? data.record : undefined;
  return isPlainRecord(record) ? record : {};
}

function evidenceFields(item?: OperationalEvidence): AnyRecord {
  const fields = evidenceRecord(item).fields;
  return isPlainRecord(fields) ? fields : {};
}

function evidenceState(item?: OperationalEvidence): LivePanelState {
  const data = item?.data;
  const riskState = isPlainRecord(data) ? String(data.riskState ?? "") : "";
  return ["critical", "warning", "watch", "normal"].includes(riskState) ? riskState as LivePanelState : "unknown";
}

// A panel with no data must say why instead of rendering an empty card.
function noDataSummary(item?: OperationalEvidence): string {
  switch (item?.status) {
    case "live_error":
      return "실시간 조회에 실패했습니다. 제공기관 API 상태와 요청 지역/측정소 이름을 확인하세요.";
    case "not_configured":
      return "API 키 미설정 상태라 실시간 값이 없습니다.";
    case "pending_key":
      return "API 키 발급 대기 상태라 실시간 연동이 없습니다.";
    case "unsupported_region":
      return "서울 실시간 도시데이터 제공 지역이 아닙니다.";
    default:
      return "수집된 실시간 값이 없습니다.";
  }
}

function evidenceSummary(item?: OperationalEvidence): string {
  const data = item?.data;
  const summary = isPlainRecord(data) ? String(data.summary ?? "") : "";
  return summary || noDataSummary(item);
}

function numberText(value: unknown, suffix = ""): string | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toLocaleString("ko-KR")}${suffix}` : undefined;
}

function pushMetric(metrics: LiveMetric[], label: string, value?: string): void {
  if (value) metrics.push({ label, value });
}

function precipitationLabel(code: unknown): string | undefined {
  const labels: Record<string, string> = {
    "0": "없음",
    "1": "비",
    "2": "비/눈",
    "3": "눈",
    "5": "빗방울",
    "6": "빗방울눈날림",
    "7": "눈날림",
  };
  return labels[String(code ?? "")];
}

function airGradeLabel(grade: unknown): string | undefined {
  const labels: Record<string, string> = { "1": "좋음", "2": "보통", "3": "나쁨", "4": "매우나쁨" };
  return labels[String(grade ?? "")];
}

function crowdPanel(status: LiveOperationsStatus, areaName?: string): LivePanel & {
  areaName: string | null;
  nationwideGuidance: string | null;
} {
  const item = findEvidence(status, "SEOUL_REALTIME_CITY_DATA");
  const fields = evidenceFields(item);
  const metrics: LiveMetric[] = [];
  const resolvedArea = String(evidenceRecord(item).title ?? areaName ?? "");
  pushMetric(metrics, "지역", resolvedArea || undefined);
  pushMetric(metrics, "혼잡도 등급", fields.congestionLevel ? String(fields.congestionLevel) : undefined);
  const min = numberText(fields.minPopulation);
  const max = numberText(fields.maxPopulation);
  pushMetric(metrics, "실시간 인구 추정", min && max ? `${min}~${max}명` : min ?? max);
  pushMetric(metrics, "인파 갱신시각", fields.updatedAt ? String(fields.updatedAt) : undefined);
  pushMetric(metrics, "서울시 안내", fields.congestionMessage ? String(fields.congestionMessage) : undefined);
  return {
    id: "crowd",
    label: "인파 밀집",
    state: evidenceState(item),
    status: String(item?.status ?? "unavailable"),
    mode: String(item?.freshness.mode ?? "not_collected"),
    summary: evidenceSummary(item),
    metrics,
    warnings: item?.warnings ?? [],
    note: CROWD_COVERAGE_NOTE,
    areaName: areaName ?? null,
    nationwideGuidance: item?.status === "unsupported_region" ? NATIONWIDE_CROWD_GUIDANCE : null,
  };
}

function weatherPanel(status: LiveOperationsStatus): LivePanel & {
  heat: { level: string; label: string; apparentTemperatureC: number | null };
} {
  const item = findEvidence(status, "KMA_APIHUB_WEATHER");
  const fields = evidenceFields(item);
  const heat = assessHeatRisk(fields.temperatureC, fields.humidityPct);
  const hasObservation = Object.keys(fields).length > 0;
  const metrics: LiveMetric[] = [];
  pushMetric(metrics, "기온", numberText(fields.temperatureC, "℃"));
  pushMetric(metrics, "습도", numberText(fields.humidityPct, "%"));
  pushMetric(metrics, "체감온도", heat.apparentTemperatureC === undefined ? undefined : `${heat.apparentTemperatureC}℃`);
  pushMetric(metrics, "풍속", numberText(fields.windSpeedMs, "m/s"));
  pushMetric(metrics, "1시간 강수", numberText(fields.precipitationMm, "mm"));
  pushMetric(metrics, "강수형태", precipitationLabel(fields.precipitationType));
  pushMetric(metrics, "관측 기준", fields.baseDate ? `${String(fields.baseDate)} ${String(fields.baseTime ?? "")}`.trim() : undefined);
  return {
    id: "weather",
    label: "날씨·폭염",
    state: evidenceState(item),
    status: String(item?.status ?? "unavailable"),
    mode: String(item?.freshness.mode ?? "not_collected"),
    summary: evidenceSummary(item),
    metrics,
    warnings: item?.warnings ?? [],
    heat: {
      level: hasObservation ? heat.level : "unknown",
      label: !hasObservation
        ? "관측 없음"
        : heat.level === "warning"
          ? "폭염경보급"
          : heat.level === "advisory"
            ? "폭염주의보급"
            : "폭염 신호 없음",
      apparentTemperatureC: heat.apparentTemperatureC ?? null,
    },
  };
}

function airPanel(status: LiveOperationsStatus, stationName: string): LivePanel & { stationName: string } {
  const item = findEvidence(status, "AIRKOREA_AIR_QUALITY");
  const fields = evidenceFields(item);
  const metrics: LiveMetric[] = [];
  pushMetric(metrics, "측정소", String(evidenceRecord(item).title ?? stationName));
  const grade = airGradeLabel(fields.khaiGrade);
  pushMetric(metrics, "통합대기환경지수", grade ? `${grade}(${String(fields.khaiValue ?? "-")})` : undefined);
  pushMetric(metrics, "PM10", numberText(fields.pm10Value, "㎍/㎥"));
  pushMetric(metrics, "PM2.5", numberText(fields.pm25Value, "㎍/㎥"));
  pushMetric(metrics, "오존", fields.o3Value ? `${String(fields.o3Value)}ppm` : undefined);
  pushMetric(metrics, "측정시각", fields.dataTime ? String(fields.dataTime) : undefined);
  return {
    id: "air",
    label: "대기질",
    state: evidenceState(item),
    status: String(item?.status ?? "unavailable"),
    mode: String(item?.freshness.mode ?? "not_collected"),
    summary: evidenceSummary(item),
    metrics,
    warnings: item?.warnings ?? [],
    stationName,
  };
}

// ITS traffic and the disaster-message feed have no key yet. They stay on the board so the operator
// sees the gap and falls back to the manual channel instead of assuming the panel is quiet.
function pendingPanel(status: LiveOperationsStatus, sourceId: string, id: string, label: string): LivePanel {
  const item = findEvidence(status, sourceId);
  return {
    id,
    label,
    state: evidenceState(item),
    status: String(item?.status ?? "unavailable"),
    mode: String(item?.freshness.mode ?? "not_collected"),
    summary: item?.warnings[0] ?? noDataSummary(item),
    metrics: [],
    warnings: item?.warnings ?? [],
    note: item?.recommendations[0],
  };
}

export function buildLiveStatusPayload(status: LiveOperationsStatus, query: {
  areaName?: string;
  stationName: string;
  live: boolean;
}): AnyRecord {
  return {
    version: VERSION,
    generatedAt: status.generatedAt,
    query: {
      areaName: query.areaName ?? null,
      stationName: query.stationName,
      live: query.live,
      jurisdiction: status.location.jurisdiction ?? null,
    },
    crowd: crowdPanel(status, query.areaName),
    weather: weatherPanel(status),
    air: airPanel(status, query.stationName),
    traffic: pendingPanel(status, "ITS_TRAFFIC_OPENAPI", "traffic", "교통·돌발"),
    disasterMessage: pendingPanel(status, "SAFETY_DATA_DISASTER_MESSAGE", "disasterMessage", "재난문자"),
    warnings: status.warnings,
    disclaimer: LIVE_DISCLAIMER,
    _meta: COMMON_RESPONSE_META,
  };
}

async function collectLiveStatus(query: {
  areaName?: string;
  stationName: string;
  live: boolean;
}): Promise<AnyRecord> {
  const status = await queryLiveOperationsStatus({
    // The crowd adapter only runs for Seoul, so an empty area means the operator is outside the
    // covered region and should get the situation-room guidance instead of a fabricated reading.
    jurisdiction: query.areaName ? SEOUL_JURISDICTION : undefined,
    seoulAreaName: query.areaName,
    airStationName: query.stationName,
    live: query.live,
  });
  return buildLiveStatusPayload(status, query);
}

async function liveStatus(url: URL): Promise<AnyRecord> {
  const requestedArea = (url.searchParams.get("areaName") ?? DEFAULT_SEOUL_AREA).trim();
  return collectLiveStatus({
    areaName: requestedArea || undefined,
    stationName: (url.searchParams.get("stationName") ?? "").trim() || DEFAULT_AIR_STATION,
    live: url.searchParams.get("live") !== "false",
  });
}

// Local operations store only: no upstream call and no quota, so the home tab can poll it on the
// same 60s cycle as the live panels.
function operationsMap(url: URL): AnyRecord {
  const requested = Number(url.searchParams.get("dueSoonMinutes"));
  return {
    version: VERSION,
    ...buildOperationsMap({
      dueSoonMinutes: Number.isFinite(requested) && requested > 0 ? Math.min(requested, 240) : undefined,
    }),
    _meta: COMMON_RESPONSE_META,
  };
}

function operationsMapLocation(input: unknown): AnyRecord {
  return {
    version: VERSION,
    ...saveEventLocation(input),
    _meta: COMMON_RESPONSE_META,
  };
}

// Offline index lookup only: no upstream call, so it stays out of the quota ledger entirely.
function sktPoiSearch(url: URL): AnyRecord {
  const query = (url.searchParams.get("q") ?? "").trim();
  return {
    version: VERSION,
    query,
    index: SKT_POI_INDEX_META,
    pois: searchSktPois(query, 20),
    note: SKT_POI_SEARCH_NOTE,
    outOfIndexNote: SKT_OUT_OF_INDEX_NOTE,
    _meta: COMMON_RESPONSE_META,
  };
}

async function sktCongestion(url: URL): Promise<AnyRecord> {
  const result = await getSktCongestion({ poiId: url.searchParams.get("poiId") ?? "" });
  return {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    ...result,
    _meta: COMMON_RESPONSE_META,
  };
}

// The AI panel spawns a CLI process on this machine, so it must never answer another host: a
// remote request would otherwise be a remote trigger for local process execution.
export function isLoopbackAddress(address?: string | null): boolean {
  if (!address) return false;
  const normalized = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return normalized === "::1" || normalized === "127.0.0.1" || normalized.startsWith("127.");
}

async function aiEnginesPayload(): Promise<AnyRecord> {
  return {
    version: VERSION,
    engines: await detectEngines(),
    disclaimer: AI_BRIEFING_DISCLAIMER,
    _meta: COMMON_RESPONSE_META,
  };
}

async function aiBriefing(input: unknown): Promise<AnyRecord> {
  const body = isPlainRecord(input) ? input : {};
  const requested = String(body.engine ?? "").trim();
  const engines = await detectEngines();
  const engine = requested
    ? engines.find((item) => item.id === requested)
    : engines.find((item) => item.available);
  if (!engine?.available) {
    throw new AiBridgeError("engine_unavailable", requested
      ? `${requested} CLI를 찾을 수 없습니다. 설치와 로그인 상태를 확인하세요.`
      : "이 머신에 로그인된 Claude Code 또는 Codex CLI가 없습니다.");
  }
  const requestedArea = String(body.areaName ?? DEFAULT_SEOUL_AREA).trim();
  const status = await collectLiveStatus({
    areaName: requestedArea || undefined,
    stationName: String(body.stationName ?? "").trim() || DEFAULT_AIR_STATION,
    live: body.live !== false,
  });
  const question = typeof body.question === "string" ? body.question : undefined;
  const run = await runBriefing(engine.id, buildBriefingPrompt(status, question));
  return {
    version: VERSION,
    engine: run.engine,
    engineLabel: engine.label,
    briefing: run.text,
    elapsedMs: run.elapsedMs,
    query: status.query,
    generatedAt: new Date().toISOString(),
    disclaimer: AI_BRIEFING_DISCLAIMER,
    _meta: COMMON_RESPONSE_META,
  };
}

// The live board is a DEXA "dark exhibition surface": Ink panels, cyan accent, hardware-panel
// chrome (screws, status line, recessed displays). Token names and values below are the ones
// declared in the design system source of truth, /Dev/adxdeck-dexa-daily-main/dexa-theme.css, so an
// audit can diff them line for line. --ok/--watch are the one documented extension: the canonical
// sheet has no amber/green because dexa.art never shows operational state, and this board cannot
// carry critical/watch/normal on red alone. Below :root only the print reset carries a raw colour.
const LIVE_STYLE = `    :root {
      color-scheme: dark;
      /* Surfaces — canonical Ink ladder. Page is the recessed display plane, panels sit on it. */
      --ink: #17181B;
      --ink-display: #0D0E10;
      --ink-key: #2A2B2E;
      --ink-key2: #3A3B3F;
      --ink-key2-wash: rgba(58, 59, 63, 0.35);
      /* Ink type — heading / body / meta. */
      --ink-heading: #F7FAFC;
      --ink-text: #8A8D93;
      --ink-text-dim: #5A5D63;
      /* Dexa Cyan — accent and LIVE mark. Never a status colour: it sits too close to --ok to be
         told apart as one, and on this board it means "chrome", not "safe". */
      --cyan: #5EE7F3;
      --cyan-wash: rgba(94, 231, 243, 0.12);
      --cyan-line: rgba(94, 231, 243, 0.34);
      /* Canonical red is the danger mark. State is never colour alone; every use carries its
         Korean label and an LED. */
      --red: #E0402A;
      --red-wash: rgba(224, 64, 42, 0.14);
      --red-line: rgba(224, 64, 42, 0.48);
      --red-glow: rgba(224, 64, 42, 0.30);
      /* Semantic extension beyond the canonical palette — see the note above. */
      --ok: #34D399;
      --ok-wash: rgba(52, 211, 153, 0.10);
      --ok-line: rgba(52, 211, 153, 0.38);
      --watch: #FBBF24;
      --watch-wash: rgba(251, 191, 36, 0.10);
      --watch-line: rgba(251, 191, 36, 0.38);
      /* Geometry — canonical radii: 16px hardware panel, 12px card, 8px display/button, 6px chip. */
      --radius-hw: 16px;
      --radius: 12px;
      --radius-sm: 8px;
      --radius-xs: 6px;
      --gap: 14px;
      --shadow: 0 18px 44px rgba(0, 0, 0, 0.45);
      /* Canonical stacks. No webfont is loaded — the board has to render on a venue network with
         no outbound access — so the system faces after 'Noto Sans KR' carry Korean when the DEXA
         faces are not installed locally. */
      --font-sans: 'Space Grotesk', 'Pretendard Variable', Pretendard, 'Noto Sans KR', 'Apple SD Gothic Neo', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
    }
    /* Hardware panel — the canonical .hero-panel motif: Ink face, 16px radius, an 8px --ink-key2
       screw at each corner (painted, so it costs no markup) and a mono status line on top. */
    .hw {
      position: relative;
      border-radius: var(--radius-hw);
      background:
        radial-gradient(circle 4px at 14px 14px, var(--ink-key2) 99%, transparent 100%),
        radial-gradient(circle 4px at calc(100% - 14px) 14px, var(--ink-key2) 99%, transparent 100%),
        radial-gradient(circle 4px at 14px calc(100% - 14px), var(--ink-key2) 99%, transparent 100%),
        radial-gradient(circle 4px at calc(100% - 14px) calc(100% - 14px), var(--ink-key2) 99%, transparent 100%),
        var(--ink);
    }
    .hw-status {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 11px 30px 9px;
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.08em;
      color: var(--ink-text);
    }
    .hw-status .live {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      letter-spacing: 0.06em;
      color: var(--cyan);
    }
    .live-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--cyan);
      flex: 0 0 auto;
    }
    .blink { animation: dexa-blink 1.6s infinite; }
    @keyframes dexa-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.15; } }
    @media (prefers-reduced-motion: reduce) { .blink { animation: none; } }
    /* Recessed numeric display — the canonical .hero-display: sunken plane, mono, cyan. */
    .display {
      background: var(--ink-display);
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      color: var(--cyan);
      letter-spacing: 0.06em;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--ink-display);
      color: var(--ink-text);
      font-family: var(--font-sans);
      line-height: 1.55;
    }
    .page { max-width: 1560px; margin: 0 auto; padding: 20px 20px 56px; }
    h1 { margin: 0; font-size: clamp(22px, 2.4vw, 30px); line-height: 1.15; letter-spacing: -0.02em; font-weight: 700; color: var(--ink-heading); }
    h2 { margin: 0 0 12px; font-size: 17px; line-height: 1.3; letter-spacing: -0.01em; font-weight: 700; color: var(--ink-heading); }
    h3 { margin: 0 0 8px; font-size: 15px; font-weight: 700; color: var(--ink-heading); }
    p { margin: 0 0 10px; }
    strong { color: var(--ink-heading); }
    a { color: var(--cyan); }
    .muted { color: var(--ink-text); }
    .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
    /* Micro label — the canonical .dx-kicker: mono, uppercase, wide-tracked, meta colour. */
    .micro {
      display: block;
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--ink-text-dim);
    }
    /* Status LED. Always sits beside a text label, never carries state on its own. */
    .led {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--ink-key2);
      box-shadow: 0 0 0 3px var(--ink-key2-wash);
      flex: 0 0 auto;
    }
    .led.normal, .led.ok { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-wash); }
    .led.watch, .led.warning { background: var(--watch); box-shadow: 0 0 0 3px var(--watch-wash); }
    .led.critical { background: var(--red); box-shadow: 0 0 0 3px var(--red-wash); }
    .led.live { background: var(--cyan); box-shadow: 0 0 0 3px var(--cyan-wash); }
    button, input, select { font: inherit; }
    /* Primary = the canonical .btn-primary inverted for a dark surface: the accent carries the
       fill and Ink carries the text. Signal Orange stays out of here — it is light-chrome only. */
    button {
      min-height: 38px;
      border: none;
      border-radius: var(--radius-sm);
      background: var(--cyan);
      color: var(--ink);
      font-family: var(--font-sans);
      font-weight: 700;
      letter-spacing: 0.02em;
      cursor: pointer;
      padding: 9px 18px;
    }
    button:hover { filter: brightness(1.12); }
    /* Ghost = the canonical .btn-ghost: mono, no fill, meta colour until hover. */
    button.secondary {
      background: transparent;
      color: var(--ink-text);
      border: 1px solid var(--ink-key);
      font-family: var(--font-mono);
      font-weight: 600;
      font-size: 13px;
      letter-spacing: 0.04em;
    }
    button.secondary:hover { filter: none; color: var(--ink-heading); border-color: var(--ink-key2); }
    button:disabled { opacity: .45; cursor: not-allowed; }
    button:disabled:hover { filter: none; }
    button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible {
      outline: 2px solid var(--cyan);
      outline-offset: 2px;
    }
    label {
      display: block;
      font-family: var(--font-mono);
      color: var(--ink-text-dim);
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    input[type="text"], input[type="number"], select {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--ink-key);
      border-radius: var(--radius-sm);
      background: var(--ink-display);
      color: var(--ink-text);
      padding: 8px 10px;
    }
    /* Top status strip — a hardware panel: screws, a mono status line, then the readout cells. */
    .strip { margin-bottom: 16px; box-shadow: var(--shadow); overflow: hidden; }
    .strip-cells {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 26px;
      align-items: center;
      padding: 4px 30px 16px;
    }
    .strip-cell { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .strip-cell strong { font-size: 14px; overflow-wrap: anywhere; }
    .strip-cell .micro { margin-bottom: 2px; }
    .strip-links { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
    /* Canonical .dx-badge-dark: mono micro type in a pill, cyan when it is the live one. */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 30px;
      padding: 5px 12px;
      border: 1px solid var(--ink-key2);
      border-radius: 20px;
      background: transparent;
      color: var(--ink-text);
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 0.08em;
      text-decoration: none;
    }
    .badge.primary { color: var(--cyan); border-color: var(--cyan); }
    .heading { margin-bottom: 16px; }
    .heading p { max-width: 90ch; }
    .tabs { display: flex; gap: 6px; flex-wrap: wrap; border-bottom: 1px solid var(--ink-key); margin-bottom: 16px; }
    .tab-btn {
      background: transparent;
      color: var(--ink-text);
      border: none;
      border-bottom: 2px solid transparent;
      border-radius: var(--radius-sm) var(--radius-sm) 0 0;
      margin-bottom: -1px;
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.06em;
    }
    .tab-btn:hover { filter: none; background: var(--ink); color: var(--ink-heading); }
    .tab-btn.active { background: var(--ink); color: var(--cyan); border-bottom-color: var(--cyan); }
    .tab-panel[hidden] { display: none; }
    .card {
      background: var(--ink);
      border: 1px solid var(--ink-key);
      border-radius: var(--radius);
      padding: 18px;
      margin-bottom: var(--gap);
      box-shadow: var(--shadow);
    }
    .mini-card {
      background: var(--ink-key);
      border: 1px solid var(--ink-key);
      border-radius: var(--radius-sm);
      padding: 14px;
    }
    .empty {
      background: var(--ink);
      border: 1px dashed var(--ink-key);
      border-radius: var(--radius);
      padding: 30px;
      color: var(--ink-text);
      text-align: center;
    }
    .controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; align-items: end; }
    .controls .actions { align-self: end; }
    .actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .check {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      border: 1px solid var(--ink-key);
      border-radius: var(--radius-sm);
      padding: 6px 10px;
      background: var(--ink-display);
      color: var(--ink-text);
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
    }
    .check:hover { border-color: var(--cyan-line); }
    .check input { accent-color: var(--cyan); }
    .checkbox-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .engine-choice { display: flex; flex-wrap: wrap; gap: 8px; }
    .engine-choice .check { flex: 0 1 auto; }
    /* Connection banner — a dropped fetch must not blank the board, so the warning lands here and
       the last good reading stays on screen underneath. */
    .conn-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      border: 1px solid var(--watch-line);
      border-left: 4px solid var(--watch);
      background: var(--watch-wash);
      color: var(--ink-text);
      border-radius: var(--radius-sm);
      padding: 11px 14px;
      margin-bottom: var(--gap);
      font-size: 13px;
      font-weight: 700;
    }
    .conn-banner[hidden] { display: none; }
    /* Stat tiles — the headline readouts. The figure sits in a recessed .hero-display well (mono,
       cyan, --ink-display) and the state colour rides the top rule and the LED, never the number. */
    .stat-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--gap); margin-bottom: var(--gap); }
    .stat-tile {
      position: relative;
      overflow: hidden;
      background: var(--ink);
      border: 1px solid var(--ink-key);
      border-radius: var(--radius);
      padding: 14px 16px 13px;
      box-shadow: var(--shadow);
    }
    .stat-tile::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 2px;
      background: var(--ink-key2);
    }
    .stat-tile.state-normal::before { background: var(--ok); }
    .stat-tile.state-watch::before, .stat-tile.state-warning::before { background: var(--watch); }
    .stat-tile.state-critical::before { background: var(--red); }
    .tile-value {
      display: block;
      margin: 8px 0 8px;
      padding: 10px 14px;
      background: var(--ink-display);
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: clamp(19px, 2.3vw, 28px);
      line-height: 1.15;
      letter-spacing: 0.02em;
      color: var(--cyan);
      overflow-wrap: anywhere;
    }
    .tile-sub { display: block; color: var(--ink-text); font-size: 12px; overflow-wrap: anywhere; }
    .tile-state { display: inline-flex; align-items: center; gap: 6px; margin-top: 9px; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.04em; color: var(--ink-text); }
    .map-panel { box-shadow: var(--shadow); overflow: hidden; }
    /* The rail can outrun the map, so on a wide screen the map tracks the scroll instead of
       leaving a dead column beside it. */
    @media (min-width: 1181px) {
      .map-panel { position: sticky; top: 12px; }
    }
    .map-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 4px 30px 13px; }
    .map-legend { display: flex; gap: 12px; flex-wrap: wrap; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.04em; color: var(--ink-text); }
    .map-legend span { display: inline-flex; align-items: center; gap: 6px; }
    /* The map is a display well cut into the panel face, so it carries --ink-display and the
       recessed radius rather than the panel's own 16px corner. */
    .map-shell { position: relative; background: var(--ink-display); margin: 0 14px; border-radius: var(--radius-sm); overflow: hidden; }
    #map { height: clamp(420px, 62vh, 720px); width: 100%; }
    .map-fallback {
      position: absolute;
      inset: 0;
      z-index: 500;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 6px;
      padding: 24px;
      text-align: center;
      background: var(--ink-display);
      color: var(--ink-text);
      font-size: 13px;
    }
    .map-fallback[hidden] { display: none; }
    .map-fallback strong { color: var(--ink-heading); font-size: 15px; }
    .map-foot { padding: 12px 30px 16px; color: var(--ink-text-dim); font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.04em; }
    /* Leaflet ships a light UI; these rules tone the tiles and its chrome down to the ink theme.
       Saturation is pulled almost out so OSM's parks and roads settle into a neutral dark basemap
       on the --ink-display plane instead of a green slab competing with the status marks.
       Brightness stops short of dimming the labels into unreadability. */
    .map-shell .leaflet-container { background: var(--ink-display); font-family: var(--font-sans); }
    .map-shell .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.76) contrast(1.02) saturate(0.16); }
    .map-shell .leaflet-bar a, .map-shell .leaflet-bar a:hover {
      background: var(--ink-key);
      color: var(--ink-text);
      border-bottom-color: var(--ink-key);
    }
    .map-shell .leaflet-bar { border: 1px solid var(--ink-key); }
    .map-shell .leaflet-control-attribution {
      background: var(--ink);
      color: var(--ink-text);
      font-size: 10px;
    }
    .map-shell .leaflet-control-attribution a { color: var(--cyan); }
    .map-shell .leaflet-popup-content-wrapper, .map-shell .leaflet-popup-tip {
      background: var(--ink-key);
      color: var(--ink-text);
      border: 1px solid var(--ink-key);
      box-shadow: var(--shadow);
    }
    .map-shell .leaflet-popup-content { margin: 11px 13px; font-size: 13px; }
    .map-shell .leaflet-popup-close-button { color: var(--ink-text); }
    .map-shell .leaflet-tooltip {
      background: var(--ink);
      color: var(--ink-text);
      border: 1px solid var(--ink-key);
      box-shadow: none;
    }
    .map-shell .leaflet-tooltip::before { border-top-color: var(--ink-key); }
    .popup-title { display: block; font-weight: 800; margin-bottom: 4px; }
    .popup-line { display: block; color: var(--ink-text); font-size: 12px; }
    /* Home tab — the map is the board; the rail beside it carries the work. */
    .home-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.78fr); gap: var(--gap); align-items: start; }
    .ops-rail { display: grid; gap: var(--gap); }
    .rail-card { padding: 14px 15px; margin-bottom: 0; }
    .rail-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 10px; }
    .rail-head h2 { margin: 0; font-size: 15px; }
    .rail-head .micro { text-align: right; }
    /* A long event or task list scrolls inside its card instead of pushing the map off screen. */
    .row-list { display: grid; gap: 7px; max-height: 320px; overflow-y: auto; }
    /* Rail rows sit on the recessed plane like the canonical .work-card, with the state colour on
       the left key edge instead of a fill. */
    .row-item {
      display: block;
      width: 100%;
      text-align: left;
      min-height: 0;
      border: 1px solid var(--ink-key);
      border-left: 3px solid var(--ink-key2);
      border-radius: var(--radius-xs);
      background: var(--ink-display);
      color: var(--ink-text);
      font-family: var(--font-sans);
      font-weight: 500;
      letter-spacing: 0;
      padding: 10px 12px;
    }
    button.row-item:hover { filter: none; border-color: var(--cyan); }
    .row-item.state-critical { border-left-color: var(--red); }
    .row-item.state-watch { border-left-color: var(--watch); }
    .row-item.state-normal { border-left-color: var(--ok); }
    .row-item.selected { border-color: var(--cyan); background: var(--cyan-wash); }
    .row-title { display: flex; justify-content: space-between; gap: 9px; align-items: baseline; }
    .row-title strong { font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
    .row-meta { display: block; margin-top: 5px; font-family: var(--font-mono); color: var(--ink-text-dim); font-size: 10px; letter-spacing: 0.04em; overflow-wrap: anywhere; }
    .sla-tag { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; white-space: nowrap; color: var(--ink-text-dim); }
    .sla-tag.overdue, .sla-tag.critical { color: var(--red); }
    .sla-tag.due_soon, .sla-tag.watch { color: var(--watch); }
    .sla-tag.normal { color: var(--ok); }
    /* Live summary badges on the map head — .hero-display wells: recessed plane, mono, cyan value.
       A glance at the signal tab without leaving home. */
    .mini-badges { display: flex; gap: 8px; flex-wrap: wrap; }
    .mini-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      border: none;
      border-radius: var(--radius-sm);
      background: var(--ink-display);
      color: var(--cyan);
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0.06em;
      padding: 6px 13px;
    }
    .mini-badge:hover { filter: none; outline: 1px solid var(--cyan-line); }
    .mini-badge .micro { display: inline; color: var(--ink-text-dim); }
    .loc-picker { margin-top: 9px; }
    .loc-picker select { min-height: 34px; font-size: 13px; }
    .leaflet-popup-content .loc-picker label { margin-bottom: 4px; }
    .panel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: var(--gap); }
    /* An author display:grid outranks the UA [hidden] rule, so the national card needs this to hide. */
    .panel-grid[hidden] { display: none; }
    #sktSection { margin-bottom: var(--gap); }
    .panel {
      background: var(--ink);
      border: 1px solid var(--ink-key);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 16px;
    }
    .panel.state-critical { border-color: var(--red-line); background: var(--red-wash); box-shadow: var(--shadow), 0 0 22px -6px var(--red-glow); }
    .panel.state-warning { border-color: var(--watch-line); background: var(--watch-wash); }
    .panel.state-watch { border-color: var(--watch-line); }
    .panel.state-normal { border-color: var(--ok-line); }
    .panel-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; margin-bottom: 8px; }
    .panel-head h3 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; }
    /* Canonical .dx-badge-dark shape: mono micro type in a 20px pill, colour-matched border. */
    .state-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--ink-key2);
      border-radius: 20px;
      background: transparent;
      color: var(--ink-text);
      padding: 4px 10px;
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 0.08em;
      white-space: nowrap;
    }
    .state-pill.critical { color: var(--red); border-color: var(--red-line); }
    .state-pill.warning, .state-pill.watch { color: var(--watch); border-color: var(--watch-line); }
    .state-pill.normal { color: var(--ok); border-color: var(--ok-line); }
    /* Canonical .spec-row: mono key/value pairs, key in meta colour. */
    .metrics { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 5px; }
    .metrics li { display: flex; justify-content: space-between; gap: 14px; border-top: 1px solid var(--ink-key); padding-top: 6px; font-family: var(--font-mono); font-size: 12px; }
    .metrics li span { color: var(--ink-text-dim); white-space: nowrap; }
    .metrics li strong { font-variant-numeric: tabular-nums; text-align: right; overflow-wrap: anywhere; font-weight: 500; color: var(--ink-heading); }
    .panel .notice { margin-top: 12px; font-size: 13px; }
    .source-line { color: var(--ink-text-dim); font-size: 10px; letter-spacing: 0.04em; margin: 10px 0 0; font-family: var(--font-mono); }
    .notice {
      border: 1px solid var(--watch-line);
      border-left: 4px solid var(--watch);
      background: var(--watch-wash);
      padding: 12px 14px;
      border-radius: var(--radius-sm);
      color: var(--ink-text);
    }
    .notice.error { border-color: var(--red-line); border-left-color: var(--red); background: var(--red-wash); }
    .ai-output { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 6px; }
    #aiResult { margin-top: 14px; }
    /* Law tab reuses the simulator's card vocabulary, restyled onto the same dark tokens. */
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: var(--gap); }
    .stat { padding: 14px 16px; }
    .stat strong {
      display: block;
      margin-bottom: 8px;
      padding: 10px 14px;
      background: var(--ink-display);
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: clamp(19px, 2.4vw, 28px);
      letter-spacing: 0.02em;
      color: var(--cyan);
      line-height: 1.15;
      overflow-wrap: anywhere;
    }
    .stat span { font-family: var(--font-mono); color: var(--ink-text-dim); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .list { display: grid; gap: 10px; }
    .card-topline { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; margin-bottom: 6px; }
    .pill, .chip {
      display: inline-flex;
      align-items: center;
      border-radius: 20px;
      border: 1px solid var(--ink-key2);
      background: transparent;
      color: var(--ink-text);
      padding: 4px 9px;
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 0.06em;
      white-space: nowrap;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 7px; }
    .tone-good { border-color: var(--ok-line); background: var(--ok-wash); }
    .tone-good .pill, .tone-good strong, .chip.good { color: var(--ok); }
    .tone-warning { border-color: var(--watch-line); background: var(--watch-wash); }
    .tone-warning .pill, .tone-warning strong, .chip.warn { color: var(--watch); }
    .tone-danger { border-color: var(--red-line); background: var(--red-wash); }
    .tone-danger .pill, .tone-danger strong, .chip.danger { color: var(--red); }
    .compact-list { margin: 0; padding-left: 18px; }
    .compact-list li + li { margin-top: 5px; }
    .law-field { margin-top: 12px; }
    #lawResult .card:first-child { margin-top: 0; }
    @media (max-width: 1180px) {
      .home-grid { grid-template-columns: 1fr; }
      .stat-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 720px) {
      .page { padding: 14px 12px 44px; }
      /* The hardware panels keep their screws, so the inner gutter only narrows to 18px. */
      .hw-status, .strip-cells, .map-head, .map-foot { padding-left: 18px; padding-right: 18px; }
      .strip-cells { gap: 10px 16px; }
      .strip-links { margin-left: 0; }
      .tabs .tab-btn { flex: 1 1 140px; }
      .stat-row, .stats, .grid, .checkbox-grid { grid-template-columns: 1fr; }
      #map { height: 340px; }
    }
    @media print {
      body { background: #fff; color: #000; }
      .page { max-width: none; padding: 0; }
      .tabs, .actions, .map-panel { display: none; }
      .panel, .card, .stat-tile { box-shadow: none; break-inside: avoid; }
    }`;

function livePage(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MICE 현장 운영 라이브 대시보드</title>
  <link rel="stylesheet" href="/vendor/leaflet/leaflet.css">
  <script src="/vendor/leaflet/leaflet.js"></script>
  <style>
${LIVE_STYLE}
  </style>
</head>
<body>
  <main class="page">
    <header class="strip hw">
      <div class="hw-status">
        <span class="path">/ ${SERVER_NAME} / live</span>
        <span class="live"><span class="live-dot blink"></span>LIVE</span>
      </div>
      <div class="strip-cells">
        <div class="strip-cell">
          <div>
            <span class="micro">System</span>
            <strong>v${VERSION}</strong>
          </div>
        </div>
        <div class="strip-cell">
          <div>
            <span class="micro">모니터링 대상</span>
            <strong id="stripArea">—</strong>
          </div>
        </div>
        <div class="strip-cell">
          <div>
            <span class="micro">현재시각</span>
            <strong id="stripClock" class="mono">--:--:--</strong>
          </div>
        </div>
        <div class="strip-cell">
          <div>
            <span class="micro">종합 상태</span>
            <span class="state-pill" id="stripState"><span class="led"></span>확인 필요</span>
          </div>
        </div>
        <div class="strip-cell">
          <div>
            <span class="micro">마지막 갱신</span>
            <strong id="stripUpdated" class="mono">—</strong>
          </div>
        </div>
        <div class="strip-links">
          <span class="badge">60초 자동 갱신</span>
          <a class="badge primary" href="/">← 적용성 체크리스트</a>
        </div>
      </div>
    </header>
    <section class="heading">
      <h1>현장 운영 라이브 대시보드</h1>
      <p class="muted">기본 화면은 행사와 작업이 지도 위에 올라간 상황판입니다. 인파·날씨 같은 실시간 신호와 법령·의무 문서는 옆 탭에서 봅니다.</p>
    </section>
    <div class="tabs" role="tablist">
      <button class="tab-btn active" type="button" role="tab" aria-selected="true" aria-controls="tab-home" data-tab="home">홈 · 행사 지도</button>
      <button class="tab-btn" type="button" role="tab" aria-selected="false" aria-controls="tab-live" data-tab="live">실시간 신호</button>
      <button class="tab-btn" type="button" role="tab" aria-selected="false" aria-controls="tab-laws" data-tab="laws">법령·의무 문서</button>
    </div>
    <!-- Home owns the map instance. The live tab hides it, so every tab switch back has to call
         invalidateSize() or Leaflet keeps the stale size it measured while display:none. -->
    <div id="tab-home" class="tab-panel" role="tabpanel">
      <div class="conn-banner" id="opsBanner" hidden></div>
      <section class="home-grid">
        <section class="map-panel hw">
          <div class="hw-status">
            <span class="path">/ mice / operations / map</span>
            <span class="live"><span class="live-dot blink"></span>LIVE</span>
          </div>
          <div class="map-head">
            <div>
              <span class="micro">Event Operations Map</span>
              <strong>행사 위치 · 작업 상태</strong>
            </div>
            <div class="map-legend">
              <span><span class="led critical"></span>위험</span>
              <span><span class="led watch"></span>주의</span>
              <span><span class="led normal"></span>정상</span>
              <span><span class="led"></span>인파 관측 지점</span>
            </div>
            <div class="mini-badges">
              <button class="mini-badge" type="button" data-goto-live title="실시간 신호 탭으로 이동">
                <span class="led" id="badgeCrowdLed"></span><span class="micro">인파</span><span id="badgeCrowdText">확인 필요</span>
              </button>
              <button class="mini-badge" type="button" data-goto-live title="실시간 신호 탭으로 이동">
                <span class="led" id="badgeHeatLed"></span><span class="micro">폭염</span><span id="badgeHeatText">확인 필요</span>
              </button>
            </div>
          </div>
          <div class="map-shell">
            <div id="map"></div>
            <div class="map-fallback" id="mapFallback" hidden>
              <strong>지도 타일 오프라인</strong>
              <span id="mapFallbackDetail">OpenStreetMap 타일 서버에 연결하지 못했습니다. 좌표와 상태값은 옆 목록에서 그대로 확인할 수 있습니다.</span>
            </div>
          </div>
          <p class="map-foot" id="mapNote">표시 좌표는 지점 식별용 근사값입니다. 거리·수용인원 계산에 쓰지 마세요.</p>
        </section>
        <aside class="ops-rail">
          <section class="card rail-card">
            <div class="rail-head"><h2>행사</h2><span class="micro" id="opsSummary">조회 중</span></div>
            <div id="opsEvents" class="row-list" aria-live="polite">
              <p class="muted">운영 저장소를 불러오는 중입니다.</p>
            </div>
          </section>
          <section class="card rail-card">
            <div class="rail-head"><h2>작업 · SLA 급한 순</h2><span class="micro" id="opsTaskEvent">행사 미선택</span></div>
            <div id="opsTasks" class="row-list" aria-live="polite">
              <p class="muted">행사를 선택하면 이슈·조치가 여기에 표시됩니다.</p>
            </div>
          </section>
          <section class="card rail-card" id="opsUnlocatedCard" hidden>
            <div class="rail-head"><h2>위치 미지정 행사</h2><span class="micro">지도 표시 대상 아님</span></div>
            <div id="opsUnlocated" class="row-list"></div>
          </section>
        </aside>
      </section>
      <section class="card"><div class="notice" id="opsDisclaimer"></div></section>
    </div>
    <div id="tab-live" class="tab-panel" role="tabpanel" hidden>
    <div class="conn-banner" id="connBanner" hidden></div>
    <section class="card">
      <h2>조회 조건</h2>
      <div class="controls">
        <div>
          <label>인파 카드 모드</label>
          <div class="engine-choice" id="crowdMode">
            <label class="check"><input type="radio" name="crowdMode" value="seoul" checked> 서울 실시간(자동)</label>
            <label class="check"><input type="radio" name="crowdMode" value="skt"> 전국 SKT(수동)</label>
          </div>
        </div>
        <div>
          <label for="areaSelect">서울 실시간 인파 지역</label>
          <select id="areaSelect"></select>
        </div>
        <div>
          <label for="areaInput">지역명 직접 입력</label>
          <input id="areaInput" type="text" placeholder="비우면 서울 외 지역으로 처리">
        </div>
        <div>
          <label for="stationInput">대기질 측정소</label>
          <input id="stationInput" type="text" value="${DEFAULT_AIR_STATION}">
        </div>
        <div class="actions">
          <button id="refreshBtn" type="button">새로고침</button>
          <span id="status" class="muted"></span>
        </div>
      </div>
      <p class="muted" id="lastUpdated" style="margin-top:12px"></p>
    </section>
    <!-- The national card keeps its own DOM outside #panels: the 60s cycle rewrites #panels, and a
         rebuild there would wipe the operator's place selection and the manually fetched reading. -->
    <section id="sktSection" class="panel-grid" hidden>
      <article class="panel state-unknown" id="sktPanel">
        <div class="panel-head">
          <h3><span class="led" id="sktLed"></span>인파 밀집 — 전국 SKT(수동)</h3>
          <span class="state-pill" id="sktState">확인 필요</span>
        </div>
        <p class="muted">SKT 지오비전 퍼즐 장소 혼잡도는 무료 플랜 월 10건 한도라 60초 자동 갱신에 넣지 않습니다. 장소 검색은 오프라인 인덱스라 무료이고, <strong>혼잡도 조회</strong> 버튼을 누를 때만 1건을 사용합니다.</p>
        <div class="controls">
          <div>
            <label for="sktSearch">장소 검색(오프라인 인덱스)</label>
            <input id="sktSearch" type="text" placeholder="예: 코엑스, 킨텍스, 벡스코">
          </div>
          <div>
            <label for="sktPoi">장소 선택</label>
            <select id="sktPoi"></select>
          </div>
          <div class="actions">
            <button id="sktBtn" type="button" disabled>혼잡도 조회</button>
            <span id="sktStatus" class="muted"></span>
          </div>
        </div>
        <div id="sktResult"></div>
        <div class="notice" id="sktGuidance" hidden></div>
      </article>
    </section>
    <section class="stat-row">
      <article class="stat-tile" id="tileCrowd">
        <span class="micro">인파 밀집</span>
        <strong class="tile-value">—</strong>
        <span class="tile-sub">조회 대기</span>
        <span class="tile-state"><span class="led"></span>확인 필요</span>
      </article>
      <article class="stat-tile" id="tileHeat">
        <span class="micro">체감온도</span>
        <strong class="tile-value">—</strong>
        <span class="tile-sub">조회 대기</span>
        <span class="tile-state"><span class="led"></span>확인 필요</span>
      </article>
      <article class="stat-tile" id="tileAir">
        <span class="micro">대기질</span>
        <strong class="tile-value">—</strong>
        <span class="tile-sub">조회 대기</span>
        <span class="tile-state"><span class="led"></span>확인 필요</span>
      </article>
      <article class="stat-tile" id="tileAlerts">
        <span class="micro">주의 이상 패널</span>
        <strong class="tile-value">—</strong>
        <span class="tile-sub">조회 대기</span>
        <span class="tile-state"><span class="led"></span>확인 필요</span>
      </article>
    </section>
    <section id="panels" class="panel-grid" aria-live="polite">
      <div class="empty">실시간 상태를 불러오는 중입니다.</div>
    </section>
    <section class="card" style="margin-top:16px">
      <h2>AI 상황 브리핑</h2>
      <p class="muted">이 머신에 로그인된 공식 CLI를 그대로 실행합니다. API 키를 쓰지 않고, 로컬(127.0.0.1) 요청에서만 동작합니다. 자동 갱신에 포함되지 않으며 버튼을 누를 때만 실행합니다.</p>
      <div id="aiEngines" class="engine-choice"></div>
      <div class="controls" style="margin-top:12px">
        <div>
          <label for="aiQuestion">질문(선택)</label>
          <input id="aiQuestion" type="text" placeholder="비우면 현재 상황 브리핑을 생성합니다">
        </div>
        <div class="actions">
          <button id="aiBtn" type="button" disabled>AI 상황 브리핑</button>
          <span id="aiStatus" class="muted"></span>
        </div>
      </div>
      <div id="aiResult"></div>
    </section>
    <section class="card" style="margin-top:16px"><div class="notice" id="disclaimer"></div></section>
    </div>
    <!-- Offline ontology lookup: no upstream call and no quota, but it answers to the entered event
         conditions, so it runs on the button instead of the 60s cycle. -->
    <div id="tab-laws" class="tab-panel" role="tabpanel" hidden>
      <section class="card">
        <h2>행사 조건</h2>
        <p class="muted">이 행사에 적용되는 법령·지침과 제출해야 할 의무 문서를 오프라인 온톨로지에서 조회합니다. 실시간 데이터와 무관하며 자동 갱신하지 않습니다.</p>
        <div class="controls">
          <div>
            <label for="lawCrowd">예상 인파 수</label>
            <input id="lawCrowd" type="number" min="0" step="100" value="5000">
          </div>
          <div>
            <label for="lawVenue">베뉴</label>
            <select id="lawVenue"><option value="">베뉴 미지정</option></select>
          </div>
          <div>
            <label for="lawJurisdiction">관할 지자체</label>
            <input id="lawJurisdiction" type="text" list="lawJurisdictions" placeholder="예: 경기도 고양시">
            <datalist id="lawJurisdictions"></datalist>
          </div>
          <div class="actions">
            <button id="lawBtn" type="button">적용성 조회</button>
            <span id="lawStatus" class="muted"></span>
          </div>
        </div>
        <div class="law-field">
          <label>행사 유형</label>
          <div id="lawEventTypes" class="checkbox-grid"></div>
        </div>
        <div class="law-field">
          <label>주요 조건</label>
          <div id="lawFlags" class="checkbox-grid"></div>
        </div>
      </section>
      <section id="lawResult" aria-live="polite">
        <div class="empty">
          <strong>행사 조건을 지정하고 적용성 조회를 누르세요.</strong>
          <p>결과는 이 repo에 포함된 오프라인 온톨로지에서만 계산됩니다.</p>
        </div>
      </section>
    </div>
  </main>
  <script>
    const HOTSPOTS = ${JSON.stringify(SEOUL_LIVE_HOTSPOTS)};
    const OUT_OF_INDEX_GUIDANCE = ${JSON.stringify(`${SKT_OUT_OF_INDEX_NOTE} ${NATIONWIDE_CROWD_GUIDANCE}`)};
    const REFRESH_MS = 60000;
    const $ = (selector) => document.querySelector(selector);
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
    const STATE_LABEL = { critical: "위험", warning: "경보", watch: "주의", normal: "정상", unknown: "확인 필요" };
    const STATE_RANK = { unknown: 0, normal: 1, watch: 2, warning: 3, critical: 4 };
    const PANEL_SOURCE = {
      crowd: "Seoul RTD",
      weather: "KMA API Hub",
      air: "AirKorea",
      traffic: "ITS OpenAPI",
      disasterMessage: "Safety Data"
    };
    // A dropped request mid-restart surfaces as a bare "Failed to fetch"; the operator gets the
    // recovery line instead, and the last good reading stays on screen.
    const CONNECTION_ERROR = "서버 연결 실패 — 서버가 재시작 중일 수 있습니다. 다음 자동 갱신에서 재시도합니다.";
    const TILE_OFFLINE_DETAIL = "OpenStreetMap 타일 서버에 연결하지 못했습니다. 좌표와 상태값은 아래 패널에서 그대로 확인할 수 있습니다.";
    // Display coordinates only. Each point is the commonly cited centre of the area or venue —
    // close enough to place a marker, not a surveyed position. Never used for distance, capacity
    // or density math, and never sent upstream.
    const SEOUL_AREA_COORDS = {
      "강남역": [37.4981, 127.0276],
      "강남 MICE 관광특구": [37.5115, 127.0595],
      "잠실 관광특구": [37.5133, 127.1000],
      "잠실종합운동장": [37.5159, 127.0727],
      "잠실한강공원": [37.5180, 127.0820],
      "여의도한강공원": [37.5285, 126.9330],
      "반포한강공원": [37.5100, 126.9960],
      "뚝섬한강공원": [37.5290, 127.0700],
      "서울숲공원": [37.5444, 127.0374],
      "월드컵공원": [37.5710, 126.8780],
      "광화문·덕수궁": [37.5720, 126.9769],
      "명동 관광특구": [37.5636, 126.9827],
      "이태원 관광특구": [37.5345, 126.9946],
      "홍대 관광특구": [37.5563, 126.9236],
      "신촌·이대역": [37.5560, 126.9410],
      "DDP(동대문디자인플라자)": [37.5665, 127.0090],
      "성수카페거리": [37.5445, 127.0557],
      "서울역": [37.5547, 126.9707],
      "고속터미널역": [37.5049, 127.0048],
      "건대입구역": [37.5403, 127.0700]
    };
    // Keyed by the SKT place-congestion poiId so a national lookup can move the map straight to
    // the venue it just measured. Same display-only caveat as above.
    const SKT_VENUE_COORDS = {
      "187757": { name: "코엑스", coords: [37.5118, 127.0592] },
      "729930": { name: "킨텍스제1전시장", coords: [37.6683, 126.7449] },
      "2754697": { name: "킨텍스제2전시장", coords: [37.6660, 126.7350] },
      "385078": { name: "벡스코제1전시장", coords: [35.1691, 129.1360] },
      "2872904": { name: "벡스코제2전시장", coords: [35.1717, 129.1310] },
      "1136310": { name: "김대중컨벤션센터", coords: [35.1466, 126.9220] },
      "7883604": { name: "수원컨벤션센터", coords: [37.2860, 127.0555] },
      "1141991": { name: "창원컨벤션센터", coords: [35.2225, 128.6811] },
      "1166194": { name: "송도컨벤시아", coords: [37.3886, 126.6390] }
    };
    const MAP_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    const MAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    const MAP_HOME = [36.5, 127.9];
    // Marker colours come from the same :root tokens as the rest of the sheet, so the map cannot
    // drift away from the panel palette.
    const cssToken = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    let STATE_COLORS = {};
    function loadStateColors() {
      const key = cssToken("--ink-key2");
      STATE_COLORS = {
        critical: cssToken("--red") || key,
        warning: cssToken("--watch") || key,
        watch: cssToken("--watch") || key,
        normal: cssToken("--ok") || key,
        unknown: key
      };
    }
    const stateColor = (state) => STATE_COLORS[state] || STATE_COLORS.unknown;
    // ko-KR's default time style spells out 시/분/초, which is too wide for a strip readout.
    const clockText = (date) => date.toLocaleTimeString("ko-KR", {
      hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    function friendlyError(err, prefix) {
      const raw = String((err && err.message) || err || "");
      if (!raw || /failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
        return CONNECTION_ERROR;
      }
      return prefix ? prefix + " — " + raw : raw;
    }
    function metricsHtml(metrics) {
      if (!metrics || !metrics.length) return "";
      return '<ul class="metrics">' + metrics.map((metric) =>
        '<li><span>' + escapeHtml(metric.label) + '</span><strong>' + escapeHtml(metric.value) + '</strong></li>'
      ).join("") + '</ul>';
    }
    function panelHtml(panel, extraBadge) {
      const state = panel.state || "unknown";
      return [
        '<article class="panel state-' + escapeHtml(state) + '">',
        '<div class="panel-head"><h3><span class="led ' + escapeHtml(state) + '"></span>' + escapeHtml(panel.label) + '</h3>'
          + '<span class="state-pill ' + escapeHtml(state) + '">' + escapeHtml(STATE_LABEL[state] || state) + '</span></div>',
        '<span class="micro">' + escapeHtml(PANEL_SOURCE[panel.id] || "Source") + '</span>',
        extraBadge ? '<div class="chips" style="margin-top:8px">' + extraBadge + '</div>' : "",
        '<p style="margin-top:8px">' + escapeHtml(panel.summary) + '</p>',
        metricsHtml(panel.metrics),
        panel.nationwideGuidance ? '<div class="notice">' + escapeHtml(panel.nationwideGuidance) + '</div>' : "",
        panel.note ? '<p class="source-line">' + escapeHtml(panel.note) + '</p>' : "",
        '<p class="source-line">status: ' + escapeHtml(panel.status) + ' / mode: ' + escapeHtml(panel.mode) + '</p>',
        '</article>'
      ].join("");
    }
    // --- Situation map -------------------------------------------------------------------
    let map = null;
    let baseLayer = null;
    let focusLayer = null;
    let eventLayer = null;
    let tileFailures = 0;
    let mapReady = false;
    function setMapFallback(detail) {
      $("#mapFallbackDetail").textContent = detail;
      $("#mapFallback").hidden = false;
    }
    function setMapNote(text) {
      $("#mapNote").textContent = text || "표시 좌표는 지점 식별용 근사값입니다. 거리·수용인원 계산에 쓰지 마세요.";
    }
    function setupMap() {
      if (typeof L === "undefined") {
        setMapFallback("지도 라이브러리를 불러오지 못했습니다. /vendor/leaflet/leaflet.js 배포 상태를 확인하세요.");
        return;
      }
      // Wheel zoom stays off so scrolling the board never gets captured by the map.
      map = L.map("map", { scrollWheelZoom: false, attributionControl: true }).setView(MAP_HOME, 7);
      const tiles = L.tileLayer(MAP_TILE_URL, { maxZoom: 18, attribution: MAP_ATTRIBUTION });
      tiles.on("tileerror", () => {
        tileFailures += 1;
        if (tileFailures >= 3 && !mapReady) setMapFallback(TILE_OFFLINE_DETAIL);
      });
      tiles.on("tileload", () => {
        mapReady = true;
        $("#mapFallback").hidden = true;
      });
      tiles.addTo(map);
      // Added in draw order: reference dots at the bottom, the crowd focus above them, event
      // markers on top so a venue pin is never buried under the area highlight.
      baseLayer = L.layerGroup().addTo(map);
      focusLayer = L.layerGroup().addTo(map);
      eventLayer = L.layerGroup().addTo(map);
      drawBaseMarkers();
    }
    // Reference dots for every place the active mode can reach. They stay neutral: only the
    // selected point carries a status colour, so a dot is never mistaken for a reading.
    function drawBaseMarkers() {
      if (!baseLayer) return;
      baseLayer.clearLayers();
      const points = crowdMode() === "skt"
        ? Object.keys(SKT_VENUE_COORDS).map((id) => [SKT_VENUE_COORDS[id].name, SKT_VENUE_COORDS[id].coords])
        : Object.keys(SEOUL_AREA_COORDS).map((name) => [name, SEOUL_AREA_COORDS[name]]);
      const dim = cssToken("--ink-key2");
      for (const entry of points) {
        L.circleMarker(entry[1], {
          radius: 3.5,
          color: dim,
          weight: 1,
          fillColor: dim,
          fillOpacity: 0.6,
          interactive: true
        }).bindTooltip(entry[0], { direction: "top" }).addTo(baseLayer);
      }
    }
    function popupHtml(title, state, lines) {
      return '<span class="popup-title">' + escapeHtml(title) + '</span>'
        + '<span class="popup-line">상태 ' + escapeHtml(STATE_LABEL[state] || state) + '</span>'
        + lines.filter(Boolean).map((line) => '<span class="popup-line">' + escapeHtml(line) + '</span>').join("");
    }
    function focusPoint(coords, title, state, lines, zoom) {
      if (!map || !focusLayer) return;
      focusLayer.clearLayers();
      const color = stateColor(state);
      L.circle(coords, { radius: 700, color: color, weight: 1.5, opacity: 0.8, fillColor: color, fillOpacity: 0.13 }).addTo(focusLayer);
      L.circleMarker(coords, { radius: 9, color: color, weight: 3, fillColor: color, fillOpacity: 0.55 })
        .bindPopup(popupHtml(title, state, lines))
        .addTo(focusLayer);
      map.setView(coords, zoom || 14, { animate: true });
    }
    function clearFocus() {
      if (focusLayer) focusLayer.clearLayers();
    }
    // --- Event operations board (home tab) -----------------------------------------------
    // Everything here comes from the local operations store: issues, staff actions, runsheet
    // execution and command decisions the MCP tools already wrote. Nothing is synthesised, so an
    // empty store shows an empty board rather than a demo event.
    let opsPayload = null;
    let selectedEvent = null;
    let fittedEventBounds = false;
    const SLA_LABEL = { overdue: "SLA 초과", due_soon: "SLA 임박", normal: "여유", no_sla: "기한 없음" };
    const TASK_KIND_LABEL = { issue: "이슈", action: "조치" };
    const findEvent = (name) => (opsPayload?.events || []).find((event) => event.eventName === name) || null;
    const dueText = (value) => value
      ? new Date(value).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      : "기한 없음";
    const taskTone = (slaState) => slaState === "overdue" ? "critical" : slaState === "due_soon" ? "watch" : "normal";
    function showOpsIssue(message) {
      const banner = $("#opsBanner");
      banner.innerHTML = '<span class="led critical"></span>' + escapeHtml(message);
      banner.hidden = false;
    }
    // Only venues with a display coordinate are offered; anything else has to be pinned through the
    // API with explicit lat/lng rather than dropped on the map at a guessed point.
    function locationSelectHtml(eventName, venueId) {
      const options = (opsPayload?.venueOptions || []).map((venue) =>
        '<option value="' + escapeHtml(venue.id) + '"' + (venue.id === venueId ? " selected" : "") + '>'
        + escapeHtml(venue.label) + '</option>'
      ).join("");
      return '<div class="loc-picker"><label>위치 지정(베뉴)'
        + '<select data-loc-event="' + escapeHtml(eventName) + '">'
        + '<option value="">' + (venueId ? "베뉴 변경" : "베뉴 선택") + '</option>'
        + options + '</select></label></div>';
    }
    function eventLines(event) {
      const severity = event.issues.bySeverity;
      return [
        "미해결 이슈 " + event.issues.open + "건 (위험 " + severity.critical + " · 높음 " + severity.high + ")",
        "SLA 초과 " + event.sla.overdue + " · 임박 " + event.sla.dueSoon,
        "런시트 " + event.runsheet.done + "/" + event.runsheet.total + " 완료 · 막힘 "
          + (event.runsheet.blocked + event.runsheet.escalated),
        event.activeCommandDecisions.length
          ? "활성 지휘판단 " + event.activeCommandDecisions.map((decision) => decision.label).join(", ")
          : "활성 지휘판단 없음",
        event.lastActivityAt ? "마지막 활동 " + new Date(event.lastActivityAt).toLocaleString("ko-KR") : ""
      ].filter(Boolean);
    }
    function eventPopupHtml(event) {
      return '<span class="popup-title">' + escapeHtml(event.eventName) + '</span>'
        + '<span class="popup-line">상태 ' + escapeHtml(STATE_LABEL[event.state] || event.state)
        + (event.stateReasons.length ? " · " + escapeHtml(event.stateReasons.join(", ")) : "") + '</span>'
        + eventLines(event).map((line) => '<span class="popup-line">' + escapeHtml(line) + '</span>').join("")
        + locationSelectHtml(event.eventName, event.location ? event.location.venueId : null);
    }
    function drawEventMarkers() {
      if (!eventLayer) return;
      eventLayer.clearLayers();
      const located = (opsPayload?.events || []).filter((event) => event.location);
      for (const event of located) {
        const coords = [event.location.lat, event.location.lng];
        const color = stateColor(event.state);
        const selected = event.eventName === selectedEvent;
        L.circle(coords, {
          radius: selected ? 1100 : 800,
          color: color,
          weight: selected ? 2.5 : 1.5,
          opacity: 0.85,
          fillColor: color,
          fillOpacity: selected ? 0.2 : 0.11
        }).addTo(eventLayer);
        L.circleMarker(coords, {
          radius: selected ? 11 : 8,
          color: color,
          weight: 3,
          fillColor: color,
          fillOpacity: 0.6
        })
          .bindTooltip(event.eventName + " · " + (STATE_LABEL[event.state] || event.state), { direction: "top" })
          .bindPopup(eventPopupHtml(event))
          // Selecting from the marker only refreshes the rail: redrawing the layer here would
          // destroy the marker Leaflet is currently opening a popup on.
          .on("click", () => {
            selectedEvent = event.eventName;
            renderOpsRail();
          })
          .addTo(eventLayer);
      }
      if (!fittedEventBounds && located.length && map) {
        fittedEventBounds = true;
        map.fitBounds(located.map((event) => [event.location.lat, event.location.lng]), {
          padding: [46, 46],
          maxZoom: 13
        });
      }
    }
    function eventRowHtml(event) {
      const severity = event.issues.bySeverity;
      return '<button class="row-item state-' + escapeHtml(event.state)
        + (event.eventName === selectedEvent ? " selected" : "")
        + '" type="button" data-select-event="' + escapeHtml(event.eventName) + '">'
        + '<span class="row-title"><strong>' + escapeHtml(event.eventName) + '</strong>'
        + '<span class="sla-tag ' + escapeHtml(event.state) + '">'
        + escapeHtml(STATE_LABEL[event.state] || event.state) + '</span></span>'
        + '<span class="row-meta">이슈 ' + event.issues.open + '(위험 ' + severity.critical + ')'
        + ' · SLA 초과 ' + event.sla.overdue
        + ' · 런시트 ' + event.runsheet.done + '/' + event.runsheet.total
        + (event.location ? "" : " · 위치 미지정") + '</span></button>';
    }
    function taskRowHtml(task) {
      return '<div class="row-item state-' + escapeHtml(taskTone(task.slaState)) + '">'
        + '<span class="row-title"><strong>' + escapeHtml(task.title) + '</strong>'
        + '<span class="sla-tag ' + escapeHtml(task.slaState) + '">'
        + escapeHtml(SLA_LABEL[task.slaState] || task.slaState) + '</span></span>'
        + '<span class="row-meta">' + escapeHtml(TASK_KIND_LABEL[task.kind] || task.kind)
        + ' · ' + escapeHtml(task.category)
        + ' · ' + escapeHtml(task.team)
        + ' · ' + escapeHtml(task.level)
        + ' · 기한 ' + escapeHtml(dueText(task.dueAt))
        + (task.zone ? ' · ' + escapeHtml(task.zone) : "") + '</span></div>';
    }
    function unlocatedRowHtml(event) {
      return '<div class="row-item state-' + escapeHtml(event.state) + '">'
        + '<span class="row-title"><strong>' + escapeHtml(event.eventName) + '</strong>'
        + '<span class="sla-tag ' + escapeHtml(event.state) + '">'
        + escapeHtml(STATE_LABEL[event.state] || event.state) + '</span></span>'
        + locationSelectHtml(event.eventName, null) + '</div>';
    }
    function renderOpsRail() {
      if (!opsPayload) return;
      const events = opsPayload.events || [];
      const summary = opsPayload.summary || {};
      $("#opsSummary").textContent = events.length
        ? "전체 " + summary.events + " · 위험 " + summary.critical + " · 주의 " + summary.watch
          + " · 지도 표시 " + summary.located
        : "행사 0건";
      $("#opsEvents").innerHTML = events.length
        ? events.map(eventRowHtml).join("")
        : '<p class="muted">' + escapeHtml(opsPayload.emptyNote) + '</p>';
      const selected = findEvent(selectedEvent);
      $("#opsTaskEvent").textContent = selected ? selected.eventName : "행사 미선택";
      $("#opsTasks").innerHTML = !selected
        ? '<p class="muted">행사를 선택하면 이슈·조치가 여기에 표시됩니다.</p>'
        : selected.tasks.length
          ? selected.tasks.map(taskRowHtml).join("")
          : '<p class="muted">미해결 이슈·조치가 없습니다.</p>';
      const unlocated = events.filter((event) => !event.location);
      $("#opsUnlocatedCard").hidden = unlocated.length === 0;
      $("#opsUnlocated").innerHTML = unlocated.map(unlocatedRowHtml).join("");
      if ((opsPayload.warnings || []).length) showOpsIssue(opsPayload.warnings.join(" / "));
    }
    function renderOps(payload) {
      opsPayload = payload;
      const events = payload.events || [];
      // The refresh must not move the operator's selection unless the event went away entirely.
      if (!events.some((event) => event.eventName === selectedEvent)) {
        selectedEvent = events.length ? events[0].eventName : null;
      }
      $("#opsDisclaimer").textContent = payload.disclaimer;
      drawEventMarkers();
      renderOpsRail();
    }
    function selectFromRail(eventName) {
      selectedEvent = eventName;
      const event = findEvent(eventName);
      if (event?.location && map) {
        map.setView([event.location.lat, event.location.lng], 14, { animate: true });
      }
      drawEventMarkers();
      renderOpsRail();
    }
    async function loadOps() {
      try {
        const res = await fetch("/api/operations-map");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "요청 실패");
        $("#opsBanner").hidden = true;
        renderOps(json);
      } catch (err) {
        showOpsIssue(friendlyError(err, "운영 상황 조회 실패"));
      }
    }
    // Writes the pin file beside operations.json but outside its hash chain — it is a display
    // position, not an operational record.
    async function assignLocation(eventName, venueId) {
      try {
        const res = await fetch("/api/operations-map/location", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ eventName: eventName, venueId: venueId })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "요청 실패");
        selectedEvent = eventName;
        fittedEventBounds = false;
        if (map) map.closePopup();
        await loadOps();
      } catch (err) {
        showOpsIssue(friendlyError(err, "위치 지정 실패"));
      }
    }
    // --- Headline tiles ------------------------------------------------------------------
    function setTile(id, value, sub, state) {
      const tile = $(id);
      if (!tile) return;
      const resolved = state || "unknown";
      tile.className = "stat-tile state-" + resolved;
      tile.querySelector(".tile-value").textContent = value;
      tile.querySelector(".tile-sub").textContent = sub;
      tile.querySelector(".tile-state").innerHTML = '<span class="led ' + escapeHtml(resolved) + '"></span>'
        + escapeHtml(STATE_LABEL[resolved] || resolved);
    }
    const metricValue = (panel, label) => {
      const found = ((panel && panel.metrics) || []).find((metric) => metric.label === label);
      return found ? found.value : "";
    };
    function worstState(states) {
      return states.reduce((worst, state) => (STATE_RANK[state] || 0) > (STATE_RANK[worst] || 0) ? state : worst, "unknown");
    }
    function heatBadge(heat) {
      if (!heat) return "";
      const tone = heat.level === "warning" ? "danger" : heat.level === "advisory" ? "warn" : "";
      const detail = heat.apparentTemperatureC === null ? "" : " · 체감 " + heat.apparentTemperatureC + "℃";
      return '<span class="chip ' + tone + '">폭염 ' + escapeHtml(heat.label) + escapeHtml(detail) + '</span>';
    }
    function crowdMode() {
      const selected = document.querySelector('input[name="crowdMode"]:checked');
      return selected ? selected.value : "seoul";
    }
    function updateStrip(payload, panels, areaText) {
      $("#stripArea").textContent = areaText;
      $("#stripUpdated").textContent = clockText(new Date(payload.generatedAt));
      const state = worstState(panels.map((panel) => panel.state));
      const pill = $("#stripState");
      pill.className = "state-pill " + state;
      pill.innerHTML = '<span class="led ' + escapeHtml(state) + '"></span>' + escapeHtml(STATE_LABEL[state] || state);
    }
    function updateTiles(payload, panels, nationwide) {
      // The national card owns the crowd tile in SKT mode, so the Seoul feed must not overwrite it.
      if (!nationwide) {
        const crowd = payload.crowd;
        setTile("#tileCrowd", metricValue(crowd, "혼잡도 등급") || "—",
          metricValue(crowd, "실시간 인구 추정") || crowd.summary, crowd.state);
      }
      const heat = payload.weather.heat || {};
      const apparent = heat.apparentTemperatureC;
      setTile("#tileHeat", apparent === null || apparent === undefined ? "—" : apparent + "℃",
        heat.label || "관측 없음", payload.weather.state);
      const pm25 = metricValue(payload.air, "PM2.5");
      setTile("#tileAir", metricValue(payload.air, "통합대기환경지수") || "—",
        pm25 ? "PM2.5 " + pm25 : payload.air.summary, payload.air.state);
      const alerts = panels.filter((panel) => ["critical", "warning", "watch"].includes(panel.state));
      setTile("#tileAlerts", String(alerts.length),
        alerts.length ? alerts.map((panel) => panel.label).join(", ") : "주의 이상 상태 없음",
        worstState(panels.map((panel) => panel.state)));
    }
    // The home tab keeps a two-badge summary of the live signal so the operator sees a crowd or
    // heat change without leaving the map; clicking either opens the signal tab.
    function setMiniBadge(ledSelector, textSelector, state, text) {
      $(ledSelector).className = "led " + (state || "unknown");
      $(textSelector).textContent = text;
    }
    function updateHomeBadges(payload, nationwide) {
      setMiniBadge("#badgeCrowdLed", "#badgeCrowdText",
        nationwide ? "unknown" : payload.crowd.state,
        nationwide
          ? "전국 SKT 수동"
          : metricValue(payload.crowd, "혼잡도 등급") || STATE_LABEL[payload.crowd.state] || "확인 필요");
      const heat = payload.weather.heat || {};
      setMiniBadge("#badgeHeatLed", "#badgeHeatText", payload.weather.state, heat.label || "관측 없음");
    }
    function updateCrowdMap(payload) {
      if (!map) return;
      const area = payload.query.areaName;
      const coords = area ? SEOUL_AREA_COORDS[area] : null;
      if (!coords) {
        clearFocus();
        setMapNote(area
          ? area + " 의 표시 좌표가 없어 지도를 이동하지 않았습니다. 좌표가 없어도 아래 패널 값은 그대로 유효합니다."
          : "서울 외 지역은 실시간 인파 강조 대상이 아닙니다. 전국 SKT(수동) 모드에서 베뉴를 조회하세요.");
        return;
      }
      const crowd = payload.crowd;
      const level = metricValue(crowd, "혼잡도 등급");
      const population = metricValue(crowd, "실시간 인구 추정");
      const updatedAt = metricValue(crowd, "인파 갱신시각");
      focusPoint(coords, area, crowd.state, [
        level ? "혼잡도 " + level : "",
        population ? "실시간 인구 " + population : "",
        updatedAt ? "갱신 " + updatedAt : ""
      ], 14);
      setMapNote("");
    }
    function render(payload) {
      const nationwide = crowdMode() === "skt";
      const shown = [
        nationwide ? null : payload.crowd,
        payload.weather,
        payload.air,
        payload.traffic,
        payload.disasterMessage
      ].filter(Boolean);
      $("#panels").innerHTML = [
        nationwide ? "" : panelHtml(payload.crowd),
        panelHtml(payload.weather, heatBadge(payload.weather.heat)),
        panelHtml(payload.air),
        panelHtml(payload.traffic),
        panelHtml(payload.disasterMessage)
      ].join("");
      $("#disclaimer").textContent = payload.disclaimer;
      const areaText = nationwide
        ? "전국 SKT(수동 조회, 자동 갱신 제외)"
        : (payload.query.areaName || "서울 외(자동 갱신 대상 아님)");
      $("#lastUpdated").textContent = "마지막 갱신 " + new Date(payload.generatedAt).toLocaleString("ko-KR")
        + " / 인파 " + areaText + " / 측정소 " + payload.query.stationName;
      updateStrip(payload, shown, areaText);
      updateTiles(payload, shown, nationwide);
      updateHomeBadges(payload, nationwide);
      if (!nationwide) updateCrowdMap(payload);
    }
    let hasLiveData = false;
    // A failed refresh never clears the board: the operator keeps reading the last good values
    // while the banner says the connection dropped and that the next cycle retries.
    function showConnectionIssue(message) {
      const banner = $("#connBanner");
      banner.innerHTML = '<span class="led critical"></span>' + escapeHtml(message);
      banner.hidden = false;
      const pill = $("#stripState");
      pill.className = "state-pill";
      pill.innerHTML = '<span class="led"></span>연결 끊김';
      if (!hasLiveData) {
        $("#panels").innerHTML = '<div class="empty">' + escapeHtml(message) + '</div>';
      }
    }
    async function load() {
      $("#refreshBtn").disabled = true;
      $("#status").textContent = "조회 중";
      const params = new URLSearchParams({
        areaName: $("#areaInput").value.trim(),
        stationName: $("#stationInput").value.trim()
      });
      try {
        const res = await fetch("/api/live-status?" + params.toString());
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "요청 실패");
        render(json);
        hasLiveData = true;
        $("#connBanner").hidden = true;
        $("#status").textContent = "완료";
      } catch (err) {
        showConnectionIssue(friendlyError(err, "실시간 조회 실패"));
        $("#status").textContent = "재시도 대기";
      } finally {
        $("#refreshBtn").disabled = false;
      }
    }
    function sktTime(value) {
      const parts = String(value || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
      return parts ? parts[1] + "-" + parts[2] + "-" + parts[3] + " " + parts[4] + ":" + parts[5] : String(value || "-");
    }
    function setSktGuidance(text) {
      const guidance = $("#sktGuidance");
      guidance.hidden = !text;
      guidance.textContent = text || "";
    }
    function setSktPois(pois) {
      $("#sktPoi").innerHTML = pois.map((poi) =>
        '<option value="' + escapeHtml(poi.poiId) + '">' + escapeHtml(poi.poiName) + '</option>'
      ).join("");
      $("#sktBtn").disabled = pois.length === 0;
      setSktGuidance(pois.length || !$("#sktSearch").value.trim() ? "" : OUT_OF_INDEX_GUIDANCE);
    }
    async function searchPois() {
      const query = $("#sktSearch").value.trim();
      if (!query) {
        setSktPois([]);
        return;
      }
      try {
        const res = await fetch("/api/skt-pois?q=" + encodeURIComponent(query));
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "요청 실패");
        setSktPois(json.pois || []);
      } catch (err) {
        setSktGuidance(friendlyError(err, "장소 검색 실패"));
      }
    }
    function renderSkt(json) {
      const state = json.state || "unknown";
      $("#sktPanel").className = "panel state-" + state;
      $("#sktLed").className = "led " + state;
      $("#sktState").className = "state-pill " + state;
      $("#sktState").textContent = STATE_LABEL[state] || state;
      const metrics = [];
      if (json.poi) metrics.push({ label: "장소", value: json.poi.poiName });
      if (json.levelLabel) metrics.push({ label: "혼잡도 등급", value: json.levelLabel + " (레벨 " + json.level + ")" });
      if (json.densityBand) metrics.push({ label: "등급 밀도구간", value: json.densityBand });
      if (typeof json.congestion === "number") metrics.push({ label: "측정 밀도", value: json.congestion.toFixed(4) + "명/㎡" });
      if (json.datetime) metrics.push({ label: "기준시각", value: sktTime(json.datetime) });
      if (json.fetchedAt) metrics.push({ label: "조회시각", value: new Date(json.fetchedAt).toLocaleString("ko-KR") });
      metrics.push({
        label: "월 사용량",
        value: "추정 사용 " + json.quota.used + "/" + json.quota.limit + " (" + json.quota.month + ")"
      });
      $("#sktResult").innerHTML = '<p>' + escapeHtml(json.message) + '</p>'
        + (json.cached ? '<div class="chips"><span class="chip">10분 캐시 응답 · 쿼터 미사용</span></div>' : "")
        + metricsHtml(metrics)
        + (json.warnings && json.warnings.length
          ? '<div class="notice">' + escapeHtml(json.warnings.join(" / ")) + '</div>' : "")
        + '<p class="source-line">' + escapeHtml(json.quotaNote) + '</p>'
        + '<p class="source-line">' + escapeHtml(json.disclaimer) + '</p>';
      setSktGuidance(json.status === "unknown_poi" || json.status === "quota_exhausted" ? OUT_OF_INDEX_GUIDANCE : "");
      // The national mode drives the map from this manual lookup, since no Seoul feed applies.
      const placeName = json.poi ? String(json.poi.poiName || "") : "선택 장소";
      const venue = SKT_VENUE_COORDS[json.poi ? String(json.poi.poiId || "") : ""];
      if (venue) {
        focusPoint(venue.coords, placeName, state, [
          json.levelLabel ? "혼잡도 " + json.levelLabel : "",
          typeof json.congestion === "number" ? "측정 밀도 " + json.congestion.toFixed(4) + "명/㎡" : "",
          json.datetime ? "기준 " + sktTime(json.datetime) : ""
        ], 15);
        setMapNote("");
      } else {
        clearFocus();
        setMapNote(placeName + " 의 표시 좌표가 이 대시보드에 없어 지도는 이동하지 않았습니다. 혼잡도 값은 위 카드에 그대로 표시됩니다.");
      }
      setTile("#tileCrowd", json.levelLabel || "—", placeName || "전국 SKT(수동)", state);
      setMiniBadge("#badgeCrowdLed", "#badgeCrowdText", state, json.levelLabel || placeName || "전국 SKT 수동");
    }
    // Manual only: this is the one control on the page that spends the shared monthly quota.
    async function requestSktCongestion() {
      const poiId = $("#sktPoi").value;
      if (!poiId) return;
      $("#sktBtn").disabled = true;
      $("#sktStatus").textContent = "조회 중";
      try {
        const res = await fetch("/api/skt-congestion?poiId=" + encodeURIComponent(poiId));
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "요청 실패");
        renderSkt(json);
        $("#sktStatus").textContent = json.cached ? "캐시" : json.status === "ok" ? "완료" : json.status;
      } catch (err) {
        $("#sktResult").innerHTML = '<div class="notice error">' + escapeHtml(friendlyError(err, "혼잡도 조회 실패")) + '</div>';
        $("#sktStatus").textContent = "재시도 대기";
      } finally {
        $("#sktBtn").disabled = false;
      }
    }
    function applyCrowdMode() {
      const nationwide = crowdMode() === "skt";
      $("#sktSection").hidden = !nationwide;
      drawBaseMarkers();
      clearFocus();
      if (nationwide) {
        setTile("#tileCrowd", "—", "전국 SKT 수동 조회 대기", "unknown");
        setMapNote("전국 SKT(수동) 모드입니다. 장소를 검색해 혼잡도를 조회하면 해당 베뉴로 지도가 이동합니다.");
        if (map) map.setView(MAP_HOME, 7, { animate: true });
      }
      load();
    }
    let aiReady = false;
    function renderEngines(engines) {
      const available = engines.filter((engine) => engine.available);
      aiReady = available.length > 0;
      if (!aiReady) {
        $("#aiEngines").innerHTML = "";
        $("#aiResult").innerHTML = '<div class="notice">Claude Code 또는 Codex CLI 로그인이 필요합니다. 설치 후 CLI에서 한 번 로그인하면 이 패널이 켜집니다.'
          + '<ul class="compact-list">'
          + engines.map((engine) => '<li>' + escapeHtml(engine.label + ": " + engine.installCommand) + '</li>').join("")
          + '</ul></div>';
        return;
      }
      $("#aiEngines").innerHTML = available.map((engine, index) =>
        '<label class="check"><input type="radio" name="aiEngine" value="' + escapeHtml(engine.id) + '"'
        + (index === 0 ? " checked" : "") + '> '
        + escapeHtml(engine.label + (engine.version ? " " + engine.version : "")) + '</label>'
      ).join("");
      $("#aiBtn").disabled = false;
    }
    async function loadEngines() {
      try {
        const res = await fetch("/api/ai-engines");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "요청 실패");
        renderEngines(json.engines || []);
      } catch (err) {
        $("#aiResult").innerHTML = '<div class="notice error">' + escapeHtml(friendlyError(err, "AI 엔진 확인 실패")) + '</div>';
      }
    }
    async function requestBriefing() {
      const selected = document.querySelector('input[name="aiEngine"]:checked');
      $("#aiBtn").disabled = true;
      $("#aiStatus").textContent = "브리핑 생성 중(최대 2분)";
      $("#aiResult").innerHTML = '<p class="muted">엔진 응답을 기다리는 중입니다.</p>';
      try {
        const res = await fetch("/api/ai-briefing", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            engine: selected ? selected.value : undefined,
            areaName: $("#areaInput").value.trim(),
            stationName: $("#stationInput").value.trim(),
            question: $("#aiQuestion").value.trim() || undefined
          })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "요청 실패");
        $("#aiResult").innerHTML = '<article class="mini-card">'
          + '<div class="card-topline"><strong>' + escapeHtml(json.engineLabel || json.engine) + '</strong>'
          + '<span class="pill">' + escapeHtml(Math.round((json.elapsedMs || 0) / 1000) + "초") + '</span></div>'
          + '<div class="ai-output">' + escapeHtml(json.briefing) + '</div>'
          + '<p class="source-line">' + escapeHtml(json.disclaimer) + '</p></article>';
        $("#aiStatus").textContent = "완료";
      } catch (err) {
        $("#aiResult").innerHTML = '<div class="notice error">' + escapeHtml(friendlyError(err, "AI 브리핑 실패")) + '</div>';
        $("#aiStatus").textContent = "재시도 대기";
      } finally {
        $("#aiBtn").disabled = !aiReady;
      }
    }
    const LAW_EVENT_TYPES = ${JSON.stringify(EVENT_TYPE_OPTIONS)};
    // A field crew needs the conditions that change the legal picture, not the full simulator form.
    const LAW_FEATURES = [
      ["outdoorEvent", "완전/부분 옥외"],
      ["roadUse", "도로점용·교통통제"],
      ["foodService", "식음료 판매"],
      ["lpgUse", "LPG 사용"],
      ["setupTeardown", "설치·철거 작업"],
      ["temporaryStructures", "임시구조물"],
      ["vipSecurity", "VIP·보안검색"],
      ["personalDataProcessing", "개인정보 처리"]
    ];
    function lawChecks(selector, items, checked) {
      $(selector).innerHTML = items.map((entry) =>
        '<label class="check"><input type="checkbox" value="' + escapeHtml(entry[0]) + '"'
        + (checked.includes(entry[0]) ? " checked" : "") + '> ' + escapeHtml(entry[1]) + '</label>'
      ).join("");
    }
    function lawCard(title, status, body, tone) {
      return '<article class="mini-card ' + tone + '"><div class="card-topline"><strong>' + escapeHtml(title)
        + '</strong><span class="pill">' + escapeHtml(status) + '</span></div><p>' + escapeHtml(body) + '</p></article>';
    }
    function lawInput() {
      const input = {
        eventTypes: Array.from(document.querySelectorAll("#lawEventTypes input:checked")).map((item) => item.value),
        venueId: $("#lawVenue").value || undefined,
        jurisdiction: $("#lawJurisdiction").value.trim() || undefined,
        expectedCrowd: $("#lawCrowd").value ? Number($("#lawCrowd").value) : undefined
      };
      for (const entry of LAW_FEATURES) {
        input[entry[0]] = Boolean(document.querySelector('#lawFlags input[value="' + entry[0] + '"]')?.checked);
      }
      if (input.outdoorEvent) input.outdoor = true;
      return input;
    }
    function dutyBody(duty) {
      const refs = duty.lawRefs || [];
      return [
        duty.requiredWhen || "적용 조건 확인 필요",
        refs.length ? "근거 " + refs.slice(0, 3).join(", ") : ""
      ].filter(Boolean).join(" / ");
    }
    function ordinanceCards(ordinances) {
      return ordinances.map((item) => lawCard(
        (item.jurisdiction || "지자체") + " · " + (item.categoryLabel || "조례"),
        item.priorityBand === "primary" ? "우선 적용" : "참고",
        (item.name || item.ordinanceName || "조례") + " / 제출기한: " + (item.submissionDeadline || "확인 필요"),
        item.priorityBand === "primary" ? "tone-warning" : "tone-muted"
      )).join("");
    }
    function renderLaws(payload) {
      const data = payload.applicability || {};
      const laws = data.laws || [];
      const duties = data.duties || [];
      const ordinances = data.localOrdinances || [];
      const warnings = data.scopeWarnings || [];
      const primary = ordinances.filter((item) => item.priorityBand === "primary");
      const reference = ordinances.filter((item) => item.priorityBand !== "primary");
      $("#lawResult").innerHTML = [
        warnings.length
          ? '<section class="card">' + warnings.map((item) => '<div class="notice error">⚠ ' + escapeHtml(item) + '</div>').join("") + '</section>'
          : "",
        '<section class="stats">',
        '<div class="card stat"><strong>' + laws.length + '</strong><span>적용 법령·지침</span></div>',
        '<div class="card stat"><strong>' + duties.length + '</strong><span>의무·문서</span></div>',
        '<div class="card stat"><strong>' + primary.length + '</strong><span>우선 조례</span></div>',
        '<div class="card stat"><strong>' + reference.length + '</strong><span>참고 조례</span></div>',
        '</section>',
        '<section class="card"><h2>조회 조건</h2><div class="chips">'
          + (payload.summary?.inputFlags || []).map((item) => '<span class="chip">' + escapeHtml(item) + '</span>').join("")
          + '</div></section>',
        '<section class="card"><h2>적용 법령·지침</h2><div class="grid">',
        laws.map((law) => lawCard(
          law.shortName || law.name || law.id,
          law.verificationStatus || "확인",
          law.miceUse || "MICE 적용 근거 확인 필요",
          "tone-muted"
        )).join("") || '<p class="muted">적용 법령 후보가 없습니다.</p>',
        '</div></section>',
        '<section class="card"><h2>의무·문서 체크리스트</h2><div class="list">',
        duties.map((duty) => lawCard(
          duty.title || duty.id,
          duty.strictnessLabel || duty.strictness || "확인",
          dutyBody(duty),
          duty.strictness === "statutory_required" || duty.strictness === "local_required" ? "tone-good" : "tone-muted"
        )).join("") || '<p class="muted">조건부 의무 문서가 없습니다.</p>',
        '</div></section>',
        '<section class="card"><h2>조례 후보</h2>',
        '<h3>우선 적용</h3><div class="grid">' + (ordinanceCards(primary) || '<p class="muted">우선 적용 조례 후보 없음</p>') + '</div>',
        '<h3 style="margin-top:14px">참고</h3><div class="grid">' + (ordinanceCards(reference) || '<p class="muted">참고 조례 후보 없음</p>') + '</div>',
        '</section>',
        '<section class="card"><div class="notice">적용 판단은 관할기관 협의와 최신 원문 확인으로 확정해야 합니다. 이 목록은 제출 준비용 초안입니다.</div></section>'
      ].join("");
    }
    async function requestLaws() {
      $("#lawBtn").disabled = true;
      $("#lawStatus").textContent = "조회 중";
      try {
        const res = await fetch("/api/simulate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(lawInput())
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "요청 실패");
        renderLaws(json);
        $("#lawStatus").textContent = "완료";
      } catch (err) {
        $("#lawResult").innerHTML = '<div class="notice error">' + escapeHtml(friendlyError(err, "적용성 조회 실패")) + '</div>';
        $("#lawStatus").textContent = "재시도 대기";
      } finally {
        $("#lawBtn").disabled = false;
      }
    }
    async function loadLawOptions() {
      try {
        const res = await fetch("/api/options");
        const options = await res.json();
        if (!res.ok) throw new Error(options.error || "요청 실패");
        $("#lawVenue").innerHTML = '<option value="">베뉴 미지정</option>' + (options.venues || []).map((venue) =>
          '<option value="' + escapeHtml(venue.id) + '">' + escapeHtml(venue.name + " / " + venue.region) + '</option>'
        ).join("");
        $("#lawJurisdictions").innerHTML = (options.jurisdictions || []).map((item) =>
          '<option value="' + escapeHtml(item) + '"></option>'
        ).join("");
      } catch (err) {
        $("#lawStatus").textContent = "베뉴·지자체 목록을 불러오지 못했습니다";
      }
    }
    // Switching only toggles visibility, so a fetched law result survives a trip to another tab.
    const TAB_NAMES = ["home", "live", "laws"];
    function showTab(name) {
      const active = TAB_NAMES.includes(name) ? name : "home";
      for (const tab of TAB_NAMES) {
        $("#tab-" + tab).hidden = tab !== active;
      }
      for (const button of document.querySelectorAll(".tab-btn")) {
        const on = button.dataset.tab === active;
        button.classList.toggle("active", on);
        button.setAttribute("aria-selected", on ? "true" : "false");
      }
      // Leaflet measures its container once. A map that was display:none keeps that stale size and
      // renders torn tiles until it is told to re-measure after the panel is visible again.
      if (active === "home" && map) requestAnimationFrame(() => map.invalidateSize());
    }
    function startClock() {
      const tick = () => {
        $("#stripClock").textContent = clockText(new Date());
      };
      tick();
      setInterval(tick, 1000);
    }
    function init() {
      loadStateColors();
      setupMap();
      startClock();
      $("#areaSelect").innerHTML = HOTSPOTS.map((name) =>
        '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>'
      ).join("") + '<option value="">서울 외 지역 / 직접 입력</option>';
      $("#areaSelect").value = ${JSON.stringify(DEFAULT_SEOUL_AREA)};
      $("#areaInput").value = ${JSON.stringify(DEFAULT_SEOUL_AREA)};
      $("#areaSelect").addEventListener("change", () => {
        $("#areaInput").value = $("#areaSelect").value;
        load();
      });
      $("#refreshBtn").addEventListener("click", load);
      for (const radio of document.querySelectorAll('input[name="crowdMode"]')) {
        radio.addEventListener("change", applyCrowdMode);
      }
      let searchTimer = null;
      $("#sktSearch").addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(searchPois, 250);
      });
      $("#sktBtn").addEventListener("click", requestSktCongestion);
      $("#aiBtn").addEventListener("click", requestBriefing);
      lawChecks("#lawEventTypes", LAW_EVENT_TYPES, ["festival"]);
      lawChecks("#lawFlags", LAW_FEATURES, ["outdoorEvent"]);
      $("#lawBtn").addEventListener("click", requestLaws);
      for (const button of document.querySelectorAll(".tab-btn")) {
        button.addEventListener("click", () => {
          location.hash = button.dataset.tab;
          showTab(button.dataset.tab);
        });
      }
      // Event rows, the live-signal badges and the location selects are all rebuilt on every
      // refresh (and Leaflet popups live outside the rail), so they are handled by delegation.
      document.addEventListener("click", (clickEvent) => {
        const row = clickEvent.target.closest("[data-select-event]");
        if (row) {
          selectFromRail(row.dataset.selectEvent);
          return;
        }
        if (clickEvent.target.closest("[data-goto-live]")) {
          location.hash = "live";
          showTab("live");
        }
      });
      document.addEventListener("change", (changeEvent) => {
        const select = changeEvent.target;
        if (!select.matches || !select.matches("[data-loc-event]") || !select.value) return;
        assignLocation(select.dataset.locEvent, select.value);
      });
      window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
      showTab(location.hash.slice(1));
      loadLawOptions();
      // Both cycles read only local files and free public APIs. The AI briefing and the SKT probe
      // stay out of them so the operator's subscription and monthly quota are only spent on a click.
      setInterval(load, REFRESH_MS);
      setInterval(loadOps, REFRESH_MS);
      load();
      loadOps();
      loadEngines();
    }
    init();
  </script>
</body>
</html>`;
}

function inputFlags(input: AnyRecord): string[] {
  const flags: string[] = [];
  if (Array.isArray(input.eventTypes)) flags.push(...input.eventTypes.map(String));
  if (input.venueId) flags.push(`베뉴 ${input.venueId}`);
  if (input.jurisdiction) flags.push(String(input.jurisdiction));
  if (typeof input.expectedCrowd === "number") flags.push(`${input.expectedCrowd.toLocaleString("ko-KR")}명`);
  for (const [key, label] of [
    ["outdoorEvent", "옥외"],
    ["roadUse", "도로점용"],
    ["temporaryStructures", "임시구조물"],
    ["temporaryElectricity", "임시전기"],
    ["setupTeardown", "설치·철거"],
    ["workAtHeight", "고소작업"],
    ["heavyObjectHandling", "중량물"],
    ["hotWork", "화기작업"],
    ["foodService", "식음료"],
    ["lpgUse", "LPG"],
    ["performance", "공연"],
    ["personalDataProcessing", "개인정보"],
    ["vipSecurity", "VIP/보안"],
    ["unhostedCrowd", "무주최 운집"],
  ] as const) {
    if (input[key] === true) flags.push(label);
  }
  return Array.from(new Set(flags));
}

function hasEventType(input: AnyRecord, eventType: string): boolean {
  return Array.isArray(input.eventTypes) && input.eventTypes.includes(eventType);
}

function decisionSummary(input: AnyRecord): Array<{ title: string; status: string; reason: string }> {
  const hasOutdoor = Boolean(input.outdoor || input.outdoorEvent || hasEventType(input, "festival") || hasEventType(input, "outdoor_event"));
  const hasPerformance = Boolean(input.performance || hasEventType(input, "performance"));
  const hasFood = Boolean(input.foodService || input.lpgUse || hasEventType(input, "food_event"));
  const hasWorker = Boolean(input.setupTeardown || input.temporaryStructures || input.temporaryElectricity || input.workAtHeight || input.heavyObjectHandling || input.hotWork);
  const hasPrivacy = Boolean(input.personalDataProcessing || hasEventType(input, "conference") || hasEventType(input, "vip_event"));
  const hasVip = Boolean(input.vipSecurity || hasEventType(input, "vip_event"));
  return [
    {
      title: "옥외행사/지역축제 조례",
      status: hasOutdoor ? "적용 후보" : "비적용",
      reason: hasOutdoor ? "옥외·축제 조건이 있어 지자체 안전관리계획·협의 후보입니다." : "실내 행사 조건만 입력되어 필수로 올리지 않습니다.",
    },
    {
      title: "도로점용/교통통제",
      status: input.roadUse ? "필수 후보" : hasOutdoor ? "조건부 확인" : "비적용",
      reason: input.roadUse ? "도로·보도·광장 점용 또는 통행 제한이 입력되었습니다." : hasOutdoor ? "외부 대기열, 승하차장, 보도 점용 여부를 확인해야 합니다." : "도로점용 조건이 없습니다.",
    },
    {
      title: "공연법/공연 재해대처",
      status: hasPerformance ? "적용 후보" : "비적용",
      reason: hasPerformance ? "공연·무대 조건이 있어 공연 재해대처계획 후보입니다." : "공연 조건이 없어 필수로 올리지 않습니다.",
    },
    {
      title: "식품위생/LPG",
      status: hasFood ? "적용 후보" : "비적용",
      reason: hasFood ? "식음료 판매, 시식, 케이터링 또는 LPG 사용 조건이 입력되었습니다." : "식음료·LPG 조건이 없어 필수로 올리지 않습니다.",
    },
    {
      title: "설치·철거 작업자 안전",
      status: hasWorker ? "적용 후보" : "비적용",
      reason: hasWorker ? "부스·무대·전기·하역·고소·중량물 작업 조건이 입력되었습니다." : "작업 위험 조건이 없어 작업자 안전계획을 필수로 올리지 않습니다.",
    },
    {
      title: "개인정보/CCTV",
      status: hasPrivacy ? "적용 후보" : "조건부 확인",
      reason: hasPrivacy ? "등록, QR, CCTV, 컨벤션/VIP 조건으로 개인정보 고지·위탁·보관 기준 점검이 필요합니다." : "개인정보 처리 방식이 확정될 때 적용 후보로 전환합니다.",
    },
    {
      title: "VIP/보안검색",
      status: hasVip ? "적용 후보" : "조건부 확인",
      reason: hasVip ? "VIP 또는 보안검색 조건이 입력되어 출입통제·경비 운영 확인이 필요합니다." : "VIP·보안검색 조건이 없으면 제출 액션으로 올리지 않습니다.",
    },
  ];
}

function buildPriorityActions(input: AnyRecord, applicability: AnyRecord): Array<{ title: string; detail: string }> {
  const duties = toArray(applicability.duties);
  const hazards = toArray(applicability.hazards);
  const ordinances = toArray(applicability.localOrdinances);
  const actions: Array<{ title: string; detail: string }> = [];
  for (const item of ordinances.slice(0, 3)) {
    actions.push({
      title: `관할 조례 확인: ${String(item.jurisdiction ?? "지자체")}`,
      detail: `${String(item.name ?? item.ordinanceName ?? "조례")} / 제출기한 ${String(item.submissionDeadline ?? "확인 필요")}`,
    });
  }
  for (const duty of duties.slice(0, 5)) {
    actions.push({
      title: String(duty.title ?? duty.id ?? "의무 문서"),
      detail: `${strictnessLabel(strictnessValue(duty.strictness))} / ${String(duty.requiredWhen ?? "조건 확인 필요")}`,
    });
  }
  for (const hazard of hazards.slice(0, 3)) {
    actions.push({
      title: `위험 통제: ${String(hazard.label ?? hazard.id ?? "위험요인")}`,
      detail: toStringArray(hazard.controls)[0] ?? "현장 통제대책 지정 필요",
    });
  }
  if (actions.length === 0) {
    actions.push({
      title: "행사 조건 보강",
      detail: "행사 유형, 관할 지자체, 예상 인파, 베뉴, 도로·식음료·작업 조건을 추가 입력하세요.",
    });
  }
  if (input.unhostedCrowd === true) {
    actions.unshift({
      title: "무주최 다중운집 공동대응",
      detail: "지자체·경찰·소방·교통·시설 주체의 상황판단권과 방송/차단 기준을 먼저 확정합니다.",
    });
  }
  return actions.slice(0, 10);
}

function responseJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function responseHtml(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

// Leaflet is copied here by scripts/copy-web-vendor.mjs at build time. Serving it from the package
// keeps the dashboard self-contained: a venue network with no outbound access still gets a map.
const VENDOR_ROOT = resolve(fileURLToPath(new URL("./vendor/", import.meta.url)));

const VENDOR_CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

async function serveVendorAsset(res: ServerResponse, pathname: string): Promise<void> {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname.slice("/vendor/".length));
  } catch {
    responseJson(res, 400, { error: "invalid request" });
    return;
  }
  // A "../" segment must not let a request read outside the vendor directory.
  const target = resolve(VENDOR_ROOT, relative);
  if (!target.startsWith(VENDOR_ROOT + sep)) {
    responseJson(res, 403, { error: "forbidden" });
    return;
  }
  const contentType = VENDOR_CONTENT_TYPES[extname(target).toLowerCase()];
  if (!contentType) {
    responseJson(res, 404, { error: "not found" });
    return;
  }
  try {
    const body = await readFile(target);
    res.writeHead(200, { "content-type": contentType, "cache-control": "public, max-age=3600" });
    res.end(body);
  } catch {
    responseJson(res, 404, { error: "not found" });
  }
}

function isClientInputError(err: unknown): boolean {
  if (err instanceof ZodError) return true;
  if (err instanceof SyntaxError) return true;
  if (err instanceof Error && err.message === "request body too large") return true;
  return false;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error("request body too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

function optionsPayload(): AnyRecord {
  const jurisdictions = Array.from(new Set(MICE_DATA.localOrdinances.records
    .map((item) => item.jurisdiction)
    .filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko"));
  return {
    version: VERSION,
    eventTypes: [
      ...MICE_DATA.applicability.eventTypes.map((item) => ({ id: item.id, label: item.label })),
      { id: "outdoor_event", label: "옥외행사" },
    ],
    venues: MICE_DATA.venues.map((venue) => ({
      id: venue.id,
      name: venue.name,
      region: venue.region,
      province: venue.province,
      city: venue.city,
    })),
    jurisdictions,
    personaPresets: PERSONA_PRESETS,
    _meta: COMMON_RESPONSE_META,
  };
}

const APPLICABILITY_INPUT_KEYS = new Set(
  Object.keys((queryMiceSafetyApplicabilityTool.inputSchema as AnyZodObject).shape),
);

// The web form also carries UI-only fields (eventName, persona controls) that the plan-review
// and persona paths need. The applicability tool does not declare them and would report them
// as ignored input, so drop them here instead of surfacing a false scope warning.
function pickApplicabilityInput(input: unknown): unknown {
  if (!isPlainRecord(input)) return input;
  return Object.fromEntries(Object.entries(input).filter(([key]) => APPLICABILITY_INPUT_KEYS.has(key)));
}

async function simulate(input: unknown): Promise<AnyRecord> {
  const toolResult = await queryMiceSafetyApplicabilityTool.handler(pickApplicabilityInput(input));
  const applicability = toolResult.structuredContent ?? {};
  const normalizedInput = (applicability.input ?? input ?? {}) as AnyRecord;
  const laws = toArray(applicability.laws);
  const duties = toArray(applicability.duties).map((duty) => ({
    ...duty,
    strictnessLabel: strictnessLabel(strictnessValue(duty.strictness)),
  }));
  const hazards = toArray(applicability.hazards);
  const localOrdinances = toArray(applicability.localOrdinances);
  const venueRules = toArray(applicability.venueRules);
  const workerSafetyReferences = toArray(applicability.workerSafetyReferences);
  return {
    version: VERSION,
    input: normalizedInput,
    summary: {
      counts: {
        laws: laws.length,
        duties: duties.length,
        hazards: hazards.length,
        localOrdinances: localOrdinances.length,
        venueRules: venueRules.length,
        workerSafetyReferences: workerSafetyReferences.length,
      },
      inputFlags: inputFlags(normalizedInput),
      decisions: decisionSummary(normalizedInput),
      priorityActions: buildPriorityActions(normalizedInput, {
        ...applicability,
        duties,
        hazards,
        localOrdinances,
      }),
    },
    applicability: {
      ...applicability,
      duties,
      laws,
      hazards,
      localOrdinances,
      venueRules,
      workerSafetyReferences,
    },
    _meta: COMMON_RESPONSE_META,
  };
}

function previewLines(value: unknown, max = 6): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean).slice(0, max);
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .slice(0, max);
}

function submissionActionPreview(markdown: unknown, max = 6): string[] {
  return String(markdown ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .slice(0, max)
    .map((line) => line
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .slice(1, 5)
      .join(" — "));
}

async function planReview(input: unknown): Promise<AnyRecord> {
  const normalizedInput = baseMiceEventInputSchema.parse(isPlainRecord(input) ? input : {});
  const generated = await generateMiceSafetyPlanTool.handler({ ...normalizedInput, output: "structured" });
  const plan = generated.structuredContent ?? {};
  const documentBundle = (plan.documentBundle ?? {}) as AnyRecord;
  const reviewResult = await reviewMiceSafetyPlanTool.handler({
    ...normalizedInput,
    planMarkdown: String(plan.planMarkdown ?? generated.content[0]?.text ?? ""),
    documentBundle,
  });
  const review = reviewResult.structuredContent ?? {};
  const sections = (plan.sections ?? {}) as AnyRecord;
  const findings = toArray(review.findings);

  return {
    version: VERSION,
    input: (plan.input ?? normalizedInput) as AnyRecord,
    plan: {
      documentCount: Object.keys(documentBundle).length,
      documentKeys: Object.keys(documentBundle),
      executiveSummary: {
        keyRisks: previewLines(sections.hazardControls, 6),
        applicableBasis: [
          ...previewLines(sections.legalBasis, 4),
          ...previewLines(sections.localOrdinances, 3),
        ].slice(0, 7),
        submissionActions: submissionActionPreview(documentBundle.submissionChecklist, 7),
      },
    },
    review: {
      verdict: review.verdict,
      score: review.score,
      grade: review.grade,
      counts: review.counts,
      topFindings: findings.slice(0, 8),
    },
    _meta: COMMON_RESPONSE_META,
  };
}

async function personaStress(input: unknown): Promise<AnyRecord> {
  const result = await stressTestMiceSafetyPlanTool.handler(input);
  return {
    version: VERSION,
    ...(result.structuredContent ?? {}),
    _meta: COMMON_RESPONSE_META,
  };
}

function requireLoopback(req: IncomingMessage, res: ServerResponse, what = "AI bridge"): boolean {
  if (isLoopbackAddress(req.socket.remoteAddress)) return true;
  responseJson(res, 403, { error: `${what} is local-only` });
  return false;
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/") {
    responseHtml(res, htmlPage());
    return;
  }
  if (req.method === "GET" && url.pathname === "/live") {
    responseHtml(res, livePage());
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/vendor/")) {
    await serveVendorAsset(res, url.pathname);
    return;
  }
  if (req.method === "GET" && url.pathname === "/health") {
    responseJson(res, 200, { ok: true, name: SERVER_NAME, version: VERSION });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/options") {
    responseJson(res, 200, optionsPayload());
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/live-status") {
    responseJson(res, 200, await liveStatus(url));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/operations-map") {
    responseJson(res, 200, operationsMap(url));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/operations-map/location") {
    responseJson(res, 200, operationsMapLocation(await readJson(req)));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/skt-pois") {
    responseJson(res, 200, sktPoiSearch(url));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/skt-congestion") {
    // One probe spends one of ten shared monthly calls, so a remote host must not be able to
    // trigger it — same reasoning as the AI bridge below.
    if (!requireLoopback(req, res, "SKT congestion probe")) return;
    responseJson(res, 200, await sktCongestion(url));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/ai-engines") {
    if (!requireLoopback(req, res)) return;
    responseJson(res, 200, await aiEnginesPayload());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/ai-briefing") {
    if (!requireLoopback(req, res)) return;
    responseJson(res, 200, await aiBriefing(await readJson(req)));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/simulate") {
    const input = await readJson(req);
    responseJson(res, 200, await simulate(input));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/plan-review") {
    const input = await readJson(req);
    responseJson(res, 200, await planReview(input));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/persona-stress-test") {
    const input = await readJson(req);
    responseJson(res, 200, await personaStress(input));
    return;
  }
  responseJson(res, 404, { error: "not found" });
}

export async function startWebServer(options: WebServerOptions = {}): Promise<Server> {
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.PORT ?? 4317);
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    // eslint-disable-next-line no-console
    console.error(`⚠ 비루프백 주소(${host})에 바인딩 — 인증/접근제어 없음. 신뢰된 네트워크에서만 사용하세요.`);
  }
  const server = createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      if (isClientInputError(err)) {
        responseJson(res, 400, { error: "invalid request" });
        return;
      }
      // The local CLI is an upstream dependency, not a server fault: say which engine failed and why
      // so the operator can fix the install or fall back to the panels.
      if (err instanceof AiBridgeError) {
        responseJson(res, 503, { error: err.message, reason: err.reason });
        return;
      }
      // eslint-disable-next-line no-console
      console.error(`[${SERVER_NAME}] internal error`, err);
      responseJson(res, 500, { error: "internal error" });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  // eslint-disable-next-line no-console
  console.log(`[${SERVER_NAME}] web ready: http://${host}:${boundPort}`);
  return server;
}
