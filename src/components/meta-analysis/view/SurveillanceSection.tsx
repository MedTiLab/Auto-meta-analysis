import { useCallback, useEffect, useState } from 'react';
import { Loader2, Play, Radar, RefreshCw } from 'lucide-react';

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
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> 加载中...</div>
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
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 text-muted-foreground">
              频率 {subscription.frequency} · 上次 {subscription.lastRunAt ? new Date(subscription.lastRunAt).toLocaleString() : '从未'}
            </span>
            <div className="flex shrink-0 gap-1.5">
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
