# 2026년 5월 실제 MICE·옥외행사 안전계획 적용 결과 요약

이 폴더의 최상위 보고서입니다. 상세 파일은 `details/` 아래에 두고, 여기서는 사람이 먼저 판단해야 하는 결과만 모았습니다.

## 한 줄 판정

5개 실존 행사 모두 오프라인 온톨로지 기반으로 계획서 묶음과 검수 결과가 생성되었습니다. 다만 예상 인원, 세부 배치도, 실제 교통통제 여부, 현장별 제출창구는 주최 측 최신 운영자료와 관할기관 확인으로 보정해야 합니다.

## 행사별 결과

| 행사 | 유형 | 관할/베뉴 | 핵심 적용 판단 | 자동검수 | 먼저 볼 보고서 |
| --- | --- | --- | --- | --- | --- |
| KOBA 2026 제34회 국제 방송·미디어·음향·조명 전시회 | exhibition, conference | 서울특별시 강남구 / coex | 설치·철거 작업자 안전계획 적용<br>개인정보/CCTV 적용 | usable / 100 | [열기](details/01-coex-koba-2026/00-executive-report.md) |
| PlayX4 2026 플레이엑스포 | exhibition, conference | 경기도 고양시 / kintex | 공연/무대 적용<br>설치·철거 작업자 안전계획 적용<br>개인정보/CCTV 적용 | usable / 100 | [열기](details/02-kintex-playx4-2026/00-executive-report.md) |
| 2026 한강 드론 라이트 쇼 어린이날 특별공연 | festival, outdoor_event, performance | 서울특별시 송파구 / 베뉴 미지정 | 공연/무대 적용<br>설치·철거 작업자 안전계획 적용 | usable / 100 | [열기](details/03-hangang-drone-light-show-2026/00-executive-report.md) |
| 2026 연등회 연등행렬 | festival, outdoor_event, performance | 서울특별시 종로구 / 베뉴 미지정 | 도로점용 필수<br>공연/무대 적용<br>설치·철거 작업자 안전계획 적용 | usable / 100 | [열기](details/04-lotus-lantern-festival-2026/00-executive-report.md) |
| 제18회 중랑 서울장미축제 | festival, outdoor_event, performance | 서울특별시 중랑구 / 베뉴 미지정 | 공연/무대 적용<br>설치·철거 작업자 안전계획 적용 | usable / 100 | [열기](details/05-jungnang-rose-festival-2026/00-executive-report.md) |

## 우선 확인해야 할 공통 리스크

- 실내 전시장 행사는 베뉴 승인, 부스/전기/하역/고소작업, 비상구·소방통로 확보가 핵심입니다.
- 옥외축제와 행렬형 행사는 관할 지자체 안전관리계획, 인파 밀집·병목, 비상차량 접근로, 도로점용·교통통제 여부가 핵심입니다.
- 공연·무대가 포함된 행사는 공연 재해대처계획 후보, 무대·트러스·전기·작업자 안전계획을 함께 봐야 합니다.
- 식음료/LPG가 입력되지 않은 행사에는 식품위생/LPG를 필수로 과잉 적용하지 않았습니다.
- 도로점용이 입력되지 않은 실내행사에는 도로점용을 필수로 과잉 적용하지 않았습니다.

## 산출물 구조

- `details/<event>/00-executive-report.md`: 행사별 핵심 안전 브리프
- `details/<event>/bundle/documents/`: 안전관리계획서, 인파·동선, 작업자 안전, 점검표, 런시트
- `details/<event>/bundle/tables/`: CSV/XLSX 실행표
- `details/<event>/bundle/submission-packages/`: 지자체·베뉴·소방/경찰/의료·협력사용 패키지
- `details/<event>/bundle/metadata/manifest.json`: 생성 결과와 검수 메타데이터

## 실존 행사 확인 출처

- COEX KOBA 2026 공식 행사 페이지: https://www.coex.co.kr/exhibitions/%EC%A0%9C-34%ED%9A%8C-%EA%B5%AD%EC%A0%9C-%EB%B0%A9%EC%86%A1-%C2%B7-%EB%AF%B8%EB%94%94%EC%96%B4-%C2%B7-%EC%9D%8C%ED%96%A5-%C2%B7-%EC%A1%B0%EB%AA%85-%EC%A0%84%EC%8B%9C%ED%9A%8C/
- PlayX4 공식 사이트 / Indiegame 기사: https://www.playx4.or.kr/ , https://indiegame.com/en/archives/21645
- 서울시 한강 드론 라이트 쇼 안내: https://english.seoul.go.kr/2026-hangang-drone-light-show-festival-to-illuminate-the-night-sky/
- 서울신문 연등회 일정 기사: https://www.seoul.co.kr/news/life/2026/03/20/20260320500126
- 아시아경제 중랑 서울장미축제 기사: https://view.asiae.co.kr/article/2026031007560725529

## 주의

이 결과는 안전관리 실무 초안입니다. 법률 자문이나 관할기관 승인을 대체하지 않으며, 행사 도면·부스 배치·경비/의료 배치·교통통제 계획은 실제 운영자료로 보정해야 합니다.
