import type { Project } from '../../../types/app';
import { getProjectKind, usesMetaNumberedFolders } from '../../../utils/projectKind';

const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/;
const ABSOLUTE_PATH_RE = /^(?:\/|[A-Za-z]:[\\/])/;
const URL_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const EXTENSIONLESS_FILES_RE = /(?:^|[/\\])(?:Dockerfile|Makefile|Procfile|Gemfile|Rakefile|Vagrantfile|Brewfile|Guardfile|Justfile|Taskfile)$/i;
const COMMON_FILE_EXTENSION_RE = /\.(?:md|mdx|markdown|txt|json|jsonl|csv|tsv|tab|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|r|rmd|qmd|ipynb|sql|sh|bash|zsh|fish|ps1|yaml|yml|toml|ini|env|xml|svg|png|jpe?g|gif|webp|bmp|ico|pdf|docx?|pptx?|xlsx?|zip|gz|tar|tgz|7z|rar|parquet|feather|arrow|pkl|pickle|npy|npz|pt|pth|onnx)(?:$|[?#])/i;
const GENERIC_PATH_EXTENSION_RE = /(?:^|[/\\])[^/\\]+\.[A-Za-z0-9][A-Za-z0-9_-]{0,15}(?:$|[?#])/;
const EXTERNAL_HREF_RE = /^(?:https?:|mailto:|tel:|data:|blob:|javascript:)/i;
const META_NUMBERED_ROOTS = [
  '00_literature',
  '01_protocol',
  '02_search_dedupe',
  '03_title_abstract_screening',
  '04_full_text_review',
  '05_data_extraction',
  '06_quality_assessment',
  '07_data_analysis',
  '08_results_figures',
  '09_manuscript_submission',
  '10_presentation',
];
const META_LEGACY_ROOTS = [
  'Literature/reports',
  'Literature/references',
  'Ideation/ideas',
  'Experiment/datasets',
  'Experiment/analysis',
  'Publication/manuscript',
  'Publication/figures',
  'Publication/tables',
  'Publication/supplementary',
  'Promotion/homepage',
  'Promotion/slides',
  'Promotion/audio',
  'Promotion/video',
];
const META_LEGACY_TO_NUMBERED_ROOTS: Array<[string, string]> = [
  ['Literature/reports', '00_literature/reports'],
  ['Literature/references', '00_literature/references'],
  ['Ideation/ideas', '00_literature/topic_selection'],
  ['Experiment/datasets', '05_data_extraction'],
  ['Experiment/analysis', '07_data_analysis'],
  ['Publication/manuscript', '09_manuscript_submission'],
  ['Publication/figures', '08_results_figures'],
  ['Publication/tables', '08_results_figures'],
  ['Publication/supplementary', '09_manuscript_submission'],
  ['Promotion/homepage', '10_presentation'],
  ['Promotion/slides', '10_presentation'],
  ['Promotion/audio', '10_presentation'],
  ['Promotion/video', '10_presentation'],
];

export type NormalizedProjectChatFileReference = {
  normalizedPath: string;
  relativePath: string;
  absolutePath: string | null;
};

function trimLinkWrapper(value: string): string {
  return value.trim().replace(/^<(.+)>$/, '$1').trim();
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function stripHashQueryAndLine(value: string): string {
  const withoutHashOrQuery = value.replace(/[?#].*$/, '');
  const lineMatch = withoutHashOrQuery.match(/^(.*\.[A-Za-z0-9][A-Za-z0-9_-]{0,15})(?::\d+(?::\d+)?)$/);
  return (lineMatch?.[1] || withoutHashOrQuery).trim();
}

export function hasNonFileUrlScheme(value?: string | null): boolean {
  const trimmed = trimLinkWrapper(String(value || ''));
  return Boolean(
    trimmed
    && URL_SCHEME_RE.test(trimmed)
    && !/^file:\/\//i.test(trimmed)
    && !WINDOWS_ABSOLUTE_PATH_RE.test(trimmed),
  );
}

export function isExternalHref(href?: string | null): boolean {
  const value = String(href || '').trim();
  return !value || value.startsWith('#') || EXTERNAL_HREF_RE.test(value) || hasNonFileUrlScheme(value);
}

export function normalizeChatFilePath(value?: string | null): string {
  const trimmed = trimLinkWrapper(String(value || ''));
  if (!trimmed) {
    return '';
  }

  if (/^file:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const decodedPath = decodeURIComponent(url.pathname);
      const normalizedPath = WINDOWS_ABSOLUTE_PATH_RE.test(decodedPath.slice(1))
        ? decodedPath.slice(1)
        : decodedPath;
      return stripHashQueryAndLine(normalizedPath);
    } catch {
      return stripHashQueryAndLine(trimmed.replace(/^file:\/\//i, ''));
    }
  }

  return stripHashQueryAndLine(safeDecodeUri(trimmed));
}

export function isLikelyChatFilePath(value?: string | null): boolean {
  const trimmed = trimLinkWrapper(String(value || ''));
  if (!trimmed || isExternalHref(trimmed)) {
    return false;
  }

  const normalized = normalizeChatFilePath(trimmed);
  if (!normalized) {
    return false;
  }

  if (EXTENSIONLESS_FILES_RE.test(normalized)) {
    return true;
  }

  if (COMMON_FILE_EXTENSION_RE.test(trimmed) || COMMON_FILE_EXTENSION_RE.test(normalized)) {
    return true;
  }

  if ((normalized.includes('/') || normalized.includes('\\')) && GENERIC_PATH_EXTENSION_RE.test(normalized)) {
    return true;
  }

  return normalized.startsWith('./') || normalized.startsWith('../') || normalized.startsWith('/') || WINDOWS_ABSOLUTE_PATH_RE.test(normalized);
}

function normalizeSlashes(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').trim();
}

function withoutTrailingSlash(value: string): string {
  return normalizeSlashes(value).replace(/\/$/, '');
}

function stripLeadingDotSlash(value: string): string {
  return normalizeSlashes(value).replace(/^(?:\.\/)+/, '');
}

function encodeProjectPathAlias(projectPath: string): string {
  return projectPath.replace(/[\\/:\s~_.]/g, '-');
}

function getProjectPathAliases(project?: Project | null): string[] {
  const aliases = new Set<string>();
  const root = withoutTrailingSlash(String(project?.fullPath || project?.path || ''));
  const addAlias = (value?: unknown) => {
    const normalized = stripLeadingDotSlash(String(value || '')).replace(/^\/+|\/+$/g, '');
    if (normalized) {
      aliases.add(normalized);
    }
  };

  addAlias(project?.name);
  addAlias(project?.displayName);
  if (root) {
    addAlias(root.split('/').filter(Boolean).pop());
    addAlias(encodeProjectPathAlias(root));
  }

  return [...aliases].sort((left, right) => right.length - left.length);
}

function stripLeadingProjectAlias(value: string, project?: Project | null): string {
  let normalized = stripLeadingDotSlash(value).replace(/^\/+/, '');
  const lower = normalized.toLowerCase();
  const alias = getProjectPathAliases(project).find((candidate) => {
    const candidateLower = candidate.toLowerCase();
    return lower === candidateLower || lower.startsWith(`${candidateLower}/`);
  });

  if (alias) {
    normalized = normalized.slice(alias.length).replace(/^\/+/, '');
  }

  return normalized;
}

function stripKnownMetaWrapper(value: string): string {
  return stripLeadingDotSlash(value)
    .replace(/^(?:Survey\/meta-analysis|Survey\/meta_analysis|meta-analysis|meta_analysis|MetaAnalysis)\//i, '');
}

function suffixFromKnownRoots(value: string, roots: string[]): string | null {
  const normalized = stripLeadingDotSlash(value).replace(/^\/+/, '');
  const lower = normalized.toLowerCase();
  let bestIndex = Number.POSITIVE_INFINITY;
  let bestValue = '';

  roots.forEach((root) => {
    const rootLower = root.toLowerCase();
    let index = -1;
    if (lower === rootLower || lower.startsWith(`${rootLower}/`)) {
      index = 0;
    } else {
      const marker = `/${rootLower}/`;
      const markerIndex = lower.indexOf(marker);
      if (markerIndex >= 0) {
        index = markerIndex + 1;
      }
    }

    if (index >= 0 && index < bestIndex) {
      bestIndex = index;
      bestValue = normalized.slice(index);
    }
  });

  return bestValue || null;
}

function mapLegacyMetaRootToNumbered(value: string): string {
  const normalized = stripLeadingDotSlash(value).replace(/^\/+/, '');
  const lower = normalized.toLowerCase();
  const match = META_LEGACY_TO_NUMBERED_ROOTS.find(([legacy]) => {
    const legacyLower = legacy.toLowerCase();
    return lower === legacyLower || lower.startsWith(`${legacyLower}/`);
  });

  if (!match) {
    return normalized;
  }

  const [legacy, numbered] = match;
  return `${numbered}${normalized.slice(legacy.length)}`;
}

function normalizeMetaProjectRelativePath(value: string, project?: Project | null): string {
  let normalized = stripKnownMetaWrapper(stripLeadingProjectAlias(value, project));
  const knownRootSuffix = suffixFromKnownRoots(normalized, [...META_NUMBERED_ROOTS, ...META_LEGACY_ROOTS]);
  if (knownRootSuffix) {
    normalized = knownRootSuffix;
  }

  if (usesMetaNumberedFolders(project)) {
    normalized = mapLegacyMetaRootToNumbered(normalized);
  }

  return stripLeadingDotSlash(normalized).replace(/^\/+/, '');
}

export function normalizeProjectChatFileReference(
  rawPath: string,
  project?: Project | null,
): NormalizedProjectChatFileReference | null {
  const normalizedPath = normalizeChatFilePath(rawPath).replace(/\\/g, '/').trim();
  if (!normalizedPath) {
    return null;
  }

  const projectRoot = withoutTrailingSlash(String(project?.fullPath || project?.path || ''));
  const isAbsolutePath = ABSOLUTE_PATH_RE.test(normalizedPath);
  const isUnderProjectRoot = Boolean(
    projectRoot
    && (withoutTrailingSlash(normalizedPath) === projectRoot || normalizedPath.startsWith(`${projectRoot}/`)),
  );
  const isMeta = getProjectKind(project) === 'meta';

  let relativePath = isUnderProjectRoot
    ? normalizedPath.slice(projectRoot.length).replace(/^\/+/, '')
    : isAbsolutePath
      ? normalizedPath
      : stripLeadingDotSlash(normalizedPath);

  if (isMeta) {
    relativePath = normalizeMetaProjectRelativePath(relativePath, project);
  } else if (!isAbsolutePath) {
    relativePath = stripLeadingProjectAlias(relativePath, project);
  }

  const shouldResolveInsideProject = Boolean(projectRoot && (!isAbsolutePath || isUnderProjectRoot || isMeta));
  const absolutePath = shouldResolveInsideProject
    ? `${projectRoot}/${relativePath}`.replace(/\/+/g, '/')
    : isAbsolutePath
      ? normalizedPath
      : projectRoot
        ? `${projectRoot}/${relativePath}`.replace(/\/+/g, '/')
        : null;

  return {
    normalizedPath,
    relativePath,
    absolutePath,
  };
}
