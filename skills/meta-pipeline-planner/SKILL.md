---
name: meta-pipeline-planner
description: >
  Start or repair a MedHelp Meta-analysis / systematic review project pipeline. Use this as the Meta project planning entrypoint; it creates the research brief and task queue across 00_literature, protocol, search/screening, extraction/synthesis, manuscript, and promotion stages while enforcing the Meta directory contract.
stage: Meta pipeline planning
domain: medical
tags:
  - meta-analysis
  - systematic review
  - PRISMA
  - pipeline
  - research brief
  - task queue
---

# Meta Pipeline Planner

## Purpose

Use this skill when a Meta project needs to start, continue, or repair its `.pipeline/docs/research_brief.json` and `.pipeline/tasks/tasks.json`. It is the Meta-specific pipeline entrypoint and must not invoke database-study pre-analysis, baseline table, or cohort-modeling startup flows.

## Directory Contract

Do not create `Survey/meta-analysis`, `MetaAnalysis/`, a nested `meta-analysis/`, or provider-named output folders.

- `00_literature/reports/`: literature review, evidence summaries, research gaps, and feasibility notes.
- `00_literature/references/`: seed references and exploratory evidence records.
- `00_literature/topic_selection/`: Meta topic framing, PICO/PECO candidates, and feasibility decisions.
- `00_literature/scoping_review/`: scoping/systematic review route decisions and evidence maps.
- `01_protocol/`: project startup report (`project_startup_report.md`), task queue plan, locked protocol, PICO/PECO, eligibility criteria, outcomes, PRISMA logic, and registration guidance.
- `02_search_dedupe/`: formal search exports, dedupe outputs, candidate reference sheets, and AI screening input.
- `03_title_abstract_screening/`: canonical screening decisions plus `01_ai_pre_screen/` and `02_agent_rescreen/` audit folders for title/abstract first/second screen.
- `04_full_text_review/`: lawful full-text download/acquisition manifests, Zotero handoff records for remaining missing items, synced PDF/Markdown/HTML/text assets, full-text `stage: "full_text"` screening audit logs without `01_ai_pre_screen/` or `02_agent_rescreen/` subfolders, MinerU/direct-conversion outputs, and unavailable full text.
- `05_data_extraction/`: extraction sheets, study characteristics, effect-size fields, and meta-ready datasets.
- `06_quality_assessment/`: RoB/QUADAS/NOS/GRADE quality appraisal.
- `07_data_analysis/`: statistical scripts, model inputs, synthesis outputs, subgroup/sensitivity runs.
- `08_results_figures/`: forest, funnel, SROC, PRISMA flow, RoB, evidence maps, and result tables.
- `09_manuscript_submission/`: PRISMA manuscript, abstract, checklist, search appendix, and supplements.
- `10_presentation/`: slides, homepage, audio, video, and translation assets.

If this skill starts or repairs a project, write the startup/repair report into `01_protocol/project_startup_report.md` or a timestamped `01_protocol/project_startup_report-YYYY-MM-DD.md` variant. Do not leave the startup report only in chat or under `.pipeline/docs/chat-reports/`.

## Meta-Stage Plan

0. Literature/topic selection: evidence gap, seed references, search scope, feasibility, scoping-review route.
1. Protocol design: locked review type, PICO/PECO, eligibility, outcomes, screening rules.
2. Search/screening: formal search/dedupe, title/abstract first screen, title/abstract AI second screen, optional one-time catch-up audit, and explicit user overrides.
3. Full text/extraction/synthesis: lawful full-text download/acquisition, Zotero handoff for remaining missing records, full-text first screen, full-text second screen, MinerU/direct conversion, extraction, quality appraisal, statistical synthesis when eligible.
4. Manuscript/submission: PRISMA manuscript, tables, figures, checklist, supplements.
5. Presentation/translation: slides, project page, audio/video scripts, dissemination materials.

## Routing Rules

- Pipeline startup: `meta-pipeline-planner`, then `meta-analysis-workflow` only for cross-stage orchestration.
- Literature review: `literature-review`, `pubmed-search-strategy`, `pubmed-database`, `citation-management`, `scientific-critical-thinking`; use PubMed for seed searches and evidence gaps, but defer formal broad search logs to `02_search_dedupe/`.
- Topic framing: `scientific-brainstorming`, `hypothesis-generation`, `scientific-critical-thinking`, `literature-review`, `pubmed-search-strategy`, `pubmed-database`.
- Scoping/systematic review: `literature-review`, `pubmed-search-strategy`, `pubmed-database`, `citation-management`, `scientific-critical-thinking`; do not force quantitative synthesis.
- Protocol/PICO: `literature-review`, `scientific-critical-thinking`.
- Search/dedupe: `pubmed-search-strategy`, optional `pubmed-database` only when running the PubMed API, and `citation-management`.
- Reference/Zotero sync: `zotero-medautodata-library`, `citation-management`.
- Full-text download: `legal-pdf-acquisition`, `public-literature-download`, `citation-management`.
- Zotero communication for remaining missing full text: `meta-zotero-fulltext-handoff`, `zotero-medautodata-library`, `citation-management`.
- Screening first/second pass: `meta-screening-rescreen`, `peer-review`, `citation-management`.
- MinerU parse: `mineru-pdf-parser`, `data-transform`.
- Extraction/quality: `pdf-evidence-extraction`, `diagnostic-data-extraction`, `data-transform`, `scientific-critical-thinking`, `peer-review`.
- Synthesis gate: `diagnostic-meta-analysis`, `meta-statistics-r`, `statistical-analysis`, `data-stats-analysis`, `statsmodels`, `inno-experiment-analysis`.
- Figures: `data-visualization-biomedical`, `scientific-visualization`, `data-viz-plots`, `matplotlib`, `seaborn`, `plotly`.
- PRISMA manuscript: `prisma-manuscript-writer`, `manuscript-editor`, `inno-paper-writing`, `scientific-writing`, `citation-management`, `venue-templates`, `docx`.

Quantitative Meta types belong inside the synthesis stage:

- Diagnostic accuracy: TP/FP/FN/TN, sensitivity, specificity, DOR, HSROC/SROC.
- Intervention/effect-size: OR/RR/RD, MD/SMD, random effects, heterogeneity, subgroup/sensitivity.
- Prognostic HR: log(HR), SE, adjusted models, time-to-event outcomes.
- Prevalence/single-arm: numerator, denominator, transformed proportion/rate, heterogeneity.
- Network Meta: nodes, comparison network, transitivity, consistency, ranking; v1 creates the plan and data structure only.

## Source Ownership

- PubMed/MEDLINE is the default formal search route. Use `pubmed-search-strategy` for query design/logs and `pubmed-database` only when running the PubMed API.
- Zotero/user library belongs to `zotero-medautodata-library`; use it for user-library sync, attachments, and Meta missing-full-text handoff, not as an external database search.
- Dedupe and the final AI-screening input belong to `citation-management`; write exactly `02_search_dedupe/screening_input.csv`.
- OpenAlex/OA/citation discovery belongs to `openalex-database` only when explicitly requested.
- Chinese/CNKI/Chinese literature belongs to `real-literature-trace` only when explicitly requested.
- Embase, Cochrane, Web of Science, Scopus, SinoMed, WanFang, VIP, and similar sources require user exports/manual imports unless a dedicated local skill is added.

Do not start by searching all databases or by mixing Chinese and English sources. If scope is missing, default to PubMed/MEDLINE planning or ask one minimal source-scope question.

## Integrity and Review Gates

- Never fabricate search records, citation metadata, PDFs, extracted fields, study counts, effect sizes, quality ratings, statistical inputs, or results.
- If no usable data exists, a lawful PDF/full text cannot be found, or a field cannot be extracted, stop that substep and write a cannot-extract report in the active stage. Use concrete filenames such as `02_search_dedupe/no_data_report.md`, `04_full_text_review/unavailable_full_text_report.md`, `05_data_extraction/cannot_extract_data_report.md`, or `07_data_analysis/cannot_synthesize_report.md`.
- Build targeted human-review checkpoints at protocol lock, final search/dedupe input, low-confidence/conflicting screening decisions, full-text license/availability, extraction and quality rows before statistics, and synthesis/manuscript outputs before submission. Keep these queues small and specific.
- If code is needed, create or reuse a `code/` subfolder inside the corresponding numbered stage, such as `02_search_dedupe/code/`, `04_full_text_review/code/`, `05_data_extraction/code/`, `06_quality_assessment/code/`, `07_data_analysis/code/`, `08_results_figures/code/`, `09_manuscript_submission/code/`, or `10_presentation/code/`.
- After a long run or stage transition, compress context into files: update `.pipeline/docs/research_brief.json`, `.pipeline/tasks/tasks.json` or task details, and the relevant stage report with status, artifact paths, blockers, decisions, and next three actions.

## Output Contract

Update or create:

- `.pipeline/docs/research_brief.json`
- `.pipeline/tasks/tasks.json`
- `01_protocol/project_startup_report.md` when starting or repairing the pipeline

Both files must record the project question, current five-stage phase, missing artifacts, selected or pending review type, human gates, Zotero handoff/PDF/MinerU status, extraction/quality status, synthesis eligibility, next actions, and artifact paths relative to the standard directories above.

If key PICO/PECO or screening information is missing, ask only the minimum required questions, then create a task queue that starts from the first incomplete stage.
