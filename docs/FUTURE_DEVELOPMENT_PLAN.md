# Korea MICE Safety Agent Future Development Plan

이 문서는 `korea-mice-safety-agent`의 향후 데이터·기능 확장 계획을 P0/P1/P2 단계로 정리한다. 핵심 방향은 문서 개수를 늘리는 것이 아니라, MICE/옥외행사 안전관리자가 법령·조례·베뉴 규정·현장 조건을 근거로 실무 초안을 만들고 검수할 수 있게 하는 것이다.

API별 회원가입, 활용신청, 인증키, 오프라인 운영 가능 여부는 [API_ACCESS_REQUIREMENTS.md](API_ACCESS_REQUIREMENTS.md)에 별도로 정리한다.

## 원칙

- 기본 MCP 런타임은 네트워크 없이 동작한다.
- 법령, 조례, 베뉴 규정, 안전수칙, 공연시설, 행사 카탈로그처럼 계획서·검수 근거가 되는 데이터는 오프라인 JSON/MD 온톨로지로 저장한다.
- 기상, 재난문자, 실시간 인구, 교통 돌발처럼 최신성이 안전 판단에 직접 영향을 주는 데이터는 live adapter 또는 event-day snapshot으로 분리한다.
- 온라인 데이터는 법적 근거가 아니라 운영 판단 보조 근거로 표시한다.
- API 키는 환경변수로만 사용하고 파일, build output, 문서, tarball에 저장하지 않는다.
- 공공누리, API 이용조건, 위치정보, 영상정보, 개인정보 조건은 source audit에서 별도 관리한다.

## 데이터 계층

| 계층 | 목적 | 런타임 네트워크 | 예시 |
| --- | --- | --- | --- |
| P0 offline ontology | 계획서·검수의 기본 근거 | 없음 | 법령, 조례, KOPIS 공연시설, 베뉴 규정, 행사 카탈로그, AED/응급의료기관, 식품 인허가 |
| P1 event-day snapshot | 행사 전·당일 위험 보강 | 수집 시점만 사용 | 서울 실시간 도시데이터 snapshot, ITS 교통 snapshot, 재난안전 snapshot, 대기질 snapshot |
| P2 live adapter | 운영본부 실시간 상황판단 | 필요 | 기상청 특보/단기예보, 재난문자, 실시간 혼잡, 교통 돌발, 대기질 |

## P0: Offline Evidence Pack

### 목표

네트워크 없이도 법령·조례·베뉴·공연·축제·응급·식품·작업자 안전 근거로 안전계획 초안과 검수 결과를 생성한다.

### 데이터 소스

- 국가법령정보/자치법규
  - 공연법, 재난안전법, 중대재해처벌법, 산업안전보건법, 산안기준규칙, 소방, 도로, 도로교통, 옥외광고물, 식품위생, 응급의료, 개인정보, 경비업
  - 광역/기초 지자체 지역축제 안전관리 조례, 옥외행사 안전관리 조례, 도로점용/교통소통 조례, 옥외광고물 조례
- KOPIS 공연시설
  - 전국 공연시설 2,111곳
  - 시설명, 주소, 관할, 분류, 연락처, 원천 URL
- KOPIS 공연/축제 정보
  - 공연 여부, 기간, 장소, 공연시설, 지역, 장르
- KCISA 지역축제정보
  - 축제명, 기간, 장소, 지역, 주최/주관 후보
- 한국관광공사 TourAPI/관광·축제·행사 데이터
  - 실존 행사 카탈로그와 지역 행사 샘플 보강
- 베뉴 운영규정/PDF/HWP
  - 반입, 하역, 전기, 소방, 피난, 금지물품, 리깅, 부스, 식음료, 작업 승인
- 응급의료기관/AED
  - 행사장 주변 의료 자원 후보
- 식품안전나라/인허가 데이터
  - 식품접객업, HACCP, 회수·판매중지 정보 요약
- 건축물대장/주소/지오코딩
  - 시설 주소, 행정구역, 용도, 층수 등 기본 보강

### 산출물

- `event-catalog-pack.json`
- `venue-directory-pack.json`
- `medical-resource-pack.json`
- `food-safety-pack.json`
- `offline-law-article-pack.json`
- `source-registry.json` 확장
- `source-audit-report.json` 갱신

### 도구

- `query_mice_event_catalog`
- `query_performance_venues`
- `query_mice_medical_resources`
- `query_mice_food_safety_refs`
- `query_mice_offline_source_status`
- `refresh_p0_offline_packs` 또는 scripts 기반 collector

### 계획서/검수 반영

- 공연 조건이면 KOPIS 공연·공연시설 정보를 공연법 적용 판단에 사용한다.
- 축제/옥외 조건이면 KCISA/TourAPI 행사 정보를 지역축제·옥외행사 조례 후보와 연결한다.
- `venueId`가 KOPIS 시설이면 주소·관할·분류만 반영하고, 수용인원·피난·하역·전기·반입 규정은 원문 확인 필요로 표시한다.
- 식음료 조건이 있을 때만 식품안전 pack을 필수/조건부 검토 항목으로 올린다.
- AED/응급의료기관은 응급의료 계획과 이송계획에 후보로 반영하되, 최신 운영 여부는 확인 필요로 표시한다.

### 검증 기준

- 네트워크 차단 상태에서 안전계획 생성과 검수가 가능해야 한다.
- KOPIS `kopis_...` venueId를 넣으면 관할 조례 후보가 자동 연결되어야 한다.
- 공연 없는 행사에는 공연법이 필수로 과잉 적용되지 않아야 한다.
- 식음료 없는 행사에는 식품위생/F&B pack이 필수로 과잉 적용되지 않아야 한다.
- 도로점용 없는 실내행사에는 도로점용 제출 액션이 필수로 나오지 않아야 한다.
- 생성 계획서에는 “실제 해야 할 일, 담당자, 증빙, 기한, 확인 필요사항”이 조항 나열보다 먼저 나와야 한다.

### 예상 릴리스

- 목표 버전: `1.1.0`
- 예상 공수: 1인 2~4주

## P1: Event-Day Snapshot Pack

### 목표

실시간성은 있지만 일정 시점에 내려받아 행사 전·당일 리스크 스냅샷으로 저장 가능한 데이터를 계획서와 운영 브리핑에 붙인다.

### 데이터 소스

- 서울 실시간 도시데이터
  - 주요 장소별 인구, 교통, 환경, 문화행사
- 서울 실시간 인구데이터
  - 주요 장소 실시간 인구현황
- ITS 국가교통정보센터
  - 교통소통, 돌발상황, CCTV 메타데이터, VMS, 주의운전구간
- 재난안전데이터 공유플랫폼
  - 재난문자, 재난상황, 교통·소방 관련 상황 데이터
- 에어코리아/대기질
  - 미세먼지, 오존 등 야외행사 환경 리스크

### 산출물

- `event-day-risk-snapshot.json`
- `traffic-risk-snapshot.json`
- `crowd-risk-snapshot.json`
- `disaster-alert-snapshot.json`
- `environment-risk-snapshot.json`

각 snapshot은 최소 다음 메타데이터를 가진다.

- `capturedAt`
- `expiresAt`
- `sourceLatency`
- `sourceId`
- `isStale`
- `useForDecision`
- `advisoryOnly`

### 도구

- `collect_mice_event_day_snapshot`
- `query_mice_risk_snapshot`
- `review_mice_event_day_risks`
- `attach_risk_snapshot_to_plan`

### 계획서/검수 반영

- snapshot이 없더라도 P0 계획서는 정상 생성되어야 한다.
- snapshot이 있으면 교통, 재난, 혼잡, 대기질 리스크를 별도 섹션으로 추가한다.
- 오래된 snapshot은 법령·조례 근거처럼 쓰지 않고 “참고/재확인 필요”로 표시한다.
- 위험이 높으면 운영 런시트와 스태프 배치, 비상연락망, 안내방송 템플릿에 보강 항목을 추가한다.

### 검증 기준

- snapshot 없이도 모든 기존 시나리오가 통과한다.
- snapshot 포함 시 위험 오버레이가 생성되며 기존 법령 적용 판단을 오염시키지 않는다.
- `isStale: true`인 snapshot은 `needs_review` 또는 `recheck_required`로 출력된다.
- 서울 데이터는 서울 외 지역 행사에 일반 적용되지 않는다.

### 예상 릴리스

- 목표 버전: `1.2.0`
- 예상 공수: 1인 2~4주

## P2: Live Operations Adapter

### 목표

행사 당일 운영본부가 실시간 API를 호출해 기상, 재난문자, 인파, 교통, 대기질 상태를 갱신하고, 상황 브리핑과 대응 카드를 생성한다.

### 데이터 소스

- 기상청 API Hub
  - 단기예보, 초단기예보, 특보
- 재난문자/재난안전데이터
  - 행사 주변 재난문자와 재난상황
- 실시간 인구/혼잡도
  - 서울 실시간 도시데이터 등 지역별 가용 데이터
- ITS 교통/돌발/CCTV
  - 도로점용, 셔틀, 비상차량 접근성 확인
- 대기질
  - 미세먼지, 오존, 폭염·취약자 대응 보조

### 산출물

- `live-risk-state`
- `live-weather-risk`
- `live-crowd-risk`
- `live-traffic-risk`
- `live-disaster-alerts`
- `live-decision-log`

### 도구

- `query_mice_live_weather_risk`
- `query_mice_live_crowd_risk`
- `query_mice_live_traffic_risk`
- `query_mice_live_disaster_alerts`
- `generate_mice_live_situation_brief`
- `record_mice_live_risk_decision`

### 운영 규칙

- P2 데이터는 법령 적용 근거가 아니라 운영 판단 근거다.
- API 실패 시 마지막 snapshot과 stale 경고를 반환한다.
- API 키가 없으면 graceful fallback을 제공한다.
- 모든 live 판단에는 timestamp, source, stale 여부, 권고 액션, 최종 책임자 확인 필요 여부를 포함한다.

### 예시 트리거

- 강풍 특보
  - 야외 무대, 트러스, 현수막, 임시구조물 점검
  - 설치·철거 또는 공연 중지 검토
- 호우/낙뢰
  - 야외 프로그램 중지, 대피 안내, 전기 차단 확인
- 혼잡도 급상승
  - 입장 제한, 우회 동선, 안내방송, 스태프 추가 배치
- 도로 돌발
  - 셔틀 동선 조정, 비상차량 접근로 재확인
- 대기질 악화
  - 취약자 보호, 마스크 안내, 야외 대기열 완화

### 검증 기준

- live API 실패가 계획서 생성 실패로 이어지지 않는다.
- live 결과는 상황 브리핑과 현장 이슈 대응 카드에만 연결된다.
- live 데이터가 법령/조례 적용 판단을 단정하지 않는다.
- 운영 로그에는 호출 시각, 응답 시각, 판단자, 조치, 증빙이 저장된다.

### 예상 릴리스

- 목표 버전: `1.3.0`
- 예상 공수: 1인 4~6주
- 실시간 관제 UI까지 포함하면 `2.0.0` 후보

## 전체 개발 순서

1. P0 source schema와 source audit 필드 확정
2. KOPIS 공연/공연시설, KCISA/TourAPI 축제·행사 catalog 오프라인화
3. 응급의료/AED, 식품안전, 건축/주소 보강 pack 추가
4. `generate_mice_safety_plan`과 `review_mice_safety_plan`에 P0 pack 반영
5. P0 regression scenario 추가
6. P1 snapshot schema와 collector 추가
7. P1 snapshot 기반 event-day risk review 추가
8. P2 live adapter를 optional 모듈로 추가
9. live situation brief와 decision log 추가
10. 배포 전 source audit, tarball audit, clean install smoke test 수행

## 릴리스 게이트

각 단계는 다음 검증을 통과해야 한다.

- `npm run typecheck`
- `npm run build`
- `npm run validate:scenarios`
- `npm run audit:sources`
- `npm audit --omit=dev`
- `npm pack --dry-run`
- clean smoke project 설치 후 주요 CLI 도구 실행

P1/P2는 추가로 다음을 확인한다.

- API 키 없이 graceful fallback
- stale snapshot 경고
- 네트워크 실패 시 MCP 기본 기능 유지
- live 데이터가 법령 근거로 오용되지 않음

## 장기 판단 기준

`korea-mice-safety-agent`의 성숙도는 기능 개수나 문서 개수로 판단하지 않는다. 다음 기준으로 판단한다.

- 행사 조건별 적용/비적용 판단이 정확한가
- 법령·조례·베뉴 규정을 실무 액션으로 번역하는가
- 과잉 적용을 줄이는가
- 책임자 검토와 관할기관 확인 필요 항목을 명확히 표시하는가
- 오프라인 근거와 온라인 운영 판단을 섞지 않는가
- 결과물이 안전관리자가 실제 초안으로 검토 가능한 형태인가
