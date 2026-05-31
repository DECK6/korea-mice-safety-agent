# Trusted Safety Law Evidence Rubric

Rubric version: `2026-05-31-r1`

이 기준은 `korea-mice-safety-agent`를 "믿고 보는 안전 법령 근거 도구"로 평가하기 위한 고정 루브릭이다. 이후 90점, 95점 달성 여부도 같은 배점과 질문으로 비교한다.

평가는 기능 개수나 문서 생성량이 아니라, 안전관리자가 실제 행사 조건을 넣었을 때 법령·조례·베뉴 규정·안전관리 기준을 근거 있는 실무 판단으로 바꿀 수 있는지를 본다.

## 판정 기준

| 점수 | 판정 | 의미 |
| ---: | --- | --- |
| 95-100 | high-trust release | 주요 법령·조례·베뉴 출처가 조문/원문 위치 단위로 넓게 검증되고, 최신성·배포·과잉 적용 리스크가 자동 게이트로 관리된다. |
| 90-94 | trusted release | 공개 배포 후에도 법령·조례·출처·배포 경계가 충분히 방어 가능하다. |
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

## 90점 게이트

90점 이상을 다음 trusted-quality 목표로 본다. 프로젝트는 이미 1.0.x 라인에 있으므로 버전은 되돌리지 않고, 90점/95점 달성 여부를 이 루브릭으로 추적한다. 최소 조건은 다음과 같다.

- 주요 MICE 관할 조례의 `article_verified` 비율을 확대한다.
- `source_verified` 조례는 확정 근거가 아니라 원문 조문 확인 액션으로만 표시한다.
- 법령·조례·베뉴 출처별 최신성 만료 또는 재검토 기한을 자동 표시한다.
- npm package safety audit이 raw PDF/HWP, full extracted venue Markdown, 키, 쿠키, validation store를 fail gate로 막는다.
- negative scenario가 공연법, 도로점용, 식음료/LPG, 경비업, 작업자 안전 과잉 적용을 계속 막는다.

## 95점 게이트

95점 이상은 high-trust release로 본다. 90점 조건에 더해 다음이 필요하다.

- 주요 광역·기초 지자체의 핵심 조례 조문, 제출기한, threshold, 관할기관 협의 항목이 조문 단위로 검증된다.
- 베뉴별 핵심 수치와 규정은 최신 운영규정 또는 공식 페이지 기준의 검토일·만료일을 가진다.
- 실제 행사 샘플에서 사람이 보는 executive report가 조항 나열이 아니라 우선 위험, 적용/비적용 판단, 제출 액션, 증빙, 남은 리스크 중심으로 검토 가능하다.
- source audit, scenario validation, package safety, ontology diff, clean install smoke가 release gate로 묶인다.
