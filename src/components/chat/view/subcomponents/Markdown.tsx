import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTranslation } from 'react-i18next';
import { normalizeInlineCodeFences } from '../../utils/chatFormatting';
import { api } from '../../../../utils/api';
import { hasNonFileUrlScheme, isExternalHref, isLikelyChatFilePath, normalizeChatFilePath } from '../../utils/filePathLinks';

type MarkdownProps = {
  children: React.ReactNode;
  className?: string;
  onFileOpen?: (filePath: string) => void;
  projectName?: string;
};

type CodeBlockProps = {
  node?: any;
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
};

type MarkdownImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  node?: any;
  projectName?: string;
};

const CodeBlock = ({ node, inline, className, children, ...props }: CodeBlockProps) => {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
  const looksMultiline = /[\r\n]/.test(raw);
  const inlineDetected = inline || (node && node.type === 'inlineCode');
  const shouldInline = inlineDetected || !looksMultiline;

  if (shouldInline) {
    return (
      <code
        className={`font-mono text-[0.9em] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-900 border border-gray-200 dark:bg-gray-800/60 dark:text-gray-100 dark:border-gray-700 whitespace-pre-wrap break-words ${
          className || ''
        }`}
        {...props}
      >
        {children}
      </code>
    );
  }

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';
  const textToCopy = raw;

  const handleCopy = () => {
    const doSet = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textToCopy).then(doSet).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = textToCopy;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand('copy');
          } catch {}
          document.body.removeChild(ta);
          doSet();
        });
      } else {
        const ta = document.createElement('textarea');
        ta.value = textToCopy;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } catch {}
        document.body.removeChild(ta);
        doSet();
      }
    } catch {}
  };

  return (
    <div className="relative group my-2">
      {language && language !== 'text' && (
        <div className="absolute top-2 left-3 z-10 text-xs text-gray-400 font-medium uppercase">{language}</div>
      )}

      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 focus:opacity-100 active:opacity-100 transition-opacity text-xs px-2 py-1 rounded-md bg-gray-700/80 hover:bg-gray-700 text-white border border-gray-600"
        title={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
        aria-label={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
      >
        {copied ? (
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {t('codeBlock.copied')}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
            </svg>
            {t('codeBlock.copy')}
          </span>
        )}
      </button>

      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          padding: language && language !== 'text' ? '2rem 1rem 1rem 1rem' : '1rem',
        }}
        codeTagProps={{
          style: {
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          },
        }}
      >
        {raw}
      </SyntaxHighlighter>
    </div>
  );
};

function getNodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(getNodeText).join('');
  }
  if (React.isValidElement(node)) {
    return getNodeText(node.props.children);
  }
  return '';
}

const LOCAL_IMAGE_PATH_RE = /\.(?:png|jpe?g|gif|webp|bmp|svg|heic|heif|ico)(?:[?#].*)?$/i;
const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/;

function normalizeLocalImagePath(src?: string | null): string | null {
  if (!src) {
    return null;
  }

  const trimmed = src.trim();
  if (!trimmed || /^(?:https?:|data:|blob:)/i.test(trimmed) || /^\/api\//.test(trimmed) || /^\/(?:assets|static)\//.test(trimmed)) {
    return null;
  }

  if (/^file:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const decodedPath = decodeURIComponent(url.pathname);
      if (WINDOWS_ABSOLUTE_PATH_RE.test(decodedPath.slice(1))) {
        return decodedPath.slice(1);
      }
      return decodedPath;
    } catch {
      return null;
    }
  }

  if (!LOCAL_IMAGE_PATH_RE.test(trimmed)) {
    return null;
  }

  return trimmed.replace(/[?#].*$/, '');
}

function MarkdownImage({ node, src, alt, className, projectName, ...props }: MarkdownImageProps) {
  const localImagePath = useMemo(() => normalizeLocalImagePath(src), [src]);
  const shouldLoadLocalImage = Boolean(projectName && localImagePath);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let nextObjectUrl: string | null = null;

    setObjectUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
    setLoadFailed(false);

    if (!shouldLoadLocalImage || !projectName || !localImagePath) {
      return undefined;
    }

    api.getFileContentBlob(projectName, localImagePath)
      .then((blob) => {
        if (cancelled) {
          return;
        }
        nextObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(nextObjectUrl);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        console.error('Failed to load markdown image:', error);
        setLoadFailed(true);
      });

    return () => {
      cancelled = true;
      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl);
      }
    };
  }, [localImagePath, projectName, shouldLoadLocalImage]);

  if (!src) {
    return null;
  }

  if (shouldLoadLocalImage && !objectUrl) {
    return (
      <span className="inline-flex min-h-8 items-center text-sm text-gray-500 dark:text-gray-400">
        {loadFailed ? (alt || localImagePath || 'Image unavailable') : 'Loading image...'}
      </span>
    );
  }

  return (
    <img
      src={objectUrl || src}
      alt={alt || ''}
      className={`mx-auto my-3 block w-auto max-w-[min(100%,28rem)] max-h-80 cursor-zoom-in rounded-lg border border-gray-200/70 object-contain shadow-sm dark:border-gray-700/70 ${className || ''}`.trim()}
      loading="lazy"
      onClick={() => window.open(objectUrl || src, '_blank', 'noopener,noreferrer')}
      title={alt || 'Open image'}
      {...props}
    />
  );
}

const markdownComponents = {
  code: CodeBlock,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic text-gray-600 dark:text-gray-400 my-2">
      {children}
    </blockquote>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  p: ({ children }: { children?: React.ReactNode }) => <div className="mb-2 last:mb-0">{children}</div>,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>,
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-3 py-2 text-left text-sm font-semibold border border-gray-200 dark:border-gray-700">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-3 py-2 align-top text-sm border border-gray-200 dark:border-gray-700">{children}</td>
  ),
};

export function Markdown({ children, className, onFileOpen, projectName }: MarkdownProps) {
  const content = normalizeInlineCodeFences(String(children ?? ''));
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeKatex], []);
  const baseComponents = useMemo(() => ({
    ...markdownComponents,
    img: (props: MarkdownImageProps) => <MarkdownImage {...props} projectName={projectName} />,
  }), [projectName]);

  const components = useMemo(() => {
    if (!onFileOpen) return baseComponents;

    return {
      ...baseComponents,
      // Make markdown links open as files if href looks like a file path
      a: ({ href, children: linkChildren }: { href?: string; children?: React.ReactNode }) => {
        const linkText = getNodeText(linkChildren);
        const filePathSource = href && !isExternalHref(href) && isLikelyChatFilePath(href)
          ? href
          : href && hasNonFileUrlScheme(href) && linkText && isLikelyChatFilePath(linkText)
            ? linkText
            : '';

        if (filePathSource) {
            const filePath = normalizeChatFilePath(filePathSource);
            return (
              <button
                type="button"
                onClick={() => onFileOpen(filePath)}
                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline cursor-pointer transition-colors"
                title={`Open ${filePath}`}
              >
                {linkChildren}
              </button>
            );
        }
        return (
          <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
            {linkChildren}
          </a>
        );
      },
      // Make bold text clickable if it looks like a file path
      strong: ({ children: strongChildren }: { children?: React.ReactNode }) => {
        const text = getNodeText(strongChildren);
        if (text && isLikelyChatFilePath(text)) {
          const filePath = normalizeChatFilePath(text);
          return (
            <button
              type="button"
              onClick={() => onFileOpen(filePath)}
              className="font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline cursor-pointer transition-colors"
              title={`Open ${filePath}`}
            >
              {strongChildren}
            </button>
          );
        }
        return <strong>{strongChildren}</strong>;
      },
      // Make inline code clickable if it looks like a file path
      code: (props: CodeBlockProps) => {
        const { node, inline, children: codeChildren } = props;
        const raw = Array.isArray(codeChildren) ? codeChildren.join('') : String(codeChildren ?? '');
        const inlineDetected = inline || (node && node.type === 'inlineCode');
        const looksMultiline = /[\r\n]/.test(raw);
        const shouldInline = inlineDetected || !looksMultiline;

        if (shouldInline && isLikelyChatFilePath(raw)) {
          const filePath = normalizeChatFilePath(raw);
          return (
            <button
              type="button"
              onClick={() => onFileOpen(filePath)}
              className="font-mono text-[0.9em] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:underline cursor-pointer transition-colors"
              title={`Open ${filePath}`}
            >
              {codeChildren}
            </button>
          );
        }

        return <CodeBlock {...props} />;
      },
    };
  }, [baseComponents, onFileOpen]);

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components as any}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
