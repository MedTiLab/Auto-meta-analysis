import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, FolderOpen, FolderSearch, Loader2, Plus, RefreshCw, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';

type SkillNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: SkillNode[];
};

type SkillItem = {
  name: string;
  dirPath: string;
  summary: string;
  description: string;
};

type SkillValidation = {
  skillName: string;
  description?: string;
  fileCount?: number;
};

type LocalSkillItem = {
  name: string;
  hasSkillMd: boolean;
  alreadyImported: boolean;
  sourcePath: string;
};

type SkillsDashboardProps = {
  onSendToChat?: (command: string) => void;
  uploadProjectName?: string | null;
};

const COPY = {
  zh: {
    eyebrow: 'OPEN SKILL LIBRARY',
    title: '技能',
    subtitle: '选择一个 Skill，了解它能做什么，然后直接发送到聊天。没有分类，没有复杂配置。',
    search: '搜索技能…',
    count: (count: number) => `${count} 个可用技能`,
    empty: '没有找到匹配的技能。',
    noSkills: '暂时没有可用技能。请确认项目的 skills 目录存在。',
    loading: '正在读取技能…',
    retry: '重新加载',
    add: '添加技能',
    scanLocal: '扫描本地路径',
    addTitle: '添加 Skill',
    addHint: '选择包含 SKILL.md 的 ZIP 包。安装前会先校验文件结构。',
    scanTitle: '从本地路径加载 Skill',
    scanHint: '直接选择 Skill 文件夹，或输入一个包含 Skill 子目录的本地路径。系统只加载带有 SKILL.md 的项目。',
    pathPlaceholder: '例如：~/.claude/skills 或 D:\\skills',
    chooseDirectory: '选择目录',
    scan: '扫描',
    scanning: '正在扫描…',
    scanEmpty: '这个路径下没有找到可加载的 Skill。',
    scanFound: (count: number) => `找到 ${count} 个有效 Skill`,
    selectAll: '选择全部可加载项',
    alreadyInstalled: '已安装',
    invalidSkill: '缺少 SKILL.md',
    loadSelected: '加载所选 Skill',
    loadingSelected: '正在加载…',
    selectRequired: '请至少选择一个尚未安装的 Skill。',
    install: '安装 Skill',
    delete: '删除技能',
    deleteTitle: '删除 Skill',
    deleteHint: (name: string) => `确定从全局技能库中删除 “${name}” 吗？此操作会删除对应目录。`,
    cancel: '取消',
    validating: '正在校验…',
    installing: '正在安装…',
    deleting: '正在删除…',
    files: (count: number) => `${count} 个文件`,
    selected: '已选择',
    details: '技能说明',
    path: '路径',
    command: '聊天命令',
    send: '发送到聊天',
    unavailable: '先创建或选择一个工作区，才能发送到聊天。',
    fallback: '这个技能包含一套可复用的工作流程和操作说明。',
  },
  en: {
    eyebrow: 'OPEN SKILL LIBRARY',
    title: 'Skills',
    subtitle: 'Pick a skill, understand what it does, and send it straight to chat. No categories or complex setup.',
    search: 'Search skills…',
    count: (count: number) => `${count} available skills`,
    empty: 'No skills match your search.',
    noSkills: 'No skills are available. Check that the project skills directory exists.',
    loading: 'Reading skills…',
    retry: 'Reload',
    add: 'Add Skill',
    scanLocal: 'Scan Local Path',
    addTitle: 'Add Skill',
    addHint: 'Choose a ZIP package containing SKILL.md. Its structure will be validated before installation.',
    scanTitle: 'Load Skills from a Local Path',
    scanHint: 'Choose a Skill folder directly, or enter a local path containing skill subfolders. Only folders with SKILL.md are loaded.',
    pathPlaceholder: 'For example: ~/.claude/skills or D:\\skills',
    chooseDirectory: 'Choose Folder',
    scan: 'Scan',
    scanning: 'Scanning…',
    scanEmpty: 'No loadable skills were found at this path.',
    scanFound: (count: number) => `${count} valid skills found`,
    selectAll: 'Select all loadable skills',
    alreadyInstalled: 'Installed',
    invalidSkill: 'Missing SKILL.md',
    loadSelected: 'Load Selected Skills',
    loadingSelected: 'Loading…',
    selectRequired: 'Select at least one skill that is not already installed.',
    install: 'Install Skill',
    delete: 'Delete Skill',
    deleteTitle: 'Delete Skill',
    deleteHint: (name: string) => `Remove “${name}” from the global skill library? This deletes its directory.`,
    cancel: 'Cancel',
    validating: 'Validating…',
    installing: 'Installing…',
    deleting: 'Deleting…',
    files: (count: number) => `${count} files`,
    selected: 'Selected',
    details: 'About this skill',
    path: 'Path',
    command: 'Chat command',
    send: 'Send to chat',
    unavailable: 'Create or select a workspace before sending a skill to chat.',
    fallback: 'This skill contains a reusable workflow and a focused set of instructions.',
  },
};

function findSkillDirectories(nodes: SkillNode[]): SkillNode[] {
  const found: SkillNode[] = [];

  const visit = (node: SkillNode) => {
    if (node.type !== 'directory') return;
    const hasSkillFile = (node.children || []).some(
      (child) => child.type === 'file' && child.name === 'SKILL.md',
    );
    if (hasSkillFile) {
      found.push(node);
      return;
    }
    (node.children || []).forEach(visit);
  };

  nodes.forEach(visit);
  return found;
}

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function parseSkillDescription(content: string, fallback: string) {
  const normalized = content.replace(/\r\n/g, '\n');
  const frontmatter = normalized.match(/^---\n([\s\S]*?)\n---/);
  const frontmatterDescription = frontmatter?.[1].match(/^description\s*:\s*(.+)$/m)?.[1]
    ?.replace(/^['"]|['"]$/g, '');
  const body = normalized
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .join('\n')
    .replace(/^[*-]\s+/gm, '')
    .trim();
  const description = compact(frontmatterDescription || body || fallback);
  const summary = description.length > 180
    ? `${description.slice(0, 177).trim()}…`
    : description;
  return { summary, description };
}

function relativeSkillPath(node: SkillNode, roots: SkillNode[]) {
  const normalizedPath = node.path.replace(/\\/g, '/');
  const rootPath = roots[0]?.path.replace(/\\/g, '/').replace(/\/[^/]+$/, '') || '';
  return rootPath && normalizedPath.startsWith(`${rootPath}/`)
    ? normalizedPath.slice(rootPath.length + 1)
    : node.name;
}

export default function SkillsDashboard({ onSendToChat }: SkillsDashboardProps = {}) {
  const { i18n } = useTranslation();
  const locale = i18n.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const text = COPY[locale];
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [skillDialog, setSkillDialog] = useState<'add' | 'delete' | 'local' | null>(null);
  const [pendingSkillFile, setPendingSkillFile] = useState<File | null>(null);
  const [skillValidation, setSkillValidation] = useState<SkillValidation | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [localPath, setLocalPath] = useState('~/.claude/skills');
  const [scannedPath, setScannedPath] = useState<string | null>(null);
  const [localSkills, setLocalSkills] = useState<LocalSkillItem[]>([]);
  const [selectedLocalSkills, setSelectedLocalSkills] = useState<string[]>([]);
  const [selectedFolderFiles, setSelectedFolderFiles] = useState<File[]>([]);

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
    folderInputRef.current?.setAttribute('directory', '');
  }, []);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getGlobalSkills();
      if (!response.ok) throw new Error(`Skills API returned ${response.status}`);
      const tree = await response.json() as SkillNode[];
      const directories = findSkillDirectories(tree);
      const items = await Promise.all(directories.map(async (node) => {
        const dirPath = relativeSkillPath(node, tree);
        let parsed = { summary: text.fallback, description: text.fallback };
        try {
          const fileResponse = await api.readGlobalSkillFile(`${dirPath}/SKILL.md`);
          if (fileResponse.ok) {
            const payload = await fileResponse.json();
            parsed = parseSkillDescription(payload.content || '', text.fallback);
          }
        } catch {
          // A missing description should not hide an otherwise valid skill.
        }
        return { name: node.name, dirPath, ...parsed };
      }));
      items.sort((a, b) => a.name.localeCompare(b.name));
      setSkills(items);
      setSelectedPath((current) => current && items.some((item) => item.dirPath === current)
        ? current
        : items[0]?.dirPath || null);
    } catch (loadError) {
      setSkills([]);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load skills');
    } finally {
      setLoading(false);
    }
  }, [text.fallback]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const filteredSkills = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter((skill) =>
      `${skill.name} ${skill.summary} ${skill.dirPath}`.toLowerCase().includes(needle));
  }, [query, skills]);

  const selectedSkill = skills.find((skill) => skill.dirPath === selectedPath) || filteredSkills[0] || null;

  const closeSkillDialog = () => {
    if (actionLoading) return;
    setSkillDialog(null);
    setPendingSkillFile(null);
    setSkillValidation(null);
    setActionError(null);
    setScannedPath(null);
    setLocalSkills([]);
    setSelectedLocalSkills([]);
    setSelectedFolderFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const scanLocalPath = async (pathOverride?: string) => {
    const requestedPath = (pathOverride ?? localPath).trim();
    if (!requestedPath) return;
    setActionLoading(true);
    setActionError(null);
    setScannedPath(null);
    setLocalSkills([]);
    setSelectedLocalSkills([]);
    setSelectedFolderFiles([]);
    try {
      const response = await api.scanLocalSkills(requestedPath);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Failed to scan local skills');
      const scanned = Array.isArray(payload.skills) ? payload.skills as LocalSkillItem[] : [];
      setScannedPath(payload.resolvedPath || requestedPath);
      setLocalSkills(scanned);
      setSelectedLocalSkills(scanned
        .filter((skill) => skill.hasSkillMd && !skill.alreadyImported)
        .map((skill) => skill.name));
    } catch (scanError) {
      setActionError(scanError instanceof Error ? scanError.message : 'Failed to scan local skills');
    } finally {
      setActionLoading(false);
    }
  };

  const chooseLocalDirectory = () => {
    setActionError(null);
    folderInputRef.current?.click();
  };

  const handleLocalFolderSelection = (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    const candidates = new Map<string, LocalSkillItem>();
    for (const file of files) {
      const relativePath = file.webkitRelativePath || file.name;
      const parts = relativePath.split('/').filter(Boolean);
      if (parts.at(-1) !== 'SKILL.md') continue;

      let name = '';
      let sourcePath = '';
      if (parts.length === 2) {
        name = parts[0];
        sourcePath = parts[0];
      } else if (parts.length === 3) {
        name = parts[1];
        sourcePath = `${parts[0]}/${parts[1]}`;
      }
      if (!name || candidates.has(name)) continue;

      candidates.set(name, {
        name,
        hasSkillMd: true,
        alreadyImported: skills.some((skill) => skill.name === name || skill.dirPath === name),
        sourcePath,
      });
    }

    const discovered = [...candidates.values()].sort((left, right) => left.name.localeCompare(right.name));
    const selectedRoot = (files[0].webkitRelativePath || files[0].name).split('/').filter(Boolean)[0] || 'local-folder';
    setSelectedFolderFiles(files);
    setLocalSkills(discovered);
    setScannedPath(selectedRoot);
    setSelectedLocalSkills(discovered.filter((skill) => !skill.alreadyImported).map((skill) => skill.name));
    setActionError(null);
  };

  const importSelectedLocalSkills = async () => {
    if (selectedLocalSkills.length === 0) {
      setActionError(text.selectRequired);
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      let response;
      if (selectedFolderFiles.length > 0) {
        const selectedPrefixes = new Set(localSkills
          .filter((skill) => selectedLocalSkills.includes(skill.name))
          .map((skill) => skill.sourcePath));
        const filesToUpload = selectedFolderFiles.filter((file) => {
          const relativePath = file.webkitRelativePath || file.name;
          return [...selectedPrefixes].some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`));
        });
        const formData = new FormData();
        filesToUpload.forEach((file) => formData.append('files', file, file.name));
        formData.append('relativePaths', JSON.stringify(filesToUpload.map((file) => file.webkitRelativePath || file.name)));
        formData.append('skillNames', JSON.stringify(selectedLocalSkills));
        response = await api.importLocalSkillFolder(formData);
      } else {
        response = await api.importLocalSkills(localPath.trim(), selectedLocalSkills);
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Failed to load local skills');
      const imported = Array.isArray(payload.imported) ? payload.imported : [];
      const activated = Array.isArray(payload.activated)
        ? payload.activated
        : [...imported, ...(Array.isArray(payload.skipped) ? payload.skipped : [])];
      const errors = Array.isArray(payload.errors) ? payload.errors : [];
      if (errors.length > 0) throw new Error(errors.join('\n'));
      if (activated.length === 0) throw new Error(text.selectRequired);
      await loadSkills();
      setSelectedPath(activated[0]);
      closeSkillDialog();
    } catch (importError) {
      setActionError(importError instanceof Error ? importError.message : 'Failed to load local skills');
    } finally {
      setActionLoading(false);
    }
  };

  const validateSkillFile = async (file: File) => {
    setActionLoading(true);
    setActionError(null);
    setPendingSkillFile(file);
    setSkillValidation(null);
    setSkillDialog('add');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await api.validateGlobalSkillZip(formData);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.valid) {
        throw new Error(payload.error || 'Invalid skill package');
      }
      setSkillValidation({
        skillName: payload.skillName || file.name.replace(/\.zip$/i, ''),
        description: payload.description || '',
        fileCount: Number(payload.fileCount || 0),
      });
    } catch (validationError) {
      setActionError(validationError instanceof Error ? validationError.message : 'Failed to validate skill package');
    } finally {
      setActionLoading(false);
    }
  };

  const installSkill = async () => {
    if (!pendingSkillFile || !skillValidation) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const formData = new FormData();
      formData.append('file', pendingSkillFile);
      const response = await api.uploadGlobalSkill(formData);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Failed to install skill');
      setSkillDialog(null);
      setPendingSkillFile(null);
      setSkillValidation(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadSkills();
      setSelectedPath(payload.dirName || payload.skillName || null);
    } catch (installError) {
      setActionError(installError instanceof Error ? installError.message : 'Failed to install skill');
    } finally {
      setActionLoading(false);
    }
  };

  const deleteSkill = async () => {
    if (!selectedSkill) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const response = await api.deleteGlobalSkill(selectedSkill.dirPath);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Failed to delete skill');
      setSkillDialog(null);
      setSelectedPath(null);
      await loadSkills();
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : 'Failed to delete skill');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{text.loading}</div>;
  }

  return (
    <div className="h-full overflow-hidden bg-background">
      <div className="mx-auto flex h-full w-full max-w-[1320px] flex-col px-5 py-6 sm:px-8 sm:py-8">
        <header className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              {text.eyebrow}
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-foreground sm:text-4xl">{text.title}</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{text.subtitle}</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-3 sm:w-[620px]">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={text.search}
                className="h-10 w-full rounded-none border-0 border-b border-border bg-transparent pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground"
              />
            </div>
            <button
              type="button"
              onClick={() => void loadSkills()}
              className="grid h-9 w-9 flex-none place-items-center text-muted-foreground hover:text-foreground"
              aria-label={text.retry}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                setSkillDialog('local');
              }}
              className="inline-flex h-9 flex-none items-center gap-1.5 border border-border px-3 text-xs font-medium text-foreground hover:bg-muted"
            >
              <FolderSearch className="h-3.5 w-3.5" />
              {text.scanLocal}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-9 flex-none items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              {text.add}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void validateSkillFile(file);
              }}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => handleLocalFolderSelection(event.target.files)}
            />
          </div>
        </header>

        {error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <button type="button" onClick={() => void loadSkills()} className="border-b border-foreground pb-1 text-sm font-medium">
              {text.retry}
            </button>
          </div>
        ) : skills.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{text.noSkills}</div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(300px,0.82fr)_minmax(360px,1.18fr)]">
            <section className="min-h-0 overflow-y-auto border-b border-border py-5 md:border-b-0 md:border-r md:pr-6">
              <p className="mb-3 text-xs text-muted-foreground">{text.count(filteredSkills.length)}</p>
              {filteredSkills.length === 0 ? (
                <p className="py-10 text-sm text-muted-foreground">{text.empty}</p>
              ) : (
                <div>
                  {filteredSkills.map((skill) => {
                    const active = skill.dirPath === selectedSkill?.dirPath;
                    return (
                      <button
                        key={skill.dirPath}
                        type="button"
                        onClick={() => setSelectedPath(skill.dirPath)}
                        className={`group flex w-full items-start gap-3 border-t border-border px-1 py-4 text-left transition-colors last:border-b ${active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        <span className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${active ? 'bg-foreground' : 'bg-border group-hover:bg-muted-foreground'}`} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold">{skill.name}</span>
                            {active && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                <Check className="h-3 w-3" /> {text.selected}
                              </span>
                            )}
                          </span>
                          <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">{skill.summary}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <aside className="min-h-0 overflow-y-auto px-0 py-6 md:pl-10 lg:pl-14">
              {selectedSkill && (
                <div className="mx-auto max-w-2xl">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{text.details}</p>
                  <h2 className="mt-3 break-words text-2xl font-semibold tracking-[-0.03em] text-foreground">{selectedSkill.name}</h2>
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{selectedSkill.description}</p>

                  <dl className="mt-8 space-y-4 border-t border-border pt-5 text-sm">
                    <div className="grid grid-cols-[100px_1fr] gap-4">
                      <dt className="text-muted-foreground">{text.path}</dt>
                      <dd className="break-all font-mono text-xs text-foreground">skills/{selectedSkill.dirPath}</dd>
                    </div>
                    <div className="grid grid-cols-[100px_1fr] gap-4">
                      <dt className="text-muted-foreground">{text.command}</dt>
                      <dd className="font-mono text-xs text-foreground">/{selectedSkill.name}</dd>
                    </div>
                  </dl>

                  <div className="mt-8 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!onSendToChat}
                      onClick={() => onSendToChat?.(`/${selectedSkill.name}`)}
                      className="inline-flex h-11 items-center justify-center gap-2 bg-primary/90 px-5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {text.send}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActionError(null);
                        setSkillDialog('delete');
                      }}
                      className="inline-flex h-11 items-center justify-center gap-2 border border-primary/30 bg-primary/5 px-4 text-sm font-medium text-primary hover:bg-primary/10"
                    >
                      <Trash2 className="h-4 w-4" />
                      {text.delete}
                    </button>
                    {!onSendToChat && <p className="mt-3 text-xs text-muted-foreground">{text.unavailable}</p>}
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>

      {skillDialog && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-foreground/15 p-4 backdrop-blur-sm" onClick={closeSkillDialog}>
          <div
            role="dialog"
            aria-modal="true"
            className={`w-full border border-border bg-background p-5 shadow-2xl ${skillDialog === 'local' ? 'max-w-2xl' : 'max-w-md'}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {skillDialog === 'add' ? text.addTitle : skillDialog === 'local' ? text.scanTitle : text.deleteTitle}
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {skillDialog === 'add'
                    ? text.addHint
                    : skillDialog === 'local'
                      ? text.scanHint
                      : selectedSkill ? text.deleteHint(selectedSkill.name) : ''}
                </p>
              </div>
              <button type="button" onClick={closeSkillDialog} className="p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {skillDialog === 'add' && (
              <div className="mt-5 border border-border bg-primary/5 p-4">
                {actionLoading && !skillValidation ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> {text.validating}
                  </div>
                ) : skillValidation ? (
                  <div className="flex items-start gap-3">
                    <Upload className="mt-0.5 h-4 w-4 text-primary" />
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{skillValidation.skillName}</p>
                      {skillValidation.description && <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{skillValidation.description}</p>}
                      <p className="mt-2 text-xs text-muted-foreground">{text.files(skillValidation.fileCount || 0)}</p>
                    </div>
                  </div>
                ) : (
                  <p className="break-all text-xs text-muted-foreground">{pendingSkillFile?.name}</p>
                )}
              </div>
            )}

            {skillDialog === 'local' && (
              <div className="mt-5 space-y-4">
                <div className="flex gap-2">
                  <input
                    value={localPath}
                    onChange={(event) => setLocalPath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !actionLoading) void scanLocalPath();
                    }}
                    placeholder={text.pathPlaceholder}
                    className="h-10 min-w-0 flex-1 border border-border bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-foreground"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={chooseLocalDirectory}
                    disabled={actionLoading}
                    className="inline-flex h-10 flex-none items-center gap-2 border border-border px-3 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-35"
                  >
                    <FolderOpen className="h-4 w-4" />
                    {text.chooseDirectory}
                  </button>
                  <button
                    type="button"
                    onClick={() => void scanLocalPath()}
                    disabled={actionLoading || !localPath.trim()}
                    className="inline-flex h-10 items-center gap-2 bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-35"
                  >
                    {actionLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {actionLoading ? text.scanning : text.scan}
                  </button>
                </div>

                {scannedPath && (
                  <div>
                    <p className="break-all font-mono text-[11px] text-muted-foreground">{scannedPath}</p>
                    {localSkills.length === 0 ? (
                      <p className="mt-4 border border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">{text.scanEmpty}</p>
                    ) : (
                      <div className="mt-3 max-h-64 overflow-y-auto border border-border">
                        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                          <span>{text.scanFound(localSkills.filter((skill) => skill.hasSkillMd).length)}</span>
                          <button
                            type="button"
                            onClick={() => setSelectedLocalSkills(localSkills
                              .filter((skill) => skill.hasSkillMd && !skill.alreadyImported)
                              .map((skill) => skill.name))}
                            className="text-foreground hover:underline"
                          >
                            {text.selectAll}
                          </button>
                        </div>
                        {localSkills.map((skill) => {
                          const selectable = skill.hasSkillMd && !skill.alreadyImported;
                          const checked = selectedLocalSkills.includes(skill.name);
                          return (
                            <label key={skill.sourcePath} className={`flex items-center gap-3 border-b border-border px-3 py-3 last:border-b-0 ${selectable ? 'cursor-pointer' : 'opacity-55'}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!selectable}
                                onChange={() => setSelectedLocalSkills((current) => checked
                                  ? current.filter((name) => name !== skill.name)
                                  : [...current, skill.name])}
                                className="h-4 w-4 accent-primary"
                              />
                              <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{skill.name}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {skill.alreadyImported ? text.alreadyInstalled : !skill.hasSkillMd ? text.invalidSkill : ''}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {actionError && <div className="mt-4 border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">{actionError}</div>}

            <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
              <button type="button" onClick={closeSkillDialog} disabled={actionLoading} className="h-9 border border-border px-4 text-sm text-muted-foreground hover:bg-muted disabled:opacity-40">
                {text.cancel}
              </button>
              {(skillDialog !== 'local' || scannedPath) && (
                <button
                  type="button"
                  onClick={() => void (skillDialog === 'add'
                    ? installSkill()
                    : skillDialog === 'local'
                      ? importSelectedLocalSkills()
                      : deleteSkill())}
                  disabled={actionLoading
                    || (skillDialog === 'add' && !skillValidation)
                    || (skillDialog === 'local' && selectedLocalSkills.length === 0)}
                  className="inline-flex h-9 items-center gap-2 bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-35"
                >
                  {actionLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {actionLoading
                    ? skillDialog === 'add' ? text.installing : skillDialog === 'local' ? text.loadingSelected : text.deleting
                    : skillDialog === 'add' ? text.install : skillDialog === 'local' ? text.loadSelected : text.delete}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
