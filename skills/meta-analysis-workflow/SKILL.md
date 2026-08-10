---
name: meta-analysis-workflow
description: >
  Medical systematic review and Meta-analysis pipeline skill for MedHelp Meta projects. It starts and coordinates the Meta workflow from 00_literature evidence review/topic selection through protocol, search/screening, extraction, synthesis, manuscript/submission, and presentation while keeping artifacts in the standard project folders.
stage: Meta pipeline orchestration
domain: medical
tags:
  - systematic review
  - meta-analysis
  - PRISMA
  - GRADE
  - literature search
  - MinerU
  - forest plot
  - medical research
---

# Meta-analysis Workflow

## Purpose

Use this skill as the controller for a complete medical systematic review / Meta-analysis project. It does not replace specialized skills; it routes work to them, records state, prevents repeated work, and keeps all artifacts in the MedHelp Meta project layout.

The workflow is designed for MedHelp Meta projects that use Claude, terminal tools, and uploaded or synchronized references.

## When to use

Use this skill when the user asks for any of the following:

- Start, continue, audit, or summarize a medical Meta-analysis / systematic review pipeline.
- Build PRISMA-compliant literature search, screening, extraction, statistics, plots, and manuscript outputs.
- Run lawful full-text download/acquisition for queued records first, hand only remaining missing full-text records to Zotero for PDF retrieval/attachment, then parse/convert synced assets for full-text AI screening.
- Generate extraction tables, risk-of-bias tables, forest plots, funnel plots, subgroup/sensitivity analysis, or a manuscript.

## Project directory contract

Create or reuse the standard project structure below. Do **not** create `Survey/meta-analysis`, `MetaAnalysis/`, or any extra `meta-analysis` subdirectory in new Meta projects.

```text
00_literature/
  reports/          # evidence review, evidence gaps, feasibility notes
  references/       # seed references and exploratory evidence records
  topic_selection/  # Meta topic framing and PICO/PECO candidates
  scoping_review/   # scoping/systematic review route decisions
01_protocol/        # project startup report, locked protocol, PICO/PECO, eligibility, outcomes
02_search_dedupe/   # formal search logs, imported records, dedupe outputs
03_title_abstract_screening/
  01_ai_pre_screen/  # first-pass AI queue, rubric, and reports
  02_agent_rescreen/ # named-AI second screen, decisions, conflicts, and optional catch-up
04_full_text_review/
  fulltext_manifest.json # full-text availability and handoff queue
  fulltext/              # PDFs, Markdown, HTML, and text assets
  full_text_screening_audit.md # optional concise full-text screening log
05_data_extraction/
06_quality_assessment/
07_data_analysis/
08_results_figures/
09_manuscript_submission/
10_presentation/
.pipeline/
  docs/research_brief.json
  tasks/tasks.json
```

Never overwrite a non-empty artifact without first creating a timestamped backup or recording a deliberate replacement in `.pipeline/docs/research_brief.json` or the relevant analysis log.

Project startup, pipeline bootstrap, and initial task-queue reports must be saved in the workflow research-plan area as `01_protocol/project_startup_report.md` or a timestamped `01_protocol/project_startup_report-YYYY-MM-DD.md` variant. Do not leave these reports only in chat or under `.pipeline/docs/chat-reports/`.

If any step writes scripts, notebooks, extraction runners, statistics code, plotting code, or web assets, create or reuse a `code/` subfolder inside the relevant numbered stage, such as `02_search_dedupe/code/`, `04_full_text_review/code/`, `05_data_extraction/code/`, `06_quality_assessment/code/`, `07_data_analysis/code/`, `08_results_figures/code/`, `09_manuscript_submission/code/`, or `10_presentation/code/`.

## MedHelp smart-screening artifact contract

For numbered Meta projects, the app syncs structured JSON artifacts into the Meta workspace. Keep the distinction between the AI screening input pool and visible screening decisions:

- Source search outputs are intermediate files only. Write database-normalized source records to `02_search_dedupe/search/imported_records/<database>.csv`; these source files are for audit/dedupe, not for direct page sync.
- After dedupe, the canonical final AI-screening input table is exactly `02_search_dedupe/screening_input.csv` (CSV preferred; `screening_input.json`/`.tsv` are compatibility alternatives). `citation-management` owns this final deduped table. Raw database runs may remain under `02_search_dedupe/runs/`, but they are not scanned as page input.
- After search/dedupe, make sure records include at least `title`, plus any available `doi`, `pmid`, `source_id`, `year`, `journal`, `abstract`, `authors`, `databaseName`, and `url`. These records are imported/linked to the Meta project and become AI pre-screen candidates, but the smart-screening page must not show them as screening results.
- The smart-screening page displays only records from the canonical table `03_title_abstract_screening/screening_decisions.csv` (CSV preferred; `screening_decisions.json`/`.tsv` are compatibility alternatives). Use `stage: "title_abstract"` for title/abstract decisions and `stage: "full_text"` for full-text decisions. Do not write project-name-specific files such as `screening_<project>.csv`; they will not be synced. JSON may use a root array, `records`, or `decisions`; CSV should include `Title`, `Stage`, `Decision`, `Reviewer`, and optional `PMID`, `DOI`, `Confidence`, `Reason`, `Evidence Note`.
- Use `03_title_abstract_screening/01_ai_pre_screen/` and `03_title_abstract_screening/02_agent_rescreen/` for title/abstract first/second screen audit outputs. Do not create `01_ai_pre_screen/` or `02_agent_rescreen/` under `04_full_text_review/`; full-text decisions remain `stage: "full_text"` records in the canonical `screening_decisions.csv/json`, while full-text assets, parse outputs, unavailable lists, and concise audit logs stay under `04_full_text_review/` or `04_full_text_review/fulltext/`.
- For first-pass AI screening, write `reviewer: "ai_pre_screen"` and include `decision` (`include`, `exclude`, or `maybe`), `confidence`, `reason`, and `evidenceNote`. The app treats this as pending AI second screen; it is not a default user-review queue and must not unlock Zotero full-text handoff by itself.
- For the Claude AI second screen, update the same record with `reviewer: "claude"`. Claude `include` or `maybe`, plus explicit `reviewer: "user"` overrides, only make records eligible for a full-text need queue; write `needs_full_text: true` in `04_full_text_review/fulltext_manifest.json/csv` only for records that still lack usable local full text. First run lawful acquisition/download with `legal-pdf-acquisition` and `public-literature-download`; push only records that remain incomplete to Zotero with `meta-zotero-fulltext-handoff`.
- If the second pass still has obvious risk, run at most one AI catch-up audit focused on false exclusions, missed PICO matches, low-confidence includes, and inconsistent reasons. Keep the output concise and do not manufacture a large user confirmation backlog.
- User decisions are highest-priority overrides or spot-check results only. Do not overwrite records whose current reviewer is `user`; instead report the conflict and leave the user decision in place. Do not require user confirmation as a routine screening gate.
- When the API is available, call `POST /api/meta-analysis/:id/artifacts/sync` after writing search or screening JSON. Older callers may use `/screening/sync-artifacts`, but the unified endpoint is preferred. The sync writes `03_title_abstract_screening/sync_report.json` with warnings and counts for the file panel.

## Meta-stage pipeline

| Stage | Goal | Primary artifact roots |
|---|---|---|
| 0. Literature/topic | Evidence gaps, seed references, topic feasibility, scoping-review route, candidate question | `00_literature/` |
| 1. Protocol design | Locked review type, PICO/PECO, eligibility, outcomes, PRISMA plan | `01_protocol/` |
| 2. Search/screening | Formal search/dedupe, title/abstract AI first screen, AI second screen, optional catch-up audit, user overrides | `02_search_dedupe/`, `03_title_abstract_screening/` |
| 3. Full text/extraction/synthesis | Lawful full-text download/acquisition, Zotero handoff for remaining missing records, full-text first screen, full-text second screen, MinerU/direct conversion, extraction, quality appraisal, statistical synthesis | `04_full_text_review/`, `05_data_extraction/`, `06_quality_assessment/`, `07_data_analysis/` |
| 4. Manuscript/submission | PRISMA manuscript, tables, figures, checklist, supplement | `08_results_figures/`, `09_manuscript_submission/` |
| 5. Presentation/translation | Slides, project page, audio, video, dissemination assets | `10_presentation/` |

## Skill dispatch map

Route each stage to the most relevant specialized skill:

| Stage | Primary skills | Output |
|---|---|---|
| Pipeline startup | `meta-pipeline-planner`, `meta-analysis-workflow` | research brief, five-stage task queue |
| Literature review | `literature-review`, `pubmed-search-strategy`, `pubmed-database`, `citation-management`, `scientific-critical-thinking` | `00_literature/` evidence gaps, seed references, search-scope notes |
| Topic framing | `scientific-brainstorming`, `hypothesis-generation`, `scientific-critical-thinking`, `literature-review`, `pubmed-search-strategy`, `pubmed-database` | `00_literature/topic_selection/` review type, PICO/PECO candidates, feasibility decision |
| Scoping / systematic review | `literature-review`, `pubmed-search-strategy`, `pubmed-database`, `citation-management`, `scientific-critical-thinking` | `00_literature/scoping_review/` evidence map, PRISMA counts, narrative synthesis plan |
| Protocol / PICO | `literature-review`, `scientific-critical-thinking` | PICO/PECO, protocol, inclusion/exclusion |
| Search strategy | `pubmed-search-strategy`, optional `pubmed-database` only for API execution | PubMed/MEDLINE search strings, raw records, search log |
| Reference management | `zotero-medautodata-library`, `citation-management`, `references` API/Zotero | User library sync, BibTeX/CSV references, deduped records, Zotero links |
| Full-text download | `legal-pdf-acquisition`, `public-literature-download`, `citation-management` | `fulltext_manifest` need queue with `needs_full_text=true`, lawful project/user/OA asset checks, `downloaded`/`exists`/`manual_upload_required`/`no_oa_pdf`/`failed` status |
| Zotero communication | `meta-zotero-fulltext-handoff`, `zotero-medautodata-library`, `citation-management` | only records still incomplete after lawful download pushed to Zotero, `zotero_handoff_report`, synced user-owned PDF attachments |
| Full-text parsing/conversion | `mineru-pdf-parser`, then `pdf` fallback for PDFs; direct conversion for Markdown/HTML/text | Markdown/JSON/tables/images per paper where available |
| Extraction tables | `pdf-evidence-extraction`, `diagnostic-data-extraction`, `spreadsheets`, `xlsx`, `data-transform`, `polars` | Study/outcome/effect tables with provenance |
| Screening first/second pass | `meta-screening-rescreen`, `peer-review`, `citation-management` | Title/abstract and full-text AI first-screen files, AI second-screen queues, optional catch-up audit, conflicts, final inclusion list |
| Quality appraisal | `scientific-critical-thinking`, `peer-review`, `scholar-evaluation` | RoB/GRADE/QUADAS/NOS/JBI tables |
| Synthesis gate | `statistical-analysis`, `data-stats-analysis`, `statsmodels`, `inno-experiment-analysis` | Effect fields, variance, heterogeneity, synthesis eligibility |
| Diagnostic accuracy synthesis | `diagnostic-meta-analysis`, `meta-statistics-r`, `diagnostic-data-extraction`, `statistical-analysis`, `statsmodels`, `data-transform`, `data-visualization-biomedical` | TP/FP/FN/TN checks, sensitivity/specificity, DOR, HSROC/SROC plan |
| Intervention / effect-size synthesis | `statistical-analysis`, `data-stats-analysis`, `statsmodels`, `data-transform` | OR/RR/RD, MD/SMD, random effects, subgroup/sensitivity plan |
| Prognostic HR synthesis | `statistical-analysis`, `statsmodels`, `scikit-survival`, `data-transform` | log(HR), SE, adjusted models, time-to-event synthesis plan |
| Prevalence / single-arm synthesis | `statistical-analysis`, `data-stats-analysis`, `statsmodels` | Proportion/rate transform, denominators, random effects, heterogeneity plan |
| Network Meta synthesis planning | `statistical-analysis`, `data-transform`, `scientific-critical-thinking` | Nodes, comparison network, transitivity, consistency, ranking plan |
| Figures / medical visualization | `data-visualization-biomedical`, `scientific-visualization`, `data-viz-plots`, `matplotlib`, `seaborn`, `plotly` | Forest, funnel, SROC, PRISMA, RoB figures |
| PRISMA manuscript | `prisma-manuscript-writer`, `manuscript-editor`, `inno-paper-writing`, `scientific-writing`, `citation-management`, `venue-templates`, `docx` | PRISMA manuscript, abstract, supplement, formatted DOCX |
| Presentation / translation | `making-academic-presentations`, `paper-2-web`, `scientific-slides`, `pptx-posters` | Slides, homepage, audio/video scripts |

## Database scope policy

Do not search every literature source by default. Route by the source the user explicitly selected:

- PubMed/MEDLINE: use `pubmed-search-strategy` for query design and logs; add `pubmed-database` only when running the PubMed API. Write records to `02_search_dedupe/search/imported_records/pubmed.csv`.
- Zotero/user library: use `zotero-medautodata-library` only for syncing the user's library or attachments. Do not treat it as an external database search. Write records to `02_search_dedupe/search/imported_records/zotero.csv`.
- OpenAlex/OA/citation discovery: use `openalex-database` only when the user explicitly requests OpenAlex, OA discovery, or citation chasing.
- Chinese/CNKI/Chinese literature: use `real-literature-trace` only when the user explicitly requests Chinese literature, CNKI, or traceable Chinese records.
- Embase, Cochrane, Web of Science, Scopus, SinoMed, WanFang, VIP, and other unsupported formal databases: require user-provided exports or manual imports. Do not claim these databases were searched automatically.
- Dedupe and canonical AI-screening input: use `citation-management` after source-specific collection and write exactly `02_search_dedupe/screening_input.csv`.

If the database/language scope is missing, ask a minimal scope question or proceed with PubMed/MEDLINE only. Do not mix Chinese and English searches unless the user explicitly asks for both.

## Missing-skill supplement

The default missing-full-text route is two-step: first lawful full-text download/acquisition, then Zotero communication for records that remain incomplete. Use `legal-pdf-acquisition` and `public-literature-download` on the explicit `fulltext_manifest` queue only; then use `meta-zotero-fulltext-handoff` to push the remaining incomplete `fulltext_manifest` records to Zotero and let Zotero obtain or attach PDFs.

If a fallback OA download is explicitly requested, it should prefer:

1. Existing project PDFs and Zotero-owned PDFs, only for records already listed in the missing-full-text queue.
2. PMC OA Web Service / PMC ID Converter / PMC OAI-PMH / official FTP or cloud resources.
3. OpenAlex metadata or OA location metadata where API access is configured.
4. Official open HTML/Markdown/text full text when PDF is unavailable and the source is clearly public/open.
5. User-provided PDF, Markdown, HTML, or text uploads.

Do not scrape publisher sites, bypass paywalls, or use unofficial shadow libraries.

## Run modes

Accept these modes in the user prompt:

- `plan`: produce a protocol and executable queue without running downloads/statistics.
- `continue`: inspect existing artifacts and continue from the first incomplete phase.
- `summarize`: summarize current status and update `.pipeline/docs/research_brief.json` plus the relevant stage log.
- `zotero-handoff-only`: update the full-text need queue and push only incomplete records to Zotero.
- `download-only`: legacy fallback; update reference metadata and download legal public PDFs only when explicitly requested.
- `parse-only`: parse existing PDFs with MinerU and update parse manifest.
- `analysis-only`: run extraction validation, effect-size preparation, meta-analysis, and figures.
- `write-only`: write or update manuscript and formatting artifacts from existing results.

Default mode is `continue`.

## Meta-analysis type selection

Before statistics, infer and record the analysis family:

- Intervention binary outcome: OR, RR, RD, NNT when appropriate.
- Intervention continuous outcome: MD or SMD.
- Diagnostic accuracy: sensitivity, specificity, PLR, NLR, DOR, HSROC/SROC when available.
- Prognosis / survival: HR and log-HR standard error.
- Prevalence/incidence: transformed proportion/rate, random-effects model by default.
- Correlation: Fisher z transformation.
- Biomarker association: OR/HR/SMD depending endpoint and study design.
- Dose-response or network Meta-analysis: mark as advanced and ask for confirmation unless already specified.

Always record model choice, transformation, heterogeneity estimator, continuity correction, and software/package used.

## State file requirements

`.pipeline/docs/research_brief.json` and `.pipeline/tasks/tasks.json` must include or reference:

- Project question and PICO/PECO.
- Current Meta phase and completion percentage by phase.
- Artifacts created, with relative paths.
- Counts: searched, deduplicated, screened, full-text assessed, included, excluded.
- Zotero handoff/PDF summary: pushed, already complete, missing identifiers, attachment synced, failed.
- MinerU parse status.
- Extraction completeness.
- Quality appraisal status.
- Statistical model and current results.
- Figure/manuscript status.
- Next three actions.
- Date/time and model/backend used for each major update.
- A hard rule that early literature/topic/scoping artifacts stay in `00_literature/`, locked protocol artifacts stay in `01_protocol/`, and new artifacts must not use `Survey/meta-analysis` or a nested `meta-analysis` folder.

## Controller behavior

1. Start by inspecting project files, `.pipeline/docs/research_brief.json`, `.pipeline/tasks/tasks.json`, and existing reference artifacts.
2. Avoid repeating completed work unless inputs changed.
3. Prefer deterministic scripts for search result normalization, downloading, parsing, statistics, and figure generation.
4. Use LLMs for extraction and writing only with explicit schema and source-linked evidence.
5. Store every model-generated extraction row with source paper identifier, page/section evidence, and confidence flag.
6. When uncertain, mark rows as `needs_human_review` rather than inventing data.
7. Before writing Results, verify that extraction tables and statistical input agree.
8. Before final manuscript formatting, run a PRISMA/peer-review style audit.
9. Never fabricate search records, citation metadata, PDFs, extracted fields, study counts, effect sizes, quality ratings, statistical inputs, or results. If no usable data exists, a lawful PDF/full text cannot be found, or a field cannot be extracted, stop that substep and write a cannot-extract report in the active stage, such as `02_search_dedupe/no_data_report.md`, `04_full_text_review/unavailable_full_text_report.md`, `05_data_extraction/cannot_extract_data_report.md`, or `07_data_analysis/cannot_synthesize_report.md`.
10. Build targeted human-review checkpoints at protocol lock, final search/dedupe input, low-confidence/conflicting screening decisions, full-text license/availability, extraction and quality rows before statistics, and synthesis/manuscript outputs before submission. Keep these checkpoints specific; do not create a broad default user-confirmation backlog.
11. After a long run, a stage transition, or any major artifact change, compress context into files before continuing: update `.pipeline/docs/research_brief.json`, `.pipeline/tasks/tasks.json` or task details, and the relevant stage report with status, artifact paths, blockers, decisions, and next three actions. Resume from those files rather than relying on chat history.

## First response template

When invoked, respond with:

```text
Meta-analysis workflow status
- Detected project question:
- Detected review type:
- Current Meta phase:
- Existing artifacts:
- Missing required artifacts:
- Recommended mode:
- Immediate task queue:
- Commands/prompts to run:
```
