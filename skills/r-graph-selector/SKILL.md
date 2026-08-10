---
name: r-graph-selector
description: Use when the user wants MedHelp or Codex to shortlist R chart examples from the local r-graph-gallery based on figure-selection preferences, publication style, biomedical suitability, or prompts like “帮我选图”, “筛选图表”, “推荐 R 图”, “根据偏好选图”, “用 r-graph-gallery 找合适图表”, or “给论文/文章找合适图”.
---

# MedHelp R Graph Selector

Use this skill when the task is not just “write a plot”, but “pick the right plot style first”.
It also owns the no-API local r-graph-gallery fallback path; do not split this workflow into a separate gallery skill.

Default assumption: the user wants a manuscript-friendly, biomedical-leaning chart, not a decorative chart.

## Local assets

- Gallery repository root: `$HOME/database/r-graph-gallery`
- Gallery site root: `$HOME/database/r-graph-gallery/r-graph-gallery`
- Search script: `$HOME/database/database_api/graph_gallery/scripts/search_graph_gallery.R`
- Index file: `$HOME/database/database_api/graph_gallery/cache/graph_gallery_index.csv`
- Build script: `$HOME/database/database_api/graph_gallery/scripts/build_graph_gallery_index.R`
- Default preference profile: `$HOME/database/database_api/graph_gallery/preferences/medhelp-default.csv`
- Local API endpoint: `http://127.0.0.1:8765/graph-gallery/search`

## Workflow

1. Infer the figure goal from the request.
   Typical intents: `trend`, `comparison`, `distribution`, `association`, `matrix`, `ranking`, `geospatial`.

2. Retrieve candidates before writing code.
   Prefer the local API when available:

   ```bash
   curl -s -X POST http://127.0.0.1:8765/graph-gallery/search \
     -H 'Content-Type: application/json' \
     -d '{
       "q": "longitudinal biomarker trend by treatment group",
       "intent": "trend,comparison",
       "prefer": "line,annotation,facet",
       "avoid": "pie,donut,3d",
       "limit": 5
     }'
   ```

   If the API is not running, call the R search script directly:

   ```bash
   Rscript "$HOME/database/database_api/graph_gallery/scripts/search_graph_gallery.R" \
     --q="longitudinal biomarker trend by treatment group" \
     --intent="trend,comparison" \
     --prefer="line,annotation,facet" \
     --avoid="pie,donut,3d" \
     --limit=5
   ```

   If `Rscript` cannot run, inspect the local index CSV directly:

   ```text
   $HOME/database/database_api/graph_gallery/cache/graph_gallery_index.csv
   ```

   Shortlist by `family`, `use_cases`, `tags`, `packages`, `publication_friendly`, and `medical_friendly`.

3. Rank with model judgment after retrieval.
   The R script gives a heuristic shortlist. The model should still make the final choice based on:
   - whether the chart matches the scientific claim
   - whether the chart would survive manuscript review
   - whether the chart is easy to adapt to the user’s data structure
   - whether the chart avoids misleading encoding

4. Return a tight recommendation set.
   Default output should be:
   - `1` recommended chart
   - `2-4` backup options
   - short reasons
   - the chosen example’s `Rmd` path and `HTML` path
   - if useful, the preview image path

5. Only then write or adapt R code.
   Reuse the top-ranked example as the starting template instead of inventing a chart from scratch.

## Default preference policy

Unless the user explicitly asks otherwise:

- Prefer: `line`, `scatter`, `boxplot`, `violin`, `histogram`, `density`, `heatmap`, `lollipop`, `dumbbell`, `beeswarm`, `ridgeline`
- Prefer static `ggplot2`-style outputs over interactive widgets
- Prefer directly labeled or clearly annotated figures
- Avoid: `pie`, `donut`, `radar`, `wordcloud`, `3d`, `dual-axis`
- Deprioritize decorative circular layouts unless the user explicitly wants them

## How to phrase the final recommendation

Keep the recommendation concrete. Mention:

- what message the chart is best at communicating
- why it beats the next-best alternative
- what to avoid from the lower-ranked options
- which local example to adapt

When presenting paths to the user, normalize any home-directory absolute path to `$HOME/...`. Do not expose the local macOS username in chat output.

Example structure:

```text
Recommended: line chart with direct labels.
Why: your task is longitudinal comparison, so line encodes time naturally and is easier to review than stacked area or dual-axis variants.
Template: $HOME/path/to/example.Rmd
Backup: faceted line chart; dumbbell chart if the time dimension collapses to baseline-vs-followup only.
```
