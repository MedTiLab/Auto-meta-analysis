---
name: inno-experiment-analysis
description: Use for analyzing study or pipeline outputs, drafting Results sections, statistical analysis of health data, comparing interventions or exposure groups, regulatory-style tables, and linking numeric outputs to manuscript text. Oriented to database-driven and clinical/translational research—not model-training benchmarks.
tags: [Research, Clinical, Epidemiology, Statistics, Visualization, Paper Writing]
version: 0.2.0
---

# Results Analysis for Medical and Health Research

A systematic workflow to turn **tabular study outputs, analysis exports, and structured logs** into validated statistics, figures, and **Results** text—with clear ties to data sources and pre-specified outcomes.

## Core Features

1. **Study data analysis** — Load and QC cohort tables, trial outputs, omics or survey exports, and analysis artifacts (CSV, JSON, Parquet, etc.)
2. **Statistical validation** — Estimation, inference, multiplicity, and sensitivity aligned to study design (RCT, cohort, case-control, cross-sectional, etc.)
3. **Manuscript-ready outputs** — Draft Results prose, tables, and figures suitable for biomedical journals and supplementary evidence files

## When to Use

Use this skill when you need to:

- Analyze results from a **clinical trial, observational cohort, registry, or biobank extract**
- Produce or refine the **Results** section of a paper or clinical study report
- Compare **arms, exposure categories, or pre-specified subgroups** (not “model A vs model B” unless that is the research question)
- Apply appropriate **significance tests, regression, survival analysis**, or **meta-analytic** summaries as the design warrants
- Build **publication-quality** figures (forest plots, KM curves, stratified bars, etc., as appropriate)
- Stress-test conclusions (**sensitivity analyses**, missing data, confounding)

For **prediction-model development** (AUC, calibration, external validation), still use this skill but frame metrics as **clinical prediction performance**, not generic “leaderboard” scores.

## Workflow

### Standard analysis pipeline

```
Data loading → Design & variable QC → Estimation / inference → Visualization → Results drafting → Quality check
```

### Step 1: Data loading and validation

**Typical formats**

- Cohort / trial **tabular** exports (CSV, TSV, Parquet, Feather)
- **JSON** or API dumps from pipelines or notebook exports
- **Analysis logs** or run manifests (environment versions, random seeds, package versions)—treat as reproducibility metadata, not as “training curves” unless you are explicitly analyzing iterative model training

**Validation checks**

- Completeness: missingness patterns, dropout, loss to follow-up
- Consistency: coding of exposures, outcomes, and time zero; units; derived variables
- Traceability: **which database snapshot, table, or extract** each file represents; document versions when possible

Select tools appropriate to file type and size; prefer **scripted, reproducible** steps over one-off edits.

### Step 2: Statistical analysis

**Descriptive summaries**

- Central tendency and spread appropriate to distribution
- Stratification by key covariates when pre-specified

**Inferential methods** (choose based on design and assumptions)

- Two-group and multi-group comparisons: t-tests, ANOVA, non-parametric analogs as warranted
- **Regression**: linear, logistic, proportional hazards, mixed models—match to outcome type and clustering
- **Multiplicity**: Bonferroni, FDR, or pre-specified hierarchical testing as per SAP or protocol
- **Missing data**: document approach (complete case, MI, etc.); avoid silently dropping informative missingness

**Reporting principles**

- Report **estimates with uncertainty** (CI, not only p-values); prefer **effect measures** interpretable in the clinical context (RD, RR, OR, HR, etc.)
- State **model family, covariate adjustment**, and **model-checking** where relevant
- Distinguish **exploratory** from **confirmatory** analyses when applicable

See `references/statistical-methods.md` if present for extended guidance.

### Step 3: Comparisons (interventions, exposures, or pre-specified benchmarks)

**Dimensions**

- Primary and secondary **endpoints** per protocol or SAP
- **Subgroup** or interaction analyses only when pre-specified or clearly motivated and labeled exploratory
- **Sensitivity analyses**: alternative covariate sets, alternate definitions, tipping-point ideas

**Fair comparison**

- Same population definitions, same follow-up rules, same handling of ties and censoring
- Prefer **intention-to-treat** vs **per-protocol** only when defined upfront

### Step 4: Visualization

**Requirements**

- Vector formats (PDF/EPS) when journals require; otherwise high-resolution PNG with care for downscaling
- **Colorblind-safe** palettes; readable in grayscale where possible
- Error bars / **confidence intervals** aligned to the statistical model (not SD mistakenly labeled as SE)
- Axes and legends that **encode clinical meaning** (time in consistent units, event definitions in captions)

**Common figure types in medicine**

- **Kaplan–Meier** and cumulative incidence where time-to-event applies
- **Forest plots** for subgroup effects or meta-analysis
- **Bar or dot plots** with uncertainty for arm-wise summaries
- **Spaghetti / line plots** for longitudinal trajectories (with caution about overplotting)
- **Heatmaps** for correlation or biomarker panels when justified

See `references/visualization-best-practices.md` if present.

### Step 5: Writing the Results section

**Suggested structure**

```markdown
## Results

### Participant flow and cohort characteristics
[CONSORT-style flow or STROBE elements as appropriate; baseline table reference]

### Primary outcome(s)
[Effect estimates, CIs, p-values if confirmatory; absolute risks where helpful]

### Secondary and exploratory outcomes
[Clearly labeled; multiplicity called out]

### Sensitivity and supplementary analyses
[Robustness to definitions, methods, or missingness]

### Safety or harms (if applicable)
```

**Writing principles**

- Tie each key numeric claim to a **table, figure, or analysis output**
- Avoid causal language incompatible with design
- Report **harms** and **null** findings with the same care as positive findings

See `references/results-writing-guide.md` if present.

### Step 6: Quality check

**Checklist**

- [ ] Estimates include **uncertainty** (CI or compatible interval)
- [ ] **Methods** for primary analysis stated and match **protocol / SAP** or pre-spec where claimed
- [ ] Figures use **appropriate** error representation and **interpretable** effect direction
- [ ] **Preprocessing** and **inclusion criteria** are reproducible from text + code
- [ ] **Computational environment** noted for scripted analyses (language version, key package versions)
- [ ] **Data use agreements** and **patient privacy** respected (no individual-level disclosure in drafts)
- [ ] Clinical interpretation stays within **evidence strength** (association vs causation)

## Common mistakes and pitfalls

### Statistical

❌ Cherry-picking significant endpoints or subgroups  
✅ Pre-specify or clearly mark exploratory analyses; report multiplicity  

❌ Conflating SD and SE or omitting uncertainty  
✅ Label dispersion measures precisely; prefer CIs for inference  

### Visualization

❌ Truncated axes that exaggerate differences  
✅ Justify axis ranges; include reference lines when clinically meaningful  

### Writing

❌ Over-claiming clinical benefit from observational data  
✅ Match language to design; discuss confounding and limitations  

See `references/common-pitfalls.md` if present.

## Integration with paper writing

This skill produces **analysis artifacts and Results-oriented drafts**. Pair with **`inno-paper-writing`** (or your venue-specific writing skill) for full IMRAD structure, journal formatting, and citation style.

**Division of labor**

| This skill (`inno-experiment-analysis`) | `inno-paper-writing` |
|----------------------------------------|----------------------|
| Numbers, models, figures, sensitivity    | Introduction, Methods narrative, Discussion, formatting |
| Evidence tables and Results draft      | Citations, journal templates, cover letter |

**Workflow**

```
Analysis outputs ready → inno-experiment-analysis → report + figures + results draft
    ↓
inno-paper-writing weaves into full manuscript
```

### Output artifacts (suggested)

1. **`analysis-report.md`** — Design recap, inclusion flow, model summaries, sensitivity index  
2. **`figures/`** — Vector or journal-compliant raster + standalone captions  
3. **`results-draft.md`** — Results section prose with figure/table cross-references  

## Examples and templates

If present under `examples/`:

- **`example-analysis-report.md`** — Worked reporting example  
- **`example-results-section.md`** — Results-only manuscript excerpt  

## Reference resources

### Bundled guides (if present)

- `references/statistical-methods.md`  
- `references/results-writing-guide.md`  
- `references/visualization-best-practices.md`  
- `references/common-pitfalls.md`  

### External (reporting and reproducibility)

- [EQUATOR reporting guidelines](https://www.equator-network.org/) — CONSORT, STROBE, PRISMA, TRIPOD, etc.  
- [Nature reporting summary](https://www.nature.com/documents/nr-reporting-summary-flat.pdf)  
- Journal-specific statistical and data-sharing policies  

## Best practices summary

✅ Anchor conclusions in **traceable data** (extract IDs, versions, query dates where allowed)  
✅ Prefer **pre-specification** or transparent labeling of **post hoc** work  
✅ Report **limitations** (bias, generalizability, missing data) honestly  
❌ Do not present **individual patient data** or circumvent **consent / DUA** in drafts  

## Summary

1. **Load and validate** study or database-derived analysis inputs  
2. **Estimate and infer** using design-appropriate statistics  
3. **Compare** arms, exposures, or pre-defined benchmarks fairly  
4. **Visualize** for clinical readability and journal standards  
5. **Draft Results** tied to tables, figures, and sensitivity analyses  
6. **Check** reproducibility, privacy, and strength of evidence  

Following this flow supports **database-driven auto-research** outputs that read as **medical research**, not generic ML benchmarking.
