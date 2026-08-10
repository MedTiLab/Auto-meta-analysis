# M3 — 协议绑定活体更新器（巡检引擎）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"追踪模式"从按关键词的文献新闻流，升级为**协议绑定的活体巡检引擎**：注册一篇综述的锁定检索式 + 纳排标准后，每跑一轮就自动增量检索 → 对语料库去重 → 按锁定纳排自动初筛 → 命中的纳入并产生新 `ReferenceSet` 版本 → 经 M0 的依赖 DAG 把下游分析标 `stale` → 产出语料级 ChangeSet（"这次变了什么"）。

**Architecture:** 纯逻辑 + 服务层，建在 M0 的 Evidence Ledger 之上。新增两张表（`meta_surveillance_subscriptions` / `meta_surveillance_runs`）与 `surveillanceDb`；三个纯函数模块（`dedup.js` / `eligibility.js` / `change-set.js`）；一个编排器 `surveillance-engine.js`，其外部依赖（检索源、LLM 分类器、语料库读写、筛选写入）全部**依赖注入**，测试用假实现，唯独 Evidence Ledger 用真实 M0 模块（temp DB）以验证"新版本 + stale 级联"真的发生。

**Tech Stack:** Node.js (ESM), better-sqlite3, vitest, crypto。复用 M0 的 `evidenceLedgerDb` + `recordArtifact`，复用 `metaAnalysisDb.upsertScreeningDecision` 的 reviewer 约定。

---

## 前置说明（执行前必读）

- 依赖 **M0 已合并**（`feat/evidence-ledger`：`evidenceLedgerDb` + `recordArtifact` + `meta_evidence_artifacts` 表）。先确认这些存在再开工。
- **运行测试一律用 `npx vitest run <file>`（过滤加 `-t "<name>"`），不要用 `npm test`**（其 pretest `scripts/ensure-native-modules.js` 会 `npm rebuild sharp/sqlite3` 从源码编译，在沙箱里卡死；本计划只用 better-sqlite3，已编译好）。一次性探测：`npx vitest run server/__tests__/evidence-ledger-db.test.mjs`，若报 ABI 错只 `npm rebuild better-sqlite3`。
- 开分支：`git checkout -b feat/living-updater`（从合并了 M0 的主线切出）。每个 Task 末尾提交都落在该分支。

## 范围（重要）

**本计划做（全部建在 M0 之上、可单测）：** 协议订阅注册、巡检运行记录、增量检索（注入接口）、对语料库去重、规则纳排自动初筛（LLM 分类器作为可选注入）、命中纳入 → 新 `ReferenceSet` 版本、经 DAG 级联 stale、语料级 ChangeSet（含 `pendingReanalysis` 接口段）。

**本计划不做（接口预留 / 后续计划）：**
- **统计重算 + 数值级 diff**（OR 0.74→0.69、SUCRA 排名变化）依赖 **M1 的统计引擎**。本计划只产出 `pendingReanalysis.staleArtifactIds`（哪些分析需要重算）+ `conclusionsImpact:'unknown-pending-reanalysis'` 占位；M1 落地后填充真实数值。
- **定时调度器**（cron）：仓库无调度基础设施。本计划交付的是"一轮 cycle 的可调用引擎"，定时触发 + 路由 + 真实 PubMed/LLM 适配器留到 **M3-B**。
- **第 1 层选题雷达**（news-dashboard 升级）= 独立的 M2 计划。

## 复用约定

- 自动初筛写决策用 `reviewer = 'surveillance-agent'`（非人类）——`server/services/meta-analysis/workflow-gates.js` 的 `isHumanReviewer` 会把它判为 agent 决策，从而天然进入现有人工复核队列。
- 去重键：归一化 DOI、PMID（`source==='pubmed'` 时取 `sourceId`）、归一化标题。
- 新 `ReferenceSet` 版本 `producedBy:'surveillance'`，`inputs` 指向上一版 `ReferenceSet`（构成 DAG 边，触发下游 stale）。

---

## File Structure

| 文件 | 责任 |
| --- | --- |
| `server/database/db.js`（修改） | 新增 `META_SURVEILLANCE_SCHEMA_SQL` + 建表；定义并导出 `surveillanceDb`（订阅 + 运行 CRUD） |
| `server/services/meta-analysis/surveillance/dedup.js`（新建） | 纯函数：对语料库 + 批内去重 |
| `server/services/meta-analysis/surveillance/eligibility.js`（新建） | 纯函数：按机器可判谓词评估纳排 |
| `server/services/meta-analysis/surveillance/change-set.js`（新建） | 纯函数：组装语料级 ChangeSet（含 `pendingReanalysis` 接口段） |
| `server/services/meta-analysis/surveillance/surveillance-engine.js`（新建） | 编排器 `runSurveillanceCycle`（依赖注入） |
| `server/__tests__/surveillance-db.test.mjs`（新建） | 覆盖 `surveillanceDb` |
| `server/__tests__/surveillance-dedup.test.mjs`（新建） | 覆盖 dedup |
| `server/__tests__/surveillance-eligibility.test.mjs`（新建） | 覆盖 eligibility |
| `server/__tests__/surveillance-change-set.test.mjs`（新建） | 覆盖 change-set |
| `server/__tests__/surveillance-engine.test.mjs`（新建） | 覆盖引擎（真实 ledger + 假外部依赖） |

---

## Task 1: 巡检两张表

**Files:**
- Modify: `server/database/db.js`（在 `META_EVIDENCE_LEDGER_SCHEMA_SQL` 之后加常量；在 `db.exec(META_EVIDENCE_LEDGER_SCHEMA_SQL);` 之后加一行 exec）
- Test: `server/__tests__/surveillance-db.test.mjs`

- [ ] **Step 1: 写失败测试**

新建 `server/__tests__/surveillance-db.test.mjs`：

```js
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadDatabaseModule() {
  vi.resetModules();
  return import('../database/db.js');
}

describe('surveillanceDb', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-surveillance-db-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });
  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) { await fs.rm(tempRoot, { recursive: true, force: true }); tempRoot = null; }
  });

  it('creates surveillance tables on initialize', async () => {
    const { db, initializeDatabase } = await loadDatabaseModule();
    await initializeDatabase();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'meta_surveillance_%'")
      .all().map((r) => r.name);
    expect(tables).toContain('meta_surveillance_subscriptions');
    expect(tables).toContain('meta_surveillance_runs');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/surveillance-db.test.mjs -t "creates surveillance tables"`
Expected: FAIL（表不存在）。

- [ ] **Step 3: 加 schema 常量**

在 `server/database/db.js` 中，紧跟 `META_EVIDENCE_LEDGER_SCHEMA_SQL` 之后新增：

```js
const META_SURVEILLANCE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta_surveillance_subscriptions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    meta_project_id TEXT NOT NULL,
    search_strategy_json TEXT NOT NULL DEFAULT '{}',
    eligibility_json TEXT NOT NULL DEFAULT '{}',
    frequency TEXT NOT NULL DEFAULT 'weekly',
    status TEXT NOT NULL DEFAULT 'active',
    last_run_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meta_surveillance_subs_project
    ON meta_surveillance_subscriptions(meta_project_id);

  CREATE TABLE IF NOT EXISTS meta_surveillance_runs (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    meta_project_id TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    stats_json TEXT NOT NULL DEFAULT '{}',
    change_set_json TEXT,
    started_at DATETIME,
    finished_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meta_surveillance_runs_project
    ON meta_surveillance_runs(meta_project_id);
`;
```

- [ ] **Step 4: 接线建表**

在 `initializeDatabase()` 内、`db.exec(META_EVIDENCE_LEDGER_SCHEMA_SQL);` 之后新增：

```js
    db.exec(META_SURVEILLANCE_SCHEMA_SQL);
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run server/__tests__/surveillance-db.test.mjs -t "creates surveillance tables"`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add server/database/db.js server/__tests__/surveillance-db.test.mjs
git commit -m "feat(surveillance): add subscription and run tables"
```

---

## Task 2: `surveillanceDb` CRUD

**Files:**
- Modify: `server/database/db.js`（在 `export {` 块之前定义 mappers + `surveillanceDb`；加入导出）
- Test: `server/__tests__/surveillance-db.test.mjs`

- [ ] **Step 1: 写失败测试**

追加：

```js
  it('creates a subscription and records runs', async () => {
    const { surveillanceDb, initializeDatabase, userDb } = await loadDatabaseModule();
    await initializeDatabase();
    const user = userDb.createUser('surv-user', 'hashed-password');

    const sub = surveillanceDb.createSubscription(user.id, {
      metaProjectId: 'mp-1',
      searchStrategy: { pubmed: '("network meta-analysis"[tiab])' },
      eligibility: { includeKeywordsAny: ['network meta-analysis'] },
      frequency: 'weekly',
    });
    expect(sub.id).toBeTruthy();
    expect(sub.searchStrategy.pubmed).toContain('network meta-analysis');
    expect(sub.status).toBe('active');
    expect(surveillanceDb.getSubscriptionByProject('mp-1').id).toBe(sub.id);

    surveillanceDb.touchLastRun(sub.id, '2026-05-30T00:00:00.000Z');
    expect(surveillanceDb.getSubscription(sub.id).lastRunAt).toBe('2026-05-30T00:00:00.000Z');

    const run = surveillanceDb.recordRun(user.id, {
      subscriptionId: sub.id, metaProjectId: 'mp-1', status: 'completed',
      stats: { found: 3, novel: 2 }, changeSet: { autoScreen: { autoIncluded: 1 } },
      startedAt: '2026-05-30T00:00:00.000Z', finishedAt: '2026-05-30T00:01:00.000Z',
    });
    expect(run.stats.found).toBe(3);
    expect(run.changeSet.autoScreen.autoIncluded).toBe(1);
    expect(surveillanceDb.listRuns('mp-1')).toHaveLength(1);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/surveillance-db.test.mjs -t "creates a subscription and records runs"`
Expected: FAIL（无 `surveillanceDb`）。

- [ ] **Step 3: 实现 mappers + `surveillanceDb`**

在 `server/database/db.js` 的 `export {` 块之前新增：

```js
function mapSurveillanceSubscriptionRow(row) {
  if (!row) return null;
  return {
    id: row.id, userId: row.user_id, metaProjectId: row.meta_project_id,
    searchStrategy: JSON.parse(row.search_strategy_json || '{}'),
    eligibility: JSON.parse(row.eligibility_json || '{}'),
    frequency: row.frequency, status: row.status,
    lastRunAt: row.last_run_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapSurveillanceRunRow(row) {
  if (!row) return null;
  return {
    id: row.id, userId: row.user_id, metaProjectId: row.meta_project_id,
    subscriptionId: row.subscription_id, status: row.status,
    stats: JSON.parse(row.stats_json || '{}'),
    changeSet: row.change_set_json ? JSON.parse(row.change_set_json) : null,
    startedAt: row.started_at, finishedAt: row.finished_at, createdAt: row.created_at,
  };
}

const surveillanceDb = {
  createSubscription(userId, { metaProjectId, searchStrategy = {}, eligibility = {}, frequency = 'weekly' }) {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO meta_surveillance_subscriptions
        (id, user_id, meta_project_id, search_strategy_json, eligibility_json, frequency, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(id, userId, metaProjectId, JSON.stringify(searchStrategy), JSON.stringify(eligibility), frequency);
    return surveillanceDb.getSubscription(id);
  },
  getSubscription(id) {
    return mapSurveillanceSubscriptionRow(
      db.prepare('SELECT * FROM meta_surveillance_subscriptions WHERE id = ?').get(id)
    );
  },
  getSubscriptionByProject(metaProjectId) {
    return mapSurveillanceSubscriptionRow(
      db.prepare('SELECT * FROM meta_surveillance_subscriptions WHERE meta_project_id = ? ORDER BY created_at DESC LIMIT 1').get(metaProjectId)
    );
  },
  touchLastRun(id, isoTime) {
    db.prepare('UPDATE meta_surveillance_subscriptions SET last_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(isoTime, id);
  },
  recordRun(userId, { subscriptionId, metaProjectId, status = 'completed', stats = {}, changeSet = null, startedAt = null, finishedAt = null }) {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO meta_surveillance_runs
        (id, user_id, meta_project_id, subscription_id, status, stats_json, change_set_json, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, metaProjectId, subscriptionId, status, JSON.stringify(stats),
           changeSet === null ? null : JSON.stringify(changeSet), startedAt, finishedAt);
    return surveillanceDb.getRun(id);
  },
  getRun(id) {
    return mapSurveillanceRunRow(db.prepare('SELECT * FROM meta_surveillance_runs WHERE id = ?').get(id));
  },
  listRuns(metaProjectId) {
    return db.prepare('SELECT * FROM meta_surveillance_runs WHERE meta_project_id = ? ORDER BY created_at DESC').all(metaProjectId).map(mapSurveillanceRunRow);
  },
};
```

把 `surveillanceDb` 加进 `export {` 块（放在 `evidenceLedgerDb,` 之后）：

```js
  evidenceLedgerDb,
  surveillanceDb,
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/surveillance-db.test.mjs`
Expected: PASS（2 条用例）。

- [ ] **Step 5: 提交**

```bash
git add server/database/db.js server/__tests__/surveillance-db.test.mjs
git commit -m "feat(surveillance): subscription and run persistence"
```

---

## Task 3: `dedup.js`（对语料库 + 批内去重，纯函数）

**Files:**
- Create: `server/services/meta-analysis/surveillance/dedup.js`
- Test: `server/__tests__/surveillance-dedup.test.mjs`

- [ ] **Step 1: 写失败测试**

新建 `server/__tests__/surveillance-dedup.test.mjs`：

```js
import { describe, expect, it } from 'vitest';
import { normalizeDoi, normalizeTitle, dedupAgainstCorpus } from '../services/meta-analysis/surveillance/dedup.js';

describe('dedup helpers', () => {
  it('normalizes DOIs and titles', () => {
    expect(normalizeDoi('https://doi.org/10.1/AbC')).toBe('10.1/abc');
    expect(normalizeTitle('A  Network: Meta-Analysis!')).toBe('a network meta analysis');
  });
});

describe('dedupAgainstCorpus', () => {
  it('filters candidates already in corpus by DOI, PMID, or title', () => {
    const corpus = [
      { doi: '10.1/x', title: 'Existing paper one' },
      { source: 'pubmed', sourceId: '12345', title: 'Existing paper two' },
    ];
    const candidates = [
      { doi: '10.1/X', title: 'totally different title' },         // dup by DOI
      { pmid: '12345', title: 'another title' },                    // dup by PMID
      { title: 'Existing Paper One' },                              // dup by title
      { doi: '10.9/new', title: 'A brand new study' },              // novel
    ];
    const { novel, duplicates } = dedupAgainstCorpus(candidates, corpus);
    expect(novel.map((r) => r.title)).toEqual(['A brand new study']);
    expect(duplicates).toHaveLength(3);
  });

  it('also dedups repeats within the same batch', () => {
    const { novel } = dedupAgainstCorpus(
      [{ doi: '10.1/a', title: 'x' }, { doi: '10.1/a', title: 'y' }],
      [],
    );
    expect(novel).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/surveillance-dedup.test.mjs`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `dedup.js`**

新建 `server/services/meta-analysis/surveillance/dedup.js`：

```js
export function normalizeDoi(doi) {
  if (!doi) return null;
  const cleaned = String(doi).trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
  return cleaned || null;
}

export function normalizeTitle(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function getPmid(ref) {
  if (ref.pmid) return String(ref.pmid);
  if (ref.source === 'pubmed' && ref.sourceId) return String(ref.sourceId);
  return null;
}

function emptyIndex() {
  return { dois: new Set(), pmids: new Set(), titles: new Set() };
}

function addToIndex(index, ref) {
  const doi = normalizeDoi(ref.doi);
  if (doi) index.dois.add(doi);
  const pmid = getPmid(ref);
  if (pmid) index.pmids.add(pmid);
  const title = normalizeTitle(ref.title);
  if (title) index.titles.add(title);
}

export function buildCorpusIndex(corpusRefs = []) {
  const index = emptyIndex();
  for (const ref of corpusRefs) addToIndex(index, ref);
  return index;
}

export function isDuplicate(candidate, index) {
  const doi = normalizeDoi(candidate.doi);
  if (doi && index.dois.has(doi)) return true;
  const pmid = getPmid(candidate);
  if (pmid && index.pmids.has(pmid)) return true;
  const title = normalizeTitle(candidate.title);
  if (title && index.titles.has(title)) return true;
  return false;
}

export function dedupAgainstCorpus(candidates = [], corpusRefs = []) {
  const corpusIndex = buildCorpusIndex(corpusRefs);
  const batchIndex = emptyIndex();
  const novel = [];
  const duplicates = [];
  for (const candidate of candidates) {
    if (isDuplicate(candidate, corpusIndex) || isDuplicate(candidate, batchIndex)) {
      duplicates.push(candidate);
    } else {
      novel.push(candidate);
      addToIndex(batchIndex, candidate);
    }
  }
  return { novel, duplicates };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/surveillance-dedup.test.mjs`
Expected: PASS（3 条用例）。

- [ ] **Step 5: 提交**

```bash
git add server/services/meta-analysis/surveillance/dedup.js server/__tests__/surveillance-dedup.test.mjs
git commit -m "feat(surveillance): corpus and in-batch dedup"
```

---

## Task 4: `eligibility.js`（按机器可判谓词评估纳排，纯函数）

**Files:**
- Create: `server/services/meta-analysis/surveillance/eligibility.js`
- Test: `server/__tests__/surveillance-eligibility.test.mjs`

- [ ] **Step 1: 写失败测试**

新建 `server/__tests__/surveillance-eligibility.test.mjs`：

```js
import { describe, expect, it } from 'vitest';
import { evaluateEligibility } from '../services/meta-analysis/surveillance/eligibility.js';

const predicates = {
  yearMin: 2015,
  includeKeywordsAny: ['network meta-analysis', 'nma'],
  excludeKeywords: ['protocol only', 'retracted'],
  studyTypesExclude: ['animal study'],
};

describe('evaluateEligibility', () => {
  it('excludes out-of-range years with high confidence', () => {
    const r = evaluateEligibility({ title: 'An NMA', year: 2010 }, predicates);
    expect(r.decision).toBe('exclude');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('excludes on exclude keyword', () => {
    const r = evaluateEligibility({ title: 'A retracted network meta-analysis', year: 2020 }, predicates);
    expect(r.decision).toBe('exclude');
  });

  it('includes when an include keyword matches and nothing excludes', () => {
    const r = evaluateEligibility({ title: 'A network meta-analysis of anticoagulants', abstract: '', year: 2024 }, predicates);
    expect(r.decision).toBe('include');
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('returns maybe with low confidence when nothing clearly matches', () => {
    const r = evaluateEligibility({ title: 'A narrative review of clotting', year: 2024 }, predicates);
    expect(r.decision).toBe('maybe');
    expect(r.confidence).toBeLessThan(0.8);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/surveillance-eligibility.test.mjs`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `eligibility.js`**

新建 `server/services/meta-analysis/surveillance/eligibility.js`：

```js
// 机器可判的纳排评估。返回 { decision: 'include'|'exclude'|'maybe', confidence, reasons }。
// 自动决策阈值由引擎持有（默认 0.8）；本函数只给出判定与置信度。
export function evaluateEligibility(ref, predicates = {}) {
  const haystack = `${ref.title || ''} ${ref.abstract || ''}`.toLowerCase();
  const year = Number(ref.year);

  // ---- 硬排除 ----
  if (predicates.yearMin && year && year < predicates.yearMin) {
    return { decision: 'exclude', confidence: 0.95, reasons: [`year ${year} < yearMin ${predicates.yearMin}`] };
  }
  if (predicates.yearMax && year && year > predicates.yearMax) {
    return { decision: 'exclude', confidence: 0.95, reasons: [`year ${year} > yearMax ${predicates.yearMax}`] };
  }
  for (const kw of predicates.excludeKeywords || []) {
    if (haystack.includes(String(kw).toLowerCase())) {
      return { decision: 'exclude', confidence: 0.9, reasons: [`matched excludeKeyword "${kw}"`] };
    }
  }
  for (const st of predicates.studyTypesExclude || []) {
    if (haystack.includes(String(st).toLowerCase())) {
      return { decision: 'exclude', confidence: 0.85, reasons: [`matched excluded study type "${st}"`] };
    }
  }

  // ---- 纳入 ----
  const allList = predicates.includeKeywordsAll || [];
  const allOk = allList.every((kw) => haystack.includes(String(kw).toLowerCase()));
  if (allList.length && !allOk) {
    return { decision: 'maybe', confidence: 0.4, reasons: ['missing one or more required includeKeywordsAll'] };
  }
  const anyList = predicates.includeKeywordsAny || [];
  const anyOk = anyList.length === 0 ? true : anyList.some((kw) => haystack.includes(String(kw).toLowerCase()));
  const typeList = predicates.studyTypesInclude || [];
  const typeOk = typeList.length === 0 ? true : typeList.some((st) => haystack.includes(String(st).toLowerCase()));

  if (anyOk && typeOk) {
    return { decision: 'include', confidence: 0.85, reasons: ['matched include criteria'] };
  }
  return { decision: 'maybe', confidence: 0.4, reasons: ['did not clearly match include criteria'] };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/surveillance-eligibility.test.mjs`
Expected: PASS（4 条用例）。

- [ ] **Step 5: 提交**

```bash
git add server/services/meta-analysis/surveillance/eligibility.js server/__tests__/surveillance-eligibility.test.mjs
git commit -m "feat(surveillance): rule-based eligibility evaluation"
```

---

## Task 5: `change-set.js`（语料级 ChangeSet + `pendingReanalysis` 接口段，纯函数）

**Files:**
- Create: `server/services/meta-analysis/surveillance/change-set.js`
- Test: `server/__tests__/surveillance-change-set.test.mjs`

- [ ] **Step 1: 写失败测试**

新建 `server/__tests__/surveillance-change-set.test.mjs`：

```js
import { describe, expect, it } from 'vitest';
import { buildChangeSet } from '../services/meta-analysis/surveillance/change-set.js';

describe('buildChangeSet', () => {
  const base = {
    subscription: { id: 'sub-1', metaProjectId: 'mp-1' },
    search: { found: 5, since: '2026-05-01T00:00:00.000Z' },
    dedup: { novel: 2, duplicates: 3 },
    autoScreen: { autoIncluded: 1, autoExcluded: 0, toReview: 1 },
    includedStudies: [{ referenceId: 'ref-9', title: 'New NMA', confidence: 0.85 }],
    generatedAt: '2026-05-30T00:00:00.000Z',
  };

  it('flags pending reanalysis when downstream artifacts are stale', () => {
    const cs = buildChangeSet({ ...base, referenceSet: { priorVersion: 1, newVersion: 2 }, staleArtifactIds: ['a1', 'a2'] });
    expect(cs.metaProjectId).toBe('mp-1');
    expect(cs.referenceSet.newVersion).toBe(2);
    expect(cs.pendingReanalysis.staleArtifactIds).toEqual(['a1', 'a2']);
    expect(cs.conclusionsImpact).toBe('unknown-pending-reanalysis');
  });

  it('reports no-change when nothing was integrated', () => {
    const cs = buildChangeSet({ ...base, referenceSet: null, staleArtifactIds: [] });
    expect(cs.referenceSet).toBeNull();
    expect(cs.pendingReanalysis.staleArtifactIds).toEqual([]);
    expect(cs.conclusionsImpact).toBe('no-change');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/surveillance-change-set.test.mjs`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `change-set.js`**

新建 `server/services/meta-analysis/surveillance/change-set.js`：

```js
// 语料级 ChangeSet。统计/数值级 diff（效应量、SUCRA 变化）由 M1 落地后填充 pendingReanalysis。
export function buildChangeSet({
  subscription, search, dedup, autoScreen,
  includedStudies = [], referenceSet = null, staleArtifactIds = [], generatedAt,
}) {
  const stale = staleArtifactIds || [];
  const hasReanalysis = stale.length > 0;
  return {
    generatedAt,
    subscriptionId: subscription.id,
    metaProjectId: subscription.metaProjectId,
    search,
    dedup,
    autoScreen,
    includedStudies,
    referenceSet,
    pendingReanalysis: {
      staleArtifactIds: stale,
      note: hasReanalysis
        ? 'Downstream artifacts are stale; statistical re-analysis (M1) required to compute effect-size and ranking deltas.'
        : 'No downstream re-analysis required.',
    },
    conclusionsImpact: hasReanalysis ? 'unknown-pending-reanalysis' : 'no-change',
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/surveillance-change-set.test.mjs`
Expected: PASS（2 条用例）。

- [ ] **Step 5: 提交**

```bash
git add server/services/meta-analysis/surveillance/change-set.js server/__tests__/surveillance-change-set.test.mjs
git commit -m "feat(surveillance): corpus-level change-set with M1 reanalysis interface"
```

---

## Task 6: `surveillance-engine.js` —— `runSurveillanceCycle`（主路径，真实 Ledger + 假外部依赖）

这是核心红绿任务。引擎用**依赖注入**：`searchSource`/`classifier`/`corpus`/`screening` 注入假实现，`ledger`（M0）与 `surveillanceDb` 用真实模块（temp DB），以验证"新 `ReferenceSet` 版本 + 下游 stale 级联"真的发生。

**Files:**
- Create: `server/services/meta-analysis/surveillance/surveillance-engine.js`
- Test: `server/__tests__/surveillance-engine.test.mjs`

- [ ] **Step 1: 写失败测试**

新建 `server/__tests__/surveillance-engine.test.mjs`：

```js
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadModules() {
  vi.resetModules();
  const dbModule = await import('../database/db.js');
  const ledgerModule = await import('../services/meta-analysis/evidence-ledger.js');
  const engineModule = await import('../services/meta-analysis/surveillance/surveillance-engine.js');
  return { ...dbModule, ...ledgerModule, ...engineModule };
}

// In-memory fake corpus: list() returns current rows, add() assigns ids.
function makeFakeCorpus(initial = []) {
  const store = initial.map((r, i) => ({ id: `seed-${i}`, ...r }));
  let seq = store.length;
  return {
    store,
    list: async () => store,
    add: async (_userId, _metaProjectId, ref) => { const id = `ref-${++seq}`; store.push({ id, ...ref }); return { id }; },
  };
}

function makeFakeScreening() {
  const calls = [];
  return { calls, record: async (payload) => { calls.push(payload); return payload; } };
}

function buildLedgerDeps(mod) {
  // ledger interface the engine needs: recordArtifact (slot) + two read primitives.
  return {
    recordArtifact: mod.recordArtifact,
    getLatestArtifact: mod.evidenceLedgerDb.getLatestArtifact,
    collectTransitiveDependents: mod.evidenceLedgerDb.collectTransitiveDependents,
  };
}

describe('runSurveillanceCycle', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-surv-engine-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });
  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) { await fs.rm(tempRoot, { recursive: true, force: true }); tempRoot = null; }
  });

  it('auto-includes a new study, creates a new ReferenceSet version, and cascades stale to dependents', async () => {
    const mod = await loadModules();
    const { initializeDatabase, userDb, evidenceLedgerDb, recordArtifact, surveillanceDb, runSurveillanceCycle } = mod;
    await initializeDatabase();
    const user = userDb.createUser('surv-user', 'hashed-password');

    // Seed prior ReferenceSet v1 + a dependent AnalysisRun (no validators registered -> both validated).
    const refsV1 = recordArtifact(user.id, { metaProjectId: 'mp-1', type: 'ReferenceSet', payload: { addedReferenceIds: [] } }).artifact;
    const analysis = recordArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'AnalysisRun', payload: { note: 'baseline' },
      inputs: [{ artifactId: refsV1.id, version: refsV1.version }],
    }).artifact;
    expect(analysis.status).toBe('validated');

    const subscription = surveillanceDb.createSubscription(user.id, {
      metaProjectId: 'mp-1',
      searchStrategy: { pubmed: '("network meta-analysis"[tiab])' },
      eligibility: { includeKeywordsAny: ['network meta-analysis'] },
    });

    const corpus = makeFakeCorpus([]);
    const screening = makeFakeScreening();
    const searchSource = { search: async () => ([
      { doi: '10.9/new', title: 'A new network meta-analysis of DOACs', abstract: '', year: 2026 },
    ]) };

    const { run, changeSet } = await runSurveillanceCycle({
      userId: user.id,
      subscription,
      deps: { searchSource, corpus, screening, ledger: buildLedgerDeps(mod), surveillanceDb, clock: { now: () => '2026-05-30T00:00:00.000Z' } },
    });

    // auto-included
    expect(changeSet.autoScreen.autoIncluded).toBe(1);
    expect(screening.calls[0].reviewer).toBe('surveillance-agent');
    expect(screening.calls[0].decision).toBe('include');

    // new ReferenceSet version
    expect(changeSet.referenceSet.priorVersion).toBe(1);
    expect(changeSet.referenceSet.newVersion).toBe(2);
    expect(evidenceLedgerDb.getLatestArtifact('mp-1', 'ReferenceSet').version).toBe(2);

    // stale cascade to the dependent analysis
    expect(evidenceLedgerDb.getArtifact(analysis.id).status).toBe('stale');
    expect(changeSet.pendingReanalysis.staleArtifactIds).toContain(analysis.id);

    // run persisted + lastRunAt advanced
    expect(surveillanceDb.getRun(run.id).stats.autoIncluded).toBe(1);
    expect(surveillanceDb.getSubscription(subscription.id).lastRunAt).toBe('2026-05-30T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/surveillance-engine.test.mjs -t "auto-includes a new study"`
Expected: FAIL（找不到 `surveillance-engine.js`）。

- [ ] **Step 3: 实现引擎**

新建 `server/services/meta-analysis/surveillance/surveillance-engine.js`：

```js
import { evaluateEligibility } from './eligibility.js';
import { dedupAgainstCorpus } from './dedup.js';
import { buildChangeSet } from './change-set.js';

export const AUTO_DECISION_CONFIDENCE_THRESHOLD = 0.8;
const SURVEILLANCE_AGENT_REVIEWER = 'surveillance-agent';

export async function runSurveillanceCycle({ userId, subscription, deps }) {
  const { searchSource, classifier = null, corpus, screening, ledger, surveillanceDb, clock = null } = deps;
  const now = () => (clock && clock.now ? clock.now() : new Date().toISOString());
  const metaProjectId = subscription.metaProjectId;
  const startedAt = now();

  // 1. incremental search with the locked strategy
  const candidates = await searchSource.search(subscription.searchStrategy, { since: subscription.lastRunAt || null });

  // 2. dedup against the existing corpus (+ within batch)
  const corpusRefs = await corpus.list(metaProjectId);
  const { novel, duplicates } = dedupAgainstCorpus(candidates, corpusRefs);

  // 3. auto-screen novel candidates against locked eligibility
  const includedStudies = [];
  let autoIncluded = 0;
  let autoExcluded = 0;
  let toReview = 0;

  for (const candidate of novel) {
    const verdict = classifier
      ? await classifier.classify(candidate, subscription.eligibility)
      : evaluateEligibility(candidate, subscription.eligibility);

    const added = await corpus.add(userId, metaProjectId, candidate);
    const referenceId = added.id;
    const confident = Number(verdict.confidence) >= AUTO_DECISION_CONFIDENCE_THRESHOLD;

    let decision;
    if (confident && verdict.decision === 'include') {
      decision = 'include';
      autoIncluded += 1;
      includedStudies.push({ referenceId, title: candidate.title, confidence: verdict.confidence });
    } else if (confident && verdict.decision === 'exclude') {
      decision = 'exclude';
      autoExcluded += 1;
    } else {
      decision = 'maybe';
      toReview += 1;
    }

    await screening.record({
      userId, metaProjectId, referenceId,
      decision, confidence: verdict.confidence,
      reviewer: SURVEILLANCE_AGENT_REVIEWER,
      reason: (verdict.reasons || []).join('; '),
    });
  }

  // 4. integrate new includes -> new ReferenceSet version (M0 slot cascades stale to prior dependents)
  let referenceSet = null;
  let staleArtifactIds = [];
  if (includedStudies.length > 0) {
    const prior = ledger.getLatestArtifact(metaProjectId, 'ReferenceSet');
    // Capture the prior version's downstream dependents BEFORE recording the new version.
    staleArtifactIds = prior ? ledger.collectTransitiveDependents(prior.id) : [];
    // IMPORTANT: the new ReferenceSet version's `inputs` are its DERIVATION sources (search/screening),
    // NOT the prior version. Version succession is tracked by `version`. If we linked the prior here,
    // the prior's stale-cascade (run inside recordArtifact) would also mark this brand-new version
    // stale. Keep inputs empty in this slice; M3-B wires real SearchRun/ScreeningDecisionSet inputs.
    const { artifact } = ledger.recordArtifact(userId, {
      metaProjectId, type: 'ReferenceSet', producedBy: 'surveillance',
      inputs: [],
      payload: { surveillance: true, addedReferenceIds: includedStudies.map((s) => s.referenceId) },
    });
    referenceSet = { priorVersion: prior ? prior.version : null, newVersion: artifact.version };
  }

  // 5. assemble change-set
  const changeSet = buildChangeSet({
    subscription,
    search: { found: candidates.length, since: subscription.lastRunAt || null },
    dedup: { novel: novel.length, duplicates: duplicates.length },
    autoScreen: { autoIncluded, autoExcluded, toReview },
    includedStudies,
    referenceSet,
    staleArtifactIds,
    generatedAt: now(),
  });

  // 6. persist run + advance lastRunAt
  const finishedAt = now();
  const run = surveillanceDb.recordRun(userId, {
    subscriptionId: subscription.id,
    metaProjectId,
    status: 'completed',
    stats: { found: candidates.length, novel: novel.length, duplicates: duplicates.length, autoIncluded, autoExcluded, toReview },
    changeSet,
    startedAt,
    finishedAt,
  });
  surveillanceDb.touchLastRun(subscription.id, finishedAt);

  return { run, changeSet };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/surveillance-engine.test.mjs -t "auto-includes a new study"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/services/meta-analysis/surveillance/surveillance-engine.js server/__tests__/surveillance-engine.test.mjs
git commit -m "feat(surveillance): living-update cycle engine on the evidence ledger"
```

---

## Task 7: 覆盖 —— 边界候选进人工队列、不产生新版本

行为已由 Task 6 的引擎实现，本任务**应直接 PASS**（覆盖测试，非红绿）。

**Files:**
- Test: `server/__tests__/surveillance-engine.test.mjs`

- [ ] **Step 1: 写测试**

在 `surveillance-engine.test.mjs` 的 `describe` 内追加：

```js
  it('routes borderline candidates to human review without creating a new version', async () => {
    const mod = await loadModules();
    const { initializeDatabase, userDb, evidenceLedgerDb, recordArtifact, surveillanceDb, runSurveillanceCycle } = mod;
    await initializeDatabase();
    const user = userDb.createUser('surv-user', 'hashed-password');

    const refsV1 = recordArtifact(user.id, { metaProjectId: 'mp-1', type: 'ReferenceSet', payload: { addedReferenceIds: [] } }).artifact;

    const subscription = surveillanceDb.createSubscription(user.id, {
      metaProjectId: 'mp-1',
      eligibility: { includeKeywordsAny: ['network meta-analysis'] },
    });

    const corpus = makeFakeCorpus([]);
    const screening = makeFakeScreening();
    const searchSource = { search: async () => ([
      { doi: '10.9/maybe', title: 'A narrative overview of clotting', abstract: '', year: 2026 },
    ]) };

    const { changeSet } = await runSurveillanceCycle({
      userId: user.id, subscription,
      deps: { searchSource, corpus, screening, ledger: buildLedgerDeps(mod), surveillanceDb, clock: { now: () => '2026-05-30T00:00:00.000Z' } },
    });

    expect(changeSet.autoScreen.toReview).toBe(1);
    expect(changeSet.autoScreen.autoIncluded).toBe(0);
    expect(screening.calls[0].decision).toBe('maybe');
    expect(changeSet.referenceSet).toBeNull();
    expect(changeSet.conclusionsImpact).toBe('no-change');
    expect(evidenceLedgerDb.getLatestArtifact('mp-1', 'ReferenceSet').version).toBe(1); // unchanged
  });
```

- [ ] **Step 2: 运行确认通过（覆盖测试，应直接 PASS）**

Run: `npx vitest run server/__tests__/surveillance-engine.test.mjs -t "routes borderline candidates"`
Expected: PASS。若 FAIL，检查 Task 6 引擎的 `confident && include` 分支与阈值常量。

- [ ] **Step 3: 提交**

```bash
git add server/__tests__/surveillance-engine.test.mjs
git commit -m "test(surveillance): borderline candidates go to human review queue"
```

---

## Task 8: 覆盖 —— 去重过滤已在库的候选

行为已由 Task 6 + Task 3 实现，本任务**应直接 PASS**（覆盖测试）。

**Files:**
- Test: `server/__tests__/surveillance-engine.test.mjs`

- [ ] **Step 1: 写测试**

追加：

```js
  it('skips candidates already present in the corpus', async () => {
    const mod = await loadModules();
    const { initializeDatabase, userDb, recordArtifact, surveillanceDb, runSurveillanceCycle } = mod;
    await initializeDatabase();
    const user = userDb.createUser('surv-user', 'hashed-password');
    recordArtifact(user.id, { metaProjectId: 'mp-1', type: 'ReferenceSet', payload: { addedReferenceIds: [] } });

    const subscription = surveillanceDb.createSubscription(user.id, {
      metaProjectId: 'mp-1', eligibility: { includeKeywordsAny: ['network meta-analysis'] },
    });

    // Corpus already contains the DOI the search will return.
    const corpus = makeFakeCorpus([{ doi: '10.9/dup', title: 'Already known NMA' }]);
    const screening = makeFakeScreening();
    const searchSource = { search: async () => ([
      { doi: '10.9/DUP', title: 'Already known NMA (reprint)', abstract: '', year: 2026 },
    ]) };

    const { changeSet } = await runSurveillanceCycle({
      userId: user.id, subscription,
      deps: { searchSource, corpus, screening, ledger: buildLedgerDeps(mod), surveillanceDb, clock: { now: () => '2026-05-30T00:00:00.000Z' } },
    });

    expect(changeSet.search.found).toBe(1);
    expect(changeSet.dedup.duplicates).toBe(1);
    expect(changeSet.dedup.novel).toBe(0);
    expect(screening.calls).toHaveLength(0); // nothing screened
    expect(changeSet.referenceSet).toBeNull();
  });
```

- [ ] **Step 2: 运行确认通过（覆盖测试，应直接 PASS）**

Run: `npx vitest run server/__tests__/surveillance-engine.test.mjs -t "skips candidates already present"`
Expected: PASS。

- [ ] **Step 3: 整套巡检测试 + 回归**

Run: `npx vitest run server/__tests__/surveillance-db.test.mjs server/__tests__/surveillance-dedup.test.mjs server/__tests__/surveillance-eligibility.test.mjs server/__tests__/surveillance-change-set.test.mjs server/__tests__/surveillance-engine.test.mjs`
Expected: 5 个文件全部 PASS。
然后整套回归：`npx vitest run`
Expected: 既有测试 + M0 + M3 全绿。

- [ ] **Step 4: 提交**

```bash
git add server/__tests__/surveillance-engine.test.mjs
git commit -m "test(surveillance): dedup skips corpus-known candidates"
```

---

## 完成判定（M3 巡检引擎 DoD）

- [ ] `meta_surveillance_subscriptions` / `meta_surveillance_runs` 两表随 `initializeDatabase()` 建立；`surveillanceDb` 提供订阅 + 运行 CRUD。
- [ ] `dedup.js` / `eligibility.js` / `change-set.js` 三个纯函数模块各自单测通过。
- [ ] `runSurveillanceCycle` 一轮闭环可跑：增量检索 → 去重 → 自动初筛（`reviewer='surveillance-agent'`）→ 命中纳入 → **新 `ReferenceSet` 版本（经 M0 slot）→ 下游 DAG 级联 stale** → ChangeSet（含 `pendingReanalysis.staleArtifactIds` 接口段）→ 持久化 run + 推进 `lastRunAt`。
- [ ] 边界候选进人工队列、不产生新版本；已在库候选被去重跳过。
- [ ] `npx vitest run` 全绿。

## 后续计划（不在本切片）

1. **M3-B**：真实适配器 + 调度。`searchSource` 接 `pubmed-client.js`（`buildPubMedQuery`/`searchPubMed`/`normalizePubMedRecord` + 增量日期约束）；`corpus` 接 `referencesDb`（`getProjectReferences`/`importReferences` + project 关联）；`screening.record` 接 `metaAnalysisDb.upsertScreeningDecision`；新增"立即巡检一次"路由 + 周期调度器（按 `frequency`）。
2. **M1 衔接**：`pendingReanalysis.staleArtifactIds` 触发 `netmeta`/`metafor` 重算，把 ChangeSet 的 `conclusionsImpact` 从占位升级为真实效应量/SUCRA 数值级 diff。
3. **M2**：第 1 层选题雷达（news-dashboard 升级）。
4. **发布(M4)**：ChangeSet 汇成发布站点的 "living update" 高亮。
