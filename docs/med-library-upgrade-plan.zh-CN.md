# 研究资料库升级设计方案

更新时间：2026-04-10

## 0. 2026-04-10 调整方向

结合当前产品目标，这一页的主叙事需要从“文献导入 / 概念提取中心”调整为“研究系统知识中心”。

新的优先级建议如下：

1. `数据库目录`
   - 作为本项目最强亮点，继续放在第一位。
   - 负责回答“有哪些数据库、官网入口、本地路径和数据特性”。

2. `项目项目经验`
   - 允许把每次调研报告、阶段总结、分析草稿主动加入数据知识库。
   - 负责回答“过去做过什么、有哪些可复用材料”。

3. `对话记忆 / 长期基因`
   - 重点承接错误经验、纠错规则、方法提醒、以后不要再犯的坑。
   - 底层可直接复用现有 `research_lessons.json/.md` 机制，而不是重新发明一套概念抽取系统。

4. `参考资料`
   - 参考文献仍然算一种知识来源，但不再作为这一页的主叙事。
   - “文献提取候选概念”不再作为首页中心能力展示。

因此，这个页面后续应更像“项目长期记忆与系统知识库”，而不是“文献概念抽取台”。

## 1. 背景与问题

当前项目已经具备 4 类相关能力，但彼此仍然偏分散：

- `资料库页`：主要展示数据库官网入口与常见指标/疾病示例，偏静态。
- `文献库`：已支持 Zotero / BibTeX 导入，并能把文献关联到项目。
- `项目知识库`：已支持将文献、报告、上传材料、文献动态写入 `.pipeline/docs/kb/manifest.json`。
- `文献动态`：已支持从 PubMed / Europe PMC / medRxiv / arXiv 抓取新文献，并把单篇条目导入知识库与文献库。

这套能力已经接近“研究证据工作台”的雏形，但还缺 3 个关键环节：

- 缺少“概念层”：现在能存论文，不能稳定沉淀“新指标 / 新疾病 / 新分层”。
- 缺少“证据层”：现在文献和概念之间没有正式的结构化证据绑定。
- 缺少“审核层”：文献动态和自动抽取结果没有 candidate -> review -> stable 的过渡机制。

结果是：系统更像“文献和数据库入口集合”，还不是“可持续生长的研究知识库”。

## 2. 设计目标

本次升级的目标不是重做一个庞大的知识图谱系统，而是在当前 `Vite + Express + SQLite + 本地项目工作区` 架构上，做一个可逐步演进的本地优先版本。

目标能力：

- 让 `资料库` 从静态目录升级为“研究入口 + 文献沉淀 + 概念沉淀 + 动态发现”的统一入口。
- 让 Zotero 成为正式的文献导入主入口之一，而不是独立的小工具。
- 让文献动态不只是“看新闻”，而是可以持续发现并沉淀 `新指标 / 新疾病 / 新分层`。
- 让所有新发现都带有可追溯证据，且必须经过审核。
- 保持本地可运行、可解释、可回滚，不一开始引入向量库或复杂图数据库。

非目标：

- 不在第一阶段引入 Milvus / Neo4j / Elasticsearch。
- 不在第一阶段追求完全自动的高可信知识抽取。
- 不在第一阶段建设完整医学本体系统。

## 3. 总体设计

### 3.1 从“资料库”升级为 5 层结构

系统分为 5 层：

1. 数据源层
   - 管理 NHANES、UKB、CHARLS 等真实数据库与调查资源。
   - 保持“数据库目录”的价值：官方入口、本地镜像路径、申请说明、数据特点。

2. 文献层
   - 统一承接 Zotero、BibTeX、文献动态导入等来源。
   - 继续以 `references_library` 为主表，但补齐跨来源去重和状态字段。

3. 概念层
   - 把“新指标 / 新疾病 / 新分层 / 风险评分 / 结局指标”变成正式实体，而不是文本片段。

4. 证据层
   - 记录某个概念来自哪篇论文、哪段摘要/原文、证据强弱如何、是否已审核。

5. 监测层
   - 定期从文献动态中发现候选概念，进入审核队列，再决定是否纳入正式知识库。

### 3.2 前端信息架构

`资料库` 页从单页静态展示改为“数据知识库”，分为 6 个主区块：

- 研究中心概览
- 数据库目录
- 自动监测中心
- 项目文献库
- 指标库
- 疾病与分层图谱
- 待审核新增

推荐的导航关系：

- `资料库`：全局研究资源入口与知识沉淀中心
- `文献动态`：新文献发现入口
- `Research Lab`：围绕具体项目做问题定义、知识库建设和深度研究
- `Project References`：具体项目下的文献操作面板

这意味着 `资料库` 页不再只是“数据库列表”，而是负责回答 4 个问题：

- 我有哪些数据库可用？
- 我已经沉淀了哪些文献？
- 我已经沉淀了哪些指标/疾病/分层？
- 自动监测当前抓取了哪些高价值新文献？
- 最近新增了什么候选发现，还没审核？

## 4. 数据模型设计

### 4.1 现有表保留

保留并继续使用：

- `references_library`
- `project_references`
- `reference_tags`

保留现有本地工件与知识库索引：

- `Survey/references/...`
- `.pipeline/docs/kb/manifest.json`
- `.pipeline/docs/kb/news/...`

### 4.2 新增核心表

#### A. `clinical_concepts`

用于统一表示指标、疾病、分层、风险评分等概念。

建议字段：

- `id`
- `user_id`
- `concept_type`
  - `indicator`
  - `disease`
  - `subtype`
  - `stratifier`
  - `risk_score`
  - `outcome`
- `canonical_name`
- `display_name`
- `aliases_json`
- `description`
- `ontology_source`
- `ontology_id`
- `status`
  - `candidate`
  - `reviewed`
  - `stable`
  - `rejected`
- `source_strategy`
  - `manual`
  - `zotero_note`
  - `news_monitor`
  - `llm_extraction`
- `first_seen_at`
- `last_seen_at`
- `created_at`
- `updated_at`

说明：

- 第一阶段不要拆太细，先做一个统一概念表。
- 真正特殊的字段后续可通过扩展表或 `metadata_json` 增加。

#### B. `concept_evidence`

用于记录“某个概念为什么存在”。

建议字段：

- `id`
- `concept_id`
- `reference_id`
- `project_id` 可空
- `evidence_type`
  - `abstract_claim`
  - `fulltext_claim`
  - `manual_note`
  - `review_summary`
- `evidence_text`
- `evidence_location`
  - 例如 `abstract`、`results`、`table_2`
- `direction`
  - `supporting`
  - `contradicting`
  - `neutral`
- `evidence_level`
  - `low`
  - `moderate`
  - `high`
- `extraction_confidence`
- `review_status`
  - `pending`
  - `accepted`
  - `rejected`
- `review_note`
- `created_at`
- `updated_at`

#### C. `concept_relations`

用于表达概念之间的结构化关系。

建议字段：

- `id`
- `subject_concept_id`
- `relation_type`
  - `associated_with`
  - `predicts`
  - `subtype_of`
  - `measured_by`
  - `used_for_stratification`
  - `risk_factor_for`
- `object_concept_id`
- `evidence_count`
- `status`
- `created_at`
- `updated_at`

#### D. `monitor_runs`

记录一次文献动态抓取和概念抽取运行。

建议字段：

- `id`
- `user_id`
- `source`
- `query_profile`
- `started_at`
- `finished_at`
- `status`
- `total_items`
- `new_references`
- `new_candidates`
- `log_path`

#### E. `monitor_candidates`

记录尚未进入正式知识库的候选发现。

建议字段：

- `id`
- `user_id`
- `run_id`
- `reference_id`
- `candidate_type`
- `normalized_name`
- `raw_label`
- `summary`
- `rationale`
- `confidence`
- `status`
  - `pending`
  - `accepted`
  - `rejected`
  - `merged`
- `merged_concept_id`
- `created_at`
- `updated_at`

### 4.3 推荐的第二阶段扩展表

如果第一阶段跑通，再考虑增加：

- `concept_profiles`
  - 用于沉淀指标的定义、公式、单位、阈值、适用人群
- `concept_ontology_mappings`
  - 支持 ICD、MeSH、SNOMED、LOINC、HPO 等映射
- `project_concept_links`
  - 记录某项目当前重点关注哪些概念

## 5. 核心流程设计

### 5.1 Zotero 文献导入流程

目标：

- 让 Zotero 成为正式文献输入渠道。

流程：

1. 用户在 `References` 中选择 Zotero collection / items。
2. 条目导入 `references_library`。
3. 若关联到项目，则同步到 `project_references`。
4. 同时生成项目本地 reference artifact。
5. 后续人工或自动抽取时，直接以 `reference_id` 为锚点写入 `concept_evidence`。

设计要求：

- 加入跨来源去重策略。
- 对 Zotero 条目保留 `source_id`，但系统内部要优先使用统一 canonical reference identity。

### 5.2 文献动态吸纳流程

目标：

- 让“文献动态”变成资料库增长引擎。

流程：

1. 定期抓取 PubMed / Europe PMC / medRxiv / arXiv。
2. 新条目先进入 `references_library`，来源标记为 `news_monitor`。
3. 对新增文献做概念抽取，生成 `monitor_candidates`。
4. 用户在“待审核新增”里审核候选项。
5. 审核通过后：
   - 写入 `clinical_concepts`
   - 写入 `concept_evidence`
   - 必要时创建 `concept_relations`

设计要求：

- 自动抽取只产生候选，不直接入正式概念库。
- 候选项必须能回溯到具体文献。

### 5.3 概念沉淀流程

概念沉淀支持 3 个入口：

- 手工新建
- 从文献详情页“提取为概念”
- 从候选审核队列“接受并合并”

沉淀时需要支持两种动作：

- 新建概念
- 合并到已有概念

因此审核界面要支持：

- 直接接受为新概念
- 搜索并合并到已有概念
- 拒绝

### 5.4 项目使用流程

项目层面要能够：

- 查看本项目关联的文献
- 查看本项目重点概念
- 基于概念生成研究问题或分层方案
- 从概念反向追踪证据文献

也就是说，项目不是直接绑定“数据库列表”，而是绑定“问题相关的文献与概念集合”。

## 6. UI 设计建议

### 6.1 资料库主页

第一屏展示 4 个 summary card：

- 数据库数
- 文献数
- 已稳定概念数
- 待审核候选数

第二屏展示 4 个入口：

- 数据库目录
- 文献库
- 指标与评分
- 疾病与分层

第三屏展示：

- 最近新增概念
- 最近新增候选
- 最近导入的 Zotero 文献

### 6.2 指标库页

至少支持以下维度：

- 指标名
- 类型
- 别名
- 应用疾病
- 常见阈值
- 证据数
- 最近更新时间

### 6.3 疾病与分层页

至少支持以下维度：

- 疾病/亚型名
- 分层因子
- 关联指标
- 证据数
- 状态

### 6.4 待审核新增页

每条 candidate 至少显示：

- 候选名称
- 类型
- 来源文献
- 摘要理由
- 抽取置信度
- 操作按钮：接受 / 合并 / 拒绝

## 7. API 设计建议

第一阶段新增 API：

- `GET /api/med-library/overview`
- `GET /api/concepts`
- `POST /api/concepts`
- `GET /api/concepts/:id`
- `POST /api/concepts/:id/evidence`
- `GET /api/monitor/candidates`
- `POST /api/monitor/candidates/:id/accept`
- `POST /api/monitor/candidates/:id/reject`

第二阶段再补：

- `GET /api/concepts/search`
- `POST /api/monitor/extract`
- `GET /api/projects/:projectName/concepts`

## 8. 检索设计

第一阶段检索策略：

- SQLite 常规筛选 + `LIKE`
- 对 `clinical_concepts.canonical_name`、`display_name`、`aliases_json` 建索引
- 对 `references_library.title`、`doi`、`citation_key` 继续复用现有检索

可选增强：

- 第二阶段再加 SQLite FTS5
- 第三阶段再考虑向量检索

## 9. 审核与可信度设计

必须坚持：

- 文献是证据来源，不是知识本身。
- 自动抽取不直接写正式库。
- 所有正式概念都要能反查证据。

建议状态流：

- `candidate`
- `reviewed`
- `stable`
- `rejected`

建议审核原则：

- 来自单篇论文、证据弱、命名不稳定的概念，不直接升为 `stable`
- 仅当已有多条证据，或经过人工确认，才升为 `stable`

## 10. 分期实施计划

### Phase 1：把资料库从静态页升级为研究入口

目标：

- 不先做复杂抽取，先把信息架构改对。

内容：

- 改造 `资料库` 首页为数据知识库
- 接入文献库概览和文献动态概览
- 增加 overview API
- 把“静态指标/疾病示例”转成“示例 + 正式概念区占位”

验收：

- 用户一进入资料库，就能看到数据库、文献、概念、候选的全局概览

### Phase 2：补齐概念层最小数据模型

目标：

- 能正式沉淀概念及证据。

内容：

- SQLite migration：新增 `clinical_concepts`、`concept_evidence`
- 新增概念 CRUD API
- 前端增加“指标库 / 疾病与分层”基础列表页

验收：

- 用户可手工创建概念，并把某篇文献挂为证据

### Phase 3：接入文献动态候选池

目标：

- 文献动态开始推动知识库增长。

内容：

- 新增 `monitor_runs`、`monitor_candidates`
- 文献动态入库后生成候选概念
- 增加“待审核新增”页面

验收：

- 文献动态新增论文后，能在候选池中看到新指标/新疾病/新分层

### Phase 3.5：补齐自动监测调度器

目标：

- 让文献动态不再只靠手动搜索，而是按设定频率自动发现并沉淀新论文。

内容：

- 增加 PubMed / medRxiv 定时抓取调度器
- 增加“最近运行 / 下次运行 / 最近入库数”的监测状态持久化
- 把自动抓取结果直接接到 `references_library` 与 `monitor_candidates`
- 在 `数据知识库` 中增加“自动监测中心”概览与手动触发入口

验收：

- 用户保存调度设置后，系统能按频率自动抓取新文献
- 新文献会跳过已入库条目，只把未见过的论文继续送入候选池
- 用户能在数据知识库直接看到最近抓取命中与最近入库情况

### Phase 4：增强审核与项目联动

目标：

- 概念真正参与项目研究过程。

内容：

- candidate 接受 / 合并 / 拒绝
- 项目查看重点概念
- 从概念回跳到文献与本地工件

验收：

- 项目中能围绕概念组织证据，而不仅仅围绕文献列表

## 11. 推荐的第一批实际修改点

第一批建议只做低风险、收益立刻可见的内容：

1. 新增设计文档并固定分期边界
2. 新增 `med-library overview` 服务端聚合接口
3. 改造 `MedicalLibraryDashboard` 为“数据知识库”首页
4. 为后续概念层预留 UI 区块和空状态

先不做的内容：

- 不急着做自动 LLM 抽取
- 不急着做本体映射
- 不急着做关系图谱可视化

## 12. 本方案与现有代码的衔接点

直接复用：

- `src/components/med-library-dashboard/view/MedicalLibraryDashboard.tsx`
- `src/components/references/...`
- `server/routes/references.js`
- `server/utils/project-reference-aggregate.js`
- `server/utils/project-knowledge-base.js`
- `server/routes/news.js`
- `server/routes/taskmaster.js` 中现有的新闻条目入知识库/文献库逻辑

需要新建：

- `server/routes/med-library.js`
- `server/routes/concepts.js`
- `server/database` 中相关 migration
- `src/components/med-library-dashboard` 下的概览卡片与后续子视图

## 13. 决策摘要

本次升级的核心不是“再加几个数据库入口”，而是把系统从：

- `数据库目录 + 文献导入工具 + 文献动态`

升级为：

- `数据库目录 + 文献证据库 + 概念库 + 候选审核池 + 项目研究联动`

最重要的设计决策有 3 个：

- 先做统一概念表，不一开始过度拆表
- 先做候选审核池，不让自动抽取直接入正式库
- 先做本地 SQLite + manifest + 项目工件联动，不急着上重型基础设施
