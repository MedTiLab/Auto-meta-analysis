# Auto Research 吸纳任务列表

更新时间：2026-04-04

这份任务列表是把 `AutoResearchClaw` 吸纳路线图拆成可以逐步落地的实现项。原则是先补执行语义，再补细粒度阶段，不抢着重写整套自动研究系统。

## 第一批：先让自动研究真正可启动、可判断、可恢复

- [x] 建立实现任务列表，固定优先级和验收顺序
- [x] 为 `auto-research` 增加启动前 `preflight`
- [x] 将 `auto-research` 的流水线状态读取抽成独立模块
- [x] 在 `.pipeline/runs/<run-id>/` 下持久化首版 `preflight-report.json`
- [x] 在 `.pipeline/runs/<run-id>/` 下持久化首版 `run.json`
- [ ] 设计五阶段状态机文档
- [x] 设计五阶段契约文档
- [x] 把状态机真正接入 `auto-research` 执行过程
- [x] 把五阶段契约接入 `preflight`、`status` 与运行时校验

第一批验收：

- 启动前能明确告诉用户为什么不能跑
- 启动成功时能留下结构化运行记录
- 运行中断后，后续实现可以基于运行目录继续补 resume

## 第二批：补齐运行时语义

- [x] 给每个 run 增加 `checkpoint.json`
- [x] 给每个 run 增加 `heartbeat.json`
- [x] 给每个 run 增加 `stage-summary.json`
- [x] 给每个 run 增加 `events.jsonl`
- [x] 将当前任务推进过程写入运行事件
- [x] 将失败信息结构化写入运行目录
- [x] 为 `status` 接口增加运行目录摘要输出
- [x] 基于 `checkpoint.json` 支持同一 run 的 resume

第二批验收：

- 能知道当前 run 跑到哪一阶段
- 能从磁盘而不是日志推断运行状态
- 能为后续 resume / audit / UI 可视化提供稳定输入

## 第三批：补齐质量和安全边界

- [ ] 为 `publication` 增加引用真实性验证
- [ ] 为 `publication` 增加内容模板化 / 占位文本检测
- [ ] 为抓取入口增加 SSRF 与 URL policy 检查
- [ ] 将现有 `permissionMode` 映射为更细的 fetch / download / execute policy
- [ ] 给 preflight 增加更多 provider 与环境健康检查

第三批验收：

- 输出稿件时能识别明显假引用和未完成内容
- 网络抓取和执行入口有明确边界
- 自动研究从“能跑”升级为“更可信地跑”

## 暂不做

- [ ] 不照搬 23 段状态机
- [ ] 不把目录改成 `stage-01` 这类编号结构
- [ ] 不把整套 Python runtime 嵌入 Node 主流程
- [ ] 不追求一次性做成全自动论文代理
