# Codex Goal: P0/P1/P2 Available-Key-First Development

Repo: `/Volumes/data/Dev/korea-mice-safety-agent`

## Objective

Implement the available-key-first P0/P1/P2 data integration path using only confirmed or pending API access documented in `docs/API_ACCESS_REQUIREMENTS.md`.

Build:
- P0 Offline Evidence Pack from ready keys.
- P1 Event-Day Snapshot Pack from ready keys plus pending-key placeholders.
- P2 Live Operations Adapter from ready keys plus pending-key graceful fallback.

## Read first

1. `docs/API_ACCESS_REQUIREMENTS.md`
2. `docs/FUTURE_DEVELOPMENT_PLAN.md`
3. `README.md`
4. `package.json`
5. Existing `src/tools/*`, `src/lib/*`, `scripts/*`, `src/ontology/mice/*` patterns

## Key status

### Ready / usable

- `KOPIS_SERVICE_KEY`
- `KCISA_KOPIS_FACILITY_KEY`
- `TOUR_API_SERVICE_KEY`
- `NEMC_SERVICE_KEY`
- `FOOD_SAFETY_API_KEY`
- `SEOUL_OPENAPI_KEY`
- `KMA_APIHUB_KEY`
- `AIRKOREA_SERVICE_KEY`
- `LAW_OC` is externally available in DECK but may not be in repo `.env` yet.
- P0-10 venue PDFs/HWPs require no key.

### Pending / requested but not yet usable

- `ITS_OPENAPI_KEY`: 국가교통정보센터 신청 완료, API key pending.
- `SAFETY_DATA_API_KEY`: 재난안전데이터 공유플랫폼 긴급재난문자 신청 완료, API key pending.

### Missing / do not depend on

- `KCISA_FESTIVAL_KEY`
- `LOCAL_LICENSE_SERVICE_KEY`
- `BUILDING_LEDGER_KEY`
- `ADDRESS_API_KEY`
- `SAFEMAP_SERVICE_KEY`
- `ESHARE_SERVICE_KEY`
- `DATA_GO_KR_KEY` as a separate common variable

## Hard constraints

- Never print, commit, or document real API key values.
- Do not add secrets to docs, source, generated reports, package output, logs, or tests.
- Read API keys only from `process.env` / existing local `.env` loading patterns.
- Missing keys must return structured `not_configured` or `pending_key`, not crash.
- P0 runtime tools must use offline packs, not live network calls.
- P1 snapshots must include `capturedAt`, `expiresAt`, and `isStale`.
- P2 live data is `operationalEvidence` only, never `legalBasis`.
- Do not implement speculative integrations for missing/후순위 keys.
- Avoid storing raw request URLs containing `serviceKey` query params.
- Do not store CCTV video or raw sensitive event data.
- Keep implementation minimal, tested, and aligned with existing project style.

## Implementation tasks

### 1. Key status helper

Add/complete a config helper that reports:
- `configured`
- `missing`
- `pending`
- `externally_available`
- `no_key_required`

Include known keys from `docs/API_ACCESS_REQUIREMENTS.md`.
Tests must prove no key values are serialized in status output.

### 2. P0 Offline Evidence Pack

Implement or complete collectors/adapters only for prepared P0 sources:
- `KOPIS_SERVICE_KEY`: KOPIS performance/festival catalog if not present.
- `KCISA_KOPIS_FACILITY_KEY`: KCISA KOPIS facility directory if not already present.
- `TOUR_API_SERVICE_KEY`: TourAPI event/festival/tourism catalog snapshot.
- `NEMC_SERVICE_KEY`: Emergency medical institution / AED snapshot.
- `FOOD_SAFETY_API_KEY`: Food Safety Korea F&B/HACCP/recall-related snapshot.
- `LAW_OC`: graceful handling because it may be external, not repo-local.
- Venue PDFs/HWPs: keep no-key public/offline handling as-is.

For each P0 collector:
- Separate fetch, normalization, and source-audit metadata.
- Store raw under `data/raw/**` only if already ignored; otherwise avoid raw persistence.
- Deployable outputs should fit existing conventions: `src/ontology/mice/**.json`, `data/markdown/**.md`, or existing data paths.
- Include `retrievedAt`, `currentAsOf`, `sourceId`, `licensePolicy`, `verificationStatus`, `sourceConfidence` where applicable.
- Add fixtures/mocks so tests do not call live APIs by default.

### 3. P1 Event-Day Snapshot Pack

Implement snapshot layer for ready P1 sources:
- `SEOUL_OPENAPI_KEY`: Seoul real-time city/population data snapshot.
- `AIRKOREA_SERVICE_KEY`: AirKorea air quality snapshot.
- `ITS_OPENAPI_KEY`: pending only; typed interface + `pending_key`/`not_configured` fallback.
- `SAFETY_DATA_API_KEY`: pending only; emergency disaster message API interface + fallback.
- `ESHARE_SERVICE_KEY`: no implementation beyond explicit unavailable/후순위 status.

Snapshot outputs must include:
- `capturedAt`
- `expiresAt`
- `isStale`
- `sourceId`
- query/location metadata
- warnings for missing key, stale data, unsupported region
- no secrets

### 4. P2 Live Operations Adapter

Implement live adapter structure using available keys:
- `KMA_APIHUB_KEY`: live weather risk adapter. Include approved coverage note: short/ultra/mid forecast, warnings, impact forecast, AWS, radar, lightning, lifestyle/health weather indices. If endpoint detail is uncertain, implement interface + one tested mock-backed/live-capable client method and clear TODO.
- `SEOUL_OPENAPI_KEY`: Seoul-only live crowd/city signal adapter. Warn for non-Seoul venues.
- `AIRKOREA_SERVICE_KEY`: live air quality adapter.
- `SAFETY_DATA_API_KEY`: pending skeleton for 행정안전부_긴급재난문자 only; return `pending_key` until key exists. Do not depend on 재난관리책임기관 공개 data.
- `ITS_OPENAPI_KEY`: pending skeleton; return `pending_key` until key exists. Do not store CCTV video.

P2 responses must:
- Put data under `operationalEvidence`, not `legalBasis`.
- Include freshness metadata.
- Include source status per adapter.
- Return partial results with warnings when adapters are pending/missing.
- Never throw for missing optional keys.

### 5. Tool / CLI integration

Inspect existing MCP/tool registration patterns. Add minimal tools or extend existing ones so users can:
- Query P0 offline readiness / collected pack status.
- Build or refresh P0 collectors for ready keys.
- Generate P1 event-day snapshot for a venue/location.
- Query P2 live operations status for a venue/location.

Suggested names only if consistent with repo style:
- `query_mice_api_access_status`
- `collect_mice_p0_ready_sources`
- `generate_mice_event_day_snapshot`
- `query_mice_live_operations_status`

Prefer existing naming patterns in `src/tools` and `src/tool-registry.ts`.

### 6. Documentation

Update docs only if implementation changes status semantics. Add a short developer section explaining:
- active keys
- pending keys
- how to run collectors
- how to run tests
- missing-key behavior

Do not include real key values.

### 7. Tests and verification

Add tests for:
- key status helper
- missing/pending keys do not crash
- P1 snapshot stale calculation
- P2 partial result aggregation
- no secret leakage in serialized outputs
- Seoul-only live crowd warning for non-Seoul locations
- pending ITS/SAFETY adapters return structured `pending_key`

Run available commands from `package.json`, such as:
- `npm test`
- `npm run typecheck`
- `npm run lint`
- existing validation commands

If test scripts are missing, add minimal tests using the existing framework. Do not introduce a heavyweight framework unless already present.

## Acceptance criteria

- Project can develop through P2 using prepared keys and pending-key fallbacks.
- Ready keys have real collector/adapter paths where existing API knowledge and repo patterns support them.
- Pending keys are typed adapters with structured `pending_key` / `not_configured` output.
- Missing/후순위 keys are not required for P0/P1/P2 happy path.
- No secrets are printed or written.
- Outputs include freshness/source metadata.
- Existing functionality remains compatible.
- Relevant tests pass.

## Work style

- Make small, reviewable changes.
- Prefer DRY provider/client helpers over copy-paste fetch logic.
- Keep YAGNI: no speculative integrations for unissued/missing keys.
- If endpoint detail is uncertain, implement interface + mock-backed tests + clear TODO rather than guessing a broken endpoint.
- Final response must list changed files, implemented adapters, pending limitations, and exact verification commands/results.
