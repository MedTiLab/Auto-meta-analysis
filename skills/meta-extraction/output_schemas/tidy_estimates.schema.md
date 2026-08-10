# tidy_estimates.csv — canonical schema

This is the single, type-agnostic table the agent emits to `05_data_extraction/tidy_estimates.csv` and (filtered per type) to `05_data_extraction/by_type/*.csv`. Every row is one independent estimate, keyed by:

```text
(reference_id, meta_type, outcome_name, comparison_type, arm_label_t, arm_label_c, timepoint, adjusted, source_priority)
```

The CSV is a *long* table. Each row fills only the columns its `meta_type` needs; the rest stay empty. This keeps R `meta`/`metafor` and Python `statsmodels` ingestion trivial.

## Columns (in order)

| # | column                       | type    | required for meta_type(s)                                                | notes                                                                       |
|---|------------------------------|---------|--------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| 1 | `study_id`                   | string  | all                                                                      | `<reference_id>__<row_index>`; unique row identifier                        |
| 2 | `reference_id`               | string  | all                                                                      | Folder name under `04_full_text_review/fulltext/`                           |
| 3 | `first_author`               | string  | all                                                                      | Surname + initial(s)                                                        |
| 4 | `year`                       | int     | all                                                                      | Publication year                                                            |
| 5 | `country`                    | string  | recommended                                                              | Empty if unstated                                                           |
| 6 | `design`                     | enum    | all                                                                      | See `01_study_metadata.md` for the controlled vocabulary                    |
| 7 | `meta_type`                  | enum    | all                                                                      | `rct_binary` / `rct_continuous` / `observational_or_rr` / `prognostic_hr` / `diagnostic_dta` / `prevalence_single_arm` / `dose_response` |
| 8 | `outcome_name`               | string  | all                                                                      | Verbatim outcome label                                                      |
| 9 | `outcome_definition`         | string  | all                                                                      | Clinician-readable definition; include ITT/PP, instrument version, endpoint definition |
| 10 | `timepoint`                 | float   | rct_*, prognostic, observational                                         | Numeric only; unit in next column                                            |
| 11 | `timepoint_unit`            | string  | with timepoint                                                            | `days`, `weeks`, `months`, `years`                                          |
| 12 | `comparison_type`           | enum    | all                                                                      | `two_arm` / `multi_arm` / `single_arm` / `single_test` / `comparative_dta` / `categorical_vs_reference` / `per_unit_increment` |
| 13 | `arm_label_t`               | string  | all                                                                      | Treatment arm / exposed / test-positive / category                          |
| 14 | `arm_label_c`               | string  | comparator types                                                          | Control arm / reference / test-negative; empty for `single_arm`             |
| 15 | `n_t`                       | int     | rct_*, observational_or_rr, prognostic_hr (when reported), prevalence    | Denominator of treatment / arm                                              |
| 16 | `n_c`                       | int     | comparator types when reported                                            |                                                                             |
| 17 | `events_t`                  | int     | rct_binary, observational_or_rr (when reported), prognostic_hr (events), prevalence | Numerator                                                                   |
| 18 | `events_c`                  | int     | comparator types when reported                                            |                                                                             |
| 19 | `mean_t`                    | float   | rct_continuous (final value)                                              | Per-arm mean                                                                |
| 20 | `sd_t`                      | float   | with mean_t                                                               | Per-arm SD (NOT SE)                                                         |
| 21 | `mean_c`                    | float   | rct_continuous                                                            |                                                                             |
| 22 | `sd_c`                      | float   | with mean_c                                                               |                                                                             |
| 23 | `change_mean_t`             | float   | rct_continuous (change from baseline)                                     |                                                                             |
| 24 | `change_sd_t`               | float   | with change_mean_t                                                        |                                                                             |
| 25 | `change_mean_c`             | float   | rct_continuous                                                            |                                                                             |
| 26 | `change_sd_c`               | float   | with change_mean_c                                                        |                                                                             |
| 27 | `effect_measure`            | enum    | most rows                                                                 | `RR` / `OR` / `aOR` / `RD` / `MD` / `SMD` / `WMD` / `LSMeanDiff` / `HR` / `aHR` / `IRR` / `aIRR` / `DTA_2x2` / `proportion` / `incidence_rate` / `none` |
| 28 | `effect_value`              | float   | most rows                                                                 | Native scale (OR not lnOR); reference rows in dose_response carry 1.0       |
| 29 | `ci_lower`                  | float   | with effect_value when reported                                           |                                                                             |
| 30 | `ci_upper`                  | float   | with effect_value when reported                                           |                                                                             |
| 31 | `se`                        | float   | may be derived by validator                                               | On log scale for ratios is *not* stored here; this is the SE of `effect_value` on its native scale or the lnSE the validator filled — column `se_scale` would be needed; keep raw `se` and document in evidence_text |
| 32 | `p_value`                   | float   | when reported                                                              |                                                                             |
| 33 | `adjusted`                  | bool    | all observational/regression rows                                          | `true` if model-adjusted; `false` for crude trial counts                    |
| 34 | `covariates`                | string  | when adjusted = true                                                       | Comma-separated covariate list                                              |
| 35 | `TP`                        | int     | diagnostic_dta                                                             |                                                                             |
| 36 | `FP`                        | int     | diagnostic_dta                                                             |                                                                             |
| 37 | `FN`                        | int     | diagnostic_dta                                                             |                                                                             |
| 38 | `TN`                        | int     | diagnostic_dta                                                             |                                                                             |
| 39 | `threshold`                 | string  | diagnostic_dta                                                             |                                                                             |
| 40 | `index_test`                | string  | diagnostic_dta                                                             |                                                                             |
| 41 | `reference_standard`        | string  | diagnostic_dta                                                             |                                                                             |
| 42 | `sensitivity`               | float   | diagnostic_dta                                                             |                                                                             |
| 43 | `specificity`               | float   | diagnostic_dta                                                             |                                                                             |
| 44 | `ppv`                       | float   | diagnostic_dta when reported                                               |                                                                             |
| 45 | `npv`                       | float   | diagnostic_dta when reported                                               |                                                                             |
| 46 | `auc`                       | float   | diagnostic_dta when reported                                               |                                                                             |
| 47 | `person_time_t`             | float   | observational_or_rr (IRR), prevalence (incidence_rate)                    | In person-years                                                              |
| 48 | `person_time_c`             | float   | with IRR                                                                   |                                                                             |
| 49 | `denominator_population`    | string  | prevalence_single_arm                                                      | Description of the denominator population                                   |
| 50 | `dose_level`                | string  | dose_response                                                              | Free-text midpoint or range, e.g. `"12.1-18.3"`                             |
| 51 | `dose_unit`                 | string  | dose_response                                                              |                                                                             |
| 52 | `reference_dose`            | string  | dose_response                                                              |                                                                             |
| 53 | `evidence_text`             | string  | all                                                                       | ≤ 240 chars verbatim source span                                            |
| 54 | `source_location`           | string  | all                                                                       | e.g. `"Results, Table 3 row 'Q4 vs Q1'"`                                    |
| 55 | `source_priority`           | enum    | all                                                                       | `abstract` / `results_text` / `main_table` / `supplement` / `forest_plot_text` |
| 56 | `confidence`                | float   | all                                                                       | 0–1; 0.9 for direct table read, 0.6 for paragraph regex, 0.4 for abstract-only |
| 57 | `review_status`             | enum    | all                                                                       | `candidate` / `needs_review` / `confirmed` / `rejected` / `superseded`      |
| 58 | `needs_review_reason`       | string  | when needs_review                                                          | Short tag from `effect_size_sanity.md`                                      |
| 59 | `conflict_group_id`         | string  | when in a conflict group                                                   | UUID shared across the conflicting candidates                               |
| 60 | `preferred`                 | bool    | when in a conflict group                                                   | `true` for the highest-priority row, `false` for the rest                   |
| 61 | `supersedes_row_id`         | string  | when this row replaces a previous extraction                               | The previous row's `study_id`                                               |

## JSONL companion (`extraction_candidates.jsonl`)

Each line is one record. Fields mirror the CSV columns above plus:

- `skill_name`: `meta-extraction.<template_short_name>` (e.g. `meta-extraction.rct_binary`)
- `field`: the logical group, e.g. `"effect_size"` / `"study_metadata"` / `"diagnostic_2x2"`
- `value`: a dict or scalar containing the parsed value
- `extraction_run_id`: ISO timestamp of the run
- `extractor_agent`: model + provider tag, e.g. `"claude-opus-4.7-2026-05-17"`

## Conventions

- All booleans serialized as `true`/`false` (lowercase) in JSONL and as the string `TRUE`/`FALSE` in CSV.
- Missing values: empty string in CSV, `null` in JSONL.
- Numerics with thousands separators are stripped (`"1,250"` → `1250`).
- Decimal separator is always `.`.
- Strings containing commas in CSV are double-quoted.
- Encoding: UTF-8, LF newlines.

## Validation rerun

The full CSV is rebuilt from the JSONL whenever `validate_estimates.py` runs. Manual edits should be made in `extraction_review.csv` (the human-review queue) and then merged back into the JSONL with `--apply-review`.
