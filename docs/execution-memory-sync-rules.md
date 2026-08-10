# Execution Memory Sync Rules

更新时间：2026-04-05

## 四层职责

1. `instance.json`
   - 只负责项目路径、目录映射、阶段输出位置。
   - 不保存执行进度，不保存临时小任务。

2. `research_brief.json`
   - 只负责稳定的项目定义、阶段目标、关键输入、质量门、任务蓝图。
   - 适合保存“已经确认并将持续生效”的研究设定。

3. task brief / `nextActionPrompt`
   - 只负责当前这一轮要执行的 assignment。
   - 不作为断点恢复真源。

4. execution memory
   - 负责保存运行时执行状态、模型临时拆分的小任务、最近产物、观察到的结果。
   - 是断点恢复和续跑的主入口。

## 哪些内容应该同步

### 写入 execution memory

- `TodoWrite` / `todo_list` 产生的小任务快照
- 工具执行链（`tool_use` / `tool_result`）
- 文件写入或文件变更产生的产物路径
- 已完成 task / run 的阶段性结果摘要
- 助手消息中出现的统计结果或关键结论（标记为 `observed`）

### 写入 `working-summary.md`

- 已确认的产物路径
- 已完成 / 未完成的小任务列表
- 助手消息里提取到的关键发现
- 当前目标和当前 task

## 报告落盘规则

- 只要助手输出属于“报告型内容”，例如综述、分析总结、计划、评审、对比、阶段结论、变更说明，就必须先写成 `.md` 文件，再在聊天里给简短结论。
- 优先写到当前 stage 的 canonical 目录，并直接复用项目里已有的可见目录，例如 `Literature/reports/`、`Ideation/ideas/`、`Experiment/analysis/`、`Publication/manuscript/`、`Promotion/slides/`。
- 如果当前问题没有显式 stage，就根据对话内容推断到最近的可见流程目录：文献/证据类放 `Literature/reports/`，构思/计划类放 `Ideation/ideas/`，代码/结果/分析类放 `Experiment/analysis/`，论文/引文类放 `Publication/manuscript/`，幻灯/海报/主页/视频类放 `Promotion/slides/`。
- 如果仍然拿不准，就落到当前激活 stage 的可见目录；不要把常规对话报告写到 `.pipeline/docs/chat-reports/` 这类隐藏目录。
- 如果项目里已经有人为整理好的子目录，就优先沿用；不要为了区分 AI 额外新建 `codex/`、`claude/`、`gemini/`、`cursor/` 这类可见子目录。
- 建议文件名格式：`YYYY-MM-DD-topic.md`；如果是同一产物的迭代版，使用 `YYYY-MM-DD-topic-v2.md`、`v3` 等版本后缀。
- 默认不要把 `codex`、`claude`、`gemini`、`cursor` 这类 provider 名字拼进报告、数据、图表文件名里，除非用户明确要求。
- 只有聊天消息、没有落盘的长报告，默认只算 `observed`，不能当作可续跑的 `confirmed` 产物。

### 写入 `research_brief.json`

只有在信息已经稳定、会影响后续全局执行时才允许写回，例如：

- 明确的研究问题、终点定义、纳排标准
- 最终采用的分析方案
- 最终确定的数据源、队列定义、评价指标
- 最终采用的 figure/table 计划

当前默认落点：

- 顶层 `execution_memory_sync`
- 按 `stages.<stage>` 聚合 confirmed 产物、已完成任务、已完成 microtasks
- 不直接覆盖原有 `sections.*` 表单字段

## 哪些内容不要自动写回 `research_brief.json`

- 临时拆出来的执行小任务
- 某一次试跑日志
- 尚未验证的统计结果
- 中间失败步骤
- 工具调用细节
- 临时 blocker 或等待项

这些都属于 execution memory，不属于 brief。

## 确认级别

execution memory 里的结果分两类：

- `confirmed`
  - 已落到文件
  - 或已形成结构化结果
  - 或已经完成 task / stage 级确认

- `observed`
  - 仅存在于消息文本
  - 尚未落文件
  - 仍需人工或后续步骤确认

默认规则：

- `working-summary.md` 可以展示 `confirmed` 和 `observed`，但要区分来源
- 自动写回 `research_brief.json` 时，只允许使用 `confirmed`

## 恢复优先级

恢复时优先使用：

1. `microtasks.json`
2. `results-ledger.jsonl`
3. `session-summary.md`
4. `checkpoint.json` / `stage-summary.json` / `tasks.json`
5. 历史聊天

换句话说，聊天历史是补充，不再是主真源。
