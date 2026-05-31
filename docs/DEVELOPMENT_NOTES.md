# Development Notes

## 참고한 기존 작업

- `/Volumes/data/Dev/mice_safety_sources_candidates.md`
- `/Volumes/data/Dev/mice_law_research_with_korean_law_mcp.md`
- `/Volumes/data/Dev/agent-safety-oss/src/ontology/mice/mice-safety-applicability.json`
- `/Volumes/data/Dev/agent-safety-oss/src/tools/query-mice-safety-applicability.ts`

위 파일은 원본을 수정하지 않고 설계 검토와 비교 기준으로 참고했다. 특히 `agent-safety-oss`의 법령·위험·통제·문서·증빙 연결 방식은 이 프로젝트의 참고점 중 하나다.

## 공공 API 운영 증거 반영

2026-05-31 live smoke에서 KCISA KOPIS 공연시설, KOPIS 공연 catalog, TourAPI 축제/행사, NEMC 응급의료기관/AED, 식품안전나라 회수·판매중지, 기상청 API Hub, 서울 실시간 도시데이터, 에어코리아가 키 값 노출 없이 정상 정규화되는 것을 확인했다.

- 오프라인 스냅샷: `src/ontology/mice/public-api-operational-evidence.json`
- 생성 반영: `generate_mice_safety_plan`은 행사 조건별로 KOPIS/TourAPI/NEMC/FoodSafety/KMA/Seoul/AirKorea 증거를 “법령 근거”가 아니라 “운영 증거와 D-day 확인 액션”으로 출력한다.
- 검수 반영: `review_mice_safety_plan`은 대규모·옥외·공연·식음료 조건에서 NEMC/AED, 기상·대기질, KOPIS, 식품안전나라 증거가 빠지면 warning을 낸다.
- 과잉 적용 방지: 비공연 옥외축제에는 KOPIS 공연 catalog를 자동 적용하지 않고, 식음료 조건이 없으면 식품안전나라 확인을 필수로 올리지 않는다.
- 한계: P2 live 데이터는 오래된 snapshot을 안전 판단 근거로 쓰면 안 되며, 실제 행사일에는 live 재조회와 관할기관·베뉴 확인이 필요하다.

## 1.0.3 신뢰도 개선 메모

- source audit은 `public-api-operational-evidence.json`의 live verified snapshot 상태를 읽어 `SOURCE_AUDIT.md`와 `source-audit-report.json`에 같은 상태로 반영한다.
- `validate:scenarios`는 고정 `data/.validation-store` 대신 임시 디렉터리와 export manifest를 사용해 stale file에 속지 않도록 했다.
- `review_mice_safety_plan`은 Markdown 키워드뿐 아니라 `documentBundle` 키와 주요 표 컬럼을 같이 확인해 제출물/RACI/증빙 누락을 더 구조적으로 잡는다.
- 제출·협의 액션은 `submission-action-rules.json`으로 분리했다. 법령·조례 pack 변경 시 생성기 코드를 직접 고치지 않고 조건 규칙을 조정하는 방향이다.
- P2 live 운영 상태와 행사일 snapshot은 `operational-evidence-model.ts`의 공통 status/location/freshness helper를 공유한다.
- `collect_mice_p0_ready_sources`는 `writeSnapshot=true`, `dryRun=false` 조건에서 API 키와 raw response 없이 sanitized snapshot을 로컬에 저장할 수 있다.
- 웹 시뮬레이터는 `/api/simulate` 적용성 체크 외에 `/api/plan-review`로 계획서 생성·검수 요약을 카드형 보고서로 보여준다.
- 온톨로지/manifest 파일의 `version: "1.0.0"` 또는 `version: "0.1.0"`은 npm package release가 아니라 `versionType`으로 표시된 데이터 스키마/내부 pack 버전이다. 제품 릴리스 버전은 `package.json`과 CLI의 `1.0.3`이며, 릴리스 산출물과 `generate-ontology-diff` report/snapshot의 `version`은 `package.json`의 npm version을 사용한다.

## law.go.kr / korean-law-mcp 검증 상태

`LAW_OC` 환경변수로 실제 조회 확인한 항목:

- 중대재해 처벌 등에 관한 법률: 법령ID `013993`, MST `228817`, 제4조, 제9조
- 산업안전보건법: 법령ID `001766`, MST `276853`, 제36조, 제63조
- 산업안전보건기준에 관한 규칙: 제38조, 제42조, 제321조를 MICE 설치·철거 작업자 안전 요약으로 정리
- 재난 및 안전관리 기본법: 법령ID `009640`, MST `268803`, 제66조의11, 제66조의12
- 공연법: 법령ID `001613`, MST `265897`, 제11조, 제11조의2, 제11조의3, 제11조의4, 제11조의5
- 개인정보 보호법: 법령ID `011357`, MST `270351`, 제15조, 제22조, 제25조, 제26조, 제29조, 제30조
- 응급의료에 관한 법률: 법령ID `000218`, MST `279729`, 제47조, 제47조의2, 제50조
- 전기안전관리법: 법령ID `013718`, MST `268805`, 제13조
- 식품위생법: 법령ID `001805`, MST `277149`, 제37조, 제86조
- 다중이용시설 등의 위기상황 매뉴얼 작성방법 및 기준: 행정규칙ID `51881`, 일련번호 `2100000180055`
- 화재의 예방 및 안전관리에 관한 법률: 법령ID `014189`, MST `283705`, 제24조, 제37조
- 소방시설 설치 및 관리에 관한 법률: 법령ID `009503`, MST `236977`, 제12조, 제16조
- 도로법: 법령ID `001821`, MST `276971`, 제61조
- 도로교통법: 법령ID `001638`, MST `281875`, 제6조
- 옥외광고물 등의 관리와 옥외광고산업 진흥에 관한 법률: 법령ID `001020`, MST `273367`, 제3조
- 건축법: 법령ID `001823`, MST `273437`, 제49조
- 승강기 안전관리법: 법령ID `001458`, MST `259475`, 제31조
- 액화석유가스의 안전관리 및 사업법: 법령ID `001849`, MST `276549`, 제44조
- 경비업법: 법령ID `000980`, MST `268091`, 제4조, 제12조, 제13조, 제18조

시행령·시행규칙까지 확인해 오프라인 조문팩에 보강한 항목:

- 공연법 시행령: 법령ID `002357`, MST `284681`, 제9조, 제9조의2, 제9조의3, 제9조의4
- 공연법 시행규칙: 법령ID `006338`, MST `282561`, 제6조의3
- 식품위생법 시행규칙: 법령ID `007634`, MST `282565`, 제2조
- 액화석유가스의 안전관리 및 사업법 시행규칙: 법령ID `007667`, MST `282369`, 제45조, 제47조, 제69조
- 도로법 시행령: 법령ID `003400`, MST `285835`, 제54조
- 도로법 시행규칙: 법령ID `007081`, MST `284537`, 통행금지·차량운행 제한 공고, 도로공사 시행·착수·준공 서식
- 옥외광고물 등의 관리와 옥외광고산업 진흥에 관한 법률 시행령: 법령ID `004242`, MST `282903`, 제5조, 제7조, 제12조, 제14조
- 화재의 예방 및 안전관리에 관한 법률 시행령: 법령ID `014353`, MST `284919`, 제26조
- 소방시설 설치 및 관리에 관한 법률 시행령: 법령ID `009694`, MST `284781`, 제36조
- 응급의료에 관한 법률 시행령: 법령ID `004480`, MST `282889`, 제26조의7
- 응급의료에 관한 법률 시행규칙: 법령ID `007858`, MST `283863`, 제38조, 제38조의2, 제38조의3
- 건축법 시행령: 법령ID `002118`, MST `273503`, 제34조, 제35조, 제36조, 제37조
- 건축법 시행규칙: 법령ID `006191`, MST `283727`, 가설건축물 축조신고, 3층 이상 가설건축물 피난안전 확인, 임시사용승인 서식
- 개인정보 보호법 시행령: 법령ID `011468`, MST `286175`, 제24조, 제25조, 제26조, 제30조, 제31조
- 경비업법 시행령: 법령ID `002146`, MST `280451`, 제10조, 제16조, 제18조, 제30조
- 경비업법 시행규칙: 법령ID `006221`, MST `264977`, 제24조

현재 오프라인 법령팩은 `law-registry.json` 기준 35개 법령/행정규칙, `legal-article-ontology.json` 기준 74개 조문을 포함한다. 공연 재해대처계획의 14일 전 신고, 안전관리비 비율, 안전조직·교육 시간, LPG 별표·검사·보험 기준 참조, 도로점용 신청과 통행제한 공고 서식, 현수막·전기광고물 안전 기준, AED 설치대상·관리책임자·월 1회 점검·사용교육·구급차 관리, 직통계단·피난계단·가설건축물 피난안전 기준, 개인정보 처리방침·위탁·안전성 확보 조치, 경비지도사·경비원 교육·배치신고 기준은 계획서/검수에서 네트워크 없이 참조할 수 있다.

별표·서식은 원문 전체 복제 대신 `legal-annex-ontology.json`에 MICE 실무 체크리스트용 요약팩으로 저장한다.

- 공연법 시행령 별표 1: 안전관리조직 설치기준
- 공연법 시행령 별표 1의2: 안전교육 내용
- 공연법 시행규칙 별지 제13호의3서식: 공연장/공연 재해대처계획 신고·변경신고서
- 식품위생법 시행규칙 별표 1: 식품등의 위생적인 취급 기준
- 액화석유가스법 시행규칙 별표 17: 용기 안전점검기준
- 액화석유가스법 시행규칙 별표 20: LPG 사용시설 시설·기술·검사기준
- 액화석유가스법 시행규칙 별지 제36호서식: 완성/정기검사 신청서
- 액화석유가스법 시행규칙 별지 제37호서식: 완성/정기검사증명서
- 액화석유가스법 시행규칙 별표 15: 가스공급자 안전점검기준
- 액화석유가스법 시행규칙 별표 15의2/15의3: 공사계획 승인·신고 대상
- 액화석유가스법 시행규칙 별표 23: 가스사고배상책임보험·소비자보장책임보험 보험금액
- 도로법 시행령 별표 2: 도로점용허가 기준
- 도로법 시행규칙 별지 제11호/12호/13호서식: 도로공사 시행 허가, 착수 신고, 준공검사 신청
- 도로법 시행규칙 별지 제33호서식: 도로 점용공사 대행 통지
- 도로법 시행규칙 별지 제36호서식: 통행금지·제한, 차량 운행 제한 공고
- 건축법 시행규칙 별지 제8호서식: 가설건축물 축조신고서
- 건축법 시행규칙 별지 제8호의2서식: 3층 이상 가설건축물 피난안전 확인서
- 건축법 시행규칙 별지 제17호서식: 임시사용승인 신청서
- 화재예방법 시행령 별표 4: 소방안전관리자 선임 대상·자격·인원기준
- 화재예방법 시행령 별표 5: 소방안전관리보조자 선임 대상·자격·인원기준
- 소방시설법 시행령 별표 2: 특정소방대상물
- 소방시설법 시행령 별표 4: 특정소방대상물별 소방시설 설치·관리 기준
- 소방시설법 시행령 별표 7: 수용인원 산정 방법
- 소방시설법 시행령 별표 8: 임시소방시설 종류와 설치기준
- 경비업법 시행령 별표 1: 경비업의 경비인력 등 기준
- 경비업법 시행령 별표 3: 경비지도사의 선임·배치기준
- 경비업법 시행규칙 별지 제14호서식: 경비원 명부
- 경비업법 시행규칙 별지 제15호서식: 경비원 배치·배치폐지 신고서
- 응급의료법 시행규칙 별표 2: 구조 및 응급처치 교육의 내용 및 실시방법
- 응급의료법 시행규칙 별표 15: 구급차등의 운용위탁 기준 및 절차
- 응급의료법 시행규칙 별표 16: 구급차등 의료장비·구급의약품·통신장비 기준
- 응급의료법 시행규칙 별표 17: 구급차등 장비 등의 관리기준

`query_mice_legal_annexes`로 별표·서식을 오프라인 조회할 수 있고, `generate_mice_safety_plan`은 적용 법령 아래와 소방·피난/식음료·LPG/도로점용/출입통제·보안검색/응급의료·AED 점검표에 하위 별표·서식 체크포인트를 포함한다. 도로법 시행규칙 서식은 `roadUse` 또는 옥외축제 조건에서, 건축법 시행규칙 서식은 베뉴/임시구조물/설치·철거 조건에서, LPG 검사·보험 서식은 `lpgUse` 조건에서 반영한다. 공연법 별표·서식은 `performance` 조건에서만, 경비업 별표·서식은 `vipSecurity` 또는 `vip_event` 조건에서만 계획서에 반영해 과잉 적용을 줄인다.

## KOSHA/산안기준규칙 통합

MICE 운영에서는 산안법·기준규칙·KOSHA Guide를 관람객/인파 안전의 주 근거로 쓰기보다, 설치·철거·부스시공·전기·고소·중량물·화기 작업의 worker-safety 레이어로 적용한다. 이 구분은 `agent-safety-oss`의 건설현장 worker-safety 관점을 검토하면서 정리한 설계 참고사항이다.

- 요약 Markdown: `data/markdown/worker-safety/`
- 온톨로지: `src/ontology/mice/worker-safety-references.json`
- 연결 의무: `worker_safety_work_plan`
- 연결 위험요인: `worker_fall_height`, `heavy_object_handling`
- 추가 주제: 사전조사/작업계획서, 추락방지, 이동식 사다리, 고소작업대, 비계/작업발판, 전기작업, 화기작업, 중량물, 지게차/하역, 보호구(PPE)

## 지자체 조례 오프라인 팩

`scripts/collect-local-ordinances.mjs`는 `LAW_OC`를 실행 환경에서만 읽고, 결과만 로컬 온톨로지에 저장한다. 수집 뒤에는 `npm run refine:local-ordinances`로 threshold 구조화와 검증상태 세분화를 적용한다.

- 저장 위치: `src/ontology/mice/local-ordinance-pack.json`
- Markdown 요약: `data/markdown/legal/local-ordinance-pack.md`
- 현재 수집량: 지역축제 안전관리 1건, 옥외행사 안전관리 189건, 도로점용·교통소통 333건, 옥외광고물 관리 228건
- 우선 지자체 조문 발췌: 73개 레코드
- 구조화 필드: `appliesWhen`, `crowdThreshold`, `threshold`, `thresholdStructured`, `submissionDeadline`, `requiredPlanItems`, `inspectionRules`, `agencyCoordination`, `insuranceOrLiability`, `relatedDuties`, `relatedHazards`, `verificationChecks`
- `thresholdStructured`는 인원 기준형 조례와 도로점용/옥외광고물 같은 조건 기준형 조례를 분리한다. 중복·절단된 threshold 문자열은 깨끗한 요약 후보로 바꾸되 `verificationStatus: "needs_review"`와 `thresholdStructured.confidence: "needs_review"`로 낮춰 제출 전 원문 재확인을 강제한다.
- 조례 `verificationStatus`는 더 이상 포괄적인 `verified`를 쓰지 않는다. `source_verified`는 공식 자치법규 검색 결과만 확인된 상태, `article_verified`는 조문 발췌 기반 구조화 상태, `needs_review`는 threshold/조문 추출 품질 문제가 남은 상태다.

도로점용·옥외광고물은 전국 검색 결과가 넓어서 `도로점용료/도로점용허가/교통소통`, `옥외광고물 관리와 옥외광고산업 진흥` 중심으로 필터링한다. 등록업체 모집·기금·위원회성 문서는 핵심 안전 코퍼스에서 제외한다.

조례 조회와 계획서 생성은 단순 원본 순서가 아니라 우선순위 점수를 계산한다. 입력 `jurisdiction`과 `venueId`의 소재지 힌트가 기초 지자체에 정확히 맞으면 가장 높은 점수를 주고, 광역 지자체는 다음 후보로 둔다. `outdoorEvent/festival`은 옥외행사·지역축제 안전관리 조례를, `roadUse`는 도로점용·교통소통 조례를, 전시/공연/야외/임시구조물 조건은 현수막·배너·안내물 관련 옥외광고물 조례를 가중한다. 계획서에는 `조례 우선순위`, 점수, 매칭 사유가 함께 들어가며, 본문에서는 `우선 적용 조례 후보`와 `참고 후보`를 분리해 보여준다.

## 계획서 생성/검수

`generate_mice_safety_plan`은 단일 장문의 설명문이 아니라 실무 문서 묶음을 만든다.

계획서 본문 맨 앞에는 “먼저 읽는 요약 보고서”를 고정한다. 이 요약은 조항 나열이 아니라 결론, 실제 핵심 위험, 적용되는 법령·조례·베뉴 규정, 적용되지 않는 법령과 이유, 조건부 확인 항목, 제출·협의 액션, 담당자·기한·증빙, 남은 리스크를 먼저 보여준다.

- 행사 안전관리계획서
- 인파·동선 관리계획
- 도로·교통 실행계획
- 무주최 다중운집 관계기관 공동대응계획
- 베뉴 시설·수용·하역·전기 제약 체크
- 설치·철거 작업자 안전계획서
- 소방·피난 점검표
- 식음료/LPG 점검표
- 개인정보/CCTV 점검표
- 출입통제·보안검색·VIP 동선 계획
- 응급의료·AED·구급 이송 계획
- 스태프 배치표
- 비상연락망
- 일일 안전점검표
- 현장 운영 런시트
- 제출·협의 체크리스트
- 사고보고서 템플릿
- 다국어 방문객 안전 안내문

제출·협의 체크리스트는 지자체, 도로관리청/교통부서/경찰, 옥외광고 담당부서, 건축부서, 베뉴, 소방, 가스공급자/검사기관, 보건/위생, 개인정보 책임자, 경비업체, 의료, 시공/하역/전기 협력사별 제출/확인 문서와 조건, 기한/시점, 근거/메모를 표로 정리한다.

`review_mice_safety_plan`은 생성 문서 또는 외부 Markdown을 받아 법령/조례 누락, 제출기한, 제출·협의 체크리스트, 인원 기준, 관계기관 협의, 피난/소방/AED/의료, AED 관리책임자·점검·교육·구급차 관리, 작업자 안전계획, 현장 운영 런시트, 개인정보 처리방침·위탁·보안조치, 출입통제·경비업, 도로점용/교통통제 실행계획/옥외광고물, 무주최 다중운집 공동 현장지휘/RACI, 베뉴 금지사항, 다국어 방문객 안전 안내, 증빙/기록 보존, 과잉 적용 후보를 검수한다.

검수 결과에는 `documentCoverageMatrix`가 포함된다. 이 매트릭스는 행사 안전관리계획서, 인파·동선 관리계획, 도로·교통 실행계획, 무주최 다중운집 관계기관 공동대응계획, 베뉴 시설 체크, 작업자 안전계획, 소방·피난, 식음료/LPG, 개인정보/CCTV, 출입통제·보안, 응급의료·AED, 스태프 배치표, 비상연락망, 일일점검, 현장 운영 런시트, 제출·협의, 사고보고서, 다국어 방문객 안내를 행사 조건별 `required`, `conditional`, `not_applicable`로 분류하고 `present`, `missing`, `not_applicable` 상태를 함께 반환한다. 전시장/컨벤션, 옥외축제, 공연, 식음료, VIP/보안, 도로점용, 무주최 다중운집, 설치·철거 조건에 따라 필수 문서가 달라진다.

`REQ_BUILDING_EGRESS`는 대규모 인원만으로 적용하지 않고 `venueId`, 전시장/컨벤션, 임시구조물처럼 건축·시설 피난 검토가 실제로 필요한 경우에만 경고한다. 역세권 광장·상권 연결부 같은 무주최 야외 다중운집은 공동 현장지휘와 대피·분산 동선 중심으로 검수하며, 직통계단/피난계단 경고는 과잉 적용으로 본다.

검수 결과는 다음을 포함한다.

- `verdict`: `usable`, `usable_with_review`, `needs_revision`
- `score`/`grade`: error와 warning 가중치 기반 점수
- `documentCoverageMatrix`: 문서별 필요도와 포함 상태
- `requirementId`: 누락 또는 과잉 적용된 요구사항 ID
- `evidence`: 계획서 내 관련 라인 위치와 짧은 발췌

도로점용 또는 옥외행사 조건에서는 `road_traffic_control_plan`이 required/conditional 커버리지로 평가된다. 검수는 `도로·교통 실행계획`, `교통통제 도면`, `비상차량 접근로`, `셔틀·택시·버스 승하차`, `옥외광고물·안내표지`, `원상복구`가 빠졌는지 확인하고, 도로점용이 없는 실내행사에는 도로법·도로교통법을 과잉 필수로 잡지 않는다.

`unhostedCrowd: true` 조건에서는 `unhosted_crowd_response_plan`이 required 커버리지로 평가된다. 검수는 `주최자 없음`, `공동 현장지휘`, `관계기관 합동상황반`, `지자체 재난안전상황실`, `경찰 현장지휘`, `소방 현장지휘`, `시설관리자`, `교통 운영기관`, `관찰/주의/경계/심각`, `해산·분산`, `방송/전광판/SNS/문자`가 빠졌는지 확인한다.

공연 조건에서는 `performanceStagePlan`을 별도 문서로 생성한다. 공연 재해대처계획, 안전관리조직, 안전교육, 피난안내문, 무대·트러스 구조검토, 리깅 승인, 방염확인서, 스탠딩 펜스, 무대 전면 압박, 공연중지 기준, 아티스트/무대감독 중지 신호, 전원 차단, 관객 현 위치 대기·분산 문구를 실행 상태표로 묶는다. 검수는 `REQ_PERFORMANCE_STAGE_EXECUTION`, `REQ_PERFORMANCE_STOP_RESUME`로 공연·무대 실행계획과 중지·재개 증빙 기준이 빠졌는지 확인한다.

식음료/LPG 조건에서는 `foodLpgChecklist`를 단순 항목 나열이 아니라 현장 실행 상태표로 생성한다. D-1 영업신고·LPG 검사증명·보험·가스용기 반입대장 확인, 개장 T-120 냉장·보온·보존식 라벨·누설점검, 운영 중 60분/30분 간격 온도기록·밸브·환기·화기 이격거리·소화기 확인, 부적합 시 판매중지·화기 사용 즉시 중지·밸브 차단·보건소/119/가스공급자 연락, 종료 후 용기 반출·조치 전후 사진 정리를 표로 만든다. 검수는 `REQ_FOOD_FIELD_EXECUTION`, `REQ_LPG_FIELD_EXECUTION`, `REQ_FOOD_LPG_EVIDENCE`로 현장 실행 상태표, 보존식, 냉장·보온 온도기록, 가스용기 반입대장, 누설점검, 밸브 차단, 환기, 화기 사용 즉시 중지, 조치 전후 사진이 빠졌는지 확인한다.

`export_mice_safety_plan_bundle`은 같은 생성 결과를 로컬 파일 묶음으로 저장한다.

- `00-full-safety-plan.md`
- 개별 계획서/체크리스트 Markdown 18종
- 베뉴 시설, 도로·교통 실행계획, 무주최 다중운집 대응계획, 공연·무대 실행계획, 소방·피난, 식음료/LPG, 식음료/LPG 실행 상태표, 개인정보/CCTV, 출입통제·보안, 응급의료·AED, 일일점검, 현장 운영 런시트, 제출·협의, 다국어 방문객 안전 안내 CSV
- `16-operations-runsheet.md`, `operations-runsheet.csv`
- `17-review-summary.md`, `review-coverage-matrix.csv`, `review-findings.csv`
- `18-submission-raci-calendar.md`, `submission-raci-calendar.csv`
- `19-road-traffic-control-plan.md`, `road-traffic-control-plan.csv`
- `20-unhosted-crowd-response-plan.md`, `unhosted-crowd-response-plan.csv`
- `21-performance-stage-execution-plan.md`, `performance-stage-execution.csv`
- `food-lpg-execution.csv`
- `submission-packages/`: 지자체, 베뉴, 소방·경찰·의료, 협력사 작업자 안전, 조건부 개인정보·보안 패키지
- `safety-plan.docx`
- `safety-checklists.xlsx`
- `manifest.json`

도로·교통 실행계획은 `generate_mice_safety_plan`의 `documentBundle.roadTrafficControlPlan`에 포함된다. `roadUse` 또는 옥외행사 조건에서는 허가·협의, 교통통제 도면, 보행자/차량 우회동선, 비상차량 접근로, 하역/반입동선, 셔틀·택시·버스 승하차, 옥외광고물·안내표지, 원상복구, 필수 증빙을 별도 문서로 만든다. 도로점용이 없는 실내행사에서는 외부 동선·교통 영향 확인 메모만 남겨 과잉 적용을 피한다. export 시 `19-road-traffic-control-plan.md`, `road-traffic-control-plan.csv`, `safety-checklists.xlsx`의 `Road Traffic` sheet와 지자체/베뉴/소방·경찰·의료 제출 패키지에 같이 저장된다.

무주최 다중운집 관계기관 공동대응계획은 `generate_mice_safety_plan`의 `documentBundle.unhostedCrowdResponsePlan`에 포함된다. `unhostedCrowd: true` 조건에서는 주최자 없음, 책임 공백, 지자체·경찰·소방·시설관리자·교통 운영기관 공동 현장지휘/RACI, 관리주체 권한 경계, 관찰/주의/경계/심각 단계, 해산·분산 안내, 상황전파 채널, 현장 증빙·사후 기록을 별도 문서로 만든다. export 시 `20-unhosted-crowd-response-plan.md`, `unhosted-crowd-response-plan.csv`, `safety-checklists.xlsx`의 `Unhosted Crowd` sheet와 지자체/베뉴/소방·경찰·의료 제출 패키지에 같이 저장된다.

현장 운영 런시트는 `generate_mice_safety_plan`의 `documentBundle.operationsRunsheet`에 포함된다. 행사 전일, 개장 전 T-180/T-150/T-120/T-90/T-75/T-60/T-45/T-15, 운영 중 30분 간격, 피크 T-30~T+30, 폐장 T-30, 폐장 후, 철거 전/중, D+1 종료 정리 단계별로 구역/대상, 확인/조치, 담당, 증빙, escalation을 표로 만든다. 식음료/LPG, 도로점용, 공연·무대, 베뉴, VIP/보안, 개인정보, 설치·철거 조건에 따라 조건부 행이 추가된다. 공연 조건에서는 D-7 재해대처계획·안전교육·무대 구조검토, D-1 리깅·방염·피난안내 리허설, T-180 무대 구조·상부장치, T-60 객석·스탠딩, T-15 공연중지 기준·무대감독 중지 신호, 공연 중 15분 간격 무대 전면 압박·구조물·전기 이상 보고 행이 추가된다. 식음료/LPG 조건에서는 D-1 증빙 확인, T-120 반입·보존식·누설점검, 운영 중 60분 온도기록/30분 가스 순찰, 폐장 후 용기 반출·기록 보관 행이 추가된다. 도로점용 조건에서는 통제구간·승하차장·주차장 사전 확인, 30분 간격 도로·교통통제 구역 순찰, 폐장 후 원상복구 확인 행이 추가된다. 무주최 조건에서는 합동상황반 사전 확인, 15분 간격 관찰/주의/경계/심각 단계 보고, 해산·분산 안내·통제선 해제 행이 추가된다. export 시 `16-operations-runsheet.md`, `operations-runsheet.csv`, `performance-stage-execution.csv`, `food-lpg-execution.csv`, `safety-checklists.xlsx`의 `Operations Runsheet`/`Stage Exec`/`Food LPG Exec` sheet, `manifest.operationsRunsheetCount`에 같이 저장된다.

다국어 방문객 안전 안내는 `generate_mice_safety_plan`의 `documentBundle.visitorSafetyNotices`에 포함되고, export 시 `15-visitor-safety-notices.md`, `visitor-safety-notices.csv`, `safety-checklists.xlsx`의 `Visitor Notices` sheet에 같이 저장된다. 기본 시나리오는 대피개시, 행사 일시중지, 행사 중단, 현 위치 대기, 운영 재개이며, 한국어/영어/일본어/중국어 문구와 현장 체크포인트를 함께 담는다. export는 같은 입력과 생성 계획서로 `review_mice_safety_plan`도 자동 실행해 검수 요약, 문서 커버리지 매트릭스, finding 목록을 Markdown/CSV/xlsx sheet로 함께 저장한다.

제출 일정·RACI·증빙 매트릭스는 `submissionChecklist` 표를 파싱해 실행 관리용으로 정규화한다. 각 행은 제출/확인처, 문서/서식, 연결 제출 패키지, 권장기한, 행사일 기준 권장일자, 최종 체크포인트, Responsible/Accountable/Consulted/Informed, 필수 증빙, 상태를 가진다. 행사일이 `YYYY-MM-DD`로 입력되면 T-21, T-14, T-7, T-1, D+1 같은 권장기한을 실제 날짜로도 계산한다. 입력 필드는 `date`와 `eventDate`를 모두 지원하며 `date`가 우선한다. 이 매트릭스는 `safety-checklists.xlsx`의 `Submission RACI` sheet와 `manifest.submissionSchedule`에도 포함된다.

`submission-packages/`는 전체 계획서를 수신처별로 다시 조합한다. 기본 패키지는 `01-local-government-package.md`, `02-venue-package.md`, `03-fire-police-medical-package.md`이고, 설치·철거 조건이 있으면 `04-worker-contractor-package.md`, 개인정보/VIP/컨벤션 조건이 있으면 `05-privacy-security-package.md`가 추가된다. 각 패키지는 자체 검수 요약, 포함 문서 목록, 문서 커버리지, 제출 전 확인사항을 앞에 두고 뒤에 필요한 문서 본문을 붙인다.

각 제출 패키지는 `sharingScope`, `redactionLevel`, `redactionNotes`를 가진다. 지자체·소방·경찰·의료·베뉴·협력사 패키지는 외부 공유용으로 개인정보/CCTV/등록 세부, VIP·보안검색·경비업 세부, 협력사에 불필요한 관계기관 직접 연락망을 `[공유범위 제한]` 문구로 치환한다. `privacy_security` 패키지는 `restricted_internal`로 두어 개인정보보호책임자/보안책임자 검토용 상세 내용을 유지한다. 각 패키지 앞부분에는 해당 패키지에 연결된 제출 일정·RACI 요약을 넣어 수신처별 실행 항목을 바로 확인할 수 있게 했다.

docx는 `docx`로 생성하고, xlsx는 `src/lib/simple-xlsx.ts`의 내장 OOXML writer로 생성한다. 취약점 fix가 없는 `xlsx` 패키지와 전이 audit 이슈가 있던 `exceljs`는 쓰지 않는다.

## 베뉴 정보 구조화

`venue-safety-rules.json`에는 지역별 대형 MICE 전시장 19개를 포함한다. `query_mice_venue_safety_rules`는 원본 수칙과 함께 공통 시설 스키마를 계산해 반환한다.

- 지역/도시, 공간/홀, 면적·수용·부스 정보
- 바닥하중, 천장고/제한높이
- 화물출입구, 로딩덕/반입·반출
- 전기·유틸리티
- 소방통로, 비상구, 피난동선
- 금지/제한물품
- 부스, 리깅/현수막, 식음료/LPG 규칙
- 제출 안전문서, 출처, 로컬 Markdown 경로

원본 PDF/HWP가 있는 자료는 `data/raw/`에 보관하고, `data/markdown/venue-manuals/`에 Markdown 변환본 또는 직접 시각 판독 요약본을 둔다. 이 둘은 내부 검증 코퍼스이며 npm package에는 포함하지 않는다. HICO 이미지 PDF는 직접 판독 기반 Markdown으로 구조화했다.

`npm run build:venue-index`는 베뉴 Markdown에서 시설·안전 관련 라인을 추출해 `src/ontology/mice/venue-facility-index.json`에 고정한다.
`npm run build:public-venue-summaries`는 공개 배포용 `data/public/venue-safety-summaries.json`과 `data/markdown/public/venue-safety-summaries.md`를 생성한다. 이 파일은 원문성 extract가 아니라 구조화된 요약·체크포인트와 출처 링크만 담는다.

- 현재 인덱스: 19개 베뉴, 5,875개 sourceSpan
- 추출 필드: 수용/면적, 천장고, 바닥하중, 화물출입구, 로딩덕/하역, 전기, 소방통로, 피난동선, 금지물품, 부스, 리깅/현수막, 식음료/LPG, 안전문서
- 각 항목은 `sourceRef`, `localMarkdownPath`, `line`, `confidence`를 포함한다.

`npm run validate:venue-corpus`는 베뉴 원본/Markdown/source registry/venue rules/facility index를 상호 대조한다. 검증 항목은 manifest 필수 필드, PDF/HWP 헤더, Markdown 추출 길이, 변환 실패 marker, 안전 키워드 신호, source registry 경로 일치, venue `sourceRefs` 존재 여부, facility category coverage, 지정등록업체 모집·선발 공고성 문서의 core corpus 혼입 여부다. 결과는 `data/venue-corpus-audit-report.json`과 `docs/VENUE_CORPUS_AUDIT.md`에 저장된다. 현재 상태는 error 0건/warning 0건이다. 일부 지역 베뉴의 전기·소방·피난·부스·안전문서 항목은 `needs_source_review` 수칙으로 보강해 계획서에 담당자 확인사항으로 노출하며, 확정 수치처럼 사용하지 않는다.
`npm run audit:package-safety`는 `npm pack --dry-run --json` 결과를 검사해 raw PDF/HWP, full extracted venue Markdown, `.env`, cookie, `node_modules`, validation store가 tarball에 섞이면 실패한다.

`generate_mice_safety_plan`은 `venueId`가 들어오면 `venue-facility-index.json`의 sourceSpan을 읽어 베뉴 시설·수용·하역·전기 제약 체크 문서를 추가 생성한다. 이 문서는 면적/부스/수용 관련 추정치, 바닥하중, 층고·리깅, 화물 반입·하역, 전기·유틸리티, 소방·피난, 제한물품, 제출서류와 근거 위치를 함께 보여준다. 추정 수용인원과 밀도는 원문 수치를 보조 계산한 값이므로 제출 전 베뉴 도면과 담당자 확인이 필요하다.

## 현장 운영 루프

현장 운영 PoC는 로컬 저장소 기반 도구로 구현했다. 기본 저장 위치는 `~/.korea-mice-safety-agent/operations.json`이며, `MICE_LOCAL_DIR`로 바꿀 수 있다.

- `register_mice_safety_issue`: 이슈 등록
- `record_mice_evidence`: 사진/영상/문서/메모 증빙 연결
- `record_mice_command_decision`: 대피개시, 현 위치 대기, 행사 일시중지, 행사 중단, 재개승인, 상황해제 지휘 판단 기록
- `resolve_mice_command_decision`: active 지휘 판단을 재개승인 또는 상황해제로 닫고 released 상태와 해제 판단을 감사 로그로 기록
- `assign_mice_staff_action`: 담당자 조치 배정
- `complete_mice_action`: 조치 완료 및 이슈 상태 전환
- `generate_mice_incident_report`: 이슈·조치·증빙 Markdown 보고서 생성
- `generate_mice_situation_brief`: 관계기관 공유용 1페이지 상황보고서 생성
- `initialize_mice_runsheet_execution`: 계획서의 현장 운영 런시트를 로컬 실행 상태표로 초기화
- `update_mice_runsheet_execution`: 런시트 항목을 `open`, `done`, `blocked`, `escalated`로 갱신하고 필요 시 이슈·조치를 생성
- `query_mice_runsheet_execution`: 행사명, 상태, 연결 이슈 기준으로 런시트 실행표 조회
- `query_mice_operations_dashboard`: 미해결 이슈를 SLA 초과/임박/정상과 담당팀별로 집계
- `export_mice_operations_dashboard`: 운영본부 대시보드를 xlsx 상황판과 manifest로 저장
- `query_mice_communication_templates`: 지휘 판단별 방송·무전·문자·관계기관 공유 문구 조회

`src/ontology/mice/incident-taxonomy.json`은 현장 이슈 유형별 권장 담당팀, 기본 우선순위, 심각도별 초동 SLA, escalation path, 초동 playbook을 오프라인으로 보관한다. 이슈 등록 시 taxonomy가 자동 적용되어 `recommendedTeam`, `dispatchPriority`, `responseSlaMinutes`, `firstResponseDueAt`, `escalationPath`, `playbookSteps`가 저장된다. 조치 배정에서 팀/우선순위/기한을 생략하면 저장된 권장팀과 SLA 기한을 기본값으로 사용한다.

`record_mice_command_decision`은 이슈/조치와 별도로 운영본부의 지휘 판단을 감사 로그로 남긴다. `decisionType`은 `monitor_only`, `evacuation_start`, `shelter_in_place`, `event_pause`, `event_stop`, `event_resume`, `all_clear`를 지원하고, 판단권자, 발효시각, 통보대상, 재개조건을 함께 저장한다.

지휘 판단에는 `active`, `released`, `superseded`, `informational` 상태가 붙는다. `evacuation_start`, `shelter_in_place`, `event_pause`, `event_stop`은 active 판단으로 기록되고, 같은 행사/구역에 새 active 판단을 내리면 기존 active 판단은 `superseded`가 된다. `resolve_mice_command_decision` 또는 `event_resume`/`all_clear` 판단은 active 판단을 `released`로 닫고, 충족된 재개조건과 해제 판단 ID를 남긴다.

`query_mice_operations_dashboard`는 로컬 저장소만 읽어 미해결 이슈를 `overdue`, `due_soon`, `normal`, `no_sla`, `resolved`로 분류하고 담당팀별 미해결 건수, 활성 지휘 판단, 지휘 판단 상태 요약, lifecycle, 시간순 타임라인을 보여준다. 현장 운영본부에서 “지금 먼저 처리해야 할 이슈”와 “현재 행사 운영 상태”를 보는 최소 관제 화면의 데이터 API 역할을 한다.

현장 운영 런시트는 생성 계획서에서 끝나지 않고 `initialize_mice_runsheet_execution`으로 로컬 실행 상태표에 적재할 수 있다. 각 항목은 행사명, 단계, 기준시점, 권장일자, 구역/대상, 확인/조치, 담당, 증빙, escalation, 상태, 연결 이슈/조치 ID를 가진다. `update_mice_runsheet_execution`에서 `blocked` 또는 `escalated` 항목에 `createIssue`와 `createAction`을 켜면 해당 항목의 문맥을 이용해 이슈 유형을 추론하고, incident taxonomy의 권장팀/SLA/playbook을 붙인 이슈와 담당자 조치를 함께 만든다. 공연 리깅·구조검토·무대감독·공연중지 항목은 `stage_rigging_structure`/공연·무대 안전팀으로, 식음료 온도기록·보존식 항목은 `food_safety`/식음료 안전팀으로, LPG 반입대장·누설점검·밸브·환기·화기 항목은 `gas_lpg`/가스·소방팀으로 자동 라우팅된다.

`export_mice_operations_dashboard`는 같은 대시보드 계산 결과를 `operations-dashboard.xlsx`로 저장한다. Sheet는 `Summary`, `Issues`, `Open Actions`, `Command Decisions`, `Runsheet Execution`, `Timeline`으로 구성하며, `Summary`에는 런시트 상태 요약을 포함한다. `Command Decisions`에는 status, releasedAt, releasedBy, supersededAt, supersededBy, conditionsMet을 포함하고 `Timeline`에는 이슈 감지, 조치 배정/완료, 증빙, 지휘 판단, 런시트 상태 변경을 시간순으로 묶어 운영본부 공유용 상황판과 사후 감사 기록으로 쓸 수 있다.

`generate_mice_incident_report`는 같은 timeline을 `시간순 타임라인` 섹션으로 출력해 사고 복기와 관계기관 보고 초안에서 사건 흐름을 바로 확인할 수 있게 한다.

`generate_mice_situation_brief`는 상세 보고서와 별도로 소방·경찰·지자체·베뉴에 바로 공유할 1페이지 Markdown을 만든다. 포함 항목은 현재상황, 주 이슈, 인명·위험·통제, 주요 조치, 관계기관 요청, 최근 타임라인, 다음 업데이트 기준이다. 요청사항은 이슈 유형과 관련 위험요인을 보고 소방, 경찰/교통, 의료/119, 보건/위생, 베뉴/시공사 지원 항목을 기본 추론하며, 사용자가 `requestedSupport`로 명시할 수 있다. 행사명만 넣은 조회에서는 최신 주 이슈를 `reportScopeIssueId`로 잡고 조치, 증빙, 지휘 판단, 타임라인을 해당 이슈 중심으로 좁혀 반복 검증이나 장기 운영 저장소의 과거 유사 이슈가 보고서에 섞이지 않게 한다.

`src/ontology/mice/communication-templates.json`은 `evacuation_start`, `event_pause`, `event_stop`, `shelter_in_place`, `event_resume`, `all_clear` 등 지휘 판단별 안내방송, 스태프 무전, 관계기관 공유 문구를 오프라인 템플릿으로 보관한다. `query_mice_communication_templates`는 행사명, 구역, 사유, 대피동선, 재개조건, 연락처를 placeholder에 채워 즉시 쓸 수 있는 한국어 문구와 체크포인트를 반환한다.

`generate_mice_visitor_notice`는 같은 템플릿 중 방문객 대상 현장방송 문구만 사용해 한국어, 영어, 일본어, 중국어 안전 안내를 생성한다. 현재 범위는 대피개시, 행사 일시중지, 행사 중단, 현 위치 대기, 재개승인이다. 스태프 무전과 관계기관 보고는 현장 책임·법적 표현이 섞이므로 다국어 방문객 안내 범위에서 제외한다. `B게이트`, `대기열 병목`, `지정 대피동선` 같은 빈번한 placeholder는 오프라인 사전으로 자동 현지화하고, 현장 고유 명칭은 `localizedPlaceholders`로 언어별 덮어쓰기가 가능하다.

기본 구역명이 명시되지 않은 계획서는 `해당`을 `the affected`/`該当`/`相关`으로 낮춰 번역한 뒤 템플릿의 `area`/`エリア`/`区域` 접미어와 결합한다. `validate:scenarios`의 `visitor_notice_generic_zone_quality`는 `area area`, `エリアエリア`, `区域区域` 같은 중복 표현과 `REQ_VISITOR_NOTICE_QUALITY` 검수 finding이 재발하면 실패한다.

## 출처/라이선스 감사

`npm run audit:sources`는 `source-registry.json`을 기준으로 [SOURCE_AUDIT.md](SOURCE_AUDIT.md)와 `data/source-audit-report.json`을 생성한다.

- 상태값: `reusable`, `summary_only`, `link_only`, `needs_license_review`, `no_redistribution`
- KOSHA Guide, 베뉴 PDF/HWP, 공공누리 제4유형, 법령/조례 원문 계열을 분리한다.
- 원문 재배포 제한 자료는 계획서 생성에 요약·체크포인트·링크 방식으로만 사용한다.

## 온톨로지 변경 추적

`npm run snapshot:ontology`은 현재 법령/조례/베뉴/작업자 안전 pack의 fingerprint baseline을 `data/snapshots/ontology-baseline.json`에 저장한다.

`npm run diff:ontology`은 현재 pack을 baseline과 비교해 [ONTOLOGY_DIFF.md](ONTOLOGY_DIFF.md)와 `data/ontology-diff-report.json`을 생성한다.

비교 대상:

- `law-registry.json`
- `legal-article-ontology.json`
- `legal-annex-ontology.json`
- `local-ordinance-pack.json`
- `worker-safety-references.json`
- `venue-safety-rules.json`
- `venue-facility-index.json`
- `incident-taxonomy.json`
- `communication-templates.json`

리포트에는 collection별 added/removed/changed 개수를 저장한다. `LAW_OC` 값은 baseline이나 diff에 저장하지 않는다.

## 다음 단계

1. 베뉴 PDF 원문을 직접 복제하지 않고 체크포인트/링크/버전 메타데이터만 유지한다.
2. docx/xlsx 템플릿 스타일을 실무 제출 양식에 맞춘다.
3. 지휘 판단 템플릿에 영문/다국어 방문객 안내 버전을 추가한다.
4. 베뉴별 제출서류명과 지자체 제출서류명을 더 세분화해 제출 체크리스트의 실제 양식명/마감일 정확도를 높인다.
5. 상황보고서와 통신 템플릿에 영문/다국어 방문객 안내 버전을 추가한다.
