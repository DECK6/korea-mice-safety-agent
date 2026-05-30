# API Access Requirements

이 문서는 P0/P1/P2 개발에 필요한 공공 API와 회원가입, 활용신청, 인증키, 오프라인 저장 가능 여부를 정리한다. 확인 기준일은 2026-05-31이다. API 이용조건과 트래픽, 승인 방식은 변동될 수 있으므로 collector 구현 전 각 공식 페이지에서 다시 확인한다.

## 기본 원칙

- API 키는 환경변수 또는 로컬 `.env`에만 둔다.
- API 키, 다운로드 쿠키, 원본 응답 중 민감값은 git, npm package, docs, validation output에 저장하지 않는다.
- P0는 수집 시점에만 API를 호출하고 런타임은 offline JSON/MD ontology만 사용한다.
- P1은 행사 전·당일 snapshot을 저장하되, 오래된 snapshot은 `stale`로 표시한다.
- P2는 live adapter로 분리하고, live 데이터는 법령 적용 근거가 아니라 운영 판단 근거로만 사용한다.
- 공공누리 Type 4, 위치정보, 개인정보, 영상정보, API별 재배포 제한은 `source-registry`와 source audit에서 별도 표시한다.

## 현재 키 확보 현황

확인 기준: 2026-05-31. 실제 키 값은 문서에 기록하지 않고, 로컬 `.env` 또는 외부 보관처 존재 여부만 상태로 표시한다.

### 전체 요약

| 구간 | 대상 | 준비됨 | 발급 대기 | 부분 준비 | 미확보/후순위 | 비고 |
| --- | --- | --- | --- | --- | --- | --- |
| P0 Offline Evidence Pack | 10개 데이터 묶음 | 5개 + `LAW_OC` 외부 보유 | 0개 | 1개 | 3개 | P0-10 베뉴 운영규정은 키 불필요 |
| P1 Event-Day Snapshot Pack | 6개 데이터 묶음 | 3개 | 2개 | 0개 | 1개 | ITS/재난안전은 신청 완료, 키 대기 |
| P2 Live Operations Adapter | 5개 데이터 묶음 | 3개 | 2개 | 0개 | 0개 | 기상·인파·대기질은 바로 구현 가능 |

### P0: Offline Evidence Pack 키 상태

| 우선순위 | 환경변수 | 상태 | 메모 |
| --- | --- | --- | --- |
| P0-1 | `LAW_OC` | 외부 보유 확인 | 마스터가 DECK 쪽 보유를 확인. repo `.env`에는 아직 미반영 |
| P0-2 | `KOPIS_SERVICE_KEY` | 준비됨 | KOPIS 본 API 키 `.env` 반영됨 |
| P0-3 | `KCISA_KOPIS_FACILITY_KEY` | 준비됨 | KCISA KOPIS 공연시설별 상세정보 키 `.env` 반영됨 |
| P0-3 | `KCISA_FESTIVAL_KEY` | 미확보/미반영 | 지역축제정보용 키. 별도 발급 또는 기존 KCISA 키 공용 가능 여부 확인 필요 |
| P0-4 | `TOUR_API_SERVICE_KEY` | 준비됨 | 공공데이터포털/한국관광공사 TourAPI 키 `.env` 반영됨 |
| P0-5 | `NEMC_SERVICE_KEY` | 준비됨 | 응급의료기관/AED 조회 서비스 키 `.env` 반영됨 |
| P0-6 | `FOOD_SAFETY_API_KEY` | 준비됨 | 식품안전나라 공통 키 `.env` 반영됨 |
| P0-7 | `LOCAL_LICENSE_SERVICE_KEY` | 미확보 | 지방행정인허가/식품접객업 등 보조 pack용 |
| P0-8 | `BUILDING_LEDGER_KEY`, `ADDRESS_API_KEY` | 미확보 | 건축물대장/주소/지오코딩 보강용 |
| P0-9 | `SAFEMAP_SERVICE_KEY` | 미확보/특수심사 가능 | 생활안전지도 일부 API는 위치기반서비스 신고필증 등 조건 가능 |
| P0-10 | 없음 | 키 불필요 | 베뉴 공개 PDF/HWP 수집. 저작권/재배포 조건 확인 필요 |

### P1: Event-Day Snapshot Pack 키 상태

| 우선순위 | 환경변수 | 상태 | 메모 |
| --- | --- | --- | --- |
| P1-1 | `SEOUL_OPENAPI_KEY` | 준비됨 | 서울 실시간 도시데이터용 키 `.env` 반영됨 |
| P1-2 | `SEOUL_OPENAPI_KEY` 또는 `DATA_GO_KR_KEY` | 준비됨 | 서울 실시간 인구데이터는 `SEOUL_OPENAPI_KEY`로 우선 커버. `DATA_GO_KR_KEY`는 별도 공통 변수로는 미반영 |
| P1-3 | `ITS_OPENAPI_KEY` | 발급 대기 | 국가교통정보센터 신청 완료, 키 발급 대기 |
| P1-4 | `SAFETY_DATA_API_KEY` | 발급 대기 | 재난안전데이터 공유플랫폼 `행정안전부_긴급재난문자` 신청 완료, 키 발급 대기 |
| P1-5 | `AIRKOREA_SERVICE_KEY` | 준비됨 | 에어코리아 대기오염정보 키 `.env` 반영됨 |
| P1-6 | `ESHARE_SERVICE_KEY` | 미확보/후순위 | 공유누리/공공시설 자원은 MICE 안전 핵심 후순위 |

### P2: Live Operations Adapter 키 상태

| 우선순위 | 환경변수 | 상태 | 메모 |
| --- | --- | --- | --- |
| P2-1 | `KMA_APIHUB_KEY` | 준비됨 | 기상청 API Hub 키 `.env` 반영됨. 단기/초단기/중기예보, 특보, 영향예보, AWS, 레이더, 낙뢰, 생활·보건기상지수 승인 범위 확인됨 |
| P2-2 | `SAFETY_DATA_API_KEY` | 발급 대기 | 1차 구현은 긴급재난문자 중심. 재난관리책임기관 공개 데이터는 일반 계정 의존 금지 |
| P2-3 | `SEOUL_OPENAPI_KEY` | 준비됨 | 서울권 인파/혼잡도 live adapter 우선 구현 가능 |
| P2-4 | `ITS_OPENAPI_KEY` | 발급 대기 | 키 발급 후 교통소통/돌발/CCTV/VMS 승인 범위 확인 필요 |
| P2-5 | `AIRKOREA_SERVICE_KEY` | 준비됨 | 대기질/환경 live 조회 가능 |

### 우선 처리 남은 항목

1. 발급 대기 키 수령 후 `.env` 반영
   - `ITS_OPENAPI_KEY`
   - `SAFETY_DATA_API_KEY`
2. P0 보강 여부 결정
   - `KCISA_FESTIVAL_KEY`
   - `LOCAL_LICENSE_SERVICE_KEY`
   - `BUILDING_LEDGER_KEY`
   - `ADDRESS_API_KEY`
   - `SAFEMAP_SERVICE_KEY`
3. 후순위/선택 항목
   - `ESHARE_SERVICE_KEY`
   - `DATA_GO_KR_KEY` 공통 변수 분리 여부

## 신청 상태 구분

| 상태 | 의미 |
| --- | --- |
| no_key_public | 인증키 없이 공개 페이지/파일로 수집 가능. 단, 이용약관·저작권 확인 필요 |
| signup_key | 회원가입 또는 로그인 후 인증키 발급 필요 |
| apply_key_auto | 활용신청 후 자동 승인 또는 간단 정보 입력 후 키 발급 |
| apply_key_review | 활용신청 후 담당자/운영기관 승인 필요 |
| special_review | 기관회원, 위치기반서비스 신고필증, 공문, 별도 심의 등 추가 조건 가능 |
| live_only | 최신성이 핵심이라 오프라인 저장본은 참고용으로만 사용 |

## P0: Offline Evidence Pack

P0 데이터는 안전계획·검수의 기본 근거다. collector가 API를 호출해 offline JSON/MD pack으로 저장하고, MCP 런타임은 네트워크 없이 조회해야 한다.

| 우선순위 | API/데이터 | 제공기관/포털 | 가입·신청 | 키/환경변수 제안 | 오프라인 운영 | 주요 용도 | 주의 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P0-1 | 국가법령정보 공동활용 Open API | 법제처 `open.law.go.kr` | signup_key 또는 apply_key_auto. 요청 변수 `OC`가 필수인 API가 있음 | `LAW_OC` | 가능. 법령/조례 핵심 조문 pack으로 저장 | 법령, 행정규칙, 자치법규, 조문 검증 | 현행성 중요. collector 실행 시점과 `currentAsOf` 저장 |
| P0-2 | KOPIS 공연시설/공연/축제 Open API | 공연예술통합전산망 KOPIS | signup_key. 인증키 발급 필요, PC 발급 안내, 1인 1개, 유효기간/미사용 취소 조건 있음 | `KOPIS_SERVICE_KEY` | 가능. 공연·축제 catalog와 공연시설 directory로 저장 | 공연법 적용 판단, 공연시설 관할 보강, 공연/축제 실존 데이터 | KOPIS 출처 표기 필수. 집계/예매 통계는 실제 전체 관객과 차이 가능 |
| P0-3 | 문화공공데이터광장 KCISA Open API | 문화체육관광부/KCISA `culture.go.kr`, `api.kcisa.kr` | apply_key_auto. 활용신청 후 OpenAPI 키 발급, 별도 확인 절차 없이 자동 승인 안내 | `KCISA_KOPIS_FACILITY_KEY`, `KCISA_FESTIVAL_KEY` | 가능. 지역축제/공연시설 snapshot 저장 | 지역축제정보, KOPIS 공연시설별 상세정보 보강 | 현행 데이터 갱신 주기 확인. 키는 저장소에 기록 금지 |
| P0-4 | 한국관광공사 TourAPI/국문 관광정보 서비스 | 한국관광공사, 공공데이터포털 | signup_key + 활용신청. 공공데이터포털 회원가입, API 선택 후 활용신청, 인증키 확인 | `TOUR_API_SERVICE_KEY` | 가능. 행사·축제·관광지 catalog로 주기 저장 | 실존 행사 샘플, 지역 축제/문화행사 후보, 주소·관할 보강 | 개발계정/운영계정 트래픽과 심의 여부는 dataset별 확인 |
| P0-5 | 응급의료기관 정보/AED 정보 조회 | 국립중앙의료원/E-GEN, 공공데이터포털 | signup_key + 활용신청. 공공데이터포털 로그인 후 신청 안내 | `NEMC_SERVICE_KEY` | 가능. 월/분기 snapshot 권장 | 응급의료·AED·이송 병원 후보 | 당일 운영 여부와 접근성은 최신 확인 필요 |
| P0-6 | 식품안전나라 Open API | 식품의약품안전처/식품안전나라 | signup_key. 회원에 한해 인증키 신청 발급 안내 | `FOOD_SAFETY_API_KEY` | 일부 가능. 인허가/HACCP는 offline, 회수·판매중지는 최신 snapshot 권장 | 식음료/F&B 업체 확인, HACCP, 회수·판매중지 참고 | 회수·판매중지는 최신성 중요. 분당/일 호출 제한 확인 |
| P0-7 | 지방행정인허가/식품접객업 등 인허가 데이터 | 공공데이터포털/지자체 인허가 데이터 | signup_key + 활용신청. dataset별 승인 확인 | `LOCAL_LICENSE_SERVICE_KEY` | 가능. 식품·임시영업·옥외광고 등 보조 pack | F&B 업체 인허가, 행사 관련 영업신고 후보 | 원천별 제공 범위·라이선스 확인 |
| P0-8 | 건축물대장/주소/지오코딩 | 국토교통부/행안부/공공데이터포털 | signup_key + 활용신청 또는 portal별 key | `BUILDING_LEDGER_KEY`, `ADDRESS_API_KEY` | 가능. 시설 주소·용도·층수 보강 snapshot | 실내시설/건축물 용도, 주소 표준화, 관할 매핑 | 피난·소방 상세도면을 대체하지 않음 |
| P0-9 | 생활안전지도 일부 시설 레이어 | 생활안전지도/공공데이터포털 | special_review 가능. 일부 API는 위치기반서비스사업 신고필증 미등록 시 반려 가능 안내 | `SAFEMAP_SERVICE_KEY` | 조건부 가능 | AED, 대피소, 무더위쉼터, 생활안전시설 후보 | 위치정보·재배포 조건·공공누리 확인 필요 |
| P0-10 | 베뉴 운영규정/PDF/HWP | COEX, KINTEX, BEXCO 등 각 베뉴 | no_key_public 또는 개별 다운로드. 일부 문서는 링크/요약만 가능 | 없음 | 가능. 원문 보관 가능 범위 확인 후 MD/structured extract 저장 | 하역, 전기, 소방, 피난, 반입, 금지물품, 리깅 | 저작권/재배포 조건에 따라 summary_only/link_only 가능 |

## P1: Event-Day Snapshot Pack

P1 데이터는 행사 전·당일 위험 보강용이다. 수집 시점에 API를 호출해 snapshot을 저장하고, 계획서에는 `capturedAt`, `expiresAt`, `isStale`을 함께 표시한다.

| 우선순위 | API/데이터 | 제공기관/포털 | 가입·신청 | 키/환경변수 제안 | 오프라인 운영 | 주요 용도 | 주의 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1-1 | 서울 실시간 도시데이터 | 서울 열린데이터광장 | signup_key. Open API 인증키 발급 필요 | `SEOUL_OPENAPI_KEY` | snapshot 가능. 서울 한정 | 장소별 인구, 혼잡도, 교통, 환경, 문화행사 | 서울 외 지역에 일반화 금지. stale 판단 필수 |
| P1-2 | 서울 실시간 인구데이터 | 서울 열린데이터광장/공공데이터포털 | signup_key 또는 공공데이터포털 활용신청 | `SEOUL_OPENAPI_KEY` 또는 `DATA_GO_KR_KEY` | snapshot 가능. 서울 주요 장소 한정 | 한강, 광화문, 잠실 등 인파 위험 보강 | 실시간성 높음. P2 live 후보이기도 함 |
| P1-3 | ITS 교통소통/돌발/CCTV/VMS | 국가교통정보센터 ITS | apply_key_review. 회원가입 후 인증키 신청, 관리자 승인 안내. 2026-05-30 기준 신청 완료, 키 발급 대기 | `ITS_OPENAPI_KEY` | snapshot 가능. live 우선 | 도로점용, 교통통제, 비상차량 접근, 셔틀 동선 | CCTV 영상은 저장/재배포 주의. 운영에는 최신 조회 필요 |
| P1-4 | 재난안전데이터 공유플랫폼 | 행정안전부 재난안전데이터 공유플랫폼 | signup_key 또는 dataset별 신청. 2026-05-30 기준 `행정안전부_긴급재난문자`는 신청 완료, API 키 발급 대기. 소방·교통 등 일부 데이터는 `재난관리책임기관 공개`로 표시되어 일반 계정 활용 대상에서 제외 가능 | `SAFETY_DATA_API_KEY` | snapshot 가능. live 우선 | 재난문자, 재난상황, 소방·교통 이벤트 | 재난문자는 최신성이 핵심. snapshot은 참고용. 재난관리책임기관 공개 데이터는 기관 자격/권한 확인 전 구현 의존 금지 |
| P1-5 | 에어코리아 대기오염정보 | 한국환경공단/공공데이터포털 | signup_key + 활용신청 | `AIRKOREA_SERVICE_KEY` | snapshot 가능 | 미세먼지, 오존, 취약자 보호, 야외 대기열 운영 | 당일 의사결정은 최신 조회 필요 |
| P1-6 | 공유누리/공공시설 자원 | 공유누리 등 | apply_key_review 가능. 담당자 승인 소요 안내 사례 있음 | `ESHARE_SERVICE_KEY` | 가능 | 임시 대피/지원 시설 후보 탐색 | MICE 안전 핵심은 아니므로 후순위 |

## P2: Live Operations Adapter

P2 데이터는 행사 당일 운영 판단용이다. 저장본은 로그와 fallback으로만 쓰고, 최신 판단은 API live 호출을 기준으로 한다.

| 우선순위 | API/데이터 | 제공기관/포털 | 가입·신청 | 키/환경변수 제안 | 오프라인 운영 | 주요 용도 | 주의 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P2-1 | 기상청 API Hub 단기/초단기/중기예보, 특보, 영향예보, AWS, 레이더, 낙뢰, 생활·보건기상지수 | 기상청 API허브 | signup_key. 회원가입 후 인증키 발급, 기관회원은 공문 조건 가능. 2026-05-30 기준 핵심 예보·특보·영향예보·AWS와 레이더/낙뢰/생활기상/중기예보 항목 승인됨 | `KMA_APIHUB_KEY` | live_only. snapshot은 fallback | 강풍, 호우, 낙뢰, 폭염, 한파, 강수 접근, 작업/행사 중지 기준, D-7~D-day 기상 위험 판단 | 최신성이 안전 판단 핵심. 오래된 값은 사용 금지. 레이더/격자/파일형 자료는 저장·재배포 범위와 용량 관리 필요 |
| P2-2 | 재난문자/재난상황 | 재난안전데이터 공유플랫폼 | signup_key 또는 dataset별 신청. `행정안전부_긴급재난문자` 신청 완료/API 키 발급 대기. 재난관리책임기관 공개 데이터는 일반 live adapter 범위에서 제외하거나 별도 권한 확인 필요 | `SAFETY_DATA_API_KEY` | live_only. snapshot은 fallback | 주변 재난문자, 긴급 상황, 관계기관 대응 | 행사장 위치 기반 필터링 필요. 1차 구현은 긴급재난문자 중심으로 설계 |
| P2-3 | 실시간 인파/혼잡도 | 서울 열린데이터광장 등 지역별 API | signup_key | `SEOUL_OPENAPI_KEY` | live_only. snapshot은 fallback | 인파 밀집, 병목, 입장 제한, 우회 동선 | 제공 지역 제한. 로컬 CCTV/센서와 혼동 금지 |
| P2-4 | ITS 교통 돌발/소통/CCTV | 국가교통정보센터 ITS | apply_key_review. 2026-05-30 기준 신청 완료, 키 발급 대기 | `ITS_OPENAPI_KEY` | live_only. snapshot은 fallback | 교통통제, 비상차량 접근, 셔틀 우회 | 영상/위치정보 저장 정책 주의 |
| P2-5 | 대기질/환경 | 에어코리아/기상청 등 | signup_key + 활용신청 | `AIRKOREA_SERVICE_KEY` | live 우선 | 미세먼지, 오존, 취약자 보호, 야외 프로그램 조정 | 실시간 값과 예보값 구분 |

## 가입·신청 우선순위

개발 착수 시 실제 키 확보 순서는 다음이 적절하다.

1. `LAW_OC`
   - 이미 법령/조례 pack의 핵심이다.
2. `KCISA_KOPIS_FACILITY_KEY`
   - 이미 KOPIS 공연시설 2,111곳 확장에 사용 중이다.
3. `KOPIS_SERVICE_KEY`
   - KOPIS 본 API의 공연/축제 catalog를 P0에 넣기 위해 필요하다.
4. `TOUR_API_SERVICE_KEY`
   - 실존 축제·행사 catalog 보강에 필요하다.
5. `NEMC_SERVICE_KEY`
   - AED/응급의료기관 pack에 필요하다.
6. `FOOD_SAFETY_API_KEY`
   - 식음료/F&B 시나리오 품질을 높이는 데 필요하다.
7. `SEOUL_OPENAPI_KEY`
   - P1/P2 서울 실시간 인파·도시데이터에 필요하다.
8. `KMA_APIHUB_KEY`
   - P2 live weather adapter에 필요하다.
9. `ITS_OPENAPI_KEY`
   - 도로점용/교통통제 행사 운영 고도화에 필요하다.
   - 2026-05-30 기준 국가교통정보센터 신청 완료, API 키 발급 대기 상태다.
10. `SAFETY_DATA_API_KEY`
    - 재난문자/재난상황 live adapter에 필요하다.
    - 2026-05-30 기준 `행정안전부_긴급재난문자`는 신청 완료, API 키 발급 대기 상태다.
    - 소방·교통 등 일부 후보 데이터는 `재난관리책임기관 공개`로 확인되어 일반 서비스 키만으로 사용 가능한 전제로 두지 않는다.

## 신청 상태 메모

- 국가교통정보센터 ITS
  - `ITS_OPENAPI_KEY`: 신청 완료, API 키 발급 대기.
  - 키 발급 후 교통소통/돌발/CCTV/VMS 중 실제 승인 범위를 확인하고 live adapter 범위를 확정한다.
  - CCTV 영상은 저장·재배포하지 않고, 운영 판단용 메타데이터/링크 수준으로 제한한다.

- 재난안전데이터 공유플랫폼
  - `행정안전부_긴급재난문자`: 신청 완료, `SAFETY_DATA_API_KEY` 발급 대기.
  - 소방·교통·기타 이벤트성 후보: 포털상 `재난관리책임기관 공개` 항목은 일반 계정 신청 대상에서 제외하거나 기관 자격 확인 후 별도 진행한다.
  - 구현 우선순위: 1차 live adapter는 긴급재난문자 API만 안정적으로 붙이고, 소방/교통 이벤트는 ITS·공공데이터포털 등 대체 소스와 비교한다.

## 구현 메모

### 키 관리

- `.env.example`에는 변수명과 설명만 둔다.
- 실제 `.env`는 `.gitignore`로 제외한다.
- collector 실행 로그에는 요청 URL 전체를 남기지 않는다. 서비스키가 query string에 포함될 수 있기 때문이다.
- raw XML/JSON 저장 시 요청 URL, header, key가 포함되지 않도록 정규화한다.

### Collector 패턴

- `scripts/collect-*.mjs`는 API 호출, raw 저장, normalized JSON 생성, source audit 갱신을 분리한다.
- raw 저장은 `data/raw/**` 아래에 두고 git에서 제외한다.
- 배포 가능한 결과만 `src/ontology/mice/**.json` 또는 `data/markdown/**.md`로 승격한다.
- offline pack에는 `sourceId`, `retrievedAt`, `currentAsOf`, `licensePolicy`, `verificationStatus`, `sourceConfidence`를 둔다.

### Runtime 패턴

- P0 도구는 offline pack만 읽는다.
- P1 도구는 snapshot이 없거나 오래되면 경고를 낸다.
- P2 도구는 live API 실패 시 graceful fallback을 제공한다.
- P2 응답은 `legalBasis`가 아니라 `operationalEvidence` 아래에 둔다.

## 구현된 개발 도구

available-key-first P0/P1/P2 경로는 다음 MCP/CLI 도구로 확인한다.

```bash
node build/cli.js call query_mice_api_access_status --inputJson '{}'
node build/cli.js call collect_mice_p0_ready_sources --inputJson '{"liveProbe":true,"limit":3,"startDate":"20260501","endDate":"20260531"}'
node build/cli.js call generate_mice_event_day_snapshot --inputJson '{"jurisdiction":"서울특별시 강남구","seoulAreaName":"강남역","airStationName":"종로구","live":true}'
node build/cli.js call query_mice_live_operations_status --inputJson '{"jurisdiction":"서울특별시 강남구","seoulAreaName":"강남역","airStationName":"종로구","nx":61,"ny":125,"live":true}'
```

- `query_mice_api_access_status`는 키 값 없이 configured/missing/pending/externally_available/no_key_required 상태만 반환한다.
- `collect_mice_p0_ready_sources`는 기본적으로 dry-run이지만, `liveProbe:true`이면 KCISA KOPIS 공연시설, KOPIS 공연목록, TourAPI 축제/행사, NEMC 응급의료기관/AED, 식품안전나라 회수·판매중지 API를 소량 호출해 실제 응답과 정규화 결과를 검증한다. 파일은 쓰지 않고 키 값도 출력하지 않는다.
- `generate_mice_event_day_snapshot`은 `live:true`에서 서울 실시간 도시데이터와 에어코리아를 실제 호출해 snapshot record와 관측 요약을 반환한다. ITS/재난문자는 키 발급 전까지 `pending_key` fallback이다.
- `query_mice_live_operations_status`는 `live:true`에서 기상청 API Hub 초단기실황, 서울 실시간 도시데이터, 에어코리아를 실제 호출하고, P2 데이터는 법령 근거가 아닌 `operationalEvidence` 아래에만 반환한다.
- 테스트는 `npm test`로 실행하며 mock 응답을 사용한다. 실제 API smoke 검증은 위 CLI 명령으로 수행한다.

### 2026-05-31 live smoke 결과

키 값을 출력하지 않는 요약 기준으로 다음을 확인했다.

| Source | 결과 | 목적 적합성 |
| --- | --- | --- |
| `KCISA_KOPIS_PERFORMANCE_FACILITY` | `live_verified`, totalCount 2,111 | 공연시설 관할·주소 보강 |
| `KOPIS_PERFORMANCE_CATALOG` | `live_verified`, 2026년 5월 공연 샘플 반환 | 공연 포함 행사 판단 보강 |
| `TOUR_API_EVENT_CATALOG` | `live_verified`, 2026년 5월 축제/행사 totalCount 153 | 실존 축제·행사 샘플과 관할 보강 |
| `NEMC_EMERGENCY_MEDICAL` | `live_verified`, 서울 강남구 응급의료기관 샘플 반환 | 응급의료·이송 후보 보강 |
| `NEMC_AED` | `live_verified`, 코엑스 주변 AED 샘플 반환, totalCount 15,014 | AED 배치·현장 의료 계획 보강 |
| `FOOD_SAFETY_KOREA` | `live_verified`, 회수·판매중지 `I0490` 샘플 반환 | 식음료 행사 위험 보강 |
| `SEOUL_REALTIME_CITY_DATA` | `configured`, live record 1건 | 서울권 인파/혼잡도 운영 판단 |
| `AIRKOREA_AIR_QUALITY` | `configured`, live record 1건 | 야외 대기열·취약자 보호 판단 |
| `KMA_APIHUB_WEATHER` | `configured`, live 초단기실황 record 1건 | 기상 악화에 따른 행사중지/작업중지 판단 |

이 smoke 결과는 `src/ontology/mice/public-api-operational-evidence.json`에 키 없이 오프라인 운영 증거 스냅샷으로 요약 저장했다. 생성 계획서는 이 스냅샷을 법령 근거가 아니라 D-1/D-day 확인 액션, 담당자, 증빙 항목으로 반영한다.

## 공식 확인 근거

- 국가법령정보 공동활용 Open API: `OC` 요청변수가 필수인 API가 있으며, 공동활용 서비스는 법령·행정규칙·자치법규 연계를 제공한다.
  - https://open.law.go.kr/LSO/openApi/guideList.do
  - https://open.law.go.kr/LSO/openApi/guideResult.do
- KOPIS Open API: 인증키 발급 필요, 1인 1개, 출처 표기, 유효기간/미사용 취소 조건 안내.
  - https://kopis.or.kr/por/cs/openapi/openApiInfo.do
  - https://kopis.or.kr/por/cs/openapi/openApiUseSend.do?menuId=MNU_00074
- 문화공공데이터광장 Open API: 활용신청, API 키 발급, 간단 정보 입력 후 자동 승인 안내.
  - https://www.culture.go.kr/data/openapi/openapiInfo.do
- 한국관광공사 TourAPI: 공공데이터포털 회원가입, API 활용신청, 인증키 확인 절차 안내.
  - https://www.2025tourapi.com/sub/sub01.html
- 서울 열린데이터광장: Open API 인증키 발급 필요 안내.
  - https://data.seoul.go.kr/together/guide/useGuide.do
- 기상청 API Hub: 회원가입 후 인증키 발급, 기관회원 공문 조건, API 신청 안내.
  - https://apihub.kma.go.kr/apiInfo.do
  - https://www.weather.go.kr/kma/servlet/NeoboardProcess?bid=press&mode=download&num=1194626
- 재난안전데이터 공유플랫폼: 회원가입 후 데이터와 Open API 이용 가능 안내.
  - https://www.safetydata.go.kr/
- ITS 국가교통정보센터 Open API: 회원가입, 인증키 신청, 관리자 승인 안내.
  - https://www.its.go.kr/file/opendata/openapi_manual.pdf
- 식품안전나라 Open API: 회원에 한해 인증키 신청·발급 안내.
  - https://www.foodsafetykorea.go.kr/indexLoginSSL.do?gubun=m
- E-GEN/국립중앙의료원 Open API: 공공데이터포털 로그인 후 신청 가능 안내.
  - https://www.e-gen.or.kr/nemc/open_api.do?viewPage=application
- 생활안전지도 Open API: 위치기반서비스사업 신고필증 미등록 시 반려 가능 안내.
  - https://safemap.go.kr/opna/data/dataView.do?objtId=119
