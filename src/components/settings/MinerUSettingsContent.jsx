import { useEffect, useState } from 'react';
import { Check, KeyRound, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '../../utils/api';

export default function MinerUSettingsContent() {
  const { t } = useTranslation('settings');
  const [apiToken, setApiToken] = useState('');
  const [status, setStatus] = useState({ configured: false, source: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadStatus = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.settings.mineruStatus();
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('mineru.messages.loadError'));
      setStatus({ configured: Boolean(payload.configured), source: payload.source || null });
    } catch (loadError) {
      setError(loadError.message || t('mineru.messages.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const save = async (event) => {
    event.preventDefault();
    const token = apiToken.trim();
    if (!token) {
      setError(t('mineru.messages.required'));
      return;
    }

    setSaving(true);
    setMessage('');
    setError('');
    try {
      const response = await api.settings.saveMineruCredentials(token);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('mineru.messages.saveError'));
      setStatus({ configured: Boolean(payload.configured), source: payload.source || null });
      setApiToken('');
      setMessage(t('mineru.messages.saved'));
    } catch (saveError) {
      setError(saveError.message || t('mineru.messages.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const sourceLabel = status.source === 'user_credential'
    ? t('mineru.status.account')
    : status.source === 'environment'
      ? t('mineru.status.environment')
      : t('mineru.status.notConfigured');

  return (
    <div className="space-y-7">
      <div>
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-medium text-foreground">{t('mineru.title')}</h3>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{t('mineru.description')}</p>
      </div>

      <div className="border border-border p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">{t('mineru.status.label')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{loading ? t('mineru.status.loading') : sourceLabel}</p>
          </div>
          <span className={`h-2.5 w-2.5 rounded-full ${status.configured ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
        </div>
      </div>

      <form onSubmit={save} className="space-y-4">
        <div>
          <label htmlFor="mineru-api-token" className="text-sm font-medium text-foreground">
            {t('mineru.fields.apiToken')}
          </label>
          <input
            id="mineru-api-token"
            type="password"
            autoComplete="off"
            value={apiToken}
            onChange={(event) => setApiToken(event.target.value)}
            placeholder={status.configured ? t('mineru.fields.replacePlaceholder') : t('mineru.fields.placeholder')}
            className="mt-2 h-10 w-full border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <p className="mt-2 text-xs text-muted-foreground">{t('mineru.fields.help')}</p>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {message && <p className="flex items-center gap-1.5 text-xs text-emerald-600"><Check className="h-3.5 w-3.5" />{message}</p>}

        <button
          type="submit"
          disabled={saving || !apiToken.trim()}
          className="flex h-9 items-center gap-2 bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-40"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {saving ? t('mineru.actions.saving') : t('mineru.actions.save')}
        </button>
      </form>
    </div>
  );
}
