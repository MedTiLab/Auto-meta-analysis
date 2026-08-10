# meta-extraction validation report

- Rows in JSONL: **7**
- Rows flagged (`needs_review` or `superseded`): **2**

## Flag counts by reason

| reason | count |
|---|---|
| `events_exceed_denominator` | 1 |
| `ci_does_not_bracket_point_estimate` | 1 |
| `p_out_of_range` | 1 |
| `asymmetric_log_ci` | 1 |
| `rr_inconsistent_with_2x2` | 1 |
| `adjusted_without_covariate_list` | 1 |

## Per-row flag detail

| study_id | meta_type | reasons |
|---|---|---|
| `rec_pm_BAD__1` | `rct_binary` | `events_exceed_denominator`, `ci_does_not_bracket_point_estimate`, `p_out_of_range`, `asymmetric_log_ci`, `rr_inconsistent_with_2x2`, `adjusted_without_covariate_list` |
