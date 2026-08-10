#!/usr/bin/env python3
"""
validate_estimates.py — numeric sanity validator for the meta-extraction skill.

Reads an extraction_candidates.jsonl produced by the agent, applies the rules
from checklists/effect_size_sanity.md, and writes:

  - the canonical long table   --> 05_data_extraction/tidy_estimates.csv
  - per-type CSVs              --> 05_data_extraction/by_type/<meta_type>.csv
  - a Markdown validation report with one section per flagged row

This file is intentionally dependency-free (Python 3.9+ stdlib only). It does NOT
extract anything from PDF/Markdown; that is the agent's job. It only checks
numeric consistency of rows the agent already wrote, sets `review_status`
and `needs_review_reason`, and derives `se` from a symmetric log/raw CI when
the agent left it blank.

Usage:
  python validate_estimates.py \\
      --in   05_data_extraction/extraction_candidates.jsonl \\
      --out-tidy 05_data_extraction/tidy_estimates.csv \\
      --out-by-type-dir 05_data_extraction/by_type \\
      --out-report 05_data_extraction/extraction_log.md

The script is idempotent: rerunning it never appends, it rewrites the four
output artifacts in place.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

CSV_HEADER = [
    "study_id", "reference_id", "first_author", "year", "country", "design", "meta_type",
    "outcome_name", "outcome_definition", "timepoint", "timepoint_unit",
    "comparison_type", "arm_label_t", "arm_label_c",
    "n_t", "n_c", "events_t", "events_c",
    "mean_t", "sd_t", "mean_c", "sd_c",
    "change_mean_t", "change_sd_t", "change_mean_c", "change_sd_c",
    "effect_measure", "effect_value", "ci_lower", "ci_upper", "se", "p_value",
    "adjusted", "covariates",
    "TP", "FP", "FN", "TN", "threshold", "index_test", "reference_standard",
    "sensitivity", "specificity", "ppv", "npv", "auc",
    "person_time_t", "person_time_c", "denominator_population",
    "dose_level", "dose_unit", "reference_dose",
    "evidence_text", "source_location", "source_priority", "confidence",
    "review_status", "needs_review_reason", "conflict_group_id", "preferred",
    "supersedes_row_id",
]

RATIO_MEASURES = {"OR", "aOR", "RR", "aRR", "HR", "aHR", "IRR", "aIRR"}
RAW_MEASURES = {"MD", "WMD", "SMD", "LSMeanDiff", "RD", "proportion", "incidence_rate"}

Z_975 = 1.959963984540054


# ---------- helpers ----------

def _to_float(x: Any) -> Optional[float]:
    if x is None or x == "" or x is False:
        return None
    try:
        if isinstance(x, str):
            x = x.replace(",", "").strip()
            if x == "":
                return None
        return float(x)
    except (TypeError, ValueError):
        return None


def _to_int(x: Any) -> Optional[int]:
    f = _to_float(x)
    if f is None:
        return None
    if not math.isfinite(f):
        return None
    if abs(f - round(f)) > 1e-6:
        return None
    return int(round(f))


def _to_bool(x: Any) -> Optional[bool]:
    if x is None or x == "":
        return None
    if isinstance(x, bool):
        return x
    if isinstance(x, (int, float)):
        return bool(x)
    if isinstance(x, str):
        s = x.strip().lower()
        if s in {"true", "1", "yes", "y", "t"}:
            return True
        if s in {"false", "0", "no", "n", "f"}:
            return False
    return None


def _rel_diff(a: float, b: float) -> float:
    denom = max(abs(a), abs(b))
    if denom == 0:
        return 0.0
    return abs(a - b) / denom


def _conflict_tuple(rec: Dict[str, Any]) -> Tuple:
    return (
        rec.get("reference_id"),
        rec.get("meta_type"),
        rec.get("outcome_name"),
        rec.get("comparison_type"),
        rec.get("arm_label_t"),
        rec.get("arm_label_c"),
        rec.get("timepoint"),
        rec.get("adjusted"),
    )


PRIORITY_ORDER = {
    "main_table": 4,
    "supplement": 3,
    "forest_plot_text": 2,
    "results_text": 1,
    "abstract": 0,
}
# prognostic_hr has table ≈ forest_plot — bump forest_plot_text to 4 only there
def _priority(rec: Dict[str, Any]) -> int:
    sp = rec.get("source_priority") or "results_text"
    base = PRIORITY_ORDER.get(sp, 0)
    if rec.get("meta_type") == "prognostic_hr" and sp == "forest_plot_text":
        base = 4
    return base


# ---------- the validator core ----------

@dataclass
class Flagged:
    study_id: str
    meta_type: str
    reasons: List[str] = field(default_factory=list)


def validate_row(rec: Dict[str, Any]) -> Flagged:
    """Apply the sanity rules to one row in place. Returns a Flagged summary.

    Side effects: sets `review_status`, `needs_review_reason`, and may fill `se`
    by deriving from a symmetric CI when the agent left it blank.
    """
    flags: List[str] = []
    mt = rec.get("meta_type", "")
    em = rec.get("effect_measure", "")

    # 1. parse + 2. counts ≤ denominator
    for arm in ("t", "c"):
        n = _to_int(rec.get(f"n_{arm}"))
        ev = _to_int(rec.get(f"events_{arm}"))
        if n is not None and n < 0:
            flags.append("parse_error")
        if ev is not None and ev < 0:
            flags.append("parse_error")
        if n is not None and ev is not None and ev > n:
            flags.append("events_exceed_denominator")

    ev_t = _to_int(rec.get("events_t"))
    ev_c = _to_int(rec.get("events_c"))
    n_t = _to_int(rec.get("n_t"))
    n_c = _to_int(rec.get("n_c"))

    # 3.+ 4. CI bracket + ratio CI sign
    ev_value = _to_float(rec.get("effect_value"))
    ci_lo = _to_float(rec.get("ci_lower"))
    ci_hi = _to_float(rec.get("ci_upper"))
    se = _to_float(rec.get("se"))

    if ev_value is not None and ci_lo is not None and ci_hi is not None:
        if not (ci_lo - 1e-9 <= ev_value <= ci_hi + 1e-9):
            flags.append("ci_does_not_bracket_point_estimate")
        if em in RATIO_MEASURES and ci_lo <= 0:
            flags.append("ratio_ci_lower_nonpositive")

    p = _to_float(rec.get("p_value"))
    if p is not None and (p < 0 or p > 1):
        flags.append("p_out_of_range")

    # 6.-7. log-scale consistency for ratios
    if em in RATIO_MEASURES and ev_value is not None and ci_lo is not None and ci_hi is not None and ci_lo > 0:
        log_se = (math.log(ci_hi) - math.log(ci_lo)) / (2 * Z_975)
        if se is None and log_se > 0:
            rec["se"] = round(log_se, 6)
        elif se is not None and log_se > 0 and _rel_diff(se, log_se) > 0.10:
            flags.append("se_ci_inconsistent_logscale")
        # asymmetry on log scale
        if ev_value > 0:
            half_up = abs(math.log(ci_hi) - math.log(ev_value))
            half_lo = abs(math.log(ev_value) - math.log(ci_lo))
            if max(half_up, half_lo) > 0 and _rel_diff(half_up, half_lo) > 0.15:
                flags.append("asymmetric_log_ci")
    if em in RATIO_MEASURES and ev_value is not None and (ci_lo is None or ci_hi is None) and se is None:
        flags.append("no_uncertainty_reported")

    # 8.-9. raw-scale consistency
    if em in RAW_MEASURES and ev_value is not None and ci_lo is not None and ci_hi is not None:
        raw_se = (ci_hi - ci_lo) / (2 * Z_975)
        if se is None and raw_se > 0:
            rec["se"] = round(raw_se, 6)
        elif se is not None and raw_se > 0 and _rel_diff(se, raw_se) > 0.10:
            flags.append("se_ci_inconsistent_rawscale")
        half_up = abs(ci_hi - ev_value)
        half_lo = abs(ev_value - ci_lo)
        if max(half_up, half_lo) > 0 and _rel_diff(half_up, half_lo) > 0.15:
            flags.append("asymmetric_raw_ci")

    # 10.-13. 2x2 cross-checks
    if all(x is not None for x in (ev_t, ev_c, n_t, n_c)) and n_t > 0 and n_c > 0:
        if ev_t == 0 or ev_c == 0:
            flags.append("empty_cell_no_derivation")
        else:
            rt = ev_t / n_t
            rc = ev_c / n_c
            if rc > 0:
                rr_calc = rt / rc
                if em in {"RR", "aRR"} and ev_value is not None and _rel_diff(rr_calc, ev_value) > 0.05:
                    flags.append("rr_inconsistent_with_2x2")
            if ev_c < n_c and ev_t < n_t:
                or_calc = (ev_t * (n_c - ev_c)) / (ev_c * (n_t - ev_t))
                if em in {"OR", "aOR"} and ev_value is not None and _rel_diff(or_calc, ev_value) > 0.10:
                    flags.append("or_inconsistent_with_2x2")

    # 14.-15. continuous cross-checks
    sd_t = _to_float(rec.get("sd_t"))
    sd_c = _to_float(rec.get("sd_c"))
    chg_sd_t = _to_float(rec.get("change_sd_t"))
    chg_sd_c = _to_float(rec.get("change_sd_c"))
    # NOTE: SD-vs-SE confusion cannot be reliably detected without knowing the
    # outcome scale; it is left to the human reviewer guided by checklists.
    if chg_sd_t is not None and sd_t is not None:
        if chg_sd_t > sd_t * 3:
            flags.append("change_sd_impossible")
    if chg_sd_c is not None and sd_c is not None:
        if chg_sd_c > sd_c * 3:
            flags.append("change_sd_impossible")

    # 16.-18. DTA cross-checks
    tp = _to_int(rec.get("TP"))
    fp = _to_int(rec.get("FP"))
    fn = _to_int(rec.get("FN"))
    tn = _to_int(rec.get("TN"))
    sens = _to_float(rec.get("sensitivity"))
    spec = _to_float(rec.get("specificity"))
    auc = _to_float(rec.get("auc"))
    if mt == "diagnostic_dta":
        if tp is not None and fn is not None and (tp + fn) > 0 and sens is not None:
            sens_calc = tp / (tp + fn)
            if abs(sens_calc - sens) > 0.01:
                flags.append("sens_inconsistent_with_2x2")
        if tn is not None and fp is not None and (tn + fp) > 0 and spec is not None:
            spec_calc = tn / (tn + fp)
            if abs(spec_calc - spec) > 0.01:
                flags.append("spec_inconsistent_with_2x2")
        if auc is not None and not (0.5 <= auc <= 1.0):
            flags.append("auc_below_chance")

    # 20. adjusted without covariates
    adj = _to_bool(rec.get("adjusted"))
    cov = rec.get("covariates") or ""
    if adj is True and (not isinstance(cov, str) or cov.strip() == ""):
        flags.append("adjusted_without_covariate_list")

    # finalize review_status
    dedup_flags = []
    for f in flags:
        if f not in dedup_flags:
            dedup_flags.append(f)
    flags = dedup_flags

    if flags:
        rec["review_status"] = "needs_review"
        prev = rec.get("needs_review_reason") or ""
        joined = "; ".join(flags)
        rec["needs_review_reason"] = f"{prev}; {joined}".strip("; ") if prev else joined
    else:
        if not rec.get("review_status"):
            rec["review_status"] = "candidate"

    return Flagged(
        study_id=rec.get("study_id", ""),
        meta_type=mt,
        reasons=flags,
    )


# ---------- conflict grouping ----------

def assign_conflicts(records: List[Dict[str, Any]]) -> None:
    """Stamp conflict_group_id + preferred for rows that share a tuple key."""
    by_tuple: Dict[Tuple, List[int]] = {}
    for i, r in enumerate(records):
        if r.get("meta_type") in {"prevalence_single_arm", "dose_response"}:
            # one row per arm/category by design; we still group, but rarely conflict
            key = _conflict_tuple(r) + (r.get("dose_level", ""),)
        else:
            key = _conflict_tuple(r)
        by_tuple.setdefault(key, []).append(i)

    for key, idxs in by_tuple.items():
        if len(idxs) <= 1:
            continue
        gid = str(uuid.uuid4())
        # sort: highest priority first; tiebreak by confidence then by source order in file
        idxs_sorted = sorted(idxs, key=lambda i: (-_priority(records[i]),
                                                  -(_to_float(records[i].get("confidence")) or 0.0),
                                                  i))
        winner = idxs_sorted[0]
        records[winner]["preferred"] = True
        records[winner]["conflict_group_id"] = gid

        winner_val = _to_float(records[winner].get("effect_value"))
        winner_measure = records[winner].get("effect_measure", "")

        for i in idxs_sorted[1:]:
            records[i]["preferred"] = False
            records[i]["conflict_group_id"] = gid
            cand_val = _to_float(records[i].get("effect_value"))
            if winner_val is None or cand_val is None:
                continue
            disagree = False
            if winner_measure in RATIO_MEASURES:
                if abs(cand_val - winner_val) > 0.05 * max(abs(winner_val), 1e-9):
                    disagree = True
            elif winner_measure in RAW_MEASURES:
                if abs(cand_val - winner_val) > 0.05 * max(abs(winner_val), 1e-9):
                    disagree = True
            elif winner_measure == "DTA_2x2":
                if abs(cand_val - winner_val) > 0.02:
                    disagree = True

            if disagree:
                records[i]["review_status"] = "needs_review"
                prev = records[i].get("needs_review_reason") or ""
                add = "conflicting_estimates_across_sources"
                records[i]["needs_review_reason"] = f"{prev}; {add}".strip("; ") if prev else add
                # also flag winner
                records[winner]["review_status"] = "needs_review"
                prev = records[winner].get("needs_review_reason") or ""
                records[winner]["needs_review_reason"] = f"{prev}; {add}".strip("; ") if prev else add
            else:
                if not records[i].get("review_status") or records[i]["review_status"] == "candidate":
                    records[i]["review_status"] = "superseded"


# ---------- I/O ----------

def read_jsonl(path: Path) -> Iterable[Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError as e:
                sys.stderr.write(f"[WARN] {path.name}:{line_no} not valid JSON: {e}\n")


def normalize_to_csv_row(rec: Dict[str, Any]) -> Dict[str, str]:
    """Flatten a JSONL record (which may carry nested `value:` blocks for
    study_metadata) into the canonical CSV header. Unknown fields are dropped."""
    flat: Dict[str, Any] = {k: rec.get(k) for k in CSV_HEADER}

    # If this is a study_metadata block, hoist common metadata fields up
    if rec.get("field") == "study_metadata" and isinstance(rec.get("value"), dict):
        for k, v in rec["value"].items():
            if k in CSV_HEADER and (flat.get(k) is None or flat.get(k) == ""):
                flat[k] = v

    out: Dict[str, str] = {}
    for k in CSV_HEADER:
        v = flat.get(k)
        if v is None:
            out[k] = ""
        elif isinstance(v, bool):
            out[k] = "TRUE" if v else "FALSE"
        elif isinstance(v, (dict, list)):
            out[k] = json.dumps(v, ensure_ascii=False)
        else:
            out[k] = str(v)
    return out


def write_csv(path: Path, rows: List[Dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_HEADER, quoting=csv.QUOTE_MINIMAL)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def write_report(path: Path, records: List[Dict[str, Any]], flagged: List[Flagged]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    n_total = len(records)
    n_flagged = sum(1 for r in records if r.get("review_status") in {"needs_review", "superseded"})
    by_reason: Dict[str, int] = {}
    for f in flagged:
        for r in f.reasons:
            by_reason[r] = by_reason.get(r, 0) + 1

    lines = [
        "# meta-extraction validation report",
        "",
        f"- Rows in JSONL: **{n_total}**",
        f"- Rows flagged (`needs_review` or `superseded`): **{n_flagged}**",
        "",
        "## Flag counts by reason",
        "",
        "| reason | count |",
        "|---|---|",
    ]
    for reason, count in sorted(by_reason.items(), key=lambda kv: -kv[1]):
        lines.append(f"| `{reason}` | {count} |")
    if not by_reason:
        lines.append("| _(none)_ | 0 |")

    lines += [
        "",
        "## Per-row flag detail",
        "",
        "| study_id | meta_type | reasons |",
        "|---|---|---|",
    ]
    for f in flagged:
        if not f.reasons:
            continue
        lines.append(f"| `{f.study_id}` | `{f.meta_type}` | {', '.join('`'+r+'`' for r in f.reasons)} |")
    if all(not f.reasons for f in flagged):
        lines.append("| _(none)_ | — | — |")

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------- main ----------

def main() -> int:
    ap = argparse.ArgumentParser(description="Validate meta-extraction candidates and emit tidy CSVs.")
    ap.add_argument("--in", dest="inp", required=True, help="Path to extraction_candidates.jsonl")
    ap.add_argument("--out-tidy", required=True, help="Path to tidy_estimates.csv")
    ap.add_argument("--out-by-type-dir", default=None, help="Directory for by_type/<meta_type>.csv")
    ap.add_argument("--out-report", default=None, help="Path to Markdown validation report")
    args = ap.parse_args()

    in_path = Path(args.inp)
    out_tidy = Path(args.out_tidy)
    out_report = Path(args.out_report) if args.out_report else None
    by_type_dir = Path(args.out_by_type_dir) if args.out_by_type_dir else None

    if not in_path.exists():
        sys.stderr.write(f"[ERROR] input not found: {in_path}\n")
        return 2

    records = [r for r in read_jsonl(in_path)]
    if not records:
        sys.stderr.write(f"[WARN] no records read from {in_path}\n")
        write_csv(out_tidy, [])
        if out_report:
            write_report(out_report, [], [])
        return 0

    # First pass: validate each row in place
    flagged: List[Flagged] = []
    for r in records:
        flagged.append(validate_row(r))

    # Second pass: conflict grouping
    assign_conflicts(records)

    # Write tidy CSV
    rows = [normalize_to_csv_row(r) for r in records]
    write_csv(out_tidy, rows)

    # Per-type CSVs
    if by_type_dir:
        by_type: Dict[str, List[Dict[str, str]]] = {}
        for r, src in zip(rows, records):
            mt = (src.get("meta_type") or "").strip()
            if not mt:
                continue
            by_type.setdefault(mt, []).append(r)
        for mt, group in by_type.items():
            write_csv(by_type_dir / f"{mt}.csv", group)

    # Validation report
    if out_report:
        write_report(out_report, records, flagged)

    n_flag = sum(1 for r in records if r.get("review_status") == "needs_review")
    n_sup = sum(1 for r in records if r.get("review_status") == "superseded")
    print(f"[meta-extraction] {len(records)} candidate rows; {n_flag} needs_review; {n_sup} superseded.")
    print(f"[meta-extraction] wrote {out_tidy}")
    if by_type_dir:
        print(f"[meta-extraction] wrote per-type CSVs under {by_type_dir}")
    if out_report:
        print(f"[meta-extraction] wrote report {out_report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
