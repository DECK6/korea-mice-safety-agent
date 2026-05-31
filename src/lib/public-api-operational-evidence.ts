import evidenceSnapshot from "../ontology/mice/public-api-operational-evidence.json" with { type: "json" };
import applicabilityRules from "../ontology/mice/public-api-applicability-rules.json" with { type: "json" };

type InputLike = {
  eventTypes?: string[];
  expectedCrowd?: number;
  outdoor?: boolean;
  outdoorEvent?: boolean;
  roadUse?: boolean;
  unhostedCrowd?: boolean;
  temporaryStructures?: boolean;
  setupTeardown?: boolean;
  workAtHeight?: boolean;
  heavyObjectHandling?: boolean;
  temporaryElectricity?: boolean;
  lpgUse?: boolean;
  foodService?: boolean;
  performance?: boolean;
  personalDataProcessing?: boolean;
  vipSecurity?: boolean;
  venueId?: string;
  jurisdiction?: string;
};

export interface PublicApiOperationalEvidenceSource {
  sourceId: string;
  label: string;
  phase: "P0" | "P1" | "P2";
  appliesTo: string[];
  recordType: string;
  liveProbeAt: string;
  currentAsOf: string;
  totalCount?: number;
  recordsSampled: number;
  sampleTitles: string[];
  operationalUse: string;
  planningActions: string[];
  limitations: string[];
  licensePolicy: string;
  sourceConfidence: string;
}

export interface PublicApiOperationalEvidenceBundle {
  generatedAt: string;
  verificationStatus: string;
  selectedSources: PublicApiOperationalEvidenceSource[];
  applicableLines: string[];
  actionLines: string[];
  cautionLines: string[];
}

interface PublicApiApplicabilityRule {
  sourceId: string;
  anyOf?: string[];
  allOf?: string[];
}

const snapshot = evidenceSnapshot as {
  generatedAt: string;
  verificationStatus: string;
  sources: PublicApiOperationalEvidenceSource[];
};

const rules = applicabilityRules as {
  rules: PublicApiApplicabilityRule[];
};

function hasEvent(input: InputLike, eventType: string): boolean {
  return (input.eventTypes ?? []).includes(eventType);
}

function isOutdoor(input: InputLike): boolean {
  return Boolean(input.outdoor || input.outdoorEvent || hasEvent(input, "festival") || hasEvent(input, "outdoor_event"));
}

function isPerformance(input: InputLike): boolean {
  return Boolean(input.performance || hasEvent(input, "performance"));
}

function hasFood(input: InputLike): boolean {
  return Boolean(input.foodService || input.lpgUse || hasEvent(input, "food_event"));
}

function hasWorkerExposure(input: InputLike): boolean {
  return Boolean(
    input.setupTeardown ||
    input.temporaryStructures ||
    input.temporaryElectricity ||
    input.workAtHeight ||
    input.heavyObjectHandling,
  );
}

function isLargeCrowd(input: InputLike): boolean {
  return typeof input.expectedCrowd === "number" && input.expectedCrowd >= 1000;
}

function inputFacts(input: InputLike): Set<string> {
  const facts = new Set<string>();
  if (input.venueId) facts.add("venue");
  if (hasEvent(input, "conference")) facts.add("conference");
  if (hasEvent(input, "exhibition")) facts.add("exhibition");
  if (isPerformance(input)) facts.add("performance");
  if (isOutdoor(input)) facts.add("outdoor");
  if (input.roadUse === true) facts.add("roadUse");
  if (input.temporaryStructures === true) facts.add("temporaryStructures");
  if (input.unhostedCrowd === true) facts.add("unhostedCrowd");
  if (hasFood(input)) facts.add("food");
  if (hasWorkerExposure(input)) facts.add("workerExposure");
  if (isLargeCrowd(input)) facts.add("largeCrowd");
  if (String(input.jurisdiction ?? "").includes("서울")) facts.add("seoulJurisdiction");
  return facts;
}

function matchesRule(rule: PublicApiApplicabilityRule, facts: Set<string>): boolean {
  const allOf = rule.allOf ?? [];
  const anyOf = rule.anyOf ?? [];
  if (allOf.some((fact) => !facts.has(fact))) return false;
  if (anyOf.length === 0) return true;
  return anyOf.some((fact) => facts.has(fact));
}

function shouldUseSource(source: PublicApiOperationalEvidenceSource, input: InputLike): boolean {
  const rule = rules.rules.find((item) => item.sourceId === source.sourceId);
  if (!rule) return false;
  return matchesRule(rule, inputFacts(input));
}

function formatSample(source: PublicApiOperationalEvidenceSource): string {
  const total = typeof source.totalCount === "number" ? ` / live total ${source.totalCount.toLocaleString("ko-KR")}건` : "";
  const samples = source.sampleTitles.length > 0 ? ` / 예시: ${source.sampleTitles.slice(0, 3).join(", ")}` : "";
  return `${source.label}(${source.sourceId}, ${source.phase}, ${source.currentAsOf}${total}${samples})`;
}

export function buildPublicApiOperationalEvidence(input: InputLike): PublicApiOperationalEvidenceBundle {
  const selectedSources = snapshot.sources.filter((source) => shouldUseSource(source, input));
  const applicableLines = selectedSources.map((source) => `${formatSample(source)}: ${source.operationalUse}`);
  const actionLines = selectedSources.flatMap((source) => source.planningActions.map((action) => `[${source.sourceId}] ${action}`));
  const cautionLines = [
    "공공 API 증거는 법령·조례 근거가 아니라 운영 판단 보조자료다. 최종 제출·협의 전 최신 API 재조회, 관할기관 확인, 베뉴 승인조건 확인이 필요하다.",
    ...selectedSources.flatMap((source) => source.limitations.map((limitation) => `[${source.sourceId}] ${limitation}`)),
  ];

  return {
    generatedAt: snapshot.generatedAt,
    verificationStatus: snapshot.verificationStatus,
    selectedSources,
    applicableLines,
    actionLines,
    cautionLines,
  };
}
