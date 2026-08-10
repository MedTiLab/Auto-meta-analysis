import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '../../ui/button';
import { metaAnalysisApi } from '../api/metaAnalysisApi';
import type { MetaProject, MetaReference, ScreeningDecision } from '../types';

type Props = {
  metaProject: MetaProject;
  onChanged: () => void;
};

const decisions: Array<ScreeningDecision['decision']> = ['include', 'exclude', 'maybe'];
const NAMED_AGENT_REVIEWER_RE = /^(claude|claude)(?:[\s:_-]|$)/i;
const NON_DECISION_REVIEWER_RE = /^(ai|assistant|auto|automated|model|llm|system)(?:[\s:_-]|$)/i;
const SCREENING_STAGE_RANK: Record<string, number> = { final: 3, full_text: 2, title_abstract: 1 };

function formatConfidence(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${Math.round(value * 100)}%`;
}

function getReviewerClass(reviewer: string | null | undefined) {
  const normalized = String(reviewer || '').trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized === 'user') return 'user';
  if (NAMED_AGENT_REVIEWER_RE.test(normalized)) return 'named_agent';
  if (NON_DECISION_REVIEWER_RE.test(normalized)) return 'ai_pre_screen';
  return 'human_or_named_reviewer';
}

function getReviewerStatus(decision: ScreeningDecision | undefined) {
  const reviewerClass = getReviewerClass(decision?.reviewer);
  if (reviewerClass === 'ai_pre_screen') return 'AI 一筛 · 待 AI 二筛';
  if (reviewerClass === 'named_agent') return 'AI 二筛完成';
  if (reviewerClass === 'user') return '用户覆盖/抽查';
  if (reviewerClass === 'human_or_named_reviewer') return '外部复审记录';
  return '未知';
}

function getDecisionsByReference(decisionsList: ScreeningDecision[]) {
  return decisionsList.reduce<Map<string, ScreeningDecision[]>>((map, decision) => {
    const items = map.get(decision.reference_id) || [];
    items.push(decision);
    map.set(decision.reference_id, items);
    return map;
  }, new Map());
}

function hasDecisionConflict(decisionsList: ScreeningDecision[]) {
  return new Set(decisionsList.map((decision) => decision.decision).filter(Boolean)).size > 1;
}

function getScreeningWorkflowStats(references: MetaReference[], decisionsList: ScreeningDecision[]) {
  const latestByReference = getLatestDecisionByReference(decisionsList);
  const decisionsByReference = getDecisionsByReference(decisionsList);
  return references.reduce(
    (acc, reference) => {
      const latest = latestByReference.get(reference.id);
      if (hasDecisionConflict(decisionsByReference.get(reference.id) || [])) acc.conflicts += 1;
      if (!latest) {
        acc.pending += 1;
        return acc;
      }
      const reviewerClass = getReviewerClass(latest.reviewer);
      if (reviewerClass === 'ai_pre_screen') acc.pendingRescreen += 1;
      if (reviewerClass === 'named_agent') acc.agentReviewed += 1;
      if (reviewerClass === 'user') acc.userAuthorized += 1;
      return acc;
    },
    { pending: 0, pendingRescreen: 0, agentReviewed: 0, userAuthorized: 0, conflicts: 0 },
  );
}

function normalizeWorkflowStats(serverStats: any, fallback: ReturnType<typeof getScreeningWorkflowStats>) {
  const stageStats = serverStats?.byStage?.title_abstract || serverStats;
  if (!stageStats) return fallback;
  return {
    pending: Number(stageStats.pending || 0),
    pendingRescreen: Number(stageStats.pendingAgentReview ?? stageStats.pendingRescreen ?? 0),
    agentReviewed: Number(stageStats.agentReviewed || 0),
    userAuthorized: Number(stageStats.userAuthorized || 0),
    conflicts: Number(stageStats.agentConflicts ?? stageStats.conflicts ?? 0),
  };
}

function getSourceLabel(decision: ScreeningDecision | undefined) {
  const metadata = decision?.metadata_json || {};
  const value = metadata.sourceDatabase || metadata.databaseName || metadata.source || metadata.syncedFrom;
  return typeof value === 'string' && value.trim() ? value.trim() : '-';
}

function getLatestDecisionByReference(decisionsList: ScreeningDecision[]) {
  const map = new Map<string, ScreeningDecision>();
  [...decisionsList]
    .sort((left, right) => {
      const rankDiff = (SCREENING_STAGE_RANK[right.stage] || 0) - (SCREENING_STAGE_RANK[left.stage] || 0);
      if (rankDiff !== 0) return rankDiff;
      return String(right.updated_at || '').localeCompare(String(left.updated_at || ''));
    })
    .forEach((decision) => {
      if (!map.has(decision.reference_id)) map.set(decision.reference_id, decision);
    });
  return map;
}

export default function ScreeningPanel({ metaProject, onChanged }: Props) {
  const [references, setReferences] = useState<MetaReference[]>([]);
  const [screeningDecisions, setScreeningDecisions] = useState<ScreeningDecision[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [serverWorkflowStats, setServerWorkflowStats] = useState<any>(null);
  const [pageOffset, setPageOffset] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const syncedProjectRef = useRef<string | null>(null);

  const load = useCallback(async ({ forceSync = false }: { forceSync?: boolean } = {}) => {
    setLoading(true);
    try {
      const projectChanged = syncedProjectRef.current !== metaProject.id;
      const requestOffset = projectChanged ? 0 : pageOffset;
      if (projectChanged && pageOffset !== 0) setPageOffset(0);
      const shouldSync = forceSync || projectChanged;
      if (shouldSync) {
        try {
          const { sync } = await metaAnalysisApi.syncArtifacts(metaProject.id);
          syncedProjectRef.current = metaProject.id;
          if (sync.screening.exists && (sync.screening.imported || sync.screening.linked || sync.screening.upserted || sync.screening.preservedUserDecisions || sync.summary.warnings.length)) {
            setSyncMessage(
              `已同步 ${sync.screening.upserted} 条 AI 筛选结果，新增 ${sync.screening.imported} 篇筛选文献，保留 ${sync.screening.preservedUserDecisions} 条用户决策。检索 CSV/JSON 仅作为 AI 初筛输入池，不直接展示。${sync.summary.warnings.length ? ` ${sync.summary.warnings.length} 条记录需检查。` : ''}`,
            );
          } else if (sync.screening.exists) {
            setSyncMessage('03_title_abstract_screening/screening_decisions.csv/json 已检查，暂无新增筛选记录。');
          } else if (sync.search.exists) {
            setSyncMessage('已同步 02_search_dedupe/screening_input.csv/json 作为 AI 一筛输入池；智能筛选页只展示 03_title_abstract_screening/screening_decisions.csv/json 的 AI 一筛/二筛结果。');
          } else {
            setSyncMessage(null);
          }
        } catch (error) {
          setSyncMessage(error instanceof Error ? `Meta artifact 同步失败：${error.message}` : 'Meta artifact 同步失败');
        }
      }
      const response = await metaAnalysisApi.screening(metaProject.id, { limit: pageSize, offset: requestOffset });
      setReferences(response.references);
      setScreeningDecisions(response.decisions);
      setTotal(Number(response.total ?? response.references.length));
      setServerWorkflowStats(response.workflowStats || null);
    } finally {
      setLoading(false);
    }
  }, [metaProject.id, pageOffset, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const decisionByReference = useMemo(() => getLatestDecisionByReference(screeningDecisions), [screeningDecisions]);
  const decisionsByReference = useMemo(() => getDecisionsByReference(screeningDecisions), [screeningDecisions]);
  const fallbackWorkflowStats = useMemo(() => getScreeningWorkflowStats(references, screeningDecisions), [references, screeningDecisions]);
  const workflowStats = useMemo(() => normalizeWorkflowStats(serverWorkflowStats, fallbackWorkflowStats), [fallbackWorkflowStats, serverWorkflowStats]);
  const screenedReferences = useMemo(
    () => references.filter((reference) => decisionByReference.has(reference.id)),
    [decisionByReference, references],
  );
  const pageStart = total === 0 ? 0 : pageOffset + 1;
  const pageEnd = Math.min(pageOffset + pageSize, total);
  const canGoPrevious = pageOffset > 0;
  const canGoNext = pageOffset + pageSize < total;

  const updateDecision = async (referenceId: string, decision: ScreeningDecision['decision'], currentDecision?: ScreeningDecision) => {
    setBusyId(referenceId);
    try {
      await metaAnalysisApi.updateScreening(metaProject.id, referenceId, {
        stage: 'title_abstract',
        decision,
        reviewer: 'user',
        reason: currentDecision?.reason || '',
        evidenceNote: currentDecision?.evidence_note || '',
        confidence: currentDecision?.confidence ?? null,
        metadataJson: currentDecision?.metadata_json || null,
      });
      await load();
      onChanged();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-3 rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
        筛选分两道 AI 关口：检索去重后做题摘一筛/AI 二筛，缺全文记录先移交 Zotero 补 PDF 并同步回项目，再做全文一筛/AI 二筛。AI 一筛保留 PICO 匹配、研究类型、目标结局、全文可获得性和排除原因；误排/误纳或低置信度记录保留为 maybe，交给 Claude 二筛。用户只作为覆盖、抽查和少量冲突处理入口。
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        {[
          ['未筛选', workflowStats.pending],
          ['待 AI 二筛', workflowStats.pendingRescreen],
          ['已 AI 二筛', workflowStats.agentReviewed],
          ['用户覆盖/抽查', workflowStats.userAuthorized],
          ['查漏补缺候选', workflowStats.conflicts],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border border-border bg-background px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
          </div>
        ))}
      </div>
      {syncMessage ? (
        <div className="mb-3 rounded-md border border-emerald-200/70 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-100">
          {syncMessage}
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
        <div>
          当前显示 {pageStart}-{pageEnd} / {total} 条筛选记录
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={pageSize}
            onChange={(event) => {
              setPageOffset(0);
              setPageSize(Number(event.target.value));
            }}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            aria-label="筛选分页大小"
          >
            {[50, 100, 200, 500].map((value) => (
              <option key={value} value={value}>每页 {value}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={!canGoPrevious || loading} onClick={() => setPageOffset(Math.max(0, pageOffset - pageSize))}>
            <ChevronLeft className="h-4 w-4" />
            上一页
          </Button>
          <Button size="sm" variant="outline" disabled={!canGoNext || loading} onClick={() => setPageOffset(pageOffset + pageSize)}>
            下一页
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void load({ forceSync: true })}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            重新同步文件
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full min-w-[1280px] text-left text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">题名</th>
              <th className="px-3 py-2">来源</th>
              <th className="px-3 py-2">年份</th>
              <th className="px-3 py-2">期刊</th>
              <th className="px-3 py-2">决策</th>
              <th className="px-3 py-2">置信度</th>
              <th className="px-3 py-2">Reviewer</th>
              <th className="px-3 py-2">AI 筛选状态</th>
              <th className="px-3 py-2">理由 / 证据</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && screenedReferences.length === 0 ? (
              <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={10}>正在加载筛选记录...</td></tr>
            ) : null}
            {screenedReferences.map((reference) => {
              const currentDecision = decisionByReference.get(reference.id);
              if (!currentDecision) return null;
              const current = currentDecision.decision;
              const conflict = hasDecisionConflict(decisionsByReference.get(reference.id) || []);
              return (
                <tr key={reference.id} className="border-t border-border align-top">
                  <td className="max-w-xl px-3 py-2">
                    <div className="font-medium text-foreground">{reference.title}</div>
                    {reference.abstract && <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{reference.abstract}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{getSourceLabel(currentDecision)}</td>
                  <td className="px-3 py-2">{reference.year || '-'}</td>
                  <td className="px-3 py-2">{reference.journal || '-'}</td>
                  <td className="px-3 py-2">{current}</td>
                  <td className="px-3 py-2">{formatConfidence(currentDecision?.confidence)}</td>
                  <td className="px-3 py-2">{currentDecision?.reviewer || '-'}</td>
                  <td className="max-w-[13rem] px-3 py-2 text-xs text-muted-foreground">
                    {conflict ? <span className="font-semibold text-amber-700 dark:text-amber-300">查漏补缺候选 · </span> : null}
                    {getReviewerStatus(currentDecision)}
                  </td>
                  <td className="max-w-sm px-3 py-2 text-xs text-muted-foreground">
                    {currentDecision?.reason ? <div className="line-clamp-2">{currentDecision.reason}</div> : null}
                    {currentDecision?.evidence_note ? <div className="mt-1 line-clamp-2">{currentDecision.evidence_note}</div> : null}
                    {!currentDecision?.reason && !currentDecision?.evidence_note ? '-' : null}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {decisions.map((decision) => (
                        <Button key={decision} size="sm" variant={current === decision ? 'default' : 'outline'} disabled={busyId === reference.id} onClick={() => void updateDecision(reference.id, decision, currentDecision)}>
                          {decision}
                        </Button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && screenedReferences.length === 0 && (
              <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={10}>尚无 AI 一筛结果。请先完成检索和去重，生成 02_search_dedupe/screening_input.csv；然后让 AI/Claude 写入 03_title_abstract_screening/screening_decisions.csv 或 screening_decisions.json。原始搜索结果不会直接显示在这里。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
