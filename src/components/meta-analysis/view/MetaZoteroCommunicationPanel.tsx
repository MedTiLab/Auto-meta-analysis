import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  Check,
  Download,
  ExternalLink,
  ListChecks,
  Loader2,
  RefreshCw,
  Sparkles,
  Upload,
} from 'lucide-react';

import { Button } from '../../ui/button';
import { api } from '../../../utils/api';
import {
  META_PROJECT_FOLDER_SCHEMA_VERSION,
  getMetaReviewType,
  usesMetaNumberedFolders,
} from '../../../utils/projectKind';
import type { Project } from '../../../types/app';
import { metaAnalysisApi, type ZoteroWebCredentialStatus } from '../api/metaAnalysisApi';
import ImportDialog from '../../references/view/ImportDialog';
import type { ZoteroStatus } from '../../references/types';

type ZoteroAction = 'pullAttachments' | 'pullDecisions';
type ZoteroCredentialIntent = 'aiPush' | 'pullDecisions';

type MetaZoteroCommunicationPanelProps = {
  selectedProject: Project;
  embedded?: boolean;
  onStartTask?: (prompt?: string, task?: {
    id?: string | number | null;
    title?: string | null;
    stage?: string | null;
  } | null) => void;
};

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

function buildZoteroAiHandoffPrompt(selectedProjectName: string, metaProjectId: string) {
  return [
    '请使用 $meta-zotero-fulltext-handoff 检查这个 Meta 项目的缺全文状态。先读取当前全文阶段的 04_full_text_review/fulltext_manifest.json/csv、已下载/已解析全文资产；按当前仍缺可用全文的记录更新缺口清单，只把仍缺可用本地全文的记录推送到 Zotero，让 Zotero 获取/附加 PDF，再同步回项目。',
    '',
    `当前项目：${selectedProjectName || '-'}`,
    `Meta project ID：${metaProjectId}`,
    '',
    '请由模型先检查 fulltext_manifest、全文资产状态、Zotero Web API 凭据状态，以及当前环境中的 ZOTERO_API_KEY、ZOTERO_USER_ID、MEDHELP_API_BASE_URL、MEDHELP_API_TOKEN/MEDHELP_AUTHORIZATION，再调用后端 Zotero 通讯能力推送缺全文记录。',
    '优先导出 RIS 格式的文献管理文件，再将 RIS 导入 Zotero；如果 RIS 导入失败，立即暂停自动推送，改为生成手动导入说明和待导入 RIS 文件，不要继续尝试其它自动导入路径。',
    '不要把题摘 AI 二筛作为硬性前置规则，也不要把这一步当成全文二筛；这里是在全文阶段做缺全文补齐和可用性筛选。',
    '如果上次报告或本次调用出现 Zotero Web API 429，按 skill 规则等待、分批或重试；不要把完整报告路径和长状态写进右侧 UI，只在对话里给出关键数量和下一步。',
  ].join('\n');
}

export default function MetaZoteroCommunicationPanel({
  selectedProject,
  embedded = false,
  onStartTask,
}: MetaZoteroCommunicationPanelProps) {
  const [metaProjectId, setMetaProjectId] = useState<string | null>(null);
  const [zoteroWebStatus, setZoteroWebStatus] = useState<ZoteroWebCredentialStatus | null>(null);
  const [zoteroAction, setZoteroAction] = useState<ZoteroAction | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [showCredentialForm, setShowCredentialForm] = useState(false);
  const [credentialApiKey, setCredentialApiKey] = useState('');
  const [credentialIntent, setCredentialIntent] = useState<ZoteroCredentialIntent | null>(null);
  const [savingCredential, setSavingCredential] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [localZoteroStatus, setLocalZoteroStatus] = useState<ZoteroStatus | null>(null);

  const reviewType = getMetaReviewType(selectedProject);
  const folderSchemaVersion = usesMetaNumberedFolders(selectedProject)
    ? META_PROJECT_FOLDER_SCHEMA_VERSION
    : undefined;

  const busy = zoteroAction !== null || loading || savingCredential;
  const apiLabel = useMemo(() => {
    if (loading) return '检查中';
    if (!zoteroWebStatus?.configured) {
      if (zoteroWebStatus?.apiKeySource && !zoteroWebStatus?.userIdSource) return '缺 User ID';
      if (!zoteroWebStatus?.apiKeySource && zoteroWebStatus?.userIdSource) return '缺 API Key';
      return '未配置';
    }
    const sourceLabel = zoteroWebStatus.source === 'environment'
      ? '环境变量'
      : zoteroWebStatus.source === 'mixed'
        ? '账号/env'
        : zoteroWebStatus.source === 'user_credential'
          ? '账号保存'
          : '已配置';
    return zoteroWebStatus.userId ? `${sourceLabel} · ${zoteroWebStatus.userId}` : sourceLabel;
  }, [
    loading,
    zoteroWebStatus?.apiKeySource,
    zoteroWebStatus?.configured,
    zoteroWebStatus?.source,
    zoteroWebStatus?.userId,
    zoteroWebStatus?.userIdSource,
  ]);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const existing = await metaAnalysisApi.getProject(selectedProject.name);
      const nextMetaProject = existing.metaProject
        || (await metaAnalysisApi.initProject(selectedProject.name, {
          reviewType,
          folderSchemaVersion,
        })).metaProject;
      setMetaProjectId(nextMetaProject.id);
      setZoteroWebStatus(await metaAnalysisApi.zoteroWebCredentialStatus());
    } catch (error) {
      setMessage(`Zotero 通讯状态读取失败：${formatErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, [folderSchemaVersion, reviewType, selectedProject.name]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const refreshLocalZoteroStatus = useCallback(async () => {
    const response = await api.references.zoteroStatus();
    const status = response.ok
      ? await response.json().catch(() => null)
      : null;
    setLocalZoteroStatus(status);
    return status;
  }, []);

  const requireMetaProjectId = useCallback(() => {
    if (metaProjectId) return metaProjectId;
    setMessage('Meta 项目尚未初始化，刷新后再试。');
    return null;
  }, [metaProjectId]);

  const promptForCredential = useCallback((intent: ZoteroCredentialIntent) => {
    setCredentialIntent(intent);
    setShowCredentialForm(true);
    setMessage(null);
  }, []);

  const ensureZoteroWebCredential = useCallback(async (intent: ZoteroCredentialIntent) => {
    if (zoteroWebStatus?.configured) return true;
    try {
      const status = await metaAnalysisApi.zoteroWebCredentialStatus();
      setZoteroWebStatus(status);
      if (status.configured) return true;
    } catch {
      // Fall through to the setup form.
    }
    promptForCredential(intent);
    return false;
  }, [promptForCredential, zoteroWebStatus?.configured]);

  const startAiHandoff = useCallback((nextMetaProjectId: string) => {
    if (!onStartTask) {
      setMessage('当前视图没有连接到任务对话，无法启动 Zotero 通讯 skill。');
      return;
    }
    onStartTask(
      buildZoteroAiHandoffPrompt(selectedProject.name, nextMetaProjectId),
      {
        stage: 'full_text_review',
        title: 'Zotero 通讯',
      },
    );
  }, [onStartTask, selectedProject.name]);

  const handleAiPush = useCallback(async () => {
    const nextMetaProjectId = requireMetaProjectId();
    if (!nextMetaProjectId) return;
    if (!(await ensureZoteroWebCredential('aiPush'))) return;
    startAiHandoff(nextMetaProjectId);
  }, [ensureZoteroWebCredential, requireMetaProjectId, startAiHandoff]);

  const handlePullAttachments = useCallback(async () => {
    const nextMetaProjectId = requireMetaProjectId();
    if (!nextMetaProjectId) return;
    setZoteroAction('pullAttachments');
    setMessage(null);
    try {
      const result = await metaAnalysisApi.resolveFullTextFromZotero(nextMetaProjectId);
      const skipped = Number(result.skippedAlreadyResolved || 0);
      const skippedHumanReview = Number(result.skippedHumanReview || 0);
      setMessage(
        `附件拉取完成：下载 ${result.downloaded}，已缓存 ${result.cached}，需手动处理 ${result.manualUploadRequired}，失败 ${result.failed}${skipped ? `，已存在跳过 ${skipped}` : ''}${skippedHumanReview ? `，未过人工筛选跳过 ${skippedHumanReview}` : ''}。`,
      );
      await refreshStatus();
    } catch (error) {
      setMessage(`从 Zotero 拉取附件失败：${formatErrorMessage(error)}`);
    } finally {
      setZoteroAction(null);
    }
  }, [refreshStatus, requireMetaProjectId]);

  const performPullDecisions = useCallback(async (nextMetaProjectId: string) => {
    setZoteroAction('pullDecisions');
    setMessage(null);
    try {
      const result = await metaAnalysisApi.importFullTextDecisionsFromZotero(nextMetaProjectId);
      setMessage(`全文筛选决策已同步：${result.synced} 条。`);
      await refreshStatus();
    } catch (error) {
      setMessage(`从 Zotero 拉取筛选决策失败：${formatErrorMessage(error)}`);
    } finally {
      setZoteroAction(null);
    }
  }, [refreshStatus]);

  const handlePullDecisions = useCallback(async () => {
    const nextMetaProjectId = requireMetaProjectId();
    if (!nextMetaProjectId) return;
    if (!(await ensureZoteroWebCredential('pullDecisions'))) return;
    await performPullDecisions(nextMetaProjectId);
  }, [ensureZoteroWebCredential, performPullDecisions, requireMetaProjectId]);

  const handleSaveCredential = useCallback(async () => {
    const apiKey = credentialApiKey.trim();
    if (!apiKey) {
      setMessage('请输入 Zotero API Key。');
      return;
    }
    setSavingCredential(true);
    setMessage(null);
    try {
      const status = await metaAnalysisApi.saveZoteroWebCredentials({ apiKey });
      setZoteroWebStatus(status);
      setCredentialApiKey('');
      setShowCredentialForm(false);
      const intent = credentialIntent;
      setCredentialIntent(null);
      const nextMetaProjectId = requireMetaProjectId();
      if (!nextMetaProjectId || !intent) return;
      if (intent === 'aiPush') {
        startAiHandoff(nextMetaProjectId);
      } else {
        await performPullDecisions(nextMetaProjectId);
      }
    } catch (error) {
      setMessage(`保存 Zotero API Key 失败：${formatErrorMessage(error)}`);
    } finally {
      setSavingCredential(false);
    }
  }, [
    credentialApiKey,
    credentialIntent,
    performPullDecisions,
    requireMetaProjectId,
    startAiHandoff,
  ]);

  const compact = embedded;

  return (
    <div className={compact ? 'flex min-h-0 flex-1 flex-col overflow-y-auto p-2' : 'flex min-h-0 flex-1 flex-col overflow-y-auto p-4'}>
      <section className={`rounded-lg border border-sky-200/80 bg-background shadow-sm dark:border-sky-900/50 ${compact ? 'p-2.5' : 'p-4'}`}>
        <div>
          <div className={`flex flex-wrap items-start justify-between ${compact ? 'gap-2' : 'gap-3'}`}>
            <div className="min-w-0">
              <div className={`inline-flex items-center rounded-md border border-sky-200 bg-sky-50 font-medium text-sky-800 shadow-sm dark:border-sky-900/60 dark:bg-sky-950/25 dark:text-sky-100 ${compact ? 'gap-1 px-2 py-0.5 text-[11px]' : 'gap-1.5 px-2.5 py-[5px] text-xs'}`}>
                <RefreshCw className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
                Zotero 通讯
              </div>
              <h2 className={`font-semibold tracking-normal text-foreground ${compact ? 'mt-1.5 text-sm' : 'mt-3 text-base'}`}>
                文献与全文附件同步
              </h2>
              <p className={`text-muted-foreground ${compact ? 'mt-0.5 text-[11px] leading-4' : 'mt-1 text-xs leading-5'}`}>
                当前 Meta 项目的 Zotero 推送、选择导入文献/全文和决策同步都在这里处理。
              </p>
            </div>
            <div className={`rounded-lg border font-medium ${compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-2 text-xs'} ${
              zoteroWebStatus?.configured
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/25 dark:text-emerald-100'
                : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100'
            }`}
            >
              Web API：{apiLabel}
            </div>
          </div>

          <div className={`flex flex-col ${compact ? 'mt-2.5 gap-1' : 'mt-4 gap-2'}`}>
            <Button
              variant="outline"
              className={`w-full justify-start rounded-lg bg-background/80 text-foreground transition-colors hover:bg-background active:border-emerald-300 active:bg-emerald-50 active:text-emerald-800 dark:active:border-emerald-900/60 dark:active:bg-emerald-950/25 dark:active:text-emerald-100 ${compact ? 'h-8 gap-1.5 px-2.5 text-xs font-medium' : 'h-11 gap-2 px-3 text-sm font-semibold'}`}
              onClick={() => void handleAiPush()}
              disabled={busy || !metaProjectId || !onStartTask}
              title="让 Claude 使用 Zotero 通讯 skill 检查并推送缺全文记录"
            >
              <Sparkles className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
              AI 推送缺全文
            </Button>
            <Button
              variant="outline"
              className={`w-full justify-start rounded-lg bg-background/80 text-foreground transition-colors hover:bg-background active:border-emerald-300 active:bg-emerald-50 active:text-emerald-800 dark:active:border-emerald-900/60 dark:active:bg-emerald-950/25 dark:active:text-emerald-100 ${compact ? 'h-8 gap-1.5 px-2.5 text-xs font-medium' : 'h-11 gap-2 px-3 text-sm font-semibold'}`}
              onClick={() => void handlePullAttachments()}
              disabled={busy || !metaProjectId}
              title="从本机 Zotero 匹配并拉取已有人审通过记录的 PDF 附件"
            >
              {zoteroAction === 'pullAttachments' ? <Loader2 className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} animate-spin`} /> : <Download className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
              拉取附件
            </Button>
            <Button
              variant="outline"
              className={`w-full justify-start rounded-lg bg-background/80 text-foreground transition-colors hover:bg-background active:border-emerald-300 active:bg-emerald-50 active:text-emerald-800 dark:active:border-emerald-900/60 dark:active:bg-emerald-950/25 dark:active:text-emerald-100 ${compact ? 'h-8 gap-1.5 px-2.5 text-xs font-medium' : 'h-11 gap-2 px-3 text-sm font-semibold'}`}
              onClick={() => {
                setMessage(null);
                setShowImportDialog(true);
              }}
              disabled={busy}
              title="打开 Zotero 导入器，先选择集合和条目，再同步到 04_full_text_review"
            >
              <Upload className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
              导入文献/全文
            </Button>
            <Button
              variant="outline"
              className={`w-full justify-start rounded-lg bg-background/80 text-foreground transition-colors hover:bg-background active:border-emerald-300 active:bg-emerald-50 active:text-emerald-800 dark:active:border-emerald-900/60 dark:active:bg-emerald-950/25 dark:active:text-emerald-100 ${compact ? 'h-8 gap-1.5 px-2.5 text-xs font-medium' : 'h-11 gap-2 px-3 text-sm font-semibold'}`}
              onClick={() => void handlePullDecisions()}
              disabled={busy || !metaProjectId}
              title="从 Zotero Include/Maybe/Exclude 集合同步全文筛选决策"
            >
              {zoteroAction === 'pullDecisions' ? <Loader2 className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} animate-spin`} /> : <ListChecks className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
              拉取决策
            </Button>
          </div>

          <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'mt-2' : 'mt-3'}`}>
            <a
              href="https://www.zotero.org/settings/keys/new"
              target="_blank"
              rel="noreferrer"
              className={`inline-flex items-center rounded-lg border border-sky-200 bg-background/80 font-medium text-sky-800 shadow-sm hover:text-sky-950 dark:border-sky-900/60 dark:text-sky-100 ${compact ? 'gap-1 px-2 py-1 text-[11px]' : 'gap-1.5 px-2.5 py-1.5 text-xs'}`}
            >
              <ExternalLink className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
              创建 Zotero API Key
            </a>
            <Button
              variant="ghost"
              size="sm"
              className={compact ? 'h-7 px-1.5 text-[11px]' : 'h-8 px-2 text-xs'}
              onClick={() => promptForCredential('aiPush')}
              disabled={busy}
            >
              更新 Key
            </Button>
          </div>

          {showCredentialForm ? (
            <div className={`rounded-lg border border-amber-200 bg-amber-50/85 dark:border-amber-900/50 dark:bg-amber-950/20 ${compact ? 'mt-2 px-2.5 py-2' : 'mt-3 px-3 py-3'}`}>
              <div className={`font-medium text-amber-900 dark:text-amber-100 ${compact ? 'text-[11px]' : 'text-xs'}`}>
                输入一次 Zotero Web API Key，系统会自动识别 User ID 并保存到当前账号。
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  autoComplete="off"
                  value={credentialApiKey}
                  onChange={(event) => setCredentialApiKey(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleSaveCredential();
                    }
                  }}
                  className="min-h-9 flex-1 rounded-lg border border-amber-200 bg-background px-2.5 text-xs text-foreground outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 dark:border-amber-900/60"
                  placeholder="粘贴 Zotero API Key"
                  disabled={savingCredential}
                />
                <Button
                  size="sm"
                  className="h-9 px-3 text-xs"
                  onClick={() => void handleSaveCredential()}
                  disabled={savingCredential || !credentialApiKey.trim()}
                >
                  {savingCredential ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  保存并继续
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 px-3 text-xs"
                  onClick={() => {
                    setShowCredentialForm(false);
                    setCredentialApiKey('');
                    setCredentialIntent(null);
                  }}
                  disabled={savingCredential}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : null}

          {message ? (
            <div className={`rounded-lg border border-border/70 bg-background/80 text-muted-foreground shadow-sm ${compact ? 'mt-2 px-2.5 py-1.5 text-[11px] leading-4' : 'mt-3 px-3 py-2 text-xs leading-5'}`}>
              {message}
            </div>
          ) : null}
        </div>
      </section>

      {showImportDialog && typeof document !== 'undefined' ? ReactDOM.createPortal(
        <ImportDialog
          zoteroStatus={localZoteroStatus}
          projectName={selectedProject.name}
          onRefreshZoteroStatus={refreshLocalZoteroStatus}
          onClose={() => setShowImportDialog(false)}
          onComplete={() => {
            setShowImportDialog(false);
            setMessage('导入完成：已同步到当前 Meta 项目的 04_full_text_review/fulltext。');
            void refreshStatus();
          }}
        />,
        document.body,
      ) : null}
    </div>
  );
}
