# AutoMeta Skills

AutoMeta 的 Skill 是供 AI 执行研究任务时读取的操作说明。应用只展示当前允许使用且目录中真实存在的 Skill；仓库里用于底层开发、模型训练或兼容旧功能的嵌套目录不会出现在技能面板中。

## Skill taxonomy

当前版本内置 **55 个可见 Skill**，按 Meta 分析工作流的主要用途分为以下 8 组。一个 Skill 可能服务多个阶段，这里只放在最主要的用途下，避免重复计数。

### 1. 流程编排（2）

- `meta-pipeline-planner`
- `meta-analysis-workflow`

### 2. 选题、检索与证据管理（10）

- `literature-review`
- `pubmed-search-strategy`
- `pubmed-database`
- `openalex-database`
- `real-literature-trace`
- `citation-management`
- `scientific-brainstorming`
- `hypothesis-generation`
- `scientific-critical-thinking`
- `scholar-evaluation`

### 3. 文献筛选与全文处理（10）

- `meta-screening-rescreen`
- `paper-lookup`
- `paper-fetcher`
- `paper-download`
- `research-paper-downloader`
- `legal-pdf-acquisition`
- `public-literature-download`
- `meta-zotero-fulltext-handoff`
- `mineru-pdf-parser`
- `pdf-evidence-extraction`

### 4. 数据提取与质量评价（4）

- `meta-extraction`
- `diagnostic-data-extraction`
- `data-transform`
- `peer-review`

### 5. 统计分析（7）

- `diagnostic-meta-analysis`
- `meta-statistics-r`
- `statistical-analysis`
- `data-stats-analysis`
- `statsmodels`
- `scikit-survival`
- `polars`

### 6. 结果图表（6）

- `data-visualization-biomedical`
- `data-viz-plots`
- `scientific-visualization`
- `matplotlib`
- `seaborn`
- `plotly`

### 7. 论文与投稿（12）

- `prisma-manuscript-writer`
- `manuscript-editor`
- `inno-paper-writing`
- `inno-paper-reviewer`
- `inno-humanizer`
- `inno-rebuttal`
- `inno-reference-audit`
- `scientific-writing`
- `nature-data`
- `nature-polishing`
- `venue-templates`
- `docx`

### 8. 展示与传播（4）

- `making-academic-presentations`
- `scientific-slides`
- `paper-2-web`
- `pptx-posters`

## 与流水线的关系

Skill 会根据任务被分配到 `00_literature` 至 `10_presentation` 的相应阶段。运行时推荐关系由 [`stage-skill-map.json`](./stage-skill-map.json) 管理；聊天框中的 Meta 快捷入口由前端的 `metaAnalysisSkills.ts` 管理。

技能面板中的名称以 `skills/<skill-name>/SKILL.md` 是否真实存在为准。通过界面安装的新 Skill 会动态加入技能面板，因此个人环境中的总数可能高于 55。

## 维护规则

- 新增 Skill 时必须包含有效的 `SKILL.md`。
- 删除 Skill 时，同时清理运行时映射和快捷入口，不能只删除目录。
- 文档中的总数只统计 AutoMeta 当前可见的顶层 Skill，不统计隐藏的嵌套工具包。
- 不存在于本地目录的名称不得出现在可见列表中。
