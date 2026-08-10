# Inno Skill Usage Audit

This document tracks where `inno-*` skills are used in the MedHelp® pipeline and which flows should stay `inno-first`.

## Available Inno Skills

- `inno-pipeline-planner`
- `inno-deep-research`
- `inno-idea-generation`
- `inno-idea-eval`
- `inno-prepare-resources`
- `inno-experiment-analysis`
- `inno-paper-writing`
- `inno-paper-reviewer`
- `inno-reference-audit`
- `inno-humanizer`
- `inno-rclone-to-overleaf`
- `inno-rebuttal`
- `inno-grant-proposal`
- `inno-figure-gen`

## Flow Inventory

### 1. Project / Chat Start Flows

- `README.md`
- `README.zh-CN.md`
- `src/components/chat/view/subcomponents/PipelineOnboardingBanner.tsx`
- `src/components/chat/constants/guidedPromptScenarios.ts`
- `src/components/chat/view/subcomponents/SkillShortcutsPanel.tsx`
- `src/i18n/locales/zh-CN/common.json`
- `src/i18n/locales/en/common.json`

Policy:
- All new research starts should prefer `inno-pipeline-planner`.
- Database-focused quick starts should still begin with an `inno-*` skill before any helper skill.

### 2. Agent Prompt Templates

- `server/templates/AGENTS.md`
- `server/templates/CLAUDE.md`
- `server/templates/GEMINI.md`
- `server/templates/cursor-project.md`

Policy:
- Intake and task regeneration should prefer `inno-pipeline-planner`.
- Citation verification should prefer `inno-reference-audit`.

### 3. Task Generation Defaults

- `server/routes/taskmaster.js`

Policy:
- Stage-level `recommended_skills` should remain `inno-first`.
- Non-inno skills can appear as supporting companions, but the lead skill should stay `inno-*`.

### 4. Research Brief Templates

- `server/taskmaster-templates/medical-ukb-cohort.json`
- `server/taskmaster-templates/ai-research-dataset.json`
- `server/taskmaster-templates/ai-research-method-model.json`
- `server/taskmaster-templates/ai-research-position-paper.json`

Policy:
- Template-level `recommended_skills` should keep `inno-*` first.
- Public database templates such as UKB should use `inno-*` to start, then add domain skills like `ukb-cohort-analysis` as the next layer.

### 5. Core Skill Registry

- `server/projects.js`

Policy:
- `inno-pipeline-planner` is treated as a core pipeline skill and must remain discoverable in platform-native skill views.

## Current Decision

Adopt `inno-first`, not `inno-only`.

- `inno-*` is the primary execution spine for project start, planning, task generation, publication, and promotion.
- Database-specialized skills and general academic skills can be attached as secondary helpers after the lead `inno-*` skill.

## Next Suggested Cleanup

- Add the same `inno-first + domain-second` pattern for future public database templates such as NHANES.
- Consolidate repeated stage-to-skill mappings into a shared constant so the chat starters and task templates cannot drift apart again.
