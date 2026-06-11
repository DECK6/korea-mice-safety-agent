# Trusted Safety Law Evidence Scorecard

Evaluation date: 2026-05-31
Package version: `1.0.3`
Rubric: [TRUSTED_SAFETY_LAW_RUBRIC.md](TRUSTED_SAFETY_LAW_RUBRIC.md), `2026-05-31-r1`

## Summary

총점: **95 / 100**

판정: **high-trust release**. 안전관리 실무 초안 생성·검수 도구로 공개 배포 후에도 법령·조례·출처·배포 경계를 강하게 방어할 수 있는 수준이다. 단, 이 점수는 법적 적합성 보증이 아니라 offline ontology와 자동 검증 커버리지 기준의 신뢰도 평가다.

## Score Table

| 지표 | 배점 | 현재 | 냉정한 평가 |
| --- | ---: | ---: | --- |
| 공식 출처성·추적성 | 10 | 9.5 | law.go.kr, 자치법규, 베뉴 문서, 공공 API source registry가 있고 audit report도 있다. 출처별 `currentAsOf`, `reviewBy`, `freshnessStatus`, 베뉴 공식 링크 검증 상태까지 추적한다. |
| 법령·조례 적용 판단 | 15 | 14.5 | 공연/도로/식음료/LPG/작업자 안전 과잉 적용 방지 negative test가 통과한다. 조례 751건 전부 `article_verified`이며, 도로점용·옥외행사·옥외광고물·지역축제 범주가 모두 조문 발췌를 가진다. |
| 조문을 실무 액션으로 번역 | 15 | 14.0 | 제출·협의 액션, RACI, 증빙, 런시트로 번역되는 구조가 있고, 조례 검증등급별 확인 액션도 요약 보고서에 들어간다. 일부 조문 발췌는 여전히 관할기관 해석이 필요한 원문 후보로 남긴다. |
| 위험요인 우선순위화 | 10 | 8.5 | 인파, 피난, 기상, 소방, 작업자 안전, 식음료/LPG, VIP/보안 등 핵심 위험은 잡는다. 다만 실제 밀도·폭·수용인원 계산 기반의 우선순위는 아직 제한적이다. |
| 오프라인 온톨로지 완성도 | 10 | 10.0 | 35개 법령/행정규칙, 74개 조문, 35개 별표·서식 요약, 751개 article-verified 조례, 19개 베뉴, KOPIS 공연시설 2,111곳이 오프라인 조회된다. |
| 베뉴 규정 신뢰도 | 10 | 9.0 | 15개 원본 문서와 5,875개 facility entry를 검증하고, 33개 베뉴 공식 sourceRef 링크가 모두 reachable이다. 일부 베뉴는 운영규정 전문 대신 공식 시설/임대 페이지 요약 기반이라 1점을 남긴다. |
| 최신성·검증 상태 표현 | 10 | 10.0 | `article_verified`, `currentAsOf`, `reviewBy`, `freshnessStatus`, venue official source link verification이 자동 gate로 묶였다. `audit:freshness`가 조례 751건과 베뉴 링크 33건을 fail gate로 확인한다. |
| 검증 자동화 | 10 | 10.0 | `typecheck`, `build`, `validate:scenarios`, `validate:venue-corpus`, `audit:sources`, `audit:freshness`, `audit:package-safety`, `npm audit`, clean install smoke가 통과한다. ontology maturity 검증이 95점 기준을 직접 확인한다. |
| 배포 안전성·라이선스 경계 | 5 | 5.0 | `npm pack --dry-run` 기준 full extracted venue Markdown, raw PDF/HWP, `.env`, cookie, validation store가 빠졌고 public-safe summary만 들어간다. package safety audit가 이를 fail gate로 막는다. |
| 사용자 신뢰 UX | 5 | 4.5 | executive report와 웹 카드형 요약에서 조건부 확인·비적용·남은 리스크가 앞에 나온다. `3분 판단용 실행 요약`은 들어갔지만 복합 행사에서는 여전히 사람 검토 밀도를 더 줄일 여지가 있다. |

## Verification Evidence

- `npm run typecheck`: pass
- `npm run build`: pass
- `npm run validate:venue-corpus`: pass, 19 venues / 15 raw docs / 5,875 facility entries
- `npm run validate:scenarios`: pass, 8/8 scenarios, `article_verified` 751건과 venue official source verification gate 확인
- `npm run audit:sources`: pass
- `npm run audit:freshness`: pass, 53 sources / 751 ordinances / 19 venues / 33 venue source refs, failures 0건
- `npm run audit:package-safety`: pass, package entry 129개, violations 0건
- `npm audit --omit=dev`: 0 vulnerabilities
- `npm pack --dry-run --json`: full extracted venue Markdown 제외, public-safe venue summary 포함
- clean tarball smoke: CLI `1.0.3`, tools listing, local ordinance query, worker safety query, plan generation `3분 판단용 실행 요약` 확인

## Remaining Risks

- 95점은 자체 평가(self-assessed)이며 외부 기관의 독립 검증을 거친 점수가 아니다. 법률 자문 품질 보증이 아니라 offline source coverage와 validation gate 기준의 신뢰도 점수다.
- **`verified`/`article_verified`의 의미 한정**: 이 라벨은 law.go.kr 원문 텍스트를 자동 수집해 키워드로 대조한 "스크래퍼 매칭 성공" 상태를 뜻하며, 사람의 현행성·조문 선택 적합성·시행일 검수를 거쳤다는 뜻이 아니다. 스크래퍼가 폐지·개정 전 조문이나 잘못된 하위 조항을 가져와도 동일하게 `verified`로 표기될 수 있다. 자동 검증 커버리지를 인간 검증과 동일시하지 않는다. (조문별 시행일·검수자 메타는 후속 보강 대상)
- 조례 조문은 751건 모두 발췌됐지만, 실제 제출기한·서식·관할부서 해석은 행사 전 관할기관 확인이 필요하다.
- 베뉴 공식 링크 33건은 reachable이지만, 일부 베뉴는 운영규정 전문 문서가 아니라 공식 시설/임대 페이지 요약 기반이다.
- 실제 밀도·폭·체류시간 기반의 정량 인파 시뮬레이션은 아직 별도 실시간/공간 데이터가 필요하다.

## Next Targets

- 97점+: 베뉴별 최신 운영규정 전문 확보율 확대, 실제 행사별 사람 검토 샘플 추가, 인파 밀도·동선 정량 판단 보강.
