import { useEffect, useState } from 'react';
import { Check, ChevronUp, Folder, FolderOpen, Loader2, MapPin, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';

export default function ProjectLocationContent() {
  const { t } = useTranslation('settings');
  const [location, setLocation] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserPath, setBrowserPath] = useState('');
  const [browserParent, setBrowserParent] = useState(null);
  const [browserFolders, setBrowserFolders] = useState([]);
  const [browserError, setBrowserError] = useState('');

  const loadLocation = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.getWorkspaceRoot();
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('projectLocation.errors.load'));
      const nextLocation = data.path || data.defaultPath || '';
      setLocation(nextLocation);
      setDraft(nextLocation);
    } catch (loadError) {
      setError(loadError.message || t('projectLocation.errors.load'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLocation();
  }, []);

  const loadFolders = async (path = null) => {
    setBrowserLoading(true);
    setBrowserError('');
    try {
      const response = await api.browseFilesystem(path, { selectDefaultLocation: true });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('projectLocation.errors.browse'));
      setBrowserPath(data.path || path || '');
      setBrowserParent(data.parentPath || null);
      setBrowserFolders(Array.isArray(data.suggestions) ? data.suggestions : []);
    } catch (browseError) {
      setBrowserError(browseError.message || t('projectLocation.errors.browse'));
    } finally {
      setBrowserLoading(false);
    }
  };

  const openBrowser = () => {
    setBrowserOpen(true);
    void loadFolders(draft || location || null);
  };

  const saveLocation = async () => {
    const nextPath = draft.trim();
    if (!nextPath || saving) return;
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const response = await api.setWorkspaceRoot(nextPath);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || t('projectLocation.errors.save'));
      const resolvedLocation = data.path || nextPath;
      setLocation(resolvedLocation);
      setDraft(resolvedLocation);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (saveError) {
      setError(saveError.message || t('projectLocation.errors.save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">{t('projectLocation.title')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('projectLocation.description')}</p>
      </div>

      <div className="border border-primary/35 bg-primary/[0.04] p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 flex-none place-items-center bg-primary/10 text-primary">
            <MapPin className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{t('projectLocation.defaultLabel')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('projectLocation.defaultHelp')}</p>
              </div>
              <span className="flex items-center gap-1 text-xs font-medium text-primary">
                <Check className="h-3.5 w-3.5" /> {t('projectLocation.selected')}
              </span>
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setSaved(false);
                  setError('');
                }}
                disabled={loading || saving}
                aria-label={t('projectLocation.defaultLabel')}
                className="h-10 min-w-0 flex-1 border border-border bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-primary disabled:opacity-50"
                placeholder="~/medautodata"
              />
              <button
                type="button"
                onClick={openBrowser}
                disabled={loading || saving}
                className="flex h-10 items-center justify-center gap-2 border border-border px-3 text-xs font-medium text-foreground hover:border-primary/50 hover:text-primary disabled:opacity-50"
              >
                <FolderOpen className="h-4 w-4" /> {t('projectLocation.browse')}
              </button>
              <button
                type="button"
                onClick={() => void saveLocation()}
                disabled={loading || saving || !draft.trim() || draft.trim() === location}
                className="flex h-10 items-center justify-center gap-2 bg-primary/90 px-4 text-xs font-medium text-primary-foreground hover:bg-primary disabled:opacity-40"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? t('projectLocation.saving') : t('projectLocation.save')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs leading-5 text-muted-foreground">{t('projectLocation.noUserFolders')}</p>
      {loading && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t('projectLocation.loading')}</p>}
      {saved && <p className="flex items-center gap-1.5 text-xs text-primary"><Check className="h-4 w-4" /> {t('projectLocation.saved')}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {browserOpen && (
        <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="flex h-[70vh] w-full max-w-xl flex-col overflow-hidden border border-border bg-background shadow-xl">
            <header className="flex h-14 items-center justify-between border-b border-border px-4">
              <div>
                <p className="text-sm font-semibold text-foreground">{t('projectLocation.browser.title')}</p>
                <p className="max-w-[420px] truncate font-mono text-[11px] text-muted-foreground">{browserPath}</p>
              </div>
              <button type="button" onClick={() => setBrowserOpen(false)} className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex items-center gap-2 border-b border-border p-3">
              <button
                type="button"
                onClick={() => browserParent && void loadFolders(browserParent)}
                disabled={!browserParent || browserLoading}
                className="flex h-8 items-center gap-1.5 border border-border px-2.5 text-xs text-foreground disabled:opacity-35"
              >
                <ChevronUp className="h-4 w-4" /> {t('projectLocation.browser.up')}
              </button>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{browserPath}</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {browserLoading ? (
                <div className="grid min-h-44 place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : browserFolders.length ? (
                <div className="divide-y divide-border">
                  {browserFolders.map((folder) => (
                    <button
                      key={folder.path}
                      type="button"
                      onClick={() => void loadFolders(folder.path)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-primary/5"
                    >
                      <Folder className="h-4 w-4 flex-none text-primary/75" />
                      <span className="truncate text-sm text-foreground">{folder.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid min-h-44 place-items-center text-xs text-muted-foreground">{t('projectLocation.browser.empty')}</div>
              )}
              {browserError && <p className="p-3 text-xs text-destructive">{browserError}</p>}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-border p-3">
              <button type="button" onClick={() => setBrowserOpen(false)} className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground">
                {t('projectLocation.browser.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(browserPath);
                  setBrowserOpen(false);
                  setError('');
                }}
                disabled={!browserPath || browserLoading}
                className="h-9 bg-primary/90 px-4 text-xs font-medium text-primary-foreground hover:bg-primary disabled:opacity-40"
              >
                {t('projectLocation.browser.choose')}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
