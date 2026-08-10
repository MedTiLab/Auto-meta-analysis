import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Search, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  USER_AVATAR_CATALOG,
  USER_AVATAR_CATEGORIES,
} from '../../../shared/avatarCatalog.js';
import { cn } from '../../lib/utils';
import UserAvatar from '../user-avatar/UserAvatar';

export default function UserAvatarPicker({
  selectedAvatarId,
  seed,
  onSelect,
  disabled = false,
  defaultExpanded = false,
}) {
  const { t } = useTranslation('settings');
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [activeCategory, setActiveCategory] = useState('all');
  const [query, setQuery] = useState('');

  const normalizedQuery = query.trim().toLowerCase();

  const filteredAvatars = useMemo(() => {
    return USER_AVATAR_CATALOG.filter((avatar) => {
      if (activeCategory !== 'all' && avatar.category !== activeCategory) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const categoryLabel = t(`userAccount.avatar.categories.${avatar.category}`).toLowerCase();
      return `${avatar.label} ${avatar.id} ${categoryLabel}`.toLowerCase().includes(normalizedQuery);
    });
  }, [activeCategory, normalizedQuery, t]);

  const categoryOptions = useMemo(() => {
    return [
      { id: 'all', label: t('userAccount.avatar.categories.all') },
      ...USER_AVATAR_CATEGORIES.map((category) => ({
        id: category.id,
        label: t(`userAccount.avatar.categories.${category.id}`),
      })),
    ];
  }, [t]);

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setIsExpanded((previous) => !previous)}
        disabled={disabled}
        aria-expanded={isExpanded}
        className="flex w-full items-center gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="rounded-md border border-cyan-200 bg-cyan-50 p-1.5 text-cyan-700 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-300">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{t('userAccount.avatar.title')}</div>
          <p className="truncate text-xs text-muted-foreground">{t('userAccount.avatar.description')}</p>
        </div>
        <UserAvatar
          avatarId={selectedAvatarId}
          seed={seed}
          size={32}
          label={t('userAccount.avatar.currentLabel', { username: seed })}
          className="shrink-0"
        />
        <span className="shrink-0 text-xs font-medium text-cyan-700 dark:text-cyan-300">
          {isExpanded ? t('userAccount.avatar.collapse') : t('userAccount.avatar.expand')}
        </span>
      </button>

      {isExpanded && (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-lg border border-border/70 bg-muted/40 p-1">
              {categoryOptions.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setActiveCategory(category.id)}
                  disabled={disabled}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    activeCategory === category.id
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {category.label}
                </button>
              ))}
            </div>

            <label className="relative block min-w-0 lg:ml-auto lg:w-60">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('userAccount.avatar.searchPlaceholder')}
                disabled={disabled}
                className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
          </div>

          <div
            className="grid max-h-52 grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1.5 overflow-y-auto rounded-lg border border-border bg-background/80 p-2.5"
            role="radiogroup"
            aria-label={t('userAccount.avatar.title')}
          >
            {filteredAvatars.map((avatar) => {
              const isSelected = avatar.id === selectedAvatarId;
              const label = `${t(`userAccount.avatar.categories.${avatar.category}`)} ${avatar.label}`;

              return (
                <button
                  key={avatar.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={label}
                  title={label}
                  disabled={disabled}
                  onClick={() => onSelect?.(avatar.id)}
                  className={cn(
                    'relative flex aspect-square items-center justify-center rounded-md border bg-muted/20 p-1 transition focus:outline-none focus:ring-2 focus:ring-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-60',
                    isSelected
                      ? 'border-cyan-500 bg-cyan-50 shadow-sm dark:bg-cyan-950/30'
                      : 'border-border hover:border-cyan-300 hover:bg-cyan-50/60 dark:hover:border-cyan-800 dark:hover:bg-cyan-950/20',
                  )}
                >
                  <UserAvatar avatarId={avatar.id} seed={seed} size="100%" label={label} decorative />
                  {isSelected && (
                    <span className="absolute right-0 top-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-cyan-600 text-white shadow-sm">
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  )}
                </button>
              );
            })}

            {filteredAvatars.length === 0 && (
              <div className="col-span-full py-5 text-center text-sm text-muted-foreground">
                {t('userAccount.avatar.empty')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
