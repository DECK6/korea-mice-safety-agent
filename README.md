# korea-mice-safety-agent

Korean MICE 현장 운영 안전용 MCP 서버입니다. 축제·박람회·컨벤션·공연·식음료·VIP 행사에 적용되는 법령, 안전수칙, 베뉴 규정, 위험요인, 문서 의무를 로컬 온톨로지로 조회합니다. 설계 참고점 중 하나로 `agent-safety-oss`의 법령·위험·통제·문서·증빙 연결 방식을 검토했습니다.

## 현재 범위

- 공통 법령: 중대재해처벌법, 산안법, 산안기준규칙, 재난안전법, 소방, 개인정보보호법, 응급의료법, 전기안전관리법
- 유형별 법령: 공연법, 식품위생법, LPG, 도로/도로교통, 옥외광고물, 건축, 승강기, 경비업법 등
- 지자체 조례: 지역축제 안전관리, 옥외행사 안전관리, 도로점용·교통소통, 옥외광고물 관리 조례 오프라인 인덱스
- 공공 지침: KTO MICE 안전관리 매뉴얼, 행안부 지역축제/다중운집/다중이용시설 자료, 문체부 공연장 안전 매뉴얼
- 작업자 안전: 산안기준규칙/KOSHA Guide worker-safety 관점을 MICE 설치·철거 작업 레이어로 정리
- 거점 베뉴: 코엑스, 킨텍스, 벡스코, 김대중컨벤션센터, 유에코, SETEC, aT센터, 송도컨벤시아, 수원컨벤션센터, 수원메쎄, DCC, OSCO, EXCO, HICO, 구미코, CECO, GSCO, ICC JEJU, 여수엑스포컨벤션센터
- 위험요인: 군중 밀집, 병목, 무주최 다중운집 지휘 공백, 피난통로 폐쇄, 임시구조물, 무대·트러스·리깅, 임시전기, 작업자 추락, 중량물, 화기/LPG, 식중독, 응급, 개인정보/CCTV, 출입통제·보안검색, 기상악화
- 계획서/검수: 안전관리계획서 단일 문서가 아니라 인파·동선, 도로·교통 실행계획, 무주최 다중운집 관계기관 공동대응계획, 베뉴 시설·수용·하역·전기 제약, 작업자 안전, 공연·무대 실행계획, 소방·피난, 식음료/LPG 현장 실행 상태표, 개인정보/CCTV, 출입통제·보안검색/VIP 동선, 응급의료·AED·구급 이송, 스태프 배치, 비상연락망, 일일점검표, 현장 운영 런시트, 제출·협의 체크리스트, 사고보고서 템플릿을 묶음으로 생성하고 검수
- 파일 export: 생성된 문서 묶음을 Markdown, CSV 체크리스트, 도로·교통 실행계획, 무주최 다중운집 대응계획, 공연·무대 실행 CSV, 식음료/LPG 실행 CSV, 현장 운영 런시트, `.docx`, `.xlsx`로 로컬 디렉터리에 저장
- 운영 루프: 현장 이슈 등록, 이슈 유형별 권장팀·초동 SLA·escalation·playbook 자동 부여, 대피개시/행사중지/재개승인 등 지휘 판단 기록, 방송·무전·문자 템플릿 조회, 증빙 기록, 담당자 조치 배정, 조치 완료, 사고/조치 보고서를 로컬 저장소에 기록

## 릴리스 상태

- 현재 버전: `1.0.3`
- 성숙도: 신뢰성 평가 95/100의 high-trust release 구간입니다. 이미 1.0.x 릴리스 라인에 있으므로 버전은 되돌리지 않습니다.
- 버전 정책: `package.json`/CLI의 `1.0.3`이 제품 릴리스 버전입니다. 일부 온톨로지 파일의 `version`은 데이터 스키마 또는 내부 pack 버전이며 제품 버전을 낮추는 의미가 아닙니다.
- 릴리스 게이트와 배포 경계는 [RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)에 정리합니다.
- 신뢰성 평가 기준은 [TRUSTED_SAFETY_LAW_RUBRIC.md](docs/TRUSTED_SAFETY_LAW_RUBRIC.md), 현재 점수표는 [TRUSTED_SAFETY_LAW_SCORECARD_2026-05-31.md](docs/TRUSTED_SAFETY_LAW_SCORECARD_2026-05-31.md)에 분리해 저장합니다.
- npm 패키지는 raw PDF/HWP, full extracted 베뉴 Markdown, `.env`, 다운로드 쿠키, 검증 출력 저장소, graphify 캐시를 포함하지 않습니다. 공개 패키지에는 `data/public/venue-safety-summaries.json`과 `data/markdown/public/venue-safety-summaries.md`처럼 요약·체크포인트형 자료만 포함합니다.
- clean tarball install 기준 `npm audit --omit=dev`를 통과합니다. xlsx export는 외부 spreadsheet 패키지 없이 내장 OOXML writer로 생성합니다.

## 사용

```bash
cd /Volumes/data/Dev/korea-mice-safety-agent
npm install
npm run build
node build/cli.js tools
node build/cli.js web --host 127.0.0.1 --port 4317
node build/cli.js call query_mice_safety_applicability --inputJson '{"eventTypes":["exhibition"],"venueId":"coex","expectedCrowd":5000,"temporaryStructures":true,"temporaryElectricity":true,"personalDataProcessing":true}'
node build/cli.js call query_mice_safety_applicability --inputJson '{"eventTypes":["conference","vip_event"],"expectedCrowd":800,"personalDataProcessing":true,"vipSecurity":true}'
node build/cli.js call query_mice_safety_applicability --inputJson '{"eventTypes":["outdoor_event","food_event"],"jurisdiction":"경기도 고양시","expectedCrowd":5000,"outdoorEvent":true,"roadUse":true,"foodService":true,"lpgUse":true,"temporaryStructures":true,"temporaryElectricity":true,"setupTeardown":true,"workAtHeight":true,"heavyObjectHandling":true}'
node build/cli.js call generate_mice_safety_plan --inputJson '{"eventName":"역세권 무주최 다중운집","eventTypes":["outdoor_event"],"jurisdiction":"서울특별시 중구","location":"역세권 광장 및 상권 연결부","expectedCrowd":10000,"outdoorEvent":true,"unhostedCrowd":true,"roadUse":false}'
node build/cli.js call query_mice_legal_articles --inputJson '{"lawEntryId":"performance_act_enforcement_decree"}'
node build/cli.js call query_mice_legal_annexes --inputJson '{"lawEntryId":"lp_gas_safety_act_enforcement_rule"}'
node build/cli.js call generate_mice_safety_plan --inputJson '{"eventName":"고양 야외 푸드 페스티벌","eventTypes":["festival","food_event"],"jurisdiction":"경기도 고양시","expectedCrowd":5000,"outdoorEvent":true,"roadUse":true,"foodService":true,"lpgUse":true,"temporaryStructures":true,"temporaryElectricity":true,"setupTeardown":true,"workAtHeight":true,"heavyObjectHandling":true}'
node build/cli.js call review_mice_safety_plan --inputJson '{"eventName":"고양 야외 푸드 페스티벌","eventTypes":["festival","food_event"],"jurisdiction":"경기도 고양시","expectedCrowd":5000,"outdoorEvent":true,"roadUse":true,"foodService":true,"lpgUse":true,"temporaryStructures":true,"temporaryElectricity":true,"setupTeardown":true,"workAtHeight":true,"heavyObjectHandling":true}'
node build/cli.js call export_mice_safety_plan_bundle --inputJson '{"eventName":"고양 야외 푸드 페스티벌","eventDate":"2026-06-20","eventTypes":["festival","food_event"],"jurisdiction":"경기도 고양시","expectedCrowd":5000,"outdoorEvent":true,"roadUse":true,"foodService":true,"lpgUse":true,"temporaryStructures":true,"temporaryElectricity":true,"setupTeardown":true,"workAtHeight":true,"heavyObjectHandling":true}'
node build/cli.js call register_mice_safety_issue --inputJson '{"eventName":"고양 야외 푸드 페스티벌","issueType":"crowd_bottleneck","severity":"high","description":"B게이트 대기열이 보행동선을 침범함","zone":"B게이트","relatedHazards":["ingress_egress_bottleneck"]}'
```

`outdoor_event`는 입력 편의용 별칭이며 내부 적용성 판정에서는 `festival`로 정규화합니다.

웹 시뮬레이터:

```bash
npm run build
npm run web
# 또는
node build/cli.js web --host 127.0.0.1 --port 4317
```

브라우저에서 `http://127.0.0.1:4317`을 열면 행사 유형, 예상 인파 수, 베뉴, 관할 지자체, 도로점용, 식음료/LPG, 설치·철거, 개인정보, VIP/보안, 무주최 다중운집 조건을 입력해 카드형 체크리스트를 바로 확인할 수 있습니다. `계획서 요약·검수` 버튼은 같은 입력으로 `generate_mice_safety_plan`과 `review_mice_safety_plan`을 실행해 핵심 위험, 적용 근거, 제출·협의 액션, 검수 지적, 문서 묶음 키를 사람이 먼저 보는 보고서 형태로 보여줍니다. 웹 시뮬레이터는 별도 네트워크 조회 없이 오프라인 온톨로지만 사용합니다.

API로도 호출할 수 있습니다.

```bash
curl -sS http://127.0.0.1:4317/api/options
curl -sS -X POST http://127.0.0.1:4317/api/simulate \
  -H 'content-type: application/json' \
  --data '{"eventName":"고양 야외 푸드 페스티벌","eventTypes":["festival","outdoor_event","food_event"],"jurisdiction":"경기도 고양시","expectedCrowd":8000,"outdoorEvent":true,"roadUse":true,"foodService":true,"lpgUse":true,"temporaryStructures":true,"temporaryElectricity":true,"setupTeardown":true}'
curl -sS -X POST http://127.0.0.1:4317/api/plan-review \
  -H 'content-type: application/json' \
  --data '{"eventName":"고양 야외 푸드 페스티벌","eventTypes":["festival","outdoor_event","food_event"],"jurisdiction":"경기도 고양시","expectedCrowd":8000,"outdoorEvent":true,"roadUse":true,"foodService":true,"lpgUse":true,"temporaryStructures":true,"temporaryElectricity":true,"setupTeardown":true}'
```

MCP 서버:

```bash
node /Volumes/data/Dev/korea-mice-safety-agent/build/cli.js serve
```

## korean-law-mcp 연동

`LAW_OC`는 레포에 저장하지 않습니다.

```bash
export LAW_OC=...
node build/cli.js call plan_korean_law_mcp_queries --inputJson '{"onlyNeedsReview":true}'
```

현재 오프라인 법령팩에는 `LAW_OC` 환경변수로 확인한 법령 MST/법령ID와 핵심 조문 요약이 들어 있습니다. 오프라인 법령팩은 35개 법령/행정규칙, 74개 조문, 35개 별표·서식 요약팩을 포함하며, 공연법 시행령/시행규칙, 식품위생법 시행규칙, LPG 시행규칙, 도로법 시행령/시행규칙, 옥외광고물법 시행령, 화재예방법 시행령, 소방시설법 시행령, 응급의료법 시행령/시행규칙, 건축법 시행령/시행규칙, 개인정보보호법 시행령, 경비업법 시행령/시행규칙까지 들어 있습니다. 조문 검증 완료 항목은 `verificationStatus: "verified"`로 표시했고, 오프라인 조문 온톨로지는 [legal-article-ontology.json](src/ontology/mice/legal-article-ontology.json), 별표·서식 온톨로지는 [legal-annex-ontology.json](src/ontology/mice/legal-annex-ontology.json)에 저장합니다.

지자체 조례 수집은 실행 시점에만 `LAW_OC`를 사용하고 결과를 오프라인 JSON으로 저장합니다.

```bash
export LAW_OC=...
npm run collect:local-ordinances
npm run refine:local-ordinances
```

현재 오프라인 조례팩은 지역축제 안전관리 1건, 옥외행사 안전관리 189건, 도로점용·교통소통 333건, 옥외광고물 관리 228건을 로컬 인덱스로 보관합니다. 우선 지자체 73개 레코드는 조문 발췌까지 포함합니다. 각 레코드는 `jurisdiction`, `category`, `lawOrOrdinanceName`, `ordinanceName`, `ordinSeq/sourceUrl`, `sourceId`, `effectiveAt`, `appliesWhen`, `crowdThreshold`, `threshold`, `thresholdStructured`, `submissionDeadline`, `requiredPlanItems`, `inspectionRules`, `agencyCoordination`, `insuranceOrLiability`, `relatedDuties`, `relatedHazards`, `articleExtracts`, `verificationStatus`, `verificationChecks`, `sourceConfidence`를 포함합니다. 조례 `verificationStatus`는 `source_verified`, `article_verified`, `needs_review`로 세분화하며, threshold 추출이 중복·절단된 후보는 `needs_review`로 낮춥니다.

`query_mice_local_ordinances`와 계획서 생성은 `jurisdiction`, `venueId`, `eventType(s)`, `roadUse`, `outdoorEvent`, `temporaryStructures`를 이용해 광역/기초 조례 후보를 `primary`, `secondary`, `reference`로 우선순위화합니다. 예를 들어 `venueId: "kintex"` 또는 `jurisdiction: "경기도 고양시"`를 넣으면 고양시 조례를 먼저, 경기도 조례를 그 다음 후보로 둡니다.

계획서 본문은 조례 후보를 `우선 적용 조례 후보`와 `참고 후보`로 나눠 보여주므로, 전국 조례 인덱스가 섞여도 실무자가 먼저 검토할 관할 조례를 바로 볼 수 있습니다.

## 오프라인 베뉴 문서

운영규정, 시행규정, 주최자/작업자 매뉴얼, 작업 안전 매뉴얼만 핵심 코퍼스에 둡니다. 지정등록업체 모집/등록 공고처럼 업체 선발 목적의 문서는 핵심 온톨로지에서 제외하고 `data/out-of-scope/` 아래에 분리했습니다.

```bash
npm run sync:venue-pdfs
npm run build:venue-index
npm run build:public-venue-summaries
npm run validate:venue-corpus
```

- 원본 PDF/HWP: `data/raw/venue-pdfs/`, `data/raw/venue-hwp/`
- 내부 검증용 Markdown 변환본: `data/markdown/venue-manuals/` (npm package에는 포함하지 않음)
- 공개 패키지용 요약본: `data/public/venue-safety-summaries.json`, `data/markdown/public/venue-safety-summaries.md`
- 시설/안전 라인 인덱스: [venue-facility-index.json](src/ontology/mice/venue-facility-index.json)
- 동기화 manifest: [venue-pdf-manifest.json](data/venue-pdf-manifest.json)
- 베뉴 코퍼스 감사: [VENUE_CORPUS_AUDIT.md](docs/VENUE_CORPUS_AUDIT.md), [venue-corpus-audit-report.json](data/venue-corpus-audit-report.json)
- HICO 가이드북은 이미지 기반 PDF라 직접 시각 판독 기반 구조화 Markdown으로 보강했습니다.
- `query_mice_venue_safety_rules`는 각 베뉴에 대해 `region/province/city`, 공간/면적, 바닥하중, 천장고, 반입·하역, 전기, 소방·피난, 금지물품, 부스/리깅/식음료 규칙, 안전문서, 출처, 로컬 Markdown 경로, 원문 line/confidence를 공통 시설 스키마로 반환합니다.

## 적용성 검증

전시장 행사만 보지 않고 옥외축제, 공연, 컨벤션/VIP, 식음료 행사를 함께 검증합니다.

```bash
npm run typecheck
npm run build
npm run validate:venue-corpus
npm run validate:scenarios
node build/cli.js tools
npm run audit:sources
npm run audit:package-safety
npm run diff:ontology
```

검증 기준과 fixture는 [VALIDATION_SCENARIOS.md](docs/VALIDATION_SCENARIOS.md)를 봅니다.
출처/라이선스 감사 결과는 [SOURCE_AUDIT.md](docs/SOURCE_AUDIT.md)와 [source-audit-report.json](data/source-audit-report.json)에 저장됩니다.
온톨로지 변경 추적 결과는 [ONTOLOGY_DIFF.md](docs/ONTOLOGY_DIFF.md)와 [ontology-diff-report.json](data/ontology-diff-report.json)에 저장됩니다.

## 도구

- `query_mice_safety_applicability`: 행사 유형/특징/베뉴 기반 적용성 조회
- `query_mice_api_access_status`: P0/P1/P2 개발에 필요한 API 키 상태를 키 값 없이 configured/missing/pending/externally_available/no_key_required로 조회
- `collect_mice_p0_ready_sources`: available-key-first P0 source의 오프라인 pack 준비 상태 조회. `liveProbe:true`이면 KCISA/KOPIS/TourAPI/NEMC/FoodSafety를 소량 실제 호출해 정규화 결과를 검증
- `generate_mice_event_day_snapshot`: P1 행사 당일 snapshot. `live:true`이면 서울 실시간 도시데이터와 에어코리아를 실제 호출하고, ITS/재난문자는 pending fallback으로 처리
- `query_mice_live_operations_status`: P2 live adapter. `live:true`이면 기상청 API Hub 초단기실황, 서울 실시간 도시데이터, 에어코리아를 실제 호출해 법령 근거가 아닌 `operationalEvidence`로 반환
- `generate_mice_safety_plan`: 맨 앞에 결론, 핵심 위험, 적용/비적용 판단, 조건부 확인, 제출·협의 액션, 담당자·기한·증빙, 남은 리스크 요약을 고정하고, 뒤에 오프라인 온톨로지 기반 안전관리계획서, 공공 API 운영 증거, 도로·교통 실행계획, 무주최 다중운집 관계기관 공동대응계획, 현장 운영 런시트, 제출·협의 체크리스트, 다국어 방문객 안내 초안 생성
- `export_mice_safety_plan_bundle`: 생성 계획서를 Markdown/CSV/docx/xlsx 파일 묶음으로 저장. 공공 API 운영 증거, 도로·교통 실행계획, 무주최 다중운집 대응계획, 공연·무대 실행 상태표 CSV, 식음료/LPG 실행 상태표 CSV, 현장 운영 런시트, 제출·협의 체크리스트, 제출 일정·RACI·증빙 매트릭스, 다국어 방문객 안전 안내문, 자체 검수 요약, 공유범위 필터가 적용된 관할기관별 제출 패키지를 포함
- `review_mice_safety_plan`: 생성 계획서의 법령/조례/베뉴/작업자 안전/도로·교통/무주최 다중운집/공연·무대/식음료·LPG 현장 실행 기준, 공공 API 운영 증거 누락, 과잉 적용 후보, 문서 커버리지 매트릭스 검수
- `query_mice_local_ordinances`: 지자체 조례 오프라인 인덱스/조문 발췌 조회와 베뉴/관할/행사조건 기반 우선순위 산정
- `query_mice_worker_safety_references`: 산안기준규칙/KOSHA 기반 설치·철거 작업자 안전 근거 조회
- `query_mice_venue_safety_rules`: 베뉴별 안전수칙·출처 조회
- `query_performance_venues`: 문체부 문화데이터(KOPIS 공연시설별상세, 전국 약 2,111곳)를 오프라인 온톨로지로 구축한 인덱스에서 시설명·지역·분류로 공연시설을 검색하고 관할 지자체·주소를 보강
- `register_mice_safety_issue`: 현장 안전 이슈 등록
- `record_mice_evidence`: 사진/영상/문서/메모 증빙 경로와 설명 기록
- `record_mice_command_decision`: 대피개시, 행사 일시중지, 행사 중단, 재개승인, 상황해제 같은 운영본부 지휘 판단 기록
- `resolve_mice_command_decision`: 활성 지휘 판단을 재개승인 또는 상황해제로 닫고 해제 이력을 감사 로그로 기록
- `assign_mice_staff_action`: 이슈별 담당자 조치 배정. 팀/기한을 생략하면 이슈 taxonomy의 권장팀과 SLA를 기본값으로 사용
- `complete_mice_action`: 조치 완료와 이슈 해결 상태 전환
- `generate_mice_incident_report`: 이슈·조치·증빙 기반 Markdown 보고서 생성
- `generate_mice_situation_brief`: 소방·경찰·지자체·베뉴 공유용 1페이지 상황보고서 생성
- `initialize_mice_runsheet_execution`: 생성된 현장 운영 런시트를 로컬 실행 상태표로 초기화
- `update_mice_runsheet_execution`: 런시트 항목을 open/done/blocked/escalated로 갱신하고 이슈·조치에 연결
- `query_mice_runsheet_execution`: 행사명/상태/연결 이슈 기준으로 런시트 실행표 조회
- `query_mice_operations_dashboard`: 미해결 이슈를 SLA 초과/임박/정상과 담당팀별로 조회
- `export_mice_operations_dashboard`: 운영본부 SLA 대시보드, 미해결 조치, 지휘 판단을 `.xlsx` 상황판으로 저장
- `query_mice_communication_templates`: 지휘 판단별 방송·무전·문자·관계기관 공유 템플릿 조회
- `generate_mice_visitor_notice`: 방문객 대상 안전 안내를 한국어·영어·일본어·중국어 오프라인 템플릿으로 생성
- `list_mice_laws`: MICE 법령 레지스트리 조회
- `query_mice_legal_articles`: 로컬 법령 조문 온톨로지 조회
- `query_mice_legal_annexes`: 로컬 별표·서식 요약팩 조회
- `list_mice_duties`: 문서/의무 마스터 조회
- `query_mice_hazard_controls`: 위험요인·통제대책 조회
- `plan_korean_law_mcp_queries`: 추가 법령 검증용 korean-law-mcp CLI 명령 생성

## 데이터 파일

- `src/ontology/mice/public-api-operational-evidence.json`: KCISA/KOPIS/TourAPI/NEMC/식품안전나라/기상청/서울/에어코리아 live probe 결과를 키 없이 요약한 오프라인 운영 증거 스냅샷. 법령 근거가 아니라 행사 전·당일 확인 액션으로만 사용합니다.

- [law-registry.json](src/ontology/mice/law-registry.json)
- [source-registry.json](src/ontology/mice/source-registry.json)
- [mice-safety-applicability.json](src/ontology/mice/mice-safety-applicability.json)
- [mice-duty-master.json](src/ontology/mice/mice-duty-master.json)
- [hazard-controls.json](src/ontology/mice/hazard-controls.json)
- [legal-article-ontology.json](src/ontology/mice/legal-article-ontology.json)
- [legal-annex-ontology.json](src/ontology/mice/legal-annex-ontology.json)
- [local-ordinance-pack.json](src/ontology/mice/local-ordinance-pack.json)
- [worker-safety-references.json](src/ontology/mice/worker-safety-references.json)
- [venue-safety-rules.json](src/ontology/mice/venue-safety-rules.json)
- [venue-facility-index.json](src/ontology/mice/venue-facility-index.json)
- [incident-taxonomy.json](src/ontology/mice/incident-taxonomy.json)
- [communication-templates.json](src/ontology/mice/communication-templates.json)
- [ontology-baseline.json](data/snapshots/ontology-baseline.json)
- [ontology-diff-report.json](data/ontology-diff-report.json)

## 로컬 운영 저장소

현장 이슈/조치/증빙/지휘판단/런시트 실행표 도구는 기본적으로 `~/.korea-mice-safety-agent/operations.json`에 기록합니다. 검증이나 프로젝트별 분리가 필요하면 `MICE_LOCAL_DIR` 환경변수로 경로를 바꿀 수 있습니다. 저장 이슈에는 `recommendedTeam`, `dispatchPriority`, `responseSlaMinutes`, `firstResponseDueAt`, `escalationPath`, `playbookSteps`가 함께 기록됩니다. 지휘 판단은 `active`, `released`, `superseded`, `informational` 상태를 가지며, 일시중지·대피 같은 active 판단은 재개승인/상황해제로 닫을 수 있습니다. 런시트 실행표는 계획서의 현장 운영 런시트를 `open`, `done`, `blocked`, `escalated` 상태로 추적하고, 막힌 항목은 안전 이슈와 스태프 조치로 연결할 수 있습니다. 식음료/LPG 런시트에서 냉장·보온 온도기록, 보존식, 가스용기 반입대장, 누설점검, 밸브 차단 항목이 막히면 각각 `food_safety`, `gas_lpg` 이슈와 권장팀으로 라우팅됩니다. 공연 런시트에서 리깅 승인, 무대·트러스 구조검토, 공연중지 기준, 무대 전면 압박, 무대감독 중지 신호 항목이 막히면 `stage_rigging_structure` 이슈와 공연·무대 안전팀으로 라우팅됩니다. 운영본부 대시보드 도구는 이 값을 이용해 `overdue`, `due_soon`, `normal`, `no_sla`, `resolved`, 활성 지휘 판단, 런시트 상태, 상태 전이 이력, 시간순 타임라인을 집계하고, export 도구는 같은 데이터를 `operations-dashboard.xlsx`로 저장합니다. `generate_mice_situation_brief`는 같은 로컬 저장소에서 관계기관 공유용 1페이지 상황보고서를 생성하며, 행사명만 넣어도 최신 주 이슈 중심으로 조치와 타임라인을 좁혀 과거 유사 이슈가 섞이지 않게 합니다.

## 주의

이 저장소는 법률 자문이나 베뉴 승인 절차를 대체하지 않습니다. 최신 법령 원문, 지자체 조례, 베뉴 최신 운영규정, 경찰·소방·의료 협의 결과를 최종 근거로 확인해야 합니다.
