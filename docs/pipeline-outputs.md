# Pipeline Outputs

The research pipeline produces structured artifacts across five stages. Each stage writes to a dedicated directory created when the project is initialized.

## Output Artifacts

| | Artifact | Location | Description |
|---|---|---|---|
| 📚 | Literature reports | `Literature/reports/` | Literature review summaries with citations, synthesized from arXiv, Semantic Scholar, and web sources |
| 📄 | Reference papers | `Literature/references/` | Downloaded PDFs and structured notes (abstract, methodology, evaluation, knowledge graph entries) |
| 💡 | Research ideas | `Ideation/ideas/` | Structured brainstorming outputs using creative frameworks (SCAMPER, SWOT, Mind Mapping) with multi-persona evaluation scores |
| 📖 | Ideation references | `Ideation/references/` | Supporting materials and prior work collected during idea generation |
| 🔬 | Experiment code | `Experiment/core_code/` | Implementation code produced by the plan → implement → judge loop |
| 📦 | Datasets | `Experiment/datasets/` | Downloaded or generated datasets used in experiments |
| 🧪 | Code references | `Experiment/code_references/` | Cloned GitHub repos and code survey outputs (architecture maps, dependency graphs) |
| 📊 | Analysis results | `Experiment/analysis/` | Statistical analysis, tables, charts, and paper-ready figures from experiment runs |
| 📝 | Manuscript draft | `Publication/manuscript/` | Academic manuscript drafts, abstracts, outlines, and manuscript change logs |
| 🖼️ | Generated figures | `Publication/figures/` | AI-generated or script-generated publication figures, image panels, and figure legends |
| 📋 | Publication tables | `Publication/tables/` | Manuscript tables and table source files |
| 📎 | Supplementary materials | `Publication/supplementary/` | Supplementary files, reporting checklists, reviewer files, and supplemental tables or figures |
| 🎞️ | Slide deck | `Promotion/slides/` | Academic presentation slides with narration scripts |
| 🔊 | Audio narration | `Promotion/audio/` | TTS-generated audio for presentation delivery |
| 🎬 | Demo video | `Promotion/video/` | Combined slides + audio demo video |
| 🌐 | Project homepage | `Promotion/homepage/` | Generated project landing page for dissemination |

## Report Persistence Convention

Report-style chat outputs are treated as project artifacts, not transient conversation. Save them as Markdown files in the project's existing visible workflow folders so other AI sessions can resume from the saved record instead of reconstructing context from chat alone.

- Literature reports: `Literature/reports/`
- Ideation notes and summaries: `Ideation/ideas/`
- Experiment analyses and change summaries: `Experiment/analysis/`
- Publication reports, reviews, and change logs: `Publication/manuscript/`
- Promotion asset reports and handoff notes: `Promotion/slides/`
- When the stage is not explicit, infer the closest visible workflow directory from the content instead of using hidden folders.
- If it is still ambiguous, use the current active stage's visible directory. Do not store routine chat reports under `.pipeline/docs/chat-reports/`.
- Reuse any user-defined subfolder that already exists for the content. Do not create new visible provider-named subfolders such as `codex/`, `claude/`, `gemini/`, or `cursor/` unless the project already uses that convention and the user explicitly wants it.

Prefer time- or version-based filenames like `YYYY-MM-DD-topic.md` or `YYYY-MM-DD-topic-v2.md`. Do not append provider names such as `claude`, `cursor`, `codex`, or `gemini` unless the user explicitly asks for that naming scheme.

## Project Directory Structure

When a project is created, the workspace initializes the following structure:

```
your-project/
├── instance.json                    # Project config with absolute paths
├── Literature/
│   ├── references/                  # Downloaded papers and structured notes
│   └── reports/                     # Literature review summaries
├── Ideation/
│   ├── ideas/                       # Generated and evaluated research ideas
│   └── references/                  # Supporting materials for ideation
├── Experiment/
│   ├── code_references/             # Cloned repos and code survey outputs
│   ├── datasets/                    # Experiment datasets
│   ├── core_code/                   # Implementation code
│   └── analysis/                    # Results, statistics, and figures
├── Publication/
│   ├── manuscript/                  # Manuscript drafts and manuscript reports
│   ├── figures/                     # Publication figures and legends
│   ├── tables/                      # Manuscript tables
│   └── supplementary/               # Supplementary materials and checklists
└── Promotion/
    ├── homepage/                    # Project landing page
    ├── slides/                      # Presentation deck
    ├── audio/                       # TTS narration
    └── video/                       # Demo video
```

## Pipeline Flow

```
Literature → Ideation → Experiment → Publication → Promotion
```

Each stage is powered by one or more [research skills](../skills/README.md). The agent reads and follows the corresponding `SKILL.md` to produce the artifacts above. Skills can be run independently (e.g., only paper writing) or as a full end-to-end pipeline.

## Stage → Skill Mapping

| Stage | Skills Used | Key Outputs |
|-------|------------|-------------|
| **Literature** | `inno-prepare-resources`, `inno-code-survey`, `inno-deep-research`, `paper-analyzer`, `paper-finder` | Literature reports, reference notes, code survey maps |
| **Ideation** | `inno-idea-generation`, `inno-idea-eval` | Ranked research ideas with multi-dimension scores |
| **Experiment** | `inno-experiment-dev`, `inno-experiment-analysis` | Runnable code, results tables, statistical analysis |
| **Publication** | `inno-paper-writing`, `inno-figure-gen`, `inno-paper-reviewer`, `inno-humanizer`, `inno-reference-audit`, `inno-rclone-to-overleaf` | Manuscript, figures, review feedback, Overleaf sync |
| **Promotion** | `making-academic-presentations` | Slides, narration audio, demo video, homepage |
