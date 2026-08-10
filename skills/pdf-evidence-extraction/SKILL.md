---
name: pdf-evidence-extraction
description: Extract evidence-grounded fields from parsed PDF Markdown/tables for MedHelp Meta projects with page/table provenance and human-review status.
allowed-tools:
  - Read
  - Write
  - Bash
---

# PDF Evidence Extraction

## Purpose

Use parsed PDF artifacts to extract data with verifiable evidence. This is a general extraction layer; diagnostic accuracy projects should add `diagnostic-data-extraction`.

## Non-negotiable rule

No extracted value is valid unless it has:

- reference_id;
- field_name;
- value;
- evidence_text;
- page or page range when available;
- section or table label when available;
- confidence;
- review_status.

## Workflow

1. Locate candidate sections:
   - Abstract
   - Methods
   - Results
   - Tables
   - Supplementary material
2. Extract fields into JSON.
3. Validate JSON schema.
4. Store as candidate.
5. Human confirms/rejects/edits.
6. Only confirmed values enter dataset.

## Project paths

Read parsed artifacts from:

```text
04_full_text_review/fulltext/{reference_id}/mineru/
04_full_text_review/pdf_manifest.json
```

Write candidate outputs to:

```text
05_data_extraction/extraction_candidates.jsonl
05_data_extraction/extraction_review.csv
05_data_extraction/extraction_log.md
```

Only human-confirmed values may be promoted into meta-ready datasets such as `05_data_extraction/diagnostic_dataset.csv`.

## Default status

LLM output defaults to:

```text
review_status = candidate
```

Derived values default to:

```text
review_status = needs_review
```

Use stable status values: `candidate`, `needs_review`, `confirmed`, `rejected`, `superseded`.
