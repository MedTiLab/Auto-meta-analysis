# 08 — Dose-response / categorical exposure

For studies that analyze an exposure as ordered categories (quartiles, tertiles, mg/day bands) or as a per-unit increment, with a defined reference category. **One row per non-reference category** plus one row for the reference itself (carrying `effect_value = 1.0` and CI fields empty).

## Row schema (subset of tidy_estimates.csv)

```text
study_id, reference_id, first_author, year, design,
meta_type = "dose_response",
outcome_name, outcome_definition, timepoint, timepoint_unit,
comparison_type = "categorical_vs_reference",
arm_label_t = "<category label>",                # e.g. "Q3 (12.1-18.3 mg/day)"
arm_label_c = "<reference category label>",      # e.g. "Q1 (<5.0 mg/day, reference)"
n_t, events_t,                                   # per-category counts when reported
n_c, events_c,                                   # reference category counts when reported (same on every row)
dose_level, dose_unit, reference_dose,           # e.g. dose_level="15.2", dose_unit="mg/day", reference_dose="<5.0"
effect_measure ∈ {"OR","aOR","RR","aRR","HR","aHR","IRR","aIRR"},
effect_value, ci_lower, ci_upper, se, p_value,  # reference row: effect_value=1.0, others empty
adjusted, covariates,
p_trend,                                         # if reported in the same table footnote / row
evidence_text, source_location, source_priority, confidence, review_status
```

(`p_trend` is a per-table-row metadata field; it is not part of the canonical CSV header — write it into `evidence_text` if the header does not include it.)

## Staged search

1. **Stage C — Categorical exposure table** with one header per category and a footer giving `p for trend`. Read each row.
2. **Stage B — Results paragraph** that defines the categorical cuts, the reference category, and the comparison the authors highlight.
3. **Stage A — Abstract** for headline "highest vs lowest" estimate. Emit as one row but note in `evidence_text` that intermediate categories may be missing.
4. **Stage D — Supplement** when the body table is collapsed (Q1, Q4 only) but the full per-tertile table is in the appendix.

## What to look for

- **Category bounds**: capture verbatim in `dose_level` if a midpoint or range is reported (`"12.1-18.3 mg/day"`). Without bounds, dose-response Meta (GLST / one-stage) cannot run.
- **Reference category**: must appear as a row with `effect_value = 1.0` and `ci_lower = ci_upper = ""`. This row is what downstream code keys on.
- **Per-unit increment** ("per 10 mg/day increase"): emit a *separate* `meta_type = "dose_response"` row with `comparison_type = "per_unit_increment"`, `arm_label_t = "per 10 mg/day"`, `arm_label_c = "—"`, and `dose_level = "10"`, `dose_unit = "mg/day"`.
- **`p_trend`**: capture as a numeric in `evidence_text` per row, e.g. `"p for trend = 0.003"`.

## What to avoid

- Do **not** drop the reference row; it is needed for two-stage dose-response code.
- Do **not** invent category midpoints when only "Q1, Q2, Q3, Q4" labels are given. Leave `dose_level` empty and set `needs_review_reason = "category_midpoint_unreported"`.
- Do **not** merge the per-unit increment and the per-category estimates into one row.

## Conflict priority

`main_table` > `supplement` > `results_text` > `abstract`.

## Example rows

```jsonl
{"study_id":"rec_pm_28557499__1","reference_id":"rec_pm_28557499","skill_name":"meta-extraction.dose_response","meta_type":"dose_response","first_author":"Brown S","year":2018,"design":"cohort_prospective","outcome_name":"Incident depression","outcome_definition":"Self-reported clinician-diagnosed depression at follow-up","timepoint":7.1,"timepoint_unit":"years (median)","comparison_type":"categorical_vs_reference","arm_label_t":"Q1 (<2 servings/week of fish, reference)","arm_label_c":"Q1 (<2 servings/week of fish, reference)","dose_level":"<2","dose_unit":"servings/week","reference_dose":"<2","effect_measure":"aHR","effect_value":1.00,"ci_lower":null,"ci_upper":null,"adjusted":true,"covariates":"age, sex, BMI, smoking, total energy intake","evidence_text":"Reference category (Q1, <2 servings/week of fish). p for trend = 0.02.","source_location":"Table 3 row 1","source_priority":"main_table","confidence":0.92,"review_status":"candidate"}
{"study_id":"rec_pm_28557499__2","reference_id":"rec_pm_28557499","skill_name":"meta-extraction.dose_response","meta_type":"dose_response","first_author":"Brown S","year":2018,"design":"cohort_prospective","outcome_name":"Incident depression","outcome_definition":"Self-reported clinician-diagnosed depression at follow-up","timepoint":7.1,"timepoint_unit":"years (median)","comparison_type":"categorical_vs_reference","arm_label_t":"Q4 (≥5 servings/week of fish)","arm_label_c":"Q1 (<2 servings/week of fish, reference)","dose_level":"≥5","dose_unit":"servings/week","reference_dose":"<2","effect_measure":"aHR","effect_value":0.78,"ci_lower":0.65,"ci_upper":0.94,"adjusted":true,"covariates":"age, sex, BMI, smoking, total energy intake","evidence_text":"Compared with Q1 (<2 servings/week), Q4 (≥5 servings/week) was associated with lower risk of incident depression (aHR 0.78, 95% CI 0.65-0.94). p for trend = 0.02.","source_location":"Table 3 row 4","source_priority":"main_table","confidence":0.9,"review_status":"candidate"}
```
