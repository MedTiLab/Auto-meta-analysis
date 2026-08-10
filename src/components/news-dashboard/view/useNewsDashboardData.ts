import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../../utils/api';
import type { NewsItem } from './NewsItemCard';

export type NewsSourceKey = 'pubmed' | 'europepmc' | 'medrxiv' | 'arxiv' | 'xiaohongshu';

export type SourceInfo = {
  key: NewsSourceKey;
  label: string;
  hasResults: boolean;
  lastSearchDate: string | null;
  requiresCredentials: boolean;
  credentialType: string | null;
  credentialStatus: 'not_required' | 'configured' | 'missing';
};

export type SearchResults = {
  top_papers: NewsItem[];
  total_found: number;
  total_filtered: number;
  search_date?: string;
};

export type ResearchDomain = {
  keywords: string[];
  arxiv_categories: string[];
  priority: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SourceConfig = Record<string, any>;

/** Sources shown in the literature triage UI (indexed feeds only). */
export const LITERATURE_TRIAGE_SOURCES: NewsSourceKey[] = ['pubmed', 'europepmc', 'medrxiv', 'arxiv'];

/** Hero column stat cards on the right: indexed sources only (no per-source count tile for social/note feeds). */
export const LITERATURE_HERO_STAT_SOURCES: NewsSourceKey[] = ['pubmed', 'europepmc', 'medrxiv', 'arxiv'];

function normalizeSearchResults(raw: unknown): SearchResults {
  if (!raw || typeof raw !== 'object') {
    return { top_papers: [], total_found: 0, total_filtered: 0 };
  }
  const r = raw as Partial<SearchResults>;
  const top = r.top_papers;
  return {
    top_papers: Array.isArray(top) ? top : [],
    total_found: typeof r.total_found === 'number' ? r.total_found : 0,
    total_filtered: typeof r.total_filtered === 'number' ? r.total_filtered : 0,
    search_date: r.search_date,
  };
}

export function useNewsDashboardData() {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [configs, setConfigs] = useState<Record<NewsSourceKey, SourceConfig>>({} as Record<NewsSourceKey, SourceConfig>);
  const [results, setResults] = useState<Record<NewsSourceKey, SearchResults>>({} as Record<NewsSourceKey, SearchResults>);
  const [isSearching, setIsSearching] = useState<Record<NewsSourceKey, boolean>>({} as Record<NewsSourceKey, boolean>);
  const [errors, setErrors] = useState<Record<NewsSourceKey, string | null>>({} as Record<NewsSourceKey, string | null>);
  const [configDirty, setConfigDirty] = useState<Record<NewsSourceKey, boolean>>({} as Record<NewsSourceKey, boolean>);
  const [searchLogs, setSearchLogs] = useState<Record<NewsSourceKey, string[]>>({} as Record<NewsSourceKey, string[]>);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch all data on mount
  useEffect(() => {
    async function load() {
      try {
        const sourcesBody = await api.news.getSources().then((r) => r.json()).catch(() => null);
        const raw = (
          sourcesBody && typeof sourcesBody === 'object' && Array.isArray((sourcesBody as { sources?: unknown }).sources)
            ? ((sourcesBody as { sources: SourceInfo[] }).sources)
            : []
        ) as SourceInfo[];
        setSources(raw.filter((s) => s?.key && LITERATURE_TRIAGE_SOURCES.includes(s.key)));

        const configPromises = LITERATURE_TRIAGE_SOURCES.map((key) =>
          api.news.getConfig(key).then((r) => r.json()).catch(() => ({}))
        );
        const resultPromises = LITERATURE_TRIAGE_SOURCES.map((key) =>
          api.news.getResults(key).then((r) => r.json()).catch(() => ({ top_papers: [], total_found: 0, total_filtered: 0 }))
        );

        const [cfgs, ress] = await Promise.all([
          Promise.all(configPromises),
          Promise.all(resultPromises),
        ]);

        const newConfigs = {} as Record<NewsSourceKey, SourceConfig>;
        const newResults = {} as Record<NewsSourceKey, SearchResults>;
        LITERATURE_TRIAGE_SOURCES.forEach((key, i) => {
          newConfigs[key] = cfgs[i];
          newResults[key] = normalizeSearchResults(ress[i]);
        });
        setConfigs(newConfigs);
        setResults(newResults);
      } catch (err) {
        console.error('Failed to load news dashboard data:', err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  // Poll intermediate results while any source is searching
  const isSearchingRef = useRef(isSearching);
  isSearchingRef.current = isSearching;

  useEffect(() => {
    const searchingKeys = LITERATURE_TRIAGE_SOURCES.filter((k) => isSearching[k]);
    if (searchingKeys.length === 0) return;

    const interval = setInterval(async () => {
      const currentSearching = LITERATURE_TRIAGE_SOURCES.filter((k) => isSearchingRef.current[k]);
      if (currentSearching.length === 0) return;

      await Promise.allSettled(
        currentSearching.map(async (key) => {
          try {
            // Poll intermediate results
            const resPromise = api.news.getResults(key);
            // Poll search logs
            const logPromise = api.news.getLogs(key);

            const [resResult, logResult] = await Promise.allSettled([resPromise, logPromise]);

            if (resResult.status === 'fulfilled' && resResult.value.ok) {
              const data = await resResult.value.json();
              const normalized = normalizeSearchResults(data);
              if (normalized.top_papers.length > 0) {
                setResults((prev) => ({ ...prev, [key]: normalized }));
              }
            }

            if (logResult.status === 'fulfilled' && logResult.value.ok) {
              const logData = await logResult.value.json();
              if (logData?.logs?.length > 0) {
                setSearchLogs((prev) => ({ ...prev, [key]: logData.logs }));
              }
            }
          } catch {
            // ignore polling errors
          }
        })
      );
    }, 2000);

    return () => clearInterval(interval);
  }, [isSearching]);

  const searchSource = useCallback(async (key: NewsSourceKey) => {
    setIsSearching((prev) => ({ ...prev, [key]: true }));
    setErrors((prev) => ({ ...prev, [key]: null }));
    setSearchLogs((prev) => ({ ...prev, [key]: [] }));
    try {
      // Save config if dirty
      if (configDirty[key] && configs[key]) {
        await api.news.updateConfig(key, configs[key]);
        setConfigDirty((prev) => ({ ...prev, [key]: false }));
      }
      const res = await api.news.search(key);
      if (!res.ok) {
        const errData = await res.json();
        // Show logs from failed search if available
        if (errData.logs) {
          setSearchLogs((prev) => ({ ...prev, [key]: errData.logs }));
        }
        throw new Error(errData.error || 'Search failed');
      }
      const data = await res.json();
      // Capture logs returned with results
      if (data.logs) {
        setSearchLogs((prev) => ({ ...prev, [key]: data.logs }));
      }
      setResults((prev) => ({ ...prev, [key]: normalizeSearchResults(data) }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Search failed';
      setErrors((prev) => ({ ...prev, [key]: message }));
    } finally {
      setIsSearching((prev) => ({ ...prev, [key]: false }));
    }
  }, [configs, configDirty]);

  const searchAll = useCallback(async (activeKeys: NewsSourceKey[]) => {
    await Promise.allSettled(activeKeys.map((key) => searchSource(key)));
  }, [searchSource]);

  const updateConfig = useCallback((key: NewsSourceKey, config: SourceConfig) => {
    setConfigs((prev) => ({ ...prev, [key]: config }));
    setConfigDirty((prev) => ({ ...prev, [key]: true }));
  }, []);

  const saveConfig = useCallback(async (key: NewsSourceKey) => {
    if (!configs[key]) return;
    try {
      await api.news.updateConfig(key, configs[key]);
      setConfigDirty((prev) => ({ ...prev, [key]: false }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save config';
      setErrors((prev) => ({ ...prev, [key]: message }));
    }
  }, [configs]);

  const resetConfig = useCallback(async (key: NewsSourceKey) => {
    try {
      const res = await api.news.resetConfig(key);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to reset config');
      }

      const data = await res.json();
      const nextConfig = data?.config || {};
      setConfigs((prev) => ({ ...prev, [key]: nextConfig }));
      setConfigDirty((prev) => ({ ...prev, [key]: false }));
      setErrors((prev) => ({ ...prev, [key]: null }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to reset config';
      setErrors((prev) => ({ ...prev, [key]: message }));
    }
  }, []);

  const clearError = useCallback((key: NewsSourceKey) => {
    setErrors((prev) => ({ ...prev, [key]: null }));
  }, []);

  const clearResults = useCallback((key: NewsSourceKey) => {
    setResults((prev) => ({ ...prev, [key]: { top_papers: [], total_found: 0, total_filtered: 0 } }));
    setSearchLogs((prev) => ({ ...prev, [key]: [] }));
    setErrors((prev) => ({ ...prev, [key]: null }));
  }, []);

  return {
    sources,
    configs,
    results,
    isSearching,
    errors,
    configDirty,
    searchLogs,
    isLoading,
    searchSource,
    searchAll,
    updateConfig,
    saveConfig,
    resetConfig,
    clearError,
    clearResults,
  };
}
