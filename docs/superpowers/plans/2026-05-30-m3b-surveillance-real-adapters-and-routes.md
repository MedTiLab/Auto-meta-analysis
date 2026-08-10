# M3-B — 巡检真实适配器 + 服务 + 路由 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 M3 已测好的巡检引擎接到真实数据——真实 PubMed 增量检索、真实语料库（`referencesDb`）读写、真实筛选（`upsertScreeningDecision`）——并提供 `runProjectSurveillance` 服务与 `订阅 / 立即巡检 / 查看运行` 路由，让追踪在 app 里真正能跑。

**Architecture:** 在 `server/services/meta-analysis/surveillance/` 新增三个适配器工厂（PubMed 检索源、引用语料库、筛选写入器）+ 一个装配服务 `runProjectSurveillance`（直接 import 真实 db 模块，仅 `searchSource`/`classifier` 可注入以便测试），再在 `server/routes/meta-analysis.js` 加 4 个路由薄包装。适配器/服务用 vitest 覆盖（真实 temp DB + 假 PubMed），路由是对已测服务的透明转发。

**Tech Stack:** Node.js (ESM), better-sqlite3, vitest, node-fetch（仅真实 PubMed 路径用，测试注入假实现绕开网络）。

---

## 前置说明（执行前必读）

- 依赖 **M3 已合并**（`feat/living-updater`：`runSurveillanceCycle`、`surveillanceDb`、`dedup/eligibility/change-set`、`meta_surveillance_*` 表）与 **M0**。先确认这些存在。
- **测试一律 `npx vitest run <file>`（过滤加 `-t`），不要用 `npm test`**（其 pretest 会 `npm rebuild sharp/sqlite3` 卡死）。一次性探测：`npx vitest run server/__tests__/surveillance-engine.test.mjs`。
- 开分支：`git checkout -b feat/surveillance-wiring`（从含 M3 的主线切出）。

## 范围

**做（全部可测）：** 真实 PubMed 检索源（含 `[EDAT]` 增量日期）、引用语料库适配器（`getProjectReferences`/`importReferences`+`bulkLinkIds`）、筛选写入适配器（`upsertScreeningDecision`，`reviewer='surveillance-agent'`）、`runProjectSurveillance` 装配服务、4 个路由（subscribe/run/runs/subscription）。

**不做（后续）：**
- **UI 面板** = **M3-B2**（薄层：订阅表单 + "立即巡检"按钮 + ChangeSet 展示）。本计划完成后追踪已可经 API 真跑并有集成测试背书。
- **定时调度器**（按 `frequency` 自动跑）= M3-B2 或独立小计划。
- **统计重算/数值 diff** = M1（本计划仍只产 `pendingReanalysis` 接口段）。

## 关键真实接口（已核对）

- `searchPubMed(query, { retmax }) → { ids, count, raw }`（**不吃日期参数**，增量靠把 `[EDAT]` 区间拼进 query）。
- `fetchPubMedSummaries(ids) → [{ pmid, doi, title, authors, year, journal, abstract, url, raw }]`。
- `referencesDb.importReferences(userId, [{ title, authors, year, abstract, doi, url, journal, itemType, citationKey, keywords, rawData }], source) → [id]`（`citation_key` 与 `source_id` 都取 `citationKey`）。
- `referencesDb.bulkLinkIds(projectId, [ids])`、`referencesDb.getProjectReferences(projectId, userId) → rows`。
- `metaAnalysisDb.upsertScreeningDecision(userId, { metaProjectId, referenceId, stage, decision, reason, reviewer, confidence })`。
- `metaProject.id`（meta 项目 id，用于 screening/subscription）与 `metaProject.project_id`（底层项目 id，用于引用 link/list）。

---

## File Structure

| 文件 | 责任 |
| --- | --- |
| `server/services/meta-analysis/surveillance/surveillance-adapters.js`（新建） | 三个工厂：`createPubmedSearchSource` / `createReferencesCorpus` / `createScreeningRecorder` + `formatEdatRange` |
| `server/services/meta-analysis/surveillance/surveillance-service.js`（新建） | `runProjectSurveillance`（装配真实适配器 + 引擎；仅 searchSource/classifier 可注入） |
| `server/routes/meta-analysis.js`（修改） | 加 4 个路由薄包装 + import |
| `server/__tests__/surveillance-adapters.test.mjs`（新建） | 覆盖三个适配器 |
| `server/__tests__/surveillance-service.test.mjs`（新建） | 端到端：真实 corpus/screening/ledger + 假 search |

---

## Task 1: PubMed 检索源适配器（`createPubmedSearchSource` + `formatEdatRange`）

**Files:**
- Create: `server/services/meta-analysis/surveillance/surveillance-adapters.js`
- Test: `server/__tests__/surveillance-adapters.test.mjs`

- [ ] **Step 1: 写失败测试**

新建 `server/__tests__/surveillance-adapters.test.mjs`：

```js
import { describe, expect, it } from 'vitest';
import { createPubmedSearchSource, formatEdatRange } from '../services/meta-analysis/surveillance/surveillance-adapters.js';

describe('formatEdatRange', () => {
  it('formats an ISO timestamp into a PubMed EDAT range', () => {
    expect(formatEdatRange('2026-05-01T12:00:00.000Z')).toBe('("2026/05/01"[EDAT] : "3000"[EDAT])');
  });
});

describe('createPubmedSearchSource', () => {
  it('appends an EDAT range when `since` is given and maps records to candidates', async () => {
    const calls = [];
    const fakeSearch = async (query, opts) => { calls.push({ query, opts }); return { ids: ['111', '222'], count: 2 }; };
    const fakeSummaries = async (ids) => ids.map((pmid) => ({
      pmid, doi: `10.1/${pmid}`, title: `Paper ${pmid}`, abstract: 'a', year: 2026, journal: 'J', authors: [], url: `u/${pmid}`,
    }));
    const source = createPubmedSearchSource({ searchPubMed: fakeSearch, fetchPubMedSummaries: fakeSummaries });

    const candidates = await source.search({ pubmed: '("network meta-analysis"[tiab])' }, { since: '2026-05-01T00:00:00.000Z' });

    expect(calls[0].query).toContain('("network meta-analysis"[tiab])');
    expect(calls[0].query).toContain('[EDAT]');
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ pmid: '111', doi: '10.1/111', source: 'pubmed', sourceId: '111' });
    expect(candidates[0].raw.title).toBe('Paper 111');
  });

  it('omits the date range on first run (no since)', async () => {
    const calls = [];
    const fakeSearch = async (query) => { calls.push(query); return { ids: [], count: 0 }; };
    const source = createPubmedSearchSource({ searchPubMed: fakeSearch, fetchPubMedSummaries: async () => [] });
    await source.search({ pubmed: '(x)' }, {});
    expect(calls[0]).toBe('(x)');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/surveillance-adapters.test.mjs -t "createPubmedSearchSource"`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现适配器文件（先含 PubMed 源）**

新建 `server/services/meta-analysis/surveillance/surveillance-adapters.js`：

```js
import { searchPubMed as defaultSearchPubMed, fetchPubMedSummaries as defaultFetchPubMedSummaries } from '../pubmed-client.js';

export function formatEdatRange(sinceIso) {
  const d = new Date(sinceIso);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `("${yyyy}/${mm}/${dd}"[EDAT] : "3000"[EDAT])`;
}

// PubMed 增量检索源。overrides 注入 searchPubMed/fetchPubMedSummaries 便于测试绕开网络。
export function createPubmedSearchSource(overrides = {}) {
  const searchPubMed = overrides.searchPubMed || defaultSearchPubMed;
  const fetchPubMedSummaries = overrides.fetchPubMedSummaries || defaultFetchPubMedSummaries;
  return {
    async search(searchStrategy, { since } = {}) {
      const base = (searchStrategy && searchStrategy.pubmed) || '';
      const query = since ? `${base} AND ${formatEdatRange(since)}` : base;
      const { ids } = await searchPubMed(query, { retmax: 200 });
      const records = await fetchPubMedSummaries(ids);
      return records.map((r) => ({
        doi: r.doi || null,
        pmid: r.pmid || null,
        title: r.title,
        abstract: r.abstract || null,
        year: r.year || null,
        source: 'pubmed',
        sourceId: r.pmid || null,
        raw: r,
      }));
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/surveillance-adapters.test.mjs`
Expected: PASS（3 条用例）。

- [ ] **Step 5: 提交**

```bash
git add server/services/meta-analysis/surveillance/surveillance-adapters.js server/__tests__/surveillance-adapters.test.mjs
git commit -m "feat(surveillance): PubMed incremental search source adapter"
```

---

## Task 2: 引用语料库适配器（`createReferencesCorpus`）

**Files:**
- Modify: `server/services/meta-analysis/surveillance/surveillance-adapters.js`（追加工厂）
- Test: `server/__tests__/surveillance-adapters.test.mjs`

- [ ] **Step 1: 写失败测试**

在 `surveillance-adapters.test.mjs` 顶部补 import（与现有合并）：

```js
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, vi } from 'vitest';
```

文件末尾追加：

```js
describe('createReferencesCorpus (real DB)', () => {
  const originalDatabasePath = process.env.DATABASE_PATH;
  let tempRoot = null;

  async function loadDb() {
    vi.resetModules();
    const database = await import('../database/db.js');
    await database.initializeDatabase();
    return database;
  }
  async function makeFixture(database, username = 'corpus-user') {
    const user = database.userDb.createUser(username, 'hashed-password');
    const projectName = `${username}-project`;
    database.projectDb.upsertProject(projectName, user.id, 'Corpus Project', path.join(tempRoot, projectName), 0, null, { projectKind: 'meta' });
    const metaProject = database.metaAnalysisDb.createMetaProject(user.id, { projectId: projectName, reviewType: 'network', title: 'Corpus Project' });
    return { user, projectName, metaProject };
  }

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-corpus-adapter-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });
  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) { await fs.rm(tempRoot, { recursive: true, force: true }); tempRoot = null; }
  });

  it('adds a candidate to the project corpus and lists it back for dedup', async () => {
    const database = await loadDb();
    const { createReferencesCorpus } = await import('../services/meta-analysis/surveillance/surveillance-adapters.js');
    const { user, metaProject } = await makeFixture(database);

    const corpus = createReferencesCorpus({ userId: user.id, metaProject, referencesDb: database.referencesDb });

    expect(await corpus.list(metaProject.id)).toHaveLength(0);

    const { id } = await corpus.add(user.id, metaProject.id, {
      doi: '10.9/new', pmid: '22222', title: 'A network meta-analysis of X', abstract: 'abc', year: 2026, source: 'pubmed', sourceId: '22222',
      raw: { authors: [{ family: 'Lin', given: 'A' }], journal: 'J', url: 'u' },
    });
    expect(id).toBeTruthy();

    const listed = await corpus.list(metaProject.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ doi: '10.9/new', title: 'A network meta-analysis of X', source: 'pubmed', sourceId: '22222' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/surveillance-adapters.test.mjs -t "adds a candidate to the project corpus"`
Expected: FAIL（无 `createReferencesCorpus`）。

- [ ] **Step 3: 实现 `createReferencesCorpus`**

在 `surveillance-adapters.js` 追加：

```js
// 引用语料库适配器。list 供去重，add 把命中候选导入并挂到底层项目。
export function createReferencesCorpus({ userId, metaProject, referencesDb }) {
  const projectId = metaProject.project_id;
  return {
    async list() {
      const rows = referencesDb.getProjectReferences(projectId, userId) || [];
      return rows.map((r) => ({
        id: r.id,
        doi: r.doi || null,
        title: r.title,
        source: r.source || null,
        sourceId: r.sourceId || r.source_id || null,
      }));
    },
    async add(_userId, _metaProjectId, candidate) {
      const raw = candidate.raw || {};
      const ids = referencesDb.importReferences(userId, [{
        title: candidate.title,
        authors: raw.authors || [],
        year: candidate.year ?? raw.year ?? null,
        abstract: candidate.abstract ?? raw.abstract ?? null,
        doi: candidate.doi ?? raw.doi ?? null,
        url: raw.url || null,
        journal: raw.journal || null,
        itemType: 'article',
        citationKey: candidate.pmid || candidate.sourceId || null,
        keywords: [],
        rawData: raw,
      }], candidate.source || 'pubmed');
      const id = ids[0];
      referencesDb.bulkLinkIds(projectId, [id]);
      return { id };
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/surveillance-adapters.test.mjs -t "adds a candidate to the project corpus"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/services/meta-analysis/surveillance/surveillance-adapters.js server/__tests__/surveillance-adapters.test.mjs
git commit -m "feat(surveillance): references corpus adapter (list + add)"
```

---

## Task 3: 筛选写入适配器（`createScreeningRecorder`）

**Files:**
- Modify: `server/services/meta-analysis/surveillance/surveillance-adapters.js`（追加工厂）
- Test: `server/__tests__/surveillance-adapters.test.mjs`

- [ ] **Step 1: 写失败测试**

在上一个 `describe('createReferencesCorpus (real DB)')` 内追加（复用同样的 `loadDb`/`makeFixture`）：

```js
  it('records an agent screening decision via upsertScreeningDecision', async () => {
    const database = await loadDb();
    const { createReferencesCorpus, createScreeningRecorder } = await import('../services/meta-analysis/surveillance/surveillance-adapters.js');
    const { user, metaProject } = await makeFixture(database, 'screen-user');

    const corpus = createReferencesCorpus({ userId: user.id, metaProject, referencesDb: database.referencesDb });
    const { id: referenceId } = await corpus.add(user.id, metaProject.id, {
      doi: '10.9/s', pmid: '333', title: 'An NMA', source: 'pubmed', sourceId: '333', raw: {},
    });

    const screening = createScreeningRecorder({ metaAnalysisDb: database.metaAnalysisDb });
    const decision = await screening.record({
      userId: user.id, metaProjectId: metaProject.id, referenceId,
      decision: 'include', confidence: 0.85, reviewer: 'surveillance-agent', reason: 'matched include criteria',
    });

    expect(decision.decision).toBe('include');
    const stored = database.metaAnalysisDb.listScreeningDecisions(user.id, metaProject.id);
    const agentDecision = stored.find((d) => d.reviewer === 'surveillance-agent');
    expect(agentDecision).toBeTruthy();
    expect(agentDecision.decision).toBe('include');
  });
```

> 注：`metaAnalysisDb.listScreeningDecisions(userId, metaProjectId)` 返回该 meta 项目的全部筛选决策（`SELECT *` 映射行，含 `reviewer`/`decision`）。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/surveillance-adapters.test.mjs -t "records an agent screening decision"`
Expected: FAIL（无 `createScreeningRecorder`）。

- [ ] **Step 3: 实现 `createScreeningRecorder`**

在 `surveillance-adapters.js` 追加：

```js
// 筛选写入适配器。reviewer 透传（巡检用 'surveillance-agent'，被 workflow-gates 判为 agent 决策）。
export function createScreeningRecorder({ metaAnalysisDb }) {
  return {
    async record({ userId, metaProjectId, referenceId, decision, confidence, reviewer, reason }) {
      return metaAnalysisDb.upsertScreeningDecision(userId, {
        metaProjectId,
        referenceId,
        stage: 'title_abstract',
        decision,
        reason: reason || '',
        reviewer: reviewer || 'surveillance-agent',
        confidence,
      });
    },
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/surveillance-adapters.test.mjs`
Expected: PASS（全文件用例）。

- [ ] **Step 5: 提交**

```bash
git add server/services/meta-analysis/surveillance/surveillance-adapters.js server/__tests__/surveillance-adapters.test.mjs
git commit -m "feat(surveillance): screening recorder adapter"
```

---

## Task 4: 装配服务 `runProjectSurveillance`（端到端：真实 DB + 假 search）

**Files:**
- Create: `server/services/meta-analysis/surveillance/surveillance-service.js`
- Test: `server/__tests__/surveillance-service.test.mjs`

- [ ] **Step 1: 写失败测试**

新建 `server/__tests__/surveillance-service.test.mjs`：

```js
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadModules() {
  vi.resetModules();
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  const ledger = await import('../services/meta-analysis/evidence-ledger.js');
  const service = await import('../services/meta-analysis/surveillance/surveillance-service.js');
  return { database, ledger, service };
}

describe('runProjectSurveillance (real corpus/screening/ledger, fake search)', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-surv-service-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });
  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) { await fs.rm(tempRoot, { recursive: true, force: true }); tempRoot = null; }
  });

  it('dedups a known study, auto-includes a novel one, versions the ReferenceSet, and stales the dependent', async () => {
    const { database, ledger, service } = await loadModules();
    const user = database.userDb.createUser('svc-user', 'hashed-password');
    const projectName = 'svc-user-project';
    database.projectDb.upsertProject(projectName, user.id, 'Svc Project', path.join(tempRoot, projectName), 0, null, { projectKind: 'meta' });
    const metaProject = database.metaAnalysisDb.createMetaProject(user.id, { projectId: projectName, reviewType: 'network', title: 'Svc Project' });

    // seed corpus with one known study (doi 10.1/old, pmid 11111)
    const [oldId] = database.referencesDb.importReferences(user.id, [{ title: 'Old NMA', doi: '10.1/old', citationKey: '11111' }], 'pubmed');
    database.referencesDb.bulkLinkIds(projectName, [oldId]);

    // seed ledger: ReferenceSet v1 + dependent AnalysisRun (no validators registered -> both validated)
    const refsV1 = ledger.recordArtifact(user.id, { metaProjectId: metaProject.id, type: 'ReferenceSet', payload: { addedReferenceIds: [oldId] } }).artifact;
    const analysis = ledger.recordArtifact(user.id, {
      metaProjectId: metaProject.id, type: 'AnalysisRun', payload: { note: 'baseline' },
      inputs: [{ artifactId: refsV1.id, version: refsV1.version }],
    }).artifact;

    // subscription
    database.surveillanceDb.createSubscription(user.id, {
      metaProjectId: metaProject.id,
      searchStrategy: { pubmed: '("network meta-analysis"[tiab])' },
      eligibility: { includeKeywordsAny: ['network meta-analysis'] },
    });

    // fake search: one duplicate (pmid 11111) + one novel includable (pmid 22222)
    const searchSource = { search: async () => ([
      { doi: '10.1/old', pmid: '11111', title: 'dup reprint', source: 'pubmed', sourceId: '11111', raw: {} },
      { doi: '10.9/new', pmid: '22222', title: 'A network meta-analysis of DOACs', abstract: '', year: 2026, source: 'pubmed', sourceId: '22222', raw: { authors: [] } },
    ]) };

    const { run, changeSet } = await service.runProjectSurveillance({ userId: user.id, metaProject, searchSource });

    expect(changeSet.dedup.duplicates).toBe(1);
    expect(changeSet.dedup.novel).toBe(1);
    expect(changeSet.autoScreen.autoIncluded).toBe(1);
    expect(changeSet.referenceSet.newVersion).toBe(2);
    expect(database.evidenceLedgerDb.getArtifact(analysis.id).status).toBe('stale');
    expect(changeSet.pendingReanalysis.staleArtifactIds).toContain(analysis.id);

    // corpus now has 2 refs; run persisted
    expect(database.referencesDb.getProjectReferences(projectName, user.id)).toHaveLength(2);
    expect(database.surveillanceDb.getRun(run.id).stats.autoIncluded).toBe(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/surveillance-service.test.mjs -t "dedups a known study"`
Expected: FAIL（找不到 `surveillance-service.js`）。

- [ ] **Step 3: 实现服务**

新建 `server/services/meta-analysis/surveillance/surveillance-service.js`：

```js
import { surveillanceDb, referencesDb, metaAnalysisDb, evidenceLedgerDb } from '../../database/db.js';
import { recordArtifact } from './evidence-ledger.js';
import { runSurveillanceCycle } from './surveillance-engine.js';
import { createPubmedSearchSource, createReferencesCorpus, createScreeningRecorder } from './surveillance-adapters.js';

// 装配真实适配器并跑一轮巡检。仅 searchSource/classifier 可注入（测试用），其余用真实 db 模块。
export async function runProjectSurveillance({ userId, metaProject, searchSource = null, classifier = null }) {
  const subscription = surveillanceDb.getSubscriptionByProject(metaProject.id);
  if (!subscription) {
    throw new Error('No surveillance subscription for this project');
  }

  const deps = {
    searchSource: searchSource || createPubmedSearchSource(),
    classifier,
    corpus: createReferencesCorpus({ userId, metaProject, referencesDb }),
    screening: createScreeningRecorder({ metaAnalysisDb }),
    ledger: {
      recordArtifact,
      getLatestArtifact: evidenceLedgerDb.getLatestArtifact,
      collectTransitiveDependents: evidenceLedgerDb.collectTransitiveDependents,
    },
    surveillanceDb,
    clock: { now: () => new Date().toISOString() },
  };

  return runSurveillanceCycle({ userId, subscription, deps });
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/surveillance-service.test.mjs -t "dedups a known study"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/services/meta-analysis/surveillance/surveillance-service.js server/__tests__/surveillance-service.test.mjs
git commit -m "feat(surveillance): runProjectSurveillance wiring service"
```

---

## Task 5: 路由（subscribe / run / runs / subscription）

路由是对已测 `surveillanceDb` 与 `runProjectSurveillance` 的透明转发。本仓库无 HTTP 测试框架（既有测试都在 service/db 层），故路由用**手动冒烟**验证，逻辑由 Task 4 的服务测试覆盖。

**Files:**
- Modify: `server/routes/meta-analysis.js`（顶部 import 区 + 在其它 `/:metaProjectId/...` 路由附近加 4 个 handler）

- [ ] **Step 1: 加 import**

在 `server/routes/meta-analysis.js` 顶部 import 区追加（与现有 `import { ... } from '../database/db.js'` 合并 `surveillanceDb`；新增服务 import）：

```js
import { surveillanceDb } from '../database/db.js';
import { runProjectSurveillance } from '../services/meta-analysis/surveillance/surveillance-service.js';
```

> 若 `../database/db.js` 已在文件里被解构 import，把 `surveillanceDb` 加进那个解构清单，而不是重复 import。

- [ ] **Step 2: 加 4 个路由**

在 `server/routes/meta-analysis.js` 中，其它 `/:metaProjectId/...` 路由附近（例如 analysis-runs 路由之后）追加：

```js
// --- Living-update surveillance (M3-B) ---
router.post('/:metaProjectId/surveillance/subscribe', async (req, res) => {
  try {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const subscription = surveillanceDb.createSubscription(req.user.id, {
      metaProjectId: metaProject.id,
      searchStrategy: req.body.searchStrategy || {},
      eligibility: req.body.eligibility || {},
      frequency: req.body.frequency || 'weekly',
    });
    res.json({ subscription });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create surveillance subscription' });
  }
});

router.get('/:metaProjectId/surveillance/subscription', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  res.json({ subscription: surveillanceDb.getSubscriptionByProject(metaProject.id) });
});

router.post('/:metaProjectId/surveillance/run', async (req, res) => {
  try {
    const metaProject = await loadMetaProject(req, res);
    if (!metaProject) return;
    const result = await runProjectSurveillance({ userId: req.user.id, metaProject });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Surveillance run failed' });
  }
});

router.get('/:metaProjectId/surveillance/runs', async (req, res) => {
  const metaProject = await loadMetaProject(req, res);
  if (!metaProject) return;
  res.json({ runs: surveillanceDb.listRuns(metaProject.id) });
});
```

- [ ] **Step 3: 手动冒烟（无 HTTP 测试框架）**

启动后端：`npx vite build >/dev/null 2>&1; node server/index.js`（或你的常规启动方式）。登录拿到会话后，对一个已存在的 meta 项目：
1. `POST /api/meta-analysis/:metaProjectId/surveillance/subscribe`，body 含 `searchStrategy.pubmed` 与 `eligibility`。
2. `POST /api/meta-analysis/:metaProjectId/surveillance/run`，确认返回 `{ run, changeSet }`，`changeSet.autoScreen` 有计数。
3. `GET /api/meta-analysis/:metaProjectId/surveillance/runs`，确认能列出刚才的 run。

> 路由仅转发到 Task 4 已测服务；若 run 报错先确认该项目已 subscribe。真实 PubMed 调用需要网络与 NCBI 可达。

- [ ] **Step 4: 回归**

Run: `npx vitest run`
Expected: 既有 + M0 + M3 + M3-B 全绿（路由改动不影响单测）。

- [ ] **Step 5: 提交**

```bash
git add server/routes/meta-analysis.js
git commit -m "feat(surveillance): subscribe/run/runs routes"
```

---

## 完成判定（M3-B DoD）

- [ ] `createPubmedSearchSource`（含 `[EDAT]` 增量）/ `createReferencesCorpus` / `createScreeningRecorder` 三个适配器各自测试通过。
- [ ] `runProjectSurveillance` 端到端测试通过：对真实语料库去重、自动纳入新研究、产生新 `ReferenceSet` 版本、级联 stale、持久化 run。
- [ ] 4 个路由就位，手动冒烟可订阅 / 立即巡检 / 查看运行。
- [ ] `npx vitest run` 全绿。

## 后续计划

1. **M3-B2（UI）**：`SurveillancePanel.tsx`（订阅表单 + "立即巡检"按钮 + ChangeSet 展示：新增研究、计数、`pendingReanalysis`）；接 `src/components/meta-analysis/api/metaAnalysisApi.ts` 新增方法；挂进 meta 项目面板 tab。
2. **调度器**：按 `subscription.frequency` 周期触发 `runProjectSurveillance`（仓库需新增轻量调度；或接现有 taskmaster 调度）。
3. **M1 衔接**：`pendingReanalysis.staleArtifactIds` → 触发 `netmeta`/`metafor` 重算，把 `conclusionsImpact` 升级为真实数值 diff。
