# Start / Continue Meta-analysis Workflow

Use this prompt from the Skills panel:

```text
/meta-analysis-workflow

请作为医学系统综述 / Meta-analysis 自动化总控运行。优先读取当前项目已有文件、References、Zotero 同步结果、检索表、PDF 与 MinerU 解析产物；不要重复下载或重复解析已存在且校验通过的文件。

目标：按 PRISMA 2020 逻辑把本项目推进到可投稿初稿。请将状态持续写入 `.pipeline/docs/research_brief.json` 和对应阶段日志，并在每一阶段产出结构化文件。

默认流程：00_literature 文献调研 / 选题判断 / 范围综述路径 → 01_protocol Protocol/PICO → 02_search_dedupe 检索去重 → 03_title_abstract_screening 题摘一筛与 AI 二筛 → 04_full_text_review 全文下载、剩余缺全文 Zotero 通讯、全文一筛与 AI 二筛、MinerU/直接转换解析 → 05_data_extraction 提取 → 06_quality_assessment 质评 → 07_data_analysis 统计合并入口判断 → 08_results_figures 图表 → 09_manuscript_submission PRISMA 成稿/DOCX。

目录规则：不要创建 `Survey/meta-analysis`、`MetaAnalysis/` 或额外 `meta-analysis/` 子目录。文献调研、seed references、Meta 选题判断、可行性评估和范围综述路线写入 `00_literature/`；正式 Protocol/PICO/纳排/结局写入 `01_protocol/`；正式检索去重写入 `02_search_dedupe/`；题名摘要筛选写入 `03_title_abstract_screening/`；全文/PDF/MinerU 写入 `04_full_text_review/`；数据提取写入 `05_data_extraction/`；质量评估写入 `06_quality_assessment/`；统计分析写入 `07_data_analysis/`；图表写入 `08_results_figures/`；手稿投稿写入 `09_manuscript_submission/`。

智能筛选规则：检索源记录可写入 `02_search_dedupe/search/imported_records/<source>.csv` 作为审计材料；去重后的唯一最终输入表固定写入 `02_search_dedupe/screening_input.csv`。不要把原始搜索结果当作智能筛选页结果。题摘一筛/AI 二筛审计文件分别写入 `03_title_abstract_screening/01_ai_pre_screen/` 与 `03_title_abstract_screening/02_agent_rescreen/`；全文一筛/AI 二筛不在 `04_full_text_review/` 下创建 `01_ai_pre_screen/` 或 `02_agent_rescreen/`，全文资产、解析结果、不可得全文清单和少量审计日志放在 `04_full_text_review/` 或 `04_full_text_review/fulltext/`。智能筛选页只展示 `03_title_abstract_screening/screening_decisions.csv` 或 `screening_decisions.json` 中的决策；题摘使用 `stage=title_abstract`，全文使用 `stage=full_text`。首次 AI 一筛使用 `reviewer=ai_pre_screen`，Claude AI 二筛使用 `reviewer=claude`；若仍不稳，最多增加一轮 AI 查漏补缺，重点检查误排、漏纳和理由不一致。用户只作为覆盖、抽查和少量冲突处理入口，不作为默认逐条复筛门槛；不得覆盖 `reviewer=user` 的用户决策。

请先给出当前项目状态诊断、缺失文件列表、下一步执行计划，以及可以立即运行的命令或任务队列。若缺少关键 PICO 信息，只提出最少必要澄清问题；否则按项目已有上下文继续。
```
