# 공개 사이트(dexa.art/mice-safety) 일반 사용자 UX 개편 Spec

작성일: 2026-06-11 (적대 리뷰 1회 반영)
대상 코드: `/Volumes/data/Dev/adxdeck/mice-safety/` (index.html 98줄, app.js 670줄, styles.css 425줄, data/*.json 9개)
원천 데이터: `/Volumes/data/Dev/korea-mice-safety-agent/src/ontology/mice/`

## 1. 목표

비전문가 주최자(플리마켓·푸드트럭·소규모 공연·축제 기획자)가 전문 용어 없이
"내 행사에 뭐가 필요한지"를 3분 안에 확인할 수 있게 한다.

확정된 방향 (사용자 승인 완료):
- 데이터·로직 동기화 **포함**
- 출력의 법령·조문 근거는 **접이식 유지** (완전 숨김 아님)

## 2. 범위

포함: 데이터 동기화 스크립트, app.js 로직 일치화, 입력 UX(템플릿+가이드), 출력 UX(행동 우선).
제외: 서버 호출(순수 정적 유지), 디자인 리뉴얼(기존 styles.css 변수·컴포넌트 재사용), MCP 서버 코드 변경, 새 온톨로지 파일 추가 배포.

## 3. Part A — 데이터 동기화

### A-1. 동기화 스크립트

`korea-mice-safety-agent/scripts/sync-public-site.mjs` 신규 작성. `node scripts/sync-public-site.mjs`로 직접 실행
(npm script 미추가 — package.json에 미커밋 변경이 섞여 있어 선택적 커밋을 단순화). 기본 대상 `../adxdeck/mice-safety/data/` (인자로 변경 가능).

| 파일 | 방식 | 근거 |
| --- | --- | --- |
| hazard-controls, law-registry, mice-duty-master, worker-safety-references | 그대로 복사 | 드리프트가 versionType 필드 1개뿐 |
| mice-safety-applicability.json | 그대로 복사 | mid_crowd_rule·outdoor_advertising_rule 2개 룰 누락 해소 (14KB) |
| source-registry.json | 그대로 복사 | 53개 출처 + freshnessPolicy(appliedAt 2026-05-31) 확보 (64KB) |
| venue-safety-rules.json | 그대로 복사 | 베뉴별 officialSourceVerification·freshness 확보 (61KB) |
| kopis-venue-directory.json | 그대로 복사 (현재 동일) | 941KB, 변동 없음 |
| **local-ordinance-pack.json** | **필드 프로젝션 복사** | 원본 7.7MB. 사이트가 렌더링하지 않는 articleExtracts·verificationChecks·articleVerification·thresholdStructured 제거 (app.js grep 결과 4필드 모두 미사용 확인). 유지 필드: jurisdiction, name/ordinanceName, categoryId, categoryLabel, eventTypes, dutyIds, hazardIds, structuredStatus, submissionDeadline, effectiveAt, currentAsOf, reviewBy, freshnessStatus. 프로젝션 결과 실측 ≈ 0.4MB (현재 사이트 2.7MB에도 구버전 발췌가 포함돼 있었음 — 오히려 가벼워짐) |

스크립트는 복사 후 파일별 크기를 stdout으로 보고한다. 검증: `node scripts/sync-public-site.mjs` 실행 후 사이트 데이터에 `mid_crowd_rule` 존재 + local-ordinance-pack 크기 **1MB 미만**.

프로젝션의 트레이드오프: 조례의 조문 발췌(articleExtracts)를 배포하지 않으므로 공개 사이트의 조례 '근거 보기'는 조례명·관할·제출기한·시행일 메타데이터까지만 표시한다 (조문 전문은 MCP 도구/CLI 영역). 법령 쪽 조문 요약은 law-registry.json의 `articles`(사이트에 기존재)로 표시 가능.

참고(범위 외 메모): 온톨로지 `mice-safety-applicability.json`은 6/11 룰 추가에도 version 1.0.0 / generatedAt 2026-05-21로 미갱신 — 별도 후속.

### A-2. 동기화 안 하는 것

온톨로지에만 있는 9개 파일(venue-facility-index 2.7MB, legal-article-ontology 등)은 app.js가 사용하지 않으므로 배포하지 않는다.

## 4. Part B — app.js 로직 일치화

TS 패치본(`query-mice-safety-applicability.ts`)과 동일하게:

1. **eventTypeFromFlags (app.js L176-189)**:
   - exhibition 추론 조건에 `hotWork || temporaryElectricity` 추가
   - `personalDataProcessing → conference` 추론 줄 **삭제** (개인정보 의무는 personal_data_rule featureRule이 담당 — 동기화된 JSON에 존재)
2. **FEATURES 목록 (L23-38)**: `outdoorAdvertising` 플래그 추가 (14→15개). inputFlags 라벨쌍(L415-440)에도 추가. SAMPLES는 미존재 키가 자동 해제되므로 필수 갱신은 아니나, 새 템플릿 프리셋(C-1)에서 푸드트럭·플리마켓 카드에 `outdoorAdvertising: true` 포함 (현수막이 일상적인 행사 — 신규 룰이 수동 토글 없이도 도달되게).
3. **decisionSummary (L442-486)**: 도로점용·옥외 안내물 카드 조건에 `input.outdoorAdvertising` 추가 (현재 roadUse만 참조 — 현수막만 토글하면 판단 카드와 의무 목록이 불일치하는 문제 방지).
4. **scopeWarnings 이식 (simulate 내)**: 사이트 폼 특성상 가능한 경고만:
   - `expectedCrowd > 100000` → TS와 동일 문구("검증 범위(약 10만 명) 초과…")
   - venueId 미발견·미인식 키 경고는 **이식하지 않음** (select·고정 폼이라 발생 불가)
5. **신선도 메타**: `DATA.sources.freshnessPolicy.appliedAt`(동기화로 확보, 값 "2026-05-31") → 출력 배너에 사용. 없으면 폴백 상수 `"2026-05-31"`.
6. **renderCheckboxes (L583-587)**: 평면 목록 생성 → 그룹(fieldset) 단위 생성으로 확장 (C-2 지원). 단, 모든 체크박스는 반드시 `#featureFlags` 컨테이너 **내부**에 있어야 함 — formInput/applyInput 셀렉터(L599, L611)가 `#featureFlags input[value=...]` 기준.
7. isFeatureMatched·normalizeEventType은 이미 TS와 동일 — 변경 없음. (mid_crowd_rule은 데이터 동기화만으로 작동: `>=300` 매칭 로직 기존재)

검증: 브라우저에서 ①현수막 토글 → 옥외광고물법+신고 의무 표시 ②인원 500 → 인파·의료 의무 표시 ③개인정보만 체크 → conference 행사유형 미생성 + 개인정보 의무는 유지 ④인원 150000 → 경고 배너.

## 5. Part C — 입력: 템플릿 + 가이드 혼합

index.html 입력 패널(L38-86) 개편. 위→아래 3단:

### C-1. 행사 템플릿 카드 (6종)

기존 sample-row(4버튼)를 대체. `.mini-card` 기반 클릭 카드, 클릭 시 applyInput(프리셋)+자동 실행 (기존 SAMPLES 메커니즘 재사용 — SAMPLES 객체를 아래 6종으로 교체).

**주의(리뷰 발견 블로커)**: init L662가 `applyInput(SAMPLES.indoor)`로 기본 프리셋을 적용한다. SAMPLES 키 교체 시 이 참조를 새 키(전시·박람회 카드)로 함께 갱신하지 않으면 첫 로드가 TypeError → 에러 화면이 된다.

| 카드 | eventTypes | 주요 플래그 | 기본 인원 |
| --- | --- | --- | --- |
| 푸드트럭·먹거리 행사 | festival | outdoorEvent, foodService, lpgUse, temporaryElectricity, outdoorAdvertising | 2,000 |
| 플리마켓·장터 | festival | outdoorEvent, temporaryStructures, foodService, outdoorAdvertising | 800 |
| 야외 공연·버스킹 | performance | outdoorEvent, performance, temporaryStructures, temporaryElectricity | 3,000 |
| 전시·박람회 | exhibition | temporaryStructures, setupTeardown, temporaryElectricity, personalDataProcessing | 5,000 |
| 컨벤션·컨퍼런스 | conference | personalDataProcessing | 1,000 |
| 무주최 운집 대비 | (없음) | unhostedCrowd, outdoorEvent | 10,000 |

카드 적용 후에도 아래 토글로 자유 조정 가능 (프리셋 = 시작점).

### C-2. 쉬운 말 질문 토글

기존 `#featureFlags` 체크박스(전문 라벨)를 질문형 라벨로 교체하고 4개 그룹 fieldset으로 묶는다. value 키는 기존 플래그명 유지 (formInput/applyInput 호환).

- **장소·구조**: 야외에서 합니까?(outdoorEvent) / 도로·인도를 사용합니까?(roadUse) / 무대·부스·천막을 설치합니까?(temporaryStructures) / 현수막·배너·옥외 광고물을 답니까?(outdoorAdvertising)
- **전기·화기·가스**: 임시 전기·발전기를 씁니까?(temporaryElectricity) / 용접·화기 작업이 있습니까?(hotWork) / LPG·가스를 씁니까?(lpgUse)
- **작업**: 설치·철거 작업이 있습니까?(setupTeardown) / 높은 곳 작업이 있습니까?(workAtHeight) / 무거운 장비를 옮깁니까?(heavyObjectHandling)
- **운영**: 음식을 팔거나 제공합니까?(foodService) / 공연이 있습니까?(performance) / 참가자 명단·QR·CCTV를 다룹니까?(personalDataProcessing) / VIP·보안검색이 있습니까?(vipSecurity) / 주최자 없이 모이는 행사입니까?(unhostedCrowd)

인원 입력(#expectedCrowd)은 유지하되 도움말 한 줄 추가: "300명 이상이면 동선·의료 사전검토가 권고되고, 1,000명 이상이면 의무가 더 늘어납니다."

### C-3. 접이식 전문가 입력

`<details>` 안에 기존 그대로 이동: 행사 유형 체크박스(#eventTypes), 베뉴 선택(#venueId), 관할 지자체(#jurisdiction), 행사명(#eventName). 기존 사용자·정밀 사용 보존.

## 6. Part D — 출력: 행동 우선

renderResult(L541-581) 섹션 순서 재구성. 모든 접이식은 **네이티브 `<details>`** 사용 (innerHTML 전체 재생성 방식이라 JS 리스너 재바인딩 불필요 — 조사에서 확인된 제약).

1. **신선도·면책 배너** (상단 고정, `.notice`): "데이터 기준일 {currentAsOf} · 제출 전 관할기관·원문 확인 필요"
2. **scopeWarnings 배너** (있을 때만, `.notice.error` 톤)
3. **"✅ 이것부터 하세요"**: buildPriorityActions(L488-515)를 체크리스트 카드로 최상단 배치. 각 항목에 `<details>근거 보기</details>` 부착 — 이를 위해 buildPriorityActions 반환 항목에 근거 참조를 추가하는 구조 변경 필요 (현재 title/detail 문자열만 운반): 조례 액션은 record(조례명·관할·제출기한·시행일), 의무 액션은 duty.lawRefs → law-registry articles 요약, 위험 액션은 hazard.controls. 조례의 조문 발췌는 표시하지 않음 (A-1 프로젝션 트레이드오프 참조)
4. **한눈 판단 카드**: 기존 decisionSummary 7카드 유지 (이미 쉬운 말 + 적용/비적용 톤; B-3의 outdoorAdvertising 조건 추가 반영)
5. **접이식 상세 섹션들** (`<details>`로 감싸 기본 접힘): 법령 후보 / 지자체 조례 / 위험요인·통제 / 베뉴 체크포인트 / 작업자 안전 / 출처
6. **인쇄**: 닫힌 `<details>`는 인쇄에 안 나오고 CSS만으로 펼칠 수 없음 → printBtn 핸들러(L637)와 `beforeprint` 리스너에서 JS로 전체 `details.open = true` 부여 (인쇄 후 `afterprint`에서 복원). print 미디어 블록(styles.css L395-425)에는 템플릿 카드·토글 숨김 추가

## 7. 검증 계획

브라우저 수동 검증 (빌드 스텝·테스트 없음 — 기존과 동일):
1. `python3 -m http.server`로 adxdeck 루트 서빙 → /mice-safety/ 접속 (file://은 fetch 실패)
2. 템플릿 카드 6종 각각 클릭 → 결과 생성 + "이것부터 하세요"가 최상단
3. Part B 검증 4케이스 (§4)
4. 전문가 입력 펼침 → 베뉴 선택·관할 입력 동작 (기존 회귀 확인)
5. 인쇄 미리보기 → 입력 패널 숨김 + 접이식 섹션이 펼쳐져 표시
6. 네트워크 탭에서 local-ordinance-pack.json 크기 1MB 미만 확인
7. 첫 로드(새로고침) → 기본 프리셋 정상 적용 + 결과 자동 표시 (SAMPLES 키 교체 회귀 확인)

## 8. 리스크·제약 (조사에서 확인)

- FEATURES/inputFlags 라벨 테이블이 수동 병렬 동기화 — outdoorAdvertising 추가 시 양쪽 갱신
- `input.outdoor` 별칭은 formInput에서만 생성 — 템플릿 프리셋은 반드시 applyInput→formInput 경유 (기존 SAMPLES 방식 그대로)
- 9개 JSON 중 1개라도 로드 실패 시 전체 에러 — 동기화 스크립트가 파일 존재·JSON 유효성 확인
- priorityBand 컷오프(580/330)와 조례 limit(30/12)은 건드리지 않음 — 점수 체계 변경은 범위 외
- 의도된 동작 변화 1건: 임시전기만 체크한 실내 입력도 이제 exhibition 의무가 추가됨 (TS 패리티 목표에 부합 — 기존 SAMPLES 4종 결과에는 영향 없음 확인)
