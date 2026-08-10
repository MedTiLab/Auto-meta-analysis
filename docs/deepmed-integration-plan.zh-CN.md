# deepmed-search 能力整合计划

目标：把 `deepmed-search` 中最有价值的两类能力逐步迁移到当前工作区项目。

- 研究问题入口：让“论文动态 -> 研究问题 -> 深入研究 -> 任务/报告”形成闭环。
- 项目级知识库：围绕单个项目沉淀论文、笔记、证据、数据源和研究结论。
- 深度研究系统：记录子问题、证据链、未解决问题、引用与产出物。

原则：迁移能力，不直接硬合并仓库。当前项目继续沿用现有 `Vite + Express + SQLite/本地工作区` 架构，优先做本地可跑通的 MVP。

## 当前状态

- [x] 论文动态卡片已增加“深入研究”入口，可把单篇论文整理成结构化提示词并送入当前项目 Chat。
- [x] `research_brief` 默认结构和 4 个核心模板已经补上显式的“研究问题 / 知识库范围 / 种子论文 / 证据要求 / gap”字段。
- [x] 项目级知识库 MVP：`manifest.json`、多目录扫描、`Research Lab` 内 **Knowledge Base** 面板、关键词检索（**非**向量语义检索；与 deepmed-search Milvus 能力不对等）。
- [x] 深度研究过程 **MVP**：落盘 `.pipeline/docs/deep_research_state.json`，Research Lab **Deep research trace** 卡片编辑子问题/文献/证据/开放问题等，并可合并进 brief 或导出为 KB 笔记（非独立 Agent + SSE 执行轨迹产品）。

## Phase 1：研究问题正式入模

- [x] 为默认 `research_brief` 结构增加显式字段：
  - `sections.survey.core_research_question`
  - `sections.survey.knowledge_base_scope`
  - `sections.survey.seed_papers`
  - `sections.survey.evidence_requirements`
  - `sections.ideation.clinical_or_scientific_gap`
- [x] 把上述字段接入 4 个 research brief 模板：
  - `ai-research-dataset`
  - `ai-research-method-model`
  - `ai-research-position-paper`
  - `medical-ukb-cohort`
- [x] 更新模板 pipeline 的 `required_elements` / `quality_gate`，让“研究问题”和“gap”成为真正的入口要求。
- [x] 补一个“从 Research Lab 一键写回 research_brief”的动作。
- [x] 补一个“从 Chat 上下文一键写回 research_brief”的动作（Chat 工具条「Sync research brief」：可从近期用户消息填充并保存）。
- [x] 在 Research Lab 中增加更直接的“研究问题”可视化输入区。

验收标准：

- [x] 新建 brief 时默认带上上述字段（见 `normalizeBriefDocument` / `buildEmptyBrief`）。
- [x] 应用任一模板后，导出的 `research_brief.json` 字段齐全（`npm run smoke:deepmed` 校验 `sectionFields` 路径）。
- [x] 前端/后端不因新字段报错。

## Phase 2：项目级知识库 MVP

- [x] 在项目目录下定义知识库落盘结构，使用 `.pipeline/docs/kb/manifest.json`。
- [x] 建立 `manifest.json` 索引，记录文档来源、标签、摘要、更新时间。
- [x] 支持本地扫描并导入以下来源：
  - `Survey/references`
  - `Survey/reports`
  - 已生成的 `reports` / `Publication` / `drafts`
  - `research_brief.json` 中的种子论文与关键参考文献
- [x] 支持导入以下来源：
  - [x] 论文动态收藏/一键研究条目
  - [x] 用户手动粘贴录入的论文摘要与笔记
  - [x] 用户上传 PDF/文本（`.pdf` / `.txt` / `.md`）到 `.pipeline/docs/kb/uploads` 并重建 manifest；PDF 可选本地 `pdftotext` 生成 `.kb_extract.txt` 供摘要与关键词检索
- [x] 做本地检索 MVP，先使用轻量 JSON manifest，不先接 Milvus。
- [x] 暴露基础检索 API：关键词检索、按项目检索（项目级 manifest）、按标签检索、按来源检索。
- [x] 在 Research Lab 中增加知识库初始化与搜索面板。

验收标准：

- [x] 一个项目内至少能检索到论文动态导入内容与本地报告内容。
- [x] 检索结果返回标题、来源、摘要片段、更新时间、可追踪路径。

## Phase 3：深度研究执行面板

- [x] 在 Research Lab 中新增“研究问题”入口卡片（**Research Question Brief** + **Deep research trace**；后者为结构化轨迹 MVP）。
- [x] 记录并展示（`deep_research_state.json` / 表单）：
  - 子问题列表
  - 已读文献/网页
  - 证据摘要
  - 支持与反对证据
  - 未解决问题
  - 输出物与引用
- [x] 把过程结果结构化写回 `research_brief.json` 和项目知识库（开放问题合并至 brief gap；整份轨迹可保存为 KB 笔记；核心问题可从 brief 拉取）。
- [x] 支持从单篇论文触发“扩展为研究任务”（论文动态 **深入研究**：ingest → Chat 结构化提示；与 TaskMaster 自动建任务非同一概念，留作增强项）。

验收标准：

- [x] 能从一个核心研究问题出发，沉淀到项目知识库并形成下一步任务建议（经 Chat 提示 + KB 笔记 / brief；任务建议依赖 Agent 执行）。

## Phase 4：质量检查与回归

- [x] `npm run typecheck`
- [x] 模板字段 smoke：`npm run smoke:deepmed`（四模板 + typecheck）
- [ ] 新闻页 -> Chat -> brief 写回流程检查（**手动**验收：ingest、Chat、Research Lab / Chat sync 写 brief）
- [ ] 知识库导入 -> 检索 -> 引用流程检查（**手动**：上传或笔记、Refresh Index、搜索）
- [ ] 多模板切换兼容性检查（**手动**）

## 推荐执行顺序

1. 先完成 Phase 1，把研究问题正式接入 brief 和模板。
2. 再做 Phase 2，把“项目知识库”作为本地 MVP 跑通。
3. 然后做 Phase 3，把深度研究过程可视化并和知识库联动。
4. 每完成一个 Phase，立即做一次最小回归检查。
