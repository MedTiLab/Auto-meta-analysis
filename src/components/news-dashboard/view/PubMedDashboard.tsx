import { ArrowRight, Check, ExternalLink, Folder, Library, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project } from '../../../types/app';
import { api } from '../../../utils/api';
import type { ChatPromptDraft } from '../../../utils/chatPromptDraft';
import type { ReferenceFolder } from '../../references/types';
import type { NewsItem } from './NewsItemCard';

type PubMedDashboardProps = {
  chatTargetProject?: Project | null;
  onStartResearchPrompt?: (project: Project, prompt: string | ChatPromptDraft) => void;
};

type PubMedResults = {
  top_papers?: NewsItem[];
  total_found?: number;
};

function buildPrompt(item: NewsItem) {
  return [
    '请基于这篇 PubMed 文献，帮我总结核心发现、研究局限，以及它对当前项目可能有用的下一步。',
    '',
    `标题：${item.title}`,
    item.authors ? `作者：${item.authors}` : '',
    item.published ? `发表时间：${item.published}` : '',
    item.link ? `链接：${item.link}` : '',
    item.abstract ? `\n摘要：\n${item.abstract}` : '',
  ].filter(Boolean).join('\n');
}

export default function PubMedDashboard({ chatTargetProject, onStartResearchPrompt }: PubMedDashboardProps) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState<ReferenceFolder[]>([]);
  const [importFolderId, setImportFolderId] = useState('');

  const loadResults = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.news.getResults('pubmed');
      const payload = await response.json().catch(() => ({})) as PubMedResults;
      if (!response.ok) throw new Error('无法读取 PubMed 动态');
      setItems(Array.isArray(payload.top_papers) ? payload.top_papers : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取 PubMed 动态');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  const loadFolders = useCallback(async () => {
    try {
      const response = await api.references.folders();
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '无法读取文献文件夹');
      setFolders(Array.isArray(payload.folders) ? payload.folders : []);
    } catch (folderLoadError) {
      setError(folderLoadError instanceof Error ? folderLoadError.message : '无法读取文献文件夹');
    }
  }, []);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  const createImportFolder = async () => {
    const name = window.prompt('新文件夹名称');
    if (!name?.trim()) return;
    setError(null);
    try {
      const response = await api.references.createFolder(name.trim());
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || '创建文件夹失败');
      await loadFolders();
      if (payload.folder?.id) setImportFolderId(payload.folder.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建文件夹失败');
    }
  };

  const refresh = async () => {
    setSearching(true);
    setError(null);
    try {
      const keywordQuery = query.trim();
      const keywords = keywordQuery
        .split(/\s+(?:AND|OR)\s+|[,;，；]/i)
        .map((keyword) => keyword.replace(/\[[^\]]+\]/g, '').replace(/[()\"]/g, '').trim())
        .filter(Boolean);
      const configOverride = keywordQuery ? {
        research_domains: {
          'Keyword search': {
            query: keywordQuery,
            keywords: keywords.length > 0 ? keywords : [keywordQuery],
            priority: 5,
          },
        },
        top_n: 20,
        max_results: 120,
        date_range_days: 365,
      } : undefined;
      const response = await api.news.search('pubmed', configOverride);
      const payload = await response.json().catch(() => ({})) as PubMedResults & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'PubMed 检索失败');
      setItems(Array.isArray(payload.top_papers) ? payload.top_papers : []);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'PubMed 检索失败');
    } finally {
      setSearching(false);
    }
  };

  const visibleItems = useMemo(() => items, [items]);

  const importToLibrary = async (item: NewsItem) => {
    const itemId = String(item.id || item.link || item.title);
    setImportingIds((current) => new Set(current).add(itemId));
    setError(null);
    try {
      const response = await api.references.importPubmed(item, importFolderId || null);
      const payload = await response.json().catch(() => ({})) as { error?: string; ids?: string[] };
      if (!response.ok) throw new Error(payload.error || '导入文献库失败');
      setImportedIds((current) => new Set(current).add(itemId));
      window.dispatchEvent(new CustomEvent('references-library-updated'));
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '导入文献库失败');
    } finally {
      setImportingIds((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-5xl px-5 py-7 sm:px-8 sm:py-9">
        <header className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground">PUBMED</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">文献动态</h1>
            <p className="mt-2 text-sm text-muted-foreground">只保留 PubMed。浏览近期结果，挑一篇发送给研究助手。</p>
          </div>
          <form
            className="flex items-center gap-3 sm:w-[440px]"
            onSubmit={(event) => {
              event.preventDefault();
              void refresh();
            }}
          >
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="输入 PubMed 关键词或检索式…"
                aria-label="PubMed search keywords"
                className="h-10 w-full border-b border-border bg-transparent pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary"
              />
            </div>
            <button
              type="submit"
              onClick={() => void refresh()}
              disabled={searching}
              className="inline-flex h-9 items-center gap-2 bg-primary/90 px-3 text-xs font-medium text-primary-foreground shadow-sm shadow-primary/15 hover:bg-primary disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${searching ? 'animate-spin' : ''}`} />
              检索
            </button>
          </form>
        </header>

        {error && <p className="border-b border-border py-4 text-sm text-muted-foreground">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 py-4 text-xs text-muted-foreground">
          <span>{visibleItems.length} 篇</span>
          <div className="flex flex-wrap items-center gap-2">
            {query.trim() && <span className="bg-primary/8 px-2 py-1 text-primary">检索词：{query.trim()}</span>}
            <label className="inline-flex items-center gap-2">
              <Folder className="h-3.5 w-3.5" />
              <span>导入位置</span>
              <select
                value={importFolderId}
                onChange={(event) => setImportFolderId(event.target.value)}
                className="h-8 max-w-[220px] rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
              >
                <option value="">文献库根目录（未分类）</option>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void createImportFolder()} className="inline-flex h-8 items-center gap-1 text-primary hover:underline">
              <Plus className="h-3.5 w-3.5" /> 新建文件夹
            </button>
          </div>
        </div>

        <div>
          {visibleItems.map((item) => (
            <article key={item.id || item.link || item.title} className="border-t border-border py-5 last:border-b">
              <div className="flex items-start justify-between gap-5">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold leading-6 text-foreground">{item.title}</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {[item.authors, item.published].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {item.link && (
                  <a href={item.link} target="_blank" rel="noreferrer" className="mt-0.5 flex-none text-muted-foreground hover:text-foreground" aria-label="Open in PubMed">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>

              {item.abstract && (
                <details className="mt-3 group">
                  <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground hover:text-foreground">查看摘要</summary>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">{item.abstract}</p>
                </details>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  disabled={!chatTargetProject || !onStartResearchPrompt}
                  onClick={() => chatTargetProject && onStartResearchPrompt?.(chatTargetProject, buildPrompt(item))}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-30"
                >
                  发送到聊天 <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={importingIds.has(String(item.id || item.link || item.title))}
                  onClick={() => void importToLibrary(item)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline disabled:opacity-40"
                >
                  {importedIds.has(String(item.id || item.link || item.title)) ? (
                    <><Check className="h-3.5 w-3.5" /> 已导入文献库</>
                  ) : importingIds.has(String(item.id || item.link || item.title)) ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在导入</>
                  ) : (
                    <><Library className="h-3.5 w-3.5" /> 导入文献库</>
                  )}
                </button>
              </div>
            </article>
          ))}
          {visibleItems.length === 0 && <p className="py-16 text-center text-sm text-muted-foreground">暂无结果，请输入关键词开始检索</p>}
        </div>
      </div>
    </div>
  );
}
