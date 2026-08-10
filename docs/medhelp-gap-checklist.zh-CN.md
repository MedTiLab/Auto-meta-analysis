# medhelp 补差异执行清单

## 背景与目标

这是 `medhelp` 相对 `/Users/gaoyuzhen/Downloads/dr-claw` 的补差异执行文档，用于按批次补齐当前仓库仍需持续修改的关键能力。

本轮目标是补齐高价值差异，不做整仓硬合并，不恢复已明确下线的主模块，也不扩张当前产品边界。

## 决策基线

- [x] 产品命名统一为 `MedAutoData / medautodata`
- [x] `medhelp` 仅保留为当前仓库目录名，不再作为产品名对外展示
- [x] 执行优先级以 `P0 / P1` 为主，`P2` 只做验证与文档回归
- [x] 兼容策略采用“新路径为默认，旧路径可读取并迁移”的平滑迁移方案
- [x] 仅保留 `dr-claw` 中高价值 UI 对齐能力
- [x] 不恢复 `memory`、`community-tools`、`AutoResearchHub`
- [x] 现有后端主接口保持为 `/api/med-library`、`/api/concepts`、`/api/monitor`
- [x] 桌面入口继续以 `desktop/*` 为正式实现路径
- [x] 执行时避开当前工作树中的新闻页相关未提交改动

## Batch 1 `P0`

- [x] 统一用户可见产品命名为 `MedAutoData / medautodata`
- [x] 清理用户可见的 `medhelp`、`dr-claw` 文案、CLI 提示、状态文案、SLURM 示例名、`User-Agent`
- [x] 更新项目模板提示词，统一为当前医学研究工作流，不再出现 `medhelp Research Lab project`
- [x] 工作区根目录解析规则调整为“配置 > 环境变量 > 新默认根目录”，默认新路径为 `~/medautodata`
- [x] 保留对 `~/dr-claw`、`~/vibelab`、旧 runtime key 的兼容读取
- [x] 补齐桌面壳运行时能力：单实例锁、启动日志、窗口状态持久化、端口等待与健康检查、共享数据路径迁移、优雅退出
- [x] 保持现有后端主路由为 `/api/med-library`、`/api/concepts`、`/api/monitor`

## Batch 2 `P1`

- [x] 在聊天输入区补回 Codex reasoning effort 控件
- [x] 在聊天输入区补回 Gemini thinking mode 控件
- [x] 同步 `shared` 层模型能力判断逻辑，确保控件只在支持的模型上显示
- [x] 聊天前端状态扩展为支持 `codexReasoningEffort` 与 `geminiThinkingMode`
- [x] 保持现有 Claude `thinkingMode` 行为不变
- [x] 后端发送链路补齐 Codex `modelReasoningEffort` 透传
- [x] 后端发送链路补齐 Gemini `thinkingMode` 设置生成
- [x] 恢复技能库“发送到聊天”的快捷能力
- [x] 沿用当前 `MainContent` 结构，不恢复独立 `AutoResearchHub`
- [x] 桌面侧未额外扩张新的前端 API 面

## Batch 3 `P2`

- [x] `README.md` 与 `README.zh-CN.md` 统一到 `MedAutoData` 产品名
- [x] README 补充桌面启动方式与兼容策略说明
- [x] 补充 runtime / 模型能力相关回归测试
- [x] 对新增迁移逻辑、聊天模型控制支持做最小验证
- [x] 执行 `npm run typecheck`
- [x] 执行 `npm run test`
- [x] 保持 Deferred 项不扩 scope

## Deferred

- [x] 本轮不恢复 `memory` 主模块
- [x] 如需记忆能力，仅保留 `Settings` 下的轻量用户偏好记忆，不恢复旧版独立 `memory` 模块
- [x] 本轮不恢复 `community-tools` 主模块
- [x] 本轮不恢复独立 `AutoResearchHub`
- [x] 本轮不追求与 `dr-claw` 的全量功能对齐
