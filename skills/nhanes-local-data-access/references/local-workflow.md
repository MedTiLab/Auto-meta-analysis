# Local NHANES Workflow

## Single entry folder

Use:

`$HOME/database/NHANES_data/AI_Access`

## Key files

- Index search:
  - `$HOME/database/NHANES_data/AI_Access/00_indexes/nhanes_ai_dictionary.csv`
  - `$HOME/database/NHANES_data/AI_Access/00_indexes/nhanes_variable_index.csv`
- Dataset routing:
  - `$HOME/database/NHANES_data/AI_Access/00_indexes/nhanes_dataset_index.csv`
  - `$HOME/database/NHANES_data/AI_Access/00_indexes/nhanes_cycle_index.csv`
  - `$HOME/database/NHANES_data/AI_Access/00_indexes/nhanes_cross_cycle_guardrails.csv`

## Group folders

- Harmonized long-term:
  - `$HOME/database/NHANES_data/AI_Access/01_harmonized_1988_2018`
- Pre-pandemic separate:
  - `$HOME/database/NHANES_data/AI_Access/02_prepandemic_2017_2020_separate`
- Latest cycle:
  - `$HOME/database/NHANES_data/AI_Access/03_cycle_2021_2023`
- Latest exact-name standard library:
  - `$HOME/database/NHANES_data/AI_Access/04_latest_standard_2019_2023_exact_match`
- Oral microbiome release:
  - `$HOME/database/NHANES_data/AI_Access/05_oral_microbiome_2009_2012`
- Ophthalmology and vision release:
  - `$HOME/database/NHANES_data/AI_Access/06_ophthalmology_1999_2008`

## Fast commands

Search:

```bash
python3 $HOME/database/NHANES_data/AI_Access/90_tools/query_nhanes_ai_access.py bmi --limit 10
python3 $HOME/database/NHANES_data/AI_Access/90_tools/query_nhanes_ai_access.py --exact BMXBMI
```

Extract:

```bash
Rscript $HOME/database/NHANES_data/AI_Access/90_tools/extract_nhanes_matrix.R \
  --dataset-id cycle_2021_2023_participant_level \
  --columns SEQN,RIDAGEYR,RIAGENDR,BMXBMI \
  --nrows 20
```

Or pull the standardized oral microbiome alpha matrix:

```bash
Rscript $HOME/database/NHANES_data/AI_Access/90_tools/extract_nhanes_matrix.R \
  --dataset-id oral_microbiome_alpha_standard_depth10000_repeat0_wide \
  --columns SEQN,rsv_faith_pd,rb_faith_pd \
  --nrows 20
```

## Dataset IDs commonly used

- `harmonized_1988_2018_demographics`
- `harmonized_1988_2018_questionnaire`
- `harmonized_1988_2018_response`
- `harmonized_1988_2018_mortality`
- `prepandemic_2017_2020_participant_level`
- `cycle_2021_2023_participant_level`
- `standard_2019_2023_exact_match`
- `oral_microbiome_alpha_standard_depth10000_repeat0_wide`
- `oral_microbiome_alpha_standard_depth10000_repeat0_long`
- `ophthalmology_1999_2008_participant_level`

## Non-negotiable safety rules

- Never fabricate values when the query returns no rows.
- Never create mock participants.
- Never invent a dataset join without checking dataset grain first.
- Never append `prepandemic_2017_2020_participant_level` to the harmonized 1988-2018 library without handling the `2017-2018` overlap.
- Never treat the oral microbiome release as a full 2009-2012 participant matrix; it is a subset sample that must be joined by `SEQN` with its sample restrictions kept explicit.
- Never treat the ophthalmology release as a complete full-cycle participant matrix; it is a domain-specific eye/vision package joined by `SEQN`, with Vision questionnaire/exam coverage in `1999-2008` and FDT/retinal imaging coverage in `2005-2008`.
