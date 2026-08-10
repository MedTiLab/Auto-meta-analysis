---
name: medhelp-local-database-router
description: Use when the task starts with choosing, organizing, or routing among the local databases under $HOME/database, especially when the user mentions multiple datasets, asks which local database fits a question, wants a cleaner skill-level structure, or needs to compare MIMIC-IV, eICU-CRD, UK Biobank, NHANES, ELSA, HRS, KLoSA, LASI, MHAS, SHARE, CHARLS, CLHLS, CHNS, CFPS, CGSS, CHFS, CHIP, CLDS, or CSS before extraction. Route directly to the right standalone database skill and API source. Do not invent dataset coverage or mix database semantics without checking the documented boundaries.
---

# MedHelp Local Database Router

## Overview

This skill is a routing layer for the local database workspace. Use it to decide which database skill should handle the task before any extraction starts.

This skill is not the final extraction skill. Its job is to:

- classify the request by follow-up structure, primary unit, and content family
- pick the correct standalone skill or family entry point
- name the main grain, wave, or time-semantics warning early
- prevent mixing databases that look similar but have different study designs

## Hard Rules

- Never extract data from multiple databases just because the concepts sound similar.
- Never route `CHARLS` through the ELSA/HRS/KLoSA/LASI/MHAS/SHARE family; `CHARLS` stays separate in the local workspace.
- Never route `CHNS` through the China general survey family; `CHNS` uses topic-specific sub-tables and should stay separate.
- Never treat `MIMIC` and `eICU` as interchangeable ICU schemas.
- Never treat `UKB` and `NHANES` as the same database type; `UKB` is a prospective biobank cohort, while `NHANES` is a repeated cross-sectional health survey.
- Never collapse longitudinal panels and repeated cross-sectional surveys into one China survey bucket.
- Never treat `CGSS`, `CHIP`, `CSS`, and `CHFS` as fixed-person panels unless stable follow-up IDs have been explicitly verified in the local package.
- If the user names `ELSA`, `HRS`, `KLoSA`, `LASI`, `MHAS`, or `SHARE`, route directly to that cohort's source ID (`elsa`, `hrs`, `klosa`, `lasi`, `mhas`, `share`).
- If the China survey source is still undecided, choose among `CFPS`, `CGSS`, `CHFS`, `CHIP`, `CLDS`, and `CSS` here, then route directly to the dataset-specific skill and API source.
- If the user wants a cross-database comparison, keep the answer at the routing and feasibility level until a source-backed extraction skill is chosen.

## Start Point

Read `references/database-groups.md` first. It defines the current local database groups and the API source ID for each group. Search and extraction use `$local-database-api-access` in API-first mode, with direct local `AI_Access` fallback when the API is unavailable, unauthorized, or unsupported for the target file format.

## Routing Workflow

### 1. Judge the follow-up structure

Decide whether the request is about:

- `longitudinal`: the same people, households, or stays are tracked across time or waves
- `repeated_cross_sectional`: each cycle or round is nationally representative, but the same people are not assumed to be followed
- `longitudinal_within_stay`: patient, admission, stay, and event timelines inside hospitalization or ICU care

Fast rule:

- same participants or households followed across waves -> longitudinal
- repeated national samples without stable follow-up -> repeated cross-sectional
- patient/admission/stay/event timelines inside a hospital episode -> within-stay longitudinal

### 2. Judge the primary unit

Use the unit to avoid routing errors:

- `patient/admission/stay/event` -> clinical EHR / ICU database
- `individual` -> cohort, survey, or biobank
- `household` -> family, finance, income, or social survey
- `community` -> multi-level panel or environment-linked survey

### 3. Identify the content family

Choose the family from the user’s question:

- ICU / hospital EHR: `MIMIC-IV`, `eICU-CRD`
- prospective biobank: `UK Biobank`
- national health survey: `NHANES`
- aging and longevity longitudinal cohorts: `ELSA`, `HRS`, `KLoSA`, `LASI`, `MHAS`, `SHARE`, `CHARLS`, `CLHLS`
- longitudinal family, labor, nutrition, or health panels: `CHNS`, `CFPS`, `CLDS`
- repeated social, income, finance, or status surveys: `CGSS`, `CHIP`, `CSS`, `CHFS`

### 4. Route to the unified access layer

After deciding the database, use `$local-database-api-access` as the API-first extraction entry point. Pass the `source` parameter to scope the search:

- `MIMIC-IV` -> source `mimiciv`
- `eICU-CRD` -> source `eicu`
- `UK Biobank` -> source `ukb`
- `NHANES` -> source `nhanes`
- `ELSA` -> source `elsa`
- `HRS` -> source `hrs`
- `KLoSA` -> source `klosa`
- `LASI` -> source `lasi`
- `MHAS` -> source `mhas`
- `SHARE` -> source `share`
- `CHARLS` -> source `charls`
- `CLHLS` -> source `clhls`
- `CHNS` -> source `chns`
- `CFPS` -> source `cfps`
- `CLDS` -> source `clds`
- `CGSS` -> source `cgss`
- `CHIP` -> source `chip`
- `CSS` -> source `css`
- `CHFS` -> source `chfs`

Search and extract through the API when available:

```bash
curl -s -X POST http://127.0.0.1:8765/search \
  -H "Authorization: Bearer $DATABASE_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"q":"<keyword>","source":"<source_id>","limit":20}'

curl -H "Authorization: Bearer $DATABASE_API_TOKEN" \
  "http://127.0.0.1:8765/extract?source=<source_id>&file=<path>&columns=<cols>&limit=20"
```

If the API is not running and the user wants service mode, start it:

```bash
cd $HOME/database && python3 -m database_api.server --host 127.0.0.1 --port 8765
```

If the API returns `401` because `DATABASE_API_TOKEN` is not available, or the
target is an `.RData` extraction that the API does not support, use the direct
fallback map in `$local-database-api-access` and continue through the selected
dataset skill's local `AI_Access` indexes and helpers.

### 5. Surface the key warning before handoff

Before handing off, state the main design risk if it matters:

- If the extraction will support a baseline table or Table 1, tell the downstream extraction skill to include a sufficiently broad candidate-variable set, not only the named exposure and outcome variables.
- `MIMIC-IV`: patient vs admission vs ICU-stay anchor
- `eICU-CRD`: ICU-relative offsets and ICU-stay joins
- `UK Biobank`: only fields and modalities present in the local standardized package are in scope
- `NHANES`: cycle compatibility, exam/lab overlap, and survey-weight rules
- `ELSA` / `HRS` / `KLoSA` / `LASI` / `MHAS` / `SHARE`: row grain, wave handling, and cohort-specific labels must be checked before extraction
- `CHARLS` / `CLHLS`: repeated-wave tables need explicit wave handling
- `CHNS`: variables may live in different topic sub-tables and require multi-level joins
- `CFPS`: person-level vs family-level tables must not be mixed without explicit join keys and wave handling
- `CLDS`: labor-force panel structure and repeated-wave handling must be stated before extraction
- `CGSS` / `CHIP` / `CSS` / `CHFS`: default repeated cross-sectional treatment should be stated before extraction unless stable tracking has already been verified

### 6. If the user only knows the research question

Route by question type first:

- ICU treatment trajectory, labs, charted events -> `MIMIC` or `eICU`
- large-scale biobank phenotype or proteomics -> `UKB`
- US examination survey, biomarkers, mortality linkage -> `NHANES`
- cross-country aging comparison -> compare the relevant split cohort sources separately, then harmonize only after checking variable overlap and labels
- single-cohort `ELSA`, `HRS`, `KLoSA`, `LASI`, `MHAS`, or `SHARE` work -> the matching split source
- China aging individual panel -> `CHARLS`
- China oldest-old / longevity cohort -> `CLHLS`
- China nutrition, exam, diet, or multi-table panel construction -> `CHNS`
- China family panel -> `CFPS`
- China labor panel -> `CLDS`
- China income, finance, social attitudes, or social status surveys with source still undecided -> choose directly among `CGSS`, `CHIP`, `CSS`, and `CHFS`, then use the matching source

## Canonical Recognition Rules

Apply these defaults unless the local package proves otherwise:

- If the database is organized around `patient`, `admission`, `stay`, `event`, `charttime`, or ICU offsets, classify it as `clinical database + longitudinal_within_stay`.
- If the database includes genetics, proteomics, imaging, biomarkers, or linked long-term health outcomes, classify it as `biobank + longitudinal`.
- If the database is built around questionnaire + exam + laboratory cycles without assuming stable follow-up of the same people, classify it as `health survey + repeated_cross_sectional`.
- If the database follows older adults by wave and repeatedly measures health, cognition, function, depression, family, and economics, classify it as `aging cohort + longitudinal`; keep split cohorts separate unless local indexes prove harmonized comparability.
- If the database centers on individual, household, and community linkage with repeated follow-up, classify it as `family/labor/health panel + longitudinal`.
- If the database is organized as repeated rounds of income, finance, social attitudes, or social status surveys without default person-level follow-up, classify it as `social or income survey + repeated_cross_sectional`.

## Output Standard

Good routing output is short and explicit. Preferred phrasing:

- "This is `NHANES`, so treat it as a repeated cross-sectional health survey; searching via API with source `nhanes`."
- "This should use source `mimiciv` because the request depends on ICU-stay timelines and event-level data."
- "This looks like `CFPS`, not `CGSS`, because the task needs a family-person longitudinal panel rather than repeated cross-sectional social attitudes."
- "For `ELSA` in the current local workspace, use source `elsa`; compare with other aging cohorts only after checking each split source."
- "This should use `CGSS`, not `CHIP`, because the request is about social attitudes rather than income distribution."

Avoid phrasing like:

- "Any of these databases should work..."
- "They are basically the same..."
- "We can merge them later without checking..."
