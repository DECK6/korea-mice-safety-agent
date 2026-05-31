# Release Checklist

## 1.0.3 Status

`korea-mice-safety-agent` 1.0.3 is in the high-trust release quality band for offline MICE and outdoor-event safety planning. The release is still an operational draft assistant, not legal advice or a substitute for venue/public-agency approval.

The project already entered the 1.0.x line, so version numbers must not move backward. The current trust score is 95/100 after full local-ordinance article verification and official venue source-link verification.

The package/CLI version is the product release version. Ontology pack `version` fields are data schema or corpus pack versions unless a file explicitly states `versionType: "package_release"`.

## Required Gates

- `npm run typecheck`
- `npm run build`
- `npm run validate:scenarios`
- `npm run validate:venue-corpus`
- `npm run audit:sources`
- `npm run audit:freshness`
- `npm run audit:package-safety`
- `npm run diff:ontology`
- `npm audit --omit=dev`
- `npm pack --dry-run`
- install the generated tarball in a clean smoke project and run:
  - `korea-mice-safety-agent --version`
  - `korea-mice-safety-agent tools`
  - `korea-mice-safety-agent call export_mice_safety_plan_bundle --inputJson '<sample>'`

## Distribution Boundary

- The npm package includes compiled runtime files, offline JSON ontology packs, validation fixtures, audit reports, worker-safety/local-ordinance Markdown summaries, and public-safe venue safety summaries.
- Raw venue PDF/HWP files, full extracted venue Markdown, download cookies, `.env` files, validation output stores, `node_modules`, and graph-analysis caches must not be included in the package tarball.
- `data/markdown/venue-manuals/` is an internal validation corpus only. Public package artifacts use `data/public/venue-safety-summaries.json` and `data/markdown/public/venue-safety-summaries.md`.
- `LAW_OC` is used only at collection time and must never be stored in source, build output, reports, package tarballs, or examples.

## Source/Licensing Policy

- `reusable`: may be structured into offline packs.
- `summary_only`: use as operational summaries, source references, checklist items, and compact source spans.
- `link_only`: keep only link/reference metadata in redistribution outputs.
- `needs_license_review`: keep tracked in source audit; verify current terms before external redistribution beyond internal review.
- `no_redistribution`: do not include raw source documents in release artifacts.

## Known Non-Blocking Risks

- Generated plans are operational drafts. They do not replace venue approval, public-agency interpretation, legal review, or the responsible safety manager's final sign-off.
- Venue and ordinance packs are offline snapshots. Submission deadlines, forms, and local-agency interpretations must be checked before actual filing.

## 1.0.3 Release Evidence

- `validate:scenarios` includes ontology maturity checks for required legal duty types, local ordinance fields, hazard/control/law/source linkage, positive scenarios, and negative over-application cases.
- `audit:freshness` now fails unless all 751 local ordinance records are article-level verified, priority article verification is at least 750 records, and all 33 official venue source links are reachable.
- xlsx export uses the built-in `simple-xlsx` writer and clean tarball install passes `npm audit --omit=dev`.
- Source audit keeps `needs_license_review` and `no_redistribution` sources out of raw redistribution and documents summary/link-only policy.
