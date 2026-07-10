import personaPackJson from "../ontology/mice/nemotron-persona-sample.json" with { type: "json" };

export type PersonaPreset =
  | "national"
  | "host_region"
  | "senior_inclusive"
  | "family_inclusive"
  | "operations_workforce";

export const PERSONA_PRESETS: Array<{ id: PersonaPreset; label: string; description: string }> = [
  { id: "national", label: "전국 대표 샘플", description: "전국 분산 샘플에서 합성 관람객 코호트를 구성합니다." },
  { id: "host_region", label: "개최 지역 중심", description: "targetProvince와 일치하는 합성 페르소나를 우선합니다." },
  { id: "senior_inclusive", label: "고령층 포함", description: "65세 이상을 최소 40% 포함해 이동·의료·안내 사각지대를 점검합니다." },
  { id: "family_inclusive", label: "가족 동반 포함", description: "자녀·다세대 가구 신호를 최소 45% 포함해 보호자·재결합 절차를 점검합니다." },
  { id: "operations_workforce", label: "작업자·협력업체", description: "경비·운송·조리·시설·의료 관련 직업을 우선해 훈련 시나리오를 점검합니다." },
];

interface NormalizedPersona {
  id: string;
  age: number;
  sex: string;
  province: string;
  district: string;
  educationLevel: string;
  familyType: string;
  occupation: string;
  economicActivityStatus?: string;
  incomeBracket?: string;
  bmiStatus?: string;
  bloodPressureStatus?: string;
  bloodSugarStatus?: string;
  waistStatus?: string;
  healthcarePersona?: string;
}

interface PersonaPack {
  version: string;
  generatedAt: string;
  provenance: Record<string, unknown>;
  usageBoundary: Record<string, string>;
  limitations: string[];
  personas: NormalizedPersona[];
}

export interface PersonaCohortInput {
  preset?: PersonaPreset;
  cohortSize?: number;
  targetProvince?: string;
  seed?: number;
  representativeLimit?: number;
}

export interface PersonaPlanningSignal {
  id: string;
  label: string;
  count: number;
  share: number;
  rationale: string;
}

export interface PersonaRepresentativeProfile {
  id: string;
  ageBand: string;
  province: string;
  district: string;
  educationLevel: string;
  familyType: string;
  occupation: string;
  occupationGroup: string;
  planningSignals: string[];
}

export interface PersonaCohort {
  preset: PersonaPreset;
  presetLabel: string;
  requestedSize: number;
  actualSize: number;
  targetProvince?: string;
  seed: number;
  shares: {
    senior: number;
    verySenior: number;
    familyCoordination: number;
    plainLanguageSupport: number;
    structuredHealthMonitoring: number;
    operationsWorkforce: number;
  };
  counts: {
    senior: number;
    verySenior: number;
    familyCoordination: number;
    plainLanguageSupport: number;
    structuredHealthMonitoring: number;
    operationsWorkforce: number;
  };
  distributions: {
    ageBands: Record<string, number>;
    provinces: Record<string, number>;
    educationLevels: Record<string, number>;
    familyTypes: Record<string, number>;
    occupationGroups: Record<string, number>;
  };
  planningSignals: PersonaPlanningSignal[];
  representativeProfiles: PersonaRepresentativeProfile[];
  warnings: string[];
  provenance: Record<string, unknown>;
  usageBoundary: Record<string, string>;
  limitations: string[];
}

export interface PersonaSafetyFinding {
  id: string;
  title: string;
  priority: "high" | "medium" | "low";
  status: "covered" | "gap";
  sentinel: boolean;
  audienceShare?: number;
  evidenceTerms: string[];
  recommendation: string;
}

const PACK = personaPackJson as PersonaPack;
const PERSONAS = PACK.personas;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicOrder(items: NormalizedPersona[], seed: number): NormalizedPersona[] {
  return [...items].sort((a, b) => stableHash(`${seed}:${a.id}`) - stableHash(`${seed}:${b.id}`));
}

function compact(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function normalizeProvince(value: string): string {
  const token = compact(value);
  const aliases: Record<string, string> = {
    서울특별시: "서울", 부산광역시: "부산", 대구광역시: "대구", 인천광역시: "인천",
    광주광역시: "광주", 대전광역시: "대전", 울산광역시: "울산", 세종특별자치시: "세종",
    경기도: "경기", 강원특별자치도: "강원", 강원도: "강원", 충청북도: "충북", 충청남도: "충남",
    전북특별자치도: "전북", 전라북도: "전북", 전라남도: "전남", 경상북도: "경북", 경상남도: "경남",
    제주특별자치도: "제주",
  };
  return aliases[token] ?? value.replace(/특별자치도|특별자치시|특별시|광역시|도/g, "").trim();
}

function ageBand(age: number): string {
  if (age < 35) return "19–34세";
  if (age < 50) return "35–49세";
  if (age < 65) return "50–64세";
  if (age < 75) return "65–74세";
  return "75세 이상";
}

function needsFamilyCoordination(persona: NormalizedPersona): boolean {
  return /자녀|3세대|한부모|모와|부와/.test(persona.familyType);
}

function needsPlainLanguageSupport(persona: NormalizedPersona): boolean {
  return /무학|초등학교|중학교/.test(persona.educationLevel);
}

function hasStructuredHealthSignal(persona: NormalizedPersona): boolean {
  const value = [persona.bmiStatus, persona.bloodPressureStatus, persona.bloodSugarStatus, persona.waistStatus]
    .filter(Boolean)
    .join(" ");
  return /고혈압|당뇨|비만|이상|높|위험/.test(value);
}

function occupationGroup(persona: NormalizedPersona): string {
  const value = persona.occupation;
  if (/간호|의사|의료|응급|보건/.test(value)) return "의료·응급";
  if (/경비|보안|경찰|소방/.test(value)) return "경비·보안";
  if (/운전|운송|택배|지게차|화물|물류/.test(value)) return "운송·물류";
  if (/조리|음식|식품|서비스|판매|급식/.test(value)) return "식음료·서비스";
  if (/전기|시설|건설|정비|설치|기계|청소/.test(value)) return "시설·작업";
  if (/사무|개발|연구|교사|공무원|관리|전문/.test(value)) return "사무·전문";
  return "기타";
}

function isOperationsWorkforce(persona: NormalizedPersona): boolean {
  return ["의료·응급", "경비·보안", "운송·물류", "식음료·서비스", "시설·작업"].includes(occupationGroup(persona));
}

function distribution(items: NormalizedPersona[], value: (persona: NormalizedPersona) => string, limit?: number): Record<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = value(item) || "미상";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
  return Object.fromEntries(limit ? entries.slice(0, limit) : entries);
}

function addUnique(target: NormalizedPersona[], candidates: NormalizedPersona[], count: number): void {
  const ids = new Set(target.map((item) => item.id));
  for (const candidate of candidates) {
    if (target.length >= count) break;
    if (ids.has(candidate.id)) continue;
    target.push(candidate);
    ids.add(candidate.id);
  }
}

function representativeProfiles(items: NormalizedPersona[], limit: number): PersonaRepresentativeProfile[] {
  const selected: NormalizedPersona[] = [];
  const seenBands = new Set<string>();
  for (const item of items) {
    const band = ageBand(item.age);
    if (!seenBands.has(band)) {
      selected.push(item);
      seenBands.add(band);
    }
    if (selected.length >= limit) break;
  }
  addUnique(selected, items, limit);
  return selected.slice(0, limit).map((persona) => ({
    id: persona.id,
    ageBand: ageBand(persona.age),
    province: persona.province,
    district: persona.district,
    educationLevel: persona.educationLevel,
    familyType: persona.familyType,
    occupation: persona.occupation,
    occupationGroup: occupationGroup(persona),
    planningSignals: [
      persona.age >= 65 ? "senior_assistance" : undefined,
      needsFamilyCoordination(persona) ? "family_coordination" : undefined,
      needsPlainLanguageSupport(persona) ? "plain_language_support" : undefined,
      hasStructuredHealthSignal(persona) ? "structured_health_monitoring" : undefined,
      isOperationsWorkforce(persona) ? "operations_workforce" : undefined,
    ].filter((value): value is string => Boolean(value)),
  }));
}

function ratio(count: number, total: number): number {
  return total > 0 ? Number((count / total).toFixed(3)) : 0;
}

export function samplePersonaCohort(input: PersonaCohortInput = {}): PersonaCohort {
  const preset = input.preset ?? "national";
  const requestedSize = Math.max(10, Math.min(200, Math.trunc(input.cohortSize ?? 100)));
  const seed = Math.trunc(input.seed ?? 20260710);
  const targetProvince = input.targetProvince?.trim();
  const ordered = deterministicOrder(PERSONAS, seed);
  const selected: NormalizedPersona[] = [];
  const warnings: string[] = [];

  if (preset === "host_region") {
    if (!targetProvince) {
      warnings.push("host_region 프리셋에 targetProvince가 없어 전국 샘플로 보충했습니다.");
    } else {
      const normalizedTarget = normalizeProvince(targetProvince);
      addUnique(selected, ordered.filter((persona) => normalizeProvince(persona.province) === normalizedTarget), requestedSize);
      if (selected.length < requestedSize) {
        warnings.push(`${targetProvince} 표본이 ${selected.length}명이라 전국 샘플로 보충했습니다.`);
      }
    }
  }
  if (preset === "senior_inclusive") {
    addUnique(selected, ordered.filter((persona) => persona.age >= 65), Math.ceil(requestedSize * 0.4));
  }
  if (preset === "family_inclusive") {
    addUnique(selected, ordered.filter(needsFamilyCoordination), Math.ceil(requestedSize * 0.45));
  }
  if (preset === "operations_workforce") {
    addUnique(selected, ordered.filter(isOperationsWorkforce), Math.ceil(requestedSize * 0.5));
  }
  addUnique(selected, ordered, requestedSize);

  const actualSize = selected.length;
  const counts = {
    senior: selected.filter((persona) => persona.age >= 65).length,
    verySenior: selected.filter((persona) => persona.age >= 75).length,
    familyCoordination: selected.filter(needsFamilyCoordination).length,
    plainLanguageSupport: selected.filter(needsPlainLanguageSupport).length,
    structuredHealthMonitoring: selected.filter(hasStructuredHealthSignal).length,
    operationsWorkforce: selected.filter(isOperationsWorkforce).length,
  };
  const shares = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, ratio(value, actualSize)])) as PersonaCohort["shares"];
  const signalDefinitions: Array<[keyof typeof counts, string, string]> = [
    ["senior", "고령층 이동·대피 지원", "65세 이상이 포함되어 장시간 대기, 휴식, 보조 이동, 단계적 대피를 점검합니다."],
    ["verySenior", "초고령층 보수적 운영", "75세 이상이 포함되어 계단·장거리 이동·폭염·응급 대응을 보수적으로 점검합니다."],
    ["familyCoordination", "가족·보호자 재결합", "자녀·다세대 가구 신호가 있어 미아, 보호자 인계, 가족 재결합 절차를 점검합니다."],
    ["plainLanguageSupport", "쉬운 한국어·그림 안내", "정규교육 이력의 다양성을 고려해 짧은 행동형 문구와 그림 안내를 점검합니다."],
    ["structuredHealthMonitoring", "의료 모니터링 여유", "Extended 구조화 건강 신호가 있는 경우 의료·휴식·이송 여유를 점검합니다."],
    ["operationsWorkforce", "현장 작업자 관점", "현장 운영과 가까운 직업군을 활용해 작업자·협력업체 훈련 관점을 점검합니다."],
  ];
  const planningSignals = signalDefinitions
    .filter(([key]) => counts[key] > 0)
    .map(([key, label, rationale]) => ({ id: key, label, count: counts[key], share: shares[key], rationale }));
  const presetMeta = PERSONA_PRESETS.find((item) => item.id === preset) ?? PERSONA_PRESETS[0];

  return {
    preset,
    presetLabel: presetMeta.label,
    requestedSize,
    actualSize,
    ...(targetProvince ? { targetProvince } : {}),
    seed,
    shares,
    counts,
    distributions: {
      ageBands: distribution(selected, (persona) => ageBand(persona.age)),
      provinces: distribution(selected, (persona) => persona.province, 8),
      educationLevels: distribution(selected, (persona) => persona.educationLevel, 8),
      familyTypes: distribution(selected, (persona) => persona.familyType, 8),
      occupationGroups: distribution(selected, occupationGroup),
    },
    planningSignals,
    representativeProfiles: representativeProfiles(selected, Math.max(0, Math.min(12, input.representativeLimit ?? 6))),
    warnings,
    provenance: PACK.provenance,
    usageBoundary: PACK.usageBoundary,
    limitations: PACK.limitations,
  };
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function hasAtLeast(text: string, terms: string[], count: number): boolean {
  return terms.filter((term) => text.includes(term)).length >= count;
}

export function buildPersonaSafetyFindings(
  cohort: PersonaCohort,
  planMarkdown: string,
  event: { outdoor?: boolean; outdoorEvent?: boolean; setupTeardown?: boolean; expectedCrowd?: number } = {},
): PersonaSafetyFinding[] {
  const text = planMarkdown.replace(/\s+/g, " ");
  const findings: PersonaSafetyFinding[] = [];
  const add = (
    id: string,
    title: string,
    priority: PersonaSafetyFinding["priority"],
    covered: boolean,
    recommendation: string,
    evidenceTerms: string[],
    sentinel = false,
    audienceShare?: number,
  ) => findings.push({ id, title, priority, status: covered ? "covered" : "gap", sentinel, audienceShare, evidenceTerms, recommendation });

  if (cohort.shares.senior >= 0.15 || cohort.shares.verySenior >= 0.05) {
    add(
      "senior_assisted_egress",
      "고령층 보조 이동·단계적 대피",
      "high",
      hasAny(text, ["이동지원", "보조 이동", "우선 대피", "대피 도우미"]) && hasAny(text, ["고령자", "65세", "노약자"]),
      "고령층 대피 도우미, 계단 회피 대안, 휴식 지점, 승강기 정지 시 이동지원 절차를 명시하세요.",
      ["고령자", "이동지원", "대피 도우미", "승강기"],
      false,
      cohort.shares.senior,
    );
    add(
      "channel_redundancy",
      "방송·표지·대면 안내 중복",
      "medium",
      hasAtLeast(text, ["방송", "안내판", "문자", "전광판", "스태프"], 3),
      "앱·문자만 의존하지 말고 방송, 큰 글자 안내판, 전광판, 스태프 구두 안내를 같은 행동 문구로 맞추세요.",
      ["방송", "안내판", "문자", "전광판", "스태프"],
      false,
      cohort.shares.senior,
    );
  }
  if ((event.outdoor || event.outdoorEvent) && cohort.counts.senior > 0) {
    add(
      "outdoor_rest_medical",
      "옥외 휴식·폭염·의료 여유",
      "high",
      hasAny(text, ["그늘", "휴식구역", "냉방쉼터"]) && hasAny(text, ["폭염", "온열질환", "의료"]),
      "그늘·좌석·급수·냉방쉼터와 온열질환 관찰, 의료 이송 기준을 동선도와 런시트에 넣으세요.",
      ["그늘", "휴식구역", "폭염", "온열질환", "급수"],
      false,
      cohort.shares.senior,
    );
  }
  if (cohort.shares.familyCoordination >= 0.2) {
    add(
      "family_reunification",
      "미아·보호자 인계·가족 재결합",
      "high",
      hasAny(text, ["가족 재결합", "보호자 인계", "미아", "실종자 접수"]),
      "가족 분리 신고, 아동 보호, 보호자 신원 확인, 재결합 장소와 개인정보 보호 절차를 추가하세요.",
      ["가족 재결합", "보호자 인계", "미아", "실종자"],
      false,
      cohort.shares.familyCoordination,
    );
  }
  if (cohort.shares.plainLanguageSupport >= 0.1) {
    add(
      "plain_language_pictogram",
      "쉬운 한국어·그림문자",
      "medium",
      hasAny(text, ["쉬운 한국어", "그림문자", "픽토그램", "행동형 문구"]),
      "안내문을 한 문장 한 행동 원칙으로 줄이고 출구·금지·대기·도움 요청을 그림문자와 함께 제공하세요.",
      ["쉬운 한국어", "그림문자", "픽토그램", "행동형 문구"],
      false,
      cohort.shares.plainLanguageSupport,
    );
  }
  if (cohort.counts.structuredHealthMonitoring > 0) {
    add(
      "structured_health_capacity",
      "구조화 건강 신호 대응 여유",
      "high",
      hasAny(text, ["의료 관찰", "혈압", "혈당", "복약", "의무실"]) && hasAny(text, ["119", "이송"]),
      "개인 진단이 아닌 계획 여유 관점에서 의무실 관찰, 복약 보관, 119 이송과 휴식 기준을 확인하세요.",
      ["의료 관찰", "의무실", "119", "이송"],
      false,
      cohort.shares.structuredHealthMonitoring,
    );
  }
  if (cohort.preset === "operations_workforce" || event.setupTeardown) {
    add(
      "workforce_briefing",
      "작업자·협력업체 브리핑",
      "medium",
      hasAny(text, ["TBM", "작업 전 교육", "작업자 안전교육"]) && hasAny(text, ["작업중지", "비상연락"]),
      "경비·운송·식음료·시설 협력업체별 TBM, 작업중지권, 비상연락, 교대 인수인계를 훈련 시나리오로 만드세요.",
      ["TBM", "작업 전 교육", "작업중지", "비상연락"],
      false,
      cohort.shares.operationsWorkforce,
    );
  }

  add(
    "accessibility_sentinel",
    "장애·이동 접근성 센티널",
    "high",
    hasAny(text, ["휠체어", "이동약자"]) && hasAny(text, ["시각장애", "청각장애", "수어", "촉지도"]),
    "표본 빈도와 무관하게 휠체어, 시각·청각 장애, 보조견, 이동지원 대피를 고정 테스트 케이스로 검증하세요.",
    ["휠체어", "이동약자", "시각장애", "청각장애", "수어"],
    true,
  );
  add(
    "child_guardian_sentinel",
    "아동·보호자 센티널",
    "high",
    hasAny(text, ["아동", "영유아"]) && hasAny(text, ["보호자", "미아", "가족 재결합"]),
    "성인 전용 데이터셋의 공백을 보완하도록 아동 분리, 유모차, 보호자 인계 시나리오를 항상 실행하세요.",
    ["아동", "영유아", "보호자", "미아"],
    true,
  );
  add(
    "non_korean_sentinel",
    "비한국어 방문객 센티널",
    "medium",
    hasAny(text, ["다국어", "English", "日本語", "中文"]) && hasAny(text, ["그림문자", "픽토그램", "통역"]),
    "한국어 데이터셋 밖의 방문객을 위해 다국어 문구, 그림문자, 통역·도움 요청 지점을 고정 점검하세요.",
    ["다국어", "English", "日本語", "中文", "그림문자", "통역"],
    true,
  );
  return findings;
}

export function personaCoverageScore(findings: PersonaSafetyFinding[]): number {
  const weights = { high: 3, medium: 2, low: 1 } as const;
  const total = findings.reduce((sum, finding) => sum + weights[finding.priority], 0);
  const covered = findings.filter((finding) => finding.status === "covered")
    .reduce((sum, finding) => sum + weights[finding.priority], 0);
  return total > 0 ? Math.round((covered / total) * 100) : 100;
}
