# Trusted Safety Law Evidence Evaluation

Canonical split:

- 평가 기준: [TRUSTED_SAFETY_LAW_RUBRIC.md](TRUSTED_SAFETY_LAW_RUBRIC.md)
- 2026-05-31 현재 점수표: [TRUSTED_SAFETY_LAW_SCORECARD_2026-05-31.md](TRUSTED_SAFETY_LAW_SCORECARD_2026-05-31.md)

이 문서는 `korea-mice-safety-agent`를 "믿고 보는 안전 법령 근거 도구"로 볼 수 있는지 평가하기 위한 기준이다. 평가는 기능 개수나 문서 생성량이 아니라, 안전관리자가 실제 행사 조건을 넣었을 때 법령·조례·베뉴 규정·안전관리 기준을 근거 있는 실무 판단으로 바꿀 수 있는지를 본다.

현재 평가일: 2026-05-31

## 판정 기준

| 점수 | 판정 | 의미 |
| ---: | --- | --- |
| 90-100 | trusted release | 공개 배포 후에도 법령·조례·출처·배포 경계가 충분히 방어 가능하다. |
| 85-89 | field-ready candidate | 실무 초안 도구로 쓸 수 있으나 특정 출처·관할기관 확인 항목을 명확히 남긴다. |
| 75-84 | pilot/internal usable | 내부 검토, 파일럿, 데모에는 쓸 수 있으나 "믿고 보는" 수준이라고 말하기에는 이르다. |
| 60-74 | prototype | 근거 구조는 있으나 법령 적용 판단과 검증 체계가 아직 약하다. |
| 0-59 | unsafe to rely on | 안전 법령 근거 도구로 사용하면 오판 위험이 크다. |

## 평가 지표

| 지표 | 배점 | 평가 질문 |
| --- | ---: | --- |
| 공식 출처성·추적성 | 10 | 법령·조례·베뉴·공공 API 출처가 공식 출처인지, source id/url/date/status로 추적되는가. |
| 법령·조례 적용 판단 | 15 | 행사 조건별 공통법/조건부법/비적용법이 구분되고, 과잉 적용을 막는가. |
| 조문을 실무 액션으로 번역 | 15 | 조항 나열이 아니라 제출물, 담당자, 기한, 증빙, 협의기관, 기록보존으로 바뀌는가. |
| 위험요인 우선순위화 | 10 | 인파·동선·피난·소방·의료·작업자 안전 등에서 행사별 핵심 위험을 먼저 보여주는가. |
| 오프라인 온톨로지 완성도 | 10 | 런타임 네트워크 없이 법령, 조례, 베뉴 규정, KOSHA/산안기준규칙 요약을 조회할 수 있는가. |
| 베뉴 규정 신뢰도 | 10 | 베뉴별 시설·운영·안전 수칙이 출처 위치와 confidence를 갖고, 수동 확인 항목을 구분하는가. |
| 최신성·검증 상태 표현 | 10 | verified/source_verified/article_verified/needs_review/stale 등을 엄격하게 구분하는가. |
| 검증 자동화 | 10 | positive/negative scenario, ontology maturity, source audit, venue corpus 검증이 자동으로 실패를 잡는가. |
| 배포 안전성·라이선스 경계 | 5 | 공개 패키지에 raw PDF/HWP, full extracted venue Markdown, 키, 쿠키, 재배포 위험 자료가 섞이지 않는가. |
| 사용자 신뢰 UX | 5 | 결과물 맨 앞에서 결론, 핵심 위험, 적용/비적용 근거, 제출·협의 액션, 남은 리스크를 3분 안에 파악할 수 있는가. |

## 현재 점수

총점: **90 / 100**

판정: **trusted release**. 안전관리 실무 초안 생성·검수 도구로 공개 배포 후에도 법령·조례·출처·배포 경계를 방어할 수 있는 수준이다. 다만 95점 high-trust release로 보려면 조례 article-level 검증 범위와 베뉴 최신 운영규정 확인 범위를 더 넓혀야 한다.

| 지표 | 배점 | 현재 | 냉정한 평가 |
| --- | ---: | ---: | --- |
| 공식 출처성·추적성 | 10 | 9.0 | law.go.kr, 자치법규, 베뉴 문서, 공공 API source registry가 있고 audit report도 있다. 출처별 `currentAsOf`, `reviewBy`, `freshnessStatus`를 추가해 재검토 기한까지 추적한다. |
| 법령·조례 적용 판단 | 15 | 13.5 | 공연/도로/식음료/LPG/작업자 안전 과잉 적용 방지 negative test가 통과한다. `source_verified` 조례는 원문 조문 확인 액션으로 강등 표시되고, 주요 관할 조례 39건은 공식 HTML 조문 발췌로 우선 검증했다. |
| 조문을 실무 액션으로 번역 | 15 | 13.0 | 제출·협의 액션, RACI, 증빙, 런시트로 번역되는 구조가 있고, 조례 검증등급별 확인 액션도 요약 보고서에 들어간다. 맨 앞 요약에 `3분 판단용 실행 요약`을 추가해 조항보다 먼저 할 일을 보이게 했다. |
| 위험요인 우선순위화 | 10 | 8.0 | 인파, 피난, 기상, 소방, 작업자 안전, 식음료/LPG, VIP/보안 등 핵심 위험은 잡는다. 다만 실제 밀도·폭·수용인원 계산 기반의 우선순위는 약하다. |
| 오프라인 온톨로지 완성도 | 10 | 9.0 | 35개 법령/행정규칙, 74개 조문, 35개 별표·서식 요약, 751개 조례, 19개 베뉴가 오프라인 조회된다. public-safe 베뉴 요약 코퍼스를 추가해 내부 원문성 extract와 공개 배포물을 분리했다. |
| 베뉴 규정 신뢰도 | 10 | 8.0 | 15개 원본 문서와 5,875개 facility entry를 검증하고, 공개 패키지는 요약·체크포인트만 포함한다. 베뉴 안전프로필에 `reviewBy`와 `freshnessStatus`를 추가했지만 수치·규정 최신성은 여전히 베뉴 재확인이 필요하다. |
| 최신성·검증 상태 표현 | 10 | 9.5 | `source_verified`, `article_verified`, `needs_review`, threshold confidence가 출력·검수·요약 액션에 반영된다. `audit:freshness`가 source/ordinance/venue review date와 article verification minimum을 fail gate로 막는다. |
| 검증 자동화 | 10 | 10.0 | `typecheck`, `build`, `validate:scenarios`, `validate:venue-corpus`, `audit:sources`, `audit:freshness`, `audit:package-safety`, `npm audit`가 통과한다. ontology maturity 검증이 article_verified 100건 이상과 priority official article verification 35건 이상을 요구한다. |
| 배포 안전성·라이선스 경계 | 5 | 5.0 | `npm pack --dry-run` 기준 full extracted venue Markdown, raw PDF/HWP, `.env`, cookie, validation store가 빠졌고 public-safe summary만 들어간다. package safety audit가 이를 fail gate로 막으며, 베뉴별 이용조건은 계속 `summary_only` 전제로 관리한다. |
| 사용자 신뢰 UX | 5 | 5.0 | executive report와 웹 카드형 요약 방향은 맞고, 조건부 확인·비적용·남은 리스크가 앞에 나온다. `3분 판단용 실행 요약`과 검수 게이트를 추가해 실무자가 먼저 할 일, 담당, 기한, 증빙을 빠르게 확인한다. |

## 확인한 근거

- `npm run typecheck`: pass
- `npm run build`: pass
- `npm run validate:venue-corpus`: pass, 19 venues / 15 raw docs / 5,875 facility entries
- `npm run validate:scenarios`: pass, 8/8 scenarios, `article_verified` 105건과 priority official article verification 39건을 ontology maturity gate로 확인
- `npm run audit:sources`: pass, source audit regenerated
- `npm run audit:freshness`: pass, 53 sources / 751 ordinances / 19 venues, failures 0건
- `npm run audit:package-safety`: pass, package entry 129개, violations 0건
- `npm audit --omit=dev`: 0 vulnerabilities
- `npm pack --dry-run --json`: full extracted venue Markdown 제외, public-safe venue summary 포함

## 남은 감점 사유

1. 조례 pack의 넓이는 좋지만 article-level 확정성이 아직 전면적이지 않다.
   - 751건 중 105건만 article_verified다.
   - source_verified는 공식 출처에서 찾았다는 뜻이지, 적용 기준·제출기한·인원 threshold가 조문 단위로 확정됐다는 뜻이 아니다.

2. "검증 점수"가 법적 적합성으로 오해될 여지가 있다.
   - review score는 커버리지 점검값이어야 하며, 법률 자문이나 법적 적합성 점수처럼 보이면 안 된다.

3. 베뉴 시설 정보는 실무 초안에는 유용하지만, 최신 운영규정으로 확정된 수치라고 보면 위험하다.
   - floor load, ceiling height, loading, fire/evacuation, booth/rigging rules는 행사 신청 전 베뉴 담당자 확인을 남겨야 한다.

## 95점 이상으로 올리는 보완 순서

1. 주요 관할 조례 article_verified 비율 확대
   - 서울, 경기, 부산, 인천, 대구, 광주, 대전, 울산, 제주와 주요 MICE 도시의 옥외행사/축제/도로점용/옥외광고물 조례를 조문 단위로 추가 검증한다.
   - `article_verified` 조례만 제출기한·인원 threshold를 강한 근거로 표시한다.

2. 법령 근거를 의무·증빙 중심으로 더 압축
   - 맨 앞 요약 보고서에는 조문 번호보다 "해야 할 일", "누가", "언제", "증빙"을 우선한다.
   - 상세 조문은 annex/detail bundle로 내린다.

3. 최신성 게이트 고도화
   - 현재 `currentAsOf`, `reviewBy`, `freshnessStatus`는 들어갔지만, 실제 베뉴별 최신 운영규정 페이지와 조례 개정 이력을 더 넓게 확인해야 한다.

95점 이상은 주요 지자체 조례의 article_verified 비율과 베뉴별 최신 운영규정 확인 범위를 더 늘려야 현실적으로 가능하다.
