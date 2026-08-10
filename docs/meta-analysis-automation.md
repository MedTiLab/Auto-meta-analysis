# MedAutoData Meta-analysis Automation

## What this adds

This patch adds a Meta-analysis guided prompt, a TaskMaster template, and two skills:

1. `meta-analysis-workflow` — the orchestration skill for medical systematic reviews and Meta-analysis.
2. `public-literature-download` — the missing legal public PDF acquisition skill.
3. `medical-meta-analysis` TaskMaster template — a structured Auto Research entry point for PRISMA-style projects.

The chat composer has a Meta-analysis guided shortcut. Its "auto-select" prompt routes to the smallest necessary skill set instead of always invoking the entire Meta-analysis bundle. This does not introduce a new agent backend; it uses the current MedAutoData chat/Codex/Claude/Gemini execution layer.

## Why this integration point

The repository already supports:

- global skill tree loading;
- skill file read/write;
- scanning and importing local skill directories;
- uploading skill zips;
- deleting global/project skills;
- sending selected skills into project chat from the Skills panel.

Therefore the safest first integration is a guided chat entry and a TaskMaster template instead of a separate router-heavy module or a large widget in the skills library.

## Automation modes

There are two supported automation entry points:

1. **TaskMaster / Auto Research template**
   - Use `medical-meta-analysis` when creating or bootstrapping a structured project plan.
   - It generates `.pipeline/docs/research_brief.json` and task blueprints through the existing five-stage contract.
   - It does not replace the current `literature -> ideation -> experiment -> publication -> promotion` state machine. Meta-analysis-specific work is represented inside those stages.

2. **Chat skill shortcut**
   - Use the Meta-analysis shortcut for ad hoc project continuation.
   - It sends `/meta-analysis-workflow` prompts into the current project chat.
   - It is better for continuing a partially completed review, summarizing current progress, or running one stage such as download-only or analysis-only.

These modes can coexist. The template owns planning and task generation; the skill shortcut owns conversational execution and continuation.

## Suggested project workflow

```text
00_literature/
01_protocol/
02_search_dedupe/
03_title_abstract_screening/
04_full_text_review/
05_data_extraction/
06_quality_assessment/
07_data_analysis/
08_results_figures/
09_manuscript_submission/
10_presentation/
```

New Meta projects use the `clinical-meta-v2` numbered folder schema inside the user's research project workspace. Keep `.pipeline/` for MedAutoData task orchestration and use the numbered folders for review artifacts. `00_literature/` is the pre-protocol area for literature review, Meta topic selection, feasibility notes, seed references, and scoping-review route decisions; locked protocol artifacts start in `01_protocol/`. This separation avoids conflicts with existing Auto Research contracts, session memory, and project-level agent templates. Legacy Meta projects without `clinical-meta-v2` keep their existing folders and are not migrated automatically.

Use existing top-level project folders when they already exist:

- `00_literature/` is the literature review, topic-selection, seed-reference, and scoping-review route area.
- `02_search_dedupe/` is the shared formal search/reference import area.
- `07_data_analysis/` holds analysis scripts and model outputs.
- `08_results_figures/` holds forest/funnel/SROC/PRISMA figures and result tables.

The Meta workflow should still record the authoritative status and artifact map in `01_protocol/workflow_status.md` or the closest numbered workflow folder for the active step.

## Download workflow

Use the downloader conservatively:

```bash
python skills/public-literature-download/scripts/pmc_oa_downloader.py \
  --input 03_title_abstract_screening/screening_decisions.csv \
  --output-dir 04_full_text_review/fulltext \
  --manifest 04_full_text_review/pdf_manifest.json \
  --summary-csv 04_full_text_review/pdf_manifest.csv \
  --reference-dir-layout \
  --tool medautodata_meta \
  --email YOUR_EMAIL@example.com \
  --dry-run
```

After checking the manifest, rerun without `--dry-run`.

## MinerU handoff

The downstream MinerU step should read `04_full_text_review/pdf_manifest.json` and parse records with `status` equal to `downloaded` or `exists`. Parsed outputs should go to:

```text
04_full_text_review/fulltext/<reference-id-slug>/mineru/
```

Recommended parsed files:

```text
<paper-title>.md
content.json
tables.json
figures/
page_map.json
```

## Next development steps

1. Keep the backend endpoint materializing the `clinical-meta-v2` numbered directory template for a selected project.
2. Add a manifest-aware MinerU runner endpoint.
3. Add a statistics runner that supports R `meta`/`metafor` when installed and Python fallbacks otherwise.
4. Add artifact cards in the UI for PRISMA counts, PDF status, extraction status, and figure status.
5. Add a final PRISMA audit action before DOCX generation.
