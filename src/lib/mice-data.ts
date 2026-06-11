import type { Strictness, VerificationStatus } from "./types.js";
import applicability from "../ontology/mice/mice-safety-applicability.json" with { type: "json" };
import lawRegistry from "../ontology/mice/law-registry.json" with { type: "json" };
import dutyMaster from "../ontology/mice/mice-duty-master.json" with { type: "json" };
import hazardControls from "../ontology/mice/hazard-controls.json" with { type: "json" };
import legalArticleOntology from "../ontology/mice/legal-article-ontology.json" with { type: "json" };
import legalAnnexOntology from "../ontology/mice/legal-annex-ontology.json" with { type: "json" };
import venueRules from "../ontology/mice/venue-safety-rules.json" with { type: "json" };
import kopisVenueDirectory from "../ontology/mice/kopis-venue-directory.json" with { type: "json" };
import sourceRegistry from "../ontology/mice/source-registry.json" with { type: "json" };
import workerSafetyReferences from "../ontology/mice/worker-safety-references.json" with { type: "json" };
import localOrdinancePack from "../ontology/mice/local-ordinance-pack.json" with { type: "json" };

export type EventTypeId =
  | "festival"
  | "exhibition"
  | "conference"
  | "performance"
  | "food_event"
  | "vip_event";

export interface LawArticle {
  article: string;
  title: string;
  dutyTypes: string[];
  summary: string;
  text?: string;
  verificationStatus: VerificationStatus;
}

export interface LawEntry {
  id: string;
  name: string;
  shortName: string;
  lawId?: string;
  mst?: string;
  ruleId?: string;
  serialNo?: string;
  promulgatedAt?: string;
  verificationStatus: VerificationStatus;
  appliesTo: string[];
  miceUse: string;
  articles: LawArticle[];
  sourceUrl: string;
}

export interface DutyEntry {
  id: string;
  title: string;
  eventTypes: string[];
  requiredWhen: string;
  strictness: Strictness;
  cycle: string;
  lawRefs: string[];
  sourceRefs: string[];
}

export interface HazardEntry {
  id: string;
  label: string;
  eventTypes: string[];
  triggers: string[];
  riskLevel: "high" | "medium" | "low";
  controls: string[];
  lawRefs: string[];
  sourceRefs: string[];
}

export interface EventTypeEntry {
  id: EventTypeId;
  label: string;
  matchFlags: string[];
  conditions: string[];
  conditionalLawIds: string[];
  dutyIds: string[];
  hazardIds: string[];
}

export interface FeatureRule {
  id: string;
  match: { flag?: string; field?: string; operator?: ">="; value?: number };
  label: string;
  lawIds: string[];
  dutyIds: string[];
  hazardIds: string[];
}

export interface SourceEntry {
  id: string;
  title: string;
  publisher: string;
  url: string;
  priority: string;
  coverage: string[];
  reuseCaution: string;
  documentFormat?: "pdf" | "hwp" | "html" | "mixed";
  localDocumentPath?: string;
  localMarkdownPath?: string;
  offlineTextStatus?: "extracted" | "ocr_required" | "offline_derived" | "pending" | "not_applicable";
  offlineExtracts?: string[];
  verificationStatus: VerificationStatus;
}

export interface LegalArticleOntologyEntry {
  id: string;
  lawEntryId: string;
  lawName: string;
  article: string;
  title: string;
  currentAsOf: string;
  sourceMst?: string;
  sourceLawId?: string;
  sourceUrl: string;
  text: string;
  dutyTypes: string[];
  appliesTo: string[];
  relatedDutyIds: string[];
  relatedHazardIds: string[];
  verificationStatus: VerificationStatus;
}

export interface LegalAnnexOntologyEntry {
  id: string;
  lawEntryId: string;
  lawName: string;
  annexType: "annex" | "form";
  annexNo: string;
  bylSeq: string;
  title: string;
  currentAsOf: string;
  sourceUrl: string;
  summary: string;
  checklistItems: string[];
  dutyTypes: string[];
  appliesTo: string[];
  relatedDutyIds: string[];
  relatedHazardIds: string[];
  verificationStatus: VerificationStatus;
}

export interface VenueRule {
  id: string;
  category: string;
  summary: string;
  checkpoints: string[];
  sourceRefs: string[];
  verificationStatus: VerificationStatus;
}

export interface VenueEntry {
  id: string;
  name: string;
  region: string;
  province?: string;
  city?: string;
  operator: string;
  website: string;
  sourceRefs: string[];
  facilityFacts?: string[];
  safetyProfile?: {
    offlineCoverage: string[];
    gaps: string[];
    lastReviewedAt: string;
  };
  spaces?: Array<{ id: string; name: string; facts: string[]; sourceUrl: string }>;
  rules: VenueRule[];
}

export interface KopisVenueEntry {
  venueId: string;
  name: string;
  sido: string;
  sigungu: string;
  jurisdiction: string;
  address: string;
  category: string;
  contact: string;
  sourceUrl: string;
}

export interface KopisVenueDirectory {
  provider: string;
  sourceUrl: string;
  resultCode: string;
  totalCount: number;
  fetchedCount: number;
  venues: KopisVenueEntry[];
}

export interface WorkerSafetyReference {
  id: string;
  kind: "law_article" | "kosha_guide";
  title: string;
  appliesWhen: string;
  dutyTypes: string[];
  relatedLawRefs: string[];
  relatedDutyIds: string[];
  relatedHazardIds: string[];
  summary: string;
  offlineSourcePath: string;
  sourceUrl: string;
  verificationStatus: VerificationStatus;
}

export interface LocalOrdinanceCategory {
  id: string;
  label: string;
  query: string;
  totalSearchHits: number;
  matchedRecords: number;
  eventTypes: string[];
  dutyIds: string[];
  hazardIds: string[];
}

export interface LocalOrdinanceArticleExtract {
  article: string;
  title: string;
  textExcerpt: string;
}

export interface LocalOrdinanceRecord {
  id: string;
  categoryId: string;
  category: string;
  categoryLabel: string;
  ordinanceName: string;
  eventTypes: string[];
  dutyIds: string[];
  hazardIds: string[];
  ordinSeq: string;
  name: string;
  jurisdiction: string;
  promulgatedAt: string;
  effectiveAt: string;
  sourceUrl: string;
  appliesWhen: string;
  crowdThreshold: string;
  threshold: string;
  thresholdStructured?: {
    kind: string;
    summary: string;
    minCrowd?: number | null;
    maxCrowdExclusive?: number | null;
    maxCrowdInclusive?: number | null;
    densityLimitPersonsPerSqm?: number | null;
    eventKinds?: string[];
    basis?: string;
    sourceArticles?: string[];
    rawPhrases?: string[];
    confidence: "article_structured" | "category_default" | "condition_based" | "needs_review";
    reviewNotes?: string[];
  };
  submissionDeadline: string;
  requiredPlanItems: string[];
  inspectionRules: string[];
  agencyCoordination: string[];
  insuranceOrLiability: string;
  relatedDuties: string[];
  relatedHazards: string[];
  roadOccupancySubtype?: string;
  outdoorAdvertisingTypes?: string[];
  structuredStatus: "article_extracted" | "category_default";
  articleExtracts: LocalOrdinanceArticleExtract[];
  verificationStatus: VerificationStatus;
  verificationChecks?: {
    source: string;
    articles: string;
    threshold: string;
    actionMapping: string;
  };
  sourceConfidence?: string;
}

export interface RankedLocalOrdinanceRecord extends LocalOrdinanceRecord {
  priorityScore: number;
  priorityBand: "primary" | "secondary" | "reference";
  priorityReasons: string[];
  matchedJurisdictionHints: string[];
}

export interface LocalOrdinanceArticlePattern {
  categoryId: string;
  commonArticleThemes: string[];
  miceDutyMapping: string[];
}

const VENUE_JURISDICTION_HINTS: Record<string, string[]> = {
  coex: ["서울특별시 강남구", "서울특별시"],
  setec: ["서울특별시 강남구", "서울특별시"],
  atcenter: ["서울특별시 서초구", "서울특별시"],
  kintex: ["경기도 고양시", "경기도"],
  suwon_convention_center: ["경기도 수원시", "경기도"],
  suwonmesse: ["경기도 수원시", "경기도"],
  bexco: ["부산광역시 해운대구", "부산광역시"],
  kdjcenter: ["광주광역시 서구", "광주광역시"],
  ueco: ["울산광역시 울주군", "울산광역시"],
  songdo_convensia: ["인천광역시 연수구", "인천광역시"],
  dcc: ["대전광역시 유성구", "대전광역시"],
  osco: ["경상북도 포항시", "경상북도"],
  exco: ["대구광역시 북구", "대구광역시"],
  hico: ["경상북도 경주시", "경상북도"],
  gumico: ["경상북도 구미시", "경상북도"],
  ceco: ["경상남도 창원시", "경상남도"],
  gsco: ["전북특별자치도 군산시", "전북특별자치도"],
  icc_jeju: ["제주특별자치도 서귀포시", "제주특별자치도"],
  yeosu_expo: ["전라남도 여수시", "전라남도"],
};

const lawData = lawRegistry as { version: string; generatedAt: string; laws: LawEntry[] };
const legalArticleData = legalArticleOntology as { version: string; generatedAt: string; articles: LegalArticleOntologyEntry[] };
const legalAnnexData = legalAnnexOntology as { version: string; generatedAt: string; annexes: LegalAnnexOntologyEntry[] };
const dutyData = dutyMaster as { version: string; generatedAt: string; duties: DutyEntry[] };
const hazardData = hazardControls as { version: string; generatedAt: string; hazards: HazardEntry[] };
const venueData = venueRules as { version: string; generatedAt: string; venues: VenueEntry[] };
const kopisVenueData = kopisVenueDirectory as KopisVenueDirectory;
const sourceData = sourceRegistry as { version: string; generatedAt: string; sources: SourceEntry[] };
const workerSafetyData = workerSafetyReferences as { version: string; generatedAt: string; references: WorkerSafetyReference[] };
const localOrdinanceData = localOrdinancePack as {
  version: string;
  generatedAt: string;
  sourceTool: string;
  storagePolicy: string;
  scope: string;
  categories: LocalOrdinanceCategory[];
  articlePatterns: LocalOrdinanceArticlePattern[];
  records: LocalOrdinanceRecord[];
};
const applicabilityData = applicability as {
  version: string;
  generatedAt: string;
  scope: string;
  commonLawIds: string[];
  eventTypes: EventTypeEntry[];
  featureRules: FeatureRule[];
};

export const MICE_DATA = {
  laws: lawData.laws,
  legalArticles: legalArticleData.articles,
  legalAnnexes: legalAnnexData.annexes,
  duties: dutyData.duties,
  hazards: hazardData.hazards,
  venues: venueData.venues,
  performanceVenues: kopisVenueData.venues,
  sources: sourceData.sources,
  workerSafetyReferences: workerSafetyData.references,
  localOrdinances: localOrdinanceData,
  applicability: applicabilityData,
} as const;

export function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function findLaws(ids: string[]): LawEntry[] {
  const idSet = new Set(ids);
  return MICE_DATA.laws.filter((law) => idSet.has(law.id));
}

export function findLegalArticlesByLawIds(ids: string[]): LegalArticleOntologyEntry[] {
  const idSet = new Set(ids);
  return MICE_DATA.legalArticles.filter((article) => idSet.has(article.lawEntryId));
}

export function findLegalArticles(filters: {
  lawEntryId?: string;
  dutyType?: string;
  appliesTo?: string;
  hazardId?: string;
}): LegalArticleOntologyEntry[] {
  return MICE_DATA.legalArticles.filter((article) => {
    if (filters.lawEntryId && article.lawEntryId !== filters.lawEntryId) return false;
    if (filters.dutyType && !article.dutyTypes.includes(filters.dutyType)) return false;
    if (filters.appliesTo && !article.appliesTo.includes(filters.appliesTo)) return false;
    if (filters.hazardId && !article.relatedHazardIds.includes(filters.hazardId)) return false;
    return true;
  });
}

export function findLegalAnnexes(filters: {
  lawEntryId?: string;
  dutyType?: string;
  appliesTo?: string;
  dutyId?: string;
  hazardId?: string;
  annexType?: "annex" | "form";
}): LegalAnnexOntologyEntry[] {
  return MICE_DATA.legalAnnexes.filter((annex) => {
    if (filters.lawEntryId && annex.lawEntryId !== filters.lawEntryId) return false;
    if (filters.dutyType && !annex.dutyTypes.includes(filters.dutyType)) return false;
    if (filters.appliesTo && !annex.appliesTo.includes(filters.appliesTo)) return false;
    if (filters.dutyId && !annex.relatedDutyIds.includes(filters.dutyId)) return false;
    if (filters.hazardId && !annex.relatedHazardIds.includes(filters.hazardId)) return false;
    if (filters.annexType && annex.annexType !== filters.annexType) return false;
    return true;
  });
}

export function findDuties(ids: string[]): DutyEntry[] {
  const idSet = new Set(ids);
  return MICE_DATA.duties.filter((duty) => idSet.has(duty.id));
}

export function findHazards(ids: string[]): HazardEntry[] {
  const idSet = new Set(ids);
  return MICE_DATA.hazards.filter((hazard) => idSet.has(hazard.id));
}

export function findSources(ids: string[]): SourceEntry[] {
  const idSet = new Set(ids);
  return MICE_DATA.sources.filter((source) => idSet.has(source.id));
}

export function findPerformanceVenue(venueId?: string): KopisVenueEntry | undefined {
  if (!venueId) return undefined;
  return MICE_DATA.performanceVenues.find((venue) => venue.venueId === venueId);
}

export function findWorkerSafetyReferences(filters: {
  dutyId?: string;
  hazardId?: string;
  lawId?: string;
  kind?: "law_article" | "kosha_guide";
}): WorkerSafetyReference[] {
  return MICE_DATA.workerSafetyReferences.filter((ref) => {
    if (filters.kind && ref.kind !== filters.kind) return false;
    if (filters.dutyId && !ref.relatedDutyIds.includes(filters.dutyId)) return false;
    if (filters.hazardId && !ref.relatedHazardIds.includes(filters.hazardId)) return false;
    if (filters.lawId && !ref.relatedLawRefs.some((lawRef) => lawRef.startsWith(`${filters.lawId}:`) || lawRef === filters.lawId)) return false;
    return true;
  });
}

export function normalizeEventTypeForLookup(eventType: string): string {
  return eventType === "outdoor_event" ? "festival" : eventType;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function isJurisdictionMatch(recordJurisdiction: string, jurisdictionHint: string): boolean {
  const record = normalizeText(recordJurisdiction);
  const hint = normalizeText(jurisdictionHint);
  return Boolean(record && hint && (record.includes(hint) || hint.includes(record)));
}

function uniqueStrings(items: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const value = item?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function jurisdictionHintsForVenue(venueId?: string): string[] {
  if (!venueId) return [];
  const fixedHints = VENUE_JURISDICTION_HINTS[venueId] ?? [];
  const performanceVenue = findPerformanceVenue(venueId);
  return uniqueStrings([
    ...fixedHints,
    performanceVenue?.jurisdiction,
    performanceVenue?.sido,
  ]);
}

function jurisdictionPriority(record: LocalOrdinanceRecord, hints: string[]): { score: number; reasons: string[]; matches: string[] } {
  const reasons: string[] = [];
  const matches = hints.filter((hint) => isJurisdictionMatch(record.jurisdiction, hint));
  if (matches.length === 0) return { score: 0, reasons, matches };

  const exactMatch = matches.find((hint) => normalizeText(record.jurisdiction) === normalizeText(hint));
  const cityMatch = matches.find((hint) => normalizeText(hint).includes(normalizeText(record.jurisdiction)) && normalizeText(record.jurisdiction).length > 5);
  const provinceMatch = matches.find((hint) => normalizeText(hint).includes(normalizeText(record.jurisdiction)));

  if (exactMatch) {
    reasons.push(`관할 지자체 정확 매칭: ${exactMatch}`);
    return { score: 500, reasons, matches };
  }
  if (cityMatch) {
    reasons.push(`기초/관할 후보 매칭: ${cityMatch}`);
    return { score: 430, reasons, matches };
  }
  if (provinceMatch) {
    reasons.push(`광역 지자체 매칭: ${provinceMatch}`);
    return { score: 330, reasons, matches };
  }
  reasons.push(`관할 후보 부분 매칭: ${matches[0]}`);
  return { score: 250, reasons, matches };
}

function categoryPriority(record: LocalOrdinanceRecord, filters: {
  eventType?: string;
  eventTypes?: string[];
  roadUse?: boolean;
  outdoor?: boolean;
  outdoorEvent?: boolean;
  temporaryStructures?: boolean;
}): { score: number; reasons: string[] } {
  const eventTypes = new Set([
    ...(filters.eventType ? [normalizeEventTypeForLookup(filters.eventType)] : []),
    ...(filters.eventTypes ?? []).map(normalizeEventTypeForLookup),
  ]);
  const isOutdoor = Boolean(filters.outdoor || filters.outdoorEvent || eventTypes.has("festival"));
  const isPerformance = eventTypes.has("performance");
  const isExhibition = eventTypes.has("exhibition");
  const reasons: string[] = [];
  let score = 0;

  if (isOutdoor && ["outdoor_event_safety", "regional_festival_safety"].includes(record.categoryId)) {
    score += 170;
    reasons.push("옥외/축제 안전 조례 우선");
  }
  if (filters.roadUse && record.categoryId === "road_occupancy") {
    score += 160;
    reasons.push("도로점용/교통통제 조건 매칭");
  } else if (!filters.roadUse && record.categoryId === "road_occupancy") {
    score -= 40;
    reasons.push("도로점용 플래그 없음: 후보로만 유지");
  }
  if ((isOutdoor || isPerformance || isExhibition || filters.temporaryStructures) && record.categoryId === "outdoor_advertising") {
    score += 80;
    reasons.push("현수막·배너·안내물 조건 후보");
  }
  if (record.structuredStatus === "article_extracted") {
    score += 30;
    reasons.push("조문 발췌 보유");
  }
  return { score, reasons };
}

export function findLocalOrdinances(filters: {
  categoryId?: string;
  jurisdiction?: string;
  venueId?: string;
  eventType?: string;
  eventTypes?: string[];
  dutyId?: string;
  hazardId?: string;
  query?: string;
  roadUse?: boolean;
  outdoor?: boolean;
  outdoorEvent?: boolean;
  temporaryStructures?: boolean;
  limit?: number;
}): RankedLocalOrdinanceRecord[] {
  const query = filters.query?.trim().toLocaleLowerCase("ko");
  const limit = filters.limit ?? 50;
  const eventTypes = new Set([
    ...(filters.eventType ? [normalizeEventTypeForLookup(filters.eventType)] : []),
    ...(filters.eventTypes ?? []).map(normalizeEventTypeForLookup),
  ]);
  const jurisdictionHints = uniqueStrings([
    filters.jurisdiction,
    ...jurisdictionHintsForVenue(filters.venueId),
  ]);
  const records = MICE_DATA.localOrdinances.records.filter((record) => {
    if (filters.categoryId && record.categoryId !== filters.categoryId) return false;
    if (eventTypes.size > 0 && !record.eventTypes.some((eventType) => eventTypes.has(normalizeEventTypeForLookup(eventType)))) return false;
    if (filters.dutyId && !record.dutyIds.includes(filters.dutyId)) return false;
    if (filters.hazardId && !record.hazardIds.includes(filters.hazardId)) return false;
    if (jurisdictionHints.length > 0) {
      if (!jurisdictionHints.some((hint) => isJurisdictionMatch(record.jurisdiction, hint))) return false;
    }
    if (query) {
      const haystack = `${record.name} ${record.jurisdiction} ${record.categoryLabel}`.toLocaleLowerCase("ko");
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  return records
    .map((record) => {
      const jurisdiction = jurisdictionPriority(record, jurisdictionHints);
      const category = categoryPriority(record, filters);
      const priorityScore = jurisdiction.score + category.score;
      const ranked: RankedLocalOrdinanceRecord = {
        ...record,
        priorityScore,
        priorityBand: priorityScore >= 500 ? "primary" : priorityScore >= 250 ? "secondary" : "reference",
        priorityReasons: [...jurisdiction.reasons, ...category.reasons],
        matchedJurisdictionHints: jurisdiction.matches,
      };
      return ranked;
    })
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      if (a.categoryId !== b.categoryId) return a.categoryId.localeCompare(b.categoryId);
      if (a.jurisdiction !== b.jurisdiction) return a.jurisdiction.localeCompare(b.jurisdiction, "ko");
      return a.name.localeCompare(b.name, "ko");
    })
    .slice(0, limit);
}

export function strictnessRank(strictness: Strictness): number {
  switch (strictness) {
    case "statutory_required":
      return 0;
    case "local_required":
      return 1;
    case "venue_required":
      return 2;
    case "administrative_rule":
      return 3;
    case "needs_review":
      return 4;
    case "common_best_practice":
      return 5;
  }
}

export function strictnessLabel(strictness: Strictness): string {
  const labels: Record<Strictness, string> = {
    statutory_required: "법정 의무",
    administrative_rule: "행정규칙/매뉴얼",
    local_required: "지자체·인허가 확인",
    venue_required: "베뉴 승인/규정",
    common_best_practice: "운영 모범관행",
    needs_review: "요건 검토 필요",
  };
  return labels[strictness];
}

export function verificationRank(status: VerificationStatus): number {
	switch (status) {
	  case "verified":
	  case "article_verified":
	  case "threshold_structured":
	    return 0;
	  case "law_verified":
	    return 1;
	  case "source_verified":
	    return 2;
	  case "summary_only":
	  case "offline_derived":
	    return 3;
	  case "needs_review":
	  case "needs_article_review":
	    return 3;
	  case "needs_source_review":
	    return 4;
	  case "obsolete_candidate":
	    return 5;
	  case "todo":
	    return 5;
	}
}
