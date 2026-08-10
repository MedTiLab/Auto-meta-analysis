# Research Workflow Prompt Routing

This document summarizes how MedHelp guided prompts should route medical research tasks. The UI should not prepend the same generic sentence to every scenario. Each scenario should start from its own workflow position and use only the necessary skills.

## Main Flow

1. Project framing: identify whether the entry point is a literature question, registry cohort, paper reproduction, or existing dataset.
2. Evidence review: clarify PICO, search strategy, inclusion/exclusion criteria, evidence matrix, and gaps.
   - Meta-analysis / systematic review tasks may enter through the `medical-meta-analysis` TaskMaster template or the `metaAnalysis` skill shortcut.
   - New Meta projects use the `clinical-meta-v2` numbered workflow folders: literature/topic selection, protocol, search/dedupe, title/abstract screening, full-text review, data extraction, quality assessment, data analysis, results/figures, manuscript/submission, and presentation.
   - Legacy Meta projects without `clinical-meta-v2` keep their existing artifact roots and are not migrated automatically.
   - The shortcut should auto-route to the smallest necessary skill set and use `meta-analysis-workflow` only when cross-step orchestration is needed.
3. Data routing and extraction: choose the local/public database, state structural risks, locate real fields, and extract only needed variables.
4. Pre-analysis: check sample size, event count, missingness, overlap, crude effects, and minimum adjusted effects.
5. Statistical modeling: auto-route to test selection, direct tests, regression, survival, ML prediction, Bayesian modeling, UKB-specific analysis, or results integration.
6. Results integration: combine tables, models, figures, and sensitivity analyses into manuscript-ready Methods/Results.
7. Manuscript and review: write, polish, verify citations, review statistical validity, and handle rebuttal.
8. Visualization and promotion: produce journal figures, graphical abstracts, slides, and presentation assets.

## Prompt Policy

- Guided starter prompts are scenario-specific under `guidedStarter.prompts.*`.
- Auto-routed scenarios use `guidedStarter.routePrompts.*`.
- Skill shortcut auto-routing uses `skillShortcuts.routePrompts.*`.
- The old generic sentence remains only as a fallback template.

## Meta-analysis Default

Meta-analysis defaults to a controller-plus-specialists pattern:

- Start/continue/summarize whole review: `meta-analysis-workflow`.
- Literature review, Meta topic selection, and scoping route: `literature-review`, `citation-management`, and `scientific-critical-thinking`, with outputs in `00_literature/`.
- Protocol, PICO, eligibility, PRISMA framing: `literature-review` plus `scientific-critical-thinking` when method quality matters, with locked protocol outputs in `01_protocol/`.
- Biomedical search: `pubmed-database`; add `openalex-database` or `research-lookup` only for concrete gaps.
- References and dedupe: `citation-management`.
- Full-text download: `legal-pdf-acquisition` plus `public-literature-download`, limited to public/open-access or user-owned files.
- Zotero communication: `meta-zotero-fulltext-handoff` plus `zotero-medautodata-library`, only for records still missing after the full-text download/acquisition pass.
- Extraction and effect-size input: `data-transform` plus spreadsheet tooling when needed.
- RoB/GRADE/reporting checks: `scientific-critical-thinking` or `peer-review`.
- Statistical synthesis: `statistical-analysis`, with `statsmodels` for concrete modeling/meta-regression.
- Forest/funnel/PRISMA figures: `scientific-visualization` or `matplotlib`.
- Manuscript/DOCX/venue formatting: `scientific-writing`, `venue-templates`, or `docx`.

## Visualization Default

Medical visualization defaults to Nature-style figures:

- Prefer `nature-figure` first.
- Pair clinical/biomedical statistical plots with `data-visualization-biomedical`.
- Use `scientific-visualization` for general journal figure layout.
- Use `matplotlib`, `seaborn`, or `plotly` only when lower-level plotting code or interactivity is required.
