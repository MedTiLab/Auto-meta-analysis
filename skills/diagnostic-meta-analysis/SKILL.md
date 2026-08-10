---
name: diagnostic-meta-analysis
description: Diagnostic test accuracy Meta-analysis workflow for tumor biomarkers using TP/FP/FN/TN, sensitivity, specificity, SROC/HSROC, DOR, and QUADAS-2 evidence.
allowed-tools:
  - Read
  - Write
  - Bash
---

# Diagnostic Meta-Analysis

## Use when

Use this skill for cancer biomarker diagnostic accuracy studies, especially when extracting or analyzing:

- TP
- FP
- FN
- TN
- sensitivity
- specificity
- AUC
- PLR
- NLR
- DOR
- SROC
- QUADAS-2 domains

Use `diagnostic-data-extraction` before this skill if the dataset is not already human-reviewed.

## Data priority

Always prefer raw 2x2 diagnostic data:

| Disease + | Disease - |
|---|---|
| TP | FP |
| FN | TN |

Do not treat sensitivity/specificity alone as equivalent to full 2x2 data.

## Extraction rules

For each study extract:

- first author;
- year;
- country;
- cancer type;
- sample type;
- biomarker;
- assay method;
- cutoff;
- reference standard;
- TP / FP / FN / TN;
- sensitivity;
- specificity;
- AUC;
- evidence text;
- page;
- table label;
- confidence.

If TP/FP/FN/TN are inferred, mark:

```json
{
  "derived": true,
  "review_status": "needs_review"
}
```

## Statistical model

Prefer bivariate or HSROC methods when possible. If unavailable, fail clearly rather than producing invalid results.

Use `meta-statistics-r` for reproducible R execution. If R packages for bivariate/HSROC models are unavailable, write a clear blocker and do not substitute an invalid univariate model as the final result.

## Reporting

Report:

- pooled sensitivity;
- pooled specificity;
- PLR, NLR, and DOR when valid;
- SROC/HSROC model choice;
- heterogeneity and threshold-effect diagnostics;
- excluded records and reasons;
- QUADAS-2 summary;
- figure paths for sensitivity, specificity, forest, and SROC plots.

## Project outputs

For numbered MedHelp Meta projects, use these inputs:

```text
05_data_extraction/diagnostic_dataset.csv
05_data_extraction/diagnostic_extraction_review.csv
```

Write outputs to:

```text
07_data_analysis/diagnostic_meta/{run_id}/
08_results_figures/
```

For legacy Meta projects, keep using `Experiment/datasets/`, `Experiment/analysis/`, `Publication/figures/`, and `Publication/tables/`.

Never use unreviewed `candidate` rows for final pooled estimates.
- PLR;
- NLR;
- DOR;
- heterogeneity;
- SROC/AUC;
- prediction region if available;
- QUADAS-2 summary.
