# 04 — Observational OR / RR / IRR

For cohort, case-control, or cross-sectional studies that report odds ratios, relative risks, or incidence rate ratios for a binary outcome. One row per (outcome, comparison, timepoint, adjustment level).

## Row schema (subset of tidy_estimates.csv)

Must fill:

```text
study_id, reference_id, first_author, year, design ∈ {"cohort_prospective","cohort_retrospective","case_control","cross_sectional"},
meta_type = "observational_or_rr",
outcome_name, outcome_definition, timepoint, timepoint_unit,
comparison_type, arm_label_t, arm_label_c,
n_t, n_c, events_t, events_c,              # when reported; not required
person_time_t, person_time_c,              # for IRR
effect_measure ∈ {"OR","aOR","RR","aRR","IRR","aIRR","HR"=hazard but not survival framework, see template 05},
effect_value, ci_lower, ci_upper, se, p_value,
adjusted ∈ {true, false}, covariates,
evidence_text, source_location, source_priority, confidence, review_status
```

## Staged search

1. **Stage C — Multivariable model table** (often Table 3): adjusted estimates with covariates listed in the table footnote or the legend. **Adjusted estimates are the primary target** for most observational Meta.
2. **Stage C-bis — Crude / univariable table** (often Table 2): unadjusted estimates. Emit a separate row with `adjusted = false`.
3. **Stage B — Results paragraph** for context: comparison categories, exposure definition, reference category, sample restriction.
4. **Stage A — Abstract**: headline aOR / aHR with CI. Often rounded; use as cross-check only.
5. **Stage D — Supplement** for additional models (sensitivity, alternative adjustment sets).

## What to look for

- **Adjusted vs unadjusted: always two separate rows.** The downstream analyst chooses which one enters the pool. Pooling them silently is a common reviewer rejection trigger.
- **Covariate set**: copy the footnote verbatim into `covariates`. Example: `"age, sex, BMI, smoking pack-years, diabetes, statin use, education"`. This is what enables a meta-regression on adjustment quality later.
- **Reference category**: capture in `arm_label_c` and in `outcome_definition`. For dose categories use template `08_dose_response.md`.
- **OR vs RR vs HR**: respect what the paper labels. Case-control studies report OR; cohort studies often report RR or HR depending on whether time-to-event was modelled. A "hazard ratio" from a Cox model in a cohort with time-to-event belongs to template 05, not here.
- **Counts when reported**: even if the paper reports only an adjusted OR, fill `events_t/n_t/events_c/n_c` if a 2×2 or rates table provides them. This lets sensitivity analyses use both crude and adjusted.

## What to avoid

- Do **not** convert OR to RR for common outcomes. Note the issue in `needs_review_reason = "OR_used_when_outcome_common"` if the event rate exceeds ~10%; let the analyst decide.
- Do **not** assume covariate sets are identical across models in the same paper. Re-read each table footnote.
- Do **not** mark a univariable estimate as `adjusted = true` just because the paper used a multivariable cohort design overall.

## Conflict priority

`main_table` > `supplement` > `results_text` > `abstract`. Forest plots are uncommon in observational papers; if present they hold subgroup-level estimates that go to template 08 or to subgroup-analysis bookkeeping.

## Example rows (one paper, two rows)

```jsonl
{"study_id":"rec_pm_30982178__1","reference_id":"rec_pm_30982178","skill_name":"meta-extraction.observational_or_rr","meta_type":"observational_or_rr","first_author":"García M","year":2019,"design":"cohort_prospective","outcome_name":"Incident depression","outcome_definition":"Self-reported physician-diagnosed depression at follow-up","timepoint":8.4,"timepoint_unit":"years (median)","comparison_type":"two_arm","arm_label_t":"Highest Mediterranean diet score quartile (Q4)","arm_label_c":"Lowest quartile (Q1, reference)","n_t":2200,"n_c":2210,"events_t":190,"events_c":255,"effect_measure":"aHR","effect_value":0.74,"ci_lower":0.61,"ci_upper":0.90,"p_value":0.003,"adjusted":true,"covariates":"age, sex, BMI, smoking, physical activity, total energy, baseline depressive symptoms, education","evidence_text":"In the fully adjusted model the highest vs lowest quartile of MDS was associated with a 26% lower risk of incident depression (aHR 0.74, 95% CI 0.61-0.90; p=0.003).","source_location":"Results, paragraph 3; Table 3 row 'Q4 vs Q1'","source_priority":"main_table","confidence":0.9,"review_status":"candidate"}
{"study_id":"rec_pm_30982178__2","reference_id":"rec_pm_30982178","skill_name":"meta-extraction.observational_or_rr","meta_type":"observational_or_rr","first_author":"García M","year":2019,"design":"cohort_prospective","outcome_name":"Incident depression","outcome_definition":"Self-reported physician-diagnosed depression at follow-up","timepoint":8.4,"timepoint_unit":"years (median)","comparison_type":"two_arm","arm_label_t":"Q4","arm_label_c":"Q1","n_t":2200,"n_c":2210,"events_t":190,"events_c":255,"effect_measure":"HR","effect_value":0.69,"ci_lower":0.58,"ci_upper":0.83,"p_value":0.0001,"adjusted":false,"covariates":"","evidence_text":"Unadjusted HR for Q4 vs Q1 was 0.69 (95% CI 0.58-0.83).","source_location":"Table 3, crude column","source_priority":"main_table","confidence":0.88,"review_status":"candidate"}
```
