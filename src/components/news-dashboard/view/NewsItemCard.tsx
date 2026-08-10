import {
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  FlaskConical,
  Languages,
  Loader2,
  Star,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Project } from '../../../types/app';
import { api } from '../../../utils/api';
import type { ChatPromptDraft } from '../../../utils/chatPromptDraft';
import type { NewsSourceKey } from './useNewsDashboardData';

export type NewsItem = {
  id: string;
  title: string;
  authors: string;
  abstract: string;
  published: string;
  categories: string[];
  relevance_score: number;
  recency_score: number;
  popularity_score: number;
  quality_score: number;
  final_score: number;
  matched_domain: string;
  matched_keywords: string[];
  link?: string;
  pdf_link?: string;
  source?: string;
};

export type NewsItemCardVariant = 'list' | 'card';

function isSignalSource(sourceKey: NewsSourceKey) {
  return sourceKey === 'xiaohongshu';
}

function ScoreBar({ label, score, max = 3, barClass, dotClass }: { label: string; score: number; max?: number; barClass: string; dotClass: string }) {
  const pct = Math.min(100, (score / max) * 100);
  return (
    <div className="flex items-center gap-2.5 text-xs">
      <span className="flex items-center gap-1.5 w-[6.25rem] text-muted-foreground">
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        {label}
      </span>
      <div className="flex-1 h-[5px] rounded-full bg-muted/60 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-medium tabular-nums text-foreground/70">{score.toFixed(1)}</span>
    </div>
  );
}

function buildResearchPrompt(item: NewsItem, sourceKey: NewsSourceKey) {
  const signalSource = isSignalSource(sourceKey);
  const lines: string[] = [
    signalSource
      ? 'Please help me turn this newly discovered research signal into actionable context for the current project.'
      : 'Please help me turn this newly discovered paper into an actionable research entry for the current project.',
    signalSource
      ? 'Use the attached News Context as the primary source context, and treat this item as a secondary research note rather than a formal paper citation.'
      : 'Use the attached News Context as the primary citation context, and incorporate the newly added seed-paper / knowledge-base entry when framing the answer.',
    '',
    'Tasks:',
    signalSource
      ? '1. Summarize the core claim, takeaway, or method discussed in this item.'
      : '1. Summarize the core problem the paper addresses.',
    signalSource
      ? '2. Identify which parts should be verified against formal papers or datasets before we rely on it.'
      : '2. Propose 3-5 follow-up research questions grounded in this paper.',
    signalSource
      ? '3. Explain how this signal could inform our current project or pipeline.'
      : '3. Explain how this paper could inform our current project or pipeline.',
    '4. Suggest whether it belongs primarily in Literature, Ideation, or Experiment.',
    signalSource
      ? '5. Draft a short structured note capturing the useful signal, caveats, and next validation steps.'
      : '5. Draft a short structured note that could be saved under Literature/reports/ or attached to the research brief.',
    '',
    signalSource ? '[Research Signal Context]' : '[Paper Context]',
    `Source: ${sourceKey}`,
    `Title: ${item.title}`,
  ];

  if (item.authors) {
    lines.push(`Authors: ${item.authors}`);
  }
  if (item.published) {
    lines.push(`Published: ${item.published}`);
  }
  if (item.categories?.length) {
    lines.push(`Categories: ${item.categories.join(', ')}`);
  }
  if (item.matched_domain) {
    lines.push(`Matched domain: ${item.matched_domain}`);
  }
  if (item.matched_keywords?.length) {
    lines.push(`Matched keywords: ${item.matched_keywords.join(', ')}`);
  }
  if (item.link) {
    lines.push(`URL: ${item.link}`);
  }
  if (item.pdf_link) {
    lines.push(`PDF: ${item.pdf_link}`);
  }
  if (item.abstract) {
    lines.push('', 'Abstract:', item.abstract);
  }

  return lines.join('\n');
}

function buildNewsAttachedPrompt(
  item: NewsItem,
  sourceKey: NewsSourceKey,
  ingestResult?: {
    relativePath?: string;
    briefPath?: string;
    seedPaperCitation?: string;
  } | null,
) {
  const signalSource = isSignalSource(sourceKey);
  const lines: string[] = [signalSource ? '[News Signal Context]' : '[News Context]'];
  lines.push(`Source: ${sourceKey}`);
  lines.push(`Title: ${item.title}`);

  if (item.authors) {
    lines.push(`Authors: ${item.authors}`);
  }
  if (item.published) {
    lines.push(`Published: ${item.published}`);
  }
  if (item.link) {
    lines.push(`URL: ${item.link}`);
  }
  if (item.pdf_link) {
    lines.push(`PDF: ${item.pdf_link}`);
  }
  if (item.matched_domain) {
    lines.push(`Matched domain: ${item.matched_domain}`);
  }
  if (item.matched_keywords?.length) {
    lines.push(`Matched keywords: ${item.matched_keywords.join(', ')}`);
  }
  if (ingestResult?.seedPaperCitation) {
    lines.push(`Seed paper entry: ${ingestResult.seedPaperCitation}`);
  }
  if (ingestResult?.briefPath) {
    lines.push(`Research brief path: ${ingestResult.briefPath}`);
  }
  if (ingestResult?.relativePath) {
    lines.push(`Knowledge base note: ${ingestResult.relativePath}`);
  }
  if (item.abstract) {
    lines.push('', 'Abstract:', item.abstract);
  }

  return {
    scenarioId: signalSource ? 'news-signal-context' : 'news-paper-context',
    scenarioIcon: '📰',
    scenarioTitle: signalSource ? 'News Signal Context' : 'News Paper Context',
    promptText: lines.join('\n'),
  };
}

export default function NewsItemCard({
  item,
  index,
  sourceKey,
  variant = 'list',
  chatTargetProject,
  onStartResearchPrompt,
}: {
  item: NewsItem;
  index: number;
  sourceKey: NewsSourceKey;
  variant?: NewsItemCardVariant;
  chatTargetProject?: Project | null;
  onStartResearchPrompt?: (project: Project, prompt: string | ChatPromptDraft) => void;
}) {
  const { t } = useTranslation('news');
  const [expanded, setExpanded] = useState(false);
  const [isStartingResearch, setIsStartingResearch] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translatedTitle, setTranslatedTitle] = useState('');
  const [translatedAbstract, setTranslatedAbstract] = useState('');
  const [translationError, setTranslationError] = useState('');

  const isTopItem = index < 3;
  const accentClass = isTopItem
    ? 'bg-emerald-600 dark:bg-emerald-400'
    : 'bg-slate-300 dark:bg-slate-700';

  const arxivId = item.id?.replace(/^https?:\/\/arxiv\.org\/abs\//, '') ?? '';
  const primaryUrl =
    item.link ||
    (sourceKey === 'arxiv'
      ? `https://arxiv.org/abs/${arxivId}`
      : sourceKey === 'pubmed'
        ? `https://pubmed.ncbi.nlm.nih.gov/${item.id}/`
        : '#');
  const pdfUrl = item.pdf_link || (sourceKey === 'arxiv' ? `https://arxiv.org/pdf/${arxivId}` : null);
  const sourceBadgeLabel = t(`sources.${sourceKey}`);
  const canStartResearch = Boolean(chatTargetProject && onStartResearchPrompt);
  const displayTitle = showTranslation && translatedTitle ? translatedTitle : item.title;
  const displayAbstract = showTranslation && translatedAbstract ? translatedAbstract : item.abstract;

  const handleStartResearch = async () => {
    if (!chatTargetProject || !onStartResearchPrompt) {
      return;
    }

    setIsStartingResearch(true);
    let ingestResult = null;

    try {
      if (!isSignalSource(sourceKey)) {
        const response = await api.taskmaster.ingestNewsItem(chatTargetProject.name, {
          item,
          sourceKey,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
        }

        ingestResult = await response.json();
        if (typeof window !== 'undefined' && ingestResult?.literatureReferenceId) {
          window.dispatchEvent(
            new CustomEvent('references-library-updated', {
              detail: {
                projectName: chatTargetProject.name,
                referenceId: ingestResult.literatureReferenceId,
              },
            }),
          );
        }
      }
    } catch (error) {
      console.error('Failed to prepare news item for project analysis:', error);
    } finally {
      setIsStartingResearch(false);
    }

    onStartResearchPrompt(chatTargetProject, {
      input: buildResearchPrompt(item, sourceKey),
      attachedPrompt: buildNewsAttachedPrompt(item, sourceKey, ingestResult),
    });
  };

  const handleToggleTranslation = async () => {
    if (showTranslation) {
      setShowTranslation(false);
      return;
    }

    if (translatedTitle || translatedAbstract) {
      setTranslationError('');
      setShowTranslation(true);
      return;
    }

    if (!item.title && !item.abstract) {
      return;
    }

    setIsTranslating(true);
    setTranslationError('');

    try {
      const response = await api.news.translate({
        title: item.title,
        abstract: item.abstract,
        targetLanguage: 'zh-CN',
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.details || payload?.error || `HTTP ${response.status}`);
      }

      const payload = await response.json();
      setTranslatedTitle(payload?.translatedTitle || '');
      setTranslatedAbstract(payload?.translatedAbstract || '');
      setShowTranslation(true);
    } catch (error) {
      console.error('Failed to translate news item:', error);
      const detail = error instanceof Error ? error.message : '';
      setTranslationError(detail ? `${t('card.translationFailed')}: ${detail}` : t('card.translationFailed'));
    } finally {
      setIsTranslating(false);
    }
  };

  const SCORE_COLORS = [
    { label: t('card.relevance'), key: 'relevance_score' as const, bar: 'bg-gradient-to-r from-emerald-500 to-teal-600', dot: 'bg-emerald-600' },
    { label: t('card.recency'), key: 'recency_score' as const, bar: 'bg-gradient-to-r from-teal-500 to-green-600', dot: 'bg-teal-600' },
    { label: t('card.popularity'), key: 'popularity_score' as const, bar: 'bg-gradient-to-r from-green-500 to-emerald-700', dot: 'bg-green-600' },
    { label: t('card.quality'), key: 'quality_score' as const, bar: 'bg-gradient-to-r from-emerald-400 to-green-600', dot: 'bg-emerald-500' },
  ];
  const hasPrimaryUrl = Boolean(primaryUrl && primaryUrl !== '#');
  const compactCategories = item.categories?.slice(0, 2) ?? [];
  const compactKeywords = item.matched_keywords?.slice(0, 1) ?? [];
  const isCardView = variant === 'card';
  const secondaryButtonClass = 'inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-emerald-300/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60';
  const primaryButtonClass = 'inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-emerald-500 dark:hover:bg-emerald-400';

  const scoreBadge = (
    <div className={`rounded-xl border px-3 py-3 ${
      isTopItem
        ? 'border-emerald-200/80 bg-emerald-50/85 dark:border-emerald-800/60 dark:bg-emerald-950/30'
        : 'border-border/60 bg-slate-50/80 dark:bg-slate-900/40'
    }`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        #{index + 1}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <Star className="h-3.5 w-3.5 text-emerald-600" fill="currentColor" />
        <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
          {item.final_score?.toFixed(1) ?? '—'}
        </span>
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {t('card.final')}
      </div>
    </div>
  );

  const metaBadges = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="rounded-md border border-emerald-200/70 bg-emerald-50/80 px-2 py-1 text-[10px] font-medium text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/25 dark:text-emerald-200">
        {sourceBadgeLabel}
      </span>
      <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
        <Clock className="h-3 w-3" />
        {item.published ? item.published.slice(0, 10) : '—'}
      </span>
      {item.matched_domain && (
        <span className="rounded-md border border-green-200/70 bg-green-50/80 px-2 py-1 text-[10px] font-medium text-green-800 dark:border-green-800/50 dark:bg-green-950/25 dark:text-green-200">
          {item.matched_domain}
        </span>
      )}
      {compactCategories.map((category) => (
        <span
          key={category}
          className="rounded-md border border-border/50 bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground"
        >
          {category}
        </span>
      ))}
      {compactKeywords.map((keyword) => (
        <span
          key={keyword}
          className="rounded-md border border-emerald-200/70 bg-emerald-50/70 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/25 dark:text-emerald-200"
        >
          {keyword}
        </span>
      ))}
    </div>
  );

  const actionButtons = (
    <>
      <button
        type="button"
        onClick={handleToggleTranslation}
        disabled={isTranslating}
        className={secondaryButtonClass}
      >
        {isTranslating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
        <span>
          {isTranslating
            ? t('card.translating')
            : showTranslation
              ? t('actions.showOriginal')
              : t('actions.translate')}
        </span>
      </button>

      <button
        type="button"
        onClick={handleStartResearch}
        disabled={!canStartResearch || isStartingResearch}
        title={
          canStartResearch
            ? t('actions.researchFromPaper')
            : t('actions.selectProjectFirst')
        }
        className={primaryButtonClass}
      >
        <FlaskConical className="h-3 w-3" />
        {isStartingResearch ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        <span>{t('actions.researchFromPaper')}</span>
      </button>

      {hasPrimaryUrl && (
        <a
          href={primaryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={secondaryButtonClass}
        >
          {sourceBadgeLabel}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}

      {pdfUrl && (
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={secondaryButtonClass}
        >
          {t('card.pdf')}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={secondaryButtonClass}
      >
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {expanded ? t('card.showLess') : t('card.showMore')}
      </button>
    </>
  );

  const expandedContent = (
    <div className="border-t border-border/50 bg-slate-50/60 px-4 py-4 dark:bg-slate-950/30">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.95fr)]">
        <div className="rounded-xl border border-border/60 bg-white/90 p-4 dark:bg-slate-950/45">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t('card.abstract')}</div>
          <p className="mt-3 whitespace-pre-line text-sm leading-6 text-muted-foreground">
            {displayAbstract}
          </p>

          {translationError && (
            <p className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-300">{translationError}</p>
          )}

          {(item.categories?.length > 0 || item.matched_keywords?.length > 0) && (
            <div className="mt-4 space-y-3">
              {item.categories?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {item.categories.map((category) => (
                    <span
                      key={category}
                      className="rounded-md border border-border/50 bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground"
                    >
                      {category}
                    </span>
                  ))}
                </div>
              )}

              {item.matched_keywords?.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-medium text-muted-foreground/70">{t('card.matchedKeywords')}</span>
                  {item.matched_keywords.map((keyword) => (
                    <span
                      key={keyword}
                      className="rounded-md border border-emerald-200/70 bg-emerald-50/70 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/25 dark:text-emerald-200"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border/60 bg-white/90 p-4 dark:bg-slate-950/45">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">
            {t('card.scoreBreakdown')}
          </div>
          <div className="space-y-2">
            {SCORE_COLORS.map(({ label, key, bar, dot }) => (
              <ScoreBar key={key} label={label} score={item[key] ?? 0} barClass={bar} dotClass={dot} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  if (isCardView) {
    return (
      <article className="group flex h-full flex-col overflow-hidden rounded-[24px] border border-border/60 bg-white/88 shadow-sm transition-colors duration-200 hover:border-emerald-200/80 hover:bg-emerald-50/35 dark:bg-slate-950/20 dark:hover:bg-slate-950/30">
        <div className="flex h-full flex-col p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {metaBadges}
              <h3 className="mt-3 text-[15px] font-semibold leading-6 tracking-tight text-foreground sm:text-base">
                {displayTitle}
              </h3>
              {item.authors && (
                <p className="mt-1 text-xs leading-5 text-muted-foreground/80 line-clamp-2">{item.authors}</p>
              )}
            </div>
            <div className="shrink-0">
              {scoreBadge}
            </div>
          </div>

          <div className="mt-4 text-sm leading-6 text-muted-foreground line-clamp-4">
            {displayAbstract}
          </div>

          {translationError && !expanded && (
            <div className="mt-3 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
              {translationError}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {actionButtons}
          </div>
        </div>

        {expanded && expandedContent}
      </article>
    );
  }

  return (
    <article className="group border-b border-border/60 bg-white/78 transition-colors duration-200 hover:bg-emerald-50/35 dark:bg-slate-950/10 dark:hover:bg-slate-950/30 last:border-b-0">
      <div className="grid gap-3 px-4 py-4 lg:grid-cols-[82px_minmax(0,1fr)_minmax(170px,220px)] lg:items-start lg:gap-4">
        <div className="flex gap-3 lg:flex-col">
          {scoreBadge}
        </div>

        <div className="min-w-0">
          {metaBadges}

          <h3 className="mt-2.5 text-[15px] font-semibold leading-6 tracking-tight text-foreground sm:text-base">
            {displayTitle}
          </h3>

          {item.authors && (
            <p className="mt-1 text-xs leading-5 text-muted-foreground/80 line-clamp-2">{item.authors}</p>
          )}
        </div>

        <div className="flex flex-wrap items-start justify-start gap-2 lg:justify-end">
          {actionButtons}

          {translationError && !expanded && (
            <span className="inline-flex items-center rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
              {translationError}
            </span>
          )}
        </div>
      </div>

      {expanded && expandedContent}
    </article>
  );
}
