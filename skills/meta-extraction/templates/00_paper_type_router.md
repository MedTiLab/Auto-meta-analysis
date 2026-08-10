# 00 — Paper type router

Use this template once per paper to decide which per-type templates to apply. A paper can carry more than one type. Record the routing decision in `extraction_log.md` even if a type is later skipped.

## How to decide

You are reading parsed full-text Markdown plus the abstract. Run a quick scan over the abstract, methods header, and table captions. Match the paper to one or more of the types below by **trigger phrases** plus **what numbers actually appear**. Do not classify on title alone — a "systematic review of biomarkers in lung cancer" can carry DTA *and* prognostic HR.

| meta_type                 | When to pick it (must satisfy both columns)                                                              | What numbers must be present                                                                                                                              | Template                                  |
|---------------------------|----------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------|
| `rct_binary`              | Design = randomized trial; outcome is binary (event yes/no)                                              | `events_t, n_t, events_c, n_c` directly or via `RR`/`OR`/`RD` + at least one denominator                                                                  | `02_rct_binary.md`                        |
| `rct_continuous`          | Design = randomized trial; outcome is continuous (score, lab value, change-from-baseline)                | Per-arm `mean ± SD` (or `mean (SE)`, `median (IQR)` for derivation), with `n` per arm; or reported `MD`/`SMD` with CI                                     | `03_rct_continuous.md`                    |
| `observational_or_rr`     | Cohort or case-control or cross-sectional with adjusted/unadjusted OR, RR, IRR for a binary outcome      | Reported `OR`, `aOR`, `RR`, `aRR`, or `IRR` + 95% CI; covariate set when adjusted                                                                         | `04_observational_or_rr.md`               |
| `prognostic_hr`           | Survival / time-to-event analysis with Cox or KM-derived hazard ratios                                   | Reported `HR (95% CI)` for OS / PFS / DFS / RFS / EFS or named time-to-event endpoint                                                                     | `05_prognostic_hr.md`                     |
| `diagnostic_dta`          | Diagnostic accuracy of an index test against a reference standard                                        | Either a 2×2 (`TP, FP, FN, TN`) or `sensitivity` and `specificity` with case/control denominators                                                         | `06_diagnostic_dta.md` (delegates to existing `diagnostic-data-extraction`) |
| `prevalence_single_arm`   | Prevalence, incidence proportion, or single-arm event rate (no comparator)                               | `events / n` with no separate control arm, or rate per person-time                                                                                        | `07_prevalence_single_arm.md`             |
| `dose_response`           | Exposure analyzed in ordered dose categories (or per-unit increment) with a reference                    | Per-category effect (`OR`/`RR`/`HR`) with the category range and a clearly named reference category                                                       | `08_dose_response.md`                     |

## Trigger phrases (used as hints, not as proof)

- **rct_binary**: "randomized", "randomised", "RCT", "intention-to-treat", "ITT", "per-protocol", "event rate", "responders", "risk ratio", "relative risk", "odds ratio" in a trial.
- **rct_continuous**: "change from baseline", "mean difference", "MD", "SMD", "Hedges g", "Cohen d", "least-squares mean", "LSMean", "estimated mean change".
- **observational_or_rr**: "cohort", "case-control", "cross-sectional", "logistic regression", "Poisson", "incidence rate ratio", "IRR", "adjusted odds ratio", "aOR", "aHR" *outside* a survival context.
- **prognostic_hr**: "Cox proportional hazards", "hazard ratio", "HR", "OS", "PFS", "DFS", "RFS", "EFS", "Kaplan-Meier", "log-rank", "time-to-event".
- **diagnostic_dta**: "sensitivity", "specificity", "AUC", "ROC", "diagnostic accuracy", "PPV", "NPV", "DOR", "QUADAS-2".
- **prevalence_single_arm**: "prevalence", "incidence proportion", "pooled prevalence", "single-arm", "rate per 1000 person-years".
- **dose_response**: "dose-response", "per 10 mg increment", "quartile", "tertile", "quintile", "lowest vs highest", "Q1 (reference)".

## Disambiguation rules

1. If both `prognostic_hr` and `observational_or_rr` triggers fire on the *same outcome*, prefer `prognostic_hr` for that outcome row and emit a separate `observational_or_rr` row only if the paper reports OR/RR for a non-survival binary outcome.
2. If `rct_binary` and `prognostic_hr` both fire (RCT with time-to-event primary outcome), emit two type rows: one binary at the trial endpoint (events at follow-up cutoff) when present, and the HR row.
3. If only an OR or HR is reported and the underlying counts are in a table, still emit `rct_binary` / `prognostic_hr` rows that carry the counts; the validator will check internal consistency.
4. If the abstract reports something but the body contradicts it, both rows are emitted with their own `source_priority`; conflict resolution is governed by `checklists/conflict_priority.md`.
5. If you cannot match any type, write the paper to `extraction_log.md` with `status = no_type_matched` and stop. Do not extract noise.

## Output of this step

A JSON block in `extraction_log.md` per paper, e.g.:

```json
{
  "reference_id": "rec_pm_36833953",
  "detected_types": ["prognostic_hr", "diagnostic_dta"],
  "primary_type": "prognostic_hr",
  "notes": "Cohort with Cox HR for OS at 5y plus serum biomarker DTA at cutoff 1.5",
  "skipped_types": [],
  "routing_evidence": "Methods: 'Cox proportional hazards'; Table 3: 'TP/FP/FN/TN at cutoff 1.5 ng/mL'"
}
```
