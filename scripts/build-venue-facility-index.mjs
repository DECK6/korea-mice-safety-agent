#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRegistry = JSON.parse(readFileSync(join(root, "src/ontology/mice/source-registry.json"), "utf8"));
const venueRules = JSON.parse(readFileSync(join(root, "src/ontology/mice/venue-safety-rules.json"), "utf8"));
const outputJsonPath = join(root, "src/ontology/mice/venue-facility-index.json");
const outputMdPath = join(root, "data/markdown/venue-manuals/facility-index.md");

const categoryRules = [
  {
    category: "capacity",
    patterns: [/최대 수용|수용인원|수용 능력|면적|부스|전시홀|전시실|㎡|m2|m²/i],
    skip: [/목적으로 한다|임대료|취소면적|계약면적|기본요율/i],
  },
  {
    category: "ceilingHeight",
    patterns: [/천정|천장|천고|제한높이|ceiling|height/i],
  },
  {
    category: "floorLoad",
    patterns: [/하중|허용하중|바닥하중|ton\/m2|톤\/㎡|t\/㎡|kg\/㎡|중량물/i],
  },
  {
    category: "freightEntrance",
    patterns: [/화물출입구|화물차|반입|반출|출입차량|차량 출입/i],
  },
  {
    category: "loadingDock",
    patterns: [/로딩|도크|상하차|하역|반입|반출|화물차|적재/i],
  },
  {
    category: "electricity",
    patterns: [/전기설비|전기공사|전기시설|전기 사용|전기[·\s,/]|전원|분전|분전반|접지|누전|노휴즈|설비도면|전력|유틸리티|utility|utilities|floor box/i],
  },
  {
    category: "fireLane",
    patterns: [/소방통로|소방시설|소방|소화전|소화기|방화셔터|방화|화재|소방차|화원|방재/i],
  },
  {
    category: "evacuationRoutes",
    patterns: [/비상구|피난|대피|피난동선|비상통로|유도등|출입구|입퇴장|입장|퇴장|관람객 동선|동선 분리|대기열|응급차량|승하차/i],
  },
  {
    category: "restrictedItems",
    patterns: [/금지|반입 불가|사용 제한|위험물|화기|가스|LPG|흡연|음주|콤프레셔|전기톱|전기대패|그라인더|인화성/i],
  },
  {
    category: "boothRules",
    patterns: [/부스|독립부스|복층|장치|철거|시공|스탠드|공사업체/i],
  },
  {
    category: "riggingRules",
    patterns: [/리깅|트러스|천정|천장|현수막|배너|광고|고정|아치|입간판/i],
  },
  {
    category: "foodRules",
    patterns: [/식음료|조리|외부음식|푸드|LPG|가스|위생|취사/i],
  },
  {
    category: "safetyDocuments",
    patterns: [/안전관리 계획서|안전관리 신고|신청서|신고서|허가신청서|작업신고|설비도면|중량물 반입|위험물 반입|명단|증빙|계획서|도면|제출서류|제출 대상|연락망|상황실/i],
  },
];

const coverageCategoryMap = {
  facility_capacity: ["capacity"],
  capacity_layout: ["capacity"],
  exhibition_hall: ["capacity", "boothRules"],
  booth_capacity: ["capacity", "boothRules"],
  floor_load: ["floorLoad"],
  utilities: ["electricity"],
  utility: ["electricity"],
  control_room: ["safetyDocuments"],
  safety_contact: ["safetyDocuments"],
  operation_rule: ["safetyDocuments"],
  implementation_rule: ["safetyDocuments"],
  work_report: ["safetyDocuments"],
  safety_management_report: ["safetyDocuments"],
  rental_process: ["safetyDocuments"],
  loading: ["freightEntrance", "loadingDock"],
  fire_egress: ["fireLane", "evacuationRoutes"],
  evacuation_capacity: ["evacuationRoutes"],
  floor_plan: ["capacity", "evacuationRoutes"],
  signage: ["riggingRules"],
  unique_venue: ["capacity"],
};

const hardSkipPatterns = [
  /^---$/,
  /^title:/i,
  /^source:/i,
  /^sourcePath:/i,
  /^sourceUrl:/i,
  /^reviewedAt:/i,
  /^status:/i,
  /^# /,
  /^목차$/,
  /저작권|copyright/i,
];

function sourceMap() {
  return new Map(sourceRegistry.sources.map((source) => [source.id, source]));
}

function normalizeLine(rawLine) {
  return rawLine.replace(/\s+/g, " ").trim();
}

function confidenceFor(line, category) {
  let score = 0.45;
  if (/[0-9]/.test(line)) score += 0.15;
  if (/제[0-9]+조|별지|서식|신청서|허가|계획서/.test(line)) score += 0.15;
  if (/금지|확보|제출|승인|허가|점검|비상구|소화전|하중|전기|반입|반출/.test(line)) score += 0.15;
  if (["fireLane", "evacuationRoutes", "floorLoad", "electricity", "safetyDocuments"].includes(category)) score += 0.05;
  return Math.min(Number(score.toFixed(2)), 0.95);
}

function categoryForLine(line) {
  const categories = [];
  for (const rule of categoryRules) {
    if (rule.skip?.some((pattern) => pattern.test(line))) continue;
    if (rule.patterns.some((pattern) => pattern.test(line))) categories.push(rule.category);
  }
  return categories;
}

function extractMarkdown(source, venueId) {
  if (!source.localMarkdownPath) return [];
  const localPath = join(root, source.localMarkdownPath);
  if (!existsSync(localPath)) return [];
  const lines = readFileSync(localPath, "utf8").split(/\r?\n/);
  const entries = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const line = normalizeLine(lines[i]);
    if (line.length < 8 || line.length > 220) continue;
    if (hardSkipPatterns.some((pattern) => pattern.test(line))) continue;
    const categories = categoryForLine(line);
    for (const category of categories) {
      const key = `${category}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        id: `${venueId}_${source.id}_${category}_${String(entries.length + 1).padStart(3, "0")}`.toLowerCase(),
        venueId,
        category,
        value: line,
        sourceRef: source.id,
        localMarkdownPath: source.localMarkdownPath,
        line: i + 1,
        confidence: confidenceFor(line, category),
      });
    }
  }
  return entries;
}

function extractOfflineSource(source, venueId) {
  const entries = [];
  const seen = new Set();
  const lines = [
    ...(source.offlineExtracts ?? []),
    ...(source.coverage ?? []).map((coverage) => `source coverage: ${coverage}`),
  ];

  for (let i = 0; i < lines.length; i += 1) {
    const line = normalizeLine(lines[i]);
    if (!line) continue;
    const coverageKey = line.startsWith("source coverage: ")
      ? line.replace("source coverage: ", "").trim()
      : "";
    const categories = coverageKey
      ? coverageCategoryMap[coverageKey] ?? categoryForLine(line)
      : categoryForLine(line);

    for (const category of categories) {
      const key = `${category}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        id: `${venueId}_${source.id}_offline_${category}_${String(entries.length + 1).padStart(3, "0")}`.toLowerCase(),
        venueId,
        category,
        value: line,
        sourceRef: source.id,
        localMarkdownPath: source.localMarkdownPath ?? "src/ontology/mice/source-registry.json",
        line: null,
        confidence: coverageKey ? 0.55 : confidenceFor(line, category),
      });
    }
  }

  return entries;
}

function extractVenueFacts(venue) {
  const entries = [];
  const facts = [
    ...(venue.facilityFacts ?? []),
    ...(venue.spaces ?? []).flatMap((space) => [`${space.name}: ${space.facts.join("; ")}`, ...space.facts]),
    ...venue.rules.flatMap((rule) => [rule.summary, ...rule.checkpoints]),
  ];
  const seen = new Set();
  for (const fact of facts) {
    const line = normalizeLine(fact);
    const categories = categoryForLine(line);
    for (const category of categories) {
      const key = `${category}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        id: `${venue.id}_ontology_${category}_${String(entries.length + 1).padStart(3, "0")}`.toLowerCase(),
        venueId: venue.id,
        category,
        value: line,
        sourceRef: "venue-safety-rules",
        localMarkdownPath: "src/ontology/mice/venue-safety-rules.json",
        line: null,
        confidence: 0.7,
      });
    }
  }
  return entries;
}

const sources = sourceMap();
const indexedVenues = venueRules.venues.map((venue) => {
  const entries = [
    ...extractVenueFacts(venue),
    ...venue.sourceRefs.flatMap((sourceRef) => {
      const source = sources.get(sourceRef);
      return source ? [...extractMarkdown(source, venue.id), ...extractOfflineSource(source, venue.id)] : [];
    }),
  ];
  const categoryCounts = Object.fromEntries(
    categoryRules.map((rule) => [rule.category, entries.filter((entry) => entry.category === rule.category).length]),
  );
  return {
    venueId: venue.id,
    name: venue.name,
    region: venue.region,
    sourceRefs: venue.sourceRefs,
    categoryCounts,
    entries,
  };
});

const report = {
  version: "1.0.0",
  generatedAt: new Date().toISOString().slice(0, 10),
  extractionPolicy:
    "Venue PDF/HWP Markdown extracts are stored as compact operational facts with source path and line number. Full source documents remain outside redistributable ontology output.",
  categories: categoryRules.map((rule) => rule.category),
  venues: indexedVenues,
};

mkdirSync(dirname(outputJsonPath), { recursive: true });
mkdirSync(dirname(outputMdPath), { recursive: true });
writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`);

const md = [
  "# Venue Facility Index",
  "",
  report.extractionPolicy,
  "",
  ...indexedVenues.flatMap((venue) => [
    `## ${venue.name} (${venue.venueId})`,
    "",
    ...Object.entries(venue.categoryCounts).map(([category, count]) => `- ${category}: ${count}`),
    "",
  ]),
].join("\n");
writeFileSync(outputMdPath, `${md}\n`);

const total = indexedVenues.reduce((sum, venue) => sum + venue.entries.length, 0);
console.log(`wrote ${outputJsonPath}`);
console.log(`wrote ${outputMdPath}`);
console.log(`indexed ${indexedVenues.length} venues, ${total} entries`);
