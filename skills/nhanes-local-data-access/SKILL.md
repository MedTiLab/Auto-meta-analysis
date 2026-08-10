---
name: nhanes-local-data-access
description: Use when working with the local NHANES workspace at $HOME/database/NHANES_data to find variables, verify cycle compatibility, and extract real columns or rows from the indexed CSV/RData assets. Trigger for requests such as locating NHANES variables, checking which cycles contain a measure, pulling an analysis matrix, or validating whether time ranges can be combined. Never simulate, invent, or guess data values; only report values read from existing files or clearly say the requested data is unavailable.
---

# NHANES Local Data Access

## Overview

This skill provides a strict workflow for finding and extracting NHANES data from the local workspace. It is optimized for the curated `AI_Access` entry point and enforces source-backed retrieval only.


## Access Mode

Use `$local-database-api-access` first with API source `nhanes` for indexed search, schema inspection, and small supported-file slices. Include `Authorization: Bearer $DATABASE_API_TOKEN` when the API has auth enabled.

If the API is not running, returns `401/403`, cannot resolve the path, or cannot handle the requested file format, fall back directly to this skill's local `AI_Access` indexes and `90_tools` helpers under `$HOME/database`. Fallback mode still requires source-backed lookup first: identify the exact indexed file, confirm row grain and variable provenance, then extract only selected columns from real local files.
## Hard Rules

- Never simulate data.
- Never invent values, counts, means, prevalence estimates, or category labels.
- Never infer that a variable exists without checking the index or source files.
- Never present example rows as if they were real outputs unless they were extracted from a file in the current run.
- If a requested variable or dataset is missing, say it is unavailable and name the file or index checked.
- If combining time ranges could create overlap, stop and state the overlap risk before proceeding.

## When To Use

Use this skill when the user wants to:

- Find which NHANES variable matches a concept such as fasting glucose, BMI, smoking, or mortality.
- Find NHANES oral microbiome alpha-diversity fields such as `rsv_faith_pd` or `rb_shannon_wiener`.
- Check whether a variable exists in `1988-2018`, `2017-March 2020 pre-pandemic`, `2021-2023`, or the latest exact-name standard library.
- Extract a small analysis-ready matrix from local files.
- Confirm whether datasets can be appended or joined safely.
- Inspect real local NHANES files without browsing external sources.

## Start Point

Always start from:

- `$HOME/database/NHANES_data/AI_Access/00_indexes/nhanes_ai_dictionary.csv`
- `$HOME/database/NHANES_data/AI_Access/00_indexes/nhanes_dataset_index.csv`
- `$HOME/database/NHANES_data/AI_Access/00_indexes/nhanes_variable_index.csv`
- `$HOME/database/NHANES_data/AI_Access/00_indexes/nhanes_cycle_index.csv`
- `$HOME/database/NHANES_data/AI_Access/00_indexes/nhanes_cross_cycle_guardrails.csv`

Use `$HOME/database/NHANES_data/AI_Access` as the single entry folder. Do not search the raw tree first unless the indexes are insufficient.

## Workflow

### 1. Locate the variable

Prefer the helper:

```bash
python3 $HOME/database/NHANES_data/AI_Access/90_tools/query_nhanes_ai_access.py glucose --limit 8
python3 $HOME/database/NHANES_data/AI_Access/90_tools/query_nhanes_ai_access.py --exact LBXGLU
```

If needed, inspect:

- `nhanes_ai_dictionary.csv` for the best searchable entry.
- `nhanes_variable_index.csv` for per-dataset provenance.

### 2. Check compatibility before extraction

Read:

- `nhanes_dataset_index.csv` for dataset grain such as `one_row_per_seqn` vs `multi_row_per_seqn`.
- `nhanes_cycle_index.csv` for cycle coverage.
- `nhanes_cross_cycle_guardrails.csv` for overlap warnings.

Critical guardrail:

- `02_prepandemic_2017_2020_separate` overlaps with `2017-2018` already contained in `01_harmonized_1988_2018`.
- Do not directly append those two groups without explicit overlap handling.
- `05_oral_microbiome_2009_2012` is a subset release for examined participants aged `14-69` years in `2009-2012`; join by `SEQN`, but do not treat it like a full-cycle participant matrix.

### 3. Extract columns with task-aware scope

Prefer the helper:

```bash
Rscript $HOME/database/NHANES_data/AI_Access/90_tools/extract_nhanes_matrix.R \
  --dataset-id cycle_2021_2023_participant_level \
  --columns RIDAGEYR,RIAGENDR,LBXGLU \
  --nrows 20
```

Or write a slice:

```bash
Rscript $HOME/database/NHANES_data/AI_Access/90_tools/extract_nhanes_matrix.R \
  --dataset-id harmonized_1988_2018_response \
  --columns SEQN,SDDSRVYR,LBXGLU \
  --out /tmp/nhanes_slice.csv
```

For oral microbiome alpha diversity:

```bash
Rscript $HOME/database/NHANES_data/AI_Access/90_tools/extract_nhanes_matrix.R \
  --dataset-id oral_microbiome_alpha_standard_depth10000_repeat0_wide \
  --columns SEQN,rsv_observed_asvs,rsv_faith_pd,rb_faith_pd \
  --nrows 20
```

Behavior notes:

- If the task is a baseline table, Table 1, or cohort baseline matrix request, extract baseline variables as comprehensively as the selected NHANES participant matrix and checked indexes allow rather than limiting the slice to one or two named fields.
- For narrow field lookup or focused analytic requests, keep the extraction limited to the requested variables plus `SEQN`, survey-cycle anchors, and any required interpretation fields.

Only fall back to direct `fread(select=...)` or `R` object loading when the helper cannot serve the request.

### 4. Report with provenance

When returning results, include:

- `dataset_id`
- exact file path used
- variable names extracted
- whether the matrix is one row per participant
- any overlap or comparability warning that applies

### 5. If the user asks for analysis

Before any analysis:

- verify that the variables were actually extracted from file-backed matrices
- verify that the chosen dataset group is compatible for the requested time range
- state if the result is based on a harmonized long-term library or a latest-cycle participant matrix

If the required data are absent, stop and say what is missing. Do not substitute placeholders or synthetic values.

## Folder Semantics

- `01_harmonized_1988_2018`: long-term harmonized library through `2017-2018`
- `02_prepandemic_2017_2020_separate`: full `2017-March 2020 pre-pandemic` participant-level release
- `03_cycle_2021_2023`: full `2021-2023` participant-level release
- `04_latest_standard_2019_2023_exact_match`: conservative exact-name standard library across latest releases
- `05_oral_microbiome_2009_2012`: oral microbiome release with standardized alpha-diversity outputs linked by `SEQN`
- `06_ophthalmology_1999_2008`: public Vision questionnaire/exam files for `1999-2008`, plus Ophthalmology FDT and Retinal Imaging files for `2005-2008`

For exact local paths, commands, and common retrieval patterns, read `references/local-workflow.md`.

## Output Standard

Good output names the real source and keeps claims narrow. Preferred phrasing:

- "I found `LBXGLU` in `cycle_2021_2023_participant_level` and extracted it from `/absolute/path.csv`."
- "This request cannot be completed from the indexed local files because variable `XYZ` is not present."
- "These two groups should not be directly appended because `2017-2018` overlaps with the pre-pandemic release."

Avoid phrasing like:

- "The data probably look like..."
- "A likely value is..."
- "I simulated an example table..."
