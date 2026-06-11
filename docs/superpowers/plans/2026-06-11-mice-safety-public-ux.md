# MICE Safety Public Site UX Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dexa.art/mice-safety를 비전문가 주최자가 쓸 수 있게 — 데이터 동기화 + 로직 패리티 + 템플릿/가이드 입력 + 행동 우선 출력.

**Architecture:** 정적 사이트(adxdeck repo) 유지. 원천 온톨로지(korea-mice-safety-agent)에서 단방향 동기화 스크립트로 data/*.json 갱신(조례팩은 필드 프로젝션). app.js는 패치된 TS 추론 로직과 일치화 후 입력/출력 UI 재구성. node vm 스모크 테스트로 로직 검증, headless Chrome dump-dom으로 e2e 검증.

**Tech Stack:** Vanilla JS(브라우저 전역), Node 내장 모듈만(fs/path/vm/assert), 빌드 스텝 없음.

**Spec:** `korea-mice-safety-agent/docs/PUBLIC_SITE_UX_SPEC_2026-06-11.md`

**Repos & commit scope:**
- `adxdeck` (main, origin=github.com/DECK6/adxdeck): `mice-safety/` 전체 (기존 미커밋 KOPIS 통합 + 미추적 kopis-venue-directory.json 포함). 푸시 시 선행 커밋 e2ae621(hermes, 무관)이 함께 올라감 — 사용자 보고.
- `korea-mice-safety-agent` (main): **선택 스테이징** — spec 문서, 이 plan, `scripts/sync-public-site.mjs`만. 미커밋 감사 패치(src/* 등)는 커밋하지 않음. npm script는 package.json 오염 회피 위해 추가하지 않음(`node scripts/sync-public-site.mjs` 직접 실행).

---

### Task 1: 데이터 동기화 스크립트

**Files:**
- Create: `korea-mice-safety-agent/scripts/sync-public-site.mjs`
- Modify: `adxdeck/mice-safety/data/*.json` (스크립트 실행 결과)

- [ ] **Step 1: 스크립트 작성**

```js
#!/usr/bin/env node
// One-way sync: src/ontology/mice -> public static site data dir.
// local-ordinance-pack.json is field-projected (article extracts stay out of the public bundle).
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ontologyDir = resolve(here, "../src/ontology/mice");
const targetDir = resolve(process.argv[2] ?? resolve(here, "../../adxdeck/mice-safety/data"));

const COPY_FILES = [
  "mice-safety-applicability.json",
  "law-registry.json",
  "mice-duty-master.json",
  "hazard-controls.json",
  "venue-safety-rules.json",
  "kopis-venue-directory.json",
  "worker-safety-references.json",
  "source-registry.json",
];

const ORDINANCE_RECORD_FIELDS = [
  "id", "jurisdiction", "name", "ordinanceName", "categoryId", "categoryLabel",
  "eventTypes", "dutyIds", "hazardIds", "structuredStatus", "submissionDeadline",
  "effectiveAt", "appliesWhen", "sourceUrl", "currentAsOf", "reviewBy", "freshnessStatus",
];

const report = (name, bytes) => console.log(`${name}: ${(bytes / 1024).toFixed(0)} KB`);

for (const file of COPY_FILES) {
  const raw = readFileSync(join(ontologyDir, file), "utf8");
  JSON.parse(raw);
  writeFileSync(join(targetDir, file), raw);
  report(file, statSync(join(targetDir, file)).size);
}

const pack = JSON.parse(readFileSync(join(ontologyDir, "local-ordinance-pack.json"), "utf8"));
const projected = {
  version: pack.version,
  versionType: pack.versionType,
  generatedAt: pack.generatedAt,
  records: pack.records.map((record) => Object.fromEntries(
    ORDINANCE_RECORD_FIELDS.filter((key) => record[key] !== undefined).map((key) => [key, record[key]])
  )),
};
const out = JSON.stringify(projected);
if (Buffer.byteLength(out) > 1024 * 1024) {
  console.error(`FAIL: projected local-ordinance-pack.json is ${Buffer.byteLength(out)} bytes (> 1MB)`);
  process.exit(1);
}
writeFileSync(join(targetDir, "local-ordinance-pack.json"), out);
report("local-ordinance-pack.json (projected)", Buffer.byteLength(out));
console.log("sync-public-site: done");
```

프로젝션 화이트리스트는 spec 목록 + `id`(레코드 식별), `appliesWhen`·`sourceUrl`(근거 보기용 경량 필드).

- [ ] **Step 2: 실행·검증**

Run: `node /Volumes/data/Dev/korea-mice-safety-agent/scripts/sync-public-site.mjs`
Expected: 9개 파일 크기 출력, projected pack < 1024KB, "done".

Run: `grep -c mid_crowd_rule /Volumes/data/Dev/adxdeck/mice-safety/data/mice-safety-applicability.json`
Expected: `1` 이상.

### Task 2: 스모크 테스트 하니스 (선 작성 — 실패 확인)

**Files:**
- Create: `adxdeck/mice-safety/tests/simulate-smoke.mjs`

- [ ] **Step 1: 하니스 작성** — app.js를 vm 컨텍스트에 로드(마지막 `init();` 제거), 동기화된 실데이터 주입, simulate/decisionSummary 직접 호출.

```js
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let src = readFileSync(join(root, "app.js"), "utf8").replace(/\ninit\(\);\s*$/, "\n");
src += "\nglobalThis.__setData = (d) => { DATA = d; };\nglobalThis.__simulate = simulate;\nglobalThis.__decisionSummary = decisionSummary;\n";

const ctx = vm.createContext({
  document: { querySelector: () => null, querySelectorAll: () => [] },
  window: { addEventListener: () => {} },
  fetch: () => { throw new Error("no fetch in tests"); },
  console,
});
vm.runInContext(src, ctx);

const DATA_FILES = {
  applicability: "mice-safety-applicability.json",
  laws: "law-registry.json",
  duties: "mice-duty-master.json",
  hazards: "hazard-controls.json",
  venues: "venue-safety-rules.json",
  performanceVenues: "kopis-venue-directory.json",
  workerSafety: "worker-safety-references.json",
  localOrdinances: "local-ordinance-pack.json",
  sources: "source-registry.json",
};
ctx.__setData(Object.fromEntries(Object.entries(DATA_FILES).map(([key, file]) =>
  [key, JSON.parse(readFileSync(join(root, "data", file), "utf8"))])));

const hasId = (items, id) => items.some((item) => item.id === id);
let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`ok - ${name}`); }
  catch (err) { failures += 1; console.error(`FAIL - ${name}: ${err.message}`); }
};

check("outdoorAdvertising -> act + signage duty", () => {
  const r = ctx.__simulate({ outdoorAdvertising: true });
  assert.equal(hasId(r.laws, "outdoor_advertisements_act"), true);
  assert.equal(hasId(r.duties, "road_traffic_and_outdoor_signage_permit"), true);
});
check("mid crowd (500) -> crowd/medical duties", () => {
  const r = ctx.__simulate({ expectedCrowd: 500 });
  assert.equal(hasId(r.duties, "mice_crowd_management_plan"), true);
  assert.equal(hasId(r.duties, "medical_aed_response_plan"), true);
});
check("personalDataProcessing does not fabricate conference, keeps privacy rule", () => {
  const r = ctx.__simulate({ personalDataProcessing: true });
  assert.equal(r.matchedEventTypes.some((event) => event.id === "conference"), false);
  assert.equal(r.matchedFeatureRules.some((rule) => rule.id === "personal_data_rule"), true);
});
check("hotWork alone infers exhibition", () => {
  const r = ctx.__simulate({ hotWork: true });
  assert.equal(r.matchedEventTypes.some((event) => event.id === "exhibition"), true);
});
check("crowd over 100k -> scope warning", () => {
  const r = ctx.__simulate({ expectedCrowd: 150000 });
  assert.equal(Array.isArray(r.scopeWarnings) && r.scopeWarnings.length > 0, true);
});
check("dataAsOf exposed from source-registry freshnessPolicy", () => {
  const r = ctx.__simulate({});
  assert.equal(r.dataAsOf, "2026-05-31");
});
check("decisionSummary recognizes outdoorAdvertising", () => {
  const cards = ctx.__decisionSummary({ outdoorAdvertising: true });
  const target = cards.find((card) => card.title.includes("도로점용"));
  assert.notEqual(target.status, "비적용");
});
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: 실행 — 실패 확인**

Run: `node /Volumes/data/Dev/adxdeck/mice-safety/tests/simulate-smoke.mjs`
Expected: 1·2번 ok(데이터 동기화만으로 통과), 3~7번 FAIL(코드 미패치), exit 1.

### Task 3: app.js 로직 패리티 (Part B)

**Files:**
- Modify: `adxdeck/mice-safety/app.js` (eventTypeFromFlags L176-189, FEATURES L23-38, inputFlags L421-436, decisionSummary L456-459, simulate 반환부 L398-412)

- [ ] **Step 1: eventTypeFromFlags** — L181 트리거에 `|| input.hotWork || input.temporaryElectricity` 추가; L186 `personalDataProcessing → conference` 줄 삭제.

```js
  if ((input.temporaryStructures || input.setupTeardown || input.workAtHeight || input.heavyObjectHandling || input.hotWork || input.temporaryElectricity) && !hasFestivalContext && !input.performance) {
    inferred.push("exhibition");
  }
  if (input.performance) inferred.push("performance");
  if (input.foodService || input.lpgUse) inferred.push("food_event");
  if (input.vipSecurity) inferred.push("vip_event");
```

- [ ] **Step 2: outdoorAdvertising 플래그** — FEATURES의 roadUse 다음에 `["outdoorAdvertising", "현수막·옥외광고물"]`, inputFlags 라벨쌍에도 `["outdoorAdvertising", "옥외광고물"]` 추가. (Task 4에서 FEATURES가 FEATURE_GROUPS 파생으로 바뀌므로 이 단계는 그룹 정의에 포함해도 됨)

- [ ] **Step 3: decisionSummary** — 도로점용 카드:

```js
    {
      title: "도로점용/교통통제·옥외광고물",
      status: input.roadUse ? "필수 후보" : input.outdoorAdvertising ? "적용 후보" : hasOutdoor ? "조건부 확인" : "비적용",
      reason: input.roadUse ? "도로·보도·광장 점용 또는 통행 제한이 입력되었습니다." : input.outdoorAdvertising ? "현수막·배너·옥외 광고물 설치 조건이 있어 옥외광고물 신고·허가 확인이 필요합니다." : hasOutdoor ? "외부 대기열, 승하차장, 보도 점용 여부를 확인해야 합니다." : "도로점용·옥외광고물 조건이 없습니다."
    },
```

- [ ] **Step 4: simulate에 scopeWarnings·dataAsOf** — 반환 직전:

```js
  const scopeWarnings = [];
  if (typeof input.expectedCrowd === "number" && input.expectedCrowd > 100000) {
    scopeWarnings.push(`예상 인원 ${input.expectedCrowd.toLocaleString("ko-KR")}명은 본 도구의 검증 범위(약 10만 명)를 초과합니다. 초대형 다중운집은 별도 정밀 계획과 관계기관 사전협의가 필요합니다.`);
  }
```

반환 객체에 `scopeWarnings,` 와 `dataAsOf: DATA.sources.freshnessPolicy?.appliedAt ?? "2026-05-31",` 추가.

- [ ] **Step 5: 테스트 통과 확인**

Run: `node /Volumes/data/Dev/adxdeck/mice-safety/tests/simulate-smoke.mjs`
Expected: 7/7 ok, exit 0.

### Task 4: 입력 UX (Part C)

**Files:**
- Modify: `adxdeck/mice-safety/index.html` (입력 패널 L38-86)
- Modify: `adxdeck/mice-safety/app.js` (SAMPLES, FEATURES→FEATURE_GROUPS, renderCheckboxes, init)
- Modify: `adxdeck/mice-safety/styles.css`

- [ ] **Step 1: FEATURE_GROUPS 정의 + FEATURES 파생** (라벨 테이블 단일화 — 리뷰 리스크 해소)

```js
const FEATURE_GROUPS = [
  ["장소·구조", [
    ["outdoorEvent", "야외(옥외)에서 진행합니까?"],
    ["roadUse", "도로·인도를 사용하거나 차량을 통제합니까?"],
    ["temporaryStructures", "무대·부스·천막 등 임시 구조물을 설치합니까?"],
    ["outdoorAdvertising", "현수막·배너·옥외 광고물을 답니까?"]
  ]],
  ["전기·화기·가스", [
    ["temporaryElectricity", "임시 전기·발전기를 사용합니까?"],
    ["hotWork", "용접·화기 작업이 있습니까?"],
    ["lpgUse", "LPG·가스를 사용합니까?"]
  ]],
  ["작업", [
    ["setupTeardown", "설치·철거 작업이 있습니까?"],
    ["workAtHeight", "사다리·고소작업 등 높은 곳 작업이 있습니까?"],
    ["heavyObjectHandling", "무거운 장비·자재를 옮깁니까?"]
  ]],
  ["운영", [
    ["foodService", "음식을 팔거나 제공합니까?"],
    ["performance", "공연이 있습니까?"],
    ["personalDataProcessing", "참가자 명단·QR·CCTV 등 개인정보를 다룹니까?"],
    ["vipSecurity", "VIP 경호·보안검색이 있습니까?"],
    ["unhostedCrowd", "주최자 없이 사람이 모이는 행사입니까?"]
  ]]
];
const FEATURES = FEATURE_GROUPS.flatMap(([, items]) => items);
```

inputFlags의 칩 라벨쌍(짧은 라벨)은 기존 14쌍 + 옥외광고물 1쌍 유지(출력 칩은 짧아야 함).

- [ ] **Step 2: SAMPLES → 템플릿 6종 + TEMPLATES 메타** (jurisdiction은 프리셋에 넣지 않음 — 사용자가 직접 입력)

```js
const SAMPLES = {
  foodtruck: { eventName: "푸드트럭·먹거리 행사", eventTypes: ["festival"], expectedCrowd: 2000, outdoorEvent: true, foodService: true, lpgUse: true, temporaryElectricity: true, outdoorAdvertising: true },
  fleamarket: { eventName: "플리마켓·장터", eventTypes: ["festival"], expectedCrowd: 800, outdoorEvent: true, temporaryStructures: true, foodService: true, outdoorAdvertising: true },
  outdoorPerformance: { eventName: "야외 공연·버스킹", eventTypes: ["performance"], expectedCrowd: 3000, outdoorEvent: true, performance: true, temporaryStructures: true, temporaryElectricity: true },
  exhibition: { eventName: "전시·박람회", eventTypes: ["exhibition"], expectedCrowd: 5000, temporaryStructures: true, setupTeardown: true, temporaryElectricity: true, personalDataProcessing: true },
  convention: { eventName: "컨벤션·컨퍼런스", eventTypes: ["conference"], expectedCrowd: 1000, personalDataProcessing: true },
  unhosted: { eventName: "무주최 운집 대비", eventTypes: [], expectedCrowd: 10000, outdoorEvent: true, unhostedCrowd: true }
};
const TEMPLATES = [
  ["foodtruck", "🚚 푸드트럭·먹거리", "야외 + 음식 + 가스"],
  ["fleamarket", "🧺 플리마켓·장터", "야외 + 부스 + 음식"],
  ["outdoorPerformance", "🎤 야외 공연·버스킹", "무대 + 임시전기"],
  ["exhibition", "🏛 전시·박람회", "부스 설치·철거"],
  ["convention", "🎓 컨벤션·컨퍼런스", "실내 + 참가자 등록"],
  ["unhosted", "👥 무주최 운집 대비", "주최 없는 인파"]
];
```

- [ ] **Step 3: init 갱신** — `applyInput(SAMPLES.exhibition)` (블로커 해소: `indoor` 키 제거됨), 템플릿 카드 렌더를 data-sample 바인딩 **앞**에 추가:

```js
  $("#templateCards").innerHTML = TEMPLATES.map(([key, title, desc]) =>
    `<button type="button" class="template-card" data-sample="${escapeHtml(key)}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(desc)}</span></button>`
  ).join("");
```

renderCheckboxes(#featureFlags, FEATURES) 호출을 그룹 렌더로 교체:

```js
function renderFeatureGroups(target) {
  target.innerHTML = FEATURE_GROUPS.map(([groupLabel, items]) =>
    `<fieldset class="field-group"><legend>${escapeHtml(groupLabel)}</legend>${items.map(([value, label]) =>
      `<label class="check"><input type="checkbox" value="${escapeHtml(value)}"> ${escapeHtml(label)}</label>`
    ).join("")}</fieldset>`
  ).join("");
}
```

(체크박스가 #featureFlags **내부** fieldset에 있으므로 formInput/applyInput 셀렉터 호환 유지)

- [ ] **Step 4: index.html 입력 패널 재구성** — 순서: ① `<div id="templateCards" class="template-grid">` ② `#featureFlags` (질문 토글) ③ `#expectedCrowd` + 도움말 `<p class="hint">300명 이상이면 동선·의료 사전검토가 권고되고, 1,000명 이상이면 의무가 더 늘어납니다.</p>` ④ `<details class="expert"><summary>전문가 입력 (행사 유형·베뉴·관할 직접 지정)</summary>` 안에 기존 eventName·#eventTypes·#venueId·#jurisdiction 이동 `</details>` ⑤ 기존 actions(제출·인쇄 버튼). 기존 sample-row 4버튼 제거.

- [ ] **Step 5: styles.css** — `.template-grid`(2열 grid), `.template-card`(mini-card 차용 버튼, hover 강조), `.field-group`(fieldset 보더 정리, legend 스타일), `details.expert`·`details.evidence`(summary 커서·여백), `.hint`(12px muted). 720px에서 template-grid 1열.

- [ ] **Step 6: 회귀 확인**

Run: `node /Volumes/data/Dev/adxdeck/mice-safety/tests/simulate-smoke.mjs`
Expected: 7/7 ok (로직 무변경 확인).

### Task 5: 출력 UX (Part D)

**Files:**
- Modify: `adxdeck/mice-safety/app.js` (buildPriorityActions, renderResult, print 핸들러)
- Modify: `adxdeck/mice-safety/styles.css` (print 블록)

- [ ] **Step 1: buildPriorityActions에 evidence 운반** — 각 액션에 `evidence: { lines: string[], link?: string }` 추가:
  - 조례: lines = [조례명, 관할, `제출기한 ${submissionDeadline ?? "확인 필요"}`, `시행일 ${effectiveAt ?? "확인 필요"}`, appliesWhen], link = sourceUrl
  - 의무: lines = duty.lawRefs를 law-registry로 역참조해 `${law.shortName ?? lawId} ${article}` + 해당 article.summary
  - 위험: lines = hazard.controls
  - 무주최 특별 액션: lines = ["재난안전법 제66조의11(다중운집인파사고 안전관리)"]

- [ ] **Step 2: renderResult 재구성** — 섹션 순서:
  1. 신선도 배너: `<div class="notice">데이터 기준일 ${result.dataAsOf} · 법령·조례·베뉴 규정은 수시로 개정됩니다. 제출 전 관할기관과 원문을 확인하세요.</div>`
  2. scopeWarnings 있으면: `<div class="notice error">⚠ ${warning}</div>` per warning
  3. 헤더 카드(행사명·칩·베뉴 라인) + stats 4종 (기존 유지)
  4. `✅ 이것부터 하세요` 카드: 액션 ol 체크리스트, 각 항목 아래 `<details class="evidence"><summary>근거 보기</summary><ul>…lines…</ul>(+ link면 <a target="_blank">원문 보기</a>)</details>`
  5. 적용/비적용 판단 7카드 (기존 유지)
  6. 이하 전부 `<details class="card collapsed-section">`로 감싸 기본 접힘: 주요 위험요인 / 의무 문서·체크리스트 / 법령·조례 근거 / 베뉴 체크포인트·작업자 안전 / 출처는 기존 미표시 유지
  7. 말미 disclaimer notice (기존 유지)

- [ ] **Step 3: 인쇄 시 details 펼침** — init에 추가 (리뷰 발견: CSS만으로 불가):

```js
  let printOpenedDetails = [];
  window.addEventListener("beforeprint", () => {
    printOpenedDetails = Array.from(document.querySelectorAll("details:not([open])"));
    for (const detail of printOpenedDetails) detail.open = true;
  });
  window.addEventListener("afterprint", () => {
    for (const detail of printOpenedDetails) detail.open = false;
    printOpenedDetails = [];
  });
```

styles.css print 블록: `.template-grid, .hint { display: none; }` 추가 (input-panel 전체가 이미 숨김이지만 명시).

- [ ] **Step 4: 스모크 테스트 재실행**

Run: `node /Volumes/data/Dev/adxdeck/mice-safety/tests/simulate-smoke.mjs`
Expected: 7/7 ok.

### Task 6: E2E 검증 (headless Chrome)

- [ ] **Step 1: 로컬 서빙 + DOM 덤프**

Run:
```bash
cd /Volumes/data/Dev/adxdeck && python3 -m http.server 8741 &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --virtual-time-budget=8000 --dump-dom http://localhost:8741/mice-safety/ > /tmp/mice-dom.html
```

Expected grep 체크:
- `grep -c "이것부터 하세요" /tmp/mice-dom.html` → 1 이상 (기본 프리셋 자동 실행 = SAMPLES 키 교체 회귀 통과)
- `grep -c "데이터 기준일 2026-05-31" /tmp/mice-dom.html` → 1 이상
- `grep -c "template-card" /tmp/mice-dom.html` → 6 이상
- `grep -c "근거 보기" /tmp/mice-dom.html` → 1 이상
- `grep -c "데이터를 불러오지 못했습니다" /tmp/mice-dom.html` → 0

- [ ] **Step 2: 데이터 크기 확인**

Run: `ls -la /Volumes/data/Dev/adxdeck/mice-safety/data/local-ordinance-pack.json`
Expected: < 1,048,576 bytes.

- [ ] **Step 3: 서버 종료**

### Task 7: 커밋·푸시 (두 repo)

- [ ] **Step 1: adxdeck 커밋·푸시**

```bash
cd /Volumes/data/Dev/adxdeck
git add mice-safety
git commit -m "feat(mice-safety): non-expert UX — template presets, guided toggles, action-first output, ontology data sync"
git push origin main
```

주의: 푸시에 선행 커밋 e2ae621(hermes)이 포함됨 — 결과 보고에 명시.

- [ ] **Step 2: korea-mice-safety-agent 선택 커밋·푸시**

```bash
cd /Volumes/data/Dev/korea-mice-safety-agent
git add docs/PUBLIC_SITE_UX_SPEC_2026-06-11.md docs/superpowers/plans/2026-06-11-mice-safety-public-ux.md scripts/sync-public-site.mjs
git commit -m "feat(public-site): add one-way data sync script + UX rework spec"
git push origin main
```

미커밋 감사 패치(src/* 등)는 스테이징하지 않음.

- [ ] **Step 3: graphify 갱신** (프로젝트 CLAUDE.md 규칙)

Run: `cd /Volumes/data/Dev && graphify update .`
