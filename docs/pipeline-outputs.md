# AutoMeta 流水线产物说明

本文档对应当前 `meta-v2` 项目结构，说明每个阶段应保存的主要产物。实际项目可以增加文件，但应保留清晰、可追溯的输入输出关系。

## 目录与产物

| 目录 | 用途 | 典型产物 |
|---|---|---|
| `00_literature/` | 初步调研与选题 | `reports/`、`references/`、`topic_selection/`、`scoping_review/` |
| `01_protocol/` | 研究方案 | 研究问题、PICO/PECO、纳排标准、结局定义、注册或方案文件、`workflow_status.md` |
| `02_search_dedupe/` | 检索与去重 | `search/`、`search/imported_records/`、各数据库导出记录、去重日志、`screening_input.csv` |
| `03_title_abstract_screening/` | 标题摘要筛选 | `01_ai_pre_screen/`、`02_agent_rescreen/`、`screening_decisions.csv` 或 `screening_decisions.json` |
| `04_full_text_review/` | 全文获取与审查 | `fulltext_manifest.json`、`fulltext_manifest.csv`、`pdf_manifest.json`、`pdf_manifest.csv`、`fulltext/<reference-id>/`、全文排除记录 |
| `05_data_extraction/` | 数据提取 | 提取表、研究特征表、效应量字段、`diagnostic_candidates.json`、`diagnostic_confirmed.json`、`diagnostic_dataset.csv` |
| `06_quality_assessment/` | 质量评价 | RoB、QUADAS、NOS、GRADE 等评价表及依据说明 |
| `07_data_analysis/` | 统计分析 | `code/`、`meta_input.csv`、运行目录中的 `input.csv` 与 `output.json`、合并效应、异质性、亚组和敏感性分析 |
| `08_results_figures/` | 图表与结果汇总 | 森林图、漏斗图、SROC、PRISMA 流程图、证据图和结果表 |
| `09_manuscript_submission/` | 稿件与投稿材料 | `manuscript.md`、分章节 Markdown、摘要、报告清单、附录、补充材料和数据可用性声明 |
| `10_presentation/` | 展示与传播 | 幻灯片、海报、项目主页、音视频和交付材料 |

## 关键文件

- `instance.json`：项目元数据和目录结构版本标记。
- `.pipeline/docs/research_brief.json`：供任务编排使用的结构化研究简报。
- `.pipeline/tasks/tasks.json`：任务状态和执行队列。`.pipeline/` 属于内部运行状态，不应当作研究结果目录。
- `02_search_dedupe/screening_input.csv`：标题摘要筛选的标准输入。
- `03_title_abstract_screening/screening_decisions.csv`：筛选决定的标准表格产物；使用 JSON 时应保持同等字段和可追溯性。
- `04_full_text_review/fulltext_manifest.json`：全文获取、解析和缺失状态的主清单。
- `07_data_analysis/meta_input.csv`：进入统计模型前经确认的分析数据。
- `09_manuscript_submission/manuscript.md`：完整稿件的主文件。

## 全文目录约定

每篇文献使用稳定的引用 ID 建立目录：

```text
04_full_text_review/fulltext/<reference-id>/
├── metadata.json
├── source.pdf
└── mineru/
    ├── content.md
    ├── tables.json
    ├── page_map.json
    └── parse_report.json
```

文件名可因解析工具而略有变化，但引用 ID、来源信息和页码映射必须保留。

## 无法继续时的产物

数据不足或阶段受阻时，应留下明确报告，不得补造记录或统计结果：

- `02_search_dedupe/no_data_report.md`
- `04_full_text_review/unavailable_full_text_report.md`
- `05_data_extraction/cannot_extract_data_report.md`
- `07_data_analysis/cannot_synthesize_report.md`

报告至少说明缺少什么、已尝试的处理方式、影响范围以及建议的下一步。

## 文件管理规则

- 原始导入文件只读保存；清洗、去重和转换结果另存。
- 分析脚本放在当前阶段的 `code/` 子目录，固定随机种子并记录软件版本。
- 表格中的文献 ID 应在筛选、全文、提取、评价和分析阶段保持一致。
- 文档内部优先使用项目相对路径，便于跨平台迁移。
- 最终统计数据、图表和稿件在导出前必须人工复核。
