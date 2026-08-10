---
name: meta-statistics-r
description: Run reproducible R statistical analysis for MedHelp Meta projects, starting with diagnostic accuracy and extending to prognostic, binary, continuous, and prevalence analyses.
allowed-tools:
  - Read
  - Write
  - Bash
---

# Meta Statistics in R

## MVP

Diagnostic test accuracy Meta analysis.

## Input

```text
05_data_extraction/diagnostic_dataset.csv
```

Required columns:

- study_id
- TP
- FP
- FN
- TN

## Output

```text
07_data_analysis/diagnostic_meta/{run_id}/output.json
07_data_analysis/diagnostic_meta/{run_id}/diagnostic_summary.csv
07_data_analysis/diagnostic_meta/{run_id}/stdout.log
07_data_analysis/diagnostic_meta/{run_id}/stderr.log
08_results_figures/forest_sensitivity_{run_id}.png
08_results_figures/forest_specificity_{run_id}.png
08_results_figures/sroc_{run_id}.png
08_results_figures/diagnostic_summary_{run_id}.csv
```

## Rules

- Fewer than 2 studies: fail clearly.
- Missing TP/FP/FN/TN: exclude record.
- Save all inputs and outputs.
- Do not overwrite previous runs.
- Store run metadata in `meta_analysis_runs`.
- Record R version, package versions, model formula/options, continuity correction, heterogeneity estimator, and excluded rows.
- Fail clearly when required R packages or input columns are missing.
- Do not overwrite previous runs; create a new `{run_id}`.

## Diagnostic guidance

For diagnostic accuracy Meta-analysis, prefer validated diagnostic Meta packages/workflows such as `mada`, `metafor`, or project-specific R scripts that implement bivariate/HSROC-compatible models. If the available package set cannot support the requested model, return a blocker with the missing package/model rather than producing final pooled claims from an unsuitable shortcut.

## Future modules

- prognostic HR meta-analysis;
- binary OR/RR meta-analysis;
- continuous SMD/MD meta-analysis;
- prevalence meta-analysis.
