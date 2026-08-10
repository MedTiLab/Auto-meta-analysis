---
name: meta-extraction
description: Type-aware, staged extractor that turns MedHelp Meta full-text Markdown (MinerU or .md) into one tidy analysis-ready row per study × outcome × comparison × timepoint. Use this when the user asks to "extract effect sizes", "build the Meta extraction table", "fill 05_data_extraction", "pull HR/OR/RR/SMD/sens/spec from full text", "convert fulltext to a meta-analysis dataset", or "提取 Meta 分析数据 / 效应值 / 提取表格". Selects the right per-type template (RCT-binary, RCT-continuous, observational OR/RR, prognostic HR, DTA 2×2, prevalence single-arm, dose-response) instead of running one regex sweep, and escalates abstract → results → tables → supplements → forest-plot text only as needed.
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

# meta-extraction

## When to use this skill

Use this skill **after** PDFs have been parsed to Markdown (see `mineru-pdf-parser`) and **before** statistical synthesis (see `meta-statistics-r`, `diagnostic-meta-analysis`). It produces the analysis-ready inputs that the statistics skills consume.

Do **not** use this skill to invent values that are not in the source. Every emitted row must carry `evidence_text`, `source_location` (page/section/table), and `review_status`. The user's review decisions always win.

## Why a single regex sweep is not enough

Effect-size data in published papers is heterogeneous:

- The same outcome appears in the abstract, the results paragraph, a forest plot, a main table, and a supplementary table — often with slightly different numbers because of rounding, ITT vs PP, adjusted vs crude, or different time points.
- Different review types need different rows: a 2×2 trial needs `events_t / n_t / events_c / n_c`; a prognostic HR needs `hr / ci_lower / ci_upper / events / n`; a DTA study needs `TP / FP / FN / TN`. A pooled CSV with one wide header per type would be unusable downstream.
- Numeric extraction is high-stakes. A single wrong digit in `events_t` changes pooled effect sizes and CIs.

This skill therefore:

1. **Classifies** the paper into one or more Meta types via `templates/00_paper_type_router.md`.
2. **Picks a per-type template** that names the exact fields, where to look first, the conflict priority, and the row schema.
3. **Stages** the extraction (abstract → results → tables → supplements → forest-plot text) and stops as soon as a row is complete from the most trustworthy source.
4. **Validates** numerically before writing (CI ↔ SE, 2×2 ↔ OR/RR, lnHR recovery, ARR/NNT, denominator sanity).
5. **Writes one tidy row per estimate** to a canonical CSV that downstream R/Python Meta code can read without further wrangling.

## Inputs and outputs

Inputs (per included study, identified by `reference_id`, e.g. `rec_pm_17378948`):

```text
04_full_text_review/fulltext/{reference_id}/mineru/*.md          # parsed body + tables
04_full_text_review/fulltext/{reference_id}/mineru/page_map.json # page anchors when present
04_full_text_review/fulltext/{reference_id}/*.md                 # legacy non-MinerU MD if any
04_full_text_review/pdf_manifest.json                            # full-text availability index
03_title_abstract_screening/screening_decisions.csv|.json        # canonical include set
01_protocol/*.md                                                 # review type, PICO, outcomes
```

Outputs (write under `05_data_extraction/`):

```text
05_data_extraction/extraction_candidates.jsonl                   # one record per (study, field) candidate, with evidence
05_data_extraction/extraction_review.csv                         # human-review queue (joined view)
05_data_extraction/extraction_log.md                             # what was extracted, what failed, what conflicted
05_data_extraction/tidy_estimates.csv                            # canonical analysis-ready long table
05_data_extraction/by_type/rct_binary.csv                        # type-specific tidy table (if produced)
05_data_extraction/by_type/rct_continuous.csv
05_data_extraction/by_type/observational_or_rr.csv
05_data_extraction/by_type/prognostic_hr.csv
05_data_extraction/by_type/diagnostic_dta.csv
05_data_extraction/by_type/prevalence_single_arm.csv
05_data_extraction/by_type/dose_response.csv
```

If the project is purely DTA (tumor biomarker), the existing `diagnostic-data-extraction` schema (`05_data_extraction/diagnostic_extraction_candidates.jsonl`, `05_data_extraction/diagnostic_dataset.csv`) is the source of truth. This skill writes `by_type/diagnostic_dta.csv` as a thin pointer to that pipeline rather than re-extracting.

## Canonical row schemas

See `output_schemas/tidy_estimates.schema.md` for the full specification. The header that every per-type CSV plus `tidy_estimates.csv` must conform to:

```text
study_id,reference_id,first_author,year,country,design,meta_type,
outcome_name,outcome_definition,timepoint,timepoint_unit,
comparison_type,arm_label_t,arm_label_c,n_t,n_c,events_t,events_c,
mean_t,sd_t,mean_c,sd_c,change_mean_t,change_sd_t,change_mean_c,change_sd_c,
effect_measure,effect_value,ci_lower,ci_upper,se,p_value,
adjusted,covariates,
TP,FP,FN,TN,threshold,index_test,reference_standard,
sensitivity,specificity,ppv,npv,auc,
person_time_t,person_time_c,denominator_population,
dose_level,dose_unit,reference_dose,
evidence_text,source_location,source_priority,confidence,review_status,needs_review_reason
```

A given row only fills the columns its `meta_type` needs; the rest stay empty. This keeps R/`meta`/`metafor` and Python `statsmodels` ingestion trivial.

## Procedure — what you actually do, step by step

### Step 0. Load the project's review type and outcomes

Read `01_protocol/` for the review type, PICO, and primary/secondary outcomes. If the protocol declares a single Meta type (e.g. "diagnostic accuracy of miR-21"), skip type detection per paper and use the matching template directly. Record the protocol decision in `extraction_log.md`.

### Step 1. Enumerate included studies

Read `03_title_abstract_screening/screening_decisions.csv` (or `.json`) and treat every record with stage = `full_text` and `decision in {include, maybe}` as in-scope. For each in-scope `reference_id`, list `04_full_text_review/fulltext/{reference_id}/` and pick the best Markdown source in this order:

1. `mineru/*.md` (most reliable, tables preserved).
2. Any other `*.md` directly in the folder (legacy or open-access full text).
3. If neither exists, skip and append a row to `extraction_log.md` with `status = source_missing`; do **not** invent.

### Step 2. Classify the paper into Meta type(s)

Follow `templates/00_paper_type_router.md`. A paper may carry more than one type (a prognostic cohort that also reports a 2×2 of a biomarker at a cutoff). Emit one type tag per row downstream, not per paper.

### Step 3. Pull always-on study metadata

Follow `templates/01_study_metadata.md`. Outputs: `reference_id`, `first_author`, `year`, `country`, `design`, `n_total`, plus PRISMA/CONSORT/STROBE-relevant fields. This block is the join key for every per-type row.

### Step 4. For each detected type, apply its template (stagewise)

For every type the paper carries, open the matching template and follow the **staged search** it specifies. The general staging is:

1. **Stage A — Abstract**: cheap, structured numbers in Results/Conclusion sentences. Often holds the headline effect size. Mark `source_priority = "abstract"`.
2. **Stage B — Results paragraph(s)**: the narrative around tables and forest plots. Mark `source_priority = "results_text"`.
3. **Stage C — Main tables**: parse MinerU MD tables. Match column headers to the type's fields. Mark `source_priority = "main_table"`. **This is usually the most trustworthy source for 2×2 counts, n by arm, and per-arm means/SDs.**
4. **Stage D — Supplements / appendix tables**: per-study subgroups, per-arm long-form data, sensitivity-analysis rows. Mark `source_priority = "supplement"`.
5. **Stage E — Forest plot text / figure captions**: when only the figure carries the per-comparison `HR (95% CI)` and the paper's text only summarizes it. Mark `source_priority = "forest_plot_text"`.

Stop a stage as soon as a complete row for the (outcome, comparison, timepoint) is built. If a later stage produces conflicting numbers, **do not overwrite** — write a second candidate row and let `checklists/conflict_priority.md` resolve.

### Step 5. Validate before writing

Run `python .claude/skills/meta-extraction/scripts/validate_estimates.py --in 05_data_extraction/extraction_candidates.jsonl --out-tidy 05_data_extraction/tidy_estimates.csv`. It flags:

- CI does not bracket the point estimate.
- SE inconsistent with CI width (for OR/RR/HR on log scale; for MD/SMD on raw scale).
- 2×2 counts inconsistent with reported OR/RR within tolerance.
- ARR / NNT inconsistent with `events_t/n_t` and `events_c/n_c`.
- `events > n` or negative counts.
- DTA: `sensitivity` and `TP/(TP+FN)` differ by more than 1 percentage point.
- HR with CI but missing `se` → derives `se = (ln(upper) − ln(lower)) / (2 × 1.96)` and stores it; this is the only derivation allowed and is always written with `review_status = needs_review`.

Any row that fails a check is written with `needs_review = true` and a `needs_review_reason` string. Rows are still emitted; they are not silently dropped.

### Step 6. Write outputs and log

- Append every candidate to `extraction_candidates.jsonl` (one JSON per line, schema in `output_schemas/tidy_estimates.schema.md`).
- Rebuild `tidy_estimates.csv` and `by_type/*.csv` from the JSONL (idempotent — re-runs replace these two artifacts).
- Append a per-paper section to `extraction_log.md` with: source MD used, detected types, fields extracted vs missing, conflicts, validator flags, time spent. This is what makes the workflow auditable.

### Step 7. Handoff

Tell the user the saved paths and which rows need human review (count + breakdown by `needs_review_reason`). Do not promote anything to `tidy_estimates.csv` rows with `review_status = confirmed` on your own — only the user does that. The convention from `pdf-evidence-extraction` applies: stable values are `candidate`, `needs_review`, `confirmed`, `rejected`, `superseded`.

## Non-negotiable rules

1. **No invented numbers.** If a denominator isn't stated, leave `n_t` empty and set `needs_review_reason = "missing_denominator"`. Never back-fill from the abstract just to fill a column.
2. **Evidence span is mandatory** on every numeric field: 1–3 sentences (or the table caption + row) that contain the value, plus page/section/table label when MinerU `page_map.json` permits.
3. **Adjusted ≠ crude.** Two estimates for the same outcome must produce two rows, one with `adjusted = true` (and `covariates` filled), one with `adjusted = false`. Do not pool.
4. **Per-arm vs per-comparison rows.** A 2×2 study produces *one* row keyed by (outcome, comparison, timepoint) with both arms inline. A prevalence/single-arm study produces *one row per arm*. The router's output `comparison_type` field decides which.
5. **Do not overwrite `reviewer = user` rows.** When re-running on a paper that already has confirmed rows, write new candidates with `review_status = candidate` and a `supersedes_row_id` link, never replace.
6. **Numeric formats**: store all effect sizes on their native scale (OR not lnOR, HR not lnHR). The validator derives log-scale SE when needed; the CSV stays human-readable.
7. **Do not run statistics here.** If the user asks for pooled estimates, hand off to `meta-statistics-r` or `diagnostic-meta-analysis`.

## How to add a new Meta type later

Drop a new file under `templates/`, named `NN_<type_name>.md`, that contains: trigger phrases, required fields, search order, conflict priority, and the row schema mapped onto the canonical CSV header. Update `templates/00_paper_type_router.md` so the classifier can return the new type. Do not touch `SKILL.md`.

## Quick smoke test

```bash
python .claude/skills/meta-extraction/scripts/validate_estimates.py \
  --in  .claude/skills/meta-extraction/examples/example_candidates.jsonl \
  --out-tidy .claude/skills/meta-extraction/examples/example_tidy_estimates.csv \
  --out-report .claude/skills/meta-extraction/examples/example_validation_report.md
```

Then read `examples/example_walkthrough.md` to see the same workflow applied end-to-end to one paper from this project's `04_full_text_review/fulltext/`.
