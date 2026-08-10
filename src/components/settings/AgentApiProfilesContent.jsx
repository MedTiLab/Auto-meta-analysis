import React, { useEffect, useMemo, useState } from 'react';
import { Check, Edit3, KeyRound, Plus, RefreshCw, RotateCcw, Server, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';

const emptyForm = {
  name: '',
  authType: 'api_key',
  apiKey: '',
  baseUrl: '',
  runtimeModel: '',
  isActive: true,
  priority: 0,
};

function SecretMask({ profile }) {
  if (!profile?.hasSecret) {
    return <span className="text-muted-foreground">-</span>;
  }
  return <span className="font-mono text-xs">•••• {profile.secretLast4 || 'set'}</span>;
}

export default function AgentApiProfilesContent() {
  const { t } = useTranslation('settings');
  const [profiles, setProfiles] = useState([]);
  const [selection, setSelection] = useState(null);
  const [systemStrategy, setSystemStrategy] = useState('default');
  const [form, setForm] = useState(emptyForm);
  const [editingProfile, setEditingProfile] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [agentApiEnabled, setAgentApiEnabled] = useState(true);

  const selectedProfileId = selection?.mode === 'profile' ? selection.selectedProfileId : null;
  const userProfiles = useMemo(() => profiles.filter((profile) => profile.scope === 'user'), [profiles]);
  const systemProfiles = useMemo(() => profiles.filter((profile) => profile.scope === 'system'), [profiles]);

  const loadProfiles = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.settings.agentApiProfiles();
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || t('agentApi.messages.loadError'));
      }
      setAgentApiEnabled(data.agentApiEnabled !== false);
      setProfiles(data.profiles || []);
      setSelection(data.selection || null);
      setSystemStrategy(data.systemStrategy || 'default');
    } catch (err) {
      setError(err.message || t('agentApi.messages.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingProfile(null);
    setShowForm(false);
  };

  const startEdit = (profile) => {
    if (profile.scope !== 'user') return;
    setEditingProfile(profile);
    setForm({
      name: profile.name || '',
      authType: profile.authType || 'api_key',
      apiKey: '',
      baseUrl: profile.baseUrl || '',
      runtimeModel: profile.runtimeModel || '',
      isActive: profile.isActive !== false,
      priority: profile.priority || 0,
    });
    setShowForm(true);
    setMessage('');
    setError('');
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const payload = {
        ...form,
        provider: 'anthropic',
        priority: Number(form.priority) || 0,
      };
      if (!payload.apiKey) {
        delete payload.apiKey;
      }

      const response = editingProfile
        ? await api.settings.updateAgentApiProfile(editingProfile.id, payload)
        : await api.settings.createAgentApiProfile(payload);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || t('agentApi.messages.saveError'));
      }

      setMessage(editingProfile ? t('agentApi.messages.updated') : t('agentApi.messages.created'));
      resetForm();
      await loadProfiles();
    } catch (err) {
      setError(err.message || t('agentApi.messages.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const selectProfile = async (profileId) => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const response = await api.settings.selectAgentApiProfile(profileId);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || t('agentApi.messages.selectError'));
      }
      setSelection(data.selection || null);
      setMessage(profileId ? t('agentApi.messages.selected') : t('agentApi.messages.systemAutoSelected'));
    } catch (err) {
      setError(err.message || t('agentApi.messages.selectError'));
    } finally {
      setSaving(false);
    }
  };

  const deleteProfile = async (profile) => {
    if (profile.scope !== 'user') return;
    if (!window.confirm(t('agentApi.messages.confirmDelete', { name: profile.name }))) {
      return;
    }

    setSaving(true);
    setMessage('');
    setError('');
    try {
      const response = await api.settings.deleteAgentApiProfile(profile.id);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || t('agentApi.messages.deleteError'));
      }
      if (selectedProfileId === profile.id) {
        await api.settings.selectAgentApiProfile(null);
      }
      setMessage(t('agentApi.messages.deleted'));
      await loadProfiles();
    } catch (err) {
      setError(err.message || t('agentApi.messages.deleteError'));
    } finally {
      setSaving(false);
    }
  };

  const toggleOwnProfile = async (profile) => {
    if (profile.scope !== 'user') return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const response = await api.settings.updateAgentApiProfile(profile.id, {
        isActive: !profile.isActive,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || t('agentApi.messages.saveError'));
      }
      await loadProfiles();
    } catch (err) {
      setError(err.message || t('agentApi.messages.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const renderProfile = (profile) => {
    const isSelected = selectedProfileId === profile.id;
    const isSystem = profile.scope === 'system';

    return (
      <div key={profile.id} className="rounded-lg border border-border bg-background p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="truncate text-sm font-semibold text-foreground">{profile.name}</h4>
              <Badge variant="secondary" className={isSystem ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : ''}>
                {isSystem ? t('agentApi.scope.system') : t('agentApi.scope.user')}
              </Badge>
              {profile.isDefault && <Badge variant="secondary">{t('agentApi.badges.default')}</Badge>}
              {!profile.isActive && <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t('agentApi.badges.disabled')}</Badge>}
              {isSelected && <Badge variant="success" className="bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-200">{t('agentApi.badges.selected')}</Badge>}
            </div>
            <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
              <span>{t('agentApi.fields.secret')}: <SecretMask profile={profile} /></span>
              <span>{t('agentApi.fields.baseUrl')}: {profile.baseUrl || t('agentApi.values.officialDefault')}</span>
              <span>{t('agentApi.fields.runtimeModel')}: {profile.runtimeModel || t('agentApi.values.followPlan')}</span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={isSelected ? 'default' : 'outline'}
              disabled={saving || !profile.isActive}
              onClick={() => selectProfile(profile.id)}
            >
              <Check className="mr-2 h-4 w-4" />
              {isSelected ? t('agentApi.actions.inUse') : t('agentApi.actions.use')}
            </Button>
            {!isSystem && (
              <>
                <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => startEdit(profile)}>
                  <Edit3 className="h-4 w-4" />
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => toggleOwnProfile(profile)}>
                  {profile.isActive ? t('agentApi.actions.disable') : t('agentApi.actions.enable')}
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => deleteProfile(profile)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {!agentApiEnabled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="font-medium">{t('agentApi.locked.title')}</div>
          <div className="mt-1">{t('agentApi.locked.description')}</div>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-medium text-foreground">
            <KeyRound className="h-5 w-5 text-blue-600" />
            {t('agentApi.title')}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('agentApi.description')}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={loadProfiles} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('agentApi.actions.refresh')}
          </Button>
          <Button type="button" size="sm" onClick={() => setShowForm(true)} disabled={!agentApiEnabled}>
            <Plus className="mr-2 h-4 w-4" />
            {t('agentApi.actions.add')}
          </Button>
        </div>
      </div>

      {(message || error) && (
        <div className="space-y-2">
          {message && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200">{message}</div>}
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
        </div>
      )}

      <div className="rounded-lg border border-border bg-gray-50 p-4 dark:bg-gray-900/40">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <RotateCcw className="mt-0.5 h-5 w-5 text-blue-600" />
            <div>
              <div className="font-medium text-foreground">{t('agentApi.systemAuto.title')}</div>
              <div className="text-sm text-muted-foreground">
                {t('agentApi.systemAuto.description', { strategy: t(`agentApi.strategy.${systemStrategy}`) })}
              </div>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant={!selectedProfileId ? 'default' : 'outline'}
            disabled={saving}
            onClick={() => selectProfile(null)}
          >
            {!selectedProfileId ? t('agentApi.actions.inUse') : t('agentApi.actions.useSystemAuto')}
          </Button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={saveProfile} className="space-y-4 rounded-lg border border-border bg-background p-4">
          <div className="flex items-center justify-between gap-4">
            <h4 className="text-sm font-semibold text-foreground">
              {editingProfile ? t('agentApi.form.editTitle') : t('agentApi.form.createTitle')}
            </h4>
            <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium text-foreground">{t('agentApi.fields.name')}</span>
              <Input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} required />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-foreground">{t('agentApi.fields.authType')}</span>
              <select
                value={form.authType}
                onChange={(event) => setForm((prev) => ({ ...prev, authType: event.target.value }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="api_key">ANTHROPIC_API_KEY</option>
                <option value="auth_token">ANTHROPIC_AUTH_TOKEN</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-foreground">{t('agentApi.fields.secret')}</span>
              <Input
                type="password"
                value={form.apiKey}
                onChange={(event) => setForm((prev) => ({ ...prev, apiKey: event.target.value }))}
                placeholder={editingProfile?.hasSecret ? t('agentApi.form.secretPlaceholderSaved') : 'sk-ant-...'}
                required={!editingProfile}
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-foreground">{t('agentApi.fields.baseUrl')}</span>
              <Input
                value={form.baseUrl}
                onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
                placeholder="https://api.anthropic.com"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-foreground">{t('agentApi.fields.runtimeModel')}</span>
              <Input
                value={form.runtimeModel}
                onChange={(event) => setForm((prev) => ({ ...prev, runtimeModel: event.target.value }))}
                placeholder="claude-sonnet-4-5"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
            />
            {t('agentApi.fields.active')}
          </label>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={resetForm}>{t('agentApi.actions.cancel')}</Button>
            <Button type="submit" disabled={saving}>{saving ? t('agentApi.actions.saving') : t('agentApi.actions.save')}</Button>
          </div>
        </form>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-blue-600" />
          <h4 className="text-sm font-semibold text-foreground">{t('agentApi.sections.userProfiles')}</h4>
        </div>
        {loading ? (
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">{t('agentApi.messages.loading')}</div>
        ) : userProfiles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{t('agentApi.empty.user')}</div>
        ) : (
          userProfiles.map(renderProfile)
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-blue-600" />
          <h4 className="text-sm font-semibold text-foreground">{t('agentApi.sections.systemProfiles')}</h4>
        </div>
        {systemProfiles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{t('agentApi.empty.system')}</div>
        ) : (
          systemProfiles.map(renderProfile)
        )}
      </section>
    </div>
  );
}
