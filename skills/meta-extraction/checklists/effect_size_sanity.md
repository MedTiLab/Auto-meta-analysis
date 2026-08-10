# Effect-size sanity checklist

Before any row is written with `review_status = candidate` (i.e. trusted enough to enter the human-review queue without a blocker), the agent must run through this checklist mentally. The Python validator (`scripts/validate_estimates.py`) enforces the same checks programmatically so nothing relies on memory alone.

Any rule that fails forces:

```text
review_status   = needs_review
needs_review_reason = "<short tag from the rule below>"
```

The row is still written (do not drop data).

## Numeric structure

1. **Field types parse.** `n_t`, `n_c`, `events_t`, `events_c` are non-negative integers. `effect_value`, `ci_lower`, `ci_upper`, `se`, `p_value` are non-negative floats (with sign allowed for MD/SMD). Failure tag: `parse_error`.
2. **Counts ≤ denominators.** `events_t ≤ n_t` and `events_c ≤ n_c`. Failure tag: `events_exceed_denominator`.
3. **CI bracket.** `ci_lower ≤ effect_value ≤ ci_upper`. Failure tag: `ci_does_not_bracket_point_estimate`.
4. **CI sign on ratio scale.** For `OR`/`RR`/`HR`/`IRR`: `ci_lower > 0`. Failure tag: `ratio_ci_lower_nonpositive`.
5. **P-value in [0, 1].** Failure tag: `p_out_of_range`.

## Log-scale consistency (OR / RR / HR / IRR)

6. **SE from CI** is recoverable: `se ≈ (ln(ci_upper) − ln(ci_lower)) / (2 × 1.96)`. If `se` is reported and disagrees by >10% relative, tag `se_ci_inconsistent_logscale`. If `se` is missing, the validator fills it from this formula and stores it — no flag raised. If neither `se` nor a full CI is available, tag `no_uncertainty_reported`.
7. **CI symmetry on log scale**: `|ln(ci_upper) − ln(effect_value)| ≈ |ln(effect_value) − ln(ci_lower)|` within 15% relative. Asymmetric CIs are rare and usually signal a transcription error or a profile-likelihood CI; tag `asymmetric_log_ci` so the analyst can decide.

## Raw-scale consistency (MD / SMD / WMD)

8. **SE from CI** is recoverable: `se ≈ (ci_upper − ci_lower) / (2 × 1.96)`. Tolerance 10% relative. Tag: `se_ci_inconsistent_rawscale`.
9. **CI symmetry on raw scale** within 15% relative. Tag: `asymmetric_raw_ci`.

## 2×2 cross-checks

10. **Reported RR vs 2×2**: `RR_recomputed = (events_t/n_t) / (events_c/n_c)`. If a reported RR is also present, relative difference > 5% → tag `rr_inconsistent_with_2x2`.
11. **Reported OR vs 2×2**: `OR_recomputed = (events_t × (n_c − events_c)) / (events_c × (n_t − events_t))`. >10% relative → tag `or_inconsistent_with_2x2` (looser tolerance because adjustment may explain small drift; aOR vs 2×2 always tags).
12. **Empty cells**: when `events_t = 0` or `events_c = 0`, do not derive RR/OR/RD on the row. Set `effect_value` only if the paper reported it explicitly. Tag: `empty_cell_no_derivation`.
13. **ARR / NNT consistency** when reported: `ARR = events_c/n_c − events_t/n_t`; `NNT = 1/ARR` if `ARR > 0`, `NNH = -1/ARR` if `ARR < 0`. Off by >10% relative → tag `arr_nnt_inconsistent`.

## Continuous-outcome cross-checks

14. **SE vs SD** confusion: if `se_t × √n_t` is suspiciously close to a reported `sd_t × something`, no flag, but if the per-arm SD looks more like `SD/√n` (i.e. tiny relative to mean for large n), tag `sd_might_actually_be_se`.
15. **Change-from-baseline SDs**: if reported change SD < `min(baseline_sd, final_sd)` it is plausible (correlation > 0.5); if change SD > `baseline_sd + final_sd`, impossible → tag `change_sd_impossible`.

## DTA cross-checks

16. **Sens vs TP**: `|sensitivity − TP/(TP+FN)| < 0.01`. Tag: `sens_inconsistent_with_2x2`.
17. **Spec vs TN**: `|specificity − TN/(TN+FP)| < 0.01`. Tag: `spec_inconsistent_with_2x2`.
18. **AUC plausibility**: `0.5 ≤ auc ≤ 1.0`. If `auc < 0.5`, the paper probably swapped target condition / index test sign → tag `auc_below_chance`.

## Outcome-definition discipline (qualitative, not enforced by validator)

19. **Same outcome label, different definition** is allowed — but `outcome_definition` *must* differ between the two rows. Identical labels with identical definitions but different values across stages must surface to `conflict_priority.md`.
20. **Adjusted estimate must carry covariates.** If `adjusted = true` and `covariates = ""`, tag `adjusted_without_covariate_list`.

## What the validator does NOT do

- It does not pool, does not impute, does not call any LLM. Statistical synthesis and Wan/Hozo conversion live in `meta-statistics-r` and `diagnostic-meta-analysis`.
- It does not enforce that abstract numbers match table numbers — that is the job of `conflict_priority.md`.
