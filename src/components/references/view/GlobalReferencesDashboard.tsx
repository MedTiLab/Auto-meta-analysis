import ReactDOM from 'react-dom';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  Library,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { DragEvent as ReactDragEvent, FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Project } from '../../../types/app';
import { Button } from '../../ui/button';
import { useReferencesData } from '../hooks/useReferencesData';
import type { Reference } from '../types';
import { formatAuthors } from '../types';
import ImportDialog from './ImportDialog';
import ReferenceCard from './ReferenceCard';

type GlobalReferencesDashboardProps = {
  chatTargetProject?: Project | null;
  onChatFromReference?: (project: Project, reference: Reference) => void;
};

type PendingDelete = {
  type: 'single' | 'bulk';
  references: Reference[];
};

export default function GlobalReferencesDashboard({
  chatTargetProject,
  onChatFromReference,
}: GlobalReferencesDashboardProps) {
  const { t } = useTranslation('references');
  const {
    references,
    referencesTotal,
    zoteroStatus,
    loading,
    error,
    fetchReferences,
    fetchFolders,
    checkZoteroStatus,
    deleteReference,
    bulkDeleteReferences,
    folders,
    folderStats,
    createFolder,
    renameFolder,
    deleteFolder,
    addReferencesToFolder,
    removeReferenceFromFolder,
    removeReferenceFromAllFolders,
  } = useReferencesData();
  const [query, setQuery] = useState('');
  const [selectedReference, setSelectedReference] = useState<Reference | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [activeFolderId, setActiveFolderId] = useState('all');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [targetFolderId, setTargetFolderId] = useState('');
  const [folderNotice, setFolderNotice] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [draggingReferenceId, setDraggingReferenceId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    if (selectedReference && !references.some((reference) => reference.id === selectedReference.id)) {
      setSelectedReference(null);
    }
    const visibleIds = new Set(references.map((reference) => reference.id));
    setCheckedIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [references, selectedReference]);

  useEffect(() => {
    if (!folders.some((folder) => folder.id === targetFolderId)) {
      setTargetFolderId(folders[0]?.id || '');
    }
  }, [folders, targetFolderId]);

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(0);
    void fetchReferences(query.trim(), undefined, activeFolderId, pageSize, 0);
  };

  const selectFolder = (folderId: string) => {
    setActiveFolderId(folderId);
    setSelectedReference(null);
    setFolderNotice(null);
    setCheckedIds(new Set());
    setPage(0);
    void fetchReferences(query.trim(), undefined, folderId, pageSize, 0);
  };

  const handleRefresh = async () => {
    await Promise.all([
      fetchReferences(query.trim(), undefined, activeFolderId, pageSize, page * pageSize),
      fetchFolders(),
      checkZoteroStatus(),
    ]);
  };

  const totalPages = Math.max(1, Math.ceil(referencesTotal / pageSize));
  const pageStart = referencesTotal === 0 ? 0 : page * pageSize + 1;
  const pageEnd = Math.min(referencesTotal, page * pageSize + references.length);

  const changePage = (nextPage: number) => {
    const boundedPage = Math.min(Math.max(0, nextPage), totalPages - 1);
    setPage(boundedPage);
    setSelectedReference(null);
    setCheckedIds(new Set());
    void fetchReferences(
      query.trim(),
      undefined,
      activeFolderId,
      pageSize,
      boundedPage * pageSize,
    );
  };

  const changePageSize = (nextPageSize: number) => {
    setPageSize(nextPageSize);
    setPage(0);
    setSelectedReference(null);
    setCheckedIds(new Set());
    void fetchReferences(query.trim(), undefined, activeFolderId, nextPageSize, 0);
  };

  const handleCreateFolder = async (event: FormEvent) => {
    event.preventDefault();
    const name = newFolderName.replace(/\s+/g, ' ').trim();
    if (!name || folderBusy) return;
    setFolderBusy(true);
    setFolderError(null);
    try {
      const folder = await createFolder(name);
      setNewFolderName('');
      setCreatingFolder(false);
      selectFolder(folder.id);
    } catch (createError) {
      setFolderError(createError instanceof Error ? createError.message : '创建文件夹失败');
    } finally {
      setFolderBusy(false);
    }
  };

  const handleRenameFolder = async (event: FormEvent, folderId: string) => {
    event.preventDefault();
    const name = editingFolderName.replace(/\s+/g, ' ').trim();
    if (!name || folderBusy) return;
    setFolderBusy(true);
    setFolderError(null);
    try {
      await renameFolder(folderId, name);
      setEditingFolderId(null);
      setEditingFolderName('');
    } catch (renameError) {
      setFolderError(renameError instanceof Error ? renameError.message : '重命名失败');
    } finally {
      setFolderBusy(false);
    }
  };

  const handleDeleteFolder = async (folderId: string, folderName: string) => {
    const confirmed = window.confirm(`确定删除文件夹“${folderName}”吗？文件夹里的文献会保留在“全部文献”中。`);
    if (!confirmed) return;
    setFolderBusy(true);
    setFolderError(null);
    try {
      await deleteFolder(folderId);
      if (activeFolderId === folderId) selectFolder('all');
    } catch (folderDeleteError) {
      setFolderError(folderDeleteError instanceof Error ? folderDeleteError.message : '删除文件夹失败');
    } finally {
      setFolderBusy(false);
    }
  };

  const handleAddToFolder = async () => {
    if (!selectedReference || !targetFolderId || folderBusy) return;
    setFolderBusy(true);
    setFolderError(null);
    setFolderNotice(null);
    try {
      const added = await addReferencesToFolder(targetFolderId, [selectedReference.id]);
      const folderName = folders.find((folder) => folder.id === targetFolderId)?.name || '文件夹';
      setFolderNotice(added > 0 ? `已加入“${folderName}”` : `这篇文献已在“${folderName}”中`);
      if (added > 0 && activeFolderId === 'unfiled') {
        await fetchReferences(query.trim(), undefined, 'unfiled', pageSize, page * pageSize);
        setSelectedReference(null);
      }
    } catch (addError) {
      setFolderError(addError instanceof Error ? addError.message : '加入文件夹失败');
    } finally {
      setFolderBusy(false);
    }
  };

  const handleRemoveFromActiveFolder = async () => {
    if (!selectedReference || activeFolderId === 'all' || activeFolderId === 'unfiled' || folderBusy) return;
    setFolderBusy(true);
    setFolderError(null);
    try {
      await removeReferenceFromFolder(activeFolderId, selectedReference.id);
      await fetchReferences(query.trim(), undefined, activeFolderId, pageSize, page * pageSize);
      setSelectedReference(null);
    } catch (removeError) {
      setFolderError(removeError instanceof Error ? removeError.message : '移出文件夹失败');
    } finally {
      setFolderBusy(false);
    }
  };

  const handleDropOnFolder = async (event: ReactDragEvent, folderId: string) => {
    event.preventDefault();
    const referenceId = event.dataTransfer.getData('application/x-medhelp-reference')
      || event.dataTransfer.getData('text/plain')
      || draggingReferenceId;
    setDragOverFolderId(null);
    setDraggingReferenceId(null);
    if (!referenceId || folderBusy) return;

    setFolderBusy(true);
    setFolderError(null);
    setFolderNotice(null);
    try {
      if (folderId === 'unfiled') {
        await removeReferenceFromAllFolders(referenceId);
        setFolderNotice('已移到“未分类”');
      } else {
        const added = await addReferencesToFolder(folderId, [referenceId]);
        const folderName = folders.find((folder) => folder.id === folderId)?.name || '文件夹';
        setFolderNotice(added > 0 ? `已加入“${folderName}”` : `这篇文献已在“${folderName}”中`);
      }
      await fetchReferences(query.trim(), undefined, activeFolderId, pageSize, page * pageSize);
    } catch (dropError) {
      setFolderError(dropError instanceof Error ? dropError.message : '拖放归类失败');
    } finally {
      setFolderBusy(false);
    }
  };

  const handleChat = (reference: Reference) => {
    if (chatTargetProject) {
      onChatFromReference?.(chatTargetProject, reference);
    }
  };

  const requestDelete = (reference: Reference) => {
    setDeleteError(null);
    setPendingDelete({ type: 'single', references: [reference] });
  };

  const toggleChecked = (reference: Reference) => {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(reference.id)) next.delete(reference.id);
      else next.add(reference.id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    const visibleIds = references.map((reference) => reference.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => checkedIds.has(id));
    setCheckedIds(allSelected ? new Set() : new Set(visibleIds));
  };

  const requestBulkDelete = () => {
    const selected = references.filter((reference) => checkedIds.has(reference.id));
    if (selected.length > 0) {
      setDeleteError(null);
      setPendingDelete({ type: 'bulk', references: selected });
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete || pendingDelete.references.length === 0 || deleting) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      const deletingIds = new Set(pendingDelete.references.map((reference) => reference.id));
      if (pendingDelete.type === 'single') {
        await deleteReference(pendingDelete.references[0].id);
      } else {
        await bulkDeleteReferences([...deletingIds]);
      }
      const nextTotal = Math.max(0, referencesTotal - deletingIds.size);
      const nextLastPage = Math.max(0, Math.ceil(nextTotal / pageSize) - 1);
      const nextPage = Math.min(page, nextLastPage);
      setPage(nextPage);
      await fetchReferences(query.trim(), undefined, activeFolderId, pageSize, nextPage * pageSize);
      if (selectedReference && deletingIds.has(selectedReference.id)) {
        setSelectedReference(null);
      }
      setCheckedIds(new Set());
      setPendingDelete(null);
    } catch {
      setDeleteError('删除失败，请稍后重试。');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-7xl px-5 py-7 sm:px-8 sm:py-9">
        <header className="border-b border-border pb-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground">GLOBAL LITERATURE</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-foreground">Zotero 文献库</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                全局保存 PubMed、Zotero 与 BibTeX 文献。项目之间共享，发送到聊天时再关联当前工作区。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-9 items-center gap-2 border border-border bg-primary/5 px-3 text-xs text-muted-foreground">
                <span className={`h-1.5 w-1.5 rounded-full ${zoteroStatus?.connected ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
                {zoteroStatus?.connected ? 'Zotero 已连接' : 'Zotero 未连接'}
              </span>
              <Button variant="outline" size="sm" onClick={() => void handleRefresh()} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                刷新
              </Button>
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setShowImportDialog(true)}>
                <Upload className="h-3.5 w-3.5" />
                导入文献
              </Button>
            </div>
          </div>

          <form onSubmit={handleSearch} className="mt-6 flex max-w-xl items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、作者、DOI 或关键词…"
                className="h-10 w-full border border-border bg-background/70 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <Button type="submit" variant="outline" size="sm" className="h-10">搜索</Button>
          </form>
        </header>

        {error && <p className="border-b border-border py-3 text-sm text-muted-foreground">{error}</p>}

        <div className="grid min-h-[520px] gap-0 lg:grid-cols-[220px_minmax(0,1.08fr)_minmax(300px,0.82fr)]">
          <aside className="border-b border-border py-5 lg:border-b-0 lg:border-r lg:pr-4">
            <div className="flex items-center justify-between px-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">文献文件夹</p>
              <button
                type="button"
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-primary/5 hover:text-foreground"
                title="新建文件夹"
                onClick={() => {
                  setFolderError(null);
                  setCreatingFolder(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {creatingFolder && (
              <form className="mt-3 flex items-center gap-1" onSubmit={handleCreateFolder}>
                <input
                  autoFocus
                  maxLength={80}
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder="文件夹名称"
                  className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary/60"
                />
                <button type="submit" disabled={!newFolderName.trim() || folderBusy} className="grid h-8 w-8 place-items-center rounded-md text-primary hover:bg-primary/5 disabled:opacity-30">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button type="button" disabled={folderBusy} onClick={() => { setCreatingFolder(false); setNewFolderName(''); }} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted">
                  <X className="h-3.5 w-3.5" />
                </button>
              </form>
            )}

            <nav className="mt-4 space-y-1" aria-label="文献文件夹">
              <button
                type="button"
                onClick={() => selectFolder('all')}
                className={`flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm ${activeFolderId === 'all' ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'}`}
              >
                <Library className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">全部文献</span>
                <span className="text-[11px] tabular-nums">{folderStats.total_count}</span>
              </button>
              <button
                type="button"
                onClick={() => selectFolder('unfiled')}
                onDragOver={(event) => { event.preventDefault(); setDragOverFolderId('unfiled'); }}
                onDragLeave={() => setDragOverFolderId((current) => current === 'unfiled' ? null : current)}
                onDrop={(event) => void handleDropOnFolder(event, 'unfiled')}
                className={`flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm ${dragOverFolderId === 'unfiled' ? 'ring-2 ring-primary/50' : ''} ${activeFolderId === 'unfiled' ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'}`}
              >
                <FileText className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">未分类</span>
                <span className="text-[11px] tabular-nums">{folderStats.unfiled_count}</span>
              </button>

              <div className="my-3 border-t border-border" />

              {folders.map((folder) => (
                <div
                  key={folder.id}
                  onDragOver={(event) => { event.preventDefault(); setDragOverFolderId(folder.id); }}
                  onDragLeave={() => setDragOverFolderId((current) => current === folder.id ? null : current)}
                  onDrop={(event) => void handleDropOnFolder(event, folder.id)}
                  className={`group/folder rounded-md ${dragOverFolderId === folder.id ? 'ring-2 ring-primary/50' : ''} ${activeFolderId === folder.id ? 'bg-primary/10' : 'hover:bg-primary/5'}`}
                >
                  {editingFolderId === folder.id ? (
                    <form className="flex h-9 items-center gap-1 px-1" onSubmit={(event) => void handleRenameFolder(event, folder.id)}>
                      <input
                        autoFocus
                        maxLength={80}
                        value={editingFolderName}
                        onChange={(event) => setEditingFolderName(event.target.value)}
                        className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs outline-none focus:border-primary/60"
                      />
                      <button type="submit" disabled={!editingFolderName.trim() || folderBusy} className="grid h-7 w-7 place-items-center text-primary disabled:opacity-30"><Check className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => setEditingFolderId(null)} className="grid h-7 w-7 place-items-center text-muted-foreground"><X className="h-3.5 w-3.5" /></button>
                    </form>
                  ) : (
                    <div className="flex h-9 items-center">
                      <button
                        type="button"
                        onClick={() => selectFolder(folder.id)}
                        className={`flex min-w-0 flex-1 items-center gap-2 px-2 text-left text-sm ${activeFolderId === folder.id ? 'font-medium text-primary' : 'text-muted-foreground group-hover/folder:text-foreground'}`}
                      >
                        {activeFolderId === folder.id ? <FolderOpen className="h-4 w-4 flex-none" /> : <Folder className="h-4 w-4 flex-none" />}
                        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                        <span className="text-[11px] tabular-nums">{folder.reference_count}</span>
                      </button>
                      <div className="flex items-center pr-1 opacity-60 transition-opacity group-hover/folder:opacity-100 group-focus-within/folder:opacity-100">
                        <button
                          type="button"
                          title="重命名"
                          onClick={() => { setEditingFolderId(folder.id); setEditingFolderName(folder.name); setFolderError(null); }}
                          className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          title="删除文件夹"
                          onClick={() => void handleDeleteFolder(folder.id, folder.name)}
                          className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </nav>

            {folders.length === 0 && !creatingFolder && (
              <button type="button" onClick={() => setCreatingFolder(true)} className="mt-3 flex w-full items-center gap-2 rounded-md border border-dashed border-border px-3 py-3 text-left text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">
                <Plus className="h-3.5 w-3.5" /> 建立第一个文件夹
              </button>
            )}

            {folderError && <p className="mt-3 px-1 text-xs leading-5 text-primary">{folderError}</p>}
            <p className="mt-4 px-1 text-[11px] leading-5 text-muted-foreground">可将文献卡片拖到文件夹；一篇文献可以归入多个文件夹。</p>
          </aside>

          <section className="min-w-0 py-5 lg:px-7">
            <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={references.length > 0 && references.every((reference) => checkedIds.has(reference.id))}
                    onChange={toggleAllVisible}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  全选当前列表
                </label>
                <span>第 {pageStart}–{pageEnd} 篇 / 共 {referencesTotal} 篇</span>
              </div>
              {checkedIds.size > 0 ? (
                <Button size="sm" className="h-7 bg-primary text-primary-foreground hover:bg-primary/90" onClick={requestBulkDelete}>
                  <Trash2 className="h-3.5 w-3.5" /> 批量删除（{checkedIds.size}）
                </Button>
              ) : <span>可拖动卡片到左侧文件夹</span>}
            </div>
            {loading && references.length === 0 ? (
              <div className="flex h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : references.length > 0 ? (
              <div className="space-y-2">
                {references.map((reference) => (
                  <div
                    key={reference.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'copy';
                      event.dataTransfer.setData('application/x-medhelp-reference', reference.id);
                      event.dataTransfer.setData('text/plain', reference.id);
                      setDraggingReferenceId(reference.id);
                    }}
                    onDragEnd={() => { setDraggingReferenceId(null); setDragOverFolderId(null); }}
                    className={draggingReferenceId === reference.id ? 'opacity-50' : ''}
                  >
                    <ReferenceCard
                      reference={reference}
                      isSelected={selectedReference?.id === reference.id}
                      isChecked={checkedIds.has(reference.id)}
                      onSelect={setSelectedReference}
                      onToggleCheck={toggleChecked}
                      onChat={chatTargetProject && onChatFromReference ? handleChat : undefined}
                      onDelete={requestDelete}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-dashed border-border px-6 py-16 text-center">
                <Library className="mx-auto h-6 w-6 text-primary/60" />
                <p className="mt-3 text-sm font-medium text-foreground">{folderStats.total_count === 0 ? '文献库还是空的' : '这个文件夹里还没有文献'}</p>
                <p className="mt-1 text-xs text-muted-foreground">{folderStats.total_count === 0 ? '从 Zotero/BibTeX 导入，或在 PubMed 结果中点击“导入文献库”。' : '从右侧文献详情中把文献加入这个文件夹。'}</p>
              </div>
            )}

            {referencesTotal > 0 && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
                <label className="inline-flex items-center gap-2">
                  每页
                  <select
                    value={pageSize}
                    onChange={(event) => changePageSize(Number(event.target.value))}
                    className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                  篇
                </label>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={page === 0 || loading} onClick={() => changePage(page - 1)}>
                    <ChevronLeft className="h-3.5 w-3.5" /> 上一页
                  </Button>
                  <span className="min-w-[78px] text-center tabular-nums">第 {page + 1} / {totalPages} 页</span>
                  <Button size="sm" variant="outline" disabled={page >= totalPages - 1 || loading} onClick={() => changePage(page + 1)}>
                    下一页 <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </section>

          <aside className="border-t border-border py-5 lg:border-l lg:border-t-0 lg:pl-7">
            {selectedReference ? (
              <div className="sticky top-5">
                <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground">REFERENCE</p>
                <h2 className="mt-3 text-xl font-semibold leading-7 text-foreground">{selectedReference.title}</h2>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {[formatAuthors(selectedReference.authors, 8), selectedReference.journal, selectedReference.year]
                    .filter(Boolean)
                    .join(' · ')}
                </p>

                {selectedReference.keywords?.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {selectedReference.keywords.slice(0, 10).map((keyword) => (
                      <span key={keyword} className="bg-primary/8 px-2 py-1 text-[11px] text-primary">{keyword}</span>
                    ))}
                  </div>
                )}

                {selectedReference.abstract && (
                  <p className="mt-5 max-h-[320px] overflow-y-auto border-t border-border pt-4 text-sm leading-7 text-muted-foreground">
                    {selectedReference.abstract}
                  </p>
                )}

                <div className="mt-5 border-t border-border pt-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <Folder className="h-3.5 w-3.5 text-primary" /> 文件夹归类
                  </div>
                  {folders.length > 0 ? (
                    <div className="mt-3 flex items-center gap-2">
                      <select
                        value={targetFolderId}
                        disabled={folderBusy}
                        onChange={(event) => { setTargetFolderId(event.target.value); setFolderNotice(null); }}
                        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary/60"
                      >
                        {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                      </select>
                      <Button size="sm" variant="outline" disabled={!targetFolderId || folderBusy} onClick={() => void handleAddToFolder()}>
                        {folderBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        加入
                      </Button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setCreatingFolder(true)} className="mt-2 text-xs text-primary hover:underline">
                      先新建一个文件夹
                    </button>
                  )}
                  {activeFolderId !== 'all' && activeFolderId !== 'unfiled' && (
                    <button
                      type="button"
                      disabled={folderBusy}
                      onClick={() => void handleRemoveFromActiveFolder()}
                      className="mt-2 text-xs text-muted-foreground hover:text-primary disabled:opacity-40"
                    >
                      从当前文件夹移出
                    </button>
                  )}
                  {folderNotice && <p className="mt-2 text-xs text-primary">{folderNotice}</p>}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                  <Button
                    size="sm"
                    disabled={!chatTargetProject || !onChatFromReference}
                    onClick={() => handleChat(selectedReference)}
                  >
                    发送到聊天 <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-primary/30 text-primary hover:bg-primary/10 hover:text-primary"
                    onClick={() => requestDelete(selectedReference)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> 删除文献
                  </Button>
                  {selectedReference.url && (
                    <a
                      href={selectedReference.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-primary/5"
                    >
                      打开来源 <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-16 text-center text-sm text-muted-foreground">选择一篇文献查看摘要和关键词</div>
            )}
          </aside>
        </div>
      </div>

      {showImportDialog && ReactDOM.createPortal(
        <ImportDialog
          zoteroStatus={zoteroStatus}
          onRefreshZoteroStatus={checkZoteroStatus}
          onClose={() => setShowImportDialog(false)}
          onComplete={() => {
            void handleRefresh();
            setShowImportDialog(false);
          }}
        />,
        document.body,
      )}

      {pendingDelete && ReactDOM.createPortal(
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!deleting) setPendingDelete(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-reference-title"
            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-primary/10">
                <AlertTriangle className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h3 id="delete-reference-title" className="text-base font-semibold text-foreground">
                  {pendingDelete.type === 'bulk' ? `批量删除 ${pendingDelete.references.length} 篇文献` : t('actions.deleteTitle')}
                </h3>
                <p className="mt-2 break-words text-sm leading-6 text-foreground">
                  {pendingDelete.type === 'bulk'
                    ? `确定删除当前选中的 ${pendingDelete.references.length} 篇文献吗？`
                    : t('actions.deleteConfirm', { title: pendingDelete.references[0].title })}
                </p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {t('actions.deleteWarning')}
                </p>
              </div>
            </div>

            {deleteError && (
              <p className="mt-4 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{deleteError}</p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={deleting} onClick={() => setPendingDelete(null)}>
                {t('actions.cancel')}
              </Button>
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" disabled={deleting} onClick={() => void handleConfirmDelete()}>
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {deleting ? '正在删除…' : t('actions.deleteButton')}
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
