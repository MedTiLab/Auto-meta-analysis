# Auto Research 五阶段契约

更新时间：2026-04-04

这份文档描述 `auto-research` 现在使用的五阶段契约语义。它的目标不是替代任务系统，而是给每个阶段补上一层稳定的“进入条件 / 期望输出 / 完成判定”。

## 契约结构

每个阶段契约都包含：

- `objective`：这一阶段要解决什么问题
- `requiredElements`：来自 `research_brief.json` 的关键字段
- `requiredElementsSource`：字段约束来自 `research_brief.pipeline.stages.<stage>.required_elements` 还是默认兜底
- `expectedOutputs`：该阶段通常应写到哪些目录
- `definitionOfDone`：阶段完成时应该满足的结果描述
- `qualityGate`：仍需人工或后续验证器判断的质量门
- `errorCodes`：运行时会产出的结构化错误码

## 运行时校验

现在有两层校验：

1. `readiness`
   - 用于判断一个阶段现在能不能进入
   - 主要检查：
     - `research_brief` 是否可用
     - 上一阶段是否已经完成
     - 当前阶段是否有任务
     - 显式 `required_elements` 是否已填写

2. `completion`
   - 用于判断一个阶段在“所有任务完成后”是否满足 DoD
   - 主要检查：
     - 阶段任务是否全部完成
     - 关键 brief 字段是否仍然完整
     - 期望输出目录是否存在

`completion` 对未完成阶段返回 `pending`，不会把正常进行中的阶段误报成失败。

## 接入点

当前契约已经接入三个地方：

- `preflight`
  - 启动前增加 `next_stage_contract` 检查
- `auto-research` 运行循环
  - 每次执行任务前检查阶段 `readiness`
  - 一个阶段全部任务完成后检查 `completion`
- `status` 接口
  - 返回 `pipeline.contracts`
  - 便于前端和后续 resume / audit 直接读取

## 错误码

当前使用的错误码：

- `STAGE_UNKNOWN`
- `BRIEF_MISSING`
- `REQUIRED_ELEMENT_MISSING`
- `TASKS_MISSING`
- `PREVIOUS_STAGE_INCOMPLETE`
- `OUTPUT_ROOT_MISSING`

说明：

- `REQUIRED_ELEMENT_MISSING`
  - 如果字段来自模板里显式声明的 `required_elements`，按 `fail` 处理
  - 如果只是系统默认兜底字段，按 `warn` 处理，避免误伤旧项目
- `OUTPUT_ROOT_MISSING`
  - 当前按 `warn` 处理
  - 后续可以在 `publication` 和 `promotion` 上升级为更严格的验证器

## 当前边界

这版契约只做“结构化可执行约束”，还没有做：

- 引用真实性验证
- 占位文本检测
- 结果内容质量评分
- 断点恢复后的阶段回滚判定

这些适合放到下一步的 `publication` validator 和 checkpoint resume 里继续补。
