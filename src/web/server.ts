import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { ZodError } from "zod";
import { COMMON_RESPONSE_META } from "../config/constants.js";
import { baseMiceEventInputSchema } from "../lib/mice-event-input-schema.js";
import { MICE_DATA, strictnessLabel } from "../lib/mice-data.js";
import type { Strictness } from "../lib/types.js";
import { generateMiceSafetyPlanTool } from "../tools/generate-mice-safety-plan.js";
import { queryMiceSafetyApplicabilityTool } from "../tools/query-mice-safety-applicability.js";
import { reviewMiceSafetyPlanTool } from "../tools/review-mice-safety-plan.js";
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

function htmlPage(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MICE 행사 안전 적용성 체크리스트</title>
  <style>
    :root {
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
    }
  </style>
</head>
<body>
  <main class="page">
    <div class="topbar">
      <span class="badge primary">${SERVER_NAME} v${VERSION}</span>
      <span class="badge">offline ontology web simulator</span>
      <span class="badge">query_mice_safety_applicability</span>
      <span class="badge">generate/review plan</span>
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
          <div class="sample-row" aria-label="샘플 입력">
            <button class="secondary" type="button" data-sample="indoor">실내 전시</button>
            <button class="secondary" type="button" data-sample="festival">옥외축제</button>
            <button class="secondary" type="button" data-sample="vip">VIP 컨벤션</button>
            <button class="secondary" type="button" data-sample="unhosted">무주최 운집</button>
          </div>
          <div class="actions">
            <button id="submitBtn" type="submit">체크리스트 생성</button>
            <button class="secondary" type="button" id="planBtn">계획서 요약·검수</button>
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
        expectedCrowd: $("#expectedCrowd").value ? Number($("#expectedCrowd").value) : undefined
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
      $("#result").innerHTML = [
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
    async function init() {
      renderCheckboxes($("#eventTypes"), EVENT_TYPES, ["exhibition"]);
      renderCheckboxes($("#featureFlags"), FEATURES);
      const options = await fetch("/api/options").then((res) => res.json());
      $("#venueId").innerHTML = '<option value="">베뉴 미지정</option>' + options.venues.map((venue) =>
        '<option value="' + escapeHtml(venue.id) + '">' + escapeHtml(venue.name + " / " + venue.region) + '</option>'
      ).join("");
      $("#jurisdictionOptions").innerHTML = options.jurisdictions.map((item) => '<option value="' + escapeHtml(item) + '"></option>').join("");
      applyInput(SAMPLES.indoor);
      $("#sim-form").addEventListener("submit", simulate);
      $("#planBtn").addEventListener("click", generatePlanReview);
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
    _meta: COMMON_RESPONSE_META,
  };
}

async function simulate(input: unknown): Promise<AnyRecord> {
  const toolResult = await queryMiceSafetyApplicabilityTool.handler(input);
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

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/") {
    responseHtml(res, htmlPage());
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
  responseJson(res, 404, { error: "not found" });
}

export async function startWebServer(options: WebServerOptions = {}): Promise<void> {
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
      // eslint-disable-next-line no-console
      console.error(`[${SERVER_NAME}] internal error`, err);
      responseJson(res, 500, { error: "internal error" });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  // eslint-disable-next-line no-console
  console.log(`[${SERVER_NAME}] web ready: http://${host}:${port}`);
}
