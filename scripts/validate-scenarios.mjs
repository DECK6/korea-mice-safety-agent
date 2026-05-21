#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixturePath = join(root, "data/scenarios/mice-event-scenarios.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const validationEnv = { ...process.env, MICE_LOCAL_DIR: join(root, "data/.validation-store") };

function runVenueCorpusValidation() {
  execFileSync(
    process.execPath,
    [join(root, "scripts/validate-venue-corpus.mjs")],
    { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, env: validationEnv },
  );
  return JSON.parse(readFileSync(join(root, "data/venue-corpus-audit-report.json"), "utf8"));
}

function callApplicability(input) {
  const out = execFileSync(
    process.execPath,
    [join(root, "build/cli.js"), "call", "query_mice_safety_applicability", "--inputJson", JSON.stringify(input)],
    { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, env: validationEnv },
  );
  return JSON.parse(out).structuredContent;
}

function callTool(toolName, input) {
  const out = execFileSync(
    process.execPath,
    [join(root, "build/cli.js"), "call", toolName, "--inputJson", JSON.stringify(input)],
    { cwd: root, encoding: "utf8", maxBuffer: 30 * 1024 * 1024, env: validationEnv },
  );
  return JSON.parse(out);
}

function ids(items) {
  return new Set((items ?? []).map((item) => item.id));
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

function expectContains(kind, actualSet, expected, failures) {
  for (const id of expected ?? []) {
    if (!actualSet.has(id)) failures.push(`${kind}:${id}`);
  }
}

function expectAbsent(kind, actualSet, unexpected, failures) {
  for (const id of unexpected ?? []) {
    if (actualSet.has(id)) failures.push(`unexpected_${kind}:${id}`);
  }
}

function zipLooksValid(filePath) {
  const buffer = readFileSync(filePath);
  if (buffer.length < 1024 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;
  try {
    execFileSync("unzip", ["-t", filePath], { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

function validateOntologyMaturity() {
  const failures = [];
  const lawRegistry = readJson("src/ontology/mice/law-registry.json");
  const legalArticles = readJson("src/ontology/mice/legal-article-ontology.json").articles ?? [];
  const localOrdinances = readJson("src/ontology/mice/local-ordinance-pack.json").records ?? [];
  const duties = readJson("src/ontology/mice/mice-duty-master.json").duties ?? [];
  const hazards = readJson("src/ontology/mice/hazard-controls.json").hazards ?? [];
  const applicability = readJson("src/ontology/mice/mice-safety-applicability.json");
  const laws = new Set((lawRegistry.laws ?? []).map((law) => law.id));
  const legalDutyTypes = new Set(legalArticles.flatMap((article) => article.dutyTypes ?? []));
  const requiredDutyTypes = [
    "plan_submission",
    "permit_check",
    "inspection",
    "staff_deployment",
    "training",
    "evacuation",
    "fire_prevention",
    "crowd_control",
    "medical_response",
    "worker_safety",
    "privacy_notice",
    "incident_report",
    "recordkeeping",
  ];
  for (const dutyType of requiredDutyTypes) {
    if (!legalDutyTypes.has(dutyType)) failures.push(`missing_legal_duty_type:${dutyType}`);
  }

  const requiredEventTypes = ["festival", "exhibition", "conference", "performance", "food_event", "vip_event"];
  const applicabilityEventTypes = new Set((applicability.eventTypes ?? []).map((item) => item.id));
  for (const eventType of requiredEventTypes) {
    if (!applicabilityEventTypes.has(eventType)) failures.push(`missing_applicability_event_type:${eventType}`);
  }
  const featureRuleIds = new Set((applicability.featureRules ?? []).map((item) => item.id));
  for (const ruleId of ["unhosted_crowd_rule", "road_use_rule", "temporary_structure_rule", "setup_teardown_worker_rule", "lpg_use_rule"]) {
    if (!featureRuleIds.has(ruleId)) failures.push(`missing_feature_rule:${ruleId}`);
  }

  const requiredLegalFields = ["lawOrOrdinanceName", "sourceId", "sourceUrl", "article", "dutyTypes", "relatedDutyIds", "relatedHazardIds", "verificationStatus", "sourceConfidence"];
  for (const article of legalArticles) {
    for (const field of requiredLegalFields) {
      if (article[field] === undefined || article[field] === "" || (Array.isArray(article[field]) && article[field].length === 0)) {
        failures.push(`legal_article_field:${article.id}:${field}`);
      }
    }
    if (!["verified", "needs_review", "summary_only", "obsolete_candidate"].includes(article.verificationStatus)) {
      failures.push(`legal_article_verification:${article.id}:${article.verificationStatus}`);
    }
  }

  const requiredOrdinanceFields = [
    "jurisdiction",
    "category",
    "lawOrOrdinanceName",
    "ordinSeq",
    "sourceUrl",
    "sourceId",
    "effectiveAt",
    "appliesWhen",
    "crowdThreshold",
    "threshold",
    "submissionDeadline",
    "requiredPlanItems",
    "inspectionRules",
    "agencyCoordination",
    "insuranceOrLiability",
    "relatedDuties",
    "relatedHazards",
    "articleExtracts",
    "verificationStatus",
    "sourceConfidence",
  ];
  for (const record of localOrdinances) {
    for (const field of requiredOrdinanceFields) {
      if (record[field] === undefined || record[field] === "" || (Array.isArray(record[field]) && field !== "articleExtracts" && record[field].length === 0)) {
        failures.push(`ordinance_field:${record.id}:${field}`);
      }
    }
    if (!["verified", "needs_review", "summary_only", "obsolete_candidate"].includes(record.verificationStatus)) {
      failures.push(`ordinance_verification:${record.id}:${record.verificationStatus}`);
    }
  }
  const categoryCounts = {};
  for (const record of localOrdinances) {
    categoryCounts[record.categoryId] ??= [];
    categoryCounts[record.categoryId].push(record);
  }
  if ((categoryCounts.regional_festival_safety ?? []).length < 1) failures.push("ordinance_category:regional_festival_safety");
  if ((categoryCounts.outdoor_event_safety ?? []).length < 100) failures.push("ordinance_category:outdoor_event_safety");
  if ((categoryCounts.road_occupancy ?? []).length < 100) failures.push("ordinance_category:road_occupancy");
  if ((categoryCounts.outdoor_advertising ?? []).length < 100) failures.push("ordinance_category:outdoor_advertising");

  const dutyIds = new Set(duties.map((duty) => duty.id));
  const hazardIds = new Set(hazards.map((hazard) => hazard.id));
  for (const hazard of hazards) {
    if ((hazard.controls ?? []).length === 0) failures.push(`hazard_controls:${hazard.id}`);
    if ((hazard.lawRefs ?? []).length === 0) failures.push(`hazard_law_refs:${hazard.id}`);
    if ((hazard.sourceRefs ?? []).length === 0) failures.push(`hazard_source_refs:${hazard.id}`);
    for (const lawRef of hazard.lawRefs ?? []) {
      const lawId = String(lawRef).split(":")[0];
      if (!laws.has(lawId)) failures.push(`hazard_unknown_law:${hazard.id}:${lawId}`);
    }
  }
  for (const duty of duties) {
    if ((duty.lawRefs ?? []).length === 0 && (duty.sourceRefs ?? []).length === 0) failures.push(`duty_no_basis:${duty.id}`);
    for (const lawRef of duty.lawRefs ?? []) {
      const lawId = String(lawRef).split(":")[0];
      if (!laws.has(lawId)) failures.push(`duty_unknown_law:${duty.id}:${lawId}`);
    }
  }
  for (const record of localOrdinances) {
    for (const dutyId of record.relatedDuties ?? []) if (!dutyIds.has(dutyId)) failures.push(`ordinance_unknown_duty:${record.id}:${dutyId}`);
    for (const hazardId of record.relatedHazards ?? []) if (!hazardIds.has(hazardId)) failures.push(`ordinance_unknown_hazard:${record.id}:${hazardId}`);
  }

  const riskAreaCoverage = {
    crowd: ["crowd_density_high"],
    ingress_egress: ["ingress_egress_bottleneck"],
    evacuation: ["blocked_evacuation_route"],
    fire: ["fire_hazard_hot_work_lpg"],
    temporary_electricity: ["temporary_electrical_fire_shock"],
    stage_rigging_booth: ["temporary_structure_collapse"],
    worker_fall: ["worker_fall_height"],
    heavy_object: ["heavy_object_handling"],
    food_safety: ["food_poisoning"],
    medical: ["medical_emergency"],
    weather: ["weather_outdoor_event"],
    privacy: ["personal_data_cctv_privacy"],
    security: ["security_access_control_gap"],
    unhosted: ["unhosted_crowd_governance_gap"],
  };
  for (const [area, ids] of Object.entries(riskAreaCoverage)) {
    if (!ids.some((id) => hazardIds.has(id))) failures.push(`risk_area:${area}`);
  }

  if (failures.length > 0) {
    console.error(`FAIL ontology_maturity ${failures.slice(0, 20).join(" ")}`);
    return 1;
  }
  console.log(`PASS ontology_maturity legalArticles=${legalArticles.length} ordinances=${localOrdinances.length} hazards=${hazards.length} duties=${duties.length}`);
  return 0;
}

let failed = 0;
const rows = [];

const venueCorpusAudit = runVenueCorpusValidation();
if (
  venueCorpusAudit.counts?.errors > 0
  || venueCorpusAudit.counts?.warnings > 0
  || venueCorpusAudit.counts?.manifestItems < 15
  || venueCorpusAudit.counts?.venues < 19
  || venueCorpusAudit.counts?.facilityEntries < 5000
  || !(venueCorpusAudit.manifestItems ?? []).some((item) => item.format === "hwp" && item.chars > 1000)
  || (venueCorpusAudit.findings ?? []).some((finding) => finding.category === "corpus_scope" && finding.severity === "error")
) {
  console.error("FAIL venue_corpus_audit");
  failed += 1;
} else {
  console.log(`PASS venue_corpus_audit venues=${venueCorpusAudit.counts.venues} docs=${venueCorpusAudit.counts.manifestItems} entries=${venueCorpusAudit.counts.facilityEntries} warnings=${venueCorpusAudit.counts.warnings}`);
}

failed += validateOntologyMaturity();

for (const scenario of fixture.scenarios) {
  const result = callApplicability(scenario.input);
  const failures = [];

  expectContains("law", ids(result.laws), scenario.expected.laws, failures);
  expectContains("duty", ids(result.duties), scenario.expected.duties, failures);
  expectContains("hazard", ids(result.hazards), scenario.expected.hazards, failures);

  const minVenueRules = scenario.expected.venueRulesMin ?? 0;
  if ((result.venueRules ?? []).length < minVenueRules) {
    failures.push(`venueRules:${result.venueRules.length}<${minVenueRules}`);
  }

  if ((scenario.input.setupTeardown || scenario.input.temporaryStructures || scenario.input.workAtHeight) && (result.workerSafetyReferences ?? []).length === 0) {
    failures.push("workerSafetyReferences:0");
  }

  const coreNeedsReview = (result.needsReview ?? []).filter((item) => {
    const expectedLaws = new Set(scenario.expected.laws ?? []);
    return expectedLaws.has(item.id);
  });
  if (coreNeedsReview.length > 0) {
    failures.push(`needsReview:${coreNeedsReview.map((item) => item.id).join(",")}`);
  }

  if (failures.length > 0) failed += 1;
  rows.push({
    id: scenario.id,
    status: failures.length > 0 ? "FAIL" : "PASS",
    laws: result.laws?.length ?? 0,
    duties: result.duties?.length ?? 0,
    hazards: result.hazards?.length ?? 0,
    venueRules: result.venueRules?.length ?? 0,
    failures,
  });
}

for (const row of rows) {
  const detail = row.failures.length > 0 ? ` ${row.failures.join(" ")}` : "";
  console.log(`${row.status} ${row.id} laws=${row.laws} duties=${row.duties} hazards=${row.hazards} venueRules=${row.venueRules}${detail}`);
}

const negativeCases = [
  {
    id: "negative_outdoor_festival_without_performance",
    input: {
      eventTypes: ["festival"],
      expectedCrowd: 1500,
      outdoorEvent: true,
      roadUse: false,
      foodService: false,
      lpgUse: false,
      setupTeardown: false,
      temporaryStructures: false,
      temporaryElectricity: false,
    },
    absentLaws: ["performance_act", "food_sanitation_act", "lp_gas_safety_act"],
    absentDuties: ["performance_disaster_countermeasure_plan", "temporary_food_business_and_poisoning_plan", "worker_safety_work_plan"],
  },
  {
    id: "negative_indoor_conference_without_road_or_food_or_worker_setup",
    input: {
      eventTypes: ["conference"],
      expectedCrowd: 300,
      roadUse: false,
      foodService: false,
      lpgUse: false,
      setupTeardown: false,
      temporaryStructures: false,
      temporaryElectricity: false,
      workAtHeight: false,
      heavyObjectHandling: false,
    },
    absentLaws: ["road_act", "road_traffic_act", "outdoor_advertisements_act", "food_sanitation_act", "lp_gas_safety_act", "performance_act"],
    absentDuties: ["road_traffic_and_outdoor_signage_permit", "temporary_food_business_and_poisoning_plan", "performance_disaster_countermeasure_plan", "worker_safety_work_plan"],
  },
  {
    id: "negative_indoor_exhibition_without_road_use",
    input: {
      eventTypes: ["exhibition"],
      venueId: "coex",
      expectedCrowd: 800,
      roadUse: false,
      temporaryStructures: true,
      temporaryElectricity: true,
      setupTeardown: true,
    },
    absentLaws: ["road_act", "road_traffic_act"],
    absentDuties: ["road_traffic_and_outdoor_signage_permit"],
  },
];

for (const testCase of negativeCases) {
  const result = callApplicability(testCase.input);
  const failures = [];
  expectAbsent("law", ids(result.laws), testCase.absentLaws, failures);
  expectAbsent("duty", ids(result.duties), testCase.absentDuties, failures);
  if (failures.length > 0) {
    failed += 1;
    console.error(`FAIL ${testCase.id} ${failures.join(" ")}`);
  } else {
    console.log(`PASS ${testCase.id}`);
  }
}

const localOrdinanceResult = callTool("query_mice_local_ordinances", {
  jurisdiction: "경기도 고양시",
  eventType: "festival",
  roadUse: true,
  outdoorEvent: true,
  limit: 20,
}).structuredContent;

const localRecords = localOrdinanceResult.records ?? [];
if (localRecords.length === 0) {
  console.error("FAIL local_ordinance_lookup records=0");
  failed += 1;
} else if (!["경기도 고양시", "경기도"].includes(localRecords[0].jurisdiction) || typeof localRecords[0].priorityScore !== "number" || localRecords[0].priorityScore <= 0) {
  console.error(`FAIL local_ordinance_priority first=${localRecords[0].jurisdiction} score=${localRecords[0].priorityScore}`);
  failed += 1;
} else {
  console.log(`PASS local_ordinance_lookup records=${localRecords.length} first=${localRecords[0].jurisdiction} score=${localRecords[0].priorityScore}`);
}

const legalPackChecks = [
  ["performance_act_enforcement_decree", 4],
  ["performance_act_enforcement_rule", 1],
  ["food_sanitation_act_enforcement_rule", 1],
  ["lp_gas_safety_act_enforcement_rule", 3],
  ["road_act_enforcement_decree", 1],
  ["outdoor_advertisements_act_enforcement_decree", 4],
  ["fire_prevention_act_enforcement_decree", 1],
  ["fire_facilities_act_enforcement_decree", 1],
  ["emergency_medical_service_act_enforcement_decree", 1],
  ["emergency_medical_service_act_enforcement_rule", 3],
  ["building_act_enforcement_decree", 4],
  ["personal_information_protection_act", 6],
  ["personal_information_protection_act_enforcement_decree", 5],
  ["security_services_industry_act", 4],
  ["security_services_industry_act_enforcement_decree", 4],
  ["security_services_industry_act_enforcement_rule", 1],
];

for (const [lawEntryId, minArticles] of legalPackChecks) {
  const result = callTool("query_mice_legal_articles", { lawEntryId }).structuredContent;
  const articles = result.articles ?? [];
  if (articles.length < minArticles) {
    console.error(`FAIL legal_article_pack ${lawEntryId} articles=${articles.length}<${minArticles}`);
    failed += 1;
  } else {
    console.log(`PASS legal_article_pack ${lawEntryId} articles=${articles.length}`);
  }
}

const legalAnnexChecks = [
  ["performance_act_enforcement_decree", 2],
  ["performance_act_enforcement_rule", 1],
  ["food_sanitation_act_enforcement_rule", 1],
  ["lp_gas_safety_act_enforcement_rule", 8],
  ["road_act_enforcement_decree", 1],
  ["road_act_enforcement_rule", 5],
  ["building_act_enforcement_rule", 3],
  ["fire_prevention_act_enforcement_decree", 2],
  ["fire_facilities_act_enforcement_decree", 4],
  ["emergency_medical_service_act_enforcement_rule", 4],
  ["security_services_industry_act_enforcement_decree", 2],
  ["security_services_industry_act_enforcement_rule", 2],
];

for (const [lawEntryId, minAnnexes] of legalAnnexChecks) {
  const result = callTool("query_mice_legal_annexes", { lawEntryId }).structuredContent;
  const annexes = result.annexes ?? [];
  if (annexes.length < minAnnexes) {
    console.error(`FAIL legal_annex_pack ${lawEntryId} annexes=${annexes.length}<${minAnnexes}`);
    failed += 1;
  } else {
    console.log(`PASS legal_annex_pack ${lawEntryId} annexes=${annexes.length}`);
  }
}

const venueProfile = callTool("query_mice_venue_safety_rules", {
  venueId: "setec",
}).structuredContent.venues?.[0]?.facilityProfile;

if (!venueProfile || (venueProfile.sourceSpans ?? []).length === 0 || (venueProfile.floorLoad ?? []).length === 0 || (venueProfile.electricity ?? []).length === 0) {
  console.error("FAIL venue_facility_index missing sourceSpans/floorLoad/electricity");
  failed += 1;
} else {
  console.log(`PASS venue_facility_index sourceSpans=${venueProfile.sourceSpans.length}`);
}

const venueFacilityPlanResult = callTool("generate_mice_safety_plan", {
  eventName: "검증용 SETEC 전시회",
  eventTypes: ["exhibition"],
  venueId: "setec",
  expectedCrowd: 1200,
  temporaryStructures: true,
  temporaryElectricity: true,
  setupTeardown: true,
  heavyObjectHandling: true,
}).structuredContent;
const venueFacilityPlan = venueFacilityPlanResult.documentBundle?.venueFacilityPlan ?? "";
const venueFacilityNeedles = ["베뉴 시설·수용", "바닥하중", "반입·하역", "전기", "소방·피난", "근거 위치"];
const missingVenueFacilityNeedles = venueFacilityNeedles.filter((needle) => !venueFacilityPlan.includes(needle));
if (missingVenueFacilityNeedles.length > 0) {
  console.error(`FAIL venue_facility_plan missing=${missingVenueFacilityNeedles.join(",")}`);
  failed += 1;
} else {
  console.log("PASS venue_facility_plan");
}

const planResult = callTool("generate_mice_safety_plan", {
  eventName: "검증용 옥외축제",
  eventTypes: ["festival", "food_event"],
  jurisdiction: "경기도 고양시",
  expectedCrowd: 5000,
  outdoorEvent: true,
  roadUse: true,
  temporaryStructures: true,
  temporaryElectricity: true,
  setupTeardown: true,
  workAtHeight: true,
  heavyObjectHandling: true,
  lpgUse: true,
  foodService: true,
}).structuredContent;

const planMarkdown = planResult.planMarkdown ?? "";
const planNeedles = ["안전관리계획서", "지자체 조례", "우선 적용 조례 후보", "참고 후보", "조례 우선순위", "설치·철거 작업자 안전", "산업안전보건기준", "별표·서식", "수용인원", "응급의료·AED", "관리책임자", "구급차", "도로·교통 실행계획", "교통통제 도면", "비상차량 접근로", "셔틀·택시·버스 승하차", "옥외광고물", "원상복구", "도로공사 시행 허가 신청서", "통행의 금지", "가설건축물", "피난안전 확인서", "완성, 정기", "검사증명서", "가스용기 반입대장", "누설점검", "밸브 차단", "화기 사용 즉시 중지", "냉장·보온 온도기록", "보존식 라벨", "판매중지", "제출·협의 체크리스트", "제출/확인처", "도로관리청/교통부서", "가스공급자/검사기관", "현장 운영 런시트", "개장 승인 hold point", "피크 T-30", "폐장 T-30", "사고보고서 템플릿", "다국어 방문객 안전 안내문", "roadside event area", "道路隣接エリア", "道路邻近区域"];
const missingPlanNeedles = planNeedles.filter((needle) => !planMarkdown.includes(needle));
if (missingPlanNeedles.length > 0) {
  console.error(`FAIL safety_plan_generation missing=${missingPlanNeedles.join(",")}`);
  failed += 1;
} else {
  console.log("PASS safety_plan_generation");
}

const nonPerformancePlanResult = callTool("generate_mice_safety_plan", {
  eventName: "비공연 옥외축제",
  eventTypes: ["festival", "food_event"],
  jurisdiction: "경기도 고양시",
  expectedCrowd: 5000,
  outdoorEvent: true,
  roadUse: true,
  foodService: true,
  lpgUse: true,
}).structuredContent;
const nonPerformanceAnnexText = (nonPerformancePlanResult.sections?.legalAnnexes ?? []).join("\n");
if (/공연법 시행령|공연법 시행규칙|공연 재해대처계획/.test(nonPerformanceAnnexText)) {
  console.error("FAIL safety_plan_annex_filter unexpected_performance_annex");
  failed += 1;
} else {
  console.log("PASS safety_plan_annex_filter non_performance_excludes_performance_annex");
}

const performancePlanResult = callTool("generate_mice_safety_plan", {
  eventName: "공연 포함 행사",
  eventTypes: ["performance"],
  expectedCrowd: 12000,
  performance: true,
  temporaryStructures: true,
  temporaryElectricity: true,
  setupTeardown: true,
}).structuredContent;
const performancePlanMarkdown = performancePlanResult.planMarkdown ?? "";
const performanceStageDoc = performancePlanResult.documentBundle?.performanceStagePlan ?? "";
const performanceAnnexText = (performancePlanResult.sections?.legalAnnexes ?? []).join("\n");
const performanceStageNeedles = ["공연·무대 실행계획", "현장 실행 상태표", "공연 재해대처계획", "무대·트러스 구조검토", "리깅 승인", "방염확인서", "스탠딩 펜스", "공연중지 기준", "무대감독", "아티스트/무대감독 중지 신호", "전원 차단", "관객 현 위치 대기"];
const missingPerformanceStageNeedles = performanceStageNeedles.filter((needle) => !performancePlanMarkdown.includes(needle) && !performanceStageDoc.includes(needle));
const performanceReview = callTool("review_mice_safety_plan", {
  eventName: "공연 포함 행사",
  eventTypes: ["performance"],
  expectedCrowd: 12000,
  performance: true,
  temporaryStructures: true,
  temporaryElectricity: true,
  setupTeardown: true,
}).structuredContent;
if (!/공연법 시행령|공연법 시행규칙/.test(performanceAnnexText)) {
  console.error("FAIL safety_plan_annex_filter missing_performance_annex");
  failed += 1;
} else if (
  missingPerformanceStageNeedles.length > 0
  || performanceReview.verdict === "needs_revision"
  || !(performanceReview.documentCoverageMatrix ?? []).some((row) => row.documentId === "performance_stage_execution_plan" && row.requirement === "required" && row.status === "present")
) {
  console.error(`FAIL performance_stage_execution missing=${missingPerformanceStageNeedles.join(",")} verdict=${performanceReview.verdict}`);
  failed += 1;
} else {
  console.log(`PASS safety_plan_annex_filter performance_includes_performance_annex stage=${performanceReview.verdict}`);
}

const noZoneVisitorNoticePlanResult = callTool("generate_mice_safety_plan", {
  eventName: "검증용 실내 컨퍼런스",
  eventTypes: ["conference"],
  expectedCrowd: 500,
}).structuredContent;
const noZoneVisitorNoticeMarkdown = noZoneVisitorNoticePlanResult.documentBundle?.visitorSafetyNotices ?? noZoneVisitorNoticePlanResult.planMarkdown ?? "";
const noZoneVisitorNoticeReview = callTool("review_mice_safety_plan", {
  planMarkdown: noZoneVisitorNoticePlanResult.planMarkdown,
  eventName: "검증용 실내 컨퍼런스",
  eventTypes: ["conference"],
  expectedCrowd: 500,
}).structuredContent;
if (
  noZoneVisitorNoticeMarkdown.includes("구역 구역")
  || noZoneVisitorNoticeMarkdown.includes("area area")
  || noZoneVisitorNoticeMarkdown.includes("エリアエリア")
  || noZoneVisitorNoticeMarkdown.includes("区域区域")
  || !noZoneVisitorNoticeMarkdown.includes("the affected area")
  || !noZoneVisitorNoticeMarkdown.includes("該当エリア")
  || !noZoneVisitorNoticeMarkdown.includes("相关区域")
  || (noZoneVisitorNoticeReview.findings ?? []).some((finding) => finding.requirementId === "REQ_VISITOR_NOTICE_QUALITY")
) {
  console.error("FAIL visitor_notice_generic_zone_quality");
  failed += 1;
} else {
  console.log("PASS visitor_notice_generic_zone_quality");
}

const vipPrivacyPlanResult = callTool("generate_mice_safety_plan", {
  eventName: "검증용 VIP 컨벤션",
  eventTypes: ["conference", "vip_event"],
  expectedCrowd: 800,
  personalDataProcessing: true,
  vipSecurity: true,
}).structuredContent;
const vipPrivacyPlanMarkdown = vipPrivacyPlanResult.planMarkdown ?? "";
const vipNeedles = ["개인정보보호법 시행령", "처리방침", "수탁자", "접속기록", "경비업법 시행령", "경비지도사", "경비원 명부", "배치신고"];
const missingVipNeedles = vipNeedles.filter((needle) => !vipPrivacyPlanMarkdown.includes(needle));
if (missingVipNeedles.length > 0) {
  console.error(`FAIL vip_privacy_security_plan missing=${missingVipNeedles.join(",")}`);
  failed += 1;
} else {
  console.log("PASS vip_privacy_security_plan");
}

const vipPrivacyReview = callTool("review_mice_safety_plan", {
  eventName: "검증용 VIP 컨벤션",
  eventTypes: ["conference", "vip_event"],
  expectedCrowd: 800,
  personalDataProcessing: true,
  vipSecurity: true,
}).structuredContent;
if (vipPrivacyReview.verdict === "needs_revision") {
  console.error(`FAIL vip_privacy_security_review verdict=${vipPrivacyReview.verdict}`);
  failed += 1;
} else {
  console.log(`PASS vip_privacy_security_review verdict=${vipPrivacyReview.verdict}`);
}

const reviewResult = callTool("review_mice_safety_plan", {
  eventName: "검증용 옥외축제",
  eventTypes: ["festival", "food_event"],
  jurisdiction: "경기도 고양시",
  expectedCrowd: 5000,
  outdoorEvent: true,
  roadUse: true,
  temporaryStructures: true,
  temporaryElectricity: true,
  setupTeardown: true,
  workAtHeight: true,
  heavyObjectHandling: true,
  lpgUse: true,
  foodService: true,
}).structuredContent;
const visitorNoticeReviewResult = callTool("review_mice_safety_plan", {
  planMarkdown: "# 외부 계획서\n\n## 행사 개요\n- 행사명: 외부행사\n\n## 적용 법령\n- 지자체 조례 확인\n\n## 제출·협의 체크리스트\n| No | 제출/확인처 | 문서/서식 | 조건 | 기한/시점 | 근거/메모 | 상태 |\n| --- | --- | --- | --- | --- | --- | --- |\n| 1 | 지자체 | 안전관리계획서 | 옥외행사 | 행사 전 | 조례 | open |\n\n## 증빙·기록\n- 기록 보존",
  eventTypes: ["festival"],
  expectedCrowd: 5000,
  outdoorEvent: true,
}).structuredContent;

if (reviewResult.verdict === "needs_revision") {
  console.error(`FAIL safety_plan_review verdict=${reviewResult.verdict}`);
  for (const finding of reviewResult.findings ?? []) {
    if (finding.severity === "error") console.error(`  ${finding.category}: ${finding.message}`);
  }
  failed += 1;
} else if (!(visitorNoticeReviewResult.findings ?? []).some((finding) => finding.requirementId === "REQ_VISITOR_NOTICE")) {
  console.error("FAIL safety_plan_review missing_visitor_notice_check");
  failed += 1;
} else if (!(reviewResult.documentCoverageMatrix ?? []).some((row) => row.documentId === "worker_safety_plan" && row.requirement === "required" && row.status === "present")) {
  console.error("FAIL safety_plan_review coverage_worker_safety");
  failed += 1;
} else if (!(reviewResult.documentCoverageMatrix ?? []).some((row) => row.documentId === "visitor_safety_notices" && row.requirement === "required" && row.status === "present")) {
  console.error("FAIL safety_plan_review coverage_visitor_notice");
  failed += 1;
} else if (!(reviewResult.documentCoverageMatrix ?? []).some((row) => row.documentId === "operations_runsheet" && row.requirement === "required" && row.status === "present")) {
  console.error("FAIL safety_plan_review coverage_operations_runsheet");
  failed += 1;
} else if (!(reviewResult.documentCoverageMatrix ?? []).some((row) => row.documentId === "road_traffic_control_plan" && row.requirement === "required" && row.status === "present")) {
  console.error("FAIL safety_plan_review coverage_road_traffic_control_plan");
  failed += 1;
} else if (!(visitorNoticeReviewResult.documentCoverageMatrix ?? []).some((row) => row.documentId === "visitor_safety_notices" && row.status === "missing")) {
  console.error("FAIL safety_plan_review coverage_missing_visitor_notice");
  failed += 1;
} else {
  console.log(`PASS safety_plan_review verdict=${reviewResult.verdict}`);
}

const unhostedPlanResult = callTool("generate_mice_safety_plan", {
  eventName: "검증용 무주최 다중운집",
  eventTypes: ["outdoor_event"],
  jurisdiction: "서울특별시 중구",
  location: "역세권 광장 및 상권 연결부",
  expectedCrowd: 10000,
  outdoorEvent: true,
  unhostedCrowd: true,
  roadUse: false,
  foodService: false,
  lpgUse: false,
  performance: false,
  setupTeardown: false,
  temporaryStructures: false,
}).structuredContent;
const unhostedPlanMarkdown = unhostedPlanResult.planMarkdown ?? "";
const unhostedDoc = unhostedPlanResult.documentBundle?.unhostedCrowdResponsePlan ?? "";
const unhostedNeedles = [
  "무주최 다중운집 관계기관 공동대응계획",
  "주최자 없음",
  "공동 현장지휘",
  "관계기관 합동상황반",
  "지자체 재난안전상황실",
  "경찰 현장지휘",
  "소방 현장지휘",
  "시설관리자",
  "교통 운영기관",
  "관찰",
  "주의",
  "경계",
  "심각",
  "해산·분산",
  "전광판",
];
const missingUnhostedNeedles = unhostedNeedles.filter((needle) => !unhostedPlanMarkdown.includes(needle) && !unhostedDoc.includes(needle));
const unhostedReview = callTool("review_mice_safety_plan", {
  eventName: "검증용 무주최 다중운집",
  eventTypes: ["outdoor_event"],
  jurisdiction: "서울특별시 중구",
  expectedCrowd: 10000,
  outdoorEvent: true,
  unhostedCrowd: true,
  roadUse: false,
}).structuredContent;
if (
  missingUnhostedNeedles.length > 0
  || unhostedReview.verdict !== "usable"
  || !(unhostedReview.documentCoverageMatrix ?? []).some((row) => row.documentId === "unhosted_crowd_response_plan" && row.requirement === "required" && row.status === "present")
  || (unhostedReview.findings ?? []).some((finding) => finding.requirementId === "REQ_BUILDING_EGRESS")
  || !(unhostedReview.findings ?? []).every((finding) => !["REQ_UNHOSTED_CROWD_RESPONSE", "REQ_UNHOSTED_CROWD_RACI"].includes(finding.requirementId) || finding.severity !== "error")
) {
  console.error(`FAIL unhosted_crowd_response missing=${missingUnhostedNeedles.join(",")} verdict=${unhostedReview.verdict}`);
  failed += 1;
} else {
  console.log(`PASS unhosted_crowd_response verdict=${unhostedReview.verdict}`);
}

const exportResult = callTool("export_mice_safety_plan_bundle", {
  eventName: "검증용 옥외축제",
  eventTypes: ["festival", "food_event"],
  jurisdiction: "경기도 고양시",
  expectedCrowd: 5000,
  outdoorEvent: true,
  roadUse: true,
  temporaryStructures: true,
  temporaryElectricity: true,
  setupTeardown: true,
  workAtHeight: true,
  heavyObjectHandling: true,
  lpgUse: true,
  foodService: true,
  outputDir: join(root, "data/.validation-store/plan-export"),
}).structuredContent;
const unhostedExportResult = callTool("export_mice_safety_plan_bundle", {
  eventName: "검증용 무주최 다중운집",
  eventTypes: ["outdoor_event"],
  jurisdiction: "서울특별시 중구",
  location: "역세권 광장 및 상권 연결부",
  expectedCrowd: 10000,
  outdoorEvent: true,
  unhostedCrowd: true,
  roadUse: false,
  outputDir: join(root, "data/.validation-store/unhosted-plan-export"),
}).structuredContent;
const privacySecurityExportResult = callTool("export_mice_safety_plan_bundle", {
  eventName: "검증용 VIP 컨벤션",
  eventTypes: ["conference", "vip_event"],
  expectedCrowd: 800,
  personalDataProcessing: true,
  vipSecurity: true,
  outputDir: join(root, "data/.validation-store/privacy-package-export"),
}).structuredContent;
const performanceExportResult = callTool("export_mice_safety_plan_bundle", {
  eventName: "검증용 공연",
  eventTypes: ["performance"],
  expectedCrowd: 12000,
  performance: true,
  temporaryStructures: true,
  temporaryElectricity: true,
  setupTeardown: true,
  outputDir: join(root, "data/.validation-store/performance-plan-export"),
}).structuredContent;
const datedExportResult = callTool("export_mice_safety_plan_bundle", {
  eventName: "검증용 날짜기반 옥외축제",
  eventDate: "2026-06-20",
  eventTypes: ["festival", "food_event"],
  jurisdiction: "경기도 고양시",
  expectedCrowd: 5000,
  outdoorEvent: true,
  roadUse: true,
  foodService: true,
  lpgUse: true,
  temporaryStructures: true,
  setupTeardown: true,
  outputDir: join(root, "data/.validation-store/dated-plan-export"),
}).structuredContent;
const visitorNoticeExportPath = join(root, "data/.validation-store/plan-export/15-visitor-safety-notices.md");
const visitorNoticeExportMarkdown = readFileSync(visitorNoticeExportPath, "utf8");
const operationsRunsheetPath = join(root, "data/.validation-store/plan-export/16-operations-runsheet.md");
const operationsRunsheetMarkdown = readFileSync(operationsRunsheetPath, "utf8");
const operationsRunsheetCsv = readFileSync(join(root, "data/.validation-store/plan-export/operations-runsheet.csv"), "utf8");
const foodLpgChecklistPath = join(root, "data/.validation-store/plan-export/06-food-lpg-checklist.md");
const foodLpgMarkdown = readFileSync(foodLpgChecklistPath, "utf8");
const foodLpgExecutionCsv = readFileSync(join(root, "data/.validation-store/plan-export/food-lpg-execution.csv"), "utf8");
const roadTrafficPath = join(root, "data/.validation-store/plan-export/19-road-traffic-control-plan.md");
const roadTrafficMarkdown = readFileSync(roadTrafficPath, "utf8");
const roadTrafficCsv = readFileSync(join(root, "data/.validation-store/plan-export/road-traffic-control-plan.csv"), "utf8");
const submissionSchedulePath = join(root, "data/.validation-store/plan-export/18-submission-raci-calendar.md");
const submissionScheduleMarkdown = readFileSync(submissionSchedulePath, "utf8");
const submissionScheduleCsv = readFileSync(join(root, "data/.validation-store/plan-export/submission-raci-calendar.csv"), "utf8");
const packageIndexPath = join(root, "data/.validation-store/plan-export/submission-packages/package-index.csv");
const localGovernmentPackagePath = join(root, "data/.validation-store/plan-export/submission-packages/01-local-government-package.md");
const agencyPackagePath = join(root, "data/.validation-store/plan-export/submission-packages/03-fire-police-medical-package.md");
const workerPackagePath = join(root, "data/.validation-store/plan-export/submission-packages/04-worker-contractor-package.md");
const packageIndexCsv = readFileSync(packageIndexPath, "utf8");
const localGovernmentPackageMarkdown = readFileSync(localGovernmentPackagePath, "utf8");
const agencyPackageMarkdown = readFileSync(agencyPackagePath, "utf8");
const workerPackageMarkdown = readFileSync(workerPackagePath, "utf8");
const privacyVenuePackageMarkdown = readFileSync(join(root, "data/.validation-store/privacy-package-export/submission-packages/02-venue-package.md"), "utf8");
const privacySecurityPackageMarkdown = readFileSync(join(root, "data/.validation-store/privacy-package-export/submission-packages/05-privacy-security-package.md"), "utf8");
const privacyPackageIndexCsv = readFileSync(join(root, "data/.validation-store/privacy-package-export/submission-packages/package-index.csv"), "utf8");
const unhostedExportMarkdown = readFileSync(join(root, "data/.validation-store/unhosted-plan-export/20-unhosted-crowd-response-plan.md"), "utf8");
const unhostedExportCsv = readFileSync(join(root, "data/.validation-store/unhosted-plan-export/unhosted-crowd-response-plan.csv"), "utf8");
const unhostedOperationsRunsheetMarkdown = readFileSync(join(root, "data/.validation-store/unhosted-plan-export/16-operations-runsheet.md"), "utf8");
const unhostedLocalGovernmentPackageMarkdown = readFileSync(join(root, "data/.validation-store/unhosted-plan-export/submission-packages/01-local-government-package.md"), "utf8");
const unhostedAgencyPackageMarkdown = readFileSync(join(root, "data/.validation-store/unhosted-plan-export/submission-packages/03-fire-police-medical-package.md"), "utf8");
const performanceStageExportMarkdown = readFileSync(join(root, "data/.validation-store/performance-plan-export/21-performance-stage-execution-plan.md"), "utf8");
const performanceStageExecutionCsv = readFileSync(join(root, "data/.validation-store/performance-plan-export/performance-stage-execution.csv"), "utf8");
const datedSubmissionScheduleMarkdown = readFileSync(join(root, "data/.validation-store/dated-plan-export/18-submission-raci-calendar.md"), "utf8");
const datedSubmissionScheduleCsv = readFileSync(join(root, "data/.validation-store/dated-plan-export/submission-raci-calendar.csv"), "utf8");
const datedOperationsRunsheetMarkdown = readFileSync(join(root, "data/.validation-store/dated-plan-export/16-operations-runsheet.md"), "utf8");

if (
  datedExportResult.review?.verdict === "needs_revision"
  || !datedSubmissionScheduleMarkdown.includes("- 행사일: 2026-06-20")
  || !datedSubmissionScheduleCsv.includes("2026-05-30")
  || !datedSubmissionScheduleCsv.includes("2026-06-15 최종 제출 확인")
  || !datedOperationsRunsheetMarkdown.includes("2026-06-19")
  || !datedOperationsRunsheetMarkdown.includes("2026-06-20")
  || !(datedExportResult.submissionSchedule ?? []).some((row) => row.recommendedDueDate === "2026-05-30" && String(row.finalCheckpoint ?? "").includes("2026-06-15"))
) {
  console.error("FAIL submission_schedule_event_date_alias");
  failed += 1;
} else {
  console.log("PASS submission_schedule_event_date_alias");
}

if (
  (exportResult.files ?? []).length < 12
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("daily-safety-checklist.csv"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("submission-checklist.csv"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("15-visitor-safety-notices.md"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("visitor-safety-notices.csv"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("16-operations-runsheet.md"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("operations-runsheet.csv"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("19-road-traffic-control-plan.md"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("road-traffic-control-plan.csv"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("food-lpg-execution.csv"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("20-unhosted-crowd-response-plan.md"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("unhosted-crowd-response-plan.csv"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("17-review-summary.md"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("review-coverage-matrix.csv"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("review-findings.csv"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("18-submission-raci-calendar.md"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("submission-raci-calendar.csv"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("submission-packages/package-index.csv"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("submission-packages/01-local-government-package.md"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("submission-packages/03-fire-police-medical-package.md"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("submission-packages/04-worker-contractor-package.md"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("safety-plan.docx"))
  || !(exportResult.files ?? []).some((file) => String(file).endsWith("safety-checklists.xlsx"))
  || !zipLooksValid(join(root, "data/.validation-store/plan-export/safety-checklists.xlsx"))
  || !(privacySecurityExportResult.files ?? []).some((file) => String(file).endsWith("submission-packages/05-privacy-security-package.md"))
  || !(performanceExportResult.files ?? []).some((file) => String(file).endsWith("21-performance-stage-execution-plan.md"))
  || !(performanceExportResult.files ?? []).some((file) => String(file).endsWith("performance-stage-execution.csv"))
  || exportResult.visitorNoticeCount < 5
  || !(exportResult.visitorNoticeLanguages ?? []).includes("en")
  || exportResult.review?.verdict === "needs_revision"
  || !(exportResult.review?.documentCoverageMatrix ?? []).some((row) => row.documentId === "visitor_safety_notices" && row.status === "present")
  || !(exportResult.review?.documentCoverageMatrix ?? []).some((row) => row.documentId === "operations_runsheet" && row.status === "present")
  || !(exportResult.review?.documentCoverageMatrix ?? []).some((row) => row.documentId === "road_traffic_control_plan" && row.status === "present")
  || exportResult.operationsRunsheetCount < 12
  || exportResult.submissionScheduleCount < 8
  || !(exportResult.submissionSchedule ?? []).some((row) => row.document?.includes("옥외행사") && row.responsible === "안전총괄")
  || !(exportResult.submissionSchedule ?? []).some((row) => row.document?.includes("임시 식품영업") && row.responsible === "F&B 담당")
  || !(exportResult.submissionSchedule ?? []).some((row) => row.document?.includes("소방·피난") && row.responsible === "시설·방재 담당")
  || exportResult.submissionPackages?.length < 4
  || !packageIndexCsv.includes("local_government")
  || !packageIndexCsv.includes("Sharing Scope")
  || !packageIndexCsv.includes("limited_external")
  || !localGovernmentPackageMarkdown.includes("제출·협의 체크리스트")
  || !localGovernmentPackageMarkdown.includes("현장 운영 런시트")
  || !localGovernmentPackageMarkdown.includes("도로·교통 실행계획")
  || !agencyPackageMarkdown.includes("현장 운영 런시트")
  || !agencyPackageMarkdown.includes("도로·교통 실행계획")
  || !localGovernmentPackageMarkdown.includes("## 제출 일정·RACI")
  || !localGovernmentPackageMarkdown.includes("T-21 착수 / T-5 최종제출")
  || !agencyPackageMarkdown.includes("응급의료·AED")
  || !workerPackageMarkdown.includes("설치·철거 작업자 안전계획서")
  || !workerPackageMarkdown.includes("공유등급: contractor / limited_external")
  || !workerPackageMarkdown.includes("작업계획서/교육명단/PPE 지급")
  || !workerPackageMarkdown.includes("[공유범위 제한] 관계기관 직접 연락망")
  || !privacyPackageIndexCsv.includes("restricted_internal")
  || !privacyVenuePackageMarkdown.includes("[공유범위 제한] 개인정보/CCTV/등록 세부")
  || !privacySecurityPackageMarkdown.includes("접속기록")
  || !submissionScheduleMarkdown.includes("제출 일정·RACI·증빙 매트릭스")
  || !submissionScheduleMarkdown.includes("필수 증빙")
  || !submissionScheduleMarkdown.includes("행사일 입력 시 계산")
  || !submissionScheduleCsv.includes("권장기한")
  || !submissionScheduleCsv.includes("교통·대외협력 담당")
  || !submissionScheduleCsv.includes("F&B 담당")
  || !operationsRunsheetMarkdown.includes("현장 운영 런시트")
  || !operationsRunsheetMarkdown.includes("개장 승인 hold point")
  || !operationsRunsheetMarkdown.includes("폐장 T-30")
  || !operationsRunsheetMarkdown.includes("통제구간·승하차장·주차장")
  || !operationsRunsheetMarkdown.includes("도로·교통통제 구역")
  || !operationsRunsheetMarkdown.includes("냉장·보온 온도기록")
  || !operationsRunsheetMarkdown.includes("가스용기 반입대장")
  || !operationsRunsheetMarkdown.includes("누설점검")
  || !operationsRunsheetCsv.includes("피크 T-30~T+30")
  || !operationsRunsheetCsv.includes("운영본부 기록담당")
  || !foodLpgMarkdown.includes("현장 실행 상태표")
  || !foodLpgMarkdown.includes("부적합 조치")
  || !foodLpgMarkdown.includes("냉장·보온 온도기록")
  || !foodLpgMarkdown.includes("가스용기 반입대장")
  || !foodLpgMarkdown.includes("누설점검")
  || !foodLpgMarkdown.includes("화기 사용 즉시 중지")
  || !foodLpgMarkdown.includes("조치 전후 사진")
  || !foodLpgExecutionCsv.includes("단계,시점,대상,점검항목,판정,부적합 조치,증빙")
  || !foodLpgExecutionCsv.includes("냉장·보온 온도기록")
  || !foodLpgExecutionCsv.includes("가스용기 반입대장")
  || !foodLpgExecutionCsv.includes("누설점검")
  || !roadTrafficMarkdown.includes("도로·교통 실행계획")
  || !roadTrafficMarkdown.includes("교통통제 도면")
  || !roadTrafficMarkdown.includes("비상차량 접근로")
  || !roadTrafficMarkdown.includes("셔틀·택시·버스 승하차")
  || !roadTrafficMarkdown.includes("옥외광고물·안내표지")
  || !roadTrafficMarkdown.includes("원상복구")
  || !roadTrafficCsv.includes("교통통제 도면")
  || !(unhostedExportResult.files ?? []).some((file) => String(file).endsWith("20-unhosted-crowd-response-plan.md"))
  || !(unhostedExportResult.review?.documentCoverageMatrix ?? []).some((row) => row.documentId === "unhosted_crowd_response_plan" && row.status === "present")
  || !unhostedExportMarkdown.includes("무주최 다중운집 관계기관 공동대응계획")
  || !unhostedExportMarkdown.includes("공동 현장지휘")
  || !unhostedExportMarkdown.includes("교통 운영기관")
  || !unhostedExportCsv.includes("주최자 없음")
  || !unhostedLocalGovernmentPackageMarkdown.includes("무주최 다중운집 관계기관 공동대응계획")
  || !unhostedAgencyPackageMarkdown.includes("관계기관 합동상황반")
  || !performanceStageExportMarkdown.includes("공연·무대 실행계획")
  || !performanceStageExportMarkdown.includes("공연중지 기준")
  || !performanceStageExecutionCsv.includes("무대·트러스 구조검토")
  || !performanceStageExecutionCsv.includes("아티스트/무대감독 중지 신호")
  || visitorNoticeExportMarkdown.includes("구역 구역")
  || visitorNoticeExportMarkdown.includes("area area")
  || visitorNoticeExportMarkdown.includes("エリアエリア")
  || visitorNoticeExportMarkdown.includes("区域区域")
  || !visitorNoticeExportMarkdown.includes("roadside event area")
) {
  console.error("FAIL safety_plan_bundle_export");
  failed += 1;
} else {
  console.log(`PASS safety_plan_bundle_export files=${exportResult.files.length}`);
}

const runsheetInitResult = callTool("initialize_mice_runsheet_execution", {
  eventName: "검증용 런시트 행사",
  eventTypes: ["festival", "food_event"],
  jurisdiction: "경기도 고양시",
  expectedCrowd: 5000,
  outdoorEvent: true,
  roadUse: true,
  foodService: true,
  lpgUse: true,
  operationsRunsheetMarkdown,
  source: "validation-export-runsheet",
}).structuredContent;
const runsheetTarget = (runsheetInitResult.items ?? []).find((item) => String(item.task ?? "").includes("개장 승인 hold point"))
  ?? (runsheetInitResult.items ?? [])[0];
const runsheetUpdateResult = runsheetTarget
  ? callTool("update_mice_runsheet_execution", {
    itemId: runsheetTarget.id,
    status: "blocked",
    note: "개장 승인 전 관계기관 현장 확인 지연",
    updatedBy: "안전총괄",
    createIssue: true,
    createAction: true,
    severity: "medium",
    assignee: "운영총괄",
  }).structuredContent
  : {};
const runsheetQueryResult = callTool("query_mice_runsheet_execution", {
  eventName: "검증용 런시트 행사",
  status: "blocked",
  includeDone: false,
}).structuredContent;
const runsheetDashboardResult = callTool("query_mice_operations_dashboard", {
  eventName: "검증용 런시트 행사",
  dueSoonMinutes: 30,
}).structuredContent;
const runsheetDashboardExportResult = callTool("export_mice_operations_dashboard", {
  eventName: "검증용 런시트 행사",
  dueSoonMinutes: 30,
  outputDir: join(root, "data/.validation-store/runsheet-dashboard-export"),
}).structuredContent;

if (
  (runsheetInitResult.items ?? []).length < 12
  || !runsheetTarget?.id
  || runsheetUpdateResult.item?.status !== "blocked"
  || !runsheetUpdateResult.createdIssue?.id
  || !runsheetUpdateResult.createdAction?.id
  || runsheetQueryResult.summary?.blocked < 1
  || runsheetDashboardResult.runsheetSummary?.blocked < 1
  || !(runsheetDashboardResult.timeline ?? []).some((entry) => entry.eventType === "runsheet_updated")
  || !(runsheetDashboardExportResult.files ?? []).some((file) => String(file).endsWith("operations-dashboard.xlsx"))
  || !zipLooksValid(join(root, "data/.validation-store/runsheet-dashboard-export/operations-dashboard.xlsx"))
  || runsheetDashboardExportResult.dashboard?.runsheetSummary?.blocked < 1
) {
  console.error("FAIL operations_runsheet_execution");
  failed += 1;
} else {
  console.log(`PASS operations_runsheet_execution items=${runsheetInitResult.items.length} blocked=${runsheetQueryResult.summary.blocked}`);
}

const gasRunsheetTarget = (runsheetInitResult.items ?? []).find((item) => /가스용기|누설점검|밸브/.test(String(item.task ?? "")));
const gasRunsheetUpdateResult = gasRunsheetTarget
  ? callTool("update_mice_runsheet_execution", {
    itemId: gasRunsheetTarget.id,
    status: "blocked",
    note: "LPG 반입 누설점검 부적합",
    updatedBy: "F&B 담당",
    createIssue: true,
    createAction: true,
    severity: "high",
    assignee: "가스 담당",
  }).structuredContent
  : {};
const foodRunsheetTarget = (runsheetInitResult.items ?? []).find((item) => /냉장·보온|보존식|판매중지/.test(String(item.task ?? "")));
const foodRunsheetUpdateResult = foodRunsheetTarget
  ? callTool("update_mice_runsheet_execution", {
    itemId: foodRunsheetTarget.id,
    status: "blocked",
    note: "보존식 라벨과 냉장·보온 온도기록 누락",
    updatedBy: "F&B 담당",
    createIssue: true,
    createAction: true,
    severity: "medium",
    assignee: "식음료 담당",
  }).structuredContent
  : {};
if (
  !gasRunsheetTarget?.id
  || gasRunsheetUpdateResult.createdIssue?.issueType !== "gas_lpg"
  || gasRunsheetUpdateResult.createdIssue?.recommendedTeam !== "가스·소방팀"
  || gasRunsheetUpdateResult.createdAction?.team !== "가스·소방팀"
  || !foodRunsheetTarget?.id
  || foodRunsheetUpdateResult.createdIssue?.issueType !== "food_safety"
  || foodRunsheetUpdateResult.createdIssue?.recommendedTeam !== "식음료 안전팀"
  || foodRunsheetUpdateResult.createdAction?.team !== "식음료 안전팀"
) {
  console.error(`FAIL food_lpg_runsheet_execution gas=${gasRunsheetUpdateResult.createdIssue?.issueType} food=${foodRunsheetUpdateResult.createdIssue?.issueType}`);
  failed += 1;
} else {
  console.log(`PASS food_lpg_runsheet_execution gas=${gasRunsheetUpdateResult.createdIssue.issueType} food=${foodRunsheetUpdateResult.createdIssue.issueType}`);
}

const unhostedRunsheetInitResult = callTool("initialize_mice_runsheet_execution", {
  eventName: "검증용 무주최 다중운집",
  eventTypes: ["outdoor_event"],
  jurisdiction: "서울특별시 중구",
  expectedCrowd: 10000,
  outdoorEvent: true,
  unhostedCrowd: true,
  roadUse: false,
  operationsRunsheetMarkdown: unhostedOperationsRunsheetMarkdown,
  source: "validation-unhosted-runsheet",
}).structuredContent;
const unhostedRunsheetTarget = (unhostedRunsheetInitResult.items ?? []).find((item) => String(item.task ?? "").includes("관찰/주의/경계/심각"))
  ?? (unhostedRunsheetInitResult.items ?? []).find((item) => String(item.owner ?? "").includes("합동상황반"));
const unhostedRunsheetUpdateResult = unhostedRunsheetTarget
  ? callTool("update_mice_runsheet_execution", {
    itemId: unhostedRunsheetTarget.id,
    status: "escalated",
    note: "역사 출입구 포화로 관계기관 공동 현장지휘 전환",
    updatedBy: "관계기관 합동상황반",
    createIssue: true,
    createAction: true,
    severity: "high",
    assignee: "합동상황반장",
  }).structuredContent
  : {};
const unhostedDashboardResult = callTool("query_mice_operations_dashboard", {
  eventName: "검증용 무주최 다중운집",
  dueSoonMinutes: 30,
}).structuredContent;
if (
  !unhostedRunsheetTarget?.id
  || unhostedRunsheetUpdateResult.item?.status !== "escalated"
  || unhostedRunsheetUpdateResult.createdIssue?.issueType !== "unhosted_crowd_surge"
  || unhostedRunsheetUpdateResult.createdIssue?.recommendedTeam !== "관계기관 합동상황반"
  || !(unhostedDashboardResult.timeline ?? []).some((entry) => String(entry.detail ?? "").includes("무주최") || String(entry.actor ?? "").includes("합동상황반"))
) {
  console.error("FAIL unhosted_runsheet_execution");
  failed += 1;
} else {
  console.log(`PASS unhosted_runsheet_execution issueType=${unhostedRunsheetUpdateResult.createdIssue.issueType}`);
}

const performanceRunsheetInitResult = callTool("initialize_mice_runsheet_execution", {
  eventName: "검증용 공연",
  eventTypes: ["performance"],
  expectedCrowd: 12000,
  performance: true,
  temporaryStructures: true,
  temporaryElectricity: true,
  setupTeardown: true,
  operationsRunsheetMarkdown: readFileSync(join(root, "data/.validation-store/performance-plan-export/16-operations-runsheet.md"), "utf8"),
  source: "validation-performance-runsheet",
}).structuredContent;
const performanceRunsheetTarget = (performanceRunsheetInitResult.items ?? []).find((item) => /공연중지 기준|무대감독|무대 전면 압박|리깅 승인/.test(String(item.task ?? "")));
const performanceRunsheetUpdateResult = performanceRunsheetTarget
  ? callTool("update_mice_runsheet_execution", {
    itemId: performanceRunsheetTarget.id,
    status: "escalated",
    note: "무대 전면 압박과 무대감독 중지 신호 확인 필요",
    updatedBy: "공연안전 담당",
    createIssue: true,
    createAction: true,
    severity: "high",
    assignee: "무대감독",
  }).structuredContent
  : {};
if (
  !performanceRunsheetTarget?.id
  || performanceRunsheetUpdateResult.createdIssue?.issueType !== "stage_rigging_structure"
  || performanceRunsheetUpdateResult.createdIssue?.recommendedTeam !== "공연·무대 안전팀"
  || performanceRunsheetUpdateResult.createdAction?.team !== "공연·무대 안전팀"
) {
  console.error(`FAIL performance_runsheet_execution issueType=${performanceRunsheetUpdateResult.createdIssue?.issueType}`);
  failed += 1;
} else {
  console.log(`PASS performance_runsheet_execution issueType=${performanceRunsheetUpdateResult.createdIssue.issueType}`);
}

const issueResult = callTool("register_mice_safety_issue", {
  eventName: "검증용 옥외축제",
  issueType: "crowd_bottleneck",
  severity: "high",
  description: "B게이트 대기열이 보행동선을 침범함",
  zone: "B게이트",
  relatedHazards: ["ingress_egress_bottleneck", "crowd_density_high"],
}).structuredContent;

const issueId = issueResult.issue?.id;
const evidenceResult = callTool("record_mice_evidence", {
  issueId,
  evidenceType: "note",
  description: "운영본부 현장 확인 메모",
}).structuredContent;
const actionResult = callTool("assign_mice_staff_action", {
  issueId,
  title: "B게이트 대기열 우회동선 설치",
  assignee: "구역장",
}).structuredContent;
const commandDecisionResult = callTool("record_mice_command_decision", {
  eventName: "검증용 옥외축제",
  issueId,
  decisionType: "event_pause",
  level: "partial",
  reason: "B게이트 병목으로 주 출입 동선을 재정비할 때까지 해당 게이트 입장을 일시중지",
  decidedBy: "안전총괄",
  zone: "B게이트",
  notifyTargets: ["운영본부", "B게이트 구역장", "보안팀", "의료팀"],
  conditionsForResume: ["대기열이 보행동선 밖으로 이동", "우회동선 안내 완료", "보안스태프 추가 배치"],
}).structuredContent;
const communicationTemplateResult = callTool("query_mice_communication_templates", {
  decisionType: "event_pause",
  channel: "staff_radio",
  eventName: "검증용 옥외축제",
  zone: "B게이트",
  reason: "B게이트 병목",
  resumeConditions: ["대기열 분리", "우회동선 안내", "보안스태프 추가 배치"],
}).structuredContent;
const visitorNoticeResult = callTool("generate_mice_visitor_notice", {
  decisionType: "event_pause",
  eventName: "검증용 옥외축제",
  zone: "B게이트",
  reason: "대기열 병목",
  languages: ["ko", "en", "ja", "zh"],
}).structuredContent;
const dashboardResult = callTool("query_mice_operations_dashboard", {
  eventName: "검증용 옥외축제",
  dueSoonMinutes: 30,
}).structuredContent;
const resolveCommandDecisionResult = callTool("resolve_mice_command_decision", {
  commandDecisionId: commandDecisionResult.commandDecision?.id,
  resolutionType: "event_resume",
  reason: "우회동선 안내와 보안스태프 추가 배치 완료로 B게이트 입장 재개",
  decidedBy: "안전총괄",
  conditionsMet: ["대기열 분리", "우회동선 안내", "보안스태프 추가 배치"],
}).structuredContent;
const dashboardAfterResolveResult = callTool("query_mice_operations_dashboard", {
  eventName: "검증용 옥외축제",
  dueSoonMinutes: 30,
}).structuredContent;
const dashboardExportResult = callTool("export_mice_operations_dashboard", {
  eventName: "검증용 옥외축제",
  dueSoonMinutes: 30,
  outputDir: join(root, "data/.validation-store/operations-dashboard-export"),
}).structuredContent;
const completeResult = callTool("complete_mice_action", {
  actionId: actionResult.action?.id,
  completedBy: "구역장",
  completionNote: "안전펜스와 안내스태프 2명 추가 배치",
  evidenceIds: [evidenceResult.evidence?.id],
}).structuredContent;
const reportResult = callTool("generate_mice_incident_report", {
  issueId,
}).structuredContent;
const situationBriefResult = callTool("generate_mice_situation_brief", {
  issueId,
  audience: "multi_agency",
  preparedBy: "운영본부",
  contactPoint: "운영본부",
}).structuredContent;
const situationBriefByEventResult = callTool("generate_mice_situation_brief", {
  eventName: "검증용 옥외축제",
  audience: "multi_agency",
  preparedBy: "운영본부",
  contactPoint: "운영본부",
}).structuredContent;

if (
  issueResult.issue?.recommendedTeam !== "인파·동선팀"
  || issueResult.issue?.dispatchPriority !== "high"
  || typeof issueResult.issue?.responseSlaMinutes !== "number"
  || !issueResult.issue?.firstResponseDueAt
  || actionResult.action?.team !== "인파·동선팀"
  || actionResult.action?.priority !== "high"
  || !actionResult.action?.dueAt
  || commandDecisionResult.commandDecision?.decisionType !== "event_pause"
  || commandDecisionResult.commandDecision?.level !== "partial"
  || commandDecisionResult.commandDecision?.status !== "active"
  || !(communicationTemplateResult.templates?.[0]?.renderedKo ?? "").includes("B게이트")
  || !(communicationTemplateResult.templates?.[0]?.renderedKo ?? "").includes("재개조건")
  || !(visitorNoticeResult.notices?.[0]?.localizations?.ko ?? "").includes("B게이트")
  || !(visitorNoticeResult.notices?.[0]?.localizations?.en ?? "").includes("temporarily paused")
  || !(visitorNoticeResult.notices?.[0]?.localizations?.en ?? "").includes("Gate B")
  || !(visitorNoticeResult.notices?.[0]?.localizations?.en ?? "").includes("queue congestion")
  || !(visitorNoticeResult.notices?.[0]?.localizations?.ja ?? "").includes("一時停止")
  || !(visitorNoticeResult.notices?.[0]?.localizations?.ja ?? "").includes("Bゲート")
  || !(visitorNoticeResult.notices?.[0]?.localizations?.zh ?? "").includes("暂时停止")
  || !(visitorNoticeResult.notices?.[0]?.localizations?.zh ?? "").includes("B号门")
  || !["due_soon", "normal"].includes(dashboardResult.rows?.[0]?.slaState)
  || dashboardResult.rows?.[0]?.recommendedTeam !== "인파·동선팀"
  || dashboardResult.activeCommandDecisions?.[0]?.decisionType !== "event_pause"
  || resolveCommandDecisionResult.targetDecision?.status !== "released"
  || resolveCommandDecisionResult.resolutionDecision?.decisionType !== "event_resume"
  || dashboardAfterResolveResult.activeCommandDecisions?.some((decision) => decision.id === commandDecisionResult.commandDecision?.id)
  || dashboardAfterResolveResult.commandStatusSummary?.released < 1
  || !(dashboardAfterResolveResult.timeline ?? []).some((entry) => entry.eventType === "command_decision" && String(entry.title ?? "").includes("행사 재개승인"))
  || !(dashboardAfterResolveResult.timeline ?? []).some((entry) => entry.eventType === "action_assigned")
  || !(dashboardExportResult.files ?? []).some((file) => String(file).endsWith("operations-dashboard.xlsx"))
  || !zipLooksValid(join(root, "data/.validation-store/operations-dashboard-export/operations-dashboard.xlsx"))
  || completeResult.issue?.status !== "resolved"
  || !(reportResult.reportMarkdown ?? "").includes(issueId)
  || !(reportResult.reportMarkdown ?? "").includes("라우팅/SLA")
  || !(reportResult.reportMarkdown ?? "").includes("지휘 판단")
  || !(reportResult.reportMarkdown ?? "").includes("지휘 판단 상태 전이")
  || !(reportResult.reportMarkdown ?? "").includes("시간순 타임라인")
  || !(reportResult.reportMarkdown ?? "").includes("released")
  || !(situationBriefResult.briefMarkdown ?? "").includes("관계기관 요청")
  || !(situationBriefResult.briefMarkdown ?? "").includes("최근 타임라인")
  || !(situationBriefResult.briefMarkdown ?? "").includes("B게이트")
  || !(situationBriefResult.requestedSupport ?? []).some((item) => String(item).includes("경찰"))
  || situationBriefByEventResult.reportScopeIssueId !== issueId
  || situationBriefByEventResult.scopedActionCount !== 1
  || !(situationBriefByEventResult.briefMarkdown ?? "").includes("보고범위")
) {
  console.error("FAIL operations_issue_action_report");
  failed += 1;
} else {
  console.log("PASS operations_issue_action_report routing=인파·동선팀 sla=high");
}

if (failed > 0) {
  console.error(`\n${failed} validation checks failed`);
  process.exit(1);
}

console.log(`\n${rows.length}/${rows.length} scenarios passed`);
