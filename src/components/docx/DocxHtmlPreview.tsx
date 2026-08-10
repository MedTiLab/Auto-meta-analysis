import { type CSSProperties, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type DocxHtmlPreviewProps = {
  arrayBuffer: ArrayBuffer;
  className?: string;
  style?: CSSProperties;
};

/**
 * Renders a .docx file as HTML using mammoth (client-side conversion).
 */
export default function DocxHtmlPreview({ arrayBuffer, className = '', style }: DocxHtmlPreviewProps) {
  const { t } = useTranslation('common');
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);

    (async () => {
      try {
        const mammoth = await import('mammoth');
        const result = await mammoth.default.convertToHtml({ arrayBuffer });
        if (!cancelled) {
          setHtml(result.value);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [arrayBuffer]);

  if (error) {
    return (
      <div className="p-6 text-center text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!html) {
    return (
      <div className="flex h-full min-h-[12rem] items-center justify-center text-sm text-muted-foreground">
        {t('researchLab.fileViewer.loading')}
      </div>
    );
  }

  return (
    <div
      className={`docx-preview prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-table:border prose-th:border prose-td:border prose-img:rounded-md ${className}`}
      style={style}
      // mammoth output is document-derived; safe for trusted workspace files
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
