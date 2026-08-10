# 05 — Prognostic / survival hazard ratio

For studies that report Cox-model or otherwise time-to-event HRs for endpoints like OS, PFS, DFS, RFS, EFS, MFS, BCSS, CSS, TTP. One row per (endpoint, comparison, adjustment level).

## Row schema (subset of tidy_estimates.csv)

Must fill:

```text
study_id, reference_id, first_author, year, design,
meta_type = "prognostic_hr",
outcome_name ∈ {"OS","PFS","DFS","RFS","EFS","MFS","CSS","BCSS","TTP","other"} | free-text endpoint label,
outcome_definition,                                  # e.g. "time from randomization to death from any cause"
timepoint, timepoint_unit,                           # optional landmark for time-stratified HR
comparison_type, arm_label_t, arm_label_c,           # treatment vs control, or biomarker high vs low
n_t, n_c, events_t, events_c,                        # events = deaths/progressions, when reported
effect_measure ∈ {"HR","aHR"}, effect_value, ci_lower, ci_upper, se, p_value,
adjusted, covariates,
evidence_text, source_location, source_priority, confidence, review_status
```

## Staged search

1. **Stage C — Survival results table** (commonly Table 3 or "Univariable / Multivariable Cox" table). Match `HR (95% CI)` per endpoint and per comparison. Capture event counts and `n` per arm from the same table when present.
2. **Stage E — Forest plot text** is *equal-priority* with main_table for prognostic Meta. Forest plots in survival papers carry HRs for subgroups that the body text never lists. If MinerU exported the figure as text, use it.
3. **Stage B — Results paragraph** for the primary endpoint headline HR and for the definition of the endpoint (right-censoring rule, follow-up cutoff).
4. **Stage A — Abstract** for the headline HR. Often the only place that gives the *primary* HR; use it but write `source_priority = "abstract"` so the validator down-weights it relative to a same-value table row.
5. **Stage D — Supplement** for per-subgroup HRs, sensitivity-adjusted models, and competing-risks sub-distribution HRs (subHR).
6. **KM-only papers**: if no Cox HR is reported but a Kaplan-Meier figure + median survival + log-rank `p` are available, do **not** invent an HR. Write a row with `effect_value = null` and `needs_review_reason = "HR_must_be_digitized_from_KM"` and stop. Tierney 2007 reconstruction is a downstream step.

## What to look for

- **Endpoint definition discipline**: when the paper writes "PFS" but the methods define it as "time to documented progression or death from any cause", record both. Two papers using different PFS definitions cannot be pooled silently.
- **Adjusted vs unadjusted**: emit separate rows (same convention as template 04).
- **Direction of effect**: `HR < 1` means lower hazard in the treatment / high-marker arm; verify against the abstract narrative. If the narrative says "marker high group had *worse* survival" but the table HR is 0.45, you have an arm-label swap — set `needs_review_reason = "direction_inconsistent_with_narrative"`.
- **Competing risks**: if the paper uses Fine-Gray, store the value as a subdistribution HR (`sHR`) in `effect_measure` and note the competing event in `outcome_definition`.
- **Events at risk**: `events_t` and `events_c` (deaths or progressions) are useful for downstream weighting (Parmar method). Capture when present.
- **Per-unit HR**: if HR is "per 1 SD increase in biomarker" or "per 10-unit increase", capture the unit in `outcome_definition` and the comparison string in `arm_label_t` / `arm_label_c` as the verbatim spec; do not coerce into binary high-vs-low rows.

## What to avoid

- Do **not** invert HRs to make them all <1. Pool on the scale the paper used; downstream R code handles inversion.
- Do **not** combine OS and PFS in one row even if the HRs happen to coincide.
- Do **not** read median follow-up months and write it into `timepoint`; `timepoint` here is a landmark used for the HR computation, not the median follow-up of the whole study.
- Do **not** read `HR for death` and `HR for progression-free survival` and assume they share the same `events` count.

## Conflict priority

`main_table` ≈ `forest_plot_text` > `supplement` > `results_text` > `abstract`. Survival forest plots are heavily relied on in oncology Meta and are usually accurate.

## Validator behavior for this type

Always derive `se = (ln(ci_upper) − ln(ci_lower)) / (2 × 1.96)` and store it. This is the only column the validator may fill from existing fields, and the row remains `review_status = candidate` (not auto-downgraded), because this derivation is exact when the CI was symmetric on the log scale.

## Example row

```jsonl
{"study_id":"rec_pm_34869441__1","reference_id":"rec_pm_34869441","skill_name":"meta-extraction.prognostic_hr","meta_type":"prognostic_hr","first_author":"Wang Y","year":2022,"design":"cohort_retrospective","outcome_name":"OS","outcome_definition":"Time from surgery to death from any cause; right-censored at last follow-up","timepoint":null,"timepoint_unit":"","comparison_type":"two_arm","arm_label_t":"miR-21 high (above median 1.5 ng/mL)","arm_label_c":"miR-21 low (below median)","n_t":120,"n_c":118,"events_t":58,"events_c":33,"effect_measure":"aHR","effect_value":2.10,"ci_lower":1.32,"ci_upper":3.34,"se":null,"p_value":0.002,"adjusted":true,"covariates":"age, sex, T stage, N stage, grade, adjuvant chemo","evidence_text":"After adjustment for clinicopathological covariates, high miR-21 expression was independently associated with worse OS (aHR 2.10, 95% CI 1.32-3.34; p=0.002).","source_location":"Results, Table 3 multivariable Cox","source_priority":"main_table","confidence":0.9,"review_status":"candidate"}
```
