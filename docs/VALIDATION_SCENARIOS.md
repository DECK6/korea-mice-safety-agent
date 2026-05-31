# Validation Scenarios

`korea-mice-safety-agent`가 쓸만한지 판단하는 기준은 특정 전시장 샘플 하나가 아니라, MICE 전시장 행사와 옥외축제, 공연, 식음료 행사, VIP/보안 행사, 무주최 다중운집을 넣었을 때 법령·문서의무·위험요인·베뉴 체크포인트가 빠짐없이 나오는지다.

## Acceptance Criteria

- 전시회/박람회: 부스·임시전기·피난통로·개인정보·인파·베뉴 규정, 베뉴 시설·수용·하역·전기 제약이 함께 나온다.
- 옥외축제: 재난안전법, 지자체 옥외행사 조례, 도로점용, 교통통제, 옥외광고물, 기상, 인파, 푸드부스/LPG가 함께 나온다.
- 무주최 다중운집: 주최자 없음, 책임 공백, 지자체·경찰·소방·시설관리자·교통 운영기관 공동 현장지휘/RACI, 관찰/주의/경계/심각 단계, 해산·분산 안내가 함께 나온다.
- 공연/콘서트: 공연법 재해대처계획, 안전관리조직·교육, 피난안내, 스탠딩 인파, 무대/트러스, 리깅 승인, 방염확인, 공연중지 기준, 응급대응이 함께 나온다.
- 컨벤션/VIP: 개인정보, CCTV, 출입통제, 경비업, 경비지도사/경비원 명부/배치신고, 위기상황 매뉴얼, 승강기/동선 혼잡이 함께 나온다.
- 응급의료/AED: AED 설치대상, 관리책임자, 월 1회 점검, 사용교육, 구급차 장비·소독·통신·운행기록 기준이 함께 나온다.
- 식음료 행사: 식품위생법, 식중독 보고, LPG/화기, 임시전기, 베뉴 작업안전 수칙, 보존식, 냉장·보온 온도기록, 가스용기 반입대장, 누설점검, 부적합 조치 기준이 함께 나온다.
- 설치·철거 작업: 산안기준규칙, KOSHA Guide 기반 worker-safety reference, 작업자 안전계획서, 추락·중량물 위험이 함께 나온다.
- 핵심 법령과 핵심 조문은 오프라인 온톨로지에 저장되어야 하며, `needsReview`로 남은 항목은 사용자가 알 수 있어야 한다.
- 법령·조례 pack은 `plan_submission`, `permit_check`, `inspection`, `staff_deployment`, `training`, `evacuation`, `fire_prevention`, `crowd_control`, `medical_response`, `worker_safety`, `privacy_notice`, `incident_report`, `recordkeeping` 의무 유형을 포함해야 한다.
- hazard → control → duty → law/source 관계는 자동 검증되어야 하며, 조례 레코드는 `lawOrOrdinanceName`, `sourceId`, `threshold`, `thresholdStructured`, `verificationChecks`, `sourceConfidence`를 포함해야 한다.
- 조례 `verificationStatus`는 포괄적 `verified`가 아니라 `source_verified`, `article_verified`, `needs_review` 등으로 세분화되어야 한다. 중복·절단된 threshold 문자열은 자동 검증에서 실패하거나 `needs_review`로 강등되어야 한다.
- 공연법 시행령/시행규칙, 식품위생법 시행규칙, LPG 시행규칙, 도로법 시행령/시행규칙, 옥외광고물법 시행령, 화재예방법 시행령, 소방시설법 시행령, 응급의료법 시행령/시행규칙, 건축법 시행령/시행규칙, 개인정보보호법 시행령, 경비업법 시행령/시행규칙의 핵심 조문 또는 서식 근거는 네트워크 없이 조회되어야 한다.
- 공연 안전조직/교육, 공연 재해대처계획 신고서식, 식품위생 취급기준, LPG 용기·사용시설·검사신청·검사증명·공급자 안전점검·공사계획·보험, 도로점용허가 기준, 도로공사 시행/착수/준공/통행제한 공고 서식, 가설건축물 축조신고·피난안전 확인·임시사용승인, 소방안전관리자/보조자, 특정소방대상물, 소방시설, 수용인원 산정, 임시소방시설, 응급처치 교육, 구급차 위탁·장비·관리기준, 경비지도사 선임·배치, 경비원 명부/배치신고 별표·서식은 `query_mice_legal_annexes`로 네트워크 없이 조회되어야 한다.
- 지역 조례는 `local-ordinance-pack.json`에서 네트워크 없이 조회되어야 하며, 광역/기초 지자체 후보가 함께 나오고 베뉴/관할/행사조건 기반 우선순위 점수와 사유가 표시되어야 한다.
- 계획서 생성은 맨 앞에 사람이 먼저 읽는 요약 보고서를 두고, 법령, 조례 우선순위, 우선 적용/참고 조례 후보, 문서의무, 위험요인, 베뉴 시설 제약, 베뉴/작업자 안전 섹션을 포함해야 한다.
- 맨 앞 요약 보고서는 결론, 핵심 위험, 적용 근거, 비적용 근거와 이유, 조건부 확인, 제출·협의 액션, 담당자·기한·증빙, 남은 리스크를 포함해야 한다.
- 계획서 생성은 행사 안전관리계획서, 인파·동선 관리계획, 도로·교통 실행계획, 무주최 다중운집 관계기관 공동대응계획, 베뉴 시설·수용·하역·전기 제약 체크, 작업자 안전계획서, 공연·무대 실행계획, 소방·피난 점검표, 식음료/LPG 점검표와 현장 실행 상태표, 개인정보/CCTV 점검표, 출입통제·보안검색·VIP 동선 계획, 응급의료·AED·구급 이송 계획, 스태프 배치표, 비상연락망, 일일점검표, 현장 운영 런시트, 제출·협의 체크리스트, 사고보고서 템플릿을 문서 묶음으로 포함해야 한다.
- 계획서 export는 전체 계획서, 개별 Markdown 문서, CSV 체크리스트, docx, xlsx, manifest를 로컬 디렉터리에 저장해야 한다.
- 계획서 검수는 법령/조례/베뉴/작업자 안전 누락과 과잉 적용 후보를 반환해야 하며, 검증용 옥외축제 샘플은 `needs_revision`이 아니어야 한다.
- 계획서 검수는 점수, 등급, 요구사항 ID, 원문 내 근거 위치를 함께 반환해야 한다.
- 베뉴 문서는 원본 PDF/HWP와 Markdown 변환본을 로컬에 보관하고, 지정등록업체 모집/등록 공고는 핵심 코퍼스에서 제외한다.
- 베뉴 조회는 각 베뉴에 대해 공통 시설 스키마, 로컬 Markdown 경로, 추출 line/confidence가 포함된 sourceSpans를 반환해야 한다.
- 베뉴 시설 계획서는 수용/면적, 바닥하중, 층고, 하역, 전기, 소방·피난, 제한물품, 근거 위치를 포함하고 sourceSpan 기반 추정치와 수동 확인 필요성을 표시해야 한다.
- 현장 운영 루프는 이슈 등록, 증빙 기록, 조치 배정, 조치 완료, 보고서 생성까지 네트워크 없이 로컬 저장소에서 동작해야 한다.
- 현장 운영 루프는 이슈 유형별 권장팀, 초동 SLA, escalation, playbook을 자동 부여하고 조치 배정 기본값으로 사용해야 하며, 대피개시/행사중지/재개승인 같은 지휘 판단을 기록하고, active 지휘 판단을 재개승인/상황해제로 released 처리하고, 방송·무전·문자 템플릿을 조회하고, 운영본부 대시보드에서 SLA 상태와 활성/해제 지휘 판단 이력 및 시간순 타임라인으로 조회·xlsx export되어야 한다. 또한 관계기관 공유용 1페이지 상황보고서가 생성되어야 한다.
- 옥외행사는 `festival`뿐 아니라 입력 별칭 `outdoor_event`와 플래그 `outdoorEvent`로도 조회 가능해야 한다.
- 과잉 적용 방지:
  - 공연 없는 옥외축제에는 `performance_act`와 공연 재해대처계획이 나오지 않아야 한다.
  - 도로점용 없는 실내행사에는 `road_act`, `road_traffic_act`, 도로점용/옥외광고물 의무가 나오지 않아야 한다.
  - 식음료 없는 행사에는 `food_sanitation_act`, `lp_gas_safety_act`, 식음료/LPG 의무가 나오지 않아야 한다.
  - 설치·철거 조건이 없으면 `worker_safety_work_plan`이 필수로 나오지 않아야 한다.

## Automated Check

```bash
npm run build
npm run validate:scenarios
npm run diff:ontology
```

Fixture:

- [mice-event-scenarios.json](../data/scenarios/mice-event-scenarios.json)

이 검증은 다음 시나리오를 통과해야 한다.

- `indoor_exhibition_osco_6000`
- `outdoor_festival_road_food_5000`
- `performance_concert_stage_12000`
- `conference_vip_privacy_800`
- `food_expo_ceco_lpg`
- `rainy_night_outdoor_concert_food`
- `urban_parade_road_occupancy`
- `unhosted_crowd_station_area`

추가 자동 검증:

- `query_mice_local_ordinances`로 `경기도 고양시`의 옥외행사/도로점용/옥외광고물 조례 후보가 조회되고, 첫 후보가 `경기도 고양시` 또는 `경기도`의 양수 우선순위 점수를 가진다.
- `query_mice_legal_articles`로 공연법 시행령, 공연법 시행규칙, 식품위생법 시행규칙, LPG 시행규칙, 도로법 시행령, 옥외광고물법 시행령, 화재예방법 시행령, 소방시설법 시행령, 응급의료법 시행령/시행규칙, 건축법 시행령, 개인정보보호법/시행령, 경비업법/시행령/시행규칙 조문팩이 조회된다.
- `query_mice_legal_annexes`로 공연법 시행령/시행규칙, 식품위생법 시행규칙, LPG 시행규칙, 도로법 시행령/시행규칙, 건축법 시행규칙, 화재예방법 시행령, 소방시설법 시행령, 응급의료법 시행규칙, 경비업법 시행령/시행규칙 별표·서식 요약팩이 조회된다.
- `validate:venue-corpus`가 베뉴 원본 PDF/HWP, Markdown 변환본, source registry, venue rules, facility index를 대조해 error 0건으로 통과하고, 최소 15개 원본 문서, 19개 베뉴, 5,000개 이상 facility sourceSpan을 확인한다. 지정등록업체 모집·선발 공고성 문서가 core corpus에 섞이면 실패해야 한다.
- `validate:scenarios`의 `ontology_maturity` 검사는 필수 법령 의무 유형, 행사 유형, feature rule, 조례 공통 필드, hazard/control/law/source linkage, duty basis, risk-area coverage를 검증한다.
- `generate_mice_safety_plan`으로 옥외축제 계획서 초안이 생성되고 `지자체 조례`, `설치·철거 작업자 안전`, `산업안전보건기준`, 도로공사/통행제한 서식, 가설건축물 피난안전 서식, LPG 검사증명 서식, 도로·교통 실행계획, 현장 운영 런시트, 제출·협의 체크리스트, 다국어 방문객 안전 안내문이 포함된다.
- `generate_mice_safety_plan`으로 식음료/LPG 조건을 넣으면 `현장 실행 상태표`, `보존식 라벨`, `냉장·보온 온도기록`, `가스용기 반입대장`, `누설점검`, `밸브 차단`, `화기 사용 즉시 중지`, `조치 전후 사진`이 포함된다.
- `generate_mice_safety_plan`으로 대규모 행사 계획서를 만들면 `응급의료·AED`, AED 관리책임자, 구급차 기준이 나온다.
- `generate_mice_safety_plan`은 조건부 별표·서식을 필터링해 공연 없는 옥외축제에는 공연법 별표·서식이 나오지 않고, 공연 행사에는 공연법 별표·서식이 나온다.
- 공연 행사 계획서는 `공연·무대 실행계획`, `현장 실행 상태표`, `공연 재해대처계획`, `무대·트러스 구조검토`, `리깅 승인`, `방염확인서`, `스탠딩 펜스`, `공연중지 기준`, `무대감독`, `아티스트/무대감독 중지 신호`, `전원 차단`, `관객 현 위치 대기`를 포함해야 한다.
- `generate_mice_safety_plan`으로 VIP/개인정보 처리 컨벤션을 넣으면 개인정보보호법 시행령, 처리방침, 수탁자, 접속기록, 경비업법 시행령, 경비지도사, 경비원 명부, 배치신고가 나온다.
- `export_mice_safety_plan_bundle`이 18개 이상 Markdown 문서, 베뉴 시설 CSV, 도로·교통 실행계획 CSV, 무주최 다중운집 대응계획 CSV, 현장 운영 런시트 CSV, 제출·협의 CSV, 제출 일정·RACI·증빙 매트릭스 Markdown/CSV, 다국어 방문객 안전 안내 Markdown/CSV, 자체 검수 요약/커버리지/finding CSV, 관할기관별 제출 패키지, 공유등급/민감정보 제한 문구, `safety-plan.docx`, `safety-checklists.xlsx`를 생성하고 xlsx zip 구조 검증을 통과한다.
- 식음료/LPG export는 `food-lpg-execution.csv`와 `safety-checklists.xlsx`의 `Food LPG Exec` sheet를 생성하고, 실행 상태표의 단계/시점/대상/점검항목/판정/부적합 조치/증빙 컬럼을 보존해야 한다.
- 도로점용/옥외행사 export는 `19-road-traffic-control-plan.md`, `road-traffic-control-plan.csv`, `safety-checklists.xlsx`의 `Road Traffic` sheet를 생성하고, 지자체/베뉴/소방·경찰·의료 제출 패키지에 도로·교통 실행계획을 포함해야 한다.
- 무주최 다중운집 export는 `20-unhosted-crowd-response-plan.md`, `unhosted-crowd-response-plan.csv`, `safety-checklists.xlsx`의 `Unhosted Crowd` sheet를 생성하고, 지자체/베뉴/소방·경찰·의료 제출 패키지에 무주최 다중운집 관계기관 공동대응계획을 포함해야 한다.
- 무주최 야외 다중운집 검수는 `usable`이어야 하며, 실내 베뉴나 임시구조물 조건이 없으면 `REQ_BUILDING_EGRESS` 건축 피난시설 경고가 나오지 않아야 한다.
- 공연 export는 `21-performance-stage-execution-plan.md`, `performance-stage-execution.csv`, `safety-checklists.xlsx`의 `Stage Exec` sheet를 생성하고, 지자체/베뉴/소방·경찰·의료/협력사 패키지에 공연·무대 실행계획을 포함해야 한다.
- 제출 일정·RACI·증빙 매트릭스는 지자체 안전관리계획, 도로점용/교통통제, 옥외광고, 건축/가설구조물, 소방·피난, LPG/식품위생, 개인정보/CCTV, 의료/AED, 작업자 안전 항목에 대해 권장기한, 담당 R/A/C/I, 필수 증빙을 산출해야 한다.
- `eventDate: YYYY-MM-DD`를 넣으면 제출 일정과 현장 운영 런시트의 T-21/T-5/D-1/D-day 기준일이 실제 날짜로 계산되어 Markdown, CSV, manifest에 반영되어야 한다.
- `review_mice_safety_plan`으로 생성 계획서를 검수했을 때 error 없이 `usable` 또는 `usable_with_review`가 나오고, `documentCoverageMatrix`에서 설치·철거 작업자 안전계획, 도로·교통 실행계획, 무주최 다중운집 관계기관 공동대응계획, 현장 운영 런시트, 다국어 방문객 안내가 조건별 required/present로 판정된다.
- 기본 구역명이 없는 실내 컨퍼런스의 다국어 방문객 안내는 `the affected area`, `該当エリア`, `相关区域`처럼 자연스럽게 생성되어야 하며 `area area`, `エリアエリア`, `区域区域` 중복이나 `REQ_VISITOR_NOTICE_QUALITY` finding이 없어야 한다.
- negative case 3종이 공연법, 도로법, 식품위생/LPG, 작업자 안전계획의 과잉 적용을 막는다.
- `query_mice_venue_safety_rules`로 SETEC 시설 인덱스가 sourceSpans, 바닥하중, 전기 항목을 반환한다.
- `generate_mice_safety_plan`으로 SETEC 계획서를 만들면 `venueFacilityPlan`에 베뉴 시설·수용, 바닥하중, 반입·하역, 전기, 소방·피난, 근거 위치가 나온다.
- `initialize_mice_runsheet_execution` → `update_mice_runsheet_execution` → `query_mice_runsheet_execution` → `query_mice_operations_dashboard` → `export_mice_operations_dashboard` 루프가 통과하고, 계획서의 현장 운영 런시트가 로컬 실행 상태표로 저장되며 `blocked` 항목은 이슈와 조치에 연결되고 대시보드/timeline/xlsx에 반영된다.
- 식음료/LPG 런시트에서 냉장·보온/보존식 항목이 `blocked`가 되면 `food_safety` 이슈와 식음료 안전팀 조치로, 가스용기/누설점검/밸브 항목이 `blocked`가 되면 `gas_lpg` 이슈와 가스·소방팀 조치로 연결되어야 한다.
- 무주최 다중운집 런시트의 관찰/주의/경계/심각 단계 항목이 `escalated`로 바뀌면 `unhosted_crowd_surge` 이슈와 관계기관 합동상황반 조치로 자동 연결되어야 한다.
- 공연 런시트의 공연중지 기준, 무대감독, 무대 전면 압박, 리깅 승인 항목이 `blocked` 또는 `escalated`가 되면 `stage_rigging_structure` 이슈와 공연·무대 안전팀 조치로 자동 연결되어야 한다.
- `register_mice_safety_issue` → `record_mice_evidence` → `assign_mice_staff_action` → `record_mice_command_decision` → `query_mice_communication_templates` → `query_mice_operations_dashboard` → `resolve_mice_command_decision` → `export_mice_operations_dashboard` → `complete_mice_action` → `generate_mice_incident_report` → `generate_mice_situation_brief` 루프가 통과하고, `crowd_bottleneck`은 인파·동선팀/고위험 SLA 라우팅과 active `event_pause`, released 전이, `event_resume` 해제 판단, action/command timeline, 관계기관 요청사항을 가진다. 행사명만으로 상황보고서를 호출해도 최신 `reportScopeIssueId` 중심으로 조치가 좁혀진다.
- `generate_mice_visitor_notice`로 행사 일시중지 방문객 안내를 생성하면 한국어, 영어, 일본어, 중국어 문구가 모두 나오고, `B게이트`와 `대기열 병목`이 각 언어 placeholder로 현지화된다.
- `diff:ontology`은 법령/조례/베뉴/작업자 안전 pack의 baseline 대비 변경 요약을 생성한다.
