import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
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
    const EVENT_TYPES = [
      ["exhibition", "전시·박람회"],
      ["conference", "컨벤션·회의"],
      ["festival", "축제"],
      ["outdoor_event", "옥외행사"],
      ["performance", "공연"],
      ["food_event", "식음료"],
      ["vip_event", "VIP"]
    ];
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
  "공개된 실시간 기지국 인파 API는 서울 실시간 도시데이터가 유일합니다. 전국 중점관리지역 약 100곳을 다루는 행정안전부 인파관리지원시스템은 지자체·경찰·소방 상황실 전용이라 공개 API가 없습니다. 서울 외 지역은 관할 지자체 재난상황실과 공동대응 협의를 열어 행사기간 인파 정보 공유를 요청하고, 현장 계수·CCTV 관제·게이트 카운트로 보완하세요.";

const CROWD_COVERAGE_NOTE = "실시간 인파는 서울 실시간 도시데이터(기지국 기반) 제공 지역만 조회할 수 있습니다.";

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

function livePage(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MICE 현장 운영 라이브 대시보드</title>
  <style>
${SHARED_STYLE}
    .controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; align-items: end; }
    .controls .actions { align-self: end; }
    .panel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
    .panel {
      background: var(--paper);
      border: 1px solid var(--line);
      border-left: 5px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      padding: 18px;
    }
    .panel.state-critical { border-left-color: var(--red); background: var(--red-soft); }
    .panel.state-warning { border-left-color: var(--yellow); background: var(--yellow-soft); }
    .panel.state-watch { border-left-color: var(--yellow); }
    .panel.state-normal { border-left-color: var(--green); }
    .panel.state-unknown { border-left-color: var(--line); background: #f8fafc; }
    .panel-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; margin-bottom: 6px; }
    .panel-head h3 { margin: 0; font-size: 17px; }
    .state-pill {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: var(--paper);
      color: #334155;
      padding: 4px 9px;
      font-size: 12px;
      font-weight: 800;
      white-space: nowrap;
    }
    .state-pill.critical { color: var(--red); border-color: #f1a5a5; }
    .state-pill.warning, .state-pill.watch { color: var(--yellow); border-color: #ead28a; }
    .state-pill.normal { color: var(--green); border-color: #93d5b7; }
    .metrics { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 6px; }
    .metrics li { display: flex; justify-content: space-between; gap: 14px; border-top: 1px dashed var(--line); padding-top: 6px; font-size: 13px; }
    .metrics li span { color: var(--muted); font-weight: 800; white-space: nowrap; }
    .metrics li strong { text-align: right; overflow-wrap: anywhere; }
    .panel .notice { margin-top: 12px; font-size: 13px; }
    .source-line { color: var(--muted); font-size: 12px; font-weight: 800; margin-top: 10px; }
    .engine-choice { display: flex; flex-wrap: wrap; gap: 8px; }
    .engine-choice .check { flex: 0 1 auto; }
    .ai-output { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 6px; }
    #aiResult { margin-top: 14px; }
  </style>
</head>
<body>
  <main class="page">
    <div class="topbar">
      <span class="badge primary">${SERVER_NAME} v${VERSION}</span>
      <span class="badge">현장 운영 라이브 대시보드</span>
      <span class="badge">60초 자동 새로고침</span>
      <a class="badge" href="/">← 적용성 체크리스트</a>
    </div>
    <section class="heading">
      <div>
        <h1>현장 운영 라이브 대시보드</h1>
        <p class="muted">행사 당일 인파·날씨·대기질·교통·재난문자를 한 화면에서 봅니다. 공개 API가 없는 항목은 없는 대로 표시합니다.</p>
      </div>
    </section>
    <section class="card">
      <h2>조회 조건</h2>
      <div class="controls">
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
  </main>
  <script>
    const HOTSPOTS = ${JSON.stringify(SEOUL_LIVE_HOTSPOTS)};
    const REFRESH_MS = 60000;
    const $ = (selector) => document.querySelector(selector);
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
    const STATE_LABEL = { critical: "위험", warning: "경보", watch: "주의", normal: "정상", unknown: "확인 필요" };
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
        '<div class="panel-head"><h3>' + escapeHtml(panel.label) + '</h3><span class="state-pill ' + escapeHtml(state) + '">' + escapeHtml(STATE_LABEL[state] || state) + '</span></div>',
        extraBadge ? '<div class="chips">' + extraBadge + '</div>' : "",
        '<p>' + escapeHtml(panel.summary) + '</p>',
        metricsHtml(panel.metrics),
        panel.nationwideGuidance ? '<div class="notice">' + escapeHtml(panel.nationwideGuidance) + '</div>' : "",
        panel.note ? '<p class="source-line">' + escapeHtml(panel.note) + '</p>' : "",
        '<p class="source-line">status: ' + escapeHtml(panel.status) + ' / mode: ' + escapeHtml(panel.mode) + '</p>',
        '</article>'
      ].join("");
    }
    function heatBadge(heat) {
      if (!heat) return "";
      const tone = heat.level === "warning" ? "danger" : heat.level === "advisory" ? "warn" : "";
      const detail = heat.apparentTemperatureC === null ? "" : " · 체감 " + heat.apparentTemperatureC + "℃";
      return '<span class="chip ' + tone + '">폭염 ' + escapeHtml(heat.label) + escapeHtml(detail) + '</span>';
    }
    function render(payload) {
      $("#panels").innerHTML = [
        panelHtml(payload.crowd),
        panelHtml(payload.weather, heatBadge(payload.weather.heat)),
        panelHtml(payload.air),
        panelHtml(payload.traffic),
        panelHtml(payload.disasterMessage)
      ].join("");
      $("#disclaimer").textContent = payload.disclaimer;
      $("#lastUpdated").textContent = "마지막 갱신 " + new Date(payload.generatedAt).toLocaleString("ko-KR")
        + " / 인파 지역 " + (payload.query.areaName || "서울 외(공개 실시간 인파 API 없음)")
        + " / 측정소 " + payload.query.stationName;
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
        $("#status").textContent = "완료";
      } catch (err) {
        $("#status").textContent = "오류";
        $("#panels").innerHTML = '<div class="notice error">' + escapeHtml(err.message || err) + '</div>';
      } finally {
        $("#refreshBtn").disabled = false;
      }
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
        $("#aiResult").innerHTML = '<div class="notice error">' + escapeHtml(err.message || err) + '</div>';
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
        $("#aiResult").innerHTML = '<div class="notice error">' + escapeHtml(err.message || err) + '</div>';
        $("#aiStatus").textContent = "오류";
      } finally {
        $("#aiBtn").disabled = !aiReady;
      }
    }
    function init() {
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
      $("#aiBtn").addEventListener("click", requestBriefing);
      // The briefing stays out of the 60s cycle so the operator's subscription is only spent on
      // an explicit click.
      setInterval(load, REFRESH_MS);
      load();
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

function requireLoopback(req: IncomingMessage, res: ServerResponse): boolean {
  if (isLoopbackAddress(req.socket.remoteAddress)) return true;
  responseJson(res, 403, { error: "AI bridge is local-only" });
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
