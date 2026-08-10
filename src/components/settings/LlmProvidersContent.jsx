import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';

const BUILT_IN_IDS = ['claude-official', 'openai-official', 'grok-official'];
const MODEL_SLOTS = ['main', 'haiku', 'sonnet', 'opus'];
const EMPTY_MODELS = { main: '', haiku: '', sonnet: '', opus: '' };
const EMPTY_SUPPORT = { main: false, haiku: false, sonnet: false, opus: false };

function strip1mMarker(model) {
  return String(model || '').replace(/\[1m\]$/i, '');
}

function has1mMarker(model) {
  return /\[1m\]$/i.test(String(model || ''));
}

export function normalizeProviderItems(payload = {}) {
  const providers = Array.isArray(payload.providers) ? payload.providers : [];
  const builtIns = Array.isArray(payload.builtIns) ? payload.builtIns : [];
  const byId = new Map([...builtIns, ...providers].map((provider) => [provider.id, provider]));
  const fallbackOrder = [...providers.map((provider) => provider.id), ...BUILT_IN_IDS];
  const requestedOrder = Array.isArray(payload.providerOrder) ? payload.providerOrder : fallbackOrder;
  const seen = new Set();
  return [...requestedOrder, ...fallbackOrder]
    .filter((id) => byId.has(id) && !seen.has(id) && seen.add(id))
    .map((id) => ({ ...byId.get(id), builtIn: BUILT_IN_IDS.includes(id) }));
}

export function providerFormFromPreset(preset, provider = null) {
  const rawModels = provider?.models || preset?.defaultModels || EMPTY_MODELS;
  const support = Object.fromEntries(MODEL_SLOTS.map((slot) => [
    slot,
    provider?.model1mSupport?.[slot] === true || has1mMarker(rawModels[slot]),
  ]));
  const models = Object.fromEntries(MODEL_SLOTS.map((slot) => [slot, strip1mMarker(rawModels[slot])]));
  const contextWindows = Object.fromEntries(MODEL_SLOTS.map((slot) => {
    const rawModel = rawModels[slot];
    const model = models[slot];
    const value = provider?.modelContextWindows?.[model]
      ?? provider?.modelContextWindows?.[rawModel]
      ?? preset?.modelContextWindows?.[rawModel]
      ?? preset?.modelContextWindows?.[model]
      ?? '';
    return [slot, value ? String(value) : ''];
  }));
  const compactDefault = preset?.defaultEnv?.CLAUDE_CODE_AUTO_COMPACT_WINDOW || '';
  return {
    presetId: provider?.presetId || preset?.id || 'custom',
    name: provider?.name || preset?.name || '',
    apiKey: '',
    baseUrl: provider?.baseUrl ?? preset?.baseUrl ?? '',
    apiFormat: provider?.apiFormat || preset?.apiFormat || 'anthropic',
    authStrategy: provider?.authStrategy || preset?.authStrategy || 'auth_token',
    models,
    model1mSupport: support,
    contextWindows,
    autoCompactWindow: provider?.autoCompactWindow ? String(provider.autoCompactWindow) : compactDefault,
    toolSearchEnabled: provider?.toolSearchEnabled !== false,
    disableExperimentalBetas: provider?.disableExperimentalBetas === true,
    notes: provider?.notes || '',
  };
}

export function providerPayloadFromForm(form, editing = false) {
  const modelContextWindows = {};
  for (const slot of MODEL_SLOTS) {
    const model = String(form.models[slot] || '').trim();
    const context = Number.parseInt(form.contextWindows[slot], 10);
    if (model && Number.isInteger(context) && context >= 16000 && context <= 10000000) {
      modelContextWindows[model] = context;
    }
  }
  const payload = {
    ...(!editing && { presetId: form.presetId }),
    name: form.name.trim(),
    baseUrl: form.baseUrl.trim(),
    apiFormat: form.apiFormat,
    runtimeKind: 'anthropic_compatible',
    authStrategy: form.authStrategy,
    models: Object.fromEntries(MODEL_SLOTS.map((slot) => [slot, String(form.models[slot] || '').trim()])),
    model1mSupport: form.model1mSupport,
    toolSearchEnabled: form.toolSearchEnabled,
    disableExperimentalBetas: form.disableExperimentalBetas,
    notes: form.notes.trim(),
  };
  if (Object.keys(modelContextWindows).length) payload.modelContextWindows = modelContextWindows;
  else if (editing) payload.modelContextWindows = null;
  if (form.autoCompactWindow) payload.autoCompactWindow = Number.parseInt(form.autoCompactWindow, 10);
  else if (editing) payload.autoCompactWindow = null;
  if (!editing || form.apiKey) payload.apiKey = form.apiKey;
  return payload;
}

async function responseJson(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload;
}

function ResultLine({ result, t }) {
  if (!result) return null;
  const connectivity = result.connectivity;
  const proxy = result.proxy;
  return (
    <div className="mt-2 space-y-1 text-xs">
      <p className={connectivity?.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
        {connectivity?.success
          ? t('llmProviders.testSuccess', { latency: connectivity.latencyMs })
          : t('llmProviders.testFailed', { error: connectivity?.error || 'Unknown error' })}
      </p>
      {proxy && (
        <p className={proxy.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
          {proxy.success
            ? t('llmProviders.proxySuccess', { latency: proxy.latencyMs })
            : t('llmProviders.proxyFailed', { error: proxy.error || 'Unknown error' })}
        </p>
      )}
    </div>
  );
}

function ProviderForm({ provider, presets, onClose, onSaved }) {
  const { t } = useTranslation('settings');
  const editing = Boolean(provider);
  const selectablePresets = presets.filter((preset) => preset.id !== 'official');
  const initialPreset = selectablePresets.find((preset) => preset.id === provider?.presetId)
    || selectablePresets[0]
    || { id: 'custom', name: 'Custom', defaultModels: EMPTY_MODELS };
  const [form, setForm] = useState(() => providerFormFromPreset(initialPreset, provider));
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState('');

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateNested = (key, slot, value) => setForm((current) => ({
    ...current,
    [key]: { ...current[key], [slot]: value },
  }));

  const selectPreset = (presetId) => {
    const preset = selectablePresets.find((entry) => entry.id === presetId);
    if (preset) setForm(providerFormFromPreset(preset));
    setTestResult(null);
    setError('');
  };

  const validate = () => {
    if (!form.name.trim()) return t('llmProviders.errors.nameRequired');
    if (!form.baseUrl.trim()) return t('llmProviders.errors.baseUrlRequired');
    if (!MODEL_SLOTS.every((slot) => form.models[slot]?.trim())) return t('llmProviders.errors.modelsRequired');
    const compact = form.autoCompactWindow ? Number.parseInt(form.autoCompactWindow, 10) : null;
    if (compact !== null && (!Number.isInteger(compact) || compact < 16000 || compact > 10000000)) {
      return t('llmProviders.errors.contextRange');
    }
    for (const value of Object.values(form.contextWindows)) {
      if (!value) continue;
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 16000 || parsed > 10000000) return t('llmProviders.errors.contextRange');
    }
    return '';
  };

  const save = async (event) => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) return setError(validationError);
    setSaving(true);
    setError('');
    try {
      const payload = providerPayloadFromForm(form, editing);
      const response = editing
        ? await api.providers.update(provider.id, payload)
        : await api.providers.create(payload);
      await responseJson(response, t('llmProviders.errors.save'));
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || t('llmProviders.errors.save'));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (editing && !form.apiKey) {
      setTesting(true);
      setError('');
      try {
        const payload = await responseJson(await api.providers.testSaved(provider.id), t('llmProviders.errors.test'));
        setTestResult(payload.result);
      } catch (err) {
        setError(err.message || t('llmProviders.errors.test'));
      } finally {
        setTesting(false);
      }
      return;
    }
    if (!form.apiKey) return setError(t('llmProviders.errors.apiKeyForTest'));
    const validationError = validate();
    if (validationError) return setError(validationError);
    setTesting(true);
    setError('');
    try {
      const payload = await responseJson(await api.providers.testConfig({
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey,
        modelId: form.models.main.trim(),
        authStrategy: form.authStrategy,
        apiFormat: form.apiFormat,
      }), t('llmProviders.errors.test'));
      setTestResult(payload.result);
    } catch (err) {
      setError(err.message || t('llmProviders.errors.test'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm md:p-6">
      <form onSubmit={save} className="flex max-h-[92vh] w-full max-w-3xl flex-col border border-border bg-background shadow-2xl">
        <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-border px-5">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{editing ? t('llmProviders.editTitle') : t('llmProviders.addTitle')}</h3>
            {provider?.hasApiKey && <p className="text-[11px] text-muted-foreground">{t('llmProviders.savedKey', { last4: provider.apiKeyLast4 })}</p>}
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {!editing && (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground">{t('llmProviders.fields.preset')}</span>
              <select value={form.presetId} onChange={(event) => selectPreset(event.target.value)} className="h-10 w-full border border-border bg-background px-3 text-sm text-foreground">
                {selectablePresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              </select>
            </label>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">{t('llmProviders.fields.name')}</span>
              <input value={form.name} onChange={(event) => update('name', event.target.value)} className="h-10 w-full border border-border bg-background px-3 text-sm text-foreground" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">{t('llmProviders.fields.apiKey')}</span>
              <input type="password" value={form.apiKey} onChange={(event) => update('apiKey', event.target.value)} placeholder={editing && provider.hasApiKey ? t('llmProviders.keepSavedKey') : 'sk-...'} className="h-10 w-full border border-border bg-background px-3 font-mono text-sm text-foreground" />
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-foreground">{t('llmProviders.fields.baseUrl')}</span>
            <input value={form.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} placeholder="https://api.example.com" className="h-10 w-full border border-border bg-background px-3 font-mono text-sm text-foreground" />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">{t('llmProviders.fields.apiFormat')}</span>
              <select value={form.apiFormat} onChange={(event) => update('apiFormat', event.target.value)} className="h-10 w-full border border-border bg-background px-3 text-sm text-foreground">
                <option value="anthropic">Anthropic Messages</option>
                <option value="openai_chat">OpenAI Chat Completions</option>
                <option value="openai_responses">OpenAI Responses</option>
                <option value="azure_openai_responses">Azure OpenAI Responses</option>
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-foreground">{t('llmProviders.fields.authStrategy')}</span>
              <select value={form.authStrategy} onChange={(event) => update('authStrategy', event.target.value)} className="h-10 w-full border border-border bg-background px-3 text-sm text-foreground">
                <option value="api_key">API key</option>
                <option value="auth_token">Bearer token</option>
                <option value="auth_token_empty_api_key">Bearer + empty x-api-key</option>
                <option value="dual_same_token">Bearer + x-api-key</option>
                <option value="dual_dummy">Dummy credentials</option>
                <option value="azure_api_key">Azure api-key</option>
              </select>
            </label>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-foreground">{t('llmProviders.fields.models')}</p>
            <div className="grid gap-3 md:grid-cols-2">
              {MODEL_SLOTS.map((slot) => (
                <label key={slot} className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{slot}</span>
                  <input value={form.models[slot]} onChange={(event) => updateNested('models', slot, event.target.value)} className="h-9 w-full border border-border bg-background px-3 font-mono text-xs text-foreground" />
                </label>
              ))}
            </div>
          </div>

          <button type="button" onClick={() => setAdvanced((value) => !value)} className="flex w-full items-center justify-between border-y border-border py-3 text-xs font-medium text-foreground">
            {t('llmProviders.advanced')}
            {advanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {advanced && (
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-xs font-medium text-foreground">{t('llmProviders.oneMillion')}</p>
                <div className="flex flex-wrap gap-4">
                  {MODEL_SLOTS.map((slot) => (
                    <label key={slot} className="flex items-center gap-2 text-xs text-foreground">
                      <input type="checkbox" checked={form.model1mSupport[slot]} onChange={(event) => updateNested('model1mSupport', slot, event.target.checked)} />
                      {slot}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-foreground">{t('llmProviders.contextWindows')}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {MODEL_SLOTS.map((slot) => (
                    <label key={slot} className="space-y-1">
                      <span className="text-[11px] uppercase text-muted-foreground">{slot}</span>
                      <input type="number" min="16000" max="10000000" value={form.contextWindows[slot]} onChange={(event) => updateNested('contextWindows', slot, event.target.value)} placeholder="200000" className="h-9 w-full border border-border bg-background px-3 text-xs text-foreground" />
                    </label>
                  ))}
                </div>
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-foreground">{t('llmProviders.autoCompact')}</span>
                <input type="number" min="16000" max="10000000" value={form.autoCompactWindow} onChange={(event) => update('autoCompactWindow', event.target.value)} placeholder="200000" className="h-9 w-full border border-border bg-background px-3 text-sm text-foreground" />
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-foreground"><input type="checkbox" checked={form.toolSearchEnabled} onChange={(event) => update('toolSearchEnabled', event.target.checked)} />{t('llmProviders.toolSearch')}</label>
                <label className="flex items-center gap-2 text-xs text-foreground"><input type="checkbox" checked={form.disableExperimentalBetas} onChange={(event) => update('disableExperimentalBetas', event.target.checked)} />{t('llmProviders.disableBetas')}</label>
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-foreground">{t('llmProviders.fields.notes')}</span>
                <textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} rows={3} className="w-full border border-border bg-background p-3 text-sm text-foreground" />
              </label>
            </div>
          )}

          {error && <div className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}
          <ResultLine result={testResult} t={t} />
        </div>

        <footer className="flex flex-shrink-0 items-center justify-between border-t border-border px-5 py-3">
          <button type="button" onClick={() => void test()} disabled={testing || saving} className="flex h-9 items-center gap-2 border border-border px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}{t('llmProviders.actions.test')}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-9 px-4 text-xs text-muted-foreground">{t('llmProviders.actions.cancel')}</button>
            <button type="submit" disabled={saving || testing} className="flex h-9 items-center gap-2 bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-40">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}{t('llmProviders.actions.save')}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

export default function LlmProvidersContent() {
  const { t } = useTranslation('settings');
  const [payload, setPayload] = useState({ providers: [], builtIns: [], activeId: null, providerOrder: [] });
  const [presets, setPresets] = useState([]);
  const [oauth, setOauth] = useState({ openai: { loggedIn: false }, grok: { loggedIn: false } });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [results, setResults] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showCloud, setShowCloud] = useState(false);
  const [settingsJson, setSettingsJson] = useState('{\n  "env": {}\n}');
  const [oauthPolling, setOauthPolling] = useState('');

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const [providersResponse, presetsResponse, openaiResponse, grokResponse, settingsResponse] = await Promise.all([
        api.providers.list(),
        api.providers.presets(),
        api.providers.oauthStatus('openai'),
        api.providers.oauthStatus('grok'),
        api.providers.settings(),
      ]);
      const [providersData, presetsData, openaiData, grokData, settingsData] = await Promise.all([
        responseJson(providersResponse, t('llmProviders.errors.load')),
        responseJson(presetsResponse, t('llmProviders.errors.load')),
        responseJson(openaiResponse, t('llmProviders.errors.load')),
        responseJson(grokResponse, t('llmProviders.errors.load')),
        responseJson(settingsResponse, t('llmProviders.errors.load')),
      ]);
      setPayload(providersData);
      setPresets(presetsData.presets || []);
      setOauth({ openai: openaiData, grok: grokData });
      setSettingsJson(JSON.stringify(settingsData || { env: {} }, null, 2));
      if (openaiData.loggedIn && oauthPolling === 'openai') setOauthPolling('');
      if (grokData.loggedIn && oauthPolling === 'grok') setOauthPolling('');
    } catch (err) {
      setError(err.message || t('llmProviders.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [oauthPolling, t]);

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!oauthPolling) return undefined;
    const timer = window.setInterval(() => void load({ quiet: true }), 1500);
    const stop = window.setTimeout(() => setOauthPolling(''), 120000);
    return () => { window.clearInterval(timer); window.clearTimeout(stop); };
  }, [oauthPolling, load]);

  const items = useMemo(() => normalizeProviderItems(payload), [payload]);
  const activeId = payload.activeId || 'claude-official';

  const run = async (key, action, successMessage = '') => {
    setBusy(key);
    setError('');
    setMessage('');
    try {
      await action();
      if (successMessage) setMessage(successMessage);
      await load({ quiet: true });
    } catch (err) {
      setError(err.message || t('llmProviders.errors.action'));
    } finally {
      setBusy('');
    }
  };

  const activate = (id) => run(`activate:${id}`, async () => {
    const response = id === 'claude-official' ? await api.providers.activateOfficial() : await api.providers.activate(id);
    await responseJson(response, t('llmProviders.errors.activate'));
  }, t('llmProviders.messages.activated'));

  const testProvider = (id) => run(`test:${id}`, async () => {
    const data = await responseJson(await api.providers.testSaved(id), t('llmProviders.errors.test'));
    setResults((current) => ({ ...current, [id]: data.result }));
  });

  const remove = (provider) => {
    if (!window.confirm(t('llmProviders.confirmDelete', { name: provider.name }))) return;
    void run(`delete:${provider.id}`, async () => {
      await responseJson(await api.providers.delete(provider.id), t('llmProviders.errors.delete'));
    }, t('llmProviders.messages.deleted'));
  };

  const move = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const orderedIds = items.map((item) => item.id);
    [orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]];
    void run('reorder', async () => {
      await responseJson(await api.providers.reorder(orderedIds), t('llmProviders.errors.reorder'));
    });
  };

  const startOAuth = (providerName) => run(`oauth:${providerName}`, async () => {
    const data = await responseJson(await api.providers.startOAuth(providerName), t('llmProviders.errors.oauth'));
    const opened = window.open('about:blank', '_blank');
    if (opened) {
      opened.opener = null;
      opened.location.href = data.authorizeUrl;
    } else {
      window.location.assign(data.authorizeUrl);
    }
    setOauthPolling(providerName);
    setMessage(t('llmProviders.messages.oauthStarted'));
  });

  const logoutOAuth = (providerName) => run(`oauth:${providerName}`, async () => {
    await responseJson(await api.providers.logoutOAuth(providerName), t('llmProviders.errors.oauth'));
  }, t('llmProviders.messages.loggedOut'));

  const saveCloudSettings = () => run('cloud', async () => {
    let parsed;
    try { parsed = JSON.parse(settingsJson); } catch { throw new Error(t('llmProviders.errors.invalidJson')); }
    await responseJson(await api.providers.updateSettings(parsed), t('llmProviders.errors.saveSettings'));
  }, t('llmProviders.messages.settingsSaved'));

  if (loading && items.length === 0) {
    return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('llmProviders.loading')}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-medium text-foreground"><Server className="h-5 w-5 text-primary" />{t('llmProviders.title')}</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('llmProviders.description')}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => void load()} className="flex h-9 items-center gap-2 border border-border px-3 text-xs text-foreground hover:bg-muted"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />{t('llmProviders.actions.refresh')}</button>
          <button type="button" onClick={() => { setEditing(null); setShowForm(true); }} className="flex h-9 items-center gap-2 bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="h-4 w-4" />{t('llmProviders.actions.add')}</button>
        </div>
      </div>

      {message && <div className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">{message}</div>}
      {error && <div className="border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}

      <div className="space-y-2">
        {items.map((provider, index) => {
          const isActive = activeId === provider.id;
          const oauthName = provider.id === 'openai-official' ? 'openai' : provider.id === 'grok-official' ? 'grok' : '';
          const oauthStatus = oauthName ? oauth[oauthName] : null;
          return (
            <section key={provider.id} className={`border p-4 ${isActive ? 'border-primary bg-primary/5' : 'border-border bg-background'}`}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`} />
                    <h4 className="text-sm font-semibold text-foreground">{provider.name}</h4>
                    {provider.builtIn && <span className="bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">{t('llmProviders.builtin')}</span>}
                    {isActive && <span className="bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">{t('llmProviders.active')}</span>}
                    {provider.hasApiKey && <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><KeyRound className="h-3 w-3" />•••• {provider.apiKeyLast4}</span>}
                    {oauthStatus?.loggedIn && <span className="text-[10px] text-emerald-600 dark:text-emerald-400">{t('llmProviders.loggedIn')}{oauthStatus.email ? ` · ${oauthStatus.email}` : ''}</span>}
                  </div>
                  <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                    {provider.baseUrl || t('llmProviders.officialEndpoint')}
                    {provider.models?.main ? ` · ${provider.models.main}` : ''}
                    {provider.apiFormat && provider.apiFormat !== 'anthropic' ? ` · ${provider.apiFormat}` : ''}
                  </p>
                  <ResultLine result={results[provider.id]} t={t} />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" aria-label={t('llmProviders.actions.moveUp')} onClick={() => move(index, -1)} disabled={index === 0 || busy === 'reorder'} className="grid h-8 w-8 place-items-center border border-border text-muted-foreground disabled:opacity-25"><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label={t('llmProviders.actions.moveDown')} onClick={() => move(index, 1)} disabled={index === items.length - 1 || busy === 'reorder'} className="grid h-8 w-8 place-items-center border border-border text-muted-foreground disabled:opacity-25"><ArrowDown className="h-3.5 w-3.5" /></button>
                  {oauthName && !oauthStatus?.loggedIn && (
                    <button type="button" onClick={() => void startOAuth(oauthName)} disabled={busy === `oauth:${oauthName}`} className="flex h-8 items-center gap-1.5 border border-border px-2.5 text-xs text-foreground"><LogIn className="h-3.5 w-3.5" />{t('llmProviders.actions.login')}</button>
                  )}
                  {oauthName && oauthStatus?.loggedIn && (
                    <button type="button" onClick={() => void logoutOAuth(oauthName)} disabled={busy === `oauth:${oauthName}`} className="flex h-8 items-center gap-1.5 border border-border px-2.5 text-xs text-foreground"><LogOut className="h-3.5 w-3.5" />{t('llmProviders.actions.logout')}</button>
                  )}
                  {!isActive && <button type="button" onClick={() => void activate(provider.id)} disabled={busy === `activate:${provider.id}`} className="flex h-8 items-center gap-1.5 border border-border px-2.5 text-xs text-foreground"><Check className="h-3.5 w-3.5" />{t('llmProviders.actions.activate')}</button>}
                  {provider.id !== 'claude-official' && <button type="button" onClick={() => void testProvider(provider.id)} disabled={busy === `test:${provider.id}`} className="flex h-8 items-center gap-1.5 border border-border px-2.5 text-xs text-foreground">{busy === `test:${provider.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}{t('llmProviders.actions.test')}</button>}
                  {!provider.builtIn && <button type="button" onClick={() => { setEditing(provider); setShowForm(true); }} className="grid h-8 w-8 place-items-center border border-border text-muted-foreground"><Pencil className="h-3.5 w-3.5" /></button>}
                  {!provider.builtIn && !isActive && <button type="button" onClick={() => remove(provider)} className="grid h-8 w-8 place-items-center border border-red-300 text-red-600 dark:border-red-900 dark:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <section className="border border-border">
        <button type="button" onClick={() => setShowCloud((value) => !value)} className="flex w-full items-center justify-between p-4 text-left">
          <span><span className="block text-sm font-medium text-foreground">{t('llmProviders.cloudTitle')}</span><span className="mt-1 block text-xs text-muted-foreground">{t('llmProviders.cloudDescription')}</span></span>
          {showCloud ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showCloud && (
          <div className="space-y-3 border-t border-border p-4">
            <p className="text-xs text-muted-foreground">{t('llmProviders.cloudHelp')}</p>
            <textarea value={settingsJson} onChange={(event) => setSettingsJson(event.target.value)} rows={12} spellCheck={false} className="w-full border border-border bg-muted/30 p-3 font-mono text-xs text-foreground" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Bedrock / Vertex AI / Microsoft Foundry</span>
              <button type="button" onClick={() => void saveCloudSettings()} disabled={busy === 'cloud'} className="flex h-9 items-center gap-2 bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-40">{busy === 'cloud' && <Loader2 className="h-4 w-4 animate-spin" />}{t('llmProviders.actions.saveSettings')}</button>
            </div>
          </div>
        )}
      </section>

      {showForm && <ProviderForm provider={editing} presets={presets} onClose={() => { setShowForm(false); setEditing(null); }} onSaved={() => load({ quiet: true })} />}
    </div>
  );
}
