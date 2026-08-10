import { useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BookOpenCheck,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileText,
  HelpCircle,
  Microscope,
  Network,
  Scale,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Table2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

type GuideStep = {
  title: string;
  body: string;
  checks: string[];
};

type MethodItem = {
  title: string;
  bestFor: string;
  methods: string;
  cautions: string;
};

type ToolItem = {
  title: string;
  use: string;
  note: string;
};

type SourceItem = {
  name: string;
  url: string;
  note: string;
};

type Copy = {
  title: string;
  subtitle: string;
  updated: string;
  coreWarning: string;
  quickTitle: string;
  quickItems: string[];
  workflowTitle: string;
  workflowSubtitle: string;
  steps: GuideStep[];
  methodsTitle: string;
  methodsSubtitle: string;
  methods: MethodItem[];
  statsTitle: string;
  statsSubtitle: string;
  statsBlocks: Array<{ title: string; items: string[] }>;
  toolsTitle: string;
  toolsSubtitle: string;
  tools: ToolItem[];
  limitsTitle: string;
  limitsSubtitle: string;
  limits: string[];
  deliverablesTitle: string;
  deliverables: string[];
  sourcesTitle: string;
  sourcesIntro: string;
  sources: SourceItem[];
};

const zhCopy: Copy = {
  title: 'Meta 分析帮助',
  subtitle: '从选题、方案注册、检索、筛选、提取、偏倚评价、统计合成到 PRISMA 报告的首版方法学指南。',
  updated: '初始版依据 2026-05-24 可访问的公开指南整理，后续可继续补充专科模板、软件代码和案例。',
  coreWarning: '先判断能不能合并，再决定怎么合并。Meta 分析不是把所有研究放进森林图；如果问题、PICO、结局定义、研究设计、偏倚风险或效应量不可比，应先做结构化叙述或分层呈现。',
  quickTitle: '开始前先核对',
  quickItems: [
    '研究问题是否明确：PICO、PECO、PIRD 或 PICOTS 已经写成可执行纳排标准。',
    '方案是否预注册：PROSPERO、OSF 或期刊 protocol，记录主要结局、效应量、亚组和敏感性分析。',
    '检索是否可复现：数据库、日期、检索式、灰色文献、注册库、引用追踪和去重规则都应保存。',
    '筛选和提取是否双人独立：分歧解决、校准样本、排除理由和版本记录需要留痕。',
    '合成前是否评估可比性：临床异质性、方法学异质性、统计异质性都要先解释。',
    '结论是否跟证据确定性匹配：不要只看 P 值，必须同时看效应大小、置信区间、偏倚、异质性和 GRADE。',
  ],
  workflowTitle: '完整流程',
  workflowSubtitle: '适合新用户照着推进，也适合作为团队质控清单。',
  steps: [
    {
      title: '定义研究问题',
      body: '把临床或科研问题转成结构化问题。干预类常用 PICO，暴露/预后类常用 PECO，诊断准确性常用 PIRD 或 PICOTS。',
      checks: ['人群、干预/暴露/指标、对照、结局、时间窗、场景', '主要结局和次要结局分开', '提前定义最小重要差异或临床解释阈值'],
    },
    {
      title: '写方案并注册',
      body: '方案应先于正式筛选和提取完成，写清楚研究类型、纳排标准、检索源、提取字段、偏倚工具、统计计划和偏离方案的记录方式。',
      checks: ['PROSPERO/OSF/期刊 protocol', '记录版本和修改原因', '预先定义亚组、敏感性分析和缺失数据处理'],
    },
    {
      title: '设计检索策略',
      body: '同时使用主题词和自由词，覆盖核心数据库、试验注册库、灰色文献、参考文献追踪和必要的手工检索。检索应优先敏感，后续用筛选控制精确度。',
      checks: ['至少保存每个库的完整检索式', '注明检索日期和平台', '避免无理由的语言、日期和文献类型限制'],
    },
    {
      title: '管理记录和去重',
      body: '把报告和研究区分开。一个研究可能有多篇论文、摘要、注册记录或补充材料，不能把同一研究重复纳入。',
      checks: ['保留原始检索结果和去重后结果', '链接同一研究的多个报告', '为 PRISMA 流程图记录每一步数量'],
    },
    {
      title: '题录和全文筛选',
      body: '建议双人独立筛选，先用小样本校准纳排理解，再进入正式筛选。全文排除理由应足够具体，方便审稿和复现。',
      checks: ['题录筛选、全文筛选分阶段记录', '每篇全文给出唯一主要排除理由', '冲突由第三人或共识会议解决'],
    },
    {
      title: '提取数据',
      body: '围绕计划分析建立提取表。除研究特征和结果数据外，还要提取研究设计、样本流、失访、协变量、测量时间点、资金和利益冲突。',
      checks: ['提取可直接进入模型的效应量或原始数据', '记录转换公式和假设', '联系作者或从图表数字化时要留痕'],
    },
    {
      title: '评价偏倚风险',
      body: '按研究设计选择工具，并尽量按结局评价。RCT 可用 RoB 2，非随机干预研究可用 ROBINS-I，诊断准确性研究优先看 QUADAS-3/QUADAS-2，系统综述再评价可用 ROBIS 或 AMSTAR 2。',
      checks: ['不要用总分替代领域判断', '区分风险偏倚、报告质量和适用性', '把偏倚判断纳入解释、亚组或敏感性分析'],
    },
    {
      title: '选择效应量',
      body: '二分类结局常用 RR、OR、RD；连续结局常用 MD 或 SMD；生存结局常用 HR；诊断准确性常用敏感度、特异度、似然比、DOR 和 SROC 相关模型。',
      checks: ['效应方向统一', '单位和量表统一', '同一结局多个时间点或多个指标要预先选择规则'],
    },
    {
      title: '判断能否合成',
      body: '合成前先看研究是否在问题、干预、对照、结局、设计和风险偏倚上足够可比。不能合理合并时，不要强行给总体效应。',
      checks: ['临床异质性是否可解释', '方法学差异是否会改变效应', '数据结构是否支持计划模型'],
    },
    {
      title: '统计合成和异质性处理',
      body: '根据问题选择固定效应、随机效应、Mantel-Haenszel、逆方差、Peto、GLMM、贝叶斯模型、诊断 bivariate/HSROC、网络 Meta 或 IPD Meta。',
      checks: ['报告 I2、tau2、Q 检验和预测区间的适用场景', '少量研究时谨慎解释异质性和漏斗图', '预先定义亚组和 meta 回归变量'],
    },
    {
      title: '稳健性、发表偏倚和确定性',
      body: '用敏感性分析检验关键假设，用小样本效应和缺失结果框架评估报告偏倚，用 GRADE 评价每个关键结局的证据确定性。',
      checks: ['排除高偏倚风险研究后的结果', '不同效应量、模型和零事件处理的影响', '把不一致、不精确、间接性和发表偏倚写入结论'],
    },
    {
      title: '报告和更新',
      body: '按 PRISMA 2020 报告标题、摘要、方法、结果、讨论、资金、注册号、完整检索式、流程图、排除清单、数据和代码。',
      checks: ['PRISMA 2020 checklist 和流程图', '森林图、偏倚图、SoF 表和附录', '说明方案偏离、局限性和更新计划'],
    },
  ],
  methodsTitle: '分析方法选择',
  methodsSubtitle: '先按研究问题和数据类型选模型，再决定是否需要分层、转换或更复杂方法。',
  methods: [
    {
      title: '传统两组比较',
      bestFor: '同一干预和对照、同类结局、研究设计相近。',
      methods: '固定效应、随机效应、逆方差、Mantel-Haenszel；二分类用 RR/OR/RD，连续结局用 MD/SMD。',
      cautions: '研究不够可比时不要只靠随机效应掩盖异质性；SMD 的临床解释需要转换或锚定。',
    },
    {
      title: '稀有事件或零事件',
      bestFor: '事件率很低、存在单臂或双臂零事件的安全性/罕见结局。',
      methods: 'Mantel-Haenszel、Peto OR、连续性校正、GLMM、beta-binomial 或贝叶斯模型。',
      cautions: 'Peto 只适合治疗效应不大、组间样本量较平衡、事件稀少的特定情况；双零事件通常不提供 RR/OR 信息。',
    },
    {
      title: '比例、患病率和单组率',
      bestFor: '患病率、发生率、检出率、单组结局。',
      methods: 'logit、Freeman-Tukey、GLMM 或随机效应单组 Meta。',
      cautions: '比例接近 0 或 1 时转换方式会影响结果；必须说明分母、抽样框和病例定义。',
    },
    {
      title: '诊断准确性',
      bestFor: '评价检测、影像、评分、AI 模型或生物标志物的敏感度和特异度。',
      methods: 'bivariate 随机效应模型、HSROC、阈值效应分析、Fagan 图、DOR、阳性/阴性似然比。',
      cautions: '阈值、参考标准、病例谱和验证设计会强烈影响结果；不要把敏感度和特异度简单分别平均。',
    },
    {
      title: '剂量反应和连续暴露',
      bestFor: '暴露水平、剂量、时间、频率与结局存在梯度关系。',
      methods: '线性或非线性剂量反应 Meta、限制性立方样条、趋势估计。',
      cautions: '需要各剂量组病例数/人年/效应量；暴露定义不一致会造成生态偏差。',
    },
    {
      title: '网络 Meta 分析',
      bestFor: '三个及以上干预需要同时比较，且存在直接和间接证据网络。',
      methods: '频率学或贝叶斯 NMA，一致性/不一致性模型，排名概率或 SUCRA。',
      cautions: '必须论证可交换性、传递性和一致性；排名不能替代绝对获益、风险和证据确定性。',
    },
    {
      title: '个体参与者数据 Meta',
      bestFor: '需要统一结局定义、协变量调整、亚组效应或时间到事件数据。',
      methods: '一阶段或两阶段 IPD Meta，混合效应模型，生存模型。',
      cautions: '成本高、数据共享难；未获得 IPD 的研究会造成可用性偏倚。',
    },
    {
      title: '无法合并时的综合',
      bestFor: '研究过少、异质性过大、效应量缺失或结局定义不可比。',
      methods: 'SWiM、结构化叙述、方向性合成、证据图谱、分层表格。',
      cautions: '不能把“多数研究显著”当作证据强度；需要说明分组逻辑和各研究权重来源。',
    },
  ],
  statsTitle: '统计执行要点',
  statsSubtitle: '这些是审稿人最常检查的分析细节。',
  statsBlocks: [
    {
      title: '效应量和数据准备',
      items: [
        '统一方向：所有效应都要让同一侧代表获益或风险增加。',
        '二分类结局：RR 更直观，OR 适合病例对照或逻辑模型，RD 可用于绝对风险和 NNT。',
        '连续结局：同一量表用 MD，不同量表用 SMD，并尽量解释成临床可理解单位。',
        '时间到事件：优先用 HR 和 log(HR)/SE，不要用末次随访人数简单替代风险时间。',
      ],
    },
    {
      title: '模型和权重',
      items: [
        '固定效应假设所有研究估计同一真实效应；随机效应假设真实效应在研究间分布。',
        '逆方差是通用框架；Mantel-Haenszel 常用于二分类数据；Peto 仅适合特定稀有事件场景。',
        '随机效应下小研究权重相对增加，若小研究偏倚明显，结果可能更乐观。',
        '报告模型、估计方法、置信区间方法和软件版本。',
      ],
    },
    {
      title: '异质性和稳健性',
      items: [
        'I2 描述变异中可归因于异质性的比例，不等同于异质性的绝对大小。',
        'tau2 和预测区间能更直接体现研究间真实效应差异。',
        '亚组和 meta 回归应预先指定；研究数量少时解释为探索性。',
        '敏感性分析用于检查偏倚风险、模型选择、缺失数据、零事件处理和影响研究。',
      ],
    },
    {
      title: '发表偏倚和小样本效应',
      items: [
        '漏斗图通常需要足够研究数才有解释价值，研究很少时不要过度解读。',
        '检索注册库、灰色文献、预印本和监管资料比事后统计修正更重要。',
        'Egger 等检验识别的是小样本效应，不一定等于发表偏倚。',
        'trim-and-fill 等方法只能作为敏感性分析，不能证明真实缺失研究数量。',
      ],
    },
  ],
  toolsTitle: '偏倚、质量和证据工具',
  toolsSubtitle: '不要混用“报告质量”“方法学质量”“偏倚风险”和“证据确定性”。它们回答的是不同问题。',
  tools: [
    {
      title: 'RoB 2',
      use: '随机对照试验的结局层面偏倚风险。',
      note: '关注随机化过程、偏离既定干预、缺失结局、结局测量和选择性报告。',
    },
    {
      title: 'ROBINS-I',
      use: '非随机干预研究的偏倚风险。',
      note: '要定义目标试验；混杂、选择、干预分类和时间相关偏倚是关键。',
    },
    {
      title: 'QUADAS-3 / QUADAS-2',
      use: '诊断准确性研究的偏倚风险和适用性。',
      note: 'Bristol 当前推荐 QUADAS-3；既有文献中 QUADAS-2 仍很常见。',
    },
    {
      title: 'ROBIS',
      use: '评价一篇系统综述本身的偏倚风险，常用于 umbrella review 或指南。',
      note: '关注纳排、检索选择、数据提取评价、合成和解释。',
    },
    {
      title: 'AMSTAR 2',
      use: '评价系统综述方法学质量，适合综述再评价。',
      note: '强调关键领域，不建议把总分机械相加。',
    },
    {
      title: 'GRADE',
      use: '评价每个关键结局的证据确定性并形成 Summary of Findings 表。',
      note: 'RCT 通常从高确定性起评，观察性证据通常从低起评，再按偏倚、不一致、间接性、不精确和发表偏倚降级。',
    },
    {
      title: 'PRISMA 2020 / PRISMA-S / SWiM',
      use: '报告规范，而不是统计模型。',
      note: 'PRISMA 2020 管整体报告，PRISMA-S 管检索报告，SWiM 管无法做标准 Meta 时的定量证据综合报告。',
    },
  ],
  limitsTitle: '常见局限性和红线',
  limitsSubtitle: '这些问题通常会削弱结论强度，严重时应停止合并或重写方案。',
  limits: [
    '纳排标准后置调整，尤其是看到结果后再改变结局、亚组或研究设计。',
    '同一研究的多个报告重复纳入，或者把不同随访时间点当作独立研究。',
    '检索只覆盖一个数据库，未保存检索式，或无理由排除非英文、灰色文献、注册资料。',
    '把质量评分当作偏倚风险判断，或用总分筛掉研究而不解释领域风险。',
    '临床问题不一致却强行合并，例如不同人群、剂量、对照、阈值或结局定义。',
    '研究数量很少却进行大量亚组、meta 回归、漏斗图和发表偏倚检验。',
    '只报告显著结果，不报告所有预设结局、阴性分析和敏感性分析。',
    '用总体效应替代个体层面结论，忽略生态偏差、混杂和效应修饰。',
    '对诊断准确性研究忽略阈值效应、参考标准差异、病例谱和验证偏倚。',
    'AI 辅助筛选或提取没有人工复核、审计轨迹和错误率抽查。',
  ],
  deliverablesTitle: '建议交付物',
  deliverables: [
    '研究方案和注册号，包含完整统计分析计划。',
    '每个数据库的检索式、检索日期、平台和命中数量。',
    'PRISMA 2020 流程图、全文排除清单和排除理由。',
    '去重后文献库、筛选决策、数据提取表和代码本。',
    '偏倚风险表/图、证据确定性 Summary of Findings 表。',
    '森林图、异质性统计、亚组/敏感性分析、发表偏倚评估。',
    '可复现代码、数据字典、软件包版本和随机种子。',
    '讨论部分明确说明局限性、适用范围、临床意义和更新计划。',
  ],
  sourcesTitle: '本页首版参考来源',
  sourcesIntro: '以下优先使用 PRISMA、Cochrane、GRADE、Bristol QUADAS、BMJ/AMSTAR 等权威来源。内容为产品内教学摘要，正式投稿仍应回到原文核对。',
  sources: [
    {
      name: 'PRISMA 2020 statement and checklist',
      url: 'https://www.prisma-statement.org/prisma-2020',
      note: '系统综述和 Meta 分析报告框架、checklist 和流程图。',
    },
    {
      name: 'Cochrane Handbook Chapter 4',
      url: 'https://training.cochrane.org/handbook/current/chapter-04',
      note: '检索、选择研究、数据库和研究记录管理。',
    },
    {
      name: 'Cochrane Handbook Chapter 6',
      url: 'https://training.cochrane.org/handbook/current/chapter-06',
      note: '效应量选择、数据类型和效应估计转换。',
    },
    {
      name: 'Cochrane Handbook Chapter 10',
      url: 'https://training.cochrane.org/handbook/current/chapter-10',
      note: '固定效应、随机效应、异质性、缺失数据、敏感性分析和不同结局类型的 Meta 方法。',
    },
    {
      name: 'Cochrane Handbook Chapter 14',
      url: 'https://training.cochrane.org/handbook/current/chapter-14',
      note: 'Summary of Findings 表和 GRADE 证据确定性。',
    },
    {
      name: 'GRADE Handbook',
      url: 'https://www.cochrane.org/authors/handbooks-and-manuals#grade',
      note: '证据确定性和推荐形成方法。',
    },
    {
      name: 'RoB 2',
      url: 'https://methods.cochrane.org/bias/resources/rob-2-revised-cochrane-risk-bias-tool-randomized-trials',
      note: '随机试验偏倚风险工具。',
    },
    {
      name: 'ROBINS-I',
      url: 'https://methods.cochrane.org/bias/risk-bias-non-randomized-studies-interventions',
      note: '非随机干预研究偏倚风险工具。',
    },
    {
      name: 'QUADAS / QUADAS-3',
      url: 'https://www.bristol.ac.uk/population-health-sciences/projects/quadas/',
      note: '诊断准确性研究偏倚风险和适用性评价。',
    },
    {
      name: 'AMSTAR 2',
      url: 'https://www.bmj.com/content/358/bmj.j4008',
      note: '系统综述方法学质量评价工具。',
    },
    {
      name: 'PRISMA-S',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7839230/',
      note: '系统综述检索报告扩展。',
    },
    {
      name: 'SWiM reporting guideline',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7190266/',
      note: '无法做标准 Meta 分析时的综合报告规范。',
    },
    {
      name: 'PROSPERO',
      url: 'https://www.crd.york.ac.uk/prospero/',
      note: '系统综述方案注册库。',
    },
  ],
};

const enCopy: Copy = {
  title: 'Meta-Analysis Help',
  subtitle: 'An initial methods guide from question framing and protocol registration to search, screening, extraction, bias assessment, synthesis, GRADE, and PRISMA reporting.',
  updated: 'Initial version based on public guidance accessible on 2026-05-24. It can later be expanded with specialty templates, code, and examples.',
  coreWarning: 'Decide whether studies can be pooled before deciding how to pool them. A meta-analysis is not just a forest plot; if the question, PICO, outcome definitions, designs, bias risks, or effect measures are not comparable, use structured narrative synthesis or subgrouped presentation first.',
  quickTitle: 'Before You Start',
  quickItems: [
    'The question is operationalized as PICO, PECO, PIRD, or PICOTS with executable eligibility criteria.',
    'A protocol is registered or versioned with primary outcomes, effect measures, subgroups, and sensitivity analyses.',
    'Searches are reproducible: databases, dates, strategies, grey literature, registries, citation chasing, and deduplication rules are saved.',
    'Screening and extraction use independent double review or a documented verification process.',
    'Clinical, methodological, and statistical heterogeneity are assessed before synthesis.',
    'Conclusions match certainty of evidence, not only P values.',
  ],
  workflowTitle: 'Workflow',
  workflowSubtitle: 'Use this as a starter path for new users and as a team quality checklist.',
  steps: [
    {
      title: 'Frame the question',
      body: 'Convert the clinical or research question into a structured format. Intervention reviews often use PICO, exposure or prognosis reviews use PECO, and diagnostic reviews use PIRD or PICOTS.',
      checks: ['Population, exposure/intervention/test, comparator, outcomes, timing, setting', 'Separate primary and secondary outcomes', 'Define clinically meaningful interpretation thresholds'],
    },
    {
      title: 'Write and register the protocol',
      body: 'Complete the protocol before formal screening and extraction. Specify eligibility, sources, extraction fields, risk-of-bias tools, synthesis plans, and how deviations will be logged.',
      checks: ['PROSPERO, OSF, or journal protocol', 'Version history and change reasons', 'Prespecified subgroups, sensitivity analyses, and missing-data rules'],
    },
    {
      title: 'Design the search',
      body: 'Combine controlled vocabulary and text words across bibliographic databases, trial registries, grey literature, citation chasing, and hand searching when needed.',
      checks: ['Save full strategy for every source', 'Record date and platform', 'Avoid unjustified language, date, or publication-type limits'],
    },
    {
      title: 'Deduplicate and link records',
      body: 'Distinguish reports from studies. One study can have multiple papers, abstracts, registry records, and supplements.',
      checks: ['Keep raw and deduplicated counts', 'Link multiple reports of the same study', 'Preserve PRISMA flow counts'],
    },
    {
      title: 'Screen titles, abstracts, and full text',
      body: 'Use calibrated independent screening where possible. Full-text exclusion reasons should be specific enough for peer review.',
      checks: ['Separate title/abstract and full-text stages', 'Assign one main exclusion reason per full-text record', 'Resolve conflicts by consensus or a third reviewer'],
    },
    {
      title: 'Extract data',
      body: 'Design extraction forms around planned analyses. Capture study design, sample flow, missingness, covariates, time points, funding, and conflicts of interest.',
      checks: ['Extract raw data or model-ready effect estimates', 'Document transformations and assumptions', 'Log author contact or plot digitization'],
    },
    {
      title: 'Assess risk of bias',
      body: 'Choose tools by design and ideally assess at the outcome level. Use RoB 2 for RCTs, ROBINS-I for non-randomized intervention studies, QUADAS-3/QUADAS-2 for diagnostic accuracy, and ROBIS or AMSTAR 2 for reviews.',
      checks: ['Do not replace domain judgments with total scores', 'Separate bias, reporting quality, and applicability', 'Carry judgments into interpretation and sensitivity analyses'],
    },
    {
      title: 'Choose effect measures',
      body: 'Binary outcomes often use RR, OR, or RD; continuous outcomes use MD or SMD; time-to-event outcomes use HR; diagnostic accuracy uses sensitivity, specificity, likelihood ratios, DOR, and SROC-related models.',
      checks: ['Align effect direction', 'Standardize units and scales', 'Prespecify how multiple time points or measures are selected'],
    },
    {
      title: 'Assess synthesizeability',
      body: 'Before pooling, assess whether studies are sufficiently comparable in question, intervention, comparator, outcome, design, and bias risk.',
      checks: ['Explain clinical heterogeneity', 'Assess design differences', 'Confirm the data structure supports the model'],
    },
    {
      title: 'Run synthesis and heterogeneity checks',
      body: 'Use fixed-effect, random-effects, Mantel-Haenszel, inverse-variance, Peto, GLMM, Bayesian, bivariate/HSROC, network, or IPD models as the question requires.',
      checks: ['Report I2, tau2, Q, and prediction intervals when appropriate', 'Be cautious with few-study heterogeneity and funnel-plot interpretation', 'Prespecify subgroup and meta-regression variables'],
    },
    {
      title: 'Check robustness and certainty',
      body: 'Use sensitivity analyses for assumptions, assess reporting bias and missing results, and rate certainty for each key outcome with GRADE.',
      checks: ['Exclude high-risk studies in sensitivity analyses', 'Test model and zero-event choices', 'Reflect inconsistency, imprecision, indirectness, and publication bias in conclusions'],
    },
    {
      title: 'Report and update',
      body: 'Report according to PRISMA 2020 with the registration number, complete searches, flow diagram, exclusions, data, code, funding, and deviations from protocol.',
      checks: ['PRISMA checklist and flow diagram', 'Forest plots, risk-of-bias visuals, SoF tables, and appendices', 'Limitations, applicability, and update plan'],
    },
  ],
  methodsTitle: 'Analysis Methods',
  methodsSubtitle: 'Select the model by question and data type before deciding whether more complex stratification or transformation is needed.',
  methods: [
    {
      title: 'Standard pairwise comparison',
      bestFor: 'Same intervention, comparator, outcome type, and broadly similar design.',
      methods: 'Fixed-effect, random-effects, inverse-variance, Mantel-Haenszel; RR/OR/RD for binary outcomes and MD/SMD for continuous outcomes.',
      cautions: 'Do not use random effects to hide non-comparability. SMD requires careful clinical interpretation.',
    },
    {
      title: 'Rare or zero events',
      bestFor: 'Low event-rate safety outcomes or rare events.',
      methods: 'Mantel-Haenszel, Peto OR, continuity corrections, GLMM, beta-binomial, or Bayesian models.',
      cautions: 'Peto is suitable only under specific rare-event conditions. Double-zero studies usually add no RR/OR information.',
    },
    {
      title: 'Proportions and prevalence',
      bestFor: 'Prevalence, incidence, detection rates, or single-arm outcomes.',
      methods: 'Logit, Freeman-Tukey, GLMM, or random-effects single-proportion meta-analysis.',
      cautions: 'Transformations matter near 0 or 1. Define denominator, sampling frame, and case definition.',
    },
    {
      title: 'Diagnostic accuracy',
      bestFor: 'Tests, imaging, scores, AI models, or biomarkers.',
      methods: 'Bivariate random-effects model, HSROC, threshold-effect analysis, Fagan plot, DOR, positive and negative likelihood ratios.',
      cautions: 'Threshold, reference standard, spectrum, and verification bias can dominate the result.',
    },
    {
      title: 'Dose-response',
      bestFor: 'Exposure level, dose, time, or frequency gradients.',
      methods: 'Linear or nonlinear dose-response meta-analysis, restricted cubic splines, trend estimation.',
      cautions: 'Requires dose-level cases/person-time/effect estimates. Inconsistent exposure definitions invite ecological bias.',
    },
    {
      title: 'Network meta-analysis',
      bestFor: 'Three or more competing interventions with direct and indirect evidence.',
      methods: 'Frequentist or Bayesian NMA, consistency and inconsistency models, ranking probabilities or SUCRA.',
      cautions: 'Transitivity and consistency must be justified. Rankings do not replace certainty, absolute effects, or harms.',
    },
    {
      title: 'Individual participant data',
      bestFor: 'Standardized outcomes, covariate adjustment, subgroup effects, or time-to-event data.',
      methods: 'One-stage or two-stage IPD meta-analysis, mixed models, survival models.',
      cautions: 'Data access is expensive and incomplete IPD availability can introduce availability bias.',
    },
    {
      title: 'No standard meta-analysis',
      bestFor: 'Too few studies, major heterogeneity, missing effect estimates, or incompatible outcomes.',
      methods: 'SWiM, structured narrative synthesis, direction-of-effect synthesis, evidence maps, stratified tables.',
      cautions: 'Do not treat vote counting by significance as evidence strength. Explain grouping and study weighting.',
    },
  ],
  statsTitle: 'Statistical Details',
  statsSubtitle: 'These are common peer-review checkpoints.',
  statsBlocks: [
    {
      title: 'Effect measures and preparation',
      items: [
        'Align all effect directions.',
        'Binary outcomes: RR is intuitive, OR fits case-control or logistic settings, RD supports absolute risk and NNT.',
        'Continuous outcomes: use MD for the same scale and SMD for different scales, then translate when possible.',
        'Time-to-event outcomes: prefer HR and log(HR)/SE.',
      ],
    },
    {
      title: 'Models and weights',
      items: [
        'Fixed-effect assumes one common true effect; random-effects assumes a distribution of true effects.',
        'Inverse variance is generic; Mantel-Haenszel is common for binary data; Peto is limited to specific rare-event cases.',
        'Random-effects models give relatively more weight to small studies.',
        'Report the model, estimator, interval method, and software version.',
      ],
    },
    {
      title: 'Heterogeneity and robustness',
      items: [
        'I2 is a proportion of variation, not the absolute size of heterogeneity.',
        'tau2 and prediction intervals better express between-study variation.',
        'Subgroups and meta-regression should be prespecified.',
        'Sensitivity analyses test bias risk, model choice, missing data, zero events, and influential studies.',
      ],
    },
    {
      title: 'Publication bias',
      items: [
        'Funnel plots usually require enough studies to interpret.',
        'Searching registries and grey literature is more important than post hoc statistical correction.',
        'Egger-type tests detect small-study effects, not necessarily publication bias.',
        'Trim-and-fill is sensitivity analysis, not proof of missing studies.',
      ],
    },
  ],
  toolsTitle: 'Bias, Quality, and Certainty Tools',
  toolsSubtitle: 'Reporting quality, methodological quality, risk of bias, applicability, and certainty of evidence answer different questions.',
  tools: [
    { title: 'RoB 2', use: 'Outcome-level risk of bias in randomized trials.', note: 'Covers randomization, deviations, missing outcomes, measurement, and selective reporting.' },
    { title: 'ROBINS-I', use: 'Risk of bias in non-randomized intervention studies.', note: 'Requires a target trial and careful treatment of confounding and time-related bias.' },
    { title: 'QUADAS-3 / QUADAS-2', use: 'Bias and applicability in diagnostic accuracy studies.', note: 'Bristol lists QUADAS-3 as current; QUADAS-2 remains common in published reviews.' },
    { title: 'ROBIS', use: 'Risk of bias in a systematic review itself.', note: 'Useful for umbrella reviews and guidelines.' },
    { title: 'AMSTAR 2', use: 'Methodological quality of systematic reviews.', note: 'Emphasizes critical domains rather than mechanical total scores.' },
    { title: 'GRADE', use: 'Certainty of evidence for each key outcome.', note: 'Rates risk of bias, inconsistency, indirectness, imprecision, and publication bias.' },
    { title: 'PRISMA / PRISMA-S / SWiM', use: 'Reporting standards.', note: 'PRISMA covers the review, PRISMA-S the search, and SWiM synthesis without standard meta-analysis.' },
  ],
  limitsTitle: 'Common Limits and Red Flags',
  limitsSubtitle: 'These issues weaken conclusions and may require stopping pooling or rewriting the protocol.',
  limits: [
    'Eligibility, outcomes, or subgroups changed after seeing results.',
    'Multiple reports of the same study are double-counted.',
    'Searches cover too few sources or do not preserve complete strategies.',
    'Quality scores replace domain-level bias judgments.',
    'Incompatible populations, comparators, thresholds, or outcomes are pooled.',
    'Too many subgroup, meta-regression, funnel-plot, or publication-bias analyses are attempted with few studies.',
    'Only significant results are reported.',
    'Aggregate effects are overinterpreted as individual-level conclusions.',
    'Diagnostic reviews ignore threshold effects, reference-standard differences, spectrum, or verification bias.',
    'AI-assisted screening or extraction lacks human verification and audit trails.',
  ],
  deliverablesTitle: 'Recommended Deliverables',
  deliverables: [
    'Protocol and registration number with statistical analysis plan.',
    'Search strategy, source, date, platform, and hit count for every database.',
    'PRISMA flow diagram and full-text exclusion list.',
    'Deduplicated library, screening decisions, extraction sheet, and codebook.',
    'Risk-of-bias tables, Summary of Findings tables, and certainty ratings.',
    'Forest plots, heterogeneity statistics, subgroup and sensitivity analyses, and reporting-bias assessment.',
    'Reproducible code, data dictionary, package versions, and seeds.',
    'Discussion of limitations, applicability, clinical meaning, and update plan.',
  ],
  sourcesTitle: 'Initial Sources',
  sourcesIntro: 'This page prioritizes PRISMA, Cochrane, GRADE, Bristol QUADAS, BMJ/AMSTAR, and related official or peer-reviewed guidance. For submission, verify details against the original sources.',
  sources: [
    {
      name: 'PRISMA 2020 statement and checklist',
      url: 'https://www.prisma-statement.org/prisma-2020',
      note: 'Reporting framework, checklist, and flow diagram for systematic reviews and meta-analyses.',
    },
    {
      name: 'Cochrane Handbook Chapter 4',
      url: 'https://training.cochrane.org/handbook/current/chapter-04',
      note: 'Searching, selecting studies, databases, and record management.',
    },
    {
      name: 'Cochrane Handbook Chapter 6',
      url: 'https://training.cochrane.org/handbook/current/chapter-06',
      note: 'Effect measures, data types, and effect-estimate transformations.',
    },
    {
      name: 'Cochrane Handbook Chapter 10',
      url: 'https://training.cochrane.org/handbook/current/chapter-10',
      note: 'Meta-analysis models, heterogeneity, missing data, sensitivity analyses, and outcome-specific methods.',
    },
    {
      name: 'Cochrane Handbook Chapter 14',
      url: 'https://training.cochrane.org/handbook/current/chapter-14',
      note: 'Summary of Findings tables and GRADE certainty of evidence.',
    },
    {
      name: 'GRADE Handbook',
      url: 'https://www.cochrane.org/authors/handbooks-and-manuals#grade',
      note: 'Evidence certainty and recommendation methods.',
    },
    {
      name: 'RoB 2',
      url: 'https://methods.cochrane.org/bias/resources/rob-2-revised-cochrane-risk-bias-tool-randomized-trials',
      note: 'Risk-of-bias tool for randomized trials.',
    },
    {
      name: 'ROBINS-I',
      url: 'https://methods.cochrane.org/bias/risk-bias-non-randomized-studies-interventions',
      note: 'Risk-of-bias tool for non-randomized intervention studies.',
    },
    {
      name: 'QUADAS / QUADAS-3',
      url: 'https://www.bristol.ac.uk/population-health-sciences/projects/quadas/',
      note: 'Bias and applicability assessment for diagnostic accuracy studies.',
    },
    {
      name: 'AMSTAR 2',
      url: 'https://www.bmj.com/content/358/bmj.j4008',
      note: 'Methodological quality appraisal tool for systematic reviews.',
    },
    {
      name: 'PRISMA-S',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7839230/',
      note: 'Search reporting extension for systematic reviews.',
    },
    {
      name: 'SWiM reporting guideline',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7190266/',
      note: 'Reporting guideline for synthesis without standard meta-analysis.',
    },
    {
      name: 'PROSPERO',
      url: 'https://www.crd.york.ac.uk/prospero/',
      note: 'Prospective register for systematic review protocols.',
    },
  ],
};

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      {subtitle && <p className="max-w-4xl text-sm leading-6 text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function InfoPanel({
  icon: Icon,
  title,
  children,
  tone = 'default',
}: {
  icon: typeof HelpCircle;
  title: string;
  children: ReactNode;
  tone?: 'default' | 'warning';
}) {
  const toneClass = tone === 'warning'
    ? 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-100'
    : 'border-border bg-card text-foreground';

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-background/70 p-2 text-primary shadow-sm dark:bg-background/40">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="mt-2 text-sm leading-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function MetaAnalysisHelpPage() {
  const { i18n } = useTranslation();
  const copy = useMemo(() => {
    return i18n.language?.toLowerCase().startsWith('zh') ? zhCopy : enCopy;
  }, [i18n.language]);

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-5 md:px-6 md:py-7">
        <header className="rounded-lg border border-border bg-card p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-4xl space-y-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary">
                  <HelpCircle className="h-5 w-5" />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">{copy.title}</h1>
              </div>
              <p className="text-base leading-7 text-muted-foreground">{copy.subtitle}</p>
              <p className="text-xs leading-5 text-muted-foreground">{copy.updated}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4 lg:w-[26rem]">
              {[
                { icon: ClipboardCheck, label: 'Protocol' },
                { icon: Search, label: 'Search' },
                { icon: BarChart3, label: 'Synthesis' },
                { icon: ShieldCheck, label: 'GRADE' },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="rounded-lg border border-border bg-background px-3 py-2">
                  <Icon className="mb-2 h-4 w-4 text-primary" />
                  <div className="font-medium text-foreground">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </header>

        <InfoPanel icon={AlertTriangle} title={copy.quickTitle} tone="warning">
          <p>{copy.coreWarning}</p>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {copy.quickItems.map((item) => (
              <div key={item} className="flex gap-2 rounded-md bg-background/70 px-3 py-2 dark:bg-background/35">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-300" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </InfoPanel>

        <section className="space-y-4">
          <SectionHeader title={copy.workflowTitle} subtitle={copy.workflowSubtitle} />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {copy.steps.map((step, index) => (
              <article key={step.title} className="rounded-lg border border-border bg-card p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.body}</p>
                    <ul className="mt-3 space-y-1.5">
                      {step.checks.map((check) => (
                        <li key={check} className="flex gap-2 text-sm leading-5 text-foreground/88">
                          <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary/70" />
                          <span>{check}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeader title={copy.methodsTitle} subtitle={copy.methodsSubtitle} />
          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <div className="grid grid-cols-12 border-b border-border bg-muted/45 px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <div className="col-span-12 md:col-span-3">Method</div>
              <div className="hidden md:col-span-3 md:block">Best for</div>
              <div className="hidden md:col-span-3 md:block">Analysis</div>
              <div className="hidden md:col-span-3 md:block">Caution</div>
            </div>
            {copy.methods.map((method) => (
              <div key={method.title} className="grid grid-cols-1 gap-3 border-b border-border px-4 py-4 last:border-b-0 md:grid-cols-12 md:gap-4">
                <div className="md:col-span-3">
                  <h3 className="text-sm font-semibold text-foreground">{method.title}</h3>
                </div>
                <p className="text-sm leading-6 text-muted-foreground md:col-span-3">{method.bestFor}</p>
                <p className="text-sm leading-6 text-foreground/88 md:col-span-3">{method.methods}</p>
                <p className="text-sm leading-6 text-amber-700 dark:text-amber-300 md:col-span-3">{method.cautions}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeader title={copy.statsTitle} subtitle={copy.statsSubtitle} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {copy.statsBlocks.map((block, index) => {
              const icons = [Scale, SlidersHorizontal, BarChart3, Database];
              const Icon = icons[index % icons.length];
              return (
                <InfoPanel key={block.title} icon={Icon} title={block.title}>
                  <ul className="space-y-1.5">
                    {block.items.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary/70" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </InfoPanel>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeader title={copy.toolsTitle} subtitle={copy.toolsSubtitle} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {copy.tools.map((tool, index) => {
              const icons = [ShieldCheck, Microscope, BookOpenCheck, Network, Table2, ClipboardCheck, FileText];
              const Icon = icons[index % icons.length];
              return (
                <article key={tool.title} className="rounded-lg border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="rounded-md bg-primary/10 p-2 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-foreground">{tool.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-foreground/88">{tool.use}</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{tool.note}</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeader title={copy.limitsTitle} subtitle={copy.limitsSubtitle} />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {copy.limits.map((limit) => (
              <div key={limit} className="flex gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm leading-6 text-foreground/88">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-300" />
                <span>{limit}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeader title={copy.deliverablesTitle} />
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {copy.deliverables.map((item) => (
                <li key={item} className="flex gap-2 text-sm leading-6 text-foreground/88">
                  <CheckCircle2 className="mt-1 h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeader title={copy.sourcesTitle} subtitle={copy.sourcesIntro} />
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {copy.sources.map((source) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-border bg-background px-3 py-3 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <span className="block font-semibold text-foreground">{source.name}</span>
                  <span className="mt-1 block leading-5 text-muted-foreground">{source.note}</span>
                </a>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
