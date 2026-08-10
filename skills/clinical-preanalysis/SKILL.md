---
name: clinical-preanalysis
description: >
  Run a go/no-go pre-analysis for clinical and epidemiologic database studies before
  baseline tables or full modeling. Use when the user wants 预分析、pilot stats、
  screening analysis, gatekeeping analysis, or an early feasibility check that
  extracts key exposures, core outcomes, time variables, and essential covariates,
  then combines clinical screening with epidemiologic indicators such as prevalence,
  incidence, person-time, crude and adjusted effect measures, overlap, and
  confounding checks to decide whether to continue, pause, or revise the design.
tags: [Clinical, Epidemiology, Statistics, PreAnalysis, Screening, Cox, Regression]
version: 0.1.0
---

# Clinical and Epidemiologic Pre-Analysis

Use this skill **before** `baseline-table`, full regression modeling, or manuscript
results drafting when the study still needs a fast but rigorous feasibility screen.

The goal is not to prove the final claim. The goal is to answer:

1. Are the **core exposure and outcome variables** actually available and usable?
2. Does the **study design and estimand** match the data that actually exist?
3. Is there enough **signal, event support, follow-up support, and overlap** to justify full analysis?
4. Should the project **continue**, **pause**, or **revise** the design first?

## When to Use

- The user says "预分析", "pilot analysis", "screening analysis", or "go/no-go"
- A clinical database study needs a **small, focused analysis** before Table 1
- A cohort / registry / survey study needs a **流行病学预判** before formal modeling
- The team wants to test whether an exposure-outcome pair is worth carrying forward
- The outcome type is known and the next step depends on whether early signal exists
- The user wants practical suggestions when the planned study looks weak or blocked

## Hard Rules

- Never invent variables, participants, events, follow-up time, or results.
- Never use mock data. Pull only real columns already present in the workspace.
- If the database source is not fixed, route first with `medhelp-local-database-router`.
- If required fields are missing, say exactly which fields are missing and stop or revise.
- Treat this as a **screening / feasibility** step, not the final inferential analysis.
- Always report effect estimates and diagnostics, not only P-values.
- Always match the **effect measure to the design**:
  - cross-sectional -> prevalence measure
  - fixed-window cohort -> risk measure
  - person-time cohort -> rate measure
  - time-to-event -> hazard measure
  - case-control -> odds ratio
- Never blur **prevalence**, **risk**, **rate**, and **hazard** into the same quantity.
- Never present an odds ratio as if it were a risk ratio when the outcome is common.
- Never mix **prevalent** and **incident** outcome logic without stating the distinction.
- For case-control screening, do not claim incidence, risk, or prevalence from the sampled set unless the design supports it.

## Core Workflow

### Step 1: Lock the minimal clinical + epidemiologic frame

Before any statistics, identify:

- Data source and table grain: patient / admission / ICU stay / wave / household / individual
- Study design: cross-sectional / retrospective cohort / prospective cohort / case-control / time-to-event
- Source population and eligibility window
- Primary exposure(s)
- Primary outcome(s)
- Prevalent versus incident outcome logic
- Index date / baseline date / exposure window / outcome window
- Time variable and censoring flag if survival analysis is possible
- Person-time availability if a rate or hazard analysis is planned
- Minimal clinically required covariates
- Minimal confounding structure: age / sex / calendar time / severity / comorbidity / site or wave, as appropriate
- Target estimand:
  - mean difference
  - prevalence difference / prevalence ratio
  - risk difference / risk ratio
  - odds ratio
  - incidence rate ratio
  - hazard ratio

If the variables are not extracted yet:

1. Use `medhelp-local-database-router` when the dataset is still undecided.
2. Use the relevant local extraction skill to pull only the needed columns.
3. Verify that exposure, outcome, and time semantics match the table grain.

If the requested estimand does **not** match the available data structure, stop and revise before modeling.

Examples:

- No event time -> do not force Cox
- Cross-sectional data -> do not claim incidence or risk ratio from follow-up
- Case-control sample -> use OR, not risk ratio from the sampled data
- No person-time denominator -> do not report incidence rates

### Step 2: Build the pre-analysis variable set

Keep the first pass small. Prefer:

- `1-2` primary exposures
- `1` primary outcome family
- `3-8` essential covariates only

Recommended output at this step:

- Variable inventory with exact column names
- Outcome typing: continuous / binary / categorical / time-to-event
- Study typing: cross-sectional / cohort / case-control / survival
- Missingness summary for exposure, outcome, time, and core covariates
- Event count or outcome distribution
- Exposure prevalence or category distribution
- If applicable: follow-up summary, median follow-up, or total person-time
- Early overlap screen for exposure groups or propensity-relevant covariates

### Step 3: Run the epidemiology screening pack

Always choose a first-pass epidemiologic summary before the regression screen.

#### A. Cross-sectional or survey-style design

Use when exposure and outcome are measured at the same window or wave.

Report:

- exposure prevalence
- outcome prevalence
- weighted prevalence if survey design or weights are present
- crude prevalence difference or prevalence ratio when meaningful
- odds ratio only if it is truly the intended effect measure or the modeling constraint requires it

Preferred screening questions:

- Is the outcome too common for OR to be the only reported screen?
- Does the design support prevalence language rather than incidence language?
- Are exposure groups severely imbalanced on core covariates?

#### B. Fixed-window cohort design

Use when there is a valid baseline and a defined follow-up outcome window but no detailed person-time modeling is needed yet.

Report:

- N at risk at baseline
- cumulative incidence by exposure group
- crude risk difference and risk ratio if feasible
- odds ratio only as a secondary or model-based shortcut, not the main epidemiologic interpretation

Preferred screening questions:

- Is the outcome rare enough that OR is close to RR, or should the screen prefer RR / RD?
- Does the baseline definition clearly separate prevalent from incident cases?

#### C. Person-time cohort or event-history design

Use when valid follow-up time can be accumulated.

Report:

- event count
- total person-time
- incidence rate by exposure group
- crude incidence rate ratio when feasible
- Kaplan-Meier or cumulative incidence summary when relevant

Preferred screening questions:

- Is person-time credible and non-negative?
- Is Cox justified, or is a count/rate model more defensible for the first pass?
- Is the event rate too sparse for the planned adjustment set?

#### D. Case-control design

Use when sampling is outcome-based.

Report:

- exposure frequency among cases and controls
- crude odds ratio
- matching variables or sampling structure if known

Preferred screening questions:

- Are controls selected from the correct source population?
- Is the exposure sufficiently represented in both cases and controls?
- Avoid risk / rate language unless the design explicitly supports it.

### Step 4: Run the matching statistical battery

Choose the smallest valid combination based on the outcome type.

#### A. Continuous outcome

Use when the core endpoint is numeric, for example length of stay or a lab value.

- Exposure vs outcome:
  - continuous exposure -> Pearson or Spearman correlation
  - binary / grouped exposure -> t-test or Mann-Whitney
  - multi-group exposure -> ANOVA or Kruskal-Wallis
- Minimal model:
  - univariable linear regression
  - adjusted linear regression with essential covariates

Report:

- correlation coefficient or group difference
- beta with 95% CI
- missingness and outlier concerns
- whether the contrast is descriptive, cross-sectional, or longitudinal

#### B. Binary outcome

Use when the endpoint is yes/no, for example mortality, readmission, AKI, or complication.

- Exposure vs outcome:
  - categorical exposure -> chi-square or Fisher's exact test
  - continuous exposure -> group comparison or rank test as appropriate
- Minimal model:
  - cross-sectional common outcome -> consider prevalence ratio model or robust Poisson screen
  - cohort fixed-window outcome -> prefer risk-oriented interpretation; logistic is acceptable as a model, but do not overinterpret OR as RR
  - case-control outcome -> odds ratio is the correct primary measure
  - adjusted regression with essential covariates only

Report:

- event counts and event rate
- the effect measure actually used: PR / RR / OR with 95% CI
- crude and minimally adjusted estimates when possible
- separation or convergence problems if present

#### C. Count or rate outcome

Use when the outcome is event count or when the denominator is person-time.

- Exposure vs outcome:
  - crude rate by exposure group
  - exact or approximate incidence rate ratio when feasible
- Minimal model:
  - Poisson or negative binomial screen
  - use log person-time offset when person-time is valid

Report:

- total events
- total person-time
- crude rate and adjusted rate ratio with 95% CI
- overdispersion or zero inflation concerns if obvious

#### D. Time-to-event outcome

Use only when both an **event indicator** and a valid **time-to-event** variable exist.

- Descriptive screen:
  - Kaplan-Meier curves when grouping is meaningful
  - log-rank test for grouped exposure if appropriate
- Minimal model:
  - univariable Cox regression
  - adjusted Cox regression with essential covariates

Report:

- number of events and censoring pattern
- median follow-up or another compact follow-up summary
- hazard ratio with 95% CI
- proportional hazards concerns if detected

#### E. Categorical outcome with more than two levels

Keep the screen descriptive unless a clear multinomial strategy is already justified.

- cross-tabulation + chi-square / Fisher where appropriate
- collapse sparse levels if clinically justified
- propose whether the endpoint should be simplified before full analysis

### Step 5: Add a confounding and overlap screen

Before the gate, run a compact epidemiologic validity check:

- crude versus adjusted estimate:
  - if the point estimate changes materially after minimal adjustment, flag confounding risk
- overlap / positivity:
  - inspect whether exposure groups have severe support gaps on key covariates
- imbalance:
  - report key standardized mean differences or a compact imbalance summary when grouping is central
- collinearity / redundancy:
  - if a covariate set is clearly unstable, reduce to the minimal confounder set
- temporality:
  - flag any exposure/outcome timing ambiguity
- missingness mechanism:
  - note whether complete-case analysis may distort inference

Simple screening heuristics that justify a `revise` flag:

- apparent incident analysis but only prevalent data are available
- outcome is common and the screen relies only on OR without explanation
- exposure prevalence is extremely low or there is near-zero overlap
- events-per-variable support is too thin for the proposed adjustment set
- person-time is invalid, incomplete, or inconsistent with the requested rate / hazard model

### Step 6: Apply the gate

Classify the result into one of three decisions.

#### Continue

Use `continue` when most of the following hold:

- design, timing, and estimand are aligned
- exposure, outcome, and time variables are available and interpretable
- missingness in core fields is manageable
- event count, person-time, or outcome spread is adequate for the planned model
- exposure prevalence or group support is adequate
- there is no obvious fatal positivity / overlap failure
- direction and magnitude are clinically plausible
- direction and magnitude are epidemiologically interpretable
- minimal adjusted model converges without fatal diagnostics

#### Pause

Use `pause` when the current design is not analysis-ready, for example:

- key exposure / outcome / time field is missing
- study design cannot be established from the current data slice
- event count is too low for the planned model
- heavy missingness in core variables
- no valid follow-up definition for an incident analysis
- no valid denominator for a rate analysis
- near-complete lack of overlap between key comparison groups
- complete separation, non-convergence, or unstable estimates
- Cox is planned but time/event structure is unusable

#### Revise

Use `revise` when the project is still promising but needs a concrete change:

- redefine the design from cross-sectional to cohort, or vice versa
- switch the estimand from OR to PR / RR / IRR / HR as appropriate
- redefine prevalent versus incident outcome logic
- add or simplify index date / washout / look-back rules
- redefine the outcome window
- simplify exposure groups
- reduce covariate burden
- move from Cox to fixed-window regression because time structure is weak
- move from logistic to robust Poisson / rate model because epidemiologic interpretation matters more
- change from Cox to logistic because follow-up timing is inadequate
- postpone subgroup analysis
- improve missing-data handling before formal inference

### Step 7: Hand off to the next skill

- If `continue`:
  - use `baseline-table` for Table 1
  - use `statsmodels` or `scikit-survival` for the formal model
  - use `inno-experiment-analysis` for full results integration
- If `pause` or `revise`:
  - write 1-3 concrete next actions
  - say what evidence is missing and what would unblock the study

## Decision Matrix

| Design / outcome type | Epidemiologic screen | Minimal model | Typical next step |
| --- | --- | --- | --- |
| Cross-sectional binary | prevalence, prevalence difference / ratio, crude OR if needed | PR-oriented model or logistic with careful interpretation | `baseline-table` + `statsmodels` |
| Fixed-window cohort binary | cumulative incidence, risk difference / ratio | logistic or robust Poisson screen with risk-oriented interpretation | `baseline-table` + `statsmodels` |
| Person-time outcome | events, person-time, crude rate, IRR | Poisson / NB with offset | `baseline-table` + `statsmodels` |
| Time-to-event | KM / follow-up / log-rank | Cox regression | `baseline-table` + `scikit-survival` |
| Continuous | distribution + group difference / correlation | Linear regression | `baseline-table` + `statsmodels` |
| Sparse multi-class | cross-tab + descriptive review | Usually revise first | outcome simplification or redesign |

## Minimum Deliverable

Always produce a short Markdown artifact that includes:

- dataset and table grain
- study design and target estimand
- exact exposure / outcome / covariate set used
- missingness summary
- prevalence / incidence / person-time summary as applicable
- screening methods chosen and why
- crude and minimally adjusted estimates with 95% CI
- overlap / confounding / temporality judgment
- gate verdict: `continue`, `pause`, or `revise`
- recommended next skill and next action

Save it under:

- `Experiment/analysis/<agent>/YYYY-MM-DD-clinical-preanalysis-<agent>.md`

Use `codex` for `<agent>` in this environment.

## Recommended Prompt Pattern

If the user request is underspecified, first clarify only the minimum needed:

- which database or cohort
- what the study design is supposed to be
- what the main exposure is
- what the main outcome is
- whether the outcome is prevalent or incident
- what the correct epidemiologic estimand should be
- whether a time-to-event analysis is actually possible

Then run the screening workflow above with the smallest valid variable set.
