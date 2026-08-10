# M3-B2 — 巡检调度器 + 独立追踪视图 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让追踪"活"起来且看得见——(1) 一个按 `frequency` 自动触发巡检的调度器（可 TDD 的纯逻辑 + 薄 `setInterval` 钩子）；(2) 一个独立的追踪视图，挂进 app 里唯一已挂载的 meta 入口 `MetaProjectPreview`（订阅 / 立即巡检 / ChangeSet 展示 / 运行历史）。

**Architecture:** 调度器分两层——纯函数 `selectDueSubscriptions/isDue`（无 DB，单测）+ 编排 `runDueSurveillance({now, listActive, runOne})`（注入式，单测）+ 生产钩子 `runSurveillanceTick/startSurveillanceScheduler`（接真实 db + `runProjectSurveillance`，在 `startServer()` 里 `setInterval`，手动验证）。UI 是一个自洽的 `SurveillanceSection.tsx`，经 `metaAnalysisApi` 新增方法调 M3-B 路由，渲染进 `MetaProjectPreview`。

**Tech Stack:** Node.js (ESM), better-sqlite3, vitest（server 端 TDD）；React + TypeScript（UI，`npm run typecheck` + 手动冒烟验证，仓库无 jsdom 组件测试环境）。

---

## 前置说明（执行前必读）

- 依赖 **M3-B 已合并**（`feat/surveillance-wiring`：`runProjectSurveillance`、`surveillanceDb`、4 个 surveillance 路由）。先确认存在。
- **server 测试用 `npx vitest run <file>`**（不要 `npm test`，其 pretest 会 `npm rebuild` 卡死）。**前端用 `npm run typecheck`**（= `tsc --noEmit`）做静态校验 + app 内手动冒烟。
- 开分支：`git checkout -b feat/surveillance-scheduler-ui`（从含 M3-B 的主线切出）。
- 已核对的真实接口：`metaAnalysisDb.getMetaProject(userId, metaProjectId)`（按 id 取，注意是两参）；`startServer()` 在 `server/index.js:3395`，listen 在 `~3418`；`MetaProjectPreview` 用 `metaAnalysisApi` 且已被 `MainContent`/`ChatContextSidebar` 挂载。

## 范围

**做：** `surveillanceDb.listActiveSubscriptions`、调度器纯逻辑 + 编排 + 生产钩子（`startServer` 内 `setInterval`）、`metaAnalysisApi` 4 个 surveillance 方法、`SurveillanceSection.tsx` 并挂进 `MetaProjectPreview`。

**不做（后续）：** 把 8 个孤立 meta 面板组装成完整工作台（独立"meta UI 集成"项目）；M1 统计重算（ChangeSet 仍只到 `pendingReanalysis`）；多源检索（仅 PubMed）。

---

## File Structure

| 文件 | 责任 |
| --- | --- |
| `server/database/db.js`（修改） | `surveillanceDb.listActiveSubscriptions()` |
| `server/services/meta-analysis/surveillance/scheduler.js`（新建） | 纯逻辑 `frequencyToMs/isDue/selectDueSubscriptions` + 编排 `runDueSurveillance` |
| `server/services/meta-analysis/surveillance/scheduler-service.js`（新建） | 生产钩子 `runSurveillanceTick` + `startSurveillanceScheduler` |
| `server/index.js`（修改） | 在 `startServer()` 启动调度器 |
| `src/components/meta-analysis/api/metaAnalysisApi.ts`（修改） | 4 个 surveillance 客户端方法 |
| `src/components/meta-analysis/view/SurveillanceSection.tsx`（新建） | 独立追踪视图 |
| `src/components/meta-analysis/view/MetaProjectPreview.tsx`（修改） | 渲染 `<SurveillanceSection>` |
| `server/__tests__/surveillance-scheduler.test.mjs`（新建） | 覆盖调度器纯逻辑 + 编排 |

---

## Task 1: `surveillanceDb.listActiveSubscriptions`

**Files:**
- Modify: `server/database/db.js`（`surveillanceDb` 内追加方法）
- Test: `server/__tests__/surveillance-db.test.mjs`（追加用例）

- [ ] **Step 1: 写失败测试**

在 `server/__tests__/surveillance-db.test.mjs` 的 `describe` 内追加：

```js
  it('lists only active subscriptions across projects', async () => {
    const { db, surveillanceDb, initializeDatabase, userDb } = await loadDatabaseModule();
    await initializeDatabase();
    const user = userDb.createUser('surv-active-user', 'hashed-password');

    const a = surveillanceDb.createSubscription(user.id, { metaProjectId: 'mp-1', searchStrategy: {}, eligibility: {} });
    const b = surveillanceDb.createSubscription(user.id, { metaProjectId: 'mp-2', searchStrategy: {}, eligibility: {} });
    // No status setter is exposed yet; flip b to paused directly to prove the active filter excludes it.
    db.prepare("UPDATE meta_surveillance_subscriptions SET status = 'paused' WHERE id = ?").run(b.id);

    const active = surveillanceDb.listActiveSubscriptions();
    expect(active.map((s) => s.metaProjectId)).toEqual(['mp-1']);
    expect(active.every((s) => s.status === 'active')).toBe(true);
    expect(active.find((s) => s.id === a.id)).toBeTruthy();
    expect(active.find((s) => s.id === b.id)).toBeUndefined();
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/surveillance-db.test.mjs -t "lists only active subscriptions"`
Expected: FAIL（无 `listActiveSubscriptions`）。

- [ ] **Step 3: 实现**

在 `server/database/db.js` 的 `surveillanceDb` 对象内追加：

```js
  listActiveSubscriptions() {
    return db.prepare("SELECT * FROM meta_surveillance_subscriptions WHERE status = 'active' ORDER BY created_at ASC")
      .all().map(mapSurveillanceSubscriptionRow);
  },
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/surveillance-db.test.mjs -t "lists only active subscriptions"`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/database/db.js server/__tests__/surveillance-db.test.mjs
git commit -m "feat(surveillance): list active subscriptions"
```

---

## Task 2: 调度器纯逻辑（`frequencyToMs` / `isDue` / `selectDueSubscriptions`）

**Files:**
- Create: `server/services/meta-analysis/surveillance/scheduler.js`
- Test: `server/__tests__/surveillance-scheduler.test.mjs`

- [ ] **Step 1: 写失败测试**

新建 `server/__tests__/surveillance-scheduler.test.mjs`：

```js
import { describe, expect, it } from 'vitest';
import { frequencyToMs, isDue, selectDueSubscriptions } from '../services/meta-analysis/surveillance/scheduler.js';

const NOW = '2026-05-30T00:00:00.000Z';

describe('frequencyToMs', () => {
  it('maps known frequencies and defaults to weekly', () => {
    expect(frequencyToMs('daily')).toBe(86400000);
    expect(frequencyToMs('weekly')).toBe(604800000);
    expect(frequencyToMs('monthly')).toBe(2592000000);
    expect(frequencyToMs('nonsense')).toBe(604800000);
  });
});

describe('isDue', () => {
  it('is due when never run', () => {
    expect(isDue({ frequency: 'weekly', lastRunAt: null }, NOW)).toBe(true);
  });
  it('is not due within the interval', () => {
    expect(isDue({ frequency: 'weekly', lastRunAt: '2026-05-29T00:00:00.000Z' }, NOW)).toBe(false);
  });
  it('is due once the interval has elapsed', () => {
    expect(isDue({ frequency: 'daily', lastRunAt: '2026-05-28T00:00:00.000Z' }, NOW)).toBe(true);
  });
});

describe('selectDueSubscriptions', () => {
  it('returns only active and due subscriptions', () => {
    const subs = [
      { id: '1', status: 'active', frequency: 'daily', lastRunAt: null },                       // due
      { id: '2', status: 'active', frequency: 'weekly', lastRunAt: '2026-05-29T00:00:00.000Z' }, // not due
      { id: '3', status: 'paused', frequency: 'daily', lastRunAt: null },                        // paused
    ];
    expect(selectDueSubscriptions(subs, NOW).map((s) => s.id)).toEqual(['1']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/surveillance-scheduler.test.mjs -t "frequencyToMs"`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现纯逻辑**

新建 `server/services/meta-analysis/surveillance/scheduler.js`：

```js
export const FREQUENCY_MS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export function frequencyToMs(frequency) {
  return FREQUENCY_MS[frequency] || FREQUENCY_MS.weekly;
}

export function isDue(subscription, now) {
  if (!subscription.lastRunAt) return true;
  const elapsed = new Date(now).getTime() - new Date(subscription.lastRunAt).getTime();
  return elapsed >= frequencyToMs(subscription.frequency);
}

export function selectDueSubscriptions(subscriptions, now) {
  return (subscriptions || []).filter((s) => s.status === 'active' && isDue(s, now));
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/surveillance-scheduler.test.mjs`
Expected: PASS（5 条用例）。

- [ ] **Step 5: 提交**

```bash
git add server/services/meta-analysis/surveillance/scheduler.js server/__tests__/surveillance-scheduler.test.mjs
git commit -m "feat(surveillance): scheduler due-selection logic"
```

---

## Task 3: 调度器编排（`runDueSurveillance`，注入式）

**Files:**
- Modify: `server/services/meta-analysis/surveillance/scheduler.js`（追加）
- Test: `server/__tests__/surveillance-scheduler.test.mjs`（追加）

- [ ] **Step 1: 写失败测试**

追加：

```js
describe('runDueSurveillance', () => {
  const NOW2 = '2026-05-30T00:00:00.000Z';

  it('runs each due subscription and isolates per-subscription failures', async () => {
    const { runDueSurveillance } = await import('../services/meta-analysis/surveillance/scheduler.js');
    const listActive = () => ([
      { id: 'a', status: 'active', frequency: 'daily', lastRunAt: null },
      { id: 'b', status: 'active', frequency: 'daily', lastRunAt: null },
      { id: 'c', status: 'paused', frequency: 'daily', lastRunAt: null },
    ]);
    const ran = [];
    const runOne = async (sub) => {
      if (sub.id === 'b') throw new Error('boom');
      ran.push(sub.id);
      return { ok: sub.id };
    };

    const summary = await runDueSurveillance({ now: NOW2, listActive, runOne });

    expect(summary.dueCount).toBe(2); // a + b (c paused)
    expect(ran).toEqual(['a']);
    expect(summary.results.find((r) => r.subscriptionId === 'b').ok).toBe(false);
    expect(summary.results.find((r) => r.subscriptionId === 'b').error).toContain('boom');
    expect(summary.results.find((r) => r.subscriptionId === 'a').ok).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run server/__tests__/surveillance-scheduler.test.mjs -t "runs each due subscription"`
Expected: FAIL（无 `runDueSurveillance`）。

- [ ] **Step 3: 实现编排**

在 `scheduler.js` 追加：

```js
// 编排：列出活跃订阅 -> 选出到期 -> 逐个跑（单个失败不影响其它）。
export async function runDueSurveillance({ now, listActive, runOne }) {
  const due = selectDueSubscriptions(listActive(), now);
  const results = [];
  for (const sub of due) {
    try {
      const result = await runOne(sub);
      results.push({ subscriptionId: sub.id, ok: true, result });
    } catch (error) {
      results.push({ subscriptionId: sub.id, ok: false, error: error.message || String(error) });
    }
  }
  return { dueCount: due.length, results };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run server/__tests__/surveillance-scheduler.test.mjs`
Expected: PASS（含新用例）。

- [ ] **Step 5: 提交**

```bash
git add server/services/meta-analysis/surveillance/scheduler.js server/__tests__/surveillance-scheduler.test.mjs
git commit -m "feat(surveillance): runDueSurveillance orchestration"
```

---

## Task 4: 生产钩子（`scheduler-service.js` + `startServer` 接线）

`runSurveillanceTick` 接真实 db + `runProjectSurveillance`；`startSurveillanceScheduler` 在 `startServer()` 里 `setInterval`。真实 tick 会调真实 PubMed（需网络），故用**手动验证**；编排逻辑已由 Task 3 覆盖。

**Files:**
- Create: `server/services/meta-analysis/surveillance/scheduler-service.js`
- Modify: `server/index.js`（import + `startServer()` 内启动）

- [ ] **Step 1: 实现 scheduler-service**

新建 `server/services/meta-analysis/surveillance/scheduler-service.js`：

```js
import { surveillanceDb, metaAnalysisDb } from '../../database/db.js';
import { runProjectSurveillance } from './surveillance-service.js';
import { runDueSurveillance } from './scheduler.js';

// 跑一轮到期巡检。runOne 取 metaProject(getMetaProject 是 (userId, metaProjectId) 两参) 后调真实巡检服务。
export async function runSurveillanceTick(now = new Date().toISOString()) {
  return runDueSurveillance({
    now,
    listActive: () => surveillanceDb.listActiveSubscriptions(),
    runOne: async (sub) => {
      const metaProject = metaAnalysisDb.getMetaProject(sub.userId, sub.metaProjectId);
      if (!metaProject) throw new Error(`meta project ${sub.metaProjectId} not found`);
      return runProjectSurveillance({ userId: sub.userId, metaProject });
    },
  });
}

export function startSurveillanceScheduler({ intervalMs = 60 * 60 * 1000 } = {}) {
  const timer = setInterval(() => {
    runSurveillanceTick().catch((error) => {
      console.error('[surveillance] scheduler tick failed:', error.message || error);
    });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}
```

- [ ] **Step 2: 在 `startServer()` 启动调度器**

在 `server/index.js` 顶部 import 区追加：

```js
import { startSurveillanceScheduler } from './services/meta-analysis/surveillance/scheduler-service.js';
```

在 `startServer()` 内、服务器已 listen 之后（`listenOnAvailablePort(...)` 那段之后），追加：

```js
            startSurveillanceScheduler();
            console.log('[surveillance] living-update scheduler started (hourly tick)');
```

- [ ] **Step 3: 手动验证 + 轻量校验**

- 启动后端，确认日志出现 `[surveillance] living-update scheduler started`，且进程不崩。
- 轻量校验编排不报错（无活跃订阅时 tick 应安全返回）：
  Run: `npx vitest run server/__tests__/surveillance-scheduler.test.mjs`
  Expected: PASS（调度逻辑已覆盖；`runSurveillanceTick` 因依赖真实 PubMed 网络不做自动断言）。

- [ ] **Step 4: 提交**

```bash
git add server/services/meta-analysis/surveillance/scheduler-service.js server/index.js
git commit -m "feat(surveillance): hourly living-update scheduler hook"
```

---

## Task 5: `metaAnalysisApi` 增加 surveillance 客户端方法

**Files:**
- Modify: `src/components/meta-analysis/api/metaAnalysisApi.ts`

- [ ] **Step 1: 加方法**

在 `metaAnalysisApi.ts` 的 `export const metaAnalysisApi = { ... }` 对象里追加（沿用现有 `requestJson` + `base` 模式；类型用内联结构类型，避免改 `types.ts`）：

```ts
  surveillanceSubscription: (metaProjectId: string) =>
    requestJson<{ subscription: SurveillanceSubscription | null }>(`${base(metaProjectId)}/surveillance/subscription`),

  subscribeSurveillance: (
    metaProjectId: string,
    payload: { searchStrategy: { pubmed?: string }; eligibility: Record<string, unknown>; frequency?: string },
  ) =>
    requestJson<{ subscription: SurveillanceSubscription }>(`${base(metaProjectId)}/surveillance/subscribe`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  runSurveillance: (metaProjectId: string) =>
    requestJson<{ run: SurveillanceRun; changeSet: SurveillanceChangeSet }>(`${base(metaProjectId)}/surveillance/run`, {
      method: 'POST',
    }),

  surveillanceRuns: (metaProjectId: string) =>
    requestJson<{ runs: SurveillanceRun[] }>(`${base(metaProjectId)}/surveillance/runs`),
```

在 `metaAnalysisApi.ts` 顶部（`import` 之后、`requestJson` 之前）加内联类型：

```ts
export type SurveillanceSubscription = {
  id: string;
  metaProjectId: string;
  searchStrategy: { pubmed?: string };
  eligibility: Record<string, unknown>;
  frequency: string;
  status: string;
  lastRunAt: string | null;
};

export type SurveillanceChangeSet = {
  generatedAt: string;
  search: { found: number; since: string | null };
  dedup: { novel: number; duplicates: number };
  autoScreen: { autoIncluded: number; autoExcluded: number; toReview: number };
  includedStudies: Array<{ referenceId: string; title: string; confidence: number }>;
  referenceSet: { priorVersion: number | null; newVersion: number } | null;
  pendingReanalysis: { staleArtifactIds: string[]; note: string };
  conclusionsImpact: string;
};

export type SurveillanceRun = {
  id: string;
  status: string;
  stats: Record<string, number>;
  changeSet: SurveillanceChangeSet | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};
```

- [ ] **Step 2: 校验**

Run: `npm run typecheck`
Expected: 通过（或：无新引入的、指向 `metaAnalysisApi.ts` 的错误）。

- [ ] **Step 3: 提交**

```bash
git add src/components/meta-analysis/api/metaAnalysisApi.ts
git commit -m "feat(surveillance): API client methods for subscribe/run/runs"
```

---

## Task 6: `SurveillanceSection.tsx` 独立追踪视图

**Files:**
- Create: `src/components/meta-analysis/view/SurveillanceSection.tsx`

- [ ] **Step 1: 实现组件**

新建 `src/components/meta-analysis/view/SurveillanceSection.tsx`：

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Play, RefreshCw, Radar } from 'lucide-react';

import { Button } from '../../ui/button';
import {
  metaAnalysisApi,
  type SurveillanceChangeSet,
  type SurveillanceRun,
  type SurveillanceSubscription,
} from '../api/metaAnalysisApi';

export default function SurveillanceSection({ metaProjectId }: { metaProjectId: string }) {
  const [subscription, setSubscription] = useState<SurveillanceSubscription | null>(null);
  const [runs, setRuns] = useState<SurveillanceRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pubmedQuery, setPubmedQuery] = useState('');
  const [includeKeywords, setIncludeKeywords] = useState('network meta-analysis');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sub, runsResp] = await Promise.all([
        metaAnalysisApi.surveillanceSubscription(metaProjectId),
        metaAnalysisApi.surveillanceRuns(metaProjectId),
      ]);
      setSubscription(sub.subscription);
      setRuns(runsResp.runs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [metaProjectId]);

  useEffect(() => { void load(); }, [load]);

  const subscribe = useCallback(async () => {
    setError(null);
    try {
      await metaAnalysisApi.subscribeSurveillance(metaProjectId, {
        searchStrategy: { pubmed: pubmedQuery.trim() },
        eligibility: { includeKeywordsAny: includeKeywords.split(',').map((s) => s.trim()).filter(Boolean) },
        frequency: 'weekly',
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [metaProjectId, pubmedQuery, includeKeywords, load]);

  const runNow = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      await metaAnalysisApi.runSurveillance(metaProjectId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [metaProjectId, load]);

  const latest: SurveillanceChangeSet | null = runs[0]?.changeSet ?? null;

  return (
    <section className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Radar className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">活体追踪 (Living surveillance)</h3>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> 加载中…</div>
      ) : !subscription ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">为本综述注册锁定检索式 + 纳排标准后，可定时自动巡检新文献。</p>
          <input
            className="w-full rounded border border-border/60 bg-background px-2 py-1 text-xs"
            placeholder='PubMed 检索式，如 ("network meta-analysis"[tiab])'
            value={pubmedQuery}
            onChange={(e) => setPubmedQuery(e.target.value)}
          />
          <input
            className="w-full rounded border border-border/60 bg-background px-2 py-1 text-xs"
            placeholder="纳入关键词（逗号分隔）"
            value={includeKeywords}
            onChange={(e) => setIncludeKeywords(e.target.value)}
          />
          <Button size="sm" onClick={subscribe} disabled={!pubmedQuery.trim()}>注册订阅</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              频率 {subscription.frequency} · 上次 {subscription.lastRunAt ? new Date(subscription.lastRunAt).toLocaleString() : '从未'}
            </span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={load}><RefreshCw className="mr-1 h-3 w-3" />刷新</Button>
              <Button size="sm" onClick={runNow} disabled={running}>
                {running ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}立即巡检
              </Button>
            </div>
          </div>

          {latest && (
            <div className="rounded-lg border border-border/60 bg-background p-2 text-xs">
              <div className="mb-1 font-medium">最近一次变更</div>
              <div className="text-muted-foreground">
                检索 {latest.search.found} · 去重后新 {latest.dedup.novel} · 自动纳入 {latest.autoScreen.autoIncluded} · 待复核 {latest.autoScreen.toReview}
              </div>
              {latest.includedStudies.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {latest.includedStudies.map((s) => <li key={s.referenceId} className="truncate">{s.title}</li>)}
                </ul>
              )}
              {latest.pendingReanalysis.staleArtifactIds.length > 0 && (
                <div className="mt-1 text-amber-600">
                  {latest.pendingReanalysis.staleArtifactIds.length} 个分析已过期，待重算（{latest.conclusionsImpact}）
                </div>
              )}
            </div>
          )}

          <div className="text-[11px] text-muted-foreground">历史运行：{runs.length}</div>
        </div>
      )}

      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
    </section>
  );
}
```

- [ ] **Step 2: 校验**

Run: `npm run typecheck`
Expected: 通过（无指向 `SurveillanceSection.tsx` 的新错误）。若 `Button` 的 `variant="outline"`/`size="sm"` 报类型错，按 `src/components/ui/button` 实际暴露的 props 调整。

- [ ] **Step 3: 提交**

```bash
git add src/components/meta-analysis/view/SurveillanceSection.tsx
git commit -m "feat(surveillance): standalone surveillance section component"
```

---

## Task 7: 挂进 `MetaProjectPreview` + 冒烟 + 回归

**Files:**
- Modify: `src/components/meta-analysis/view/MetaProjectPreview.tsx`

- [ ] **Step 1: 渲染 SurveillanceSection**

在 `MetaProjectPreview.tsx` 顶部 import 区追加：

```ts
import SurveillanceSection from './SurveillanceSection';
```

在 `MetaProjectPreview` 的主体渲染处（与其它 `<section>` 卡片并列的位置，例如概览区块之后），插入：

```tsx
<SurveillanceSection metaProjectId={project.id} />
```

> `project.id` 就是本组件已用于 `metaAnalysisApi.overview(project.id)`（约 `MetaProjectPreview.tsx:1080`）的那个 id，即 `meta_projects.id` / `metaProjectId`，直接复用同一个值。

- [ ] **Step 2: 类型校验**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 3: 手动冒烟（app 内）**

启动 app（`npm run dev` 或你的常规方式）。打开一个 meta 项目的 `MetaProjectPreview`：
1. 看到"活体追踪"区块；首次显示订阅表单。
2. 填 PubMed 检索式 + 纳入关键词 → 注册订阅 → 区块切换为"频率/上次/立即巡检"。
3. 点"立即巡检"（会真打 PubMed，需网络）→ 看到"最近一次变更"计数与新纳入研究列表；若有下游分析则显示"X 个分析已过期"。
4. 刷新 → 历史运行数 +1。

- [ ] **Step 4: 全回归**

Run: `npx vitest run`
Expected: 既有 + M0 + M3 + M3-B + M3-B2（scheduler）全绿。
Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 5: 提交**

```bash
git add src/components/meta-analysis/view/MetaProjectPreview.tsx
git commit -m "feat(surveillance): surface surveillance section in meta project preview"
```

---

## 完成判定（M3-B2 DoD）

- [ ] `surveillanceDb.listActiveSubscriptions` 跨项目列出活跃订阅。
- [ ] 调度器纯逻辑（`isDue`/`selectDueSubscriptions`）+ 编排（`runDueSurveillance`，单失败隔离）单测通过。
- [ ] `startServer()` 启动每小时巡检调度器；日志可见、进程不崩。
- [ ] `metaAnalysisApi` 有 subscribe/run/runs/subscription 方法，`npm run typecheck` 通过。
- [ ] `SurveillanceSection` 挂进 `MetaProjectPreview`，app 内可订阅 / 立即巡检 / 看到 ChangeSet 与历史。
- [ ] `npx vitest run` 全绿、`npm run typecheck` 通过。

## 后续计划

1. **meta UI 集成（独立项目）**：把现有 8 个孤立面板（Search/Screening/Extraction/Analysis/…）组装成可导航工作台，追踪从"独立 section"升级为其中一个正式视图。
2. **M1 衔接**：`pendingReanalysis` → 触发 `netmeta`/`metafor` 重算，ChangeSet 显示真实 OR/SUCRA 数值 diff。
3. **调度增强**：可配置频率/暂停、按 `next_run_at` 精确排程、运行通知。
