# M0 — Evidence Ledger + 校验器框架 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立"工件中心硬骨架"的数据层基石——一个类型化、版本化、内容寻址、带依赖 DAG 与受校验写入槽的 Evidence Ledger，让任何分析工件必须过校验器才能成为 `validated`。

**Architecture:** 在现有 `better-sqlite3` 上新增两张表（`meta_evidence_artifacts` + `meta_evidence_artifact_edges`），通过 `db.js` 导出 `evidenceLedgerDb` 原语；在 `server/services/meta-analysis/` 下新增 `evidence-ledger.js`（受校验写入槽 `recordArtifact` + 校验器注册表）与 `evidence-validators.js`（两个真实校验器：提取溯源、分析计划一致性）。纯数据/服务层，全部用 vitest 单测覆盖，不触碰 UI 与现有路由。

**Tech Stack:** Node.js (ESM), better-sqlite3, vitest, crypto (sha256 / randomUUID)。

---

## 前置说明（执行前必读）

- 当前仓库在 `main` 分支且工作区有未提交改动。**开始前先新建分支**（或用 worktree）：
  ```bash
  git checkout -b feat/evidence-ledger
  ```
  本计划每个 Task 末尾的 `git commit` 都应落在这个分支上，不要污染 `main`。
- 这是 spec `docs/superpowers/specs/2026-05-30-meta-living-evidence-architecture-design.md` 的 **M0 第一切片**。它**不**包含：UI 面板改造、现有 `meta-analysis.js` 端点迁移、Profile/FSM 引擎、完整 per-type JSON Schema。这些在后续计划（M0-B、M1）里做。
- **运行测试用 `npx vitest run <file>`**（单测过滤加 `-t "<name>"`）。**不要用 `npm test`**：它的 pretest 会先跑 `node scripts/ensure-native-modules.js`，在 Node ABI 不匹配或沙箱无网络时会触发 `npm rebuild better-sqlite3 bcrypt sharp sqlite3` 从源码编译 sharp/sqlite3，耗时数分钟甚至卡死。本计划只用到 better-sqlite3，`npx vitest run` 直连 Vitest、绕过该前置。
- **一次性环境准备**：先跑一次 `npx vitest run server/__tests__/concepts-db.test.mjs` 探测。若报 `NODE_MODULE_VERSION` / ABI 不匹配，只重建需要的那个：`npm rebuild better-sqlite3`（约 10s），不要去碰 sharp/sqlite3/bcrypt。之后所有任务都用 `npx vitest run`。

## 命名约定（避免与现有"artifacts"撞车）

- 现有 `server/utils/meta-analysis-artifacts.js` = 文件系统编号目录布局，**保持不动**。
- 本计划的"工件存储" = **Evidence Ledger**：表 `meta_evidence_artifacts` / `meta_evidence_artifact_edges`，DB 模块 `evidenceLedgerDb`，服务 `evidence-ledger.js`。

## 工件状态与类型（本切片用到的约定）

- 状态机：`draft`（已写入未过校验）→ `validated`（过校验或人工 override）→ `stale`（上游出新版本导致失效）；`locked`（发布快照，本切片只保证不被 stale 覆盖，不主动产生）。
- 类型字符串（自由文本，本切片不做枚举强校验）：`Protocol` `SearchRun` `ReferenceSet` `ScreeningDecisionSet` `ExtractionSet` `AnalysisRun` 等。

---

## File Structure

| 文件 | 责任 |
| --- | --- |
| `server/database/db.js`（修改） | 新增 `META_EVIDENCE_LEDGER_SCHEMA_SQL` + 建表调用；定义并导出 `evidenceLedgerDb`（纯 DB 原语：CRUD/版本/内容哈希/DAG/状态） |
| `server/services/meta-analysis/evidence-ledger.js`（新建） | 受校验写入槽 `recordArtifact`、校验器注册表（`registerValidator`/`runValidators`）、`overrideValidation` |
| `server/services/meta-analysis/evidence-validators.js`（新建） | 两个真实校验器 + `registerCoreEvidenceValidators()` 接线 |
| `server/__tests__/evidence-ledger-db.test.mjs`（新建） | 覆盖 `evidenceLedgerDb` 原语 |
| `server/__tests__/evidence-ledger-slot.test.mjs`（新建） | 覆盖写入槽 + stale 传播 + override |
| `server/__tests__/evidence-validators.test.mjs`（新建） | 覆盖两个校验器与核心接线 |

---

## Task 1: 建 Evidence Ledger 两张表

**Files:**
- Modify: `server/database/db.js`（在 `META_ANALYSIS_SCHEMA_SQL` 模板字符串之后新增常量；在 `db.exec(META_ANALYSIS_SCHEMA_SQL);`（约 `db.js:335`）之后新增一行 exec）
- Test: `server/__tests__/evidence-ledger-db.test.mjs`

- [ ] **Step 1: 写失败测试**

新建 `server/__tests__/evidence-ledger-db.test.mjs`：

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

describe('evidenceLedgerDb schema', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-evidence-ledger-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });

  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('creates the evidence ledger tables on initialize', async () => {
    const { db, initializeDatabase } = await loadDatabaseModule();
    await initializeDatabase();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'meta_evidence_%'")
      .all()
      .map((r) => r.name);
    expect(tables).toContain('meta_evidence_artifacts');
    expect(tables).toContain('meta_evidence_artifact_edges');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/evidence-ledger-db.test.mjs -t "creates the evidence ledger tables"`
Expected: FAIL（`expect(tables).toContain('meta_evidence_artifacts')` 不满足，因为表还没建）。

- [ ] **Step 3: 加 schema 常量**

在 `server/database/db.js` 中，紧跟在 `META_ANALYSIS_SCHEMA_SQL` 模板字符串定义之后，新增：

```js
const META_EVIDENCE_LEDGER_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta_evidence_artifacts (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    meta_project_id TEXT NOT NULL,
    type TEXT NOT NULL,
    version INTEGER NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    produced_by TEXT NOT NULL DEFAULT 'panel',
    inputs_json TEXT NOT NULL DEFAULT '[]',
    content_hash TEXT NOT NULL,
    payload_json TEXT,
    blob_ref TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    validation_json TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meta_evidence_artifacts_project_type
    ON meta_evidence_artifacts(meta_project_id, type);
  CREATE INDEX IF NOT EXISTS idx_meta_evidence_artifacts_status
    ON meta_evidence_artifacts(meta_project_id, status);

  CREATE TABLE IF NOT EXISTS meta_evidence_artifact_edges (
    from_artifact_id TEXT NOT NULL,
    to_artifact_id TEXT NOT NULL,
    PRIMARY KEY (from_artifact_id, to_artifact_id),
    FOREIGN KEY (from_artifact_id) REFERENCES meta_evidence_artifacts(id) ON DELETE CASCADE,
    FOREIGN KEY (to_artifact_id) REFERENCES meta_evidence_artifacts(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meta_evidence_edges_from
    ON meta_evidence_artifact_edges(from_artifact_id);
`;
```

> 说明：`meta_project_id` 故意**不加 FK**（保持 Ledger 与 `meta_projects` 解耦、便于独立单测）；`user_id` 沿用现有约定加 FK。后续计划接入真实项目后可再补 FK。

- [ ] **Step 4: 接线建表**

在 `server/database/db.js` 的 `initializeDatabase()` 内，找到 `db.exec(META_ANALYSIS_SCHEMA_SQL);`（约 `db.js:335`），在其后新增一行：

```js
    db.exec(META_EVIDENCE_LEDGER_SCHEMA_SQL);
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run server/__tests__/evidence-ledger-db.test.mjs -t "creates the evidence ledger tables"`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add server/database/db.js server/__tests__/evidence-ledger-db.test.mjs
git commit -m "feat(ledger): add evidence ledger tables"
```

---

## Task 2: `evidenceLedgerDb.createArtifact` + `getArtifact`（版本号 + 内容哈希）

**Files:**
- Modify: `server/database/db.js`（在 `export {` 块（约 `db.js:5319`）之前定义 `evidenceLedgerDb` 与两个 helper；并把 `evidenceLedgerDb` 加入导出）
- Test: `server/__tests__/evidence-ledger-db.test.mjs`

- [ ] **Step 1: 写失败测试**

在 `evidence-ledger-db.test.mjs` 的 `describe` 内追加：

```js
  it('assigns monotonic versions per (project,type) and hashes content', async () => {
    const { evidenceLedgerDb, initializeDatabase, userDb } = await loadDatabaseModule();
    await initializeDatabase();
    const user = userDb.createUser('ledger-user', 'hashed-password');

    const v1 = evidenceLedgerDb.createArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'ReferenceSet', payload: { count: 10 },
    });
    const v2 = evidenceLedgerDb.createArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'ReferenceSet', payload: { count: 12 },
    });
    const other = evidenceLedgerDb.createArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'ScreeningDecisionSet', payload: { included: 5 },
    });

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(other.version).toBe(1);
    expect(v1.status).toBe('draft');
    expect(v1.payload).toEqual({ count: 10 });
    expect(typeof v1.contentHash).toBe('string');
    expect(v1.contentHash).not.toBe(v2.contentHash);

    const fetched = evidenceLedgerDb.getArtifact(v1.id);
    expect(fetched.id).toBe(v1.id);
    expect(fetched.version).toBe(1);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/evidence-ledger-db.test.mjs -t "assigns monotonic versions"`
Expected: FAIL（`evidenceLedgerDb` 未定义 / 无 `createArtifact`）。

- [ ] **Step 3: 实现 helper + `createArtifact`/`getArtifact`**

在 `server/database/db.js` 的 `export {` 块之前新增（`crypto` 已在文件顶部 import）：

```js
function mapEvidenceArtifactRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    metaProjectId: row.meta_project_id,
    type: row.type,
    version: row.version,
    schemaVersion: row.schema_version,
    producedBy: row.produced_by,
    inputs: JSON.parse(row.inputs_json || '[]'),
    contentHash: row.content_hash,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    blobRef: row.blob_ref || null,
    status: row.status,
    validation: row.validation_json ? JSON.parse(row.validation_json) : null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

const evidenceLedgerDb = {
  createArtifact(userId, spec) {
    const {
      metaProjectId, type, producedBy = 'panel',
      inputs = [], payload = null, blobRef = null, schemaVersion = 1,
    } = spec || {};
    if (!metaProjectId) throw new Error('metaProjectId is required');
    if (!type) throw new Error('type is required');

    const id = crypto.randomUUID();
    const { next: version } = db.prepare(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM meta_evidence_artifacts WHERE meta_project_id = ? AND type = ?'
    ).get(metaProjectId, type);
    const contentHash = crypto.createHash('sha256')
      .update(stableStringify({ payload, blobRef }))
      .digest('hex');

    db.prepare(`
      INSERT INTO meta_evidence_artifacts
        (id, user_id, meta_project_id, type, version, schema_version, produced_by,
         inputs_json, content_hash, payload_json, blob_ref, status, validation_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?)
    `).run(
      id, userId, metaProjectId, type, version, schemaVersion, producedBy,
      JSON.stringify(inputs || []), contentHash,
      payload === null ? null : JSON.stringify(payload),
      blobRef, userId,
    );

    const edgeStmt = db.prepare(
      'INSERT OR IGNORE INTO meta_evidence_artifact_edges (from_artifact_id, to_artifact_id) VALUES (?, ?)'
    );
    for (const input of inputs || []) {
      if (input && input.artifactId) edgeStmt.run(input.artifactId, id);
    }
    return evidenceLedgerDb.getArtifact(id);
  },

  getArtifact(id) {
    return mapEvidenceArtifactRow(
      db.prepare('SELECT * FROM meta_evidence_artifacts WHERE id = ?').get(id)
    );
  },
};
```

然后把 `evidenceLedgerDb` 加进 `export {` 块（放在 `metaAnalysisDb,` 之后即可）：

```js
  metaAnalysisDb,
  evidenceLedgerDb,
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/evidence-ledger-db.test.mjs -t "assigns monotonic versions"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/database/db.js server/__tests__/evidence-ledger-db.test.mjs
git commit -m "feat(ledger): createArtifact with versioning and content hash"
```

---

## Task 3: 依赖 DAG —— `getDependents` + `collectTransitiveDependents`

**Files:**
- Modify: `server/database/db.js`（在 `evidenceLedgerDb` 对象内追加方法）
- Test: `server/__tests__/evidence-ledger-db.test.mjs`

- [ ] **Step 1: 写失败测试**

追加：

```js
  it('records dependency edges and collects transitive dependents', async () => {
    const { evidenceLedgerDb, initializeDatabase, userDb } = await loadDatabaseModule();
    await initializeDatabase();
    const user = userDb.createUser('ledger-user', 'hashed-password');

    const refs = evidenceLedgerDb.createArtifact(user.id, { metaProjectId: 'mp-1', type: 'ReferenceSet', payload: {} });
    const extraction = evidenceLedgerDb.createArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'ExtractionSet', payload: {},
      inputs: [{ artifactId: refs.id, version: refs.version }],
    });
    const analysis = evidenceLedgerDb.createArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'AnalysisRun', payload: {},
      inputs: [{ artifactId: extraction.id, version: extraction.version }],
    });

    const directDeps = evidenceLedgerDb.getDependents(refs.id);
    expect(directDeps.map((a) => a.id)).toEqual([extraction.id]);

    const transitive = evidenceLedgerDb.collectTransitiveDependents(refs.id);
    expect(new Set(transitive)).toEqual(new Set([extraction.id, analysis.id]));
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/evidence-ledger-db.test.mjs -t "records dependency edges"`
Expected: FAIL（无 `getDependents`）。

- [ ] **Step 3: 实现 DAG 方法**

在 `evidenceLedgerDb` 对象内（`getArtifact` 之后）追加：

```js
  getDependents(artifactId) {
    const rows = db.prepare(`
      SELECT a.* FROM meta_evidence_artifacts a
      JOIN meta_evidence_artifact_edges e ON e.to_artifact_id = a.id
      WHERE e.from_artifact_id = ?
      ORDER BY a.created_at ASC
    `).all(artifactId);
    return rows.map(mapEvidenceArtifactRow);
  },

  collectTransitiveDependents(artifactId) {
    const seen = new Set();
    const queue = [artifactId];
    const stmt = db.prepare(
      'SELECT to_artifact_id AS id FROM meta_evidence_artifact_edges WHERE from_artifact_id = ?'
    );
    while (queue.length) {
      const current = queue.shift();
      for (const dep of stmt.all(current)) {
        if (!seen.has(dep.id)) {
          seen.add(dep.id);
          queue.push(dep.id);
        }
      }
    }
    return [...seen];
  },
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/evidence-ledger-db.test.mjs -t "records dependency edges"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/database/db.js server/__tests__/evidence-ledger-db.test.mjs
git commit -m "feat(ledger): dependency edges and transitive dependents"
```

---

## Task 4: 状态/查询原语 —— `setArtifactStatus` / `getLatestArtifact` / `listArtifacts` / `markStale`

**Files:**
- Modify: `server/database/db.js`（`evidenceLedgerDb` 内追加方法）
- Test: `server/__tests__/evidence-ledger-db.test.mjs`

- [ ] **Step 1: 写失败测试**

追加：

```js
  it('updates status, lists by type, and respects locked when marking stale', async () => {
    const { evidenceLedgerDb, initializeDatabase, userDb } = await loadDatabaseModule();
    await initializeDatabase();
    const user = userDb.createUser('ledger-user', 'hashed-password');

    const a = evidenceLedgerDb.createArtifact(user.id, { metaProjectId: 'mp-1', type: 'ReferenceSet', payload: {} });
    const updated = evidenceLedgerDb.setArtifactStatus(a.id, 'validated', { passed: true, errors: [] });
    expect(updated.status).toBe('validated');
    expect(updated.validation).toEqual({ passed: true, errors: [] });

    const b = evidenceLedgerDb.createArtifact(user.id, { metaProjectId: 'mp-1', type: 'ReferenceSet', payload: {} });
    const list = evidenceLedgerDb.listArtifacts('mp-1', { type: 'ReferenceSet' });
    expect(list).toHaveLength(2);
    expect(list[0].version).toBe(1);
    expect(evidenceLedgerDb.getLatestArtifact('mp-1', 'ReferenceSet').version).toBe(2);

    evidenceLedgerDb.setArtifactStatus(a.id, 'locked');
    const lockedThenStale = evidenceLedgerDb.setArtifactStatus(a.id, 'locked');
    evidenceLedgerDb.markStale([a.id, b.id]);
    expect(evidenceLedgerDb.getArtifact(a.id).status).toBe('locked'); // locked 不被 stale 覆盖
    expect(evidenceLedgerDb.getArtifact(b.id).status).toBe('stale');
    expect(lockedThenStale.status).toBe('locked');
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/evidence-ledger-db.test.mjs -t "updates status, lists by type"`
Expected: FAIL（无 `setArtifactStatus`）。

- [ ] **Step 3: 实现状态/查询原语**

在 `evidenceLedgerDb` 内追加：

```js
  setArtifactStatus(id, status, validation = null) {
    db.prepare(
      'UPDATE meta_evidence_artifacts SET status = ?, validation_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(status, validation === null ? null : JSON.stringify(validation), id);
    return evidenceLedgerDb.getArtifact(id);
  },

  getLatestArtifact(metaProjectId, type) {
    return mapEvidenceArtifactRow(
      db.prepare(
        'SELECT * FROM meta_evidence_artifacts WHERE meta_project_id = ? AND type = ? ORDER BY version DESC LIMIT 1'
      ).get(metaProjectId, type)
    );
  },

  listArtifacts(metaProjectId, { type } = {}) {
    const rows = type
      ? db.prepare('SELECT * FROM meta_evidence_artifacts WHERE meta_project_id = ? AND type = ? ORDER BY version ASC').all(metaProjectId, type)
      : db.prepare('SELECT * FROM meta_evidence_artifacts WHERE meta_project_id = ? ORDER BY created_at ASC').all(metaProjectId);
    return rows.map(mapEvidenceArtifactRow);
  },

  markStale(artifactIds) {
    const stmt = db.prepare(
      "UPDATE meta_evidence_artifacts SET status = 'stale', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'locked'"
    );
    let affected = 0;
    for (const id of artifactIds) affected += stmt.run(id).changes;
    return affected;
  },
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/evidence-ledger-db.test.mjs`
Expected: PASS（该文件全部用例通过）。

- [ ] **Step 5: 提交**

```bash
git add server/database/db.js server/__tests__/evidence-ledger-db.test.mjs
git commit -m "feat(ledger): status updates, listing, and locked-safe stale marking"
```

---

## Task 5: 受校验写入槽 `recordArtifact` + 校验器注册表

**Files:**
- Create: `server/services/meta-analysis/evidence-ledger.js`
- Test: `server/__tests__/evidence-ledger-slot.test.mjs`

- [ ] **Step 1: 写失败测试**

新建 `server/__tests__/evidence-ledger-slot.test.mjs`：

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
  return { ...dbModule, ...ledgerModule };
}

describe('recordArtifact slot', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-evidence-slot-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });
  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) { await fs.rm(tempRoot, { recursive: true, force: true }); tempRoot = null; }
  });

  it('marks artifact validated when validators pass', async () => {
    const { initializeDatabase, userDb, recordArtifact, registerValidator } = await loadModules();
    await initializeDatabase();
    const user = userDb.createUser('slot-user', 'hashed-password');
    registerValidator('ReferenceSet', 'always-pass', () => ({ passed: true, errors: [] }));

    const { artifact, validation } = recordArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'ReferenceSet', payload: { count: 3 },
    });
    expect(validation.passed).toBe(true);
    expect(artifact.status).toBe('validated');
  });

  it('keeps artifact as draft and records errors when a validator fails', async () => {
    const { initializeDatabase, userDb, recordArtifact, registerValidator } = await loadModules();
    await initializeDatabase();
    const user = userDb.createUser('slot-user', 'hashed-password');
    registerValidator('AnalysisRun', 'always-fail', () => ({ passed: false, errors: [{ code: 'NOPE', message: 'bad' }] }));

    const { artifact, validation } = recordArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'AnalysisRun', payload: {},
    });
    expect(validation.passed).toBe(false);
    expect(artifact.status).toBe('draft');
    expect(artifact.validation.errors[0].code).toBe('NOPE');
    expect(artifact.validation.errors[0].validatorId).toBe('always-fail');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/evidence-ledger-slot.test.mjs -t "marks artifact validated"`
Expected: FAIL（找不到 `../services/meta-analysis/evidence-ledger.js`）。

- [ ] **Step 3: 实现写入槽**

新建 `server/services/meta-analysis/evidence-ledger.js`：

```js
import { evidenceLedgerDb } from '../../database/db.js';

const validatorRegistry = new Map();

export function registerValidator(type, validatorId, fn) {
  const list = validatorRegistry.get(type) || [];
  list.push({ validatorId, fn });
  validatorRegistry.set(type, list);
}

export function clearValidators() {
  validatorRegistry.clear();
}

export function getValidators(type) {
  return validatorRegistry.get(type) || [];
}

export function runValidators(type, draft) {
  const errors = [];
  for (const { validatorId, fn } of getValidators(type)) {
    const result = fn(draft) || {};
    if (!result.passed) {
      for (const err of result.errors || []) errors.push({ validatorId, ...err });
    }
  }
  return { passed: errors.length === 0, errors };
}

export function recordArtifact(userId, spec) {
  const prior = evidenceLedgerDb.getLatestArtifact(spec.metaProjectId, spec.type);
  const artifact = evidenceLedgerDb.createArtifact(userId, spec);
  const validation = runValidators(spec.type, artifact);

  if (validation.passed) {
    const validated = evidenceLedgerDb.setArtifactStatus(
      artifact.id, 'validated',
      { passed: true, errors: [], validatedAt: new Date().toISOString() },
    );
    if (prior) {
      const affected = evidenceLedgerDb.collectTransitiveDependents(prior.id);
      if (affected.length) evidenceLedgerDb.markStale(affected);
    }
    return { artifact: validated, validation };
  }

  const draft = evidenceLedgerDb.setArtifactStatus(
    artifact.id, 'draft',
    { passed: false, errors: validation.errors },
  );
  return { artifact: draft, validation };
}

export function overrideValidation(userId, artifactId, justification) {
  if (!justification || !justification.trim()) {
    throw new Error('justification is required to override validation');
  }
  return evidenceLedgerDb.setArtifactStatus(artifactId, 'validated', {
    passed: true, errors: [], overriddenBy: userId,
    justification, validatedAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/evidence-ledger-slot.test.mjs -t "marks artifact validated"`
然后：`npx vitest run server/__tests__/evidence-ledger-slot.test.mjs -t "keeps artifact as draft"`
Expected: 两条均 PASS。

- [ ] **Step 5: 提交**

```bash
git add server/services/meta-analysis/evidence-ledger.js server/__tests__/evidence-ledger-slot.test.mjs
git commit -m "feat(ledger): validated write slot with validator registry"
```

---

## Task 6: stale 传播（新 validated 版本 → 旧版本的下游失效）

**Files:**
- Test: `server/__tests__/evidence-ledger-slot.test.mjs`（仅加测试，验证 Task 5 已实现的传播逻辑）

- [ ] **Step 1: 写失败测试**

在 `evidence-ledger-slot.test.mjs` 追加：

```js
  it('marks dependents of the prior version stale when a new validated version lands', async () => {
    const { initializeDatabase, userDb, recordArtifact, registerValidator, evidenceLedgerDb } = await loadModules();
    await initializeDatabase();
    const user = userDb.createUser('slot-user', 'hashed-password');
    registerValidator('ReferenceSet', 'pass', () => ({ passed: true, errors: [] }));
    registerValidator('AnalysisRun', 'pass', () => ({ passed: true, errors: [] }));

    const refsV1 = recordArtifact(user.id, { metaProjectId: 'mp-1', type: 'ReferenceSet', payload: { n: 1 } }).artifact;
    const analysis = recordArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'AnalysisRun', payload: {},
      inputs: [{ artifactId: refsV1.id, version: refsV1.version }],
    }).artifact;
    expect(analysis.status).toBe('validated');

    recordArtifact(user.id, { metaProjectId: 'mp-1', type: 'ReferenceSet', payload: { n: 2 } });

    expect(evidenceLedgerDb.getArtifact(analysis.id).status).toBe('stale');
  });
```

> 注：`evidenceLedgerDb` 通过 `loadModules()` 的 `...dbModule` 展开而来，与写入槽内部使用的是同一模块实例。

- [ ] **Step 2: 运行确认（应直接通过，因为 Task 5 已实现传播）**

Run: `npx vitest run server/__tests__/evidence-ledger-slot.test.mjs -t "marks dependents of the prior version stale"`
Expected: PASS。若 FAIL，回到 Task 5 Step 3 检查 `recordArtifact` 中 `prior` 捕获与 `collectTransitiveDependents` 调用。

- [ ] **Step 3: 提交**

```bash
git add server/__tests__/evidence-ledger-slot.test.mjs
git commit -m "test(ledger): cover stale propagation on new validated version"
```

---

## Task 7: `overrideValidation`（留痕逃生门）

**Files:**
- Test: `server/__tests__/evidence-ledger-slot.test.mjs`

- [ ] **Step 1: 写失败测试**

追加：

```js
  it('override requires justification and stamps overriddenBy', async () => {
    const { initializeDatabase, userDb, recordArtifact, registerValidator, overrideValidation } = await loadModules();
    await initializeDatabase();
    const user = userDb.createUser('slot-user', 'hashed-password');
    registerValidator('AnalysisRun', 'fail', () => ({ passed: false, errors: [{ code: 'X', message: 'x' }] }));

    const { artifact } = recordArtifact(user.id, { metaProjectId: 'mp-1', type: 'AnalysisRun', payload: {} });
    expect(artifact.status).toBe('draft');

    expect(() => overrideValidation(user.id, artifact.id, '')).toThrow(/justification/);

    const overridden = overrideValidation(user.id, artifact.id, 'reviewed manually, data correct');
    expect(overridden.status).toBe('validated');
    expect(overridden.validation.overriddenBy).toBe(user.id);
    expect(overridden.validation.justification).toMatch(/reviewed manually/);
  });
```

- [ ] **Step 2: 运行确认（应通过，`overrideValidation` 已在 Task 5 实现）**

Run: `npx vitest run server/__tests__/evidence-ledger-slot.test.mjs -t "override requires justification"`
Expected: PASS。

- [ ] **Step 3: 提交**

```bash
git add server/__tests__/evidence-ledger-slot.test.mjs
git commit -m "test(ledger): cover override-with-justification escape hatch"
```

---

## Task 8: 两个真实校验器（提取溯源 + 分析计划一致性）

**Files:**
- Create: `server/services/meta-analysis/evidence-validators.js`
- Test: `server/__tests__/evidence-validators.test.mjs`

- [ ] **Step 1: 写失败测试**

新建 `server/__tests__/evidence-validators.test.mjs`：

```js
import { describe, expect, it } from 'vitest';
import {
  extractionProvenanceValidator,
  analysisPlanAdherenceValidator,
} from '../services/meta-analysis/evidence-validators.js';

describe('extractionProvenanceValidator', () => {
  it('fails rows missing source provenance', () => {
    const result = extractionProvenanceValidator({ payload: { rows: [
      { value: 1, source: { parsedDocumentId: 'pd1', locator: 'table2' } },
      { value: 2 },
    ] } });
    expect(result.passed).toBe(false);
    expect(result.errors[0].code).toBe('EXTRACTION_PROVENANCE_MISSING');
  });

  it('passes when all rows carry parsedDocumentId + locator', () => {
    const result = extractionProvenanceValidator({ payload: { rows: [
      { value: 1, source: { parsedDocumentId: 'pd1', locator: 't2' } },
    ] } });
    expect(result.passed).toBe(true);
  });
});

describe('analysisPlanAdherenceValidator', () => {
  it('flags deviation, missing heterogeneity, and pooled-without-dataset', () => {
    const result = analysisPlanAdherenceValidator({ payload: {
      analysisPlan: { effectMeasure: 'OR', model: 'random-effects-REML' },
      effectMeasure: 'RR', model: 'random-effects-REML',
      pooledEstimates: [{ comparison: 'A-B', estimate: 0.7 }],
      dataset: { rows: [] },
    } });
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('ANALYSIS_PLAN_DEVIATION');
    expect(codes).toContain('HETEROGENEITY_NOT_REPORTED');
    expect(codes).toContain('POOLED_ESTIMATE_WITHOUT_DATASET');
  });

  it('passes a plan-adherent analysis with heterogeneity and dataset rows', () => {
    const result = analysisPlanAdherenceValidator({ payload: {
      analysisPlan: { effectMeasure: 'OR', model: 'random-effects-REML' },
      effectMeasure: 'OR', model: 'random-effects-REML',
      heterogeneity: { i2: 0.42, tau2: 0.1 },
      pooledEstimates: [{ comparison: 'A-B', estimate: 0.7 }],
      dataset: { rows: [{ study: 'S1' }] },
    } });
    expect(result.passed).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/evidence-validators.test.mjs`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现校验器**

新建 `server/services/meta-analysis/evidence-validators.js`：

```js
import { registerValidator } from './evidence-ledger.js';

// 每个 ExtractionSet.payload.rows[i] 必须能溯源到某个 ParsedDocument 的具体位置，封死“编数据”。
export function extractionProvenanceValidator(artifact) {
  const rows = (artifact.payload && artifact.payload.rows) || [];
  const errors = [];
  rows.forEach((row, index) => {
    const source = row && row.source;
    if (!source || !source.parsedDocumentId || !source.locator) {
      errors.push({
        code: 'EXTRACTION_PROVENANCE_MISSING',
        message: `row ${index} is missing source.parsedDocumentId/locator`,
      });
    }
  });
  return { passed: errors.length === 0, errors };
}

// AnalysisRun 必须遵守预注册分析计划、报告异质性、且合并估计必须有底层数据，封死“分析随意”。
// 注：本切片把 analysisPlan 直接放在 payload 里便于独立测试；后续计划改为从输入的 Protocol 工件读取。
export function analysisPlanAdherenceValidator(artifact) {
  const payload = artifact.payload || {};
  const plan = payload.analysisPlan || {};
  const errors = [];

  if (!payload.effectMeasure || payload.effectMeasure !== plan.effectMeasure) {
    errors.push({
      code: 'ANALYSIS_PLAN_DEVIATION',
      message: `effectMeasure "${payload.effectMeasure}" != pre-registered "${plan.effectMeasure}"`,
    });
  }
  if (!payload.model || payload.model !== plan.model) {
    errors.push({
      code: 'ANALYSIS_PLAN_DEVIATION',
      message: `model "${payload.model}" != pre-registered "${plan.model}"`,
    });
  }

  const het = payload.heterogeneity || {};
  if (het.i2 === undefined || het.tau2 === undefined) {
    errors.push({
      code: 'HETEROGENEITY_NOT_REPORTED',
      message: 'heterogeneity.i2 and heterogeneity.tau2 are required',
    });
  }

  const datasetRows = (payload.dataset && payload.dataset.rows) || [];
  const pooled = payload.pooledEstimates || [];
  if (pooled.length > 0 && datasetRows.length === 0) {
    errors.push({
      code: 'POOLED_ESTIMATE_WITHOUT_DATASET',
      message: 'pooled estimates present but dataset has no rows',
    });
  }

  return { passed: errors.length === 0, errors };
}

export function registerCoreEvidenceValidators() {
  registerValidator('ExtractionSet', 'extraction-provenance', extractionProvenanceValidator);
  registerValidator('AnalysisRun', 'analysis-plan-adherence', analysisPlanAdherenceValidator);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/evidence-validators.test.mjs`
Expected: PASS（4 条用例）。

- [ ] **Step 5: 提交**

```bash
git add server/services/meta-analysis/evidence-validators.js server/__tests__/evidence-validators.test.mjs
git commit -m "feat(ledger): extraction-provenance and analysis-plan-adherence validators"
```

---

## Task 9: 核心校验器接线进写入槽（端到端：随意分析被拦）

**Files:**
- Test: `server/__tests__/evidence-validators.test.mjs`

- [ ] **Step 1: 写失败测试**

在 `evidence-validators.test.mjs` 顶部补充 import（与现有 import 合并）：

```js
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, vi } from 'vitest';
```

文件末尾追加一个独立 describe：

```js
describe('core validators wired into recordArtifact', () => {
  const originalDatabasePath = process.env.DATABASE_PATH;
  let tempRoot = null;

  async function loadModules() {
    vi.resetModules();
    const dbModule = await import('../database/db.js');
    const ledgerModule = await import('../services/meta-analysis/evidence-ledger.js');
    const validatorsModule = await import('../services/meta-analysis/evidence-validators.js');
    return { ...dbModule, ...ledgerModule, ...validatorsModule };
  }

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-core-validators-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });
  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) { await fs.rm(tempRoot, { recursive: true, force: true }); tempRoot = null; }
  });

  it('blocks an ExtractionSet whose rows lack provenance', async () => {
    const { initializeDatabase, userDb, recordArtifact, registerCoreEvidenceValidators } = await loadModules();
    await initializeDatabase();
    registerCoreEvidenceValidators();
    const user = userDb.createUser('wire-user', 'hashed-password');

    const { artifact, validation } = recordArtifact(user.id, {
      metaProjectId: 'mp-1', type: 'ExtractionSet',
      payload: { rows: [{ value: 5 }] },
    });
    expect(validation.passed).toBe(false);
    expect(artifact.status).toBe('draft');
    expect(validation.errors.map((e) => e.code)).toContain('EXTRACTION_PROVENANCE_MISSING');
  });
});
```

- [ ] **Step 2: 运行确认通过（端到端覆盖测试；行为已由 Task 8 的 `registerCoreEvidenceValidators` 接线，故应直接 PASS——与 Task 6/7 同类）**

Run: `npx vitest run server/__tests__/evidence-validators.test.mjs -t "blocks an ExtractionSet"`
Expected: PASS（仅运行这 1 条匹配用例，其余 4 条因 `-t` 过滤显示 skipped，属正常）。若反而 FAIL，说明 Task 8 的接线或 Step 1 的 import 合并有问题，回 Task 8 检查。

- [ ] **Step 3: 实现**

无需新增实现代码——`registerCoreEvidenceValidators` 已在 Task 8 提供。若测试失败仅因 import 重复声明，合并顶部 import（`describe/expect/it` 已在文件首次 import，勿重复）。确认 `evidence-validators.js` 已 `export function registerCoreEvidenceValidators`。

- [ ] **Step 4: 运行整套确认通过**

Run: `npx vitest run server/__tests__/evidence-ledger-db.test.mjs server/__tests__/evidence-ledger-slot.test.mjs server/__tests__/evidence-validators.test.mjs`
Expected: 三个文件全部 PASS。

- [ ] **Step 5: 回归确认未破坏既有测试**

Run: `npx vitest run`（跑整套，同样绕过 ensure-native-modules）
Expected: 既有 meta/auth/pipeline 等测试全绿（新增表为 `CREATE TABLE IF NOT EXISTS`，不影响旧 schema）。若个别用例因缺 bcrypt/sharp 原生模块报 ABI 错，按「一次性环境准备」重建对应模块后重跑。

- [ ] **Step 6: 提交**

```bash
git add server/__tests__/evidence-validators.test.mjs
git commit -m "test(ledger): core validators block casual analysis end-to-end"
```

---

## 完成判定（M0 第一切片 DoD）

- [ ] `meta_evidence_artifacts` / `meta_evidence_artifact_edges` 两表随 `initializeDatabase()` 建立。
- [ ] `evidenceLedgerDb` 提供版本化创建、内容哈希、依赖 DAG、状态更新、locked-safe stale。
- [ ] `recordArtifact` 写入槽：过校验→`validated`（并把旧版本下游标 `stale`）；不过→`draft` 且带结构化错误码。
- [ ] `overrideValidation` 强制 justification 并留痕 `overriddenBy`。
- [ ] 两个真实校验器（提取溯源、分析计划一致性）+ 接线，端到端拦住"无溯源提取/偏离计划的分析"。
- [ ] `npx vitest run` 全绿。

## 后续计划（不在本切片）

1. **M0-B**：把 `meta-analysis.js` 现有端点（screening/extraction/analysis-runs）改为经 `recordArtifact` 写入；`analysisPlan` 改为从输入的 `Protocol` 工件读取；面板展示 `status/validation`。
2. **M1**：Profile/FSM 引擎 + NMA(`netmeta`)/配对(`metafor`) 端点与 per-type JSON Schema。
3. **M3**：协议绑定活体更新器（基于本 Ledger 的版本/DAG 实现"重算 + ChangeSet diff"）。
