import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Upload, RefreshCw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '../../ui/button';
import { useReferenceImport } from '../hooks/useReferenceImport';
import ZoteroBrowser from './ZoteroBrowser';
import type { ZoteroStatus } from '../types';

interface ImportDialogProps {
  zoteroStatus: ZoteroStatus | null;
  projectName?: string;
  onRefreshZoteroStatus?: () => Promise<ZoteroStatus | null | undefined>;
  onClose: () => void;
  onComplete: () => void;
}

export default function ImportDialog({
  zoteroStatus,
  projectName,
  onRefreshZoteroStatus,
  onClose,
  onComplete,
}: ImportDialogProps) {
  const { t } = useTranslation('references');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [statusRefreshing, setStatusRefreshing] = useState(false);
  const { importing, importResult, error, importBibtex, clearResults } = useReferenceImport(projectName, onComplete);

  const handleRefreshZoteroStatus = async () => {
    if (!onRefreshZoteroStatus) return;
    setStatusRefreshing(true);
    try {
      await onRefreshZoteroStatus();
    } finally {
      setStatusRefreshing(false);
    }
  };

  useEffect(() => {
    clearResults();
    handleRefreshZoteroStatus().catch(() => {});
    // clearResults and onRefreshZoteroStatus are stable hook outputs in this flow
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileSelect = async (file: File) => {
    setLocalError(null);
    if (!file.name.endsWith('.bib') && !file.name.endsWith('.bibtex')) {
      setLocalError(t('import.invalidFileType'));
      return;
    }
    try {
      await importBibtex(file);
    } catch {
      // error is set in state
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const zoteroStatusText = zoteroStatus === null
    ? t('import.zoteroChecking')
    : zoteroStatus.connected
      ? t('import.zoteroConnected')
      : zoteroStatus.localApiDisabled
        ? t('import.zoteroApiDisabled')
        : t('import.zoteroNotRunning');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative mx-4 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>

        {showBrowser ? (
          <ZoteroBrowser
            projectName={projectName}
            onClose={() => setShowBrowser(false)}
            onImportComplete={() => {
              setShowBrowser(false);
              onComplete();
            }}
          />
        ) : (
          <>
            <h2 className="text-lg font-semibold text-foreground">{t('import.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('import.description')}</p>

            {/* Zotero folder import */}
            <div className="mt-6 rounded-xl border border-border/50 p-4">
              <div className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-medium text-foreground">{t('import.zoteroFolderImport')}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{zoteroStatusText}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {t('import.zoteroFolderDescription')}
                  </p>
                  {zoteroStatus?.detail ? (
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground/80">
                      {zoteroStatus.detail}
                    </p>
                  ) : null}
                  {zoteroStatus?.endpoint ? (
                    <p className="mt-1 text-[11px] font-mono text-muted-foreground/70">
                      {zoteroStatus.endpoint}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => { handleRefreshZoteroStatus().catch(() => {}); }}
                    disabled={statusRefreshing}
                  >
                    {statusRefreshing ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    )}
                    {t('import.refreshStatus')}
                  </Button>
                  {zoteroStatus?.connected && (
                    <Button
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => setShowBrowser(true)}
                    >
                      {t('import.chooseZoteroFolder')}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* BibTeX Import */}
            <div className="mt-4 rounded-xl border border-border/50 p-4">
              <h3 className="text-sm font-medium text-foreground">{t('import.bibtexImport')}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('import.bibtexDescription')}</p>

              <div
                className={`mt-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                  dragOver
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border/60 hover:border-border'
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <Upload className="mx-auto h-8 w-8 text-muted-foreground/60" />
                <p className="mt-2 text-sm text-muted-foreground">{t('import.dropBibtex')}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                >
                  {importing ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {t('import.browseFile')}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".bib,.bibtex"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                />
              </div>
              {importResult && (
                <div className="mt-3 flex items-center gap-2 text-sm text-primary">
                  <CheckCircle className="h-4 w-4" />
                  {t('import.importSuccess', { count: importResult.imported })}
                </div>
              )}
            </div>

            {(error || localError) && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-muted/35 px-3 py-2 text-sm text-foreground">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {localError || error}
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <Button variant="ghost" onClick={onClose}>
                {t('actions.close')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
