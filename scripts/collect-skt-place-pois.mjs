#!/usr/bin/env node
// Expands the offline SKT POI index (src/ontology/mice/skt-place-poi-index.json).
//
// Every page costs one of the ten free calls SK shares across all puzzle POI endpoints, so this is a
// hand-run tool only: never wire it into CI, tests or the dashboard. Each call increments the same
// local ledger the server uses, and the run stops as soon as the budget or the plan limit is hit.
//
//   node scripts/collect-skt-place-pois.mjs --offset 1000 --limit 1000 --max-calls 1
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const indexPath = join(root, "src/ontology/mice/skt-place-poi-index.json");

function argValue(name, fallback) {
  const position = process.argv.indexOf(name);
  if (position === -1) return fallback;
  const value = Number(process.argv[position + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const existing = JSON.parse(readFileSync(indexPath, "utf8"));
const offsetStart = argValue("--offset", existing.pois.length);
const limit = Math.min(Math.max(argValue("--limit", 1000), 1), 1000);
const maxCalls = Math.max(argValue("--max-calls", 1), 0);

let clients;
let ledger;
try {
  clients = await import(join(root, "build/lib/mice-public-api-clients.js"));
  ledger = await import(join(root, "build/lib/skt-place-congestion.js"));
} catch {
  console.error("build/ 산출물이 없습니다. npm run build 후 다시 실행하세요.");
  process.exit(1);
}

const byId = new Map(existing.pois.map((poi) => [poi.poiId, poi]));
let offset = offsetStart;
let calls = 0;
let added = 0;

for (let index = 0; index < maxCalls; index += 1) {
  const quota = ledger.readSktQuota();
  if (quota.used >= quota.limit) {
    console.error(`중단: 이번 달 추정 사용량 ${quota.used}/${quota.limit}건. 다음 달 리셋까지 호출하지 않습니다.`);
    break;
  }
  // Increment before the call: the provider counts failures too, so an unrecorded attempt would
  // let the ledger drift under the real usage.
  const spent = ledger.consumeSktQuota();
  calls += 1;
  const page = await clients.fetchSktPlacePois({ offset, limit });
  if (page.status !== "live_verified") {
    console.error(`호출 실패(사용량 ${spent.used}/${spent.limit}): ${page.warnings.join(" / ")}`);
    break;
  }
  for (const record of page.records) {
    const poiId = String(record.fields.poiId);
    if (byId.has(poiId)) continue;
    byId.set(poiId, { poiId, poiName: record.title });
    added += 1;
  }
  console.log(`offset=${offset} 수집 ${page.records.length}건, 누적 ${byId.size}건, 사용량 ${spent.used}/${spent.limit}`);
  offset += limit;
  if (page.records.length < limit || offset >= (page.totalCount ?? existing.totalAvailable)) break;
}

if (added === 0) {
  console.log(`새로 추가된 POI가 없습니다. 인덱스를 그대로 둡니다(호출 ${calls}건).`);
  process.exit(0);
}

const pois = [...byId.values()];
writeFileSync(indexPath, `${JSON.stringify({
  ...existing,
  collectedAt: new Date().toISOString(),
  coverage: `top ${pois.length} of ${existing.totalAvailable} POIs (offset 0~${offset - 1}; the API has no name-search parameter, so this offline index enables zero-quota local search)`,
  pois,
}, null, 2)}\n`, "utf8");

console.log(`wrote ${indexPath}`);
console.log(`pois=${pois.length} (+${added}), calls=${calls}`);
