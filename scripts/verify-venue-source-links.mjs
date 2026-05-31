#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRegistryPath = join(root, "src/ontology/mice/source-registry.json");
const venueRulesPath = join(root, "src/ontology/mice/venue-safety-rules.json");
const today = new Date().toISOString().slice(0, 10);
const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
}

const timeoutMs = Number(argValue("--timeout-ms", "12000"));
const delayMs = Number(argValue("--delay-ms", "100"));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalizeHeaders(headers) {
  return {
    contentType: headers.get("content-type") ?? undefined,
    contentLength: headers.get("content-length") ?? undefined,
    lastModified: headers.get("last-modified") ?? undefined,
    etag: headers.get("etag") ?? undefined,
  };
}

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "korea-mice-safety-agent venue source verifier",
        range: "bytes=0-2047",
      },
    });
    if (!response.ok && response.status >= 400) {
      try {
        await response.body?.cancel();
      } catch {
        // ignore body cancellation errors
      }
      const retry = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": "korea-mice-safety-agent venue source verifier",
        },
      });
      const retryHeaders = normalizeHeaders(retry.headers);
      try {
        await retry.body?.cancel();
      } catch {
        // ignore body cancellation errors
      }
      return {
        status: retry.ok || (retry.status >= 300 && retry.status < 400) ? "reachable" : "manual_review_required",
        httpStatus: retry.status,
        finalUrl: retry.url,
        ...retryHeaders,
        fallback: "fetch_without_range",
      };
    }
    const headers = normalizeHeaders(response.headers);
    // Consume a tiny amount where possible so Node can release the socket.
    try {
      await response.body?.cancel();
    } catch {
      // ignore body cancellation errors
    }
    return {
      status: response.ok || (response.status >= 300 && response.status < 400) ? "reachable" : "manual_review_required",
      httpStatus: response.status,
      finalUrl: response.url,
      ...headers,
    };
  } catch (error) {
    const curlResult = probeWithCurl(url);
    return curlResult ?? {
      status: "manual_review_required",
      error: String(error?.message ?? error).slice(0, 180),
    };
  } finally {
    clearTimeout(timer);
  }
}

function probeWithCurl(url) {
  try {
    const output = execFileSync("curl", ["-I", "-L", "--max-time", String(Math.ceil(timeoutMs / 1000)), url], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 128 * 1024,
    });
    const blocks = output.split(/\r?\n\r?\n/).map((block) => block.trim()).filter(Boolean);
    const last = blocks.at(-1) ?? "";
    const status = Number(last.match(/^HTTP\/\S+\s+(\d+)/m)?.[1] ?? 0);
    const header = (name) => last.match(new RegExp(`^${name}:\\s*(.+)$`, "im"))?.[1]?.trim();
    return {
      status: status >= 200 && status < 400 ? "reachable" : "manual_review_required",
      httpStatus: status || undefined,
      finalUrl: url,
      contentType: header("content-type"),
      contentLength: header("content-length"),
      lastModified: header("last-modified"),
      etag: header("etag"),
      fallback: "curl_head",
    };
  } catch {
    return undefined;
  }
}

const sourceRegistry = readJson(sourceRegistryPath);
const venueRules = readJson(venueRulesPath);
const venueSourceRefs = new Set((venueRules.venues ?? []).flatMap((venue) => venue.sourceRefs ?? []));
const sourceById = new Map((sourceRegistry.sources ?? []).map((source) => [source.id, source]));

const results = [];
for (const sourceId of [...venueSourceRefs].sort((a, b) => a.localeCompare(b))) {
  const source = sourceById.get(sourceId);
  if (!source?.url) {
    results.push({ sourceId, status: "manual_review_required", reason: "missing_url" });
    continue;
  }
  const checked = await probe(source.url);
  source.linkVerification = {
    checkedAt: today,
    method: "http_get_range_official_source_url",
    status: checked.status,
    httpStatus: checked.httpStatus,
    finalUrl: checked.finalUrl,
    contentType: checked.contentType,
    contentLength: checked.contentLength,
    lastModified: checked.lastModified,
    etag: checked.etag,
    error: checked.error,
  };
  if (checked.status === "reachable") {
    source.sourceConfidence = source.localMarkdownPath || source.offlineTextStatus === "offline_derived"
      ? "official_source_link_verified_offline_extract"
      : "official_source_link_verified_summary";
  }
  results.push({ sourceId, status: checked.status, httpStatus: checked.httpStatus, contentType: checked.contentType });
  await sleep(delayMs);
}

for (const venue of venueRules.venues ?? []) {
  const refs = venue.sourceRefs ?? [];
  const linked = refs.map((sourceRef) => {
    const source = sourceById.get(sourceRef);
    return {
      sourceRef,
      status: source?.linkVerification?.status ?? "manual_review_required",
      checkedAt: source?.linkVerification?.checkedAt,
      hasOfflineExtract: Boolean(source?.localMarkdownPath || source?.offlineTextStatus === "offline_derived"),
      documentFormat: source?.documentFormat ?? "html",
      finalUrl: source?.linkVerification?.finalUrl ?? source?.url,
    };
  });
  const reachable = linked.filter((item) => item.status === "reachable").length;
  const offlineExtracts = linked.filter((item) => item.hasOfflineExtract).length;
  venue.safetyProfile ??= {};
  venue.safetyProfile.officialSourceVerification = {
    checkedAt: today,
    sourceRefs: linked.length,
    reachableSourceRefs: reachable,
    offlineExtractSourceRefs: offlineExtracts,
    manualReviewSourceRefs: linked.filter((item) => item.status !== "reachable").map((item) => item.sourceRef),
    sources: linked,
  };
}

const summary = {
  generatedAt: today,
  method: "http_get_range_official_source_url",
  venueSourceRefs: venueSourceRefs.size,
  reachable: results.filter((result) => result.status === "reachable").length,
  manualReviewRequired: results.filter((result) => result.status !== "reachable").length,
  results,
};

writeFileSync(sourceRegistryPath, `${JSON.stringify(sourceRegistry, null, 2)}\n`);
writeFileSync(venueRulesPath, `${JSON.stringify(venueRules, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
