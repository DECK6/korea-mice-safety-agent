# Venue Corpus Audit

Venue source documents stay offline as raw PDF/HWP plus Markdown extracts. The ontology stores compact operational facts and source spans; recruitment/selection notices are excluded from the core safety corpus.

## Counts

- manifestItems: 15
- markdownIndexItems: 15
- sourceRegistrySources: 53
- venues: 19
- facilityIndexedVenues: 19
- facilityEntries: 5875
- errors: 0
- warnings: 0

## Venue Coverage

| Venue | Region | Sources | Offline sources | Facility entries | Core rules |
| --- | --- | ---: | ---: | ---: | --- |
| 코엑스 (coex) | 서울 | 3 | 3 | 1145 | yes |
| 킨텍스 (kintex) | 경기 고양 | 3 | 2 | 882 | yes |
| 벡스코 (bexco) | 부산 | 4 | 3 | 1129 | yes |
| 김대중컨벤션센터 (kdjcenter) | 광주 | 2 | 0 | 33 | yes |
| 울산전시컨벤션센터(UECO) (ueco) | 울산 | 1 | 0 | 8 | yes |
| 서울무역전시장(SETEC) (setec) | 서울 강남 | 1 | 1 | 409 | yes |
| aT센터 (atcenter) | 서울 양재 | 2 | 2 | 37 | yes |
| 송도컨벤시아 (songdo_convensia) | 인천 송도 | 1 | 1 | 534 | yes |
| 수원컨벤션센터 (suwon_convention_center) | 경기 수원 | 1 | 1 | 22 | yes |
| 수원메쎄 (suwonmesse) | 경기 수원 | 1 | 1 | 246 | yes |
| 대전컨벤션센터(DCC) (dcc) | 대전 유성 | 2 | 2 | 29 | yes |
| 청주오스코(OSCO) (osco) | 충북 청주 오송 | 1 | 1 | 37 | yes |
| EXCO (exco) | 대구 | 1 | 1 | 45 | yes |
| 경주화백컨벤션센터(HICO) (hico) | 경북 경주 | 1 | 1 | 244 | yes |
| 구미코(GUMICO) (gumico) | 경북 구미 | 2 | 2 | 42 | yes |
| 창원컨벤션센터(CECO) (ceco) | 경남 창원 | 2 | 2 | 721 | yes |
| 군산새만금컨벤션센터(GSCO) (gsco) | 전북 군산 | 1 | 1 | 238 | yes |
| 제주국제컨벤션센터(ICC JEJU) (icc_jeju) | 제주 서귀포 | 2 | 2 | 42 | yes |
| 여수엑스포컨벤션센터 (yeosu_expo) | 전남 여수 | 2 | 2 | 32 | yes |

## Raw/Markdown Manifest

| ID | Venue | Format | Raw bytes | Markdown chars | Safety hits |
| --- | --- | --- | ---: | ---: | --- |
| coex_exhibition_guide_2025 | coex | pdf | 3262305 | 21625 | 안전, 소방, 소화전, 전기, 반입, 반출, 부스, 철거 |
| coex_facility_operation_rule_2023 | coex | pdf | 243611 | 22716 | 안전, 소방, 비상구, 피난, 대피, 소화전, 전기, 하역 |
| coex_service_partner_manual | coex | pdf | 343294 | 38859 | 안전, 소방, 비상구, 피난, 대피, 소화전, 전기, 하역 |
| kintex_safety_education | kintex | pdf | 5381741 | 52851 | 안전, 소방, 비상구, 피난, 대피, 소화전, 전기, 하역 |
| kintex_organizer_manual | kintex | pdf | 8107951 | 70661 | 안전, 소방, 소화전, 전기, 하역, 반입, 반출, 부스 |
| bexco_operation_rules | bexco | pdf | 271549 | 47205 | 안전, 소방, 전기, 반입, 반출, 철거, 위험물, 가스 |
| bexco_operation_implementation_rules | bexco | pdf | 312415 | 43094 | 안전, 소방, 비상구, 피난, 소화전, 전기, 하역, 반입 |
| bexco_construction_safety_manual | bexco | pdf | 675032 | 51842 | 안전, 소방, 비상구, 피난, 소화전, 전기, 하역, 반입 |
| setec_operating_guide_2025 | setec | pdf | 635857 | 55998 | 안전, 소방, 비상구, 피난, 대피, 소화전, 전기, 반입 |
| suwonmesse_rules | suwonmesse | pdf | 278605 | 23652 | 안전, 소방, 비상구, 피난, 소화전, 전기, 하역, 반입 |
| songdo_operation_rules | songdo_convensia | pdf | 1214903 | 85870 | 안전, 소방, 비상구, 피난, 소화전, 전기, 하역, 반입 |
| ceco_operation_rules | ceco | pdf | 472309 | 60999 | 안전, 소방, 비상구, 피난, 소화전, 전기, 반입, 반출 |
| ceco_work_safety_manual | ceco | hwp | 294400 | 15324 | 안전, 비상구, 피난, 대피, 소화전, 전기, 하역, 반입 |
| hico_facility_guide | hico | pdf | 24991246 | 9407 | 안전, 소방, 비상구, 대피, 소화전, 전기, 반입, 부스 |
| gsco_operation_rules | gsco | pdf | 254524 | 29711 | 안전, 소방, 비상구, 피난, 소화전, 전기, 반입, 반출 |

## Findings

- No findings.

## Notes

- 원본 PDF/HWP는 로컬 연구·검증용으로 보관하고, 배포 산출물에는 요약 체크포인트와 출처 링크 중심으로 반영한다.
- 이미지 기반 PDF나 짧은 추출본은 `offline_derived` 구조화 요약 또는 직접 OCR/시각 판독으로 보강해야 한다.
- 지정등록업체 모집, 등록업체 선발 공고 등 공고성 문서는 core safety corpus에 넣지 않는다.
