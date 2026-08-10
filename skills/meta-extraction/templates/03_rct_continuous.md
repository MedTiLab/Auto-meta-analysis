# 03 — RCT, continuous outcome

For randomized trials with a continuous outcome (score, lab value, change-from-baseline). One row per (outcome, comparison, timepoint), with both arms inline.

## Row schema (subset of tidy_estimates.csv)

Must fill:

```text
study_id, reference_id, first_author, year, design = "RCT" | "cluster_RCT" | "crossover_RCT",
meta_type = "rct_continuous",
outcome_name, outcome_definition, timepoint, timepoint_unit,
comparison_type, arm_label_t, arm_label_c,
n_t, n_c,
mean_t, sd_t, mean_c, sd_c,                              # final-value
change_mean_t, change_sd_t, change_mean_c, change_sd_c,  # change-from-baseline
effect_measure ∈ {"MD","SMD","WMD","LSMeanDiff","none"}, effect_value, ci_lower, ci_upper, se, p_value,
adjusted, covariates,
evidence_text, source_location, source_priority, confidence, review_status
```

Set unrelated columns (events_*, HR, TP/FP/FN/TN, ...) empty.

## Staged search

1. **Stage C — Per-arm summary table** (Table 2 or similar). Read columns `n`, `Mean (SD)`, `Median (IQR)`, `Change from baseline (SD)`, `LS mean (SE)`. **Do not blend final-value and change-from-baseline rows**; emit two separate rows if both are reported.
2. **Stage B — Results paragraph** confirming timepoint, defining outcome (which instrument, which scoring direction).
3. **Stage A — Abstract** for `MD (95% CI)` or `LS mean difference (95% CI)`. Used only when Stage C is incomplete or as cross-check.
4. **Stage D — Supplement** for per-subgroup or per-timepoint long-form tables.
5. **Stage E — Forest plot text** if effect-size figures are the only source for `MD` in subgroup analyses.

## What to look for

- **SE vs SD**: distinguish carefully. `SE` in a per-arm summary table is suspicious if `n` is large and `SD/√n` is much smaller; the validator checks `SE × √n ≈ SD` within tolerance. If the paper writes `mean ± SE`, capture that, set the field as `se_t / se_c`, and mark `needs_review_reason = "se_reported_not_sd"` so the analyst can decide to convert.
- **Median (IQR) only**: capture it verbatim into `mean_t`, `sd_t` only if you also fill `median_t`, `q1_t`, `q3_t` in a separate row. Otherwise leave `mean_t`/`sd_t` empty and set `needs_review_reason = "only_median_iqr"`. Wan/Hozo/Bland conversions are done downstream, not here.
- **Change-from-baseline**: prefer the paper-reported change_SD over re-deriving from baseline and final SDs. Re-derivation needs the within-person correlation, which is almost never reported.
- **Direction of effect**: capture `higher_is_better` in `outcome_definition` when known (e.g. HDRS depression score: lower is better; SF-36 physical: higher is better). This is what saves downstream forest plots from sign errors.
- **Instrument and version**: record in `outcome_definition`, e.g. `"HAMD-17"`, `"PHQ-9"`, `"VAS 0–100"`. Required for SMD pooling decisions.

## What to avoid

- Do **not** average `mean_t` across timepoints. Emit one row per timepoint.
- Do **not** read `(SE)` and store it as `sd_t`. Naive extractors do this constantly and produce garbage pooled estimates.
- Do **not** invent a baseline mean to compute a change score; if the paper reports only a final-value comparison, leave change-* fields empty.
- Do **not** assume the same `n_t` across timepoints; LOCF, BOCF, mixed-model, and observed-case denominators all differ. If the paper does not say which, mark `needs_review_reason = "denominator_at_timepoint_unclear"`.

## Conflict priority

`main_table` > `supplement` > `results_text` > `forest_plot_text` > `abstract`. Abstracts very often report a single "between-group MD at end of treatment" and skip the per-arm summary that downstream methods need.

## Example row

```jsonl
{"study_id":"rec_pm_26344165__1","reference_id":"rec_pm_26344165","skill_name":"meta-extraction.rct_continuous","meta_type":"rct_continuous","first_author":"Lee K","year":2016,"design":"RCT","outcome_name":"HAMD-17 total at week 8","outcome_definition":"Hamilton Depression Rating Scale 17-item, lower is better, change from baseline","timepoint":8,"timepoint_unit":"weeks","comparison_type":"two_arm","arm_label_t":"Mindfulness + TAU","arm_label_c":"TAU","n_t":58,"n_c":61,"change_mean_t":-7.2,"change_sd_t":4.6,"change_mean_c":-3.9,"change_sd_c":5.1,"effect_measure":"MD","effect_value":-3.3,"ci_lower":-5.0,"ci_upper":-1.6,"p_value":0.0002,"adjusted":true,"covariates":"baseline HAMD-17, age, sex","evidence_text":"At week 8 the mean change in HAMD-17 was -7.2 (SD 4.6) in the intervention group (n=58) versus -3.9 (SD 5.1) in TAU (n=61); adjusted MD -3.3 (95% CI -5.0 to -1.6, p<0.001).","source_location":"Results, primary outcome paragraph; Table 2","source_priority":"main_table","confidence":0.9,"review_status":"candidate"}
```
