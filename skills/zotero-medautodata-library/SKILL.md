---
name: zotero-medautodata-library
description: Use MedHelp/MedAutoData's Zotero local API and references_library to sync Meta project references, project links, and user-owned full-text PDF attachments for explicit Meta missing-full-text queues.
allowed-tools:
  - Read
  - Write
  - Bash
---

# Zotero + MedAutoData Library

## Purpose

Use this skill when connecting a Meta project to Zotero and the existing MedHelp/MedAutoData reference system.

## Existing MedAutoData concepts

- `references_library`: canonical literature cache.
- `project_references`: project-to-reference links.
- Zotero local API client: `server/utils/zotero-client.js`.
- PDF cache: existing reference PDF cache utility.
- Project artifacts for numbered clinical Meta projects: `02_search_dedupe/search/imported_records/` for source exports, `03_title_abstract_screening/` for sync/screening decisions, and `04_full_text_review/` for full-text manifests, attachment mirrors, and parse inputs.

## Rules

- Use this skill only when the user explicitly asks to sync their Zotero/user library or to use Zotero-owned attachments. Do not treat Zotero as an external database search, and do not let AI freely scan Zotero or arbitrary local folders.
- Do not create a separate bibliography database.
- Always link imported or synced references to the active project.
- For numbered clinical Meta projects, `zotero-medautodata-library` owns Zotero source output: export normalized synced items to `02_search_dedupe/search/imported_records/zotero.csv`. This is an audit/dedupe source file; `citation-management` must still create exactly `02_search_dedupe/screening_input.csv` as the only final AI-screening input.
- Zotero/project references should not appear as smart-screening results by themselves. The smart-screening page displays only exactly `03_title_abstract_screening/screening_decisions.csv` or `screening_decisions.json` AI/Claude/user decisions.
- Prefer Zotero attachments for records already present in the explicit missing-full-text queue. Do not perform open-web PDF lookup from this skill.
- If Zotero has no stored PDF, mark the full-text status clearly and route to upload/manual acquisition.
- Keep Zotero item keys/source IDs in metadata.
- Preserve project reference IDs so downstream extraction rows can trace back to `reference_id`.
- Do not create a second bibliography database for Meta-analysis.
- Zotero local API remains read-only for Meta missing-full-text sync: copy existing user-owned attachments into the project; do not write project PDFs, tags, or decisions back into Zotero through the local API.
- Zotero direct-push is allowed only when the user explicitly requests it and active `zotero_user_id` plus `zotero_api_key` credentials are configured. Direct-push may create/reuse a MedHelp collection, create/reuse bibliographic items, upload already legal/user-provided full-text attachments, and read Include/Maybe/Exclude collection membership back as `stage: "full_text"`, `reviewer: "user"` decisions.

## Useful actions

- Check Zotero availability.
- List collections.
- Browse items.
- Sync collection to `references_library`.
- Resolve stored PDF attachments for `04_full_text_review/fulltext_manifest.json/csv` rows where `needs_full_text=true` or existing queued asset status requires acquisition.
- Mirror PDFs into Meta Analysis artifact folder.

## Output contract

For legacy Meta projects, use these project paths:

```text
Literature/references/zotero_collections.json
Literature/references/zotero_items.json
Literature/references/project_references.csv
Experiment/analysis/pdf/zotero_attachments/
Experiment/analysis/pdf_manifest.json
```

For numbered clinical Meta projects, mirror the same reference state into:

```text
02_search_dedupe/search/imported_records/zotero.csv
03_title_abstract_screening/sync_report.json
04_full_text_review/fulltext_manifest.json
04_full_text_review/fulltext_manifest.csv
04_full_text_review/pdf_manifest.json
04_full_text_review/fulltext/<reference-id-slug>/<paper-title>.pdf
```

If you perform AI title/abstract screening from Zotero/project references, write the decisions to `03_title_abstract_screening/screening_decisions.csv` or `screening_decisions.json` with `reviewer: "ai_pre_screen"` for first-pass screening, then `reviewer: "claude"` after agent review. Never overwrite `reviewer: "user"` decisions.

Title/abstract `include`/`maybe` is only eligibility for full-text work. Before using Zotero for full text, write or update `04_full_text_review/fulltext_manifest.json/csv` with the specific records that need acquisition and include `needs_full_text: true`. Downstream Zotero lookup, upload, parsing, and full-text AI screening must use that manifest/queue instead of all `include`/`maybe` records.

When a Zotero item has no accessible stored attachment, record the status and leave it in the Zotero handoff queue for Zotero/user-side PDF retrieval rather than trying to bypass publisher access controls.
