import { useCallback, useEffect, useRef, useState } from 'react';
import type { SetStateAction } from 'react';
import type { PendingPermissionRequest, PermissionMode } from '../types/types';
import type { ProjectSession, SessionProvider } from '../../../types/app';
import { normalizeClaudeStoredModelSelection } from '../../../../shared/modelConstants';

interface UseChatProviderStateArgs {
  selectedSession: ProjectSession | null;
}

const sanitizeProvider = (): SessionProvider => 'claude';

export function useChatProviderState({ selectedSession }: UseChatProviderStateArgs) {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [provider, setRawProvider] = useState<SessionProvider>('claude');
  const [claudeModel, setClaudeModel] = useState<string>(() =>
    normalizeClaudeStoredModelSelection(localStorage.getItem('claude-model')),
  );
  const lastProviderRef = useRef(provider);

  const setProvider = useCallback((next: SetStateAction<SessionProvider>) => {
    setRawProvider((previous) => {
      if (typeof next === 'function') {
        (next as (prevState: SessionProvider) => SessionProvider)(previous);
      }
      return sanitizeProvider();
    });
  }, []);

  const getProviderPermissionModes = useCallback((): PermissionMode[] => ['default', 'acceptEdits', 'plan'], []);
  const getProviderModeStorageKey = useCallback(() => 'permissionMode-provider-claude', []);

  useEffect(() => {
    const validModes = getProviderPermissionModes();
    const providerMode = localStorage.getItem(getProviderModeStorageKey());
    const defaultMode: PermissionMode = validModes.includes(providerMode as PermissionMode)
      ? providerMode as PermissionMode
      : 'default';
    const savedMode = selectedSession?.id
      ? localStorage.getItem(`permissionMode-${selectedSession.id}`)
      : null;
    setPermissionMode(savedMode && validModes.includes(savedMode as PermissionMode)
      ? savedMode as PermissionMode
      : defaultMode);
  }, [selectedSession?.id, getProviderPermissionModes, getProviderModeStorageKey]);

  useEffect(() => {
    if (localStorage.getItem('selected-provider') !== 'claude') {
      localStorage.setItem('selected-provider', 'claude');
    }
    if (provider !== 'claude') setProvider('claude');
  }, [provider, setProvider]);

  useEffect(() => {
    const normalizedModel = normalizeClaudeStoredModelSelection(claudeModel);
    if (claudeModel !== normalizedModel) {
      setClaudeModel(normalizedModel);
    }
    if (localStorage.getItem('claude-model') !== normalizedModel) {
      localStorage.setItem('claude-model', normalizedModel);
    }
  }, [claudeModel]);

  useEffect(() => {
    if (lastProviderRef.current !== provider) {
      setPendingPermissionRequests([]);
      lastProviderRef.current = provider;
    }
  }, [provider]);

  useEffect(() => {
    setPendingPermissionRequests((previous) =>
      previous.filter((request) => !request.sessionId || request.sessionId === selectedSession?.id));
  }, [selectedSession?.id]);

  const cyclePermissionMode = useCallback(() => {
    const modes = getProviderPermissionModes();
    const nextMode = modes[(modes.indexOf(permissionMode) + 1) % modes.length];
    setPermissionMode(nextMode);
    localStorage.setItem(getProviderModeStorageKey(), nextMode);
    if (selectedSession?.id) localStorage.setItem(`permissionMode-${selectedSession.id}`, nextMode);
  }, [permissionMode, selectedSession?.id, getProviderPermissionModes, getProviderModeStorageKey]);

  return {
    provider,
    setProvider,
    claudeModel,
    setClaudeModel,
    permissionMode,
    setPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  };
}
