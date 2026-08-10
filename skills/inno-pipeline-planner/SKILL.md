---
name: inno-pipeline-planner
description: Guides the user through an interactive conversation to define their research project, then generates research_brief.json and tasks.json. Use when starting a new project, when no research_brief.json exists, when the user wants to start from a specific pipeline stage, or when the user wants to redefine their research pipeline.
---

# Inno Pipeline Planner

Run an interactive planning flow that turns user conversation into:
- `.pipeline/docs/research_brief.json`
- `.pipeline/tasks/tasks.json`

Keep this file short. Load full schemas and field-level rules from:
- `references/pipeline-contract.md` (index)

Read only what you need:
- `references/generation-rules.md`: generation logic, ordering, dependencies, `nextActionPrompt`
- `references/brief-schema.md`: `.pipeline/docs/research_brief.json` contract
- `references/tasks-schema.md`: `.pipeline/tasks/tasks.json` contract

## Non-negotiables

- Work only inside the current project directory.
- Do not fabricate papers, datasets, metrics, or results.
- Ask follow-up questions when information is vague; do not guess.
- Ask in small batches (2-3 questions), not a long static form.
- If the active project is a Meta project (`metadata.projectKind = "meta"` or the user asks for systematic review / Meta-analysis), route planning through `meta-analysis-workflow` and generate a Meta five-stage pipeline instead of the clinical database/pre-analysis/baseline-table pipeline.
- If the request is primarily a **medical literature review / evidence synthesis**, do a consultation-first kickoff before broad planning or search.
- For medical review-first requests, keep the default chain small: `literature-review` -> `pubmed-database` -> `real-literature-trace` -> `citation-management`. Add `research-lookup` only when current guidelines, official pages, or non-PubMed facts are needed. Add `inno-deep-research` or `gemini-deep-research` only after the core evidence set exists and a broader cross-source synthesis is still needed.

## Workflow

## 1) Inspect existing pipeline state

Check:
- `.pipeline/docs/research_brief.json`
- `.pipeline/tasks/tasks.json`
- `instance.json` (legacy source)
- Content in `Literature/`, `Ideation/`, `Experiment/`, `Publication/`, and `Promotion/` directories (to detect pre-existing artifacts)
- Project metadata indicating `projectKind: "clinical" | "meta"` when available.

If brief exists, summarize title, goal, current `startStage`, and completion status, then ask:
- Refine existing brief/tasks
- Regenerate from scratch
- Change the starting stage

If the project is Meta, read `.agents/skills/meta-analysis-workflow/SKILL.md` (or the equivalent provider skills path) and use its directory contract. Do not create `Survey/meta-analysis`, `MetaAnalysis/`, or an extra `meta-analysis` subdirectory.

## 2) Collect project context via conversation

Capture at least:
- Topic/problem
- Goal or hypothesis
- Success criteria or evaluation signal
- Current literature depth or known reference set

Meta project kickoff:
- Review type: diagnostic accuracy, intervention/effect-size, prognostic HR, prevalence/single-arm, network Meta, or scoping/systematic review.
- PICO/PECO, clinical question, population, exposure/intervention/index test, comparator/reference standard, outcomes.
- Existing references, search logs, screening sheets, PDFs, extraction tables, or analysis scripts.
- Human screening plan and PDF/MinerU plan.
- Target deliverable: protocol, extraction table, synthesis, PRISMA manuscript, figures, or presentation.

**Determine the starting stage** early in the conversation:
- Ask what the user already has: "Do you already have a research idea, experimental results, or are you starting from scratch?"
- If the user mainly needs literature review, gap analysis, or reference collection -> `startStage = "literature"`
- If the user has a concrete idea with problem framing and success criteria -> `startStage = "experiment"`
- If the user has experimental results and analysis -> `startStage = "publication"`
- If the user already has a paper/manuscript and mainly needs a homepage, slide deck, narration, or demo assets -> `startStage = "promotion"`
- If the user is starting from scratch or only has a vague direction -> `startStage = "literature"` (default)
- Detect automatically from conversation context (e.g., "I already ran all experiments" implies publication; "I need slides for my paper" implies promotion).

Typical question buckets:
- Project identity: topic, prior paper/method/dataset, target venue (optional)
- Scope and method: core question, approach, expected outcome
- Evaluation: data source, metrics/protocol, baseline expectations

Medical review-first kickoff:
- If the user's main job is a **medical literature review, evidence synthesis, guideline scan, or gap analysis**, keep the first round focused on:
  - review type: narrative / systematic / scoping / meta-analysis
  - clinical scope framed as PICO/PEO when possible
  - evidence priority: guidelines, RCTs, observational, qualitative, preclinical, etc.
  - target deliverable and output language
  - time window and language limits only if they materially change retrieval
- Ask only the highest-value 2-3 questions in the first batch.
- If some details remain missing after one follow-up, state explicit assumptions and continue instead of blocking the workflow.

Adapt to context:
- Skip already-provided details.
- **Skip questions for stages before `startStage`**: If starting from experiment, do not ask literature or ideation questions in detail — just capture a brief summary of the existing context in those sections.
- If exploratory, keep experiment/publication/promotion sections lightweight.
- If user provides concrete plan, prepare for `pipeline.mode = "plan"`; otherwise use `"idea"`.

## 3) Write pipeline files

Create if missing:
- `.pipeline/config.json`
- `.pipeline/docs/research_brief.json`
- `.pipeline/tasks/tasks.json`

Use the exact JSON contracts and generation rules in:
- `references/pipeline-contract.md` and linked reference files

Rules:
- Set `pipeline.startStage` to the determined starting stage (default: `"literature"`).
- **Generate tasks only for stages >= `startStage`** in the stage order (literature < ideation < experiment < publication < promotion).
- For skipped stages: still populate their `sections.*` fields in the brief with whatever context the user provided, but do not create task blueprints or tasks for them.
- Tailor blueprint titles/descriptions to the user topic (never generic filler).
- Keep quality gates domain-appropriate.
- Resolve recommended skills from local available skills (`.agents/skills/` or `skills/`), optionally using `stage-skill-map.json` if present.

For Meta projects:
- Use the five visible stages as: literature review, protocol design, implementation, manuscript/submission, presentation/translation.
- Recommended skills should come from the Meta workflow: `meta-analysis-workflow`, literature/search/citation skills, MinerU/PDF handling, extraction/quality appraisal, statistical synthesis/modeling, medical visualization, PRISMA writing, and presentation skills.
- Do not generate local database extraction, clinical pre-analysis, baseline table, or cohort-modeling tasks unless the user explicitly asks for a separate clinical data project.
- Write artifacts to the normal project folders: `Literature/`, `Ideation/`, `Experiment/`, `Publication/`, and `Promotion/`.

## 4) Summarize and confirm next action

After writing files, present:
- Brief summary (title, goal, starting stage, filled vs missing sections)
- Task overview (count by stage + first 2-3 task titles per stage) — only for active stages
- Recommended first task and why

## 5) Handle iteration requests

If user asks for updates:
- Update brief content directly when only text/content changes.
- Regenerate `tasks.json` when pipeline structure/blueprints/stages change.
- **If user asks to change the starting stage**: update `pipeline.startStage` in the brief, then regenerate `tasks.json` to include only the active stages.
- If asked to add one task only, append a single task with next numeric `id` instead of full regeneration.
