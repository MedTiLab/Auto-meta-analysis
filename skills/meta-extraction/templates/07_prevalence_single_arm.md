# 07 — Prevalence / single-arm event rate

For studies that report a proportion or rate with no comparator (prevalence reviews, single-arm trial pooling, adverse-event pooling). **One row per arm** (not per comparison).

## Row schema (subset of tidy_estimates.csv)

```text
study_id, reference_id, first_author, year, country, design,
meta_type = "prevalence_single_arm",
outcome_name, outcome_definition, timepoint, timepoint_unit,
comparison_type = "single_arm",
arm_label_t,                                        # the population/arm under measurement
arm_label_c = "",                                   # always empty for single-arm
n_t,                                                # denominator
events_t,                                           # numerator
person_time_t,                                      # only when an incidence rate (per person-time) is the target
denominator_population,                             # e.g. "adults aged 18-65 in primary care registries"
effect_measure ∈ {"proportion","incidence_proportion","incidence_rate","cumulative_incidence"},
effect_value, ci_lower, ci_upper,                   # store the reported proportion or rate
adjusted = false,
evidence_text, source_location, source_priority, confidence, review_status
```

## Staged search

1. **Stage C — Prevalence table / characteristics table**: read denominator and numerator together; do not split across separate rows in your CSV.
2. **Stage B — Results paragraph** for the case definition, the screening instrument, and how non-responders were handled.
3. **Stage A — Abstract** for the headline % and CI.
4. **Stage D — Supplement** for subgroup prevalence by region, age, sex; emit one row per subgroup.

## What to look for

- **Confidence interval method**: capture in `evidence_text` whether the CI is Wilson, Clopper-Pearson, normal-approximation, or unreported. This matters when downstream pooling uses Freeman-Tukey or logit transformation.
- **Numerator definition**: a "case" defined by clinician interview is not the same case definition as a screening cutoff score; both produce a "prevalence" but they cannot be pooled together silently.
- **Denominator type**: clarify in `denominator_population`. Eligible population, respondents, completed-survey subset, weighted population — all give different prevalence values.
- **Incidence rate**: `events_t / person_time_t` with `person_time_t` in person-years. Store the unit in `evidence_text`. Do not mix incidence rate (events per person-time) with incidence proportion (events per N over a fixed period) in the same row.

## What to avoid

- Do **not** average prevalence across subgroups to fill a missing overall prevalence; emit subgroup rows and let `meta-statistics-r` pool.
- Do **not** convert `incidence_rate` to `incidence_proportion` by multiplying by follow-up; the math only works under restrictive assumptions and is downstream work.

## Conflict priority

`main_table` > `supplement` > `results_text` > `abstract`. Abstracts often report a rounded "around 30% prevalence" that masks a clinically meaningful 28.4% vs 32.1% difference between subgroups.

## Example row

```jsonl
{"study_id":"rec_oa_W4280604893__1","reference_id":"rec_oa_W4280604893","skill_name":"meta-extraction.prevalence_single_arm","meta_type":"prevalence_single_arm","first_author":"Patel R","year":2022,"design":"cross_sectional","outcome_name":"Prevalence of depressive symptoms (PHQ-9 ≥ 10)","outcome_definition":"Patient Health Questionnaire-9, cutoff ≥10 for major depressive symptoms; respondents only","comparison_type":"single_arm","arm_label_t":"Healthcare workers, single tertiary hospital","arm_label_c":"","n_t":845,"events_t":253,"denominator_population":"Healthcare workers who returned the PHQ-9 (response rate 71%)","effect_measure":"proportion","effect_value":0.299,"ci_lower":0.268,"ci_upper":0.331,"evidence_text":"Among 845 respondents (response rate 71%), 253 (29.9%, 95% CI 26.8–33.1) scored PHQ-9 ≥ 10 indicating clinically significant depressive symptoms.","source_location":"Results, Table 2","source_priority":"main_table","confidence":0.9,"review_status":"candidate"}
```
