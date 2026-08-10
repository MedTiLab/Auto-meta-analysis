# 06 — Diagnostic test accuracy (DTA)

For diagnostic accuracy studies that report 2×2 counts of an index test against a reference standard at a given threshold. One row per (index_test, reference_standard, threshold).

## Routing

This template is the **bridge** between `meta-extraction` and the project's existing, more detailed skill `diagnostic-data-extraction`. When the router tags a paper as `diagnostic_dta`:

1. **First** follow `diagnostic-data-extraction/SKILL.md` for the actual field-by-field extraction. That skill already encodes the strict DTA rules (no inferring TP/FP/FN/TN from sensitivity/specificity alone unless `derived: true`, QUADAS-2 signals, sample types, assay methods).
2. **Then** mirror the row into this skill's `by_type/diagnostic_dta.csv` so that `meta-statistics-r` and `diagnostic-meta-analysis` can read a unified header from `tidy_estimates.csv`.
3. Do **not** re-implement TP/FP/FN/TN derivation here. The DTA-specific rules belong to `diagnostic-data-extraction`.

## Row schema (subset of tidy_estimates.csv)

```text
study_id, reference_id, first_author, year, country, design = "diagnostic_accuracy",
meta_type = "diagnostic_dta",
outcome_name = "<index_test> vs <reference_standard> at threshold <x>",
outcome_definition,                              # what is the target condition; what is the index test result interpretation
timepoint, timepoint_unit,                       # rarely used; only when test repeated at fixed times
comparison_type = "single_test" | "comparative_dta",
arm_label_t = "test_positive_definition", arm_label_c = "test_negative_definition",
TP, FP, FN, TN,
threshold, index_test, reference_standard, sample_type, assay_method,
sensitivity, specificity, ppv, npv, auc, dor,
effect_measure ∈ {"DTA_2x2","DTA_sens_spec_only","DTA_AUC_only"},
adjusted = false,                                # DTA accuracy estimates are not "adjusted" in the regression sense
evidence_text, source_location, source_priority, confidence, review_status
```

## Source-of-truth rule

`TP/FP/FN/TN` from a direct 2×2 table or explicit text statement are the only values that may be written without `derived: true`. Any of the following must carry `derived: true` and `review_status = needs_review`:

- TP/FP/FN/TN inferred from `sensitivity` + case n, or from `specificity` + control n.
- Cells inferred from "agreement" or "Cohen kappa".
- Cells inferred from a confusion matrix when row/column totals are partially missing.

## Staged search

1. **Stage C — DTA 2×2 table** (highest priority; usually Table 2 or Table 3). Match the index test, the threshold, and the reference standard label.
2. **Stage B — Methods + Results paragraph** for the threshold definition and the reference standard composition.
3. **Stage A — Abstract** for headline sensitivity/specificity/AUC; use as cross-check only.
4. **Stage D — Supplement** for per-subgroup 2×2 (e.g. per tumor histology), per-threshold ROC tables, and per-reader DTA in imaging studies.

## Comparative DTA

When the paper compares two index tests on the same patients, emit one row per index test against the same reference standard. The `paired` design must be noted in `outcome_definition` (e.g. `"paired comparison vs CT in the same 320 patients"`); the downstream `diagnostic-meta-analysis` skill handles paired vs unpaired pooling.

## Conflict priority

`main_table` > `supplement` > `results_text` > `abstract`. Sensitivity/specificity in the abstract are very often rounded and exclude indeterminate results.

## Example row

```jsonl
{"study_id":"rec_oa_W4411730544__1","reference_id":"rec_oa_W4411730544","skill_name":"meta-extraction.diagnostic_dta","meta_type":"diagnostic_dta","first_author":"Liu H","year":2024,"design":"diagnostic_accuracy","outcome_name":"Serum miR-21 vs biopsy at cutoff 1.5 ng/mL","outcome_definition":"Index test: serum miR-21 by qRT-PCR. Reference standard: tissue biopsy with pathology adjudication. Target condition: hepatocellular carcinoma.","comparison_type":"single_test","arm_label_t":"miR-21 ≥ 1.5 ng/mL","arm_label_c":"miR-21 < 1.5 ng/mL","TP":45,"FP":8,"FN":12,"TN":60,"threshold":"1.5 ng/mL","index_test":"serum miR-21 by qRT-PCR","reference_standard":"tissue biopsy with pathology adjudication","sample_type":"serum","assay_method":"qRT-PCR","sensitivity":0.789,"specificity":0.882,"auc":0.86,"effect_measure":"DTA_2x2","adjusted":false,"evidence_text":"Of 125 patients, 45 of 57 HCC cases were correctly classified by miR-21 (TP), while 8 of 68 non-HCC controls were false positives (FP); 12 cases were missed (FN) and 60 controls correctly classified (TN).","source_location":"Results, Table 2","source_priority":"main_table","confidence":0.92,"review_status":"candidate"}
```
