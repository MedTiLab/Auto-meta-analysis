# TaskMaster Template Schema

This directory contains JSON templates used by the Pipeline Board.

Each template serves two purposes:

1. Define the web form fields users fill in (`metaFields`, `sectionFields`).
2. Define how tasks are generated from `research_brief.json` (`pipeline.stages.*.task_blueprints`).

## How Templates Are Used

When a user applies a template:

1. Backend creates `.pipeline/docs/research_brief.json` using the selected template.
2. User-provided form values are mapped into JSON paths (for example `sections.ideation.problem_framing`).
3. Backend parses that brief and generates `.pipeline/tasks/tasks.json` from `pipeline.stages`.

## Required Top-Level Fields

Each template JSON should include:

- `id`: Stable template identifier.
- `name`: Human-readable template name shown in UI.
- `description`: Short UI description.
- `domain`: Logical grouping (for filtering).
- `category`: Usually same as domain.
- `format`: Currently `research-brief-json`.
- `fileName`: Usually `research_brief.json`.
- `metaFields`: Array of meta form field definitions.
- `sectionFields`: Form field definitions grouped by `literature`, `ideation`, `experiment`, `publication`, `promotion`.
- `pipeline`: Task generation blueprint (stage requirements, quality gates, and task blueprints).

## Field Definition Schema

Fields inside `metaFields` and `sectionFields.*` use:

- `key`: Local field key.
- `label`: UI label.
- `path`: Dot-path written into the brief JSON.
- `placeholder`: Optional UI hint text.
- `type`: Optional, use `"array"` for multi-line list input.

For `type: "array"`, each input line becomes one array item.

## Pipeline Schema

`pipeline` drives task generation. Typical shape:

- `version`: Pipeline schema version.
- `mode`: Optional mode marker (for example `"idea"`).
- `stages`: Object with keys:
  - `literature`
  - `ideation`
  - `experiment`
  - `publication`
  - `promotion`

Each stage may define:

- `required_elements`: JSON paths that should exist in the brief.
- `optional_elements`: Additional paths for guidance.
- `quality_gate`: Checklist items.
- `task_blueprints`: Ordered task definitions used to build `tasks.json`.
- `recommended_skills`: Suggested skills for that stage.

## Stage-to-Skills Mapping

Current backend stage skill map (also used as fallback when a task does not provide explicit `recommended_skills`):

| Stage | Base Skills | Type-Specific Hints |
|---|---|---|
| `literature` | `literature-review`, `pubmed-database`, `real-literature-trace`, `citation-management` | `exploration` -> `literature-review`, `pubmed-database`, `real-literature-trace`, `research-lookup`; `analysis` -> `literature-review`, `citation-management`, `research-lookup` |
| `ideation` | `meta-pipeline-planner`, `meta-analysis-workflow`, `scientific-brainstorming` | `analysis` -> `meta-pipeline-planner`, `meta-analysis-workflow`; `exploration` -> `scientific-brainstorming`, `literature-review` |
| `experiment` | `statistical-analysis`, `data-stats-analysis`, `statsmodels` | `implementation` -> `data-transform`, `statistical-analysis`; `analysis` -> `statistical-analysis`, `data-stats-analysis`, `statsmodels`; `exploration` -> `literature-review`, `scientific-critical-thinking` |
| `publication` | `inno-paper-writing`, `manuscript-editor`, `citation-management` | `writing` -> `inno-paper-writing`, `inno-humanizer`; `analysis` -> `inno-reference-audit`, `citation-management` |
| `promotion` | `scientific-visualization`, `scientific-slides`, `paper-2-web` | `scripting`/`narration` -> `scientific-slides`, `scientific-writing`; `rendering`/`delivery` -> `scientific-visualization`, `paper-2-web` |

Recommendation priority for each task:

1. Stage-level `recommended_skills`
2. Stage map base skills
3. Stage map task-type skills
4. Task blueprint `recommended_skills`

## Medical Literature Review Principle

For medical literature review / evidence synthesis work, keep the default skill chain intentionally small:

1. `literature-review` for the review frame and synthesis structure
2. `pubmed-database` as the primary biomedical search source
3. `real-literature-trace` for traceable screening and canonical paper links
4. `citation-management` for metadata cleanup and reference verification

Only add supplements when there is a concrete gap:

- `research-lookup` for current guidelines, official pages, or non-PubMed facts
- `inno-deep-research` or `deep-research` only after the core evidence set exists and broader cross-source synthesis is still needed
- `biorxiv-database` only when preprints materially matter
- `academic-researcher` only after evidence collection, for writing structure or argument refinement
- `literature-review` only after the task shifts from literature review to method/code reproduction

## Task Blueprint Schema

Each item in `task_blueprints` supports:

- `id`: Stable blueprint id.
- `title`: Task title shown in UI.
- `description`: Task description.
- `taskType`: Suggested type (for example `analysis`, `implementation`, `writing`, `exploration`, `scripting`, `rendering`, `narration`, `delivery`).
- `priority`: Optional (`low`, `medium`, `high`).
- `dependencies`: Optional array of task IDs.
- `inputsNeeded`: Optional array of required JSON paths or inputs.
- `recommended_skills`: Optional per-task skills.
- `nextActionPrompt`: Optional prompt used by chat handoff.

## Minimal Template Example

```json
{
  "id": "example-template",
  "name": "Example Template",
  "description": "Demo template",
  "domain": "ai-research",
  "category": "ai-research",
  "format": "research-brief-json",
  "fileName": "research_brief.json",
  "metaFields": [
    { "key": "title", "label": "Title", "path": "meta.title" }
  ],
  "sectionFields": {
    "ideation": [
      { "key": "problem_framing", "label": "Problem Framing", "path": "sections.ideation.problem_framing" }
    ],
    "experiment": [],
    "publication": [],
    "promotion": []
  },
  "pipeline": {
    "version": "1.1",
    "mode": "idea",
    "stages": {
      "ideation": {
        "required_elements": ["sections.ideation.problem_framing"],
        "quality_gate": ["Problem framing is specific"],
        "task_blueprints": [
          {
            "id": "define_problem_scope",
            "title": "Define problem scope",
            "description": "Clarify scope, assumptions, and constraints.",
            "taskType": "analysis"
          }
        ],
        "recommended_skills": ["inno-idea-generation"]
      },
      "experiment": { "task_blueprints": [] },
      "publication": { "task_blueprints": [] },
      "promotion": { "task_blueprints": [] }
    }
  }
}
```

## Notes

- Keep `id` stable once released (it may be used in saved briefs).
- Keep `path` values aligned with the `research_brief.json` shape.
- Task order in `task_blueprints` matters; it affects generated task order.
