#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRegistryPath = join(root, "src/ontology/mice/source-registry.json");
const publicApiEvidencePath = join(root, "src/ontology/mice/public-api-operational-evidence.json");
const packageJsonPath = join(root, "package.json");
const outputJsonPath = join(root, "data/source-audit-report.json");
const outputMdPath = join(root, "docs/SOURCE_AUDIT.md");

const registry = JSON.parse(readFileSync(sourceRegistryPath, "utf8"));
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const publicApiEvidence = JSON.parse(readFileSync(publicApiEvidencePath, "utf8"));
const publicApiEvidenceById = new Map((publicApiEvidence.sources ?? []).map((source) => [source.sourceId, source]));

const STATUSES = ["reusable", "summary_only", "link_only", "needs_license_review", "no_redistribution"];

function classify(source) {
  const haystack = `${source.id} ${source.title} ${source.publisher} ${source.reuseCaution ?? ""}`.toLowerCase();
  const caution = source.reuseCaution ?? "";

  if (caution.includes("제4유형") || caution.toLowerCase().includes("type 4") || caution.includes("상업적 재사용 제한")) {
    return {
      status: "no_redistribution",
      reason: "공공누리 제4유형 또는 상업적 이용 제한 가능성이 있어 원문 재배포 대상에서 제외한다.",
    };
  }

  if (haystack.includes("kosha")) {
    return {
      status: "summary_only",
      reason: "KOSHA Guide는 기술 권고 요약과 출처 연결만 보관하고 원문 대량 재배포를 피한다.",
    };
  }

  if (source.documentFormat === "api" && source.verificationStatus === "live_verified_snapshot") {
    return {
      status: "summary_only",
      reason: "live 검증 API 결과는 키·원문 응답 없이 요약 snapshot과 운영 체크포인트로만 보관한다.",
    };
  }

  if (source.id === "LOCAL_ORDINANCE_PACK_2026" || haystack.includes("law.go.kr") || (haystack.includes("법령") && source.documentFormat !== "api")) {
    return {
      status: "reusable",
      reason: "법령/조례 원문 기반 메타데이터와 필요한 조문 발췌를 오프라인 검증팩으로 사용한다. 제출 전 최신 원문 확인은 필수다.",
    };
  }

  if (caution.includes("원문 재배포 금지")) {
    return {
      status: "link_only",
      reason: "원문 파일은 링크와 로컬 보관 메타데이터만 사용하고, 배포 산출물에는 요약 체크포인트만 포함한다.",
    };
  }

  if (source.documentFormat === "pdf" || source.documentFormat === "hwp" || source.localDocumentPath) {
    return {
      status: "summary_only",
      reason: "베뉴 PDF/HWP는 운영·안전 체크포인트 요약과 출처 링크 중심으로 사용한다.",
    };
  }

  if (caution.includes("별도 확인") || caution.includes("확인 필요") || ["needs_review", "needs_source_review"].includes(source.verificationStatus)) {
    return {
      status: "needs_license_review",
      reason: "이용조건 또는 최신성 확인이 남아 있다.",
    };
  }

  return {
    status: "summary_only",
    reason: "안전 운영 요약과 출처 링크 중심으로 사용하는 기본 정책을 적용한다.",
  };
}

const sources = registry.sources.map((source) => {
  const audit = classify(source);
  const evidence = publicApiEvidenceById.get(source.id);
  return {
    id: source.id,
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    documentFormat: source.documentFormat ?? "html",
    localDocumentPath: source.localDocumentPath,
    localMarkdownPath: source.localMarkdownPath,
    offlineTextStatus: source.offlineTextStatus ?? "not_applicable",
    verificationStatus: source.verificationStatus,
    evidenceSnapshotStatus: evidence ? publicApiEvidence.verificationStatus : undefined,
    liveProbeAt: evidence?.liveProbeAt,
    currentAsOf: source.currentAsOf ?? evidence?.currentAsOf,
    reviewBy: source.reviewBy,
    freshnessStatus: source.freshnessStatus,
    evidenceCurrentAsOf: evidence?.currentAsOf,
    sourceConfidence: evidence?.sourceConfidence,
    licenseStatus: audit.status,
    licenseReason: audit.reason,
    reuseCaution: source.reuseCaution,
  };
});

const counts = Object.fromEntries(STATUSES.map((status) => [status, sources.filter((source) => source.licenseStatus === status).length]));

const report = {
  version: packageJson.version,
  generatedAt: new Date().toISOString().slice(0, 10),
  policy:
    "MICE 안전 에이전트는 법령/조례/안전수칙/베뉴 정보를 런타임 오프라인으로 조회하되, 원문 재배포 제한이 있는 자료는 요약·링크·체크포인트 방식으로만 사용한다.",
  statuses: STATUSES,
  counts,
  sources,
};

mkdirSync(dirname(outputJsonPath), { recursive: true });
mkdirSync(dirname(outputMdPath), { recursive: true });
writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`);

const rows = sources
  .map(
    (source) =>
      `| ${source.id} | ${source.licenseStatus} | ${source.documentFormat} | ${source.offlineTextStatus} | ${source.verificationStatus} | ${source.evidenceSnapshotStatus ?? ""} | ${source.currentAsOf ?? ""} | ${source.reviewBy ?? ""} | ${source.freshnessStatus ?? ""} | ${source.licenseReason} |`,
  )
  .join("\n");

const markdown = [
  "# Source Audit",
  "",
  report.policy,
  "",
  "## Status Counts",
  "",
  ...STATUSES.map((status) => `- ${status}: ${counts[status]}`),
  "",
  "## Reuse Policy",
  "",
  "- `reusable`: 법령/조례 메타데이터 또는 공개 법령성 자료처럼 오프라인 pack에 구조화해도 되는 출처.",
  "- `summary_only`: 원문 복제 대신 요약, 체크포인트, 출처 링크, 로컬 내부 검토용 변환본만 사용하는 출처.",
  "- `link_only`: 원문 재배포 금지가 명확하거나 베뉴가 제공하는 원본 링크 참조가 안전한 출처.",
  "- `needs_license_review`: 공공누리 유형, 베뉴 약관, 최신성 확인이 남은 출처.",
  "- `no_redistribution`: 공공누리 제4유형 등 원문 변경/상업 이용 제한이 있어 배포 산출물에서 원문을 제외해야 하는 출처.",
  "",
  "## Sources",
  "",
  "| Source | License status | Format | Offline text | Verification | Evidence snapshot | Current as of | Review by | Freshness | Reason |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  rows,
  "",
  "## Notes",
  "",
  "- `LAW_OC`는 수집 시점 환경변수로만 사용하고 이 리포트나 온톨로지 파일에 저장하지 않는다.",
  "- KOSHA Guide와 베뉴 PDF/HWP는 안전계획 생성용 요약·체크포인트로만 쓰고, 원문 제출·재배포 근거로 쓰지 않는다.",
  "- 조례/법령 pack은 오프라인 조회용이지만 실제 인허가 제출 전 최신 시행일과 관할청 해석을 재확인해야 한다.",
  "- `live_verified_snapshot` API 출처는 공개 API live smoke에서 검증한 결과를 키·원문 응답 없이 요약 저장한 상태이며, D-day 운영 판단은 최신 live 재확인이 필요하다.",
].join("\n");

writeFileSync(outputMdPath, `${markdown}\n`);

console.log(`wrote ${outputJsonPath}`);
console.log(`wrote ${outputMdPath}`);
