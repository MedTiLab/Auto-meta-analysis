# Conflict resolution priority

When the same (study, outcome, comparison, timepoint, adjustment) tuple yields more than one candidate row from different `source_priority` stages, do **not** silently overwrite. Keep all candidates and resolve in two layers.

## Layer 1 — Built-in source priority per type

| meta_type                 | Priority order (highest → lowest)                                                                 |
|---------------------------|---------------------------------------------------------------------------------------------------|
| `rct_binary`              | `main_table` > `supplement` > `forest_plot_text` > `results_text` > `abstract`                    |
| `rct_continuous`          | `main_table` > `supplement` > `results_text` > `forest_plot_text` > `abstract`                    |
| `observational_or_rr`     | `main_table` > `supplement` > `results_text` > `abstract`                                         |
| `prognostic_hr`           | `main_table` ≈ `forest_plot_text` > `supplement` > `results_text` > `abstract`                    |
| `diagnostic_dta`          | `main_table` > `supplement` > `results_text` > `abstract`                                         |
| `prevalence_single_arm`   | `main_table` > `supplement` > `results_text` > `abstract`                                         |
| `dose_response`           | `main_table` > `supplement` > `results_text` > `abstract`                                         |

For each conflict group, pick the row whose `source_priority` is highest in this order and stamp it `preferred = true`. The other rows stay in `extraction_candidates.jsonl` with `preferred = false`.

## Layer 2 — Magnitude-of-disagreement gate

If the highest-priority row and the next row disagree on the point estimate by:

- For ratio measures (`OR/RR/HR/IRR`): `|ratio − 1| > 0.05 × ratio`, i.e. more than 5% relative on the ratio scale.
- For raw measures (`MD/SMD/proportion/incidence_rate`): `|x_high − x_low| > 0.05 × |x_high|`.
- For DTA (`sensitivity/specificity/AUC`): absolute difference > 0.02.

then **both** rows are stamped `review_status = needs_review` and a `conflict_group_id` (UUID) is shared by all rows in the group. The reason is `"conflicting_estimates_across_sources"`.

If the disagreement is below the gate, only the lower-priority row is stamped `superseded` and the preferred row remains `candidate`.

## Layer 3 — Abstract-only contradictions

If the only candidate is from the abstract and a higher-priority source exists in the paper but the extractor could not parse it, the row gets `needs_review_reason = "abstract_only_no_table_parsed"`. This is a signal to the analyst to manually look at the MinerU table that was probably mis-segmented.

## What the user/analyst does

The user opens `extraction_review.csv` (a flat view of the JSONL filtered to `preferred = true` plus all rows in a `conflict_group_id`) and confirms / edits. Their `review_status = confirmed` is the terminal state; the skill must not overwrite it on re-runs (see SKILL.md non-negotiable rule #5).

## Edge cases

1. **Two main_table rows disagree.** This happens when the paper reports both ITT and PP in the same table. Both rows stay `preferred = true` because their `outcome_definition` differs; the agent should have set `outcome_definition` so they do not actually share the same tuple key. If they truly share the same key, the agent made an error and the row should be tagged `needs_review_reason = "duplicate_main_table_rows"`.
2. **Forest plot value differs from main table by exactly 0.01.** Rounding. Use the table.
3. **Abstract reports HR = 0.7, table reports HR = 0.69, supplement reports HR = 0.6936.** Use the supplement; the supplement is usually the unrounded source for oncology Cox HRs.
