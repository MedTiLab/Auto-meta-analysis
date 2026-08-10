import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Loader2 } from 'lucide-react';

import { Button } from '../../../ui/button';
import DocxHtmlPreview from '../../../docx/DocxHtmlPreview';
import { cn } from '../../../../lib/utils';
import { api } from '../../../../utils/api';
import { getDelimitedFileDelimiter, parseDelimitedTable } from '../../../../utils/delimitedTable';
import type { SessionContextFileItem, SessionContextOutputItem } from '../../utils/sessionContextSummary';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'mdx']);
const HTML_EXTENSIONS = new Set(['html', 'htm']);
const DOWNLOAD_ONLY_EXTENSIONS = new Set([
  'zip', 'gz', 'tar', 'tgz', '7z', 'rar',
  'doc', 'ppt', 'pptx', 'xls', 'xlsx',
  'bin', 'exe', 'dll', 'npy', 'npz', 'pkl', 'pt', 'pth', 'ckpt', 'onnx',
]);

/** Cap text/markdown/html preview payload to avoid loading huge CSV/logs into React DOM. */
const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;
const TABLE_PREVIEW_MAX_ROWS = 500;
const TABLE_PREVIEW_MAX_COLUMNS = 80;

function formatPreviewBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return '';
  }
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type PreviewFile = SessionContextFileItem | SessionContextOutputItem | null;

type PreviewKind = 'empty' | 'loading' | 'text' | 'markdown' | 'html' | 'tabular' | 'docx' | 'pdf' | 'image' | 'audio' | 'video' | 'download' | 'error';
type PreviewLoadError = {
  kind: 'missing' | 'generic';
  message: string;
};

const getPreviewKind = (file: PreviewFile): PreviewKind => {
  if (!file) {
    return 'empty';
  }

  const name = file.name || file.relativePath || '';
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';

  if (extension === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown';
  if (HTML_EXTENSIONS.has(extension)) return 'html';
  if (getDelimitedFileDelimiter(name)) return 'tabular';
  if (extension === 'docx') return 'docx';
  if (DOWNLOAD_ONLY_EXTENSIONS.has(extension)) return 'download';
  return 'text';
};

function getPreviewPath(file: PreviewFile): string {
  return file?.relativePath || file?.absolutePath || '';
}

function isMissingFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /\b(?:404|not found|file not found|enoent)\b/i.test(message);
}

function toPreviewLoadError(error: unknown): PreviewLoadError {
  const message = error instanceof Error ? error.message : 'Failed to load preview.';
  return {
    kind: isMissingFileError(error) ? 'missing' : 'generic',
    message,
  };
}

interface ChatContextFilePreviewProps {
  projectName: string;
  file: PreviewFile;
  onOpenInEditor?: (filePath: string) => void;
  onImagePrevious?: () => void;
  onImageNext?: () => void;
  hasImagePrevious?: boolean;
  hasImageNext?: boolean;
  compact?: boolean;
  openLabel?: string;
  hideHeader?: boolean;
  frameless?: boolean;
  previewFontSize?: string;
}

export default function ChatContextFilePreview({
  projectName,
  file,
  onOpenInEditor,
  onImagePrevious,
  onImageNext,
  hasImagePrevious = false,
  hasImageNext = false,
  compact = false,
  openLabel,
  hideHeader = false,
  frameless = false,
  previewFontSize,
}: ChatContextFilePreviewProps) {
  const { t } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const [activeFile, setActiveFile] = useState<PreviewFile>(file);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [content, setContent] = useState('');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [docxArrayBuffer, setDocxArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<PreviewLoadError | null>(null);
  const [previewTruncated, setPreviewTruncated] = useState<{ totalBytes: number; previewBytes: number } | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const pointerStartXRef = useRef<number | null>(null);
  const previewKind = useMemo(() => getPreviewKind(activeFile), [activeFile]);
  const tablePreview = useMemo(() => {
    if (previewKind !== 'tabular') {
      return null;
    }

    const delimiter = getDelimitedFileDelimiter(activeFile?.name || activeFile?.relativePath || '') || ',';
    return parseDelimitedTable(content, delimiter);
  }, [activeFile, content, previewKind]);

  useEffect(() => {
    setActiveFile(file);
  }, [file?.absolutePath, file?.name, file?.relativePath]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setContent('');
    setLoadError(null);
    setPreviewTruncated(null);
    setDocxArrayBuffer(null);
    setLoading(Boolean(activeFile));
    setBlobUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });

    if (!activeFile) {
      setLoading(false);
      return undefined;
    }

    const loadPreview = async () => {
      try {
        if (previewKind === 'download') {
          return;
        }

        if (previewKind === 'pdf' || previewKind === 'image' || previewKind === 'audio' || previewKind === 'video' || previewKind === 'docx') {
          const absolutePath = getPreviewPath(activeFile);
          const blob = await api.getFileContentBlob(projectName, absolutePath);
          if (cancelled) {
            return;
          }

          if (previewKind === 'docx') {
            const nextDocxArrayBuffer = await blob.arrayBuffer();
            if (cancelled) {
              return;
            }

            setDocxArrayBuffer(nextDocxArrayBuffer);
            return;
          }

          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
          return;
        }

        const response = await api.readFile(projectName, getPreviewPath(activeFile), {
          maxPreviewBytes: TEXT_PREVIEW_MAX_BYTES,
        });
        if (!response.ok) {
          let serverMessage = '';
          try {
            const errorPayload = await response.clone().json();
            serverMessage = typeof errorPayload?.error === 'string' ? errorPayload.error : '';
          } catch {
            // Ignore parse failures and fall back to status text.
          }
          throw new Error(response.status === 404 ? (serverMessage || 'File not found') : `HTTP ${response.status}`);
        }

        const payload = await response.json() as {
          content?: string;
          truncated?: boolean;
          totalBytes?: number;
          previewBytes?: number;
        };
        if (cancelled) {
          return;
        }

        const rawContent = typeof payload?.content === 'string' ? payload.content : '';
        setContent(rawContent);

        if (payload?.truncated && typeof payload.totalBytes === 'number') {
          setPreviewTruncated({
            totalBytes: payload.totalBytes,
            previewBytes: typeof payload.previewBytes === 'number' ? payload.previewBytes : TEXT_PREVIEW_MAX_BYTES,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(toPreviewLoadError(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadPreview();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [activeFile, previewKind, projectName]);

  const openPath = getPreviewPath(activeFile);

  const handleDownload = async () => {
    if (!activeFile || !projectName) {
      return;
    }
    const path = activeFile.relativePath || activeFile.absolutePath;
    if (!path) {
      return;
    }
    setDownloadBusy(true);
    try {
      const blob = await api.getFileContentBlob(projectName, path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = activeFile.name || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      setLoadError(toPreviewLoadError(error));
    } finally {
      setDownloadBusy(false);
    }
  };
  const IMAGE_SWIPE_THRESHOLD = 48;

  const handleImageTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    touchStartXRef.current = event.changedTouches?.[0]?.clientX ?? null;
  };

  const handleImageTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const startX = touchStartXRef.current;
    const endX = event.changedTouches?.[0]?.clientX ?? null;
    touchStartXRef.current = null;

    if (typeof startX !== 'number' || typeof endX !== 'number') {
      return;
    }

    const deltaX = endX - startX;
    if (deltaX >= IMAGE_SWIPE_THRESHOLD && hasImagePrevious) {
      onImagePrevious?.();
    } else if (deltaX <= -IMAGE_SWIPE_THRESHOLD && hasImageNext) {
      onImageNext?.();
    }
  };

  const IMAGE_DRAG_THRESHOLD = 64;
  const handleImagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    pointerStartXRef.current = event.clientX;
  };

  const handleImagePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startX = pointerStartXRef.current;
    pointerStartXRef.current = null;
    if (typeof startX !== 'number') {
      return;
    }
    const deltaX = event.clientX - startX;
    if (deltaX >= IMAGE_DRAG_THRESHOLD && hasImagePrevious) {
      onImagePrevious?.();
    } else if (deltaX <= -IMAGE_DRAG_THRESHOLD && hasImageNext) {
      onImageNext?.();
    }
  };

  const emptyStateClass = 'min-h-0 flex-1';
  const previewBodyClass = 'min-h-0 flex-1';

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-1 flex-col overflow-hidden',
        frameless ? 'bg-transparent' : 'rounded-2xl border border-border/60 bg-background/80',
      )}
    >
      {!hideHeader && (
        <div className={`flex items-center justify-between gap-2 border-b border-border/60 ${compact ? 'px-2.5 py-2' : 'px-3 py-2'}`}>
          <div className="min-w-0">
            <div className={`${compact ? 'text-[13px]' : 'text-sm'} truncate font-medium text-foreground`}>
              {activeFile?.name || t('sessionContext.preview.titleFallback')}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {activeFile?.relativePath || t('sessionContext.preview.selectFile')}
            </div>
          </div>
          {activeFile && (
            <div className="flex flex-shrink-0 items-center gap-0.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={downloadBusy || loading}
                onClick={() => {
                  void handleDownload();
                }}
                className={cn('!gap-1', compact ? 'h-7 px-1.5 text-[11px] [&>svg]:!h-3.5 [&>svg]:!w-3.5' : 'px-2')}
              >
                {downloadBusy ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5 shrink-0" />
                )}
                {tCommon('buttons.download')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onOpenInEditor?.(openPath)}
                className={cn('!gap-1', compact ? 'h-7 px-1.5 text-[11px] [&>svg]:!h-3.5 [&>svg]:!w-3.5' : 'px-2')}
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                {openLabel || t('sessionContext.preview.open')}
              </Button>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className={`flex ${emptyStateClass} items-center justify-center text-sm text-muted-foreground`}>
          {t('sessionContext.preview.loading')}
        </div>
      )}

      {!loading && loadError?.kind === 'missing' && (
        <div className={`flex ${emptyStateClass} flex-col items-center justify-center px-5 text-center`}>
          <AlertTriangle className="h-8 w-8 text-primary" />
          <div className="mt-3 text-sm font-semibold text-foreground">
            {t('sessionContext.preview.missingTitle')}
          </div>
          <div className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
            {t('sessionContext.preview.missingHint')}
          </div>
          {openPath ? (
            <div className="mt-3 max-w-full rounded-md border border-border/60 bg-muted/50 px-2.5 py-1.5 text-left font-mono text-[11px] text-foreground">
              <span className="mr-1 font-sans font-medium">{t('sessionContext.preview.missingPathLabel')}</span>
              <span className="break-all">{openPath}</span>
            </div>
          ) : null}
        </div>
      )}

      {!loading && loadError?.kind === 'generic' && (
        <div className={`flex ${emptyStateClass} items-center justify-center px-4 text-center text-sm text-foreground`}>
          {t('sessionContext.preview.loadError', { error: loadError.message })}
        </div>
      )}

      {!loading && !loadError && previewKind === 'empty' && (
        <div className={`flex ${emptyStateClass} flex-col items-center justify-center px-4 text-center text-muted-foreground`}>
          <FileText className="h-7 w-7 opacity-60" />
          <div className="mt-3 text-sm font-medium text-foreground">{t('sessionContext.preview.selectToReview')}</div>
          <div className="mt-1 text-xs">
            {t('sessionContext.preview.unreadHint')}
          </div>
        </div>
      )}

      {!loading && !loadError && previewKind === 'pdf' && blobUrl && (
        <iframe title={activeFile?.name || 'PDF preview'} src={blobUrl} className={`${previewBodyClass} border-0`} />
      )}

      {!loading && !loadError && previewKind === 'image' && blobUrl && (
        <div
          className={`relative flex ${previewBodyClass} items-center justify-center overflow-auto bg-muted/10 p-3`}
          onTouchStart={handleImageTouchStart}
          onTouchEnd={handleImageTouchEnd}
          onPointerDown={handleImagePointerDown}
          onPointerUp={handleImagePointerUp}
        >
          {hasImagePrevious ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onImagePrevious}
              className="absolute left-4 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full border border-white/30 bg-black/65 p-0 text-white hover:bg-black/80"
              title={t('sessionContext.preview.previousImage', { defaultValue: 'Previous image' })}
              aria-label={t('sessionContext.preview.previousImage', { defaultValue: 'Previous image' })}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          ) : null}
          <img src={blobUrl} alt={activeFile?.name || 'Image preview'} className="max-h-full max-w-full rounded-lg border border-border/60" />
          {hasImageNext ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onImageNext}
              className="absolute right-4 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full border border-white/30 bg-black/65 p-0 text-white hover:bg-black/80"
              title={t('sessionContext.preview.nextImage', { defaultValue: 'Next image' })}
              aria-label={t('sessionContext.preview.nextImage', { defaultValue: 'Next image' })}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          ) : null}
        </div>
      )}

      {!loading && !loadError && previewKind === 'audio' && blobUrl && (
        <div className={`flex ${previewBodyClass} items-center justify-center px-4`}>
          <audio src={blobUrl} controls className="w-full" />
        </div>
      )}

      {!loading && !loadError && previewKind === 'video' && blobUrl && (
        <div className={`flex ${previewBodyClass} items-center justify-center bg-black p-3`}>
          <video src={blobUrl} controls className="max-h-full w-full rounded-lg" />
        </div>
      )}

      {!loading && !loadError && previewKind === 'download' && (
        <div className={`flex ${previewBodyClass} flex-col items-center justify-center bg-muted/10 p-6 text-center`}>
          <FileText className="h-9 w-9 text-muted-foreground/60" />
          <div className="mt-3 text-sm font-medium text-foreground">
            {activeFile?.name || t('sessionContext.preview.titleFallback')}
          </div>
          <div className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            {t('sessionContext.preview.downloadOnly', {
              defaultValue: 'Preview is not available for this file type. Use Download to save the original file.',
            })}
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={downloadBusy}
            onClick={() => {
              void handleDownload();
            }}
            className="mt-4 !gap-1"
          >
            {downloadBusy ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 shrink-0" />
            )}
            {tCommon('buttons.download')}
          </Button>
        </div>
      )}

      {!loading && !loadError && previewKind === 'html' && (
        <div className={`${previewBodyClass} flex min-h-0 flex-col overflow-hidden bg-muted/10 p-3`}>
          {previewTruncated && (
            <div className={`mb-3 flex-shrink-0 rounded-lg border border-border/60 bg-muted/50 ${compact ? 'px-2.5 py-2 text-[11px]' : 'px-3 py-2 text-xs'} text-muted-foreground`}>
              {t('sessionContext.preview.truncatedNotice', {
                previewSize: formatPreviewBytes(previewTruncated.previewBytes),
                totalSize: formatPreviewBytes(previewTruncated.totalBytes),
              })}
            </div>
          )}
          <iframe
            title={activeFile?.name || 'HTML preview'}
            srcDoc={content}
            sandbox="allow-scripts allow-same-origin"
            className="min-h-0 flex-1 rounded-xl border border-border/60 bg-white"
          />
        </div>
      )}

      {!loading && !loadError && previewKind === 'docx' && docxArrayBuffer && (
        <div className={`${previewBodyClass} overflow-auto bg-muted/10 p-3`}>
          <div className="mx-auto max-w-4xl rounded-2xl border border-border/60 bg-background/90 p-5 shadow-sm">
            <DocxHtmlPreview arrayBuffer={docxArrayBuffer} style={{ fontSize: previewFontSize }} />
          </div>
        </div>
      )}

      {!loading && !loadError && previewKind === 'markdown' && (
        <div
          className={`relative ${previewBodyClass} overflow-auto bg-muted/10 ${compact ? 'p-3' : 'p-4'}`}
          onTouchStart={handleImageTouchStart}
          onTouchEnd={handleImageTouchEnd}
          onPointerDown={handleImagePointerDown}
          onPointerUp={handleImagePointerUp}
        >
          {hasImagePrevious ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onImagePrevious}
              className="absolute left-4 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full border border-white/30 bg-black/65 p-0 text-white hover:bg-black/80"
              title={t('sessionContext.preview.previousFile', { defaultValue: 'Previous file' })}
              aria-label={t('sessionContext.preview.previousFile', { defaultValue: 'Previous file' })}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          ) : null}
          {previewTruncated && (
            <div className={`mb-3 rounded-lg border border-border/60 bg-muted/50 ${compact ? 'px-2.5 py-2 text-[11px]' : 'px-3 py-2 text-xs'} text-muted-foreground`}>
              {t('sessionContext.preview.truncatedNotice', {
                previewSize: formatPreviewBytes(previewTruncated.previewBytes),
                totalSize: formatPreviewBytes(previewTruncated.totalBytes),
              })}
            </div>
          )}
          <div
            className={`prose prose-sm max-w-none rounded-2xl border border-border/60 bg-background/90 shadow-sm dark:prose-invert ${compact ? 'p-4' : 'p-5'}`}
            style={{ fontSize: previewFontSize }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {content}
            </ReactMarkdown>
          </div>
          {hasImageNext ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onImageNext}
              className="absolute right-4 top-1/2 z-10 h-10 w-10 -translate-y-1/2 rounded-full border border-white/30 bg-black/65 p-0 text-white hover:bg-black/80"
              title={t('sessionContext.preview.nextFile', { defaultValue: 'Next file' })}
              aria-label={t('sessionContext.preview.nextFile', { defaultValue: 'Next file' })}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          ) : null}
        </div>
      )}

      {!loading && !loadError && previewKind === 'tabular' && tablePreview && (
        <div className={`${previewBodyClass} flex min-h-0 flex-col overflow-hidden bg-background`}>
          {(previewTruncated || tablePreview.rows.length > TABLE_PREVIEW_MAX_ROWS || tablePreview.columnCount > TABLE_PREVIEW_MAX_COLUMNS) && (
            <div className={`flex-shrink-0 border-b border-border/60 bg-muted/50 ${compact ? 'px-2.5 py-2 text-[11px]' : 'px-3 py-2 text-xs'} text-muted-foreground`}>
              {previewTruncated ? (
                <span>
                  {t('sessionContext.preview.truncatedNotice', {
                    previewSize: formatPreviewBytes(previewTruncated.previewBytes),
                    totalSize: formatPreviewBytes(previewTruncated.totalBytes),
                  })}
                </span>
              ) : null}
              {tablePreview.rows.length > TABLE_PREVIEW_MAX_ROWS || tablePreview.columnCount > TABLE_PREVIEW_MAX_COLUMNS ? (
                <span className={previewTruncated ? 'ml-2' : undefined}>
                  {t('sessionContext.preview.table.limitNotice', {
                    rows: Math.min(tablePreview.rows.length, TABLE_PREVIEW_MAX_ROWS),
                    columns: Math.min(tablePreview.columnCount, TABLE_PREVIEW_MAX_COLUMNS),
                  })}
                </span>
              ) : null}
            </div>
          )}
          {tablePreview.columnCount === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-sm text-muted-foreground">
              {t('sessionContext.preview.table.empty')}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto bg-background">
              <table className="min-w-full border-separate border-spacing-0 text-left font-sans text-xs" style={{ fontSize: previewFontSize }}>
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-30 w-12 border-b border-r border-border bg-muted px-2 py-2 text-center font-medium text-muted-foreground">
                      #
                    </th>
                    {tablePreview.headers.slice(0, TABLE_PREVIEW_MAX_COLUMNS).map((header, columnIndex) => (
                      <th
                        key={`header-${columnIndex}`}
                        className="sticky top-0 z-20 max-w-[18rem] border-b border-r border-border bg-muted px-3 py-2 font-semibold text-foreground"
                        title={header || t('sessionContext.preview.table.column', { index: columnIndex + 1 })}
                      >
                        <div className="max-w-[18rem] truncate">
                          {header || t('sessionContext.preview.table.column', { index: columnIndex + 1 })}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tablePreview.rows.slice(0, TABLE_PREVIEW_MAX_ROWS).map((row, rowIndex) => (
                    <tr key={`row-${rowIndex}`} className="odd:bg-background even:bg-muted/20 hover:bg-primary/5">
                      <th className="sticky left-0 z-10 border-b border-r border-border bg-inherit px-2 py-1.5 text-center font-mono font-normal text-muted-foreground" style={{ fontSize: previewFontSize }}>
                        {rowIndex + 1}
                      </th>
                      {row.slice(0, TABLE_PREVIEW_MAX_COLUMNS).map((cell, columnIndex) => (
                        <td
                          key={`cell-${rowIndex}-${columnIndex}`}
                          className="max-w-[18rem] whitespace-nowrap border-b border-r border-border px-3 py-1.5 text-foreground"
                          title={cell}
                        >
                          <div className="max-w-[18rem] truncate">{cell}</div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!loading && !loadError && previewKind === 'text' && (
        <div className={`${previewBodyClass} flex min-h-0 flex-col overflow-hidden bg-background`}>
          {previewTruncated && (
            <div className={`flex-shrink-0 border-b border-border/60 bg-muted/50 ${compact ? 'px-2.5 py-2 text-[11px]' : 'px-3 py-2 text-xs'} text-muted-foreground`}>
              {t('sessionContext.preview.truncatedNotice', {
                previewSize: formatPreviewBytes(previewTruncated.previewBytes),
                totalSize: formatPreviewBytes(previewTruncated.totalBytes),
              })}
            </div>
          )}
          <pre
            className={`min-h-0 flex-1 overflow-auto ${compact ? 'p-3 text-[11px]' : 'p-4 text-xs'} leading-6 text-foreground`}
            style={{ fontSize: previewFontSize }}
          >
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}
