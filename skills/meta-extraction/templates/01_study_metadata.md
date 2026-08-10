# 01 — Always-on study metadata

Run this template for every included paper, regardless of Meta type. It produces the join key that ties every per-type row back to the study.

## Fields to extract

| field            | priority source                       | notes                                                                                  |
|------------------|---------------------------------------|----------------------------------------------------------------------------------------|
| `reference_id`   | folder name under `04_full_text_review/fulltext/` | Never change; this is the project's canonical ID.                                      |
| `first_author`   | first byline; PubMed/Crossref         | Surname + initial(s), e.g. `Smith J`. If consortium-only, write the consortium name.   |
| `year`           | publication year of full text         | Use the *publication* year, not the registration year.                                 |
| `country`        | affiliation of first author or stated study country | If multi-country, comma-separated. If unstated, leave empty, do not infer from affiliation alone for multinational consortia. |
| `design`         | Methods                               | Use one of: `RCT`, `cluster_RCT`, `crossover_RCT`, `cohort_prospective`, `cohort_retrospective`, `case_control`, `cross_sectional`, `diagnostic_accuracy`, `case_series`, `single_arm_trial`, `NMA`, `other`. |
| `n_total`        | Methods, Results, or Table 1          | The denominator of the *analysed* cohort. Mark `needs_review_reason = "denominator_ambiguous"` if randomized ≠ analysed ≠ ITT and the paper does not pick one explicitly. |
| `setting`        | Methods or abstract                   | Free text, e.g. "single-center academic hospital", "primary care", "registry".         |
| `recruitment_period` | Methods                           | `YYYY-YYYY` if both ends stated.                                                       |
| `followup_median` / `followup_unit` | Methods or Results     | Only when followup is meaningful (cohort / prognostic / survival).                     |
| `risk_of_bias_tool` | Methods                            | Cochrane RoB 2 / ROBINS-I / NOS / QUADAS-2 / GRADE / none.                             |
| `funding_source` | Funding / Disclosures section         | Verbatim, short. Useful for sensitivity analysis later.                                |
| `trial_registration_id` | Methods abstract              | `NCT*`, `ChiCTR*`, `ISRCTN*`, etc.                                                     |

## Staged search

1. **Abstract**: `first_author`, `year`, `design` cue words, `n_total` if quoted.
2. **Methods (first 2–3 paragraphs)**: `design`, `setting`, `recruitment_period`, `followup_median`, `risk_of_bias_tool`, `trial_registration_id`.
3. **Funding / acknowledgements section**: `funding_source`.
4. **CONSORT / STROBE flowchart table caption (if MinerU pulled it)**: `n_total`.

## Evidence requirement

For `n_total` and `design` you must store the source span (≤ 240 chars) and section name. For names/years/country a verbatim span is preferred but not required if PMID/DOI metadata is the source.

## Output rows

This template does not emit rows by itself. It populates the `study_id` block that every per-type template prepends to each tidy row. Write the JSON block per paper into `extraction_candidates.jsonl` with `field = "study_metadata"` so the human-review queue can see the metadata too.

```json
{
  "reference_id": "rec_pm_17378948",
  "skill_name": "meta-extraction.study_metadata",
  "field": "study_metadata",
  "value": {
    "first_author": "Sanchez-Villegas A",
    "year": 2009,
    "country": "Spain",
    "design": "cohort_prospective",
    "n_total": 10094,
    "setting": "SUN cohort, dynamic cohort of Spanish university graduates",
    "recruitment_period": "1999-2005",
    "followup_median": 4.4,
    "followup_unit": "years",
    "risk_of_bias_tool": "none",
    "funding_source": "Spanish Ministry of Health (grants ...)",
    "trial_registration_id": null
  },
  "evidence_text": "Between December 1999 and November 2005, 10,094 participants ...",
  "source_location": "Methods / Study design and participants",
  "confidence": 0.9,
  "review_status": "candidate"
}
```
