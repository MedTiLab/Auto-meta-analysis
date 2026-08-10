import { useEffect, useMemo, useState } from 'react';
import { Play, Search } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { metaAnalysisApi } from '../api/metaAnalysisApi';
import type { MetaProject, MetaSearchRun, MetaSearchSource } from '../types';

type Props = {
  metaProject: MetaProject;
  onChanged: () => void;
};

const SOURCE_NOTE_ZH: Record<string, string> = {
  pubmed: '默认英文正式检索，可直接生成检索式并运行。',
  zotero: '个人文献库同步，仅在用户要求时处理。',
  openalex: 'OA 发现或引文追踪，仅在用户明确要求时处理。',
  chinese: '中文文献或 CNKI，仅在用户明确要求时处理。',
  'manual-import': '需用户提供导出记录后再导入去重。',
};

const SOURCE_MODE_LABEL_ZH: Record<string, string> = {
  direct: '可直接运行',
  sync: '按需同步',
  explicit: '需明确要求',
  import: '导入记录',
};

export default function SearchPanel({ metaProject, onChanged }: Props) {
  const [disease, setDisease] = useState(metaProject.disease || '');
  const [biomarker, setBiomarker] = useState(metaProject.biomarker || '');
  const [query, setQuery] = useState('');
  const [retmax, setRetmax] = useState(200);
  const [runs, setRuns] = useState<MetaSearchRun[]>([]);
  const [sources, setSources] = useState<MetaSearchSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('pubmed');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadRuns = async () => {
    const response = await metaAnalysisApi.searchRuns(metaProject.id);
    setRuns(response.searchRuns);
  };

  useEffect(() => {
    void loadRuns();
    metaAnalysisApi.searchSources(metaProject.id)
      .then((response) => {
        setSources(response.sources);
        setSelectedSourceId(response.defaultSourceId || 'pubmed');
      })
      .catch(() => {
        setSources([]);
      });
  }, [metaProject.id]);

  const runGroups = useMemo(() => {
    return runs.reduce<Record<string, { count: number; results: number; imported: number }>>((acc, run) => {
      const key = run.database_name || 'unknown';
      if (!acc[key]) acc[key] = { count: 0, results: 0, imported: 0 };
      acc[key].count += 1;
      acc[key].results += Number(run.result_count || 0);
      acc[key].imported += Number(run.imported_count || 0);
      return acc;
    }, {});
  }, [runs]);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) || sources.find((source) => source.id === 'pubmed') || null,
    [selectedSourceId, sources],
  );

  const buildQuery = async () => {
    setBusy(true);
    try {
      const response = await metaAnalysisApi.buildQuery(metaProject.id, {
        disease,
        biomarker,
        reviewType: metaProject.review_type,
        databaseName: selectedSource?.id || 'pubmed',
      });
      setQuery(response.pubmed);
      const warnings = response.warnings?.length ? ` ${response.warnings.join(' ')}` : '';
      setMessage(`已生成 PubMed/MEDLINE 检索式，可继续编辑后运行。${warnings}`);
    } finally {
      setBusy(false);
    }
  };

  const runSearch = async () => {
    if ((selectedSource?.id || 'pubmed') !== 'pubmed') {
      setMessage('当前内置运行入口只执行 PubMed/MEDLINE。其他来源请按项目记忆规则明确选择、同步或导入记录。');
      return;
    }
    setBusy(true);
    try {
      const response = await metaAnalysisApi.runPubMedSearch(metaProject.id, { query, retmax, databaseName: 'pubmed' });
      const { sync } = await metaAnalysisApi.syncArtifacts(metaProject.id);
      setMessage(
        `检索完成：${response.resultCount} 条结果，导入 ${response.importedCount} 条，进入筛选候选池 ${response.linkedCount} 条，重复 ${response.duplicates} 条。已生成 AI 初筛输入；智能筛选页会在筛选决策写入后显示结果。${sync.summary.warnings.length ? ` ${sync.summary.warnings.length} 条同步提示需检查。` : ''}`,
      );
      await loadRuns();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-auto p-4">
      {sources.length > 0 && (
        <div className="mb-4 rounded-md border border-border bg-muted/20 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-foreground">检索来源</div>
              <div className="text-xs text-muted-foreground">默认只运行 PubMed/MEDLINE；其他来源按项目记忆规则处理。</div>
            </div>
            <span className="rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
              当前：{selectedSource?.label || 'PubMed/MEDLINE'}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2">
            {sources.map((source) => {
              const direct = source.mode === 'direct';
              return (
                <button
                  type="button"
                  key={source.id}
                  className={`rounded-md border p-2 text-left transition ${
                    selectedSourceId === source.id
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border bg-background text-foreground hover:border-primary/60'
                  } ${direct ? '' : 'cursor-default opacity-80'}`}
                  onClick={() => {
                    if (direct) setSelectedSourceId(source.id);
                  }}
                  aria-pressed={selectedSourceId === source.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{source.label}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {SOURCE_MODE_LABEL_ZH[source.mode] || '按规则处理'}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{SOURCE_NOTE_ZH[source.id] || source.note}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_9rem]">
        <Input value={disease} onChange={(event) => setDisease(event.target.value)} placeholder="Disease" />
        <Input value={biomarker} onChange={(event) => setBiomarker(event.target.value)} placeholder="Biomarker" />
        <Input type="number" min={1} max={1000} value={retmax} onChange={(event) => setRetmax(Number(event.target.value) || 200)} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void buildQuery()} disabled={busy}>
          <Search className="h-4 w-4" />
          生成检索式
        </Button>
        <Button onClick={() => void runSearch()} disabled={busy || !query.trim()}>
          <Play className="h-4 w-4" />
          运行 PubMed/MEDLINE 并导入
        </Button>
      </div>

      {message && <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">{message}</div>}

      {runs.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {Object.entries(runGroups).map(([database, group]) => (
            <span key={database} className="rounded-md border border-border bg-muted/30 px-2 py-1">
              {database}: {group.count} 次 · {group.results} 条结果 · 导入 {group.imported}
            </span>
          ))}
        </div>
      ) : null}

      <label className="mt-4 block space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">PubMed/MEDLINE query</span>
        <textarea className="min-h-36 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>

      <div className="mt-5 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">数据库</th>
              <th className="px-3 py-2">结果</th>
              <th className="px-3 py-2">导入</th>
              <th className="px-3 py-2">时间</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-t border-border">
                <td className="px-3 py-2">{run.database_name}</td>
                <td className="px-3 py-2">{run.result_count}</td>
                <td className="px-3 py-2">{run.imported_count}</td>
                <td className="px-3 py-2 text-muted-foreground">{run.searched_at}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr><td className="px-3 py-6 text-center text-muted-foreground" colSpan={4}>尚无检索记录</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
