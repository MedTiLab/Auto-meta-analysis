# Summarize Meta-analysis Progress

```text
/meta-analysis-workflow summarize

请汇总当前 Meta-analysis 项目进度。优先读取 `00_literature/`、`01_protocol/`、`02_search_dedupe/`、`03_title_abstract_screening/`、`04_full_text_review/`、`05_data_extraction/`、`06_quality_assessment/`、`07_data_analysis/`、`08_results_figures/`、`09_manuscript_submission/`、`10_presentation/`、`.pipeline/` 以及已有聊天/任务产物，输出：
1. 已完成阶段和关键文件路径；
2. 检索、去重、筛选、PDF 下载、MinerU 解析、提取表、质量评价、统计合并、图表、写作各阶段状态；
3. 缺失或冲突数据；
4. 下载失败或不可公开下载文献清单及原因；
5. 下一步最重要 3 个动作；
6. 更新 `.pipeline/docs/research_brief.json` 或对应阶段日志。
```
