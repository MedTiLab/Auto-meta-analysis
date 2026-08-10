# MedAutoData 架构改造方案：工件中心硬骨架 + 两层活体追踪

更新时间：2026-05-30
状态：设计草案（待评审）
作者：brainstorming 协作产出

参考对象：`https://cat.network-meta-analysis.com/`（Cancer Associated Thrombosis Living Interactive Systematic Review）

---

## 0. 已确认的方向（本方案的前提）

| 维度 | 决策 |
| --- | --- |
| 应用定位 | **工作台 + 发布平台**：工作台做出综述，一键发布成参考站那样的活体交付站点 |
| 方法学重心 | **全覆盖**：系统综述(SR) / 配对Meta / 网络Meta(NMA) / 诊断准确性(DTA) |
| 追踪模式 | **两层**：通用选题雷达 + 协议绑定的活体更新器 |
| 核心架构 | **A 工件中心硬骨架**：类型化+版本化工件存储为唯一真相源，FSM+校验器把守阶段，agent 降级为阶段内执行器 |

---

## 1. 诊断：为什么"agent 模式"效果不好、"追踪模式"很随意

### 1.1 参考站"更好"的本质

参考站不是一个 agent，而是一个**以方法学和交付物为骨架的固定框架**：

```
HOME → INTRODUCTION → PRISMA → TABLES → PAIRWISE META → NETWORK META → SUMMARY OF FINDINGS(GRADE) → EVIDENCE MAPS → PUBLICATIONS
```

它是"活体(Living)"的：新文献持续喂进这个**不变的框架**，红色区块标出"living update"。统计是明确的（forest、league table、SUCRA、DerSimonian-Laird / Sidik-Jonkman / REML、Hartung-Knapp）。框架是硬的，过程服从于交付物。

### 1.2 你当前的结构性问题（基于代码）

1. **两套并行、未统一的系统**
   - 通用 agent 状态机：`server/pipeline/state-machine.js` 的 `literature → ideation → experiment → publication → promotion`，只有 `publication` 有 `gateRequired: true`。
   - 结构化 meta 管线：`server/routes/meta-analysis.js` 的 search → screening → full-text → parse → extract → analysis → manuscript。
   - 两者各跑各的，工件不互通，agent 编排和结构化管线之间没有单一真相源。

2. **契约是"软"的**
   - `docs/pipeline-stage-contracts.md` 自述：当前只校验"目录/字段在不在"，**没有**引用真实性验证、占位文本检测、结果内容质量评分、断点回滚判定。
   - `server/services/meta-analysis/workflow-gates.js` 的门只管**人审与来源可信**（`isHumanReviewer`、`getHumanReviewedScreeningGate`、`isPdfHumanAudited`、`isParsedDocumentQualityReviewed`），**不管统计是否正确、结论是否站得住**。

3. **方法学覆盖不全**
   - extraction/analysis 目前只有 DTA（`extract/diagnostic`、`datasets/diagnostic`、`analysis/diagnostic/run`），`schemas/` 下只有 `diagnostic-extraction-schema.js`。配对 Meta、NMA 还没有端点和 schema。

4. **agent 是"编排者"而非"执行器"**
   - controller(`meta-analysis-workflow`) + specialists 的技能路由让 agent 自由决定做什么。自由度=不可复现="随意"。

5. **"追踪模式"只是一个文献新闻流**
   - `server/routes/news.js` + `src/components/news-dashboard/` 按关键词查 PubMed/EuropePMC/medRxiv/arXiv，`date_range_days: 30`。它**不绑定任何具体综述的协议**，不去重进语料库，不按锁定纳排筛选，不触发任何再分析。所以它永远只是"看到新文章"，而不是"维护一篇活体综述"。

### 1.3 结论

方向不是"换一个更聪明的 agent"，而是**把方法学管线变成硬骨架（类型化+版本化的工件 + 校验器），让 agent 退化为每个阶段契约内的受约束执行器**。追踪模式则要从"新闻流"升级为"协议绑定 + 去重 + 锁定纳排 + 触发再分析 + 变更对比"的活体更新框架——而这必须建在版本化工件之上。

---

## 2. 核心架构：工件中心硬骨架

四个构件。它们一起取代现在的"软契约 + 双系统"。

```
                ┌─────────────────────────────────────────────┐
   面板(UI) ──▶ │  校验工件槽 (validated artifact slot)         │
   agent  ──▶  │  —— 唯一写入口，写前必过 schema+validator     │ ──▶ ┌──────────────┐
   追踪更新器──▶ └─────────────────────────────────────────────┘      │ 工件存储      │
                                                                      │ (类型化/版本化)│
   方法学FSM ◀── 读阶段状态 ── 校验器 ── 读工件 ────────────────────▶ │ + 依赖DAG     │
                                                                      └──────────────┘
                                                                            │
                                                              发布渲染器 ◀──┘  (读 locked bundle)
```

### 2.1 工件存储（Artifact Store）——唯一真相源

每个工件是一条**类型化、版本化、可溯源**的记录：

```
Artifact {
  id            // 稳定标识
  projectId     // 归属综述
  type          // 见下方类型表
  version       // 单调递增；任何上游变更产生新版本
  schemaVersion // 该 type 的 schema 版本
  producedBy    // 'panel' | 'agent' | 'surveillance' | 'human'
  inputs        // [{artifactId, version}] —— 溯源链 / 依赖 DAG 的边
  contentHash   // 内容寻址，用于 diff 与去重
  payload       // 小型结构化数据（JSON，过 schema）
  blobRef       // 大型产物（PDF / R 输出 / 图）按 hash 落盘引用
  status        // 'draft' | 'validated' | 'locked' | 'stale'
  validation    // {passed, validatorId, errors[], overriddenBy?, justification?}
  createdAt / createdBy
}
```

**工件类型表（覆盖四种方法学）**

| 阶段 | 工件类型 |
| --- | --- |
| 协议 | `Protocol`(PICO+纳排谓词+预注册分析计划)、`SearchStrategy` |
| 检索 | `SearchRun`、`ReferenceSet`、`DedupReport` |
| 筛选 | `ScreeningDecisionSet`、`PrismaFlow` |
| 全文 | `FullTextAssetSet`、`ParsedDocumentSet` |
| 提取 | `ExtractionSet`、`EffectDataset`(配对/NMA/DTA 各一形态) |
| 偏倚 | `RoBAssessmentSet`(RoB2 / ROBINS-I / QUADAS-2) |
| 分析 | `AnalysisRun`、`HeterogeneityReport`、`NetworkGeometry`(NMA)、`InconsistencyReport`(NMA)、`SensitivityAnalysisSet` |
| 证据质量 | `GradeAssessment`(GRADE / GRADE-CERQual)、`SummaryOfFindings` |
| 交付 | `Manuscript`、`EvidenceMap`、`PublishedBundle` |

要点：
- **版本化 + 内容寻址** → 天然支持 diff 与"变了什么"。
- **inputs 字段构成依赖 DAG** → 任一上游产生新版本，下游自动标 `stale` → 触发重算。这是"活体更新"的物理基础。
- 大产物（PDF、R 图、netmeta 结果）落盘按 hash 引用，DB 只存结构化 payload。

> 落地不必另起炉灶：现有 `server/database/db.js`(SQLite) + 编号文件夹 + `.pipeline/` 已具雏形。把 `meta-analysis.js` 现有的 references/screening/parsed-documents/extractions/analysis-runs 逐步迁移成"工件记录"，加上 `version / inputs / contentHash / status / validation` 字段即可。

### 2.2 方法学 FSM + Profile

一个 **Profile** = 一种方法学的"硬管线定义"。综述在协议锁定时选定 Profile。

```
Profile (e.g. NMA) {
  stages: [protocol, search, screening, fulltext, extraction, rob, analysis, certainty, manuscript]
  perStage: {
    requiredInputs: [工件类型...]
    produces:       [工件类型...]
    validators:     [validatorId...]      // 硬门
    gate:           'auto' | 'human-required'
    executors:      ['panel','agent']     // 谁能写
  }
}
```

四个 Profile：`systematic-review`、`pairwise-meta`、`network-meta`、`diagnostic-test-accuracy`。差异集中在**提取 schema、统计方法、偏倚工具、证据质量工具**：

| Profile | 偏倚 | 统计引擎 | 证据质量 |
| --- | --- | --- | --- |
| SR（定性） | RoB2 / ROBINS-I | —（结构化综合） | GRADE / CERQual |
| 配对 Meta | RoB2 / ROBINS-I | R `metafor` | GRADE |
| NMA | RoB2 / ROBINS-I | R `netmeta`（频率派，出 league table + SUCRA）；可选 `gemtc`/`multinma` 贝叶斯 | GRADE（NMA 适配：CINeMA 风格） |
| DTA | QUADAS-2 | R `mada` / `meta`（双变量 / HSROC） | GRADE-DTA |

> **统计引擎默认频率派优先**（与参考站一致：netmeta 出 SUCRA/league，metafor 出 DL/SJ/REML + Hartung-Knapp），贝叶斯作为可选加挂。R 在 NMA Profile 下设为硬依赖，preflight 不满足直接拦。

FSM 取代/收编现状：meta 项目改走 Profile 驱动的 FSM；通用 `literature→…→promotion` 状态机只保留给**非 meta** 的研究项目，不再混用。

### 2.3 校验器（Validator）——把"随意"变成"过不了门"

校验器是**阻断式**的：工件写入时先过 schema，再过该阶段 validators，不过则 `status` 停在 `draft`，并返回**结构化错误码**给写入方（面板提示用户、agent 据此重试）。

**关键校验器清单（直接回应"分析太随意"）：**

- **Protocol**：PICO 完整；纳排标准是**机器可判的谓词**（供自动筛选复用）；**分析计划预注册**（效应量、模型 FE/RE + 估计量、计划的亚组/敏感性分析、异质性处理）。
- **Search**：≥2 个数据库（或协议指定数）；检索式可复现；有 `DedupReport`；PRISMA 识别数对得上。
- **Screening**：每条文献都有决策（reviewer + 理由）；双筛冲突有裁决记录；PRISMA 筛选数对得上。
- **Extraction**：每篇纳入研究都有提取；效应数据完整（events/total 或 mean/SD/n，DTA 为 TP/FP/FN/TN）；单位一致；**每个数字都能溯源到 `ParsedDocument` 的具体位置（page/table）** → 这一条直接封死"编数据"。
- **RoB**：每篇纳入研究用 Profile 指定的工具完成评估。
- **Analysis**（核心）：
  - 效应量与模型**必须等于预注册分析计划**，偏离需 override + 理由；
  - 必须报告 I² / τ²（异质性）；
  - NMA 额外要求：网络连通、传递性/不一致性已检验（node-splitting / design-by-treatment）、SUCRA 已算；
  - DTA 额外要求：双变量 / HSROC，报告合并敏感度/特异度 + SROC；
  - 预注册的敏感性分析**必须实际跑过**；
  - **没有底层 `EffectDataset` 行就不允许出现合并估计**（封死"凭空给个 OR"）。
- **Certainty**：每个"比较×结局"都有 GRADE 评级 + 五维降级理由（偏倚、不一致、间接、不精确、发表偏倚）；`SummaryOfFindings` 已生成。
- **Manuscript**：每个数字声明都引用某个工件；PRISMA 图与计数一致；**引用真实性校验**（DOI/PMID 真实存在）→ 封死幻觉参考文献。

> **人性化逃生门**：validators 支持 `override + justification`，记录到 `validation.overriddenBy`。不是无脑挡死，而是**任何绕过都留痕、可审计**，从"默默随意"变成"显式担责"。

### 2.4 agent 作为"阶段内执行器"

agent 不再编排全局。它被以**窄契约**按阶段调用：

```
ExecutorTask {
  stage, profile
  inputArtifacts   // 只读
  allowedSkills    // 该阶段白名单（复用现有 specialists）
  outputSchema     // 必须产出符合此 schema 的 draft 工件
  validators       // 产出后立即校验
}
```

agent 产出 `draft` 工件 → 立即校验 → 失败则拿结构化错误码**在本阶段内重试**，但**无权推进阶段**（只有校验通过 + gate 满足才推进）。这把"自由度=随意"压成"在契约内自动化"。现有 `server/routes/agent.js` + `claude-sdk.js` 改为按 `ExecutorTask` 调用即可。

---

## 3. Phase 0 — 工件骨架（地基，最高优先级）

**目标**：把"双系统 + 软契约"替换为"单一工件存储 + FSM + Profile + 校验器"。其它一切依赖它。

交付：
1. 工件存储 schema + 读写 API（带 version/inputs/contentHash/status/validation）。
2. 依赖 DAG：写入新版本时把下游标 `stale`。
3. 校验器框架（注册表 + 结构化错误码 + override 留痕）。把 `workflow-gates.js` 升级为 validator 注册表的一部分。
4. Profile 引擎 + FSM（先支持 1 个 Profile 走通，见 Phase 1）。
5. **迁移适配层**：`meta-analysis.js` 现有端点改为"通过工件槽写入"。增量迁移，不一次性重写。

退出判定：现有 DTA 链路（search→…→analysis）完整跑在新存储上，且每步产出都是带校验状态的工件。

---

## 4. Phase 1 — 证据类型模块（插在骨架上）

按价值顺序补 Profile：

1. **NMA Profile（先做，对标参考站）**：`network-meta` 提取 schema + `EffectDataset(NMA)` + `r-runner` 增加 `netmeta` 运行器（league table、SUCRA、network plot、node-splitting 不一致性）。
2. **配对 Meta Profile**：`metafor` 运行器（DL/SJ/REML、Hartung-Knapp、forest、funnel、Egger）。
3. **DTA Profile**：把现有 diagnostic 链路收编为标准 Profile（`mada` 双变量/HSROC、QUADAS-2、SROC）。
4. **SR（定性）Profile**：结构化综合 + GRADE-CERQual。

每个 Profile 都带：提取 schema（扩 `schemas/`）、偏倚工具、统计运行器（扩 `r-runner.js`）、证据质量生成器、对应校验器。

退出判定：至少 NMA + 配对两个 Profile 端到端可跑，输出 league/SUCRA/forest/SoF。

---

## 5. Phase 2 — 活体追踪框架（两层）⭐ 你最关心的部分

这是把"追踪模式"从新闻流升级为"活体综述维护引擎"的完整框架。

### 5.1 第 1 层：选题雷达（Discovery Radar）

定位：**不绑定具体综述**，帮你发现值得做的题目。在现有 `news-dashboard` 上升级：
- 查准/查全：用结构化检索式而非裸关键词；按 Profile 关注点（如"network meta-analysis"主题）加权。
- 去重 + 相关性排序：跨源去重（DOI/PMID/标题相似），LLM 相关性打分。
- 产出：候选选题卡（含初步 PICO 草案、已有综述检测——避免重复造轮子）。

雷达**不进入硬骨架**（它是探索性的），但它的产出可一键"立项"成一个新综述（带 Profile + 协议草案）。

### 5.2 第 2 层：协议绑定活体更新器（Living Updater）⭐ 核心

每个**在做/已发布**的综述都注册成一个"监测对象"，活体更新器是一台**周期性运行的状态机**：

```
scheduled
  → search        用 Protocol 里锁定的 SearchStrategy 在各源跑增量检索（自上次运行以来）
  → dedup         新命中对该综述已有语料库去重（已纳入/已排除/已见过）
  → auto-screen   按 Protocol 里"机器可判的纳排谓词" + LLM 分类做初筛
                    · 高置信 include/exclude → 自动决策（reviewer='agent'，留痕）
                    · 边界 → 进"待人工确认队列"（复用 workflow-gates 的 human reviewer 区分）
  → triage        人确认边界条目（可批量）
  → integrate     新纳入研究 → ReferenceSet 产生新 version（DAG 边）
  → cascade       依赖 DAG 把 Extraction/Analysis/GRADE/SoF/PRISMA 标 stale
  → re-run        受影响阶段按 Profile 重算（自动跑 netmeta/metafor 等）
  → diff          产出 ChangeSet（见下）
  → publish/notify 更新发布站点的"living update"高亮 + 通知
```

**协议注册表（Protocol Registry）**：每个监测对象存
- 锁定的 `SearchStrategy`（可复现、可增量）；
- 机器可判的纳排谓词（来自 Protocol 校验器要求的那套）；
- 预注册分析计划（重算时照此跑，不临场发挥——治"随意"）；
- 监测频率（日/周/月）与下次运行时间。

**ChangeSet / 证据 diff（对标参考站的红色 living update）**：每轮产出结构化"变了什么"：
- 新增/新纳入研究列表；
- 每个"比较×结局"的合并估计**旧值 vs 新值**（含 CI、I² 变化）；
- NMA 的 SUCRA 排序变化；
- GRADE 证据等级变化；
- **结论是否改变**（方向/显著性翻转的高亮预警）。

**调度**：复用现有 scheduled-tasks / cron 基础设施做周期触发；每个监测对象独立排期。

**这一层为什么治"随意"**：重算严格按"预注册分析计划"跑，受 Analysis 校验器约束；新数据进出都走工件版本 + 溯源；任何自动决策都标 `reviewer='agent'` 可回溯。整条链路可复现、可审计、可回滚（DAG + 版本）。

退出判定：选定一个 NMA 综述，注册协议 → 定时跑 → 自动发现并初筛新研究 → 触发 netmeta 重算 → 生成 ChangeSet → 在界面看到"本次新增 2 篇、A vs B 的 OR 从 0.74 变 0.69、SUCRA 排名 B 升到第一、结论未翻转"。

---

## 6. Phase 3 — 发布平台

把任意综述锁定为不可变的 `PublishedBundle`（工件快照），渲染成参考站那样的只读交互微站点：

```
HOME · INTRODUCTION · PRISMA · TABLES · PAIRWISE · NETWORK META · SUMMARY OF FINDINGS · EVIDENCE MAP · PUBLICATIONS
```

- 复用现有 React/Vite；新增只读"活体综述"视图模式（公开路由或静态导出）。
- "Living" 徽章 + 由历轮 ChangeSet 汇成的更新日志；最新一轮变更用红色高亮（参考站同款）。
- 交互：结局下拉、参照治疗选择、league/SUCRA、可点的证据地图（按 GRADE 着色）。

退出判定：一个 NMA 综述能一键发布成可浏览站点，且活体更新器的 ChangeSet 能反映为站点上的高亮更新。

---

## 7. 落地路线图

| 里程碑 | 范围 | 退出判定 |
| --- | --- | --- |
| **M0** | Phase 0 工件存储 + DAG + 校验器框架 + DTA 链路迁移上骨架 | 现有 DTA 链路跑在新存储，每步产出带校验状态 |
| **M1** | Phase 1：NMA + 配对 Profile（netmeta/metafor），DTA 收编为标准 Profile | 两个 Profile 端到端出 league/SUCRA/forest/SoF |
| **M2** | Phase 2 第 1 层：雷达升级 | 结构化检索 + 去重 + 相关性排序 + 一键立项 |
| **M3** | Phase 2 第 2 层：NMA 活体更新器 + ChangeSet | 见 §5.2 退出判定 |
| **M4** | Phase 3：发布渲染器 | 见 §6 退出判定 |
| **M5** | 扩展：DTA/SR Profile 补全、GRADE-CERQual、打磨 | 四个 Profile 全可用 |

依赖关系：M0 是所有的前提；M3 依赖 M0(版本/DAG) + M1(可重算的 Profile)；M4 依赖工件 bundle。**建议严格按 M0→M1→M3 推进**（你最在意的追踪在 M3，但它必须站在 M0/M1 上，否则又会"随意"）。

---

## 8. 风险与权衡

1. **迁移风险**：现有端点/面板需改为经工件槽写入。对策：加适配层，按阶段增量迁移，不一次性重写。
2. **校验严格度 vs 可用性**：太死会挡住正常工作。对策：override + justification 留痕机制（§2.3）。
3. **统计引擎依赖**：NMA 需 R `netmeta`/`metafor`/`mada`，Python 兜底对 NMA 不足。对策：NMA Profile 把 R 设硬依赖，preflight 拦截。
4. **agent 可靠性**：窄契约降方差但增编排代码。对策：先在 1 个 Profile 上验证执行器契约，再推广。
5. **自动筛选误判**：活体更新器自动 include/exclude 有风险。对策：只自动处理高置信，边界一律进人工队列；全部留 `reviewer` 痕迹。

---

## 9. 与现有代码的映射（落地锚点）

| 现有 | 改造方向 |
| --- | --- |
| `server/pipeline/{state-machine,contracts,state,run-tracker,resume}.js` | 演进为 FSM + 依赖 DAG + 校验器引擎；通用 auto-research FSM 仅留给非 meta 项目 |
| `server/services/meta-analysis/workflow-gates.js` | 并入校验器注册表，从"人审门"扩到"统计/方法学门" |
| `server/services/meta-analysis/schemas/`（仅 DTA） | 补齐全部工件类型 schema（含配对/NMA/RoB/GRADE/SoF） |
| `server/routes/meta-analysis.js` | 端点改为经工件槽写入；新增配对/NMA 分析端点 |
| `server/services/meta-analysis/r-runner.js` | 增 `netmeta`/`metafor`/`mada` 运行器 |
| `src/components/meta-analysis/view/*Panel.tsx` | 面板改为"工件槽编辑器"，读取并展示校验状态 |
| `server/routes/news.js` + `src/components/news-dashboard/` | Phase 2 第 1 层（雷达） |
| 新增 `server/services/surveillance/` + 协议注册表 | Phase 2 第 2 层（活体更新器）；复用 scheduled-tasks 调度 |
| `server/routes/agent.js` + `server/claude-sdk.js` | 改为按 `ExecutorTask` 窄契约调用 |
| 新增 发布渲染器 + 只读视图路由 | Phase 3 |

---

## 10. 一句话总结

把**方法学和交付物**变成不可绕过的硬骨架（类型化+版本化工件 + 阶段校验器），让 agent 退到每个阶段契约里当执行器；把"追踪"从看新闻升级为"协议绑定 + 去重 + 锁定纳排 + 预注册重算 + 变更对比"的活体引擎——这同时解决了"分析随意"（校验器）、"活体更新"（版本化工件 + DAG）、"对外发布"（bundle 渲染）三件事，正好命中参考站做对的三点。
