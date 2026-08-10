import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Loader2, Plus, RefreshCw, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
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
    addTitle: '添加 Skill',
    addHint: '选择包含 SKILL.md 的 ZIP 包。安装前会先校验文件结构。',
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
    addTitle: 'Add Skill',
    addHint: 'Choose a ZIP package containing SKILL.md. Its structure will be validated before installation.',
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
  const [skillDialog, setSkillDialog] = useState<'add' | 'delete' | null>(null);
  const [pendingSkillFile, setPendingSkillFile] = useState<File | null>(null);
  const [skillValidation, setSkillValidation] = useState<SkillValidation | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
    if (fileInputRef.current) fileInputRef.current.value = '';
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
          <div className="flex min-w-0 items-center gap-3 sm:w-[440px]">
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
            className="w-full max-w-md border border-border bg-background p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">{skillDialog === 'add' ? text.addTitle : text.deleteTitle}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {skillDialog === 'add'
                    ? text.addHint
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

            {actionError && <div className="mt-4 border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">{actionError}</div>}

            <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
              <button type="button" onClick={closeSkillDialog} disabled={actionLoading} className="h-9 border border-border px-4 text-sm text-muted-foreground hover:bg-muted disabled:opacity-40">
                {text.cancel}
              </button>
              <button
                type="button"
                onClick={() => void (skillDialog === 'add' ? installSkill() : deleteSkill())}
                disabled={actionLoading || (skillDialog === 'add' && !skillValidation)}
                className="inline-flex h-9 items-center gap-2 bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-35"
              >
                {actionLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {actionLoading
                  ? skillDialog === 'add' ? text.installing : text.deleting
                  : skillDialog === 'add' ? text.install : text.delete}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
