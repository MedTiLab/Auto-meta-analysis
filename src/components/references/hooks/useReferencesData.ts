import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../utils/api';
import type {
  ProjectReference,
  ProjectReferenceStats,
  Reference,
  ReferenceFolder,
  ReferenceFolderStats,
  ReferenceTag,
  ZoteroStatus,
} from '../types';

interface UseReferencesDataOptions {
  projectName?: string;
  autoFetch?: boolean;
}

export function useReferencesData({ projectName, autoFetch = true }: UseReferencesDataOptions = {}) {
  const [references, setReferences] = useState<Reference[]>([]);
  const [referencesTotal, setReferencesTotal] = useState(0);
  const [projectReferences, setProjectReferences] = useState<ProjectReference[]>([]);
  const [projectReferenceStats, setProjectReferenceStats] = useState<ProjectReferenceStats>({
    total_count: 0,
    linked_count: 0,
    local_only_count: 0,
    local_artifact_count: 0,
  });
  const [tags, setTags] = useState<ReferenceTag[]>([]);
  const [folders, setFolders] = useState<ReferenceFolder[]>([]);
  const [folderStats, setFolderStats] = useState<ReferenceFolderStats>({
    total_count: 0,
    unfiled_count: 0,
  });
  const [zoteroStatus, setZoteroStatus] = useState<ZoteroStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReferences = useCallback(async (
    search?: string,
    filterTags?: string[],
    folderId?: string,
    limit = 50,
    offset = 0,
  ) => {
    try {
      setLoading(true);
      setError(null);
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (filterTags && filterTags.length > 0) params.tags = filterTags.join(',');
      if (folderId && folderId !== 'all') params.folderId = folderId;
      params.limit = String(limit);
      params.offset = String(offset);
      const res = await api.references.list(params);
      if (!res.ok) throw new Error('Failed to fetch references');
      const data = await res.json();
      setReferences(data.references || []);
      setReferencesTotal(Number(data.total || 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFolders = useCallback(async () => {
    try {
      const res = await api.references.folders();
      if (!res.ok) throw new Error('Failed to fetch reference folders');
      const data = await res.json();
      setFolders(data.folders || []);
      setFolderStats({
        total_count: Number(data.total_count || 0),
        unfiled_count: Number(data.unfiled_count || 0),
      });
    } catch (err) {
      console.error('Error fetching reference folders:', err);
    }
  }, []);

  const fetchProjectReferences = useCallback(async () => {
    if (!projectName) {
      setProjectReferences([]);
      setProjectReferenceStats({
        total_count: 0,
        linked_count: 0,
        local_only_count: 0,
        local_artifact_count: 0,
      });
      return;
    }
    try {
      const res = await api.references.aggregatedProjectRefs(projectName);
      if (!res.ok) throw new Error('Failed to fetch project references');
      const data = await res.json();
      setProjectReferences(data.references || []);
      setProjectReferenceStats(data.stats || {
        total_count: 0,
        linked_count: 0,
        local_only_count: 0,
        local_artifact_count: 0,
      });
    } catch (err) {
      console.error('Error fetching project references:', err);
      setProjectReferences([]);
      setProjectReferenceStats({
        total_count: 0,
        linked_count: 0,
        local_only_count: 0,
        local_artifact_count: 0,
      });
    }
  }, [projectName]);

  const fetchTags = useCallback(async () => {
    try {
      const res = await api.references.tags();
      if (!res.ok) throw new Error('Failed to fetch tags');
      const data = await res.json();
      setTags(data.tags || []);
    } catch (err) {
      console.error('Error fetching tags:', err);
    }
  }, []);

  const checkZoteroStatus = useCallback(async () => {
    try {
      const res = await api.references.zoteroStatus();
      if (res.ok) {
        const data = await res.json();
        setZoteroStatus(data);
        return data;
      } else {
        const fallback = {
          connected: false,
          mode: null,
          localAvailable: false,
          localRunning: false,
          localApiDisabled: false,
          endpoint: null,
          detail: null,
        } as ZoteroStatus;
        setZoteroStatus(fallback);
        return fallback;
      }
    } catch {
      const fallback = {
        connected: false,
        mode: null,
        localAvailable: false,
        localRunning: false,
        localApiDisabled: false,
        endpoint: null,
        detail: null,
      } as ZoteroStatus;
      setZoteroStatus(fallback);
      return fallback;
    }
  }, []);

  const linkToProject = useCallback(async (referenceId: string) => {
    if (!projectName) return;
    try {
      const res = await api.references.linkToProject(projectName, referenceId);
      if (res.ok) {
        await fetchProjectReferences();
      }
    } catch (err) {
      console.error('Error linking reference:', err);
    }
  }, [projectName, fetchProjectReferences]);

  const unlinkFromProject = useCallback(async (referenceId: string) => {
    if (!projectName) return;
    try {
      const res = await api.references.unlinkFromProject(projectName, referenceId);
      if (res.ok) {
        await fetchProjectReferences();
      }
    } catch (err) {
      console.error('Error unlinking reference:', err);
    }
  }, [projectName, fetchProjectReferences]);

  const bulkUnlinkFromProject = useCallback(async (referenceIds: string[]) => {
    if (!projectName) return;
    if (!referenceIds || referenceIds.length === 0) return;

    const idSet = new Set(referenceIds);
    // Optimistic UI update: remove from project list immediately.
    setProjectReferences(prev => prev.filter(r => !idSet.has(r.id)));

    try {
      const results = await Promise.all(
        referenceIds.map((id) => api.references.unlinkFromProject(projectName, id)),
      );
      const failed = results.some((r) => !r.ok);
      if (failed) {
        throw new Error('Failed to unlink one or more references');
      }
    } catch (err) {
      console.error('Error bulk unlinking references:', err);
      // If something fails, fetch again to reconcile local state with server state.
      await fetchProjectReferences();
      return;
    }

    await fetchProjectReferences();
  }, [projectName, fetchProjectReferences]);

  const deleteReference = useCallback(async (referenceId: string) => {
    try {
      const res = await api.references.delete(referenceId);
      if (!res.ok) throw new Error('Failed to delete reference');
      setReferences(prev => prev.filter(r => r.id !== referenceId));
      setReferencesTotal(prev => Math.max(0, prev - 1));
      setProjectReferences(prev => prev.filter(r => r.id !== referenceId));
      await fetchFolders();
    } catch (err) {
      console.error('Error deleting reference:', err);
      throw err;
    }
  }, [fetchFolders]);

  const bulkDeleteReferences = useCallback(async (referenceIds: string[]) => {
    if (referenceIds.length === 0) return;
    try {
      const res = await api.references.bulkDelete(referenceIds);
      if (!res.ok) throw new Error('Failed to delete references');
      const idSet = new Set(referenceIds);
      setReferences(prev => prev.filter(r => !idSet.has(r.id)));
      setReferencesTotal(prev => Math.max(0, prev - idSet.size));
      setProjectReferences(prev => prev.filter(r => !idSet.has(r.id)));
      await fetchFolders();
    } catch (err) {
      console.error('Error bulk-deleting references:', err);
      throw err;
    }
  }, [fetchFolders]);

  const createFolder = useCallback(async (name: string) => {
    const res = await api.references.createFolder(name);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to create folder');
    await fetchFolders();
    return data.folder as ReferenceFolder;
  }, [fetchFolders]);

  const renameFolder = useCallback(async (folderId: string, name: string) => {
    const res = await api.references.renameFolder(folderId, name);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to rename folder');
    await fetchFolders();
    return data.folder as ReferenceFolder;
  }, [fetchFolders]);

  const deleteFolder = useCallback(async (folderId: string) => {
    const res = await api.references.deleteFolder(folderId);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to delete folder');
    await fetchFolders();
  }, [fetchFolders]);

  const addReferencesToFolder = useCallback(async (folderId: string, referenceIds: string[]) => {
    const res = await api.references.addToFolder(folderId, referenceIds);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to add references to folder');
    await fetchFolders();
    return Number(data.added || 0);
  }, [fetchFolders]);

  const removeReferenceFromFolder = useCallback(async (folderId: string, referenceId: string) => {
    const res = await api.references.removeFromFolder(folderId, referenceId);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to remove reference from folder');
    await fetchFolders();
  }, [fetchFolders]);

  const removeReferenceFromAllFolders = useCallback(async (referenceId: string) => {
    const res = await api.references.removeFromAllFolders(referenceId);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to remove reference from folders');
    await fetchFolders();
  }, [fetchFolders]);

  const refresh = useCallback(async () => {
    await Promise.all([
      fetchReferences(),
      fetchProjectReferences(),
      fetchTags(),
      fetchFolders(),
      checkZoteroStatus(),
    ]);
  }, [fetchReferences, fetchProjectReferences, fetchTags, fetchFolders, checkZoteroStatus]);

  useEffect(() => {
    if (autoFetch) {
      void refresh();
    }
  }, [autoFetch, refresh]);

  useEffect(() => {
    const onRefsUpdated = () => {
      void refresh();
    };
    window.addEventListener('references-library-updated', onRefsUpdated);
    return () => window.removeEventListener('references-library-updated', onRefsUpdated);
  }, [refresh]);

  return {
    references,
    referencesTotal,
    projectReferences,
    projectReferenceStats,
    tags,
    folders,
    folderStats,
    zoteroStatus,
    loading,
    error,
    fetchReferences,
    fetchProjectReferences,
    fetchTags,
    fetchFolders,
    checkZoteroStatus,
    linkToProject,
    unlinkFromProject,
    bulkUnlinkFromProject,
    deleteReference,
    bulkDeleteReferences,
    createFolder,
    renameFolder,
    deleteFolder,
    addReferencesToFolder,
    removeReferenceFromFolder,
    removeReferenceFromAllFolders,
    refresh,
  };
}
