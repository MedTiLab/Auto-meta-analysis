# Example walkthrough — applying `meta-extraction` end-to-end

This walks through the skill on a real paper from this project's
`04_full_text_review/fulltext/` folder. The agent's behavior is described
step by step. The same procedure is encoded in `SKILL.md`; this file is the
worked example.

## Paper

```
reference_id: rec_oa_W2910468100
title:        "The Mediterranean diet and depression: can a healthier dietary pattern reduce the risk of depression?"
file:         04_full_text_review/fulltext/rec_oa_W2910468100/The_Mediterranean_diet_and_depression_can_a_healthier_dietary_pattern_reduce_the_risk_of_depression.md
```

(Note: the file contents in `04_full_text_review/fulltext/rec_oa_W2910468100/` in
the current project actually contain a **lung-cancer-screening PLCOm2012**
paper, not the Mediterranean diet review the filename suggests. The walkthrough
follows the agent's reasoning on what *is* in the file, which is a prognostic
model validation in a screening cohort. This is exactly the kind of
mis-routing the type-aware router is meant to catch.)

## Step 0. Load review type from `01_protocol/`

The agent reads `01_protocol/` and finds (in this project) that the protocol
expects diagnostic-accuracy / prognostic studies in oncology. It does NOT
restrict to a single type, so all of `templates/00_paper_type_router.md` is in
play.

## Step 1. Enumerate included studies

The agent reads `03_title_abstract_screening/screening_decisions.csv` (or
`.json`) and confirms `rec_oa_W2910468100` is `stage = full_text` and
`decision in {include, maybe}`. It picks the Markdown source:

1. `mineru/*.md` — not present for this record (no `mineru/` folder)
2. The plain `.md` directly in the folder — present, use this.

If neither were present the agent would write a `source_missing` row to
`extraction_log.md` and stop on this paper.

## Step 2. Classify

The agent scans the abstract:

> "Here we report the performance of the PLCOm2012 risk model, which calculates 6 year lung cancer risk, in a cohort invited for lung cancer screening … Calibration (expected/observed (E/O) lung cancer diagnoses over 6 years) and discrimination (area under the receiver operating characteristic curve) of PLCOm2012 and other models was performed …"

and reads the table captions and Methods header. Trigger phrases that fire:

| trigger                                  | fires for type                             |
|------------------------------------------|--------------------------------------------|
| "AUC", "receiver operating characteristic" | `diagnostic_dta` (model-as-test)         |
| "6 year lung cancer risk", "incidence proportion"  | `prevalence_single_arm`           |
| "sensitivity", "specificity"             | `diagnostic_dta`                           |
| "NNT/NNS"                                | `rct_binary`-style number-needed-to-screen |

Triggers that do **not** fire: `randomized`, `Cox`, `HR`, `OR`, `RR` with a
contrast, "intervention vs control". The paper is a single-cohort risk-model
validation, not a comparative effect study.

The router writes to `extraction_log.md`:

```json
{
  "reference_id": "rec_oa_W2910468100",
  "detected_types": ["diagnostic_dta", "prevalence_single_arm"],
  "primary_type": "diagnostic_dta",
  "notes": "Risk-model validation. Index test = PLCOm2012 score with threshold 1.51%; reference standard = lung cancer diagnosis within 6 years (multi-source ascertainment). Single-cohort, no comparator arm.",
  "skipped_types": ["rct_binary", "rct_continuous", "observational_or_rr", "prognostic_hr", "dose_response"],
  "routing_evidence": "Abstract: 'risk prediction models', 'AUC', 'E/O calibration', 'sensitivity 0.91, specificity 0.45'"
}
```

## Step 3. Pull study metadata

Following `01_study_metadata.md`:

| field | value | source |
|---|---|---|
| `first_author` | the first byline from the parsed file | byline |
| `year` | from DOI / publication header | DOI line at top of MD: `10.1136/bmjonc-2024-000560` → 2024 |
| `country` | UK | Methods: "Manchester Lung Health Check" |
| `design` | `cross_sectional` (single-cohort validation) | Methods |
| `n_total` | 2541 | Results §1: "2541 people completed an LHC" |
| `setting` | "Community-based screening, areas of high socio-economic deprivation, Manchester, UK" | Methods |
| `recruitment_period` | "from 2016" | Methods |
| `risk_of_bias_tool` | TRIPOD (prediction-model reporting) | Methods: "The TRIPOD Checklist for Prediction Model Validation was followed" |
| `trial_registration_id` | not stated | — |

Written as `field = "study_metadata"` to `extraction_candidates.jsonl`.

## Step 4. Apply per-type templates

### `diagnostic_dta` (primary type)

The agent applies `templates/06_diagnostic_dta.md`. Index test = "PLCOm2012 ≥ 1.51%";
reference standard = "lung cancer diagnosis within 6 years".

Staged search finds **headline sensitivity and specificity** in Results §
"NNS, number needed to screen":

> "The sensitivity of a 1.51% PLCOm2012 screening threshold was 0.91, with specificity 0.45 (see table 4)."

Stage C — main table 4 — should hold the 2×2 (`TP / FP / FN / TN`) but, in
this paper, only sens/spec are quoted in the body text and the raw 2×2
appears to be reconstructable from the per-group counts:

- High-risk (screened): n = 1430, lung cancer = 105 → TP + FP = 1430, TP = 105 (cases in screened group), FP = 1430 − 105 = 1325
- Low-risk (unscreened): n = 1111, lung cancer = 10 → FN + TN = 1111, FN = 10, TN = 1101

But this conflates "screened" with "test-positive". For an honest 2×2 the
agent should:

- Write a row with `TP = 105, FP = 1325, FN = 10, TN = 1101` at threshold = 1.51%, and
- Add `derived: true`, `review_status = needs_review`, `needs_review_reason = "2x2_derived_from_per_group_counts; verify against Table 4"`.
- Compute `sens_calc = 105 / 115 = 0.913` (matches the reported 0.91), and
  `spec_calc = 1101 / 2426 = 0.454` (matches the reported 0.45) → the validator's
  rule 16-17 will pass, raising the agent's confidence in the derivation.

This is exactly the kind of derivation that `06_diagnostic_dta.md` defers to
`diagnostic-data-extraction` for the final, audited row. The bridge row written
here is intentionally tagged for review.

### `prevalence_single_arm` (secondary type)

Two clean rows, no derivation needed:

- High-risk arm: `n_t = 1430, events_t = 105` → 6-year cumulative incidence
  0.0734 (95% CI 0.060–0.088).
- Low-risk arm: `n_t = 1111, events_t = 10` → 0.0090 (95% CI 0.0043–0.0165).

Both written verbatim with `source_priority = "results_text"`.

## Step 5. Validate

```bash
python .claude/skills/meta-extraction/scripts/validate_estimates.py \
  --in   05_data_extraction/extraction_candidates.jsonl \
  --out-tidy 05_data_extraction/tidy_estimates.csv \
  --out-by-type-dir 05_data_extraction/by_type \
  --out-report 05_data_extraction/extraction_log.md
```

Expected validator output for this paper:

- 1 metadata row (no flags)
- 1 DTA row, `needs_review` (`2x2_derived_from_per_group_counts`)
- 2 prevalence rows, `candidate`

## Step 6. Hand-off

The agent's final message to the user:

> Extracted 4 candidate rows from `rec_oa_W2910468100`:
> - 1 study-metadata block (TRIPOD validation, n = 2541)
> - 1 `diagnostic_dta` row at threshold 1.51% (TP/FP/FN/TN derived from per-risk-group counts; the row is flagged `needs_review` for you to verify against Table 4 of the paper)
> - 2 `prevalence_single_arm` rows (6-year cumulative incidence by risk group)
>
> Files updated:
> - `05_data_extraction/extraction_candidates.jsonl` (+4 lines)
> - `05_data_extraction/tidy_estimates.csv` (rebuilt)
> - `05_data_extraction/by_type/diagnostic_dta.csv` (+1 row)
> - `05_data_extraction/by_type/prevalence_single_arm.csv` (+2 rows)
> - `05_data_extraction/extraction_log.md` (per-paper section appended)
>
> Suggested next step: confirm the diagnostic 2×2 row in `extraction_review.csv` or, if you prefer, switch this paper's pipeline to `diagnostic-data-extraction` which will redo the 2×2 directly from Table 4 of the paper.

## How this is different from `meta_extraction_skill_pack_v0_1.zip`

The GPT pack would have:
- Matched the literal phrase "study id" / "outcome name" → 0 hits → empty rows.
- Run its `(?i)\bmean\s*[=:]?\s*(-?\d+(?:\.\d+)?)` regex over the whole paper and captured every "mean age was 64.1 ± 5.5 years" as an effect size for some unknown outcome.
- Run its `(?i)\bsensitivity\s*[=:]?\s*...` regex and missed the 0.91 because it sits inside a longer sentence with the qualifier "at a 1.51% threshold".
- Emitted independent rows (one per skill, one per field) with no join key between `sensitivity = 0.91` and the threshold or the cohort it applies to.

This skill instead **classifies** the paper, **delegates** to the right
template, **stages** the search, **derives the 2×2 cleanly** under a documented
rule, and writes a join-able row with full evidence and a sensible
`needs_review` flag. That is the difference that actually changes downstream
effect-size quality.
