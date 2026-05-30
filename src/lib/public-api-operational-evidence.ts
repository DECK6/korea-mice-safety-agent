import evidenceSnapshot from "../ontology/mice/public-api-operational-evidence.json" with { type: "json" };

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

const snapshot = evidenceSnapshot as {
  generatedAt: string;
  verificationStatus: string;
  sources: PublicApiOperationalEvidenceSource[];
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

function shouldUseSource(source: PublicApiOperationalEvidenceSource, input: InputLike): boolean {
  const appliesTo = new Set(source.appliesTo);
  if (source.sourceId === "KCISA_KOPIS_PERFORMANCE_FACILITY") {
    return Boolean(input.venueId || isPerformance(input) || hasEvent(input, "conference") || hasEvent(input, "exhibition"));
  }
  if (source.sourceId === "KOPIS_PERFORMANCE_CATALOG") return isPerformance(input);
  if (source.sourceId === "TOUR_API_EVENT_CATALOG") return isOutdoor(input) || input.roadUse === true;
  if (source.sourceId === "NEMC_EMERGENCY_MEDICAL" || source.sourceId === "NEMC_AED") {
    return isLargeCrowd(input) || isOutdoor(input) || isPerformance(input) || hasFood(input);
  }
  if (source.sourceId === "FOOD_SAFETY_KOREA") return hasFood(input);
  if (source.sourceId === "KMA_APIHUB_WEATHER") {
    return isOutdoor(input) || isPerformance(input) || input.temporaryStructures === true || hasWorkerExposure(input);
  }
  if (source.sourceId === "SEOUL_REALTIME_CITY_DATA") {
    return Boolean(input.unhostedCrowd || isOutdoor(input) || isLargeCrowd(input)) && String(input.jurisdiction ?? "").includes("서울");
  }
  if (source.sourceId === "AIRKOREA_AIR_QUALITY") return isOutdoor(input);
  return [...appliesTo].some((value) => value && JSON.stringify(input).includes(value));
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
