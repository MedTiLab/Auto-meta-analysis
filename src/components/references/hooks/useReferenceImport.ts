import { useState, useCallback } from 'react';
import { api } from '../../../utils/api';
import type { ZoteroCollection, ZoteroItem } from '../types';

interface ImportState {
  syncing: boolean;
  importing: boolean;
  syncResult: { synced: number; mode: string } | null;
  importResult: { imported: number } | null;
  error: string | null;
}

export function useReferenceImport(projectName?: string, onComplete?: () => void) {
  const [state, setState] = useState<ImportState>({
    syncing: false,
    importing: false,
    syncResult: null,
    importResult: null,
    error: null,
  });

  const syncZotero = useCallback(async (opts?: { collectionKey?: string; sourceIds?: string[] }) => {
    setState((s) => ({ ...s, syncing: true, error: null, syncResult: null }));
    try {
      const res = await api.references.syncZotero({
        projectName,
        collectionKey: opts?.collectionKey,
        sourceIds: opts?.sourceIds,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Sync failed' }));
        throw new Error(data.error || 'Sync failed');
      }
      const data = await res.json();
      setState((s) => ({
        ...s,
        syncing: false,
        syncResult: { synced: data.synced, mode: data.mode },
      }));
      onComplete?.();
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setState((s) => ({ ...s, syncing: false, error: msg }));
      throw err;
    }
  }, [projectName, onComplete]);

  const importBibtex = useCallback(async (file: File) => {
    setState((s) => ({ ...s, importing: true, error: null, importResult: null }));
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (projectName) {
        formData.append('projectName', projectName);
      }
      const res = await api.references.importBibtex(formData);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Import failed' }));
        throw new Error(data.error || 'Import failed');
      }
      const data = await res.json();
      setState((s) => ({
        ...s,
        importing: false,
        importResult: { imported: data.imported },
      }));
      onComplete?.();
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setState((s) => ({ ...s, importing: false, error: msg }));
      throw err;
    }
  }, [projectName, onComplete]);

  const fetchZoteroCollections = useCallback(async (): Promise<ZoteroCollection[]> => {
    const res = await api.references.zoteroCollections();
    if (!res.ok) throw new Error('Failed to fetch collections');
    const data = await res.json();
    return data.collections || [];
  }, []);

  const fetchZoteroItems = useCallback(async (collectionKey?: string): Promise<ZoteroItem[]> => {
    const res = await api.references.zoteroItems({ collectionKey, limit: 200 });
    if (!res.ok) throw new Error('Failed to fetch items');
    const data = await res.json();
    return data.items || [];
  }, []);

  const clearResults = useCallback(() => {
    setState({ syncing: false, importing: false, syncResult: null, importResult: null, error: null });
  }, []);

  return { ...state, syncZotero, importBibtex, fetchZoteroCollections, fetchZoteroItems, clearResults };
}
