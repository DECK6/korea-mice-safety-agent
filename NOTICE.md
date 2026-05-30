# NOTICE

This repository contains software code under the MIT License and a starter
ontology pack for Korean MICE site-operation safety.

## Source And Reuse Notes

- Korean statutes and administrative rules are referenced through law.go.kr
  and korean-law-mcp. Statutory texts are generally non-copyrightable public
  materials under Korean copyright law, but this project stores only compact
  metadata and operational summaries by default.
- Public manuals and venue documents are represented as source links and
  extracted checklist concepts. Do not redistribute full PDFs or venue manuals
  through this repository unless each source license permits it.
- `agent-safety-oss` is noted as a related design reference for connecting
  safety rules, hazards, controls, documents, and evidence. Worker-safety
  summaries in this repository are MICE-specific operational summaries. Treat
  KOSHA Guides as technical recommendations and check the original KOSHA source
  for exact text.
- Local ordinance data is stored as an offline search index and selected
  article excerpts for operational matching. Reconfirm current ordinances with
  the relevant local government before submission or approval.
- Some public documents may be under KOGL Type 4 or venue-specific terms. Treat
  those sources as "link and summarize" unless reuse terms are confirmed.
- Performance-facility directory data comes from the KCISA (Korea Culture
  Information Service Agency) KOPIS open API, a free Ministry of Culture, Sports
  and Tourism cultural-data feed with no reuse restriction. Only directory-level
  metadata (facility name, address, category, contact) is stored offline in
  `kopis-venue-directory.json` for jurisdiction lookup. Reconfirm jurisdiction
  and contacts with the venue before an actual event.
- API service keys (`LAW_OC`, `KCISA_KOPIS_FACILITY_KEY`) must never be
  committed. Pass them through the process environment or `.env` (git-ignored).

## Legal Disclaimer

This project is a decision-support and checklist system for MICE site safety.
It does not replace legal review, venue approval, local-government consultation,
fire/police/medical coordination, or a qualified safety manager's judgment.
