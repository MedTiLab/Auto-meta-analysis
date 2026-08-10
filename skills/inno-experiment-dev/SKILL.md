---
name: inno-experiment-dev
description: Creates an analysis/implementation plan, builds reproducible code (stats, data pipelines, or ML when needed) with a judge review loop, and runs the final analysis job. Use after code-survey in Idea and Plan branches—default mental model is medical and database-driven research, not generic model training.
---

# Inno Experiment Dev (Planning, Implementation, and Submission)

Merges the former `inno-implementation-plan`, `inno-ml-dev-iteration`, and the submit step of `inno-experiment-submit-refine`. Mirrors `_create_implementation_plan` (830-858), `_implement_and_iterate` (861-920), and the submit portion of `_submit_and_refine_experiments` (922-945) in `run_infer_idea_ours.py`.

**Medical / database-driven framing:** In health research, treat **“implementation”** as **reproducible extraction, QC, estimation, and reporting**—SQL/R/Python/stats workflows, cohort builders, and registry pulls—not only deep learning. The **Implementation Agent** below corresponds to the historical **ML Agent** in orchestration code and log filenames; when the study is observational or clinical, plans should emphasize **data sources, cohort logic, outcomes, confounding, and preset analyses** alongside any modeling.

## Inputs

| Variable | Source | Description |
|----------|--------|-------------|
| `survey_res` | inno-idea-generation or user | The finalized selected idea (or `refined_for_downstream`) |
| `references` | pipeline config | Pre-formatted string of source papers |
| `updated_prepare_res` | inno-prepare-resources | JSON with `reference_codebases` and `reference_paths` |
| `code_survey_res` | inno-code-survey | Comprehensive implementation report / prior code & methods survey |
| `dataset_description` | from prepare step / context | Description of available datasets (not in instance.json) |
| `core_code` | instance.json `Experiment.core_code` | Absolute path when created by MedHelp (e.g. `<project_path>/Experiment/core_code`); use as-is or resolve with `path.join(project_path, value)` if relative |
| `code_references` | instance.json `Experiment.code_references` | Absolute path when created by MedHelp (e.g. `<project_path>/Experiment/code_references`); use as-is or resolve if relative |
| `max_iter_times` | pipeline config | Max judge-iteration rounds (default 2) |
| `context_variables` | shared state | Mutable dict carrying state across agents |

Plan mode additionally uses `ideas` and survey-specific prompt variants (`build_plan_query_with_survey`, `build_iteration_query_for_plan`, etc.).

## Outputs

| Variable | Description |
|----------|-------------|
| `plan_res` | Detailed plan: data sources/cohort, analysis approach (including estimators or models), validation strategy, and deliverables |
| `ml_dev_res` | Final **implementation** result (historical name: ML Agent output—code, pipeline, or trained model as applicable) |
| `judge_res` | Final Judge Agent feedback |
| `judge_messages` | Full conversation thread (preserved for inno-experiment-analysis) |
| `submit_res` | Final run output with estimands, tables, or metrics appropriate to the study |
| `context_variables` | Updated with `dataset_plan`, `training_plan`, `testing_plan`, `suggestion_dict`, `raw_error_stats` (legacy keys kept for runner compatibility—interpret `training_plan` as **estimation / fitting** and `testing_plan` as **validation / evaluation** when not doing neural training) |

## Cache Artifacts

| File | Agent | Content |
|------|-------|---------|
| `Experiment/core_code/logs/coding_plan_agent.json` | Coding Plan Agent | `context_variables` + `messages` from planning phase |
| `Experiment/core_code/logs/machine_learning_agent.json` | Implementation Agent (legacy log name: ML Agent) | Initial implementation messages (+ `_iter_{N}.json` for judge iterations) |
| `Experiment/core_code/logs/judge_agent.json` | Judge Agent | Evaluation messages (+ `_iter_{N}.json` for iterations) |
| `Experiment/core_code/logs/machine_learning_agent_iter_submit.json` | Implementation Agent (legacy log name) | Final submission run messages and results |

## Instructions

### Phase 1: Create Implementation Plan

Mirrors `_create_implementation_plan`.

1. **Optional pre-step (Idea mode only)**: If refining the idea for implementation clarity, call the idea refinement agent to produce `refined_for_downstream` with **clear data contracts** (key tables, cohort logic, outcomes). For DL-heavy work, tensor interfaces / forward-pass sketches remain appropriate; for clinical pipelines, prefer **variable dictionaries and DAG-style assumptions**.

2. **Build plan query**:
   - **Idea mode**: `plan_query = build_plan_query(survey_res, references, updated_prepare_res, code_survey_res, dataset_description)` (see `prompts/build_plan_query.md`)
   - **Plan mode**: Use `build_plan_query_with_survey(ideas, references, prepare_res, code_survey_res, dataset_description)`

3. **Call Coding Plan Agent** with `messages = [{"role": "user", "content": plan_query}]`.
   - The agent reviews codebases using `tree` / `cat`, then creates structured plans via `plan_dataset`, `plan_training`, `plan_testing`.
   - Calls `case_resolved` to merge plans.
   - Set `plan_res = plan_messages[-1]["content"]`.
   - See `references/coding_plan_agent.md` for agent details.

4. **Verify** the plan has clear sections: **data / cohort**, **analysis or model**, **estimation or training**, **evaluation / validation**, file layout.

### Phase 2: Implement and Iterate

Mirrors `_implement_and_iterate`.

5. **Initial implementation**: Build `ml_dev_query = build_ml_dev_query(survey_res, prepare_res, code_survey_res, plan_res, dataset_description, core_code, code_references)` (see `prompts/build_ml_dev_query.md`). Use paths from `instance.json`: `Experiment.core_code`, `Experiment.code_references` (absolute in MedHelp–created projects; use as-is or resolve with project path if relative). Call the **Implementation Agent** (orchestrator: **ML Agent**) with `messages = [{"role": "user", "content": ml_dev_query}]`. Set `ml_dev_res = ml_messages[-1]["content"]`.
   - See `references/ml_agent_instructions.md` for agent details (filename unchanged for tooling compatibility).

6. **Initial judge evaluation**: Build `judge_query = build_judge_query(survey_res, prepare_res, plan_res, ml_dev_res)` (see `prompts/build_judge_query.md`). Call **Judge Agent** with `input_messages = [{"role": "user", "content": judge_query}]`. Set `judge_res = judge_messages[-1]["content"]`.
   - See `references/judge_agent_instructions.md` for agent details.

7. **Iteration loop** (for i in 0..max_iter_times - 1):
   a. Build `iteration_query = build_iteration_query(survey_res, prepare_res, code_survey_res, plan_res, ml_dev_res, judge_res, core_code, code_references)` (see `prompts/build_iteration_query.md`). Use paths from instance.json (absolute in MedHelp–created projects; use as-is or resolve if relative). Plan mode uses `build_iteration_query_for_plan`.
   b. Append as user message to `judge_messages`. Call **Implementation / ML Agent** with `iter_times=i+1`. Update `ml_dev_res`.
   c. Build `judge_simple_query = build_judge_simple_query(survey_res, prepare_res, plan_res, ml_dev_res)` (see `prompts/build_judge_simple_query.md`). Plan mode uses `build_judge_simple_query_for_plan`.
   d. Append as user message to `judge_messages`. Call **Judge Agent** with `iter_times=i+1`. Update `judge_res`.
   e. If `"fully_correct": true` in last message, **break early**.

8. Preserve `judge_messages` for the submit step and for downstream `inno-experiment-analysis`.

### Phase 3: Submit Experiment

Mirrors the submit portion of `_submit_and_refine_experiments`.

9. **Build submit query**: `submit_query = build_submit_query(survey_res, ml_dev_res, judge_res, core_code)` (see `prompts/build_submit_query.md`). Resolve `core_code` from `instance.Experiment.core_code`. Plan mode uses `build_submit_query_for_plan`.

10. **Append** to `judge_messages` as user message. Call **Implementation / ML Agent** with `iter_times="submit"`.
    - For **DL workflows**, the agent may adjust epochs (e.g. 3–10), run `run_training_testing.py`, and save checkpoints. For **clinical stats / pipelines**, the same step should run the **final analysis script** (or Makefile target) that emits tables, estimates, and logs.
    - Set `submit_res = judge_messages[-1]["content"]`.

11. If the implementation is not runnable, the agent calls `case_not_resolved`. Otherwise, `case_resolved` with **analysis outputs** (statistics, metrics, or artifacts) appropriate to the study.

## Tool Mappings

All custom Python tools map to Claude Code built-in capabilities:

| Original Tool | Claude Code Equivalent |
|---------------|----------------------|
| `execute_command` | Shell tool (direct execution) |
| `run_python` | `python <script>` via Shell tool |
| `create_file` / `write_file` | Write tool |
| `read_file` | Read tool or `cat <path>` |
| `create_directory` | `mkdir -p <path>` |
| `list_files` | `ls <path>` |
| `gen_code_tree_structure` | `tree -L 3 <path>` |
| `diagnose_code_error` | Analyze stderr output + inspect code |
| `rollback_and_reimplement` | Re-write file with different approach |
| `view_error_history` | Track error fingerprints in agent memory |
| `plan_dataset` / `plan_training` / `plan_testing` | Structure plan sections in agent response |
| `case_resolved` / `case_not_resolved` | Agent returns result / failure reason |

## Checklist

- [ ] Optional idea refinement applied if desired (Idea mode).
- [ ] Correct `build_plan_query` variant used for Idea vs Plan mode.
- [ ] Coding Plan Agent called; `plan_res` has clear data/cohort, analysis (or model), estimation/training, and validation/testing sections.
- [ ] Implementation (ML) Agent initial build completed; `ml_dev_res` recorded.
- [ ] Judge Agent initial evaluation completed; `judge_res` recorded.
- [ ] Iteration loop runs with correct prompt variants; early exit on `fully_correct`.
- [ ] `judge_messages` preserved across all phases.
- [ ] Submit query appended to `judge_messages`; submission run completed.
- [ ] Final artifacts saved: for DL, e.g. `Experiment/core_code/checkpoints/model_final.pth`; for clinical/stats work, exported tables, figures, and reproducible scripts under `Experiment/analysis` or `core_code` as planned.
- [ ] Cache artifacts saved to `Experiment/core_code/logs/`: `coding_plan_agent.json`, `machine_learning_agent.json`, `judge_agent.json`, `machine_learning_agent_iter_submit.json`.

## References

- `run_infer_idea_ours.py`: `_create_implementation_plan` (830-858), `_implement_and_iterate` (861-920), `_submit_and_refine_experiments` submit step (922-945)
- `prompt_templates.py`: `build_plan_query` (203-233), `build_ml_dev_query` (236-381), `build_judge_query` (384-417), `build_iteration_query` (420-468), `build_judge_simple_query` (471-494), `build_submit_query` (497-527)
- Agent definitions: `plan_agent.py`, `ml_agent.py`, `judge_agent.py` in `inno/agents/inno_agent/`
