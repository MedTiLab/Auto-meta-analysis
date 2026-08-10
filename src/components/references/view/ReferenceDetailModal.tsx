import { useTranslation } from 'react-i18next';
import { X, ExternalLink, FileText, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import type { ProjectReference } from '../types';
import { formatAuthors, formatReferenceContext } from '../types';

interface ReferenceDetailModalProps {
  reference: ProjectReference;
  onClose: () => void;
  onAddToChat?: (ref: ProjectReference) => void;
}

export default function ReferenceDetailModal({
  reference,
  onClose,
  onAddToChat,
}: ReferenceDetailModalProps) {
  const { t } = useTranslation('references');
  const [copied, setCopied] = useState(false);
  const authorLine = formatAuthors(reference.authors, 10);
  const sourceLabel = t(`sources.${reference.source}`, {
    defaultValue: String(reference.source || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase()),
  });
  const metadata = [
    { label: t('detail.authors'), value: authorLine || '—' },
    { label: t('detail.year'), value: reference.year ? String(reference.year) : '—' },
    { label: t('detail.journal'), value: reference.journal || '—' },
    { label: t('detail.type'), value: reference.item_type || '—', capitalize: true },
    { label: t('detail.sourceLabel'), value: sourceLabel || '—' },
    { label: t('detail.citationKey'), value: reference.citation_key || '—' },
    { label: t('detail.projectPath'), value: reference.local_relative_path || reference.local_artifact_dir || '—' },
  ];

  const handleCopyContext = async () => {
    try {
      await navigator.clipboard.writeText(formatReferenceContext(reference));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard write failed — do not show "Copied"
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative mx-4 max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-slate-200/80 bg-background shadow-2xl dark:border-slate-800/80"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-lg p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="relative overflow-hidden border-b border-slate-200/70 bg-[linear-gradient(135deg,rgba(248,250,252,0.98),rgba(240,249,255,0.94)_44%,rgba(236,253,245,0.76))] px-6 pb-6 pt-6 dark:border-slate-800/70 dark:bg-[linear-gradient(135deg,rgba(2,6,23,0.98),rgba(15,23,42,0.96)_50%,rgba(6,78,59,0.24))]">
          <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-cyan-400 via-sky-500 to-teal-500 dark:from-cyan-500 dark:via-sky-500 dark:to-teal-500" />
          <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-cyan-200/40 blur-3xl dark:bg-cyan-500/10" />

          <div className="relative pr-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/80 bg-white/85 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-cyan-800 shadow-sm dark:border-cyan-900/70 dark:bg-slate-950/55 dark:text-cyan-200">
              <FileText className="h-3.5 w-3.5" />
              {t('detail.profileTitle')}
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">{reference.title}</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{authorLine || '—'}</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {metadata.map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-slate-200/80 bg-white/82 p-3 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/55"
                >
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                  <p className={`mt-1 text-sm font-medium text-foreground ${item.capitalize ? 'capitalize' : ''}`}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5 px-6 py-6">
          <div className="flex flex-wrap gap-1.5">
            {reference.year && <Badge variant="secondary" className="rounded-full border border-slate-200/80 bg-slate-100/80 text-slate-700 dark:border-slate-800/80 dark:bg-slate-900/70 dark:text-slate-200">{reference.year}</Badge>}
            {reference.journal && <Badge variant="outline" className="rounded-full border-cyan-200/80 bg-cyan-50/80 text-cyan-800 dark:border-cyan-900/70 dark:bg-cyan-950/40 dark:text-cyan-200">{reference.journal}</Badge>}
            <Badge variant="outline" className="rounded-full border-blue-200/80 bg-blue-50/80 capitalize text-blue-800 dark:border-blue-900/70 dark:bg-blue-950/40 dark:text-blue-200">{reference.item_type}</Badge>
            <Badge variant="outline" className="rounded-full border-teal-200/80 bg-teal-50/80 text-teal-800 dark:border-teal-900/70 dark:bg-teal-950/40 dark:text-teal-200">{sourceLabel}</Badge>
            {reference.project_linked ? <Badge variant="secondary" className="rounded-full">{t('badges.projectLinked')}</Badge> : null}
            {reference.has_local_artifact ? <Badge variant="outline" className="rounded-full">{t('badges.localArtifact')}</Badge> : null}
          </div>

          {reference.abstract && (
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/85 p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/55">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('detail.abstract')}
              </span>
              <p className="mt-2 text-sm leading-7 text-foreground">{reference.abstract}</p>
            </div>
          )}

          {reference.keywords.length > 0 && (
            <div className="rounded-xl border border-slate-200/80 bg-white/82 p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/55">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('detail.keywords')}
              </span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {reference.keywords.map((kw) => (
                  <Badge key={kw} variant="secondary" className="rounded-full border border-cyan-200/80 bg-cyan-50/80 text-[10px] text-cyan-800 dark:border-cyan-900/70 dark:bg-cyan-950/40 dark:text-cyan-200">{kw}</Badge>
                ))}
              </div>
            </div>
          )}

          {(reference.doi || reference.url) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {reference.doi && (
                <div className="rounded-xl border border-slate-200/80 bg-white/82 p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/55">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('detail.doiLabel')}</span>
                  <a
                    href={`https://doi.org/${reference.doi}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 flex items-center gap-1 text-sm text-cyan-700 hover:underline dark:text-cyan-300"
                  >
                    {reference.doi}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}

              {reference.url && (
                <div className="rounded-xl border border-slate-200/80 bg-white/82 p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/55">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('detail.sourceLink')}</span>
                  <a
                    href={reference.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-sm text-cyan-700 hover:underline dark:text-cyan-300"
                  >
                    {t('detail.viewSource')}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-200/70 px-6 py-4 dark:border-slate-800/70">
          {onAddToChat && (
            <Button size="sm" className="rounded-lg bg-cyan-700 hover:bg-cyan-800" onClick={() => onAddToChat(reference)}>
              {t('actions.addToChat')}
            </Button>
          )}
          <Button size="sm" variant="outline" className="rounded-lg" onClick={handleCopyContext}>
            {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
            {copied ? t('actions.copied') : t('actions.copyContext')}
          </Button>
          <Button size="sm" variant="ghost" className="rounded-lg" onClick={onClose}>
            {t('actions.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
