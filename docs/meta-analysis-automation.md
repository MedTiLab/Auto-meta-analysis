# AutoMeta 自动化工作流

AutoMeta 用一套固定的项目目录组织系统综述和 Meta 分析。工作流覆盖选题、方案制定、检索去重、筛选、全文管理、数据提取、质量评价、统计分析、结果展示和稿件交付。

## 使用方式

1. 在 AutoMeta 中创建或打开研究项目。
2. 明确研究问题、PICO/PECO、纳排标准和主要结局。
3. 按编号目录逐阶段执行任务，并将可复核产物写入对应目录。
4. 每个阶段完成后检查输入、输出和引用来源，再进入下一阶段。
5. 在最终统计分析和稿件提交前进行人工复核。

## 项目结构

```text
00_literature/
01_protocol/
02_search_dedupe/
03_title_abstract_screening/
04_full_text_review/
05_data_extraction/
06_quality_assessment/
07_data_analysis/
08_results_figures/
09_manuscript_submission/
10_presentation/
```

- `00_literature/`：初步证据扫描、种子文献、选题和可行性评估。
- `01_protocol/`：研究方案、PICO/PECO、纳排标准、结局指标和流程状态。
- `02_search_dedupe/`：数据库检索记录、导入文献、去重结果和筛选输入。
- `03_title_abstract_screening/`：标题摘要初筛、复筛及排除理由。
- `04_full_text_review/`：全文文件、全文清单、解析结果和全文排除记录。
- `05_data_extraction/`：提取表、研究特征和可用于分析的数据集。
- `06_quality_assessment/`：偏倚风险、研究质量和证据确定性评价。
- `07_data_analysis/`：分析代码、模型输入、运行结果和敏感性分析。
- `08_results_figures/`：森林图、漏斗图、SROC、PRISMA 流程图和结果表。
- `09_manuscript_submission/`：稿件、摘要、清单、附录和补充材料。
- `10_presentation/`：幻灯片、海报、网页及其他传播材料。

各阶段的具体文件和命名约定见[流水线产物说明](./pipeline-outputs.md)。

## 执行原则

- 原始记录、筛选决定、提取数据和分析结果应能相互追溯。
- 脚本放入对应阶段的 `code/` 子目录，不要覆盖原始数据。
- 无法取得全文、无法提取数据或无法合并时，生成说明报告，不虚构结果。
- 统计模型、效应量方向、亚组和敏感性分析必须经过人工确认。
- 对外使用图表或稿件前，检查引用、数字和版本是否一致。
