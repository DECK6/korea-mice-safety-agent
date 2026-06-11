export const DATA_AS_OF = "2026-05-31";
export const DATA_REVIEW_BY = "2026-08-31";

export const COMMON_RESPONSE_META = {
  agent: "korea-mice-safety-agent",
  warning:
    "MICE 안전 도메인팩은 현장 의사결정 보조용입니다. 최종 법령 적용, 지자체 협의, 베뉴 승인, 경찰·소방·의료 협의는 최신 원문과 담당기관 확인이 필요합니다.",
  lawVerification:
    "LAW_OC를 환경변수로 주입한 korean-law-mcp/law.go.kr 조회 결과를 우선 근거로 삼고, 키가 없을 때는 verificationStatus가 todo/needs_review인 항목을 법적 판단에 사용하지 않습니다.",
  dataAsOf: DATA_AS_OF,
  dataReviewBy: DATA_REVIEW_BY,
  freshnessWarning:
    `법령·조례·베뉴 규정은 수시로 개정됩니다. 본 데이터 기준일은 ${DATA_AS_OF}이며 이후 개정 사항은 반영돼 있지 않을 수 있습니다. 제출·시행 전 원문(법제처 law.go.kr, 지자체 고시, 베뉴 최신 규정)을 반드시 재확인하세요.`,
  verificationLegend:
    "verificationStatus 의미: 'verified'/'article_verified'는 law.go.kr 원문 텍스트를 자동 수집·키워드 대조한 상태(스크래퍼 기준)이며 사람의 현행성·적용 적합성 검수를 보장하지 않습니다. 'needs_article_review'/'needs_source_review'/'todo'는 법적 판단 근거로 사용하지 마세요.",
} as const;

