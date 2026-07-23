# Nemotron Persona Safety QA

## 목적

`Nemotron-Personas-Korea`를 MICE 법령 적용 판단과 분리된 합성 관람객 안전계획 QA에 사용한다.

- 법령 적용성: 행사·베뉴·관할·위험 조건으로만 결정한다.
- 페르소나 QA: 생성 계획서가 다양한 성인 관람객 관점과 필수 센티널 시나리오를 다루는지 점검한다.
- 금지 용도: 실제 참석자 구성, 행동, 의료 위험, 사고 확률, 개인 위험도 또는 보안등급 예측.

## 데이터 경계

공개 웹 번들에는 전체 100만 레코드를 포함하지 않는다. `scripts/build-nemotron-persona-sample.mjs`가 NVIDIA 공개 코어 데이터셋의 고정 리비전에서 20개 등간격 오프셋을 사용해 320개 레코드를 가져오고 다음 필드만 정규화한다.

- 연령, 성별, 시도·시군구
- 교육 수준, 가구 유형, 직업
- Extended 데이터에 존재할 때만 구조화 건강 상태 필드

원본 UUID, 합성 이름, 자유서술 페르소나는 저장하거나 브라우저에 배포하지 않는다. 생성 pack은 출처 URL, 리비전, 라이선스, 샘플링 방법을 자체 provenance에 기록한다.

```bash
npm run build:persona-sample
npm run sync:public-site
```

사용자가 NGC Dataset License Agreement를 확인하고 Extended 원본을 내려받은 경우, JSON 또는 JSONL로 내보낸 뒤 같은 정규화 파이프라인에 넣을 수 있다. 출력 pack에는 로컬 원본의 SHA-256, 감지된 스키마와 NGC 라이선스 식별자가 기록된다.

```bash
node scripts/build-nemotron-persona-sample.mjs \
  --input-json /path/to/nemotron-personas-korea-extended.jsonl \
  --output src/ontology/mice/nemotron-persona-sample.json
npm run sync:public-site
```

NGC Extended 원본 자체는 저장소나 공개 사이트에 커밋하지 않는다.

## MCP 도구

### `sample_mice_persona_cohort`

프리셋:

- `national`: 전국 분산 샘플
- `host_region`: `targetProvince` 우선
- `senior_inclusive`: 65세 이상 최소 40%
- `family_inclusive`: 자녀·다세대 가구 신호 최소 45%
- `operations_workforce`: MICE 현장과 가까운 직업군 최소 50%

### `stress_test_mice_safety_plan`

기존 계획서를 생성·검수한 뒤 다음을 별도 평가한다.

- 고령층 보조 이동·단계적 대피
- 방송·안내판·문자·전광판·대면 안내 중복
- 옥외 휴식·폭염·의료 여유
- 미아·보호자 인계·가족 재결합
- 쉬운 한국어·그림문자
- 작업자·협력업체 브리핑
- 장애·이동 접근성, 아동·보호자, 비한국어 방문객 필수 센티널

`personaCoverage.score`는 비법적 QA 커버리지다. `basePlanReview.score`와 분리해 표시한다.

## 웹 API

```bash
curl -sS -X POST http://127.0.0.1:4317/api/persona-stress-test \
  -H 'content-type: application/json' \
  --data '{
    "eventName":"고령층 포함 야외축제",
    "eventTypes":["festival"],
    "expectedCrowd":3000,
    "outdoorEvent":true,
    "personaPreset":"senior_inclusive",
    "cohortSize":100
  }'
```

## 대표성 한계와 센티널

데이터셋은 성인 중심이며 장애·이동성·언어능력·실제 행사 참석 행동을 검증한 데이터가 아니다. 따라서 표본에 나타나지 않더라도 다음 사례를 항상 고정 점검한다.

- 휠체어·시각·청각 장애와 보조견
- 아동 분리, 유모차, 보호자 인계
- 비한국어 방문객과 통역·그림문자

희귀하지만 결과가 큰 안전 요구는 인구 비중으로 제외하지 않는다.
