# Trusted Safety Law Evidence Scorecard

Evaluation date: 2026-05-31
Package version: `1.0.3`
Rubric: [TRUSTED_SAFETY_LAW_RUBRIC.md](TRUSTED_SAFETY_LAW_RUBRIC.md), `2026-05-31-r1`

## Summary

총점: **85 / 100**

판정: **field-ready candidate**. 안전관리 실무 초안 생성·검수 도구로는 쓸 수 있는 수준이다. 다만 90점대 trusted-quality 목표로 보려면 조례 article-level 검증 비율과 베뉴 최신성 확인 범위를 더 올려야 한다.

## Score Table

| 지표 | 배점 | 현재 | 냉정한 평가 |
| --- | ---: | ---: | --- |
| 공식 출처성·추적성 | 10 | 8.5 | law.go.kr, 자치법규, 베뉴 문서, 공공 API source registry가 있고 audit report도 있다. 일부 출처는 요약·스냅샷 상태라 원문 재확인 필요성이 남는다. |
| 법령·조례 적용 판단 | 15 | 13.0 | 공연/도로/식음료/LPG/작업자 안전 과잉 적용 방지 negative test가 통과한다. `source_verified` 조례는 원문 조문 확인 액션으로 강등 표시된다. 다만 조례 751건 중 article_verified는 64건이라 넓은 지역 전체를 확정 판단으로 볼 수는 없다. |
| 조문을 실무 액션으로 번역 | 15 | 12.5 | 제출·협의 액션, RACI, 증빙, 런시트로 번역되는 구조가 있고, 조례 검증등급별 확인 액션도 요약 보고서에 들어간다. 아직 일부 법령·별표 출력은 실무 판단보다 체크리스트/조항 요약에 가깝다. |
| 위험요인 우선순위화 | 10 | 8.0 | 인파, 피난, 기상, 소방, 작업자 안전, 식음료/LPG, VIP/보안 등 핵심 위험은 잡는다. 다만 실제 밀도·폭·수용인원 계산 기반의 우선순위는 약하다. |
| 오프라인 온톨로지 완성도 | 10 | 9.0 | 35개 법령/행정규칙, 74개 조문, 35개 별표·서식 요약, 751개 조례, 19개 베뉴가 오프라인 조회된다. public-safe 베뉴 요약 코퍼스를 추가해 내부 원문성 extract와 공개 배포물을 분리했다. |
| 베뉴 규정 신뢰도 | 10 | 7.5 | 15개 원본 문서와 5,875개 facility entry를 검증하고, 공개 패키지는 요약·체크포인트만 포함한다. 수치·규정 최신성은 여전히 베뉴 재확인이 필요하다. |
| 최신성·검증 상태 표현 | 10 | 8.5 | `source_verified`, `article_verified`, `needs_review`, threshold confidence가 출력·검수·요약 액션에 반영된다. 다만 법령·베뉴 규정의 주기적 최신성 만료 게이트는 아직 부족하다. |
| 검증 자동화 | 10 | 9.5 | `typecheck`, `build`, `validate:scenarios`, `validate:venue-corpus`, `audit:sources`, `audit:package-safety`, `npm audit`가 통과한다. package safety fail gate와 source_verified 조례 액션 검증이 추가됐다. |
| 배포 안전성·라이선스 경계 | 5 | 4.5 | `npm pack --dry-run` 기준 full extracted venue Markdown, raw PDF/HWP, `.env`, cookie, validation store가 빠졌고 public-safe summary만 들어간다. 다만 베뉴별 이용조건 자체는 계속 `summary_only` 전제로 관리해야 한다. |
| 사용자 신뢰 UX | 5 | 4.0 | executive report와 웹 카드형 요약 방향은 맞고, 조건부 확인·비적용·남은 리스크가 앞에 나온다. 다만 복잡한 행사에서는 보고서가 여전히 길어져 3분 판단 UX를 더 다듬어야 한다. |

## Verification Evidence

- `npm run typecheck`: pass
- `npm run build`: pass
- `npm run validate:venue-corpus`: pass, 19 venues / 15 raw docs / 5,875 facility entries
- `npm run validate:scenarios`: pass, 8/8 scenarios
- `npm run audit:sources`: pass
- `npm run audit:package-safety`: pass, package entry 127개, violations 0건
- `npm audit --omit=dev`: 0 vulnerabilities
- `npm pack --dry-run --json`: full extracted venue Markdown 제외, public-safe venue summary 포함

## Remaining Risks

- 조례 pack은 넓지만 751건 중 64건만 `article_verified`다.
- `source_verified`는 공식 출처 확인이지, 제출기한·인원 기준·필수 서류가 조문 단위로 확정됐다는 뜻이 아니다.
- review score는 법적 적합성 점수가 아니라 커버리지 점검값이다.
- 베뉴 시설 수치와 운영규정은 실무 초안에는 유용하지만 최신 운영규정 확정값으로 보아서는 안 된다.

## Next Targets

- 90점: 주요 관할 조례 article-level 검증 확대, 최신성 게이트, executive report 압축.
- 95점: 주요 광역·기초 조례와 베뉴 규정의 원문 위치·검토일·만료일을 더 넓게 확정하고, 실제 행사 샘플 보고서의 사람 검토 품질을 높인다.
