# TaskMaster 模板结构说明

本目录存放 Pipeline Board 使用的 JSON 模板。

每个模板有两个职责：

1. 定义 Web 表单字段（`metaFields`、`sectionFields`）。
2. 定义从 `research_brief.json` 生成任务的规则（`pipeline.stages.*.task_blueprints`）。

## 模板如何生效

当用户应用模板时：

1. 后端基于模板生成 `.pipeline/docs/research_brief.json`。
2. 前端填写的字段按 `path` 回填到该 JSON（例如 `sections.ideation.problem_framing`）。
3. 后端解析 brief，并根据 `pipeline.stages` 生成 `.pipeline/tasks/tasks.json`。

## 顶层字段（建议）

每个模板 JSON 建议包含：

- `id`：模板唯一标识（稳定）。
- `name`：UI 展示名称。
- `description`：模板简介。
- `domain`：领域分组（用于筛选）。
- `category`：分类（通常与 domain 一致）。
- `format`：当前为 `research-brief-json`。
- `fileName`：通常为 `research_brief.json`。
- `metaFields`：Meta 区域表单定义。
- `sectionFields`：分阶段表单定义（`literature/ideation/experiment/publication/promotion`）。
- `pipeline`：任务生成蓝图。

## 表单字段定义

`metaFields` 和 `sectionFields.*` 的字段结构：

- `key`：字段键名。
- `label`：UI 显示名称。
- `path`：写入 brief 的点路径。
- `placeholder`：输入提示（可选）。
- `type`：可选，`"array"` 表示多行数组输入。

当 `type: "array"` 时，前端每一行会转为数组一项。

## Pipeline 结构

`pipeline` 决定任务生成逻辑，典型结构：

- `version`：pipeline 版本号。
- `mode`：模式标记（如 `"idea"`）。
- `stages`：阶段对象，通常包含：
  - `literature`
  - `ideation`
  - `experiment`
  - `publication`
  - `promotion`

每个阶段可定义：

- `required_elements`：该阶段关键字段路径。
- `optional_elements`：可选字段路径。
- `quality_gate`：阶段质量门检查项。
- `task_blueprints`：任务蓝图（按顺序生成任务）。
- `recommended_skills`：建议技能列表。

## 阶段 Skills 映射表

当前后端使用的阶段技能映射（当任务没有显式 `recommended_skills` 时会作为兜底）：

| 阶段 | 基础技能 | 按任务类型补充 |
|---|---|---|
| `literature` | `literature-review`、`pubmed-database`、`real-literature-trace`、`citation-management` | `exploration` -> `literature-review`、`pubmed-database`、`real-literature-trace`、`research-lookup`，`analysis` -> `literature-review`、`citation-management`、`research-lookup` |
| `ideation` | `meta-pipeline-planner`, `meta-analysis-workflow`, `scientific-brainstorming` | `analysis` -> `meta-pipeline-planner`、`meta-analysis-workflow`，`exploration` -> `scientific-brainstorming`、`literature-review` |
| `experiment` | `statistical-analysis`, `data-stats-analysis`, `statsmodels` | `implementation` -> `data-transform`、`statistical-analysis`，`analysis` -> `statistical-analysis`、`data-stats-analysis`、`statsmodels`，`exploration` -> `literature-review`、`scientific-critical-thinking` |
| `publication` | `inno-paper-writing`, `manuscript-editor`, `citation-management` | `writing` -> `inno-paper-writing`、`inno-humanizer`，`analysis` -> `inno-reference-audit`、`citation-management` |
| `promotion` | `scientific-visualization`, `scientific-slides`, `paper-2-web` | `scripting`/`narration` -> `scientific-slides`、`scientific-writing`，`rendering`/`delivery` -> `scientific-visualization`、`paper-2-web` |

每个任务推荐技能的合成优先级：

1. 阶段配置 `recommended_skills`
2. 阶段映射基础技能
3. 阶段映射的任务类型技能
4. 任务蓝图自身 `recommended_skills`

## 医学文献综述原则

对于医学文献综述 / 证据整合任务，默认 skill 链路保持精简：

1. `literature-review` 负责综述框架与综合输出
2. `pubmed-database` 作为生物医学主检索源
3. `real-literature-trace` 负责可追溯筛选与规范落地页
4. `citation-management` 负责元数据整理与参考文献核验

只有出现明确缺口时才补充：

- `research-lookup`：需要最新指南、官方页面或非 PubMed 事实时再加
- `inno-deep-research` 或 `deep-research`：核心证据集形成后，仍需更广泛跨源综合时再加
- `biorxiv-database`：只有预印本对结论有实质影响时再加
- `academic-researcher`：仅在证据收集完成后，用于论证结构或写作整理
- `literature-review`：仅在任务从文献综述转向方法/代码复现时使用

## Meta-analysis 模板

`medical-meta-analysis.json` 是系统综述 / Meta-analysis 的结构化模板。新 Meta 项目使用 `meta-v2` 的十一个英文编号目录，并把旧的五阶段状态键仅作为内部兼容层：

- `00_literature/`：文献调研、seed references、Meta 选题、可行性判断和范围综述路线
- `01_protocol/`：Protocol、PICO/PECO、纳排标准、结局和注册信息
- `02_search_dedupe/`：检索式、检索日志、导入记录和去重结果
- `03_title_abstract_screening/`：题名/摘要筛选、排除原因和冲突处理
- `04_full_text_review/`：全文阅读、PDF、全文筛选、MinerU 输出
- `05_data_extraction/`：提取表、研究特征、效应量字段和 meta-ready 数据
- `06_quality_assessment/`：RoB、QUADAS、NOS、GRADE 和质量评估记录
- `07_data_analysis/`：统计脚本、模型输入、合并估计和运行输出
- `08_results_figures/`：森林图、漏斗图、SROC、PRISMA 图和结果表
- `09_manuscript_submission/`：PRISMA 手稿、checklist、补充材料和投稿包
- `10_presentation/`：slides、homepage、audio、video 和汇报材料

已有 Meta 项目如果没有 `meta-v2`，继续保留原目录，不自动迁移。`.pipeline/` 仍只用于任务和研究简报，不要把 PDF、提取表、统计结果或图表塞进 `.pipeline/`。

## task_blueprints 字段

`task_blueprints` 中每个任务支持：

- `id`：蓝图任务 ID（稳定）。
- `title`：任务标题。
- `description`：任务描述。
- `taskType`：任务类型（如 `analysis`、`implementation`、`writing`、`exploration`、`scripting`、`rendering`、`narration`、`delivery`）。
- `priority`：可选，`low/medium/high`。
- `dependencies`：可选，依赖任务 ID 数组。
- `inputsNeeded`：可选，输入依赖路径或条件。
- `recommended_skills`：可选，任务级技能建议。
- `nextActionPrompt`：可选，Chat 接力提示词。

## 最小模板示例

```json
{
  "id": "example-template",
  "name": "示例模板",
  "description": "演示模板",
  "domain": "ai-research",
  "category": "ai-research",
  "format": "research-brief-json",
  "fileName": "research_brief.json",
  "metaFields": [
    { "key": "title", "label": "标题", "path": "meta.title" }
  ],
  "sectionFields": {
    "ideation": [
      { "key": "problem_framing", "label": "问题界定", "path": "sections.ideation.problem_framing" }
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
        "quality_gate": ["问题界定足够具体"],
        "task_blueprints": [
          {
            "id": "define_problem_scope",
            "title": "定义问题范围",
            "description": "明确边界、假设与约束。",
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

## 实践建议

- 模板 `id` 一旦发布尽量保持不变（可能已被历史 brief 引用）。
- `path` 必须与 `research_brief.json` 的结构一致。
- `task_blueprints` 顺序会直接影响 `tasks.json` 的生成顺序。
