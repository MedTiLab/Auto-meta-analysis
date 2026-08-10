import type { TFunction } from 'i18next';

import type { AppTab, ProjectSession } from '../../../types/app';
import type {
  DiffInfo,
  EditorAnalysisStage,
  EditorEvidenceKind,
  EditorResearchContext,
} from '../types/types';

type BuildEditorResearchContextOptions = {
  activeTab: AppTab;
  selectedSession?: ProjectSession | null;
  filePath: string;
  diffInfo?: DiffInfo | null;
};

export function getEditorSessionLabel(session?: ProjectSession | null): string | undefined {
  if (!session) {
    return undefined;
  }

  const raw = session.summary || session.title || session.name;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;
}

export function inferEditorAnalysisStage(filePath: string): EditorAnalysisStage {
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();

  if (normalizedPath.startsWith('literature/')) return 'literature';
  if (normalizedPath.startsWith('survey/') || normalizedPath.startsWith('research/')) return 'literature';
  if (normalizedPath.startsWith('ideation/')) return 'ideation';
  if (normalizedPath.startsWith('experiment/')) return 'experiment';
  if (normalizedPath.startsWith('publication/')) return 'publication';
  if (normalizedPath.startsWith('promotion/') || normalizedPath.startsWith('presentation/')) return 'promotion';
  if (normalizedPath.startsWith('reports/')) return 'reports';
  if (normalizedPath.startsWith('drafts/')) return 'drafts';
  if (normalizedPath.length > 0) return 'workspace';
  return 'unknown';
}

export function inferEditorEvidenceKind(
  activeTab: AppTab,
  diffInfo?: DiffInfo | null,
): EditorEvidenceKind {
  if (activeTab === 'chat') {
    return diffInfo ? 'chat-diff' : 'chat-session';
  }
  if (activeTab === 'files' || activeTab === 'preview') {
    return 'workspace-file';
  }
  if (activeTab === 'git') {
    return 'git-change';
  }
  if (activeTab === 'researchlab') {
    return 'research-artifact';
  }
  if (activeTab === 'survey') {
    return 'survey-artifact';
  }
  return 'project-material';
}

export function buildEditorResearchContext({
  activeTab,
  selectedSession,
  filePath,
  diffInfo,
}: BuildEditorResearchContextOptions): EditorResearchContext {
  return {
    originTab: activeTab,
    originDetail: activeTab === 'chat' ? getEditorSessionLabel(selectedSession) : undefined,
    analysisStage: inferEditorAnalysisStage(filePath),
    evidenceKind: inferEditorEvidenceKind(activeTab, diffInfo),
  };
}

export function getEditorSourceLabel(context: EditorResearchContext | undefined, t: TFunction): string {
  if (!context) {
    return t('researchContext.sources.default');
  }

  if (context.originTab === 'chat' && context.originDetail) {
    return t('researchContext.sources.chatDetail', { detail: context.originDetail });
  }

  switch (context.originTab) {
    case 'chat':
      return t('researchContext.sources.chat');
    case 'files':
      return t('researchContext.sources.files');
    case 'git':
      return t('researchContext.sources.git');
    case 'researchlab':
      return t('researchContext.sources.researchlab');
    case 'survey':
      return t('researchContext.sources.survey');
    case 'preview':
      return t('researchContext.sources.preview');
    default:
      return t('researchContext.sources.default');
  }
}

export function getEditorEvidenceLabel(context: EditorResearchContext | undefined, t: TFunction): string {
  switch (context?.evidenceKind) {
    case 'chat-diff':
      return t('researchContext.evidence.chatDiff');
    case 'chat-session':
      return t('researchContext.evidence.chatSession');
    case 'workspace-file':
      return t('researchContext.evidence.workspaceFile');
    case 'git-change':
      return t('researchContext.evidence.gitChange');
    case 'research-artifact':
      return t('researchContext.evidence.researchArtifact');
    case 'survey-artifact':
      return t('researchContext.evidence.surveyArtifact');
    default:
      return t('researchContext.evidence.default');
  }
}

export function getEditorStageLabel(context: EditorResearchContext | undefined, t: TFunction): string {
  const stage = context?.analysisStage || 'unknown';
  return t(`researchContext.stages.${stage}`);
}

export function getEditorReturnLabel(context: EditorResearchContext | undefined, t: TFunction): string {
  if (!context) {
    return t('researchContext.returnTargets.default');
  }

  if (context.originTab === 'chat' && context.originDetail) {
    return context.originDetail;
  }

  switch (context.originTab) {
    case 'chat':
      return t('researchContext.returnTargets.chat');
    case 'files':
      return t('researchContext.returnTargets.files');
    case 'git':
      return t('researchContext.returnTargets.git');
    case 'researchlab':
      return t('researchContext.returnTargets.researchlab');
    case 'survey':
      return t('researchContext.returnTargets.survey');
    case 'preview':
      return t('researchContext.returnTargets.preview');
    default:
      return t('researchContext.returnTargets.default');
  }
}
