import type { Project } from '../types/app';

export type AnalysisLanguagePreference = 'auto' | 'python' | 'r';

export const DEFAULT_ANALYSIS_LANGUAGE_PREFERENCE: AnalysisLanguagePreference = 'auto';
export const ANALYSIS_LANGUAGE_PREFERENCES: AnalysisLanguagePreference[] = ['auto', 'python', 'r'];

const STORAGE_PREFIX = 'medhelp-analysis-language:';

const normalizeProjectKey = (project?: Pick<Project, 'fullPath' | 'name'> | null): string => {
  if (!project) {
    return 'global';
  }

  const fullPath = typeof project.fullPath === 'string' ? project.fullPath.trim() : '';
  if (fullPath) {
    return fullPath;
  }

  const name = typeof project.name === 'string' ? project.name.trim() : '';
  return name || 'global';
};

export const normalizeAnalysisLanguagePreference = (value: unknown): AnalysisLanguagePreference => {
  if (typeof value !== 'string') {
    return DEFAULT_ANALYSIS_LANGUAGE_PREFERENCE;
  }

  const normalized = value.trim().toLowerCase();
  return ANALYSIS_LANGUAGE_PREFERENCES.includes(normalized as AnalysisLanguagePreference)
    ? normalized as AnalysisLanguagePreference
    : DEFAULT_ANALYSIS_LANGUAGE_PREFERENCE;
};

export const getAnalysisLanguageStorageKey = (project?: Pick<Project, 'fullPath' | 'name'> | null): string => {
  return `${STORAGE_PREFIX}${encodeURIComponent(normalizeProjectKey(project))}`;
};

export const getStoredAnalysisLanguagePreference = (
  project?: Pick<Project, 'fullPath' | 'name'> | null,
): AnalysisLanguagePreference => {
  if (typeof window === 'undefined') {
    return DEFAULT_ANALYSIS_LANGUAGE_PREFERENCE;
  }

  try {
    const stored = window.localStorage.getItem(getAnalysisLanguageStorageKey(project));
    return normalizeAnalysisLanguagePreference(stored);
  } catch {
    return DEFAULT_ANALYSIS_LANGUAGE_PREFERENCE;
  }
};

export const setStoredAnalysisLanguagePreference = (
  project: Pick<Project, 'fullPath' | 'name'> | null | undefined,
  value: AnalysisLanguagePreference,
): AnalysisLanguagePreference => {
  const normalized = normalizeAnalysisLanguagePreference(value);

  if (typeof window === 'undefined') {
    return normalized;
  }

  try {
    window.localStorage.setItem(getAnalysisLanguageStorageKey(project), normalized);
  } catch {
    // Ignore localStorage write failures and still return the normalized value.
  }

  return normalized;
};
