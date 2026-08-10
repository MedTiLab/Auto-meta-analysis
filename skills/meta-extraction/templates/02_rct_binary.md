# 02 — RCT, binary outcome

For randomized (parallel, cluster, or crossover) trials with a binary outcome (event yes/no). One row per (outcome, comparison, timepoint).

## Row schema (subset of tidy_estimates.csv)

Must fill:

```text
study_id, reference_id, first_author, year, country, design = "RCT" | "cluster_RCT" | "crossover_RCT",
meta_type = "rct_binary",
outcome_name, outcome_definition, timepoint, timepoint_unit,
comparison_type = "two_arm" | "multi_arm",
arm_label_t, arm_label_c,
n_t, n_c, events_t, events_c,
effect_measure ∈ {"RR","OR","RD","none"}, effect_value, ci_lower, ci_upper, se, p_value,
adjusted (always false for crude trial counts; true only if model-adjusted),
evidence_text, source_location, source_priority, confidence, review_status
```

Set unrelated columns (mean_*, HR, TP/FP/FN/TN, sensitivity, ...) empty.

## Staged search

Stop early if the row is complete from a higher-priority source.

1. **Stage C — Main results table first** (highest priority for counts). Look for a "Primary outcome", "Outcomes", or "Efficacy" table in MinerU MD. Match column headers like `n/N`, `Events (n)`, `Total (N)`, `%`, `Arm`, `Group`. Read the row whose label matches `outcome_name`. Read both arms.
2. **Stage B — Results paragraph** referencing the table for `outcome_name`. Confirms timepoint, defines outcome, confirms ITT vs PP.
3. **Stage A — Abstract** for the headline `RR / OR / RD (95% CI), p = ...`. Use only if Stage C is incomplete; record as a second candidate row when Stage C succeeded, so the validator can cross-check.
4. **Stage D — Supplement** if the main table only shows the pooled comparison and per-arm counts are in the appendix.
5. **Stage E — Forest plot text** if neither table nor text gives per-arm counts but a forest plot of subgroups does.

## What to look for

- **Outcome label fidelity**: copy the outcome name verbatim, including timepoint suffix if present ("Death within 28 days", "Symptomatic VTE at week 12"). Do not paraphrase. `outcome_definition` may add a short clinician-readable paraphrase.
- **Denominator**: prefer the ITT denominator. If the paper reports both ITT and per-protocol, emit two rows with `outcome_definition` carrying `(ITT)` and `(PP)`. If only modified ITT (mITT) is reported, write `(mITT)` and `needs_review_reason = "denominator_mITT"`.
- **Effect measure choice**: write what the paper reports. Do **not** convert RR↔OR. The validator only checks internal consistency between 2×2 counts and the reported effect when both are available.
- **Multi-arm trials**: emit one row per pairwise comparison the paper actually performs (e.g. dose A vs control, dose B vs control). The shared control arm appears in both rows; flag with `comparison_type = "multi_arm"` and the same `arm_label_c`. `treatment-arm-normalizer` style normalization is up to the user, not this skill.
- **Cluster / crossover**: the design code captures it, but you must record the ICC or design effect in `evidence_text` if reported, because R `meta` will need it for unit-of-analysis correction.

## What to avoid (this is where naive regex fails)

- Do **not** treat the first `n = NNNN` you see in the paper as `n_t` or `n_c`. The total sample size shows up dozens of times in any RCT paper. Anchor `n_t` and `n_c` to a row whose label matches the arm name or to a "(treatment) n=NNN" parenthetical immediately adjacent to the event count.
- Do **not** read `events_t` from a sentence summarizing both arms ("a total of 28 events occurred"). Anchor it to the per-arm value.
- Do **not** read a per-protocol count when ITT is the paper's primary analysis.
- Do **not** mix percentages and raw counts. If a table gives `28 (8.2%)` use `28`, not `8.2`. Validate by re-computing the percentage; if mismatch >1%, mark `needs_review_reason = "count_percent_mismatch"`.

## Conflict priority for this type

`main_table` > `supplement` > `forest_plot_text` > `results_text` > `abstract`. Reason: abstract numbers are commonly rounded or summarised; tables are typeset directly from the analysis dataset.

## Example output rows

```jsonl
{"study_id":"rec_pm_27498949__1","reference_id":"rec_pm_27498949","skill_name":"meta-extraction.rct_binary","meta_type":"rct_binary","first_author":"Jones A","year":2017,"country":"UK","design":"RCT","outcome_name":"Mortality within 28 days","outcome_definition":"All-cause death within 28 days (ITT)","timepoint":28,"timepoint_unit":"days","comparison_type":"two_arm","arm_label_t":"Drug X 50 mg","arm_label_c":"Placebo","n_t":312,"n_c":315,"events_t":28,"events_c":47,"effect_measure":"RR","effect_value":0.60,"ci_lower":0.39,"ci_upper":0.92,"p_value":0.018,"adjusted":false,"evidence_text":"Twenty-eight of 312 patients (9.0%) in the Drug X group and 47 of 315 (14.9%) in the placebo group died within 28 days (RR 0.60, 95% CI 0.39 to 0.92; p=0.018).","source_location":"Results, paragraph 2; Table 2, row 'Death within 28 days'","source_priority":"main_table","confidence":0.92,"review_status":"candidate"}
```

## Hand-off

After this row is written, the validator will (a) recompute RR from the 2×2 and flag mismatch >5% relative, (b) check `events_t ≤ n_t` and `events_c ≤ n_c`, (c) derive `se = (ln(upper) − ln(lower)) / (2 × 1.96)` for downstream `meta::metabin(..., sm="RR")`.
