---
name: baseline-table
description: >
  Generate publication-ready baseline characteristic tables (三线表 / Table 1) for medical
  research. Supports single-database and multi-database layouts, disease-stratified and
  exposure-stratified grouping, automatic normality-based formatting, survey-weighted
  statistics, standardized mean differences for propensity score matching, and export to
  LaTeX / Word / CSV. Follows STROBE, CONSORT, and Chinese medical journal formatting
  standards.
tags: [Clinical, Epidemiology, Statistics, Table1, Baseline, ThreeLineTable]
version: 0.1.0
---

# Baseline Characteristic Table (三线表 / Table 1)

A dedicated skill for generating the **baseline characteristics table** — the most
universal deliverable in medical research manuscripts. Covers single-database and
multi-database designs, multiple grouping strategies, weighted survey data, and
propensity-score diagnostics.

## When to Use

- Building **Table 1** (baseline / demographic characteristics) for any study design
- Comparing groups by **disease**, **exposure**, **treatment arm**, or **quartile**
- Producing **single-database** or **multi-database** combined tables
- Generating **survey-weighted** descriptive statistics (e.g. NHANES)
- Evaluating covariate balance via **Standardized Mean Difference (SMD)** after matching
- Formatting for **international journals** (English, STROBE/CONSORT) or **Chinese medical journals** (中华系列)

## Hard Rules

- Never invent or simulate participant data.
- Never report statistics without confirming the underlying data file exists.
- Always state the normality assessment method used when choosing mean±SD vs median(IQR).
- Always label the statistical test used for each variable's P-value.
- When using survey weights, state the weight variable and design explicitly.
- When presenting multi-database tables, clearly label the source database per row-block or column-block.

## Core Concepts

### Three-Line Table Format (三线表)

The standard medical table uses exactly three horizontal rules:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ← top rule (heavy)
 Variable        Group A     Group B     P
──────────────────────────────────────────  ← header rule
 Age, years      56.3±12.1   58.7±11.4   0.034
 Female, n(%)    234 (48.2)  189 (42.0)  0.062
 BMI, kg/m²      24.1±3.8    26.3±4.2    <0.001
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ← bottom rule (heavy)
```

No vertical rules. No internal horizontal rules between data rows.

### Variable Formatting Rules

| Variable Type | Normal Distribution | Non-Normal Distribution |
|--------------|-------------------|----------------------|
| Continuous   | mean ± SD         | median (Q1, Q3) or median (IQR) |
| Categorical  | n (%)             | n (%)                |
| Binary       | n (%)             | n (%)                |
| Ordinal      | n (%) per level or median (IQR) | n (%) per level or median (IQR) |

### Automatic Test Selection

| Scenario | Groups | Distribution | Test |
|----------|--------|-------------|------|
| Continuous, 2 groups | 2 | Normal | Independent t-test |
| Continuous, 2 groups | 2 | Non-normal | Mann-Whitney U |
| Continuous, >2 groups | ≥3 | Normal | One-way ANOVA |
| Continuous, >2 groups | ≥3 | Non-normal | Kruskal-Wallis |
| Categorical, expected ≥5 | ≥2 | — | χ² test |
| Categorical, expected <5 | 2 | — | Fisher's exact test |
| Trend across ordered groups | ≥3 | — | Cochran-Armitage / Jonckheere-Terpstra |

## Workflow

### Step 1: Identify Grouping Strategy

Before writing any code, clarify the table design:

```
┌─ Grouping axis ─────────────────────────────────────────────┐
│                                                              │
│  By disease:     DM vs Non-DM, CKD stages, cancer subtypes │
│  By exposure:    Drug A vs Drug B vs Placebo                │
│  By outcome:     Event vs No-event                          │
│  By quantile:    BMI quartiles, age tertiles                │
│  By database:    NHANES vs CHARLS vs CLHLS (横向比较)       │
│  Overall only:   Single-column descriptive (no comparison)  │
│                                                              │
│  Also decide:                                                │
│  • Include an "Overall" column?                             │
│  • Include P-value column?                                  │
│  • Include SMD column? (for matched cohorts)                │
│  • Survey-weighted? Which weight variable?                  │
└──────────────────────────────────────────────────────────────┘
```

### Step 2: Normality Assessment

```python
import numpy as np
import pandas as pd
from scipy import stats

def assess_normality(series, alpha=0.05):
    """Assess normality to decide mean±SD vs median(IQR).

    Uses Shapiro-Wilk for n < 5000, else D'Agostino-Pearson.
    """
    clean = series.dropna()
    n = len(clean)
    if n < 8:
        return False, "too_few_obs"

    if n < 5000:
        stat, p = stats.shapiro(clean)
        method = "Shapiro-Wilk"
    else:
        stat, p = stats.normaltest(clean)
        method = "D'Agostino-Pearson"

    return p >= alpha, method
```

### Step 3: Generate Table — Single Database

This is the most common scenario: one cohort, one grouping variable, Table 1.

```python
import pandas as pd
import numpy as np
from scipy import stats
from scipy.stats import (
    ttest_ind, mannwhitneyu, f_oneway, kruskal,
    chi2_contingency, fisher_exact, shapiro, normaltest,
)


def format_continuous(series, is_normal):
    """Format a continuous variable as mean±SD or median(IQR)."""
    clean = series.dropna()
    if is_normal:
        return f"{clean.mean():.1f} ± {clean.std():.1f}"
    else:
        q1, median, q3 = clean.quantile([0.25, 0.5, 0.75])
        return f"{median:.1f} ({q1:.1f}, {q3:.1f})"


def format_categorical(series):
    """Format categorical variable levels as n (%)."""
    counts = series.value_counts(dropna=False)
    total = series.notna().sum()
    rows = {}
    for level in counts.index:
        if pd.isna(level):
            continue
        n = counts[level]
        pct = n / total * 100 if total > 0 else 0
        rows[str(level)] = f"{n} ({pct:.1f})"
    return rows


def select_test_continuous(groups, is_normal):
    """Select and run the appropriate test for continuous data."""
    groups_clean = [g.dropna() for g in groups]
    k = len(groups_clean)

    if k == 2:
        if is_normal:
            stat, p = ttest_ind(groups_clean[0], groups_clean[1])
            return p, "t-test"
        else:
            stat, p = mannwhitneyu(groups_clean[0], groups_clean[1],
                                   alternative='two-sided')
            return p, "Mann-Whitney U"
    else:
        if is_normal:
            stat, p = f_oneway(*groups_clean)
            return p, "ANOVA"
        else:
            stat, p = kruskal(*groups_clean)
            return p, "Kruskal-Wallis"


def select_test_categorical(contingency_table):
    """Select and run the appropriate test for categorical data."""
    table = np.array(contingency_table)
    if table.shape == (2, 2) and table.min() < 5:
        odds, p = fisher_exact(table)
        return p, "Fisher's exact"
    else:
        chi2, p, dof, expected = chi2_contingency(table)
        if expected.min() < 5:
            chi2, p, dof, expected = chi2_contingency(table,
                                                       correction=True)
            return p, "χ² (Yates)"
        return p, "χ²"


def build_table1(df, group_col, continuous_vars, categorical_vars,
                 include_overall=True, decimal_places=1):
    """Build a complete Table 1 from a single DataFrame.

    Parameters
    ----------
    df : pd.DataFrame
    group_col : str
        Column defining groups (e.g. 'diabetes_status').
    continuous_vars : list[str]
        Continuous variable column names.
    categorical_vars : list[str]
        Categorical variable column names.
    include_overall : bool
        Whether to include an 'Overall' column.

    Returns
    -------
    pd.DataFrame
        Formatted Table 1 with group columns, Overall, P, and Test columns.
    """
    groups = sorted(df[group_col].dropna().unique())
    group_dfs = {g: df[df[group_col] == g] for g in groups}

    columns = []
    if include_overall:
        columns.append("Overall")
    columns += [str(g) for g in groups]
    columns += ["P", "Test"]

    rows = []

    # N row
    n_row = {"Variable": "N"}
    if include_overall:
        n_row["Overall"] = str(len(df))
    for g in groups:
        n_row[str(g)] = str(len(group_dfs[g]))
    n_row["P"] = ""
    n_row["Test"] = ""
    rows.append(n_row)

    # Continuous variables
    for var in continuous_vars:
        is_normal, _ = assess_normality(df[var])
        row = {"Variable": var}

        if include_overall:
            row["Overall"] = format_continuous(df[var], is_normal)
        for g in groups:
            row[str(g)] = format_continuous(group_dfs[g][var], is_normal)

        grp_series = [group_dfs[g][var] for g in groups]
        p, test_name = select_test_continuous(grp_series, is_normal)
        row["P"] = f"<0.001" if p < 0.001 else f"{p:.3f}"
        row["Test"] = test_name
        rows.append(row)

    # Categorical variables
    for var in categorical_vars:
        all_levels = sorted(df[var].dropna().unique(), key=str)

        header_row = {"Variable": var + ", n(%)"}
        for col in columns:
            if col not in ("Variable",):
                header_row[col] = ""
        rows.append(header_row)

        contingency = []
        for g in groups:
            col_counts = []
            for level in all_levels:
                col_counts.append((group_dfs[g][var] == level).sum())
            contingency.append(col_counts)
        contingency_table = list(zip(*contingency))

        p, test_name = select_test_categorical(
            np.array(contingency).T.tolist()
        )

        for level in all_levels:
            row = {"Variable": f"  {level}"}
            if include_overall:
                n = (df[var] == level).sum()
                total = df[var].notna().sum()
                row["Overall"] = f"{n} ({n/total*100:.1f})"
            for g in groups:
                n = (group_dfs[g][var] == level).sum()
                total = group_dfs[g][var].notna().sum()
                row[str(g)] = f"{n} ({n/total*100:.1f})"
            row["P"] = ""
            row["Test"] = ""
            rows.append(row)

        # Put P on the header row
        rows[-len(all_levels) - 1]["P"] = (
            f"<0.001" if p < 0.001 else f"{p:.3f}"
        )
        rows[-len(all_levels) - 1]["Test"] = test_name

    result = pd.DataFrame(rows)
    col_order = ["Variable"] + columns
    return result[col_order]
```

**Usage example — disease-stratified:**

```python
table1 = build_table1(
    df=cohort,
    group_col="diabetes_status",         # DM vs Non-DM
    continuous_vars=["age", "bmi", "sbp", "dbp", "hba1c", "egfr"],
    categorical_vars=["sex", "race", "smoking_status", "hypertension"],
    include_overall=True,
)
print(table1.to_string(index=False))
```

**Usage example — exposure quartiles:**

```python
cohort["bmi_quartile"] = pd.qcut(cohort["bmi"], q=4,
                                  labels=["Q1", "Q2", "Q3", "Q4"])
table1 = build_table1(
    df=cohort,
    group_col="bmi_quartile",
    continuous_vars=["age", "sbp", "dbp", "ldl", "hdl", "creatinine"],
    categorical_vars=["sex", "diabetes_status", "smoking_status"],
)
```

### Step 4: Multi-Database Table

Used when comparing the same variable set across different cohorts (e.g. NHANES vs CHARLS).

```python
def build_multi_database_table(datasets, db_names, continuous_vars,
                                categorical_vars):
    """Build a combined baseline table across multiple databases.

    Parameters
    ----------
    datasets : list[pd.DataFrame]
        One DataFrame per database.
    db_names : list[str]
        Database labels (e.g. ['NHANES', 'CHARLS', 'CLHLS']).
    continuous_vars, categorical_vars : list[str]
        Variable names (must exist in all datasets).

    Returns
    -------
    pd.DataFrame
        Table with one column per database plus an overall comparison P.
    """
    rows = []

    # N
    n_row = {"Variable": "N"}
    for name, ds in zip(db_names, datasets):
        n_row[name] = str(len(ds))
    n_row["P"] = ""
    n_row["Test"] = ""
    rows.append(n_row)

    # Continuous
    for var in continuous_vars:
        all_data = pd.concat([ds[var] for ds in datasets], ignore_index=True)
        is_normal, _ = assess_normality(all_data)

        row = {"Variable": var}
        grp_series = []
        for name, ds in zip(db_names, datasets):
            row[name] = format_continuous(ds[var], is_normal)
            grp_series.append(ds[var])

        p, test_name = select_test_continuous(grp_series, is_normal)
        row["P"] = f"<0.001" if p < 0.001 else f"{p:.3f}"
        row["Test"] = test_name
        rows.append(row)

    # Categorical
    for var in categorical_vars:
        all_levels = sorted(
            set().union(*[set(ds[var].dropna().unique()) for ds in datasets]),
            key=str,
        )

        header = {"Variable": var + ", n(%)"}
        for name in db_names:
            header[name] = ""
        header["P"] = ""
        header["Test"] = ""
        rows.append(header)

        contingency = []
        for ds in datasets:
            col = [(ds[var] == lv).sum() for lv in all_levels]
            contingency.append(col)
        cont_array = np.array(contingency).T
        p, test_name = select_test_categorical(cont_array.tolist())

        for level in all_levels:
            row = {"Variable": f"  {level}"}
            for name, ds in zip(db_names, datasets):
                n = (ds[var] == level).sum()
                total = ds[var].notna().sum()
                row[name] = f"{n} ({n/total*100:.1f})"
            row["P"] = ""
            row["Test"] = ""
            rows.append(row)

        rows[-len(all_levels) - 1]["P"] = (
            f"<0.001" if p < 0.001 else f"{p:.3f}"
        )
        rows[-len(all_levels) - 1]["Test"] = test_name

    result = pd.DataFrame(rows)
    col_order = ["Variable"] + db_names + ["P", "Test"]
    return result[col_order]
```

**Usage — NHANES vs CHARLS:**

```python
table_cross = build_multi_database_table(
    datasets=[nhanes_df, charls_df],
    db_names=["NHANES (USA)", "CHARLS (China)"],
    continuous_vars=["age", "bmi", "sbp", "dbp", "glucose"],
    categorical_vars=["sex", "education_level", "smoking_status"],
)
```

### Step 5: Survey-Weighted Table (NHANES)

```python
def weighted_mean_sd(values, weights):
    """Compute survey-weighted mean and SD."""
    clean = pd.DataFrame({"v": values, "w": weights}).dropna()
    v, w = clean["v"].values, clean["w"].values
    avg = np.average(v, weights=w)
    var = np.average((v - avg) ** 2, weights=w)
    return avg, np.sqrt(var)


def weighted_proportion(series, weights, level):
    """Compute survey-weighted proportion for a categorical level."""
    mask = series == level
    clean_w = weights[series.notna()]
    clean_m = mask[series.notna()]
    total_w = clean_w.sum()
    level_w = clean_w[clean_m].sum()
    return level_w / total_w if total_w > 0 else 0


def format_continuous_weighted(values, weights, is_normal):
    """Format weighted continuous variable."""
    m, sd = weighted_mean_sd(values, weights)
    if is_normal:
        return f"{m:.1f} ± {sd:.1f}"
    else:
        # For weighted medians, use weighted quantiles
        from statsmodels.stats.weightstats import DescrStatsW
        d = DescrStatsW(values.dropna(), weights=weights[values.notna()])
        q25 = d.quantile(0.25).iloc[0]
        q50 = d.quantile(0.50).iloc[0]
        q75 = d.quantile(0.75).iloc[0]
        return f"{q50:.1f} ({q25:.1f}, {q75:.1f})"


def build_table1_weighted(df, group_col, weight_col,
                           continuous_vars, categorical_vars):
    """Build a survey-weighted Table 1 (e.g. for NHANES).

    Parameters
    ----------
    df : pd.DataFrame
    group_col : str
        Grouping variable.
    weight_col : str
        Survey weight column (e.g. 'WTMEC2YR' for NHANES MEC).
    """
    groups = sorted(df[group_col].dropna().unique())
    group_dfs = {g: df[df[group_col] == g] for g in groups}
    rows = []

    # Weighted N (sum of weights → estimated population)
    n_row = {"Variable": "Weighted N (estimated)"}
    for g in groups:
        n_row[str(g)] = f"{group_dfs[g][weight_col].sum():,.0f}"
    n_row["Unweighted N"] = ""
    rows.append(n_row)

    n_row2 = {"Variable": "Unweighted N (sample)"}
    for g in groups:
        n_row2[str(g)] = str(len(group_dfs[g]))
    rows.append(n_row2)

    for var in continuous_vars:
        is_normal, _ = assess_normality(df[var])
        row = {"Variable": var}
        for g in groups:
            gd = group_dfs[g]
            row[str(g)] = format_continuous_weighted(
                gd[var], gd[weight_col], is_normal
            )
        rows.append(row)

    for var in categorical_vars:
        all_levels = sorted(df[var].dropna().unique(), key=str)
        header = {"Variable": var + ", weighted %"}
        for g in groups:
            header[str(g)] = ""
        rows.append(header)

        for level in all_levels:
            row = {"Variable": f"  {level}"}
            for g in groups:
                gd = group_dfs[g]
                wp = weighted_proportion(gd[var], gd[weight_col], level)
                row[str(g)] = f"{wp*100:.1f}%"
            rows.append(row)

    return pd.DataFrame(rows)
```

**Usage — NHANES with MEC weights:**

```python
table1_w = build_table1_weighted(
    df=nhanes,
    group_col="diabetes_status",
    weight_col="WTMEC2YR",
    continuous_vars=["RIDAGEYR", "BMXBMI", "LBXGLU", "LBXGLT"],
    categorical_vars=["RIAGENDR", "RIDRETH3", "SMQ020"],
)
```

### Step 6: Standardized Mean Difference (SMD)

For propensity-score matched cohorts, report SMD instead of (or alongside) P-values.

```python
def compute_smd(group1, group2, var_type="continuous"):
    """Compute Standardized Mean Difference.

    For continuous: (mean1 - mean2) / sqrt((sd1² + sd2²) / 2)
    For binary:     (p1 - p2) / sqrt((p1(1-p1) + p2(1-p2)) / 2)
    """
    g1, g2 = group1.dropna(), group2.dropna()

    if var_type == "continuous":
        pooled_sd = np.sqrt((g1.std()**2 + g2.std()**2) / 2)
        if pooled_sd == 0:
            return 0.0
        return (g1.mean() - g2.mean()) / pooled_sd
    else:
        p1, p2 = g1.mean(), g2.mean()
        denom = np.sqrt((p1*(1-p1) + p2*(1-p2)) / 2)
        if denom == 0:
            return 0.0
        return (p1 - p2) / denom


def build_table1_with_smd(df_before, df_after, group_col,
                           continuous_vars, categorical_vars):
    """Build a Table 1 comparing balance before and after PSM.

    Returns a table with columns:
    Variable | Before-Treated | Before-Control | SMD_before |
             | After-Treated  | After-Control  | SMD_after

    Convention: |SMD| < 0.1 is considered well-balanced.
    """
    rows = []
    groups = sorted(df_before[group_col].dropna().unique())
    if len(groups) != 2:
        raise ValueError("SMD table requires exactly 2 groups.")

    g0, g1 = groups[0], groups[1]

    for var in continuous_vars:
        row = {"Variable": var}

        # Before matching
        b0 = df_before[df_before[group_col] == g0][var]
        b1 = df_before[df_before[group_col] == g1][var]
        smd_b = compute_smd(b1, b0, "continuous")
        row["Before_" + str(g1)] = format_continuous(b1, assess_normality(b1)[0])
        row["Before_" + str(g0)] = format_continuous(b0, assess_normality(b0)[0])
        row["SMD_before"] = f"{abs(smd_b):.3f}"

        # After matching
        a0 = df_after[df_after[group_col] == g0][var]
        a1 = df_after[df_after[group_col] == g1][var]
        smd_a = compute_smd(a1, a0, "continuous")
        row["After_" + str(g1)] = format_continuous(a1, assess_normality(a1)[0])
        row["After_" + str(g0)] = format_continuous(a0, assess_normality(a0)[0])
        row["SMD_after"] = f"{abs(smd_a):.3f}"
        row["Balanced"] = "✓" if abs(smd_a) < 0.1 else "✗"
        rows.append(row)

    for var in categorical_vars:
        binary = df_before[var].nunique() == 2
        if binary:
            row = {"Variable": var}
            # Use proportion of the positive class
            pos_val = sorted(df_before[var].dropna().unique())[-1]

            b0 = (df_before[df_before[group_col] == g0][var] == pos_val).astype(float)
            b1 = (df_before[df_before[group_col] == g1][var] == pos_val).astype(float)
            smd_b = compute_smd(b1, b0, "binary")
            row["Before_" + str(g1)] = f"{b1.sum():.0f} ({b1.mean()*100:.1f})"
            row["Before_" + str(g0)] = f"{b0.sum():.0f} ({b0.mean()*100:.1f})"
            row["SMD_before"] = f"{abs(smd_b):.3f}"

            a0 = (df_after[df_after[group_col] == g0][var] == pos_val).astype(float)
            a1 = (df_after[df_after[group_col] == g1][var] == pos_val).astype(float)
            smd_a = compute_smd(a1, a0, "binary")
            row["After_" + str(g1)] = f"{a1.sum():.0f} ({a1.mean()*100:.1f})"
            row["After_" + str(g0)] = f"{a0.sum():.0f} ({a0.mean()*100:.1f})"
            row["SMD_after"] = f"{abs(smd_a):.3f}"
            row["Balanced"] = "✓" if abs(smd_a) < 0.1 else "✗"
            rows.append(row)
        else:
            # Multi-level: report each level separately
            for level in sorted(df_before[var].dropna().unique(), key=str):
                row = {"Variable": f"  {var} = {level}"}
                b0 = (df_before[df_before[group_col] == g0][var] == level).astype(float)
                b1 = (df_before[df_before[group_col] == g1][var] == level).astype(float)
                smd_b = compute_smd(b1, b0, "binary")
                row["SMD_before"] = f"{abs(smd_b):.3f}"

                a0 = (df_after[df_after[group_col] == g0][var] == level).astype(float)
                a1 = (df_after[df_after[group_col] == g1][var] == level).astype(float)
                smd_a = compute_smd(a1, a0, "binary")
                row["SMD_after"] = f"{abs(smd_a):.3f}"
                row["Balanced"] = "✓" if abs(smd_a) < 0.1 else "✗"
                rows.append(row)

    return pd.DataFrame(rows)
```

### Step 7: Export Formats

#### LaTeX (三线表 / booktabs)

```python
def to_latex_threeline(table_df, caption="Baseline Characteristics",
                        label="tab:baseline"):
    """Export Table 1 as LaTeX booktabs three-line table."""
    n_cols = len(table_df.columns)
    col_spec = "l" + "c" * (n_cols - 1)

    lines = [
        r"\begin{table}[htbp]",
        r"\centering",
        rf"\caption{{{caption}}}",
        rf"\label{{{label}}}",
        rf"\begin{{tabular}}{{{col_spec}}}",
        r"\toprule",
    ]

    # Header
    header = " & ".join(table_df.columns)
    lines.append(header + r" \\")
    lines.append(r"\midrule")

    # Data rows
    for _, row in table_df.iterrows():
        cells = []
        for val in row:
            s = str(val).replace("%", r"\%").replace("±", r"$\pm$")
            if s.startswith("<"):
                s = "$" + s + "$"
            cells.append(s)
        lines.append(" & ".join(cells) + r" \\")

    lines.append(r"\bottomrule")
    lines.append(r"\end{tabular}")

    # Footnote
    lines.append(
        r"\begin{tablenotes}\footnotesize"
    )
    lines.append(
        r"\item Continuous variables: mean $\pm$ SD or median (Q1, Q3); "
        r"Categorical variables: n (\%). "
        r"P-values from t-test, Mann-Whitney U, ANOVA, Kruskal-Wallis, "
        r"$\chi^2$, or Fisher's exact test as appropriate."
    )
    lines.append(r"\end{tablenotes}")
    lines.append(r"\end{table}")

    return "\n".join(lines)
```

#### CSV / Excel

```python
def export_table1(table_df, filename="table1"):
    """Export Table 1 to CSV and Excel."""
    table_df.to_csv(f"{filename}.csv", index=False, encoding="utf-8-sig")
    table_df.to_excel(f"{filename}.xlsx", index=False)
    print(f"Exported: {filename}.csv, {filename}.xlsx")
```

#### Word-friendly (tab-separated for paste)

```python
def to_word_paste(table_df):
    """Generate tab-separated text for pasting into Word tables."""
    return table_df.to_csv(sep="\t", index=False)
```

## Common Table Designs

### Design A: Single-Database, Disease-Stratified

```
Scenario:  NHANES cohort, grouped by diabetes status
Columns:   Overall | Non-DM | DM | P
Variables: Age, Sex, Race, BMI, SBP, DBP, HbA1c, eGFR, Smoking, etc.
Weight:    WTMEC2YR (optional)
```

### Design B: Single-Database, Exposure Quartiles

```
Scenario:  UK Biobank cohort, grouped by BMI quartiles
Columns:   Q1 | Q2 | Q3 | Q4 | P-trend
Variables: Age, Sex, SBP, LDL, HDL, Diabetes, Hypertension, etc.
Note:      Use Jonckheere-Terpstra for continuous trend, Cochran-Armitage for binary trend
```

### Design C: Multi-Database Comparison

```
Scenario:  Same research question across NHANES and CHARLS
Columns:   Variable | NHANES (USA) | CHARLS (China) | P
Purpose:   External validity / cross-national epidemiology
```

### Design D: PSM Balance Table

```
Scenario:  Statin users vs non-users, before and after propensity matching
Columns:   Variable | Before-Treated | Before-Control | SMD | After-Treated | After-Control | SMD
Threshold: |SMD| < 0.1 = balanced
```

### Design E: By-Indicator Classification (按指标分类)

```
Scenario:  Group variables by clinical category, not by participant group
Layout:
  Demographics: age, sex, race, education
  Vital signs: SBP, DBP, HR, BMI
  Laboratory: HbA1c, FPG, TC, TG, LDL, HDL, Cr, eGFR
  Comorbidities: hypertension, diabetes, CKD, CVD
  Lifestyle: smoking, alcohol, physical activity
```

## Chinese Medical Journal Formatting Notes

For 中华系列期刊 (Chinese Medical Association journals):

- Use Chinese labels: 年龄 (岁), 性别, 体质指数 (kg/m²)
- Format: 均数±标准差 or 中位数 (四分位间距)
- P值精确到小数点后三位，P<0.001 标记为 <0.001
- 表注格式：连续变量以 $\bar{x}±s$ 或 M(Q₁, Q₃) 表示；分类变量以 n(%) 表示
- Column header: 组别 | 变量 | 对照组 | 实验组 | 统计量 | P值

## Integration with Other Skills

| Stage | Skill | Handoff |
|-------|-------|---------|
| Data extraction | `nhanes-local-data-access`, `ukb-local-data-access`, etc. | Provides the raw DataFrame → this skill |
| Data cleaning | `data-transform` | Preprocessing before table generation |
| After Table 1 | `data-stats-analysis`, `statsmodels` | Inferential analysis |
| Survival modeling | `scikit-survival` | Time-to-event after baseline |
| Visualization | `data-visualization-biomedical` | KM curves, forest plots |
| Full Results | `inno-experiment-analysis` | Integrates Table 1 into Results text |

## Best Practices

1. **Always state the normality test** used (Shapiro-Wilk or D'Agostino-Pearson) and the threshold.
2. **Never mix SD and SE** — label clearly.
3. **Report missing data** — add a "Missing, n(%)" row or footnote per variable.
4. **Match test to design** — paired data requires paired tests (paired t, McNemar).
5. **For >2 ordered groups**, prefer trend tests over omnibus tests when appropriate.
6. **For weighted data**, always state the weight variable and survey design.
7. **SMD threshold** — |SMD| < 0.1 is the conventional cutoff for balance.
8. **Reproducibility** — save the generating script alongside the table output.

## Troubleshooting

### Issue: P-value is exactly 0 or NaN
Check for zero-variance columns or all-missing groups. Remove or impute before testing.

### Issue: Fisher's exact test is slow for large tables
Fisher's exact test is computationally intensive for tables larger than 2×2. For large
contingency tables, fall back to χ² test and note the expected-count assumption.

### Issue: Weighted median computation fails
Ensure `statsmodels` is installed. For edge cases with extreme weights, winsorize
weights at the 99th percentile before computing quantiles.

## References

- STROBE Statement: https://www.strobe-statement.org/
- CONSORT Statement: https://www.consort-statement.org/
- Austin PC. Balance diagnostics for comparing the distribution of baseline covariates
  between treatment groups in propensity-score matched samples. *Stat Med*. 2009;28(25):3083-3107.
- tableone Python package: https://github.com/tompollard/tableone
