---
name: diagnostic-data-extraction
description: Extract diagnostic test accuracy data for tumor biomarker Meta analysis from parsed articles and tables with TP/FP/FN/TN provenance and human-review flags.
allowed-tools:
  - Read
  - Write
  - Bash
---

# Diagnostic Data Extraction

## Purpose

Use this skill for diagnostic accuracy Meta projects, especially cancer biomarker reviews. It extends `pdf-evidence-extraction` with diagnostic 2x2 table rules and a stricter export schema.

Read `prompts/diagnostic-extraction-prompt.md` when you need a ready-to-use extraction prompt.

## Required fields

Study:

- first_author
- year
- country
- design
- cancer_type
- sample_size
- case_n
- control_n

Index test:

- biomarker
- sample_type
- assay_method
- cutoff

Reference standard:

- name
- details

Diagnostic data:

- TP
- FP
- FN
- TN
- sensitivity
- specificity
- AUC
- threshold effect notes when available
- QUADAS-2 signals when extractable from the paper

## Extraction priority

1. Direct 2x2 table.
2. Explicit TP/FP/FN/TN in text.
3. Sensitivity/specificity with case/control sample sizes, derived and marked `needs_review`.
4. Otherwise mark missing.

Never treat sensitivity/specificity alone as equivalent to a verified 2x2 table. Inferred TP/FP/FN/TN must be marked `derived: true` and `review_status: needs_review`.

## Output row example

```json
{
  "reference_id": "...",
  "first_author": "Li",
  "year": 2022,
  "biomarker": "miR-21",
  "sample_type": "serum",
  "assay_method": "qRT-PCR",
  "cutoff": "...",
  "TP": 45,
  "FP": 8,
  "FN": 12,
  "TN": 60,
  "evidence_text": "...",
  "page": 5,
  "table_label": "Table 2",
  "confidence": 0.88,
  "review_status": "candidate"
}
```

## Project outputs

For numbered MedHelp Meta projects, write candidate rows to:

```text
05_data_extraction/diagnostic_extraction_candidates.jsonl
05_data_extraction/diagnostic_extraction_review.csv
05_data_extraction/diagnostic_extraction_log.md
```

After human review, export the analysis input as:

```text
05_data_extraction/diagnostic_dataset.csv
```

For legacy Meta projects, keep using the generic equivalents under `Experiment/datasets/` and `Experiment/analysis/`.

Required analysis columns are `study_id`, `reference_id`, `TP`, `FP`, `FN`, and `TN`, plus provenance fields. Route statistics to `diagnostic-meta-analysis` and `meta-statistics-r`.
