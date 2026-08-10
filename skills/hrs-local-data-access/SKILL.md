---
name: hrs-local-data-access
description: Use when working with the local HRS workspace at $HOME/database/HRS_data to find Health and Retirement Study variables, verify what is present in the split AI_Access package, and extract real participant-by-wave columns from hrs.RData. Trigger for HRS-only lookup, variable availability, source-backed preview, or small analysis matrix extraction. Never simulate, invent, or guess values or availability.
---

# HRS Local Data Access

## Overview

This skill handles the split HRS package only. It does not use the unified OLDMAN bundle.

## Access Mode

Use `$local-database-api-access` first with API source `hrs` for indexed search and metadata inspection. Include `Authorization: Bearer $DATABASE_API_TOKEN` when the API has auth enabled.

If the API is unavailable, unauthorized, or cannot extract the target `.RData` file, fall back to `$HOME/database/HRS_data/AI_Access` indexes and local R loading. Fallback still requires exact index-backed variable confirmation before extraction.

## Hard Rules

- Never simulate data or create mock participants.
- Never claim an HRS variable exists without checking the index or source file.
- Never treat HRS variable names as automatically harmonized with ELSA, KLoSA, LASI, MHAS, or SHARE.
- Never collapse participant-wave rows without explicitly describing the wave selection or aggregation.
- If a requested variable is missing, say it is unavailable and name the index or file checked.

## Start Point

Use:

- `$HOME/database/HRS_data/AI_Access/00_indexes/hrs_ai_dictionary.csv`
- `$HOME/database/HRS_data/AI_Access/00_indexes/hrs_variable_index.csv`
- `$HOME/database/HRS_data/AI_Access/00_indexes/hrs_dataset_index.csv`
- `$HOME/database/HRS_data/AI_Access/00_indexes/hrs_file_index.csv`
- `$HOME/database/HRS_data/AI_Access/00_indexes/hrs_value_labels.csv`

Dataset grain from the local index: `one_row_per_ID_wave`; primary ID: `hhidpn`; source file: `$HOME/database/HRS_data/hrs.RData`; R object: `hrs`.

## Workflow

### 1. Locate Variables

Prefer API search with source `hrs`. Direct fallback:

```bash
python3 $HOME/database/HRS_data/AI_Access/90_tools/query_hrs_ai_access.py age --limit 10
python3 $HOME/database/HRS_data/AI_Access/90_tools/query_hrs_ai_access.py --exact hhidpn
```

Use `--show-values` when category labels matter.

### 2. Check Grain Before Extraction

Confirm the variable, label, value class, missingness, and row grain from `hrs_variable_index.csv` and `hrs_dataset_index.csv`. Include `hhidpn` and `wave` when extracting participant-by-wave data unless the task has a narrower documented reason.

### 3. Extract Real Columns

For `.RData` extraction, use R after index confirmation:

```r
env <- new.env(parent = emptyenv())
load(path.expand("~/database/HRS_data/hrs.RData"), envir = env)
dt <- env$hrs[, c("hhidpn", "wave", "<var1>", "<var2>"), drop = FALSE]
write.csv(dt, "/tmp/hrs_slice.csv", row.names = FALSE, na = "", fileEncoding = "UTF-8")
```

For baseline or Table 1 requests, choose a sufficiently broad candidate-variable set from the checked index instead of extracting only one field.

## Output Standard

Report the exact variables, source file, row grain, and whether the answer came from the API, local index, or real `.RData` extraction.
