import type { NewsSourceKey } from './useNewsDashboardData';

const SOURCE_ICONS: Record<NewsSourceKey, { light: string; dark?: string }> = {
  pubmed: { light: '/icons/news/pubmed.svg' },
  europepmc: { light: '/icons/news/europepmc.svg' },
  medrxiv: { light: '/icons/news/medrxiv.svg' },
  arxiv: { light: '/icons/news/arxiv.svg' },
  xiaohongshu: { light: '/icons/news/xiaohongshu.png' },
};

/**
 * Renders the brand logo for a news source.
 * @param inverted - Force the dark/white variant (e.g. when on a colored active button background)
 */
export default function SourceIcon({ sourceKey, className, inverted }: { sourceKey: NewsSourceKey; className?: string; inverted?: boolean }) {
  const icon = SOURCE_ICONS[sourceKey];

  if (icon.dark) {
    if (inverted) {
      return <img src={icon.dark} alt="" className={className} />;
    }
    return (
      <>
        <img src={icon.light} alt="" className={`dark:hidden ${className ?? ''}`} />
        <img src={icon.dark} alt="" className={`hidden dark:block ${className ?? ''}`} />
      </>
    );
  }

  return <img src={icon.light} alt="" className={className} />;
}
