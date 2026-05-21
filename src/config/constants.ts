export const COMMON_RESPONSE_META = {
  agent: "korea-mice-safety-agent",
  warning:
    "MICE 안전 도메인팩은 현장 의사결정 보조용입니다. 최종 법령 적용, 지자체 협의, 베뉴 승인, 경찰·소방·의료 협의는 최신 원문과 담당기관 확인이 필요합니다.",
  lawVerification:
    "LAW_OC를 환경변수로 주입한 korean-law-mcp/law.go.kr 조회 결과를 우선 근거로 삼고, 키가 없을 때는 verificationStatus가 todo/needs_review인 항목을 법적 판단에 사용하지 않습니다.",
} as const;

