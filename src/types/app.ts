export type SessionProvider = 'claude';

export type SessionMode = 'research' | 'workspace_qa';

export interface SessionTag {
  id: number;
  projectName?: string;
  tagKey: string;
  tagType: 'stage' | string;
  label: string;
  color?: string | null;
  sortOrder?: number;
  metadata?: Record<string, unknown> | null;
  source?: string | null;
  linkedBy?: string | null;
  linkedAt?: string | null;
  linkMetadata?: Record<string, unknown> | null;
  createdAt?: string;
}

export interface PendingAutoIntake {
  prompt?: string | null;
  triggerId?: string | null;
}

export interface ImportedProjectAnalysisPrompt {
  project: Project;
  prompt: string;
}

export interface ProjectCreationOptions {
  autoIntake?: PendingAutoIntake | null;
  importedProjectAnalysisPrompt?: ImportedProjectAnalysisPrompt | null;
}

export type AppTab = 'dashboard' | 'trash' | 'chat' | 'survey' | 'files' | 'git' | 'researchlab' | 'metaHelp' | 'skills' | 'tasks' | 'preview' | 'news' | 'references';

export interface ProjectSession {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  mode?: SessionMode;
  tags?: SessionTag[];
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  __provider?: SessionProvider;
  __projectName?: string;
  [key: string]: unknown;
}

export interface ProjectSessionMeta {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface ProjectTaskmasterInfo {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Project {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
  createdAt?: string;
  metadata?: Record<string, unknown> | null;
  sessions?: ProjectSession[];
  sessionMeta?: ProjectSessionMeta;
  taskmaster?: ProjectTaskmasterInfo;
  [key: string]: unknown;
}

export interface TrashProject {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
  originalPath?: string;
  trashPath?: string;
  claudeTrashPath?: string;
  trashedAt: string;
  sessionCount?: number;
  canRestore?: boolean;
  filesExist?: boolean;
  [key: string]: unknown;
}

export interface TrashSession {
  id: string;
  projectName: string;
  projectDisplayName?: string;
  provider: SessionProvider;
  displayName: string;
  trashedAt: string;
  lastActivity?: string | null;
  messageCount?: number;
  [key: string]: unknown;
}

export interface LoadingProgress {
  type?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
}

export interface ProjectsUpdatedMessage {
  type: 'projects_updated';
  projects: Project[];
  changedFile?: string;
  [key: string]: unknown;
}

export interface ActiveSessionsMessage {
  type: 'active-sessions';
  sessions?: Partial<Record<SessionProvider, Array<string | { id?: string; sessionId?: string; startTime?: number }>>> & {
    claude?: Array<string | { id?: string; sessionId?: string; startTime?: number }>;
  };
  [key: string]: unknown;
}

export interface LoadingProgressMessage extends LoadingProgress {
  type: 'loading_progress';
}

export type AppSocketMessage =
  | LoadingProgressMessage
  | ProjectsUpdatedMessage
  | ActiveSessionsMessage
  | { type?: string; [key: string]: unknown };
