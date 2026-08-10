---
name: pubmed-search-strategy
description: Build reproducible PubMed/MEDLINE search strategies for MedHelp Meta projects, especially diagnostic/prognostic tumor biomarker reviews, with saved query logs and PRISMA-ready counts.
allowed-tools:
  - Read
  - Write
  - Bash
---

# PubMed Search Strategy for Meta-analysis

## Purpose

Use this skill when a MedHelp Meta project needs a reproducible PubMed/MEDLINE query, a saved search log, or PRISMA search counts. It complements `pubmed-database`: this skill designs and documents the strategy; `pubmed-database` can execute API calls when needed.

This skill owns PubMed/MEDLINE only. Do not use it to search CNKI, SinoMed, WanFang, VIP, Embase, Cochrane, Web of Science, Scopus, OpenAlex, Zotero, Semantic Scholar, Google Scholar, bioRxiv, or publisher sites. Do not mix Chinese-language database searching into the PubMed route. For explicit Chinese/CNKI work, route to `real-literature-trace`; for explicit OpenAlex/OA discovery, route to `openalex-database`; for Zotero/user-library sync, route to `zotero-medautodata-library`; for unsupported formal databases, require user-provided exports.

For legacy Meta projects, write outputs under the generic project Meta directory contract:

- Search notes and rationale: `Literature/reports/`
- Query logs, raw records, imported records, and dedupe inputs: `Literature/references/`
- Screening exports after import/dedupe: `Experiment/datasets/`

For numbered Meta projects, use the app sync paths instead:

- `pubmed-search-strategy` owns PubMed source output: `02_search_dedupe/search/imported_records/pubmed.csv` for records, and optional raw logs under `02_search_dedupe/runs/pubmed/`.
- PubMed/API run JSON produced by the app may still live under `02_search_dedupe/search/pubmed_runs/<run-id>.json`.
- Each JSON file may be a root array or `{ "databaseName": "pubmed", "query": "...", "records": [...] }`; CSV should include headers such as `PMID`, `Title`, `Year`, `Journal`, `Abstract`, `DOI`

Search records are only audit/dedupe material until `citation-management` writes exactly `02_search_dedupe/screening_input.csv`. Do not claim anything is visible in the smart-screening page until title/abstract decisions are written to exactly `03_title_abstract_screening/screening_decisions.csv` or `screening_decisions.json`.

Do not create `Survey/meta-analysis`, `MetaAnalysis/`, or an extra nested `meta-analysis/` folder.

## Required records

For every search run, save:

- database name;
- exact query;
- search date;
- result count;
- imported count;
- duplicate count;
- raw response path.

Also record:

- search intent: scoping, diagnostic, prognostic, intervention, prevalence, or network;
- exact disease, biomarker/exposure, outcome, population, and date filters;
- whether MeSH terms were exploded or searched as major topics;
- any manual edits made after user-provided terms.

## Diagnostic tumor biomarker template

```text
({DISEASE_MESH} OR {DISEASE_SYNONYMS})
AND
({BIOMARKER} OR {BIOMARKER_SYNONYMS})
AND
(diagnosis OR diagnostic OR sensitivity OR specificity OR ROC OR AUC)
```

## Prognostic tumor biomarker template

```text
({DISEASE_MESH} OR {DISEASE_SYNONYMS})
AND
({BIOMARKER} OR {BIOMARKER_SYNONYMS})
AND
(prognosis OR survival OR "overall survival" OR "disease-free survival" OR "progression-free survival" OR "hazard ratio" OR HR)
```

## PubMed API rules

- Respect NCBI rate limits.
- Use API key if available.
- Cache responses.
- Save search strategy and date for PRISMA.
- Do not silently rewrite user queries.

## Handoff

After search execution, route the next step by artifact state:

- Need dedupe/reference management: use `citation-management`; add `zotero-medautodata-library` only if the user explicitly asks to sync their Zotero/user library. Write normalized source records to `02_search_dedupe/search/imported_records/*.csv`, then write the final deduped AI input table to exactly `02_search_dedupe/screening_input.csv`.
- Need AI title/abstract screening: write `03_title_abstract_screening/screening_decisions.csv` or `screening_decisions.json` with `reviewer: "ai_pre_screen"` for first-pass AI results. The smart-screening page displays this decision file, not the raw search file.
- Need Claude review: update the same decision records with `reviewer: "claude"` and preserve user decisions.
- Need missing full text after title/abstract AI second screen: use `meta-zotero-fulltext-handoff`.
- Need diagnostic extraction: use `diagnostic-data-extraction`.
- Need manuscript methods text: use `prisma-manuscript-writer`.
