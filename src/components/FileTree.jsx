import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Folder, FolderOpen, FolderPlus, File, FileText, FileCode, Eye, Search, X,
  ChevronRight, ChevronDown, UploadCloud, Loader2, Trash2, Copy, Check, RefreshCw, Clock,
  FileJson, FileType, FileSpreadsheet, FileArchive,
  Hash, Braces, Terminal, Database, Globe, Palette, Music2, Video, Archive,
  Lock, Shield, Settings, Image, BookOpen, Cpu, Box, Gem, Coffee,
  Flame, Hexagon, FileCode2, Code2, Cog, FileWarning, Binary, SquareFunction,
  Scroll, FlaskConical, NotebookPen, FileCheck, Workflow, Blocks, MessageSquarePlus
} from 'lucide-react';
import { cn } from '../lib/utils';
import ImageViewer from './ImageViewer';
import { api } from '../utils/api';
import { copyTextToClipboard } from '../utils/clipboard';
import {
  PROJECT_FILE_MOVED_EVENT,
  dispatchProjectFilesChanged,
  dispatchProjectFileMoved,
} from '../utils/projectFileEvents';
import { isInternalProjectPath, normalizeProjectRelativePath } from '../../shared/internalProjectFiles';

// ─── File Icon Registry ──────────────────────────────────────────────
// Maps file extensions (and special filenames) to { icon, colorClass } pairs.
// Uses lucide-react icons mapped semantically to file types.

const ICON_SIZE = 'w-4 h-4 flex-shrink-0';
const IMAGE_FILE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);
const MARKDOWN_FILE_EXTENSIONS = new Set(['md', 'mdx']);
const AUTO_REFRESH_STORAGE_KEY = 'file-tree-auto-refresh-interval-ms';
const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 15000;
const AUTO_REFRESH_INTERVAL_OPTIONS = [0, 5000, 15000, 30000, 60000];
const FILE_TREE_INITIAL_MAX_DEPTH = 2;
const FILE_TREE_CHILD_MAX_DEPTH = 1;
const FILE_TREE_DRAG_MIME = 'application/x-medautodata-file-tree-item';
const META_NUMBERED_DIRECTORY_ORDER = [
  '00_literature',
  '01_protocol',
  '02_search_dedupe',
  '03_title_abstract_screening',
  '04_full_text_review',
  '05_data_extraction',
  '06_quality_assessment',
  '07_data_analysis',
  '08_results_figures',
  '09_manuscript_submission',
  '10_presentation',
];

const LEGACY_TOP_LEVEL_DIRECTORY_ORDER = [
  'Literature',
  'literature',
  'Ideation',
  'Experiment',
  'Publication',
  'Promotion',
  'Survey',
  'Research',
  'reports',
  'drafts',
];

const TOP_LEVEL_DIRECTORY_ORDER = [
  ...META_NUMBERED_DIRECTORY_ORDER,
  ...LEGACY_TOP_LEVEL_DIRECTORY_ORDER,
];

const TOP_LEVEL_DIRECTORY_DISPLAY_LABELS = {
  '00_literature': { zh: '00 文献调研', en: '00 Literature' },
  '01_protocol': { zh: '01 研究方案', en: '01 Protocol' },
  '02_search_dedupe': { zh: '02 检索去重', en: '02 Search & Dedupe' },
  '03_title_abstract_screening': { zh: '03 题摘筛选', en: '03 Title/Abstract Screening' },
  '04_full_text_review': { zh: '04 全文评审', en: '04 Full-Text Review' },
  '05_data_extraction': { zh: '05 数据提取', en: '05 Data Extraction' },
  '06_quality_assessment': { zh: '06 质量评价', en: '06 Quality Assessment' },
  '07_data_analysis': { zh: '07 数据分析', en: '07 Data Analysis' },
  '08_results_figures': { zh: '08 结果图表', en: '08 Results & Figures' },
  '09_manuscript_submission': { zh: '09 论文投稿', en: '09 Manuscript & Submission' },
  '10_presentation': { zh: '10 汇报展示', en: '10 Presentation' },
  Literature: { zh: '文献资料', en: 'Literature' },
  literature: { zh: '文献资料', en: 'Literature' },
  Ideation: { zh: '选题构思', en: 'Ideation' },
  Experiment: { zh: '实验分析', en: 'Experiment' },
  Publication: { zh: '论文发表', en: 'Publication' },
  Promotion: { zh: '成果推广', en: 'Promotion' },
  Survey: { zh: '调研综述', en: 'Survey' },
  Research: { zh: '研究资料', en: 'Research' },
  reports: { zh: '报告', en: 'Reports' },
  drafts: { zh: '草稿', en: 'Drafts' },
};

const TOP_LEVEL_DIRECTORY_RANK = new Map(
  TOP_LEVEL_DIRECTORY_ORDER.map((name, index) => [name, index]),
);
const PUBLICATION_DIRECTORY_ORDER = [
  'manuscript',
  'figures',
  'tables',
  'supplementary',
];
const PUBLICATION_DIRECTORY_RANK = new Map(
  PUBLICATION_DIRECTORY_ORDER.map((name, index) => [name, index]),
);
const FILE_TREE_NAME_COLLATOR = new Intl.Collator(['zh-CN', 'en-US'], {
  numeric: true,
  sensitivity: 'base',
});

const UPLOAD_RELATIVE_PATH_PROPERTY = '__medAutoDataUploadRelativePath';

function normalizeBrowserRelativePath(pathValue) {
  return String(pathValue || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function attachUploadRelativePath(file, relativePath) {
  const normalizedPath = normalizeBrowserRelativePath(relativePath);
  if (!normalizedPath || normalizedPath === file.name) {
    return file;
  }

  try {
    Object.defineProperty(file, UPLOAD_RELATIVE_PATH_PROPERTY, {
      value: normalizedPath,
      configurable: true,
    });
  } catch {
    try {
      file[UPLOAD_RELATIVE_PATH_PROPERTY] = normalizedPath;
    } catch {
      // Some browser File objects are not extensible; fall back to the flat file name.
    }
  }

  return file;
}

function getUploadRelativePath(file) {
  return normalizeBrowserRelativePath(
    file?.[UPLOAD_RELATIVE_PATH_PROPERTY] || file?.webkitRelativePath || file?.name
  );
}

function isVisibleUploadRelativePath(relativePath) {
  const normalizedPath = normalizeBrowserRelativePath(relativePath);
  return Boolean(normalizedPath && !isInternalProjectPath(normalizedPath));
}

function getUploadDirectoriesFromFiles(files) {
  const directories = new Set();

  files.forEach((file) => {
    const relativePath = getUploadRelativePath(file);
    const segments = relativePath.split('/').filter(Boolean);

    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'));
    }
  });

  return Array.from(directories);
}

function mergeUploadItems(items) {
  const files = [];
  const directories = new Set();

  items.forEach((item) => {
    (item.files || []).forEach((file) => {
      if (isVisibleUploadRelativePath(getUploadRelativePath(file))) {
        files.push(file);
      }
    });
    (item.directories || []).forEach((directoryPath) => {
      const normalizedPath = normalizeBrowserRelativePath(directoryPath);
      if (isVisibleUploadRelativePath(normalizedPath)) {
        directories.add(normalizedPath);
      }
    });
  });

  getUploadDirectoriesFromFiles(files).forEach((directoryPath) => directories.add(directoryPath));

  return {
    files,
    directories: Array.from(directories),
  };
}

function readFileSystemFileEntry(entry, relativePath) {
  return new Promise((resolve, reject) => {
    entry.file(
      (file) => resolve(attachUploadRelativePath(file, relativePath)),
      reject
    );
  });
}

function readAllDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const entries = [];

    const readNextBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(entries);
            return;
          }

          entries.push(...batch);
          readNextBatch();
        },
        reject
      );
    };

    readNextBatch();
  });
}

async function readFileSystemEntryUploadItems(entry, parentPath = '') {
  const relativePath = normalizeBrowserRelativePath(parentPath ? `${parentPath}/${entry.name}` : entry.name);

  if (entry.isFile) {
    return {
      files: [await readFileSystemFileEntry(entry, relativePath)],
      directories: [],
    };
  }

  if (entry.isDirectory) {
    const children = await readAllDirectoryEntries(entry.createReader());
    const nestedItems = await Promise.all(
      children.map((child) => readFileSystemEntryUploadItems(child, relativePath))
    );
    const mergedItems = mergeUploadItems(nestedItems);

    return {
      files: mergedItems.files,
      directories: [relativePath, ...mergedItems.directories],
    };
  }

  return {
    files: [],
    directories: [],
  };
}

async function readFileSystemHandleUploadItems(handle, parentPath = '') {
  const relativePath = normalizeBrowserRelativePath(parentPath ? `${parentPath}/${handle.name}` : handle.name);

  if (handle.kind === 'file') {
    const file = await handle.getFile();
    return {
      files: [attachUploadRelativePath(file, relativePath)],
      directories: [],
    };
  }

  if (handle.kind === 'directory') {
    const nestedItems = [];

    for await (const childHandle of handle.values()) {
      nestedItems.push(await readFileSystemHandleUploadItems(childHandle, relativePath));
    }

    const mergedItems = mergeUploadItems(nestedItems);
    return {
      files: mergedItems.files,
      directories: [relativePath, ...mergedItems.directories],
    };
  }

  return {
    files: [],
    directories: [],
  };
}

async function getUploadItemsFromDataTransfer(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);

  const handles = (await Promise.all(
    items.map(async (item) => (
      typeof item.getAsFileSystemHandle === 'function'
        ? item.getAsFileSystemHandle().catch(() => null)
        : null
    ))
  )).filter(Boolean);

  if (handles.length > 0) {
    const uploadItemsByHandle = await Promise.all(handles.map((handle) => readFileSystemHandleUploadItems(handle)));
    return mergeUploadItems(uploadItemsByHandle);
  }

  const entries = items
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (entries.length > 0) {
    const uploadItemsByEntry = await Promise.all(entries.map((entry) => readFileSystemEntryUploadItems(entry)));
    return mergeUploadItems(uploadItemsByEntry);
  }

  const files = Array.from(dataTransfer?.files || []).map((file) => (
    attachUploadRelativePath(file, file.webkitRelativePath || file.name)
  ));

  return {
    files,
    directories: getUploadDirectoriesFromFiles(files),
  };
}

const FILE_ICON_MAP = {
  // ── JavaScript / TypeScript ──
  js:   { icon: FileCode,   color: 'text-yellow-500' },
  jsx:  { icon: FileCode,   color: 'text-yellow-500' },
  mjs:  { icon: FileCode,   color: 'text-yellow-500' },
  cjs:  { icon: FileCode,   color: 'text-yellow-500' },
  ts:   { icon: FileCode2,  color: 'text-blue-500' },
  tsx:  { icon: FileCode2,  color: 'text-blue-500' },
  mts:  { icon: FileCode2,  color: 'text-blue-500' },

  // ── Python ──
  py:   { icon: Code2,      color: 'text-emerald-500' },
  pyw:  { icon: Code2,      color: 'text-emerald-500' },
  pyi:  { icon: Code2,      color: 'text-emerald-400' },
  ipynb:{ icon: NotebookPen, color: 'text-orange-500' },

  // ── Rust ──
  rs:   { icon: Cog,        color: 'text-orange-600' },
  toml: { icon: Settings,   color: 'text-gray-500' },

  // ── Go ──
  go:   { icon: Hexagon,    color: 'text-cyan-500' },

  // ── Ruby ──
  rb:   { icon: Gem,        color: 'text-red-500' },
  erb:  { icon: Gem,        color: 'text-red-400' },

  // ── PHP ──
  php:  { icon: Blocks,     color: 'text-violet-500' },

  // ── Java / Kotlin ──
  java: { icon: Coffee,     color: 'text-red-600' },
  jar:  { icon: Coffee,     color: 'text-red-500' },
  kt:   { icon: Hexagon,    color: 'text-violet-500' },
  kts:  { icon: Hexagon,    color: 'text-violet-400' },

  // ── C / C++ ──
  c:    { icon: Cpu,        color: 'text-blue-600' },
  h:    { icon: Cpu,        color: 'text-blue-400' },
  cpp:  { icon: Cpu,        color: 'text-blue-700' },
  hpp:  { icon: Cpu,        color: 'text-blue-500' },
  cc:   { icon: Cpu,        color: 'text-blue-700' },

  // ── C# ──
  cs:   { icon: Hexagon,    color: 'text-purple-600' },

  // ── Swift ──
  swift:{ icon: Flame,      color: 'text-orange-500' },

  // ── Lua ──
  lua:  { icon: SquareFunction, color: 'text-blue-500' },

  // ── R ──
  r:    { icon: FlaskConical, color: 'text-blue-600' },

  // ── Web ──
  html: { icon: Globe,      color: 'text-orange-600' },
  htm:  { icon: Globe,      color: 'text-orange-600' },
  css:  { icon: Hash,       color: 'text-blue-500' },
  scss: { icon: Hash,       color: 'text-pink-500' },
  sass: { icon: Hash,       color: 'text-pink-400' },
  less: { icon: Hash,       color: 'text-indigo-500' },
  vue:  { icon: FileCode2,  color: 'text-emerald-500' },
  svelte:{ icon: FileCode2, color: 'text-orange-500' },

  // ── Data / Config ──
  json: { icon: Braces,     color: 'text-yellow-600' },
  jsonc:{ icon: Braces,     color: 'text-yellow-500' },
  json5:{ icon: Braces,     color: 'text-yellow-500' },
  yaml: { icon: Settings,   color: 'text-purple-400' },
  yml:  { icon: Settings,   color: 'text-purple-400' },
  xml:  { icon: FileCode,   color: 'text-orange-500' },
  csv:  { icon: FileSpreadsheet, color: 'text-green-600' },
  tsv:  { icon: FileSpreadsheet, color: 'text-green-500' },
  sql:  { icon: Database,   color: 'text-blue-500' },
  graphql:{ icon: Workflow,  color: 'text-pink-500' },
  gql:  { icon: Workflow,   color: 'text-pink-500' },
  proto:{ icon: Box,        color: 'text-green-500' },
  env:  { icon: Shield,     color: 'text-yellow-600' },

  // ── Documents ──
  md:   { icon: BookOpen,   color: 'text-blue-500' },
  mdx:  { icon: BookOpen,   color: 'text-blue-400' },
  txt:  { icon: FileText,   color: 'text-gray-500' },
  doc:  { icon: FileText,   color: 'text-blue-600' },
  docx: { icon: FileText,   color: 'text-blue-600' },
  pdf:  { icon: FileCheck,  color: 'text-red-600' },
  rtf:  { icon: FileText,   color: 'text-gray-500' },
  tex:  { icon: Scroll,     color: 'text-teal-600' },
  rst:  { icon: FileText,   color: 'text-gray-400' },

  // ── Shell / Scripts ──
  sh:   { icon: Terminal,   color: 'text-green-500' },
  bash: { icon: Terminal,   color: 'text-green-500' },
  zsh:  { icon: Terminal,   color: 'text-green-400' },
  fish: { icon: Terminal,   color: 'text-green-400' },
  ps1:  { icon: Terminal,   color: 'text-blue-400' },
  bat:  { icon: Terminal,   color: 'text-gray-500' },
  cmd:  { icon: Terminal,   color: 'text-gray-500' },

  // ── Images ──
  png:  { icon: Image,      color: 'text-purple-500' },
  jpg:  { icon: Image,      color: 'text-purple-500' },
  jpeg: { icon: Image,      color: 'text-purple-500' },
  gif:  { icon: Image,      color: 'text-purple-400' },
  webp: { icon: Image,      color: 'text-purple-400' },
  ico:  { icon: Image,      color: 'text-purple-400' },
  bmp:  { icon: Image,      color: 'text-purple-400' },
  tiff: { icon: Image,      color: 'text-purple-400' },
  svg:  { icon: Palette,    color: 'text-amber-500' },

  // ── Audio ──
  mp3:  { icon: Music2,     color: 'text-pink-500' },
  wav:  { icon: Music2,     color: 'text-pink-500' },
  ogg:  { icon: Music2,     color: 'text-pink-400' },
  flac: { icon: Music2,     color: 'text-pink-400' },
  aac:  { icon: Music2,     color: 'text-pink-400' },
  m4a:  { icon: Music2,     color: 'text-pink-400' },

  // ── Video ──
  mp4:  { icon: Video,      color: 'text-rose-500' },
  mov:  { icon: Video,      color: 'text-rose-500' },
  avi:  { icon: Video,      color: 'text-rose-500' },
  webm: { icon: Video,      color: 'text-rose-400' },
  mkv:  { icon: Video,      color: 'text-rose-400' },

  // ── Fonts ──
  ttf:  { icon: FileType,   color: 'text-red-500' },
  otf:  { icon: FileType,   color: 'text-red-500' },
  woff: { icon: FileType,   color: 'text-red-400' },
  woff2:{ icon: FileType,   color: 'text-red-400' },
  eot:  { icon: FileType,   color: 'text-red-400' },

  // ── Archives ──
  zip:  { icon: Archive,    color: 'text-amber-600' },
  tar:  { icon: Archive,    color: 'text-amber-600' },
  gz:   { icon: Archive,    color: 'text-amber-600' },
  bz2:  { icon: Archive,    color: 'text-amber-600' },
  rar:  { icon: Archive,    color: 'text-amber-500' },
  '7z': { icon: Archive,    color: 'text-amber-500' },

  // ── Lock files ──
  lock: { icon: Lock,       color: 'text-gray-500' },

  // ── Binary / Executable ──
  exe:  { icon: Binary,     color: 'text-gray-500' },
  bin:  { icon: Binary,     color: 'text-gray-500' },
  dll:  { icon: Binary,     color: 'text-gray-400' },
  so:   { icon: Binary,     color: 'text-gray-400' },
  dylib:{ icon: Binary,     color: 'text-gray-400' },
  wasm: { icon: Binary,     color: 'text-purple-500' },

  // ── Misc config ──
  ini:  { icon: Settings,   color: 'text-gray-500' },
  cfg:  { icon: Settings,   color: 'text-gray-500' },
  conf: { icon: Settings,   color: 'text-gray-500' },
  log:  { icon: Scroll,     color: 'text-gray-400' },
  map:  { icon: File,       color: 'text-gray-400' },
};

// Special full-filename matches (highest priority)
const FILENAME_ICON_MAP = {
  'Dockerfile':       { icon: Box,       color: 'text-blue-500' },
  'docker-compose.yml': { icon: Box,     color: 'text-blue-500' },
  'docker-compose.yaml': { icon: Box,    color: 'text-blue-500' },
  '.dockerignore':    { icon: Box,       color: 'text-gray-500' },
  '.gitignore':       { icon: Settings,  color: 'text-gray-500' },
  '.gitmodules':      { icon: Settings,  color: 'text-gray-500' },
  '.gitattributes':   { icon: Settings,  color: 'text-gray-500' },
  '.editorconfig':    { icon: Settings,  color: 'text-gray-500' },
  '.prettierrc':      { icon: Settings,  color: 'text-pink-400' },
  '.prettierignore':  { icon: Settings,  color: 'text-gray-500' },
  '.eslintrc':        { icon: Settings,  color: 'text-violet-500' },
  '.eslintrc.js':     { icon: Settings,  color: 'text-violet-500' },
  '.eslintrc.json':   { icon: Settings,  color: 'text-violet-500' },
  '.eslintrc.cjs':    { icon: Settings,  color: 'text-violet-500' },
  'eslint.config.js': { icon: Settings,  color: 'text-violet-500' },
  'eslint.config.mjs':{ icon: Settings,  color: 'text-violet-500' },
  '.env':             { icon: Shield,    color: 'text-yellow-600' },
  '.env.local':       { icon: Shield,    color: 'text-yellow-600' },
  '.env.development': { icon: Shield,    color: 'text-yellow-500' },
  '.env.production':  { icon: Shield,    color: 'text-yellow-600' },
  '.env.example':     { icon: Shield,    color: 'text-yellow-400' },
  'package.json':     { icon: Braces,    color: 'text-green-500' },
  'package-lock.json':{ icon: Lock,      color: 'text-gray-500' },
  'yarn.lock':        { icon: Lock,      color: 'text-blue-400' },
  'pnpm-lock.yaml':   { icon: Lock,      color: 'text-orange-400' },
  'bun.lockb':        { icon: Lock,      color: 'text-gray-400' },
  'Cargo.toml':       { icon: Cog,       color: 'text-orange-600' },
  'Cargo.lock':       { icon: Lock,      color: 'text-orange-400' },
  'Gemfile':          { icon: Gem,       color: 'text-red-500' },
  'Gemfile.lock':     { icon: Lock,      color: 'text-red-400' },
  'Makefile':         { icon: Terminal,   color: 'text-gray-500' },
  'CMakeLists.txt':   { icon: Cog,       color: 'text-blue-500' },
  'tsconfig.json':    { icon: Braces,    color: 'text-blue-500' },
  'jsconfig.json':    { icon: Braces,    color: 'text-yellow-500' },
  'vite.config.ts':   { icon: Flame,     color: 'text-purple-500' },
  'vite.config.js':   { icon: Flame,     color: 'text-purple-500' },
  'webpack.config.js':{ icon: Cog,       color: 'text-blue-500' },
  'tailwind.config.js':{ icon: Hash,     color: 'text-cyan-500' },
  'tailwind.config.ts':{ icon: Hash,     color: 'text-cyan-500' },
  'postcss.config.js':{ icon: Cog,       color: 'text-red-400' },
  'babel.config.js':  { icon: Settings,  color: 'text-yellow-500' },
  '.babelrc':         { icon: Settings,  color: 'text-yellow-500' },
  'README.md':        { icon: BookOpen,  color: 'text-blue-500' },
  'LICENSE':          { icon: FileCheck,  color: 'text-gray-500' },
  'LICENSE.md':       { icon: FileCheck,  color: 'text-gray-500' },
  'CHANGELOG.md':     { icon: Scroll,    color: 'text-blue-400' },
  'requirements.txt': { icon: FileText,  color: 'text-emerald-400' },
  'go.mod':           { icon: Hexagon,   color: 'text-cyan-500' },
  'go.sum':           { icon: Lock,      color: 'text-cyan-400' },
};

function getFileIconData(filename) {
  // 1. Exact filename match
  if (FILENAME_ICON_MAP[filename]) {
    return FILENAME_ICON_MAP[filename];
  }

  // 2. Check for .env prefix pattern
  if (filename.startsWith('.env')) {
    return { icon: Shield, color: 'text-yellow-600' };
  }

  // 3. Extension-based lookup
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext && FILE_ICON_MAP[ext]) {
    return FILE_ICON_MAP[ext];
  }

  // 4. Fallback
  return { icon: File, color: 'text-muted-foreground' };
}

function isImageFilename(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  return IMAGE_FILE_EXTENSIONS.has(ext);
}

function isMarkdownFilename(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  return MARKDOWN_FILE_EXTENSIONS.has(ext);
}

function hideInternalFileTreeItems(items, parentRelativePath = '') {
  return items
    .filter((item) => {
      const relativePath = normalizeProjectRelativePath(
        parentRelativePath ? `${parentRelativePath}/${item.name}` : item.name
      );
      return !isInternalProjectPath(relativePath);
    })
    .map((item) => {
      if (item.type !== 'directory' || !Array.isArray(item.children)) {
        return item;
      }

      const relativePath = normalizeProjectRelativePath(
        parentRelativePath ? `${parentRelativePath}/${item.name}` : item.name
      );

      return {
        ...item,
        children: hideInternalFileTreeItems(item.children, relativePath),
      };
    });
}

function compareFileTreeItems(a, b, level = 0, parentName = '') {
  if (a.type !== b.type) {
    return a.type === 'directory' ? -1 : 1;
  }

  if (parentName === 'Publication' && a.type === 'directory') {
    const rankA = PUBLICATION_DIRECTORY_RANK.has(a.name)
      ? PUBLICATION_DIRECTORY_RANK.get(a.name)
      : Number.POSITIVE_INFINITY;
    const rankB = PUBLICATION_DIRECTORY_RANK.has(b.name)
      ? PUBLICATION_DIRECTORY_RANK.get(b.name)
      : Number.POSITIVE_INFINITY;

    if (rankA !== rankB) {
      return rankA - rankB;
    }
  }

  if (level === 0 && a.type === 'directory') {
    const rankA = TOP_LEVEL_DIRECTORY_RANK.has(a.name)
      ? TOP_LEVEL_DIRECTORY_RANK.get(a.name)
      : Number.POSITIVE_INFINITY;
    const rankB = TOP_LEVEL_DIRECTORY_RANK.has(b.name)
      ? TOP_LEVEL_DIRECTORY_RANK.get(b.name)
      : Number.POSITIVE_INFINITY;

    if (rankA !== rankB) {
      return rankA - rankB;
    }
  }

  return FILE_TREE_NAME_COLLATOR.compare(a.name, b.name);
}

function sortDisplayFileTree(items, level = 0, parentName = '') {
  return [...items]
    .map((item) => {
      if (item.type !== 'directory' || !Array.isArray(item.children)) {
        return item;
      }

      return {
        ...item,
        children: sortDisplayFileTree(item.children, level + 1, item.name),
      };
    })
    .sort((a, b) => compareFileTreeItems(a, b, level, parentName));
}

function getFileTreeLocaleKey(language) {
  return String(language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function getFileTreeDisplayName(item, level = 0, localeKey = 'en') {
  if (!item || item.type !== 'directory' || level !== 0) {
    return item?.name || '';
  }

  const labels = TOP_LEVEL_DIRECTORY_DISPLAY_LABELS[item.name];
  return labels?.[localeKey] || labels?.en || item.name;
}

function getFileTreeDisplayTitle(item, displayName) {
  if (!item?.name || displayName === item.name) {
    return item?.name || '';
  }

  return `${displayName} (${item.name})`;
}

function collectDirectoryPaths(items) {
  const paths = [];

  const walk = (nodes) => {
    nodes.forEach((item) => {
      if (item.type !== 'directory') {
        return;
      }

      paths.push(item.path);
      if (Array.isArray(item.children) && item.children.length > 0) {
        walk(item.children);
      }
    });
  };

  walk(items);
  return paths;
}

function collectUnloadedDirectoryPaths(items) {
  const paths = [];

  const walk = (nodes) => {
    nodes.forEach((item) => {
      if (item.type !== 'directory') {
        return;
      }

      if (!Array.isArray(item.children)) {
        paths.push(item.path);
        return;
      }

      if (item.children.length > 0) {
        walk(item.children);
      }
    });
  };

  walk(items);
  return paths;
}

function updateDirectoryChildren(items, targetPath, children) {
  let changed = false;
  const nextItems = items.map((item) => {
    if (item.type === 'directory' && item.path === targetPath) {
      changed = true;
      return {
        ...item,
        children,
      };
    }

    if (item.type === 'directory' && Array.isArray(item.children)) {
      const nextChildren = updateDirectoryChildren(item.children, targetPath, children);
      if (nextChildren !== item.children) {
        changed = true;
        return {
          ...item,
          children: nextChildren,
        };
      }
    }

    return item;
  });

  return changed ? nextItems : items;
}

function getRelativeParentDirectoryPath(relativePath) {
  const normalizedPath = normalizeBrowserRelativePath(relativePath);
  const lastSeparatorIndex = normalizedPath.lastIndexOf('/');
  return lastSeparatorIndex > 0 ? normalizedPath.slice(0, lastSeparatorIndex) : '';
}

function collectUploadResponseDirectoryPaths(uploadResponse) {
  const directories = new Set();

  (uploadResponse?.directories || []).forEach((directory) => {
    const relativePath = normalizeBrowserRelativePath(directory?.relativePath);
    if (relativePath && relativePath !== '.') {
      directories.add(relativePath);
    }
  });

  (uploadResponse?.files || []).forEach((file) => {
    let directoryPath = getRelativeParentDirectoryPath(file?.relativePath);
    while (directoryPath) {
      directories.add(directoryPath);
      directoryPath = getRelativeParentDirectoryPath(directoryPath);
    }
  });

  return Array.from(directories);
}

function getRelativePathDepth(relativePath) {
  return normalizeBrowserRelativePath(relativePath).split('/').filter(Boolean).length;
}

function getUploadRefreshDepth(uploadResponse) {
  const directoryPaths = collectUploadResponseDirectoryPaths(uploadResponse);
  const maxDirectoryDepth = directoryPaths.reduce(
    (maxDepth, directoryPath) => Math.max(maxDepth, getRelativePathDepth(directoryPath)),
    FILE_TREE_INITIAL_MAX_DEPTH
  );

  return Math.min(10, Math.max(FILE_TREE_INITIAL_MAX_DEPTH, maxDirectoryDepth));
}

function buildProjectAbsolutePath(projectRoot, relativePath) {
  const normalizedRoot = String(projectRoot || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedRelativePath = normalizeBrowserRelativePath(relativePath);

  if (!normalizedRoot || !normalizedRelativePath || normalizedRelativePath === '.') {
    return normalizedRoot;
  }

  return `${normalizedRoot}/${normalizedRelativePath}`;
}

function getParentDirectoryPath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return '';
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  const lastSeparatorIndex = normalizedPath.lastIndexOf('/');
  return lastSeparatorIndex > 0 ? normalizedPath.slice(0, lastSeparatorIndex) : '';
}

function normalizeTreeMovePath(pathValue) {
  return String(pathValue || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
}

function isSameOrNestedPath(parentPath, candidatePath) {
  const parent = normalizeTreeMovePath(parentPath);
  const candidate = normalizeTreeMovePath(candidatePath);

  return Boolean(parent && candidate && (candidate === parent || candidate.startsWith(`${parent}/`)));
}

function isFileTreeItemRowEvent(event) {
  return typeof Element !== 'undefined'
    && event?.target instanceof Element
    && Boolean(event.target.closest('[data-file-tree-item-row="true"]'));
}

function toProjectRelativePath(filePath, projectRoot) {
  if (!filePath || typeof filePath !== 'string') {
    return '';
  }

  if (!projectRoot || typeof projectRoot !== 'string') {
    return filePath.replace(/\\/g, '/');
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedRoot = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const rootPrefix = `${normalizedRoot}/`;

  if (normalizedPath === normalizedRoot) {
    return '.';
  }

  return normalizedPath.startsWith(rootPrefix)
    ? normalizedPath.slice(rootPrefix.length)
    : normalizedPath;
}


// ─── Component ───────────────────────────────────────────────────────

function FileTree({ selectedProject, onFileOpen, onStartWorkspaceQa, enableAutoRefresh = true, embedded = false }) {
  const { i18n } = useTranslation();
  const t = useMemo(() => i18n.getFixedT('en'), [i18n]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [selectedImage, setSelectedImage] = useState(null);
  const [viewMode, setViewMode] = useState(() => {
    if (typeof localStorage === 'undefined') {
      return 'detailed';
    }
    const storedMode = localStorage.getItem('file-tree-view-mode');
    return storedMode === 'compact' || storedMode === 'simple' || storedMode === 'detailed'
      ? storedMode
      : 'detailed';
  });
  const [autoRefreshMenuOpen, setAutoRefreshMenuOpen] = useState(false);
  const [autoRefreshIntervalMs, setAutoRefreshIntervalMs] = useState(() => {
    if (!enableAutoRefresh) {
      return 0;
    }
    if (typeof localStorage === 'undefined') {
      return DEFAULT_AUTO_REFRESH_INTERVAL_MS;
    }

    const storedInterval = Number(localStorage.getItem(AUTO_REFRESH_STORAGE_KEY));
    return AUTO_REFRESH_INTERVAL_OPTIONS.includes(storedInterval)
      ? storedInterval
      : DEFAULT_AUTO_REFRESH_INTERVAL_MS;
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredFiles, setFilteredFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [dragOverDir, setDragOverDir] = useState(null);
  const [draggedItem, setDraggedItem] = useState(null);
  const [loadingDirs, setLoadingDirs] = useState(new Set());
  const [movingPath, setMovingPath] = useState(null);
  const [newFolderParentPath, setNewFolderParentPath] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [copiedPath, setCopiedPath] = useState(null);
  const uploadTargetDirRef = useRef('');
  const fileInputRef = useRef(null);
  const fetchInFlightRef = useRef(false);
  const loadingDirsRef = useRef(new Set());
  const autoRefreshMenuRef = useRef(null);
  const fileTreeMaxDepthRef = useRef(FILE_TREE_INITIAL_MAX_DEPTH);
  const fileTreeLocaleKey = 'en';

  const fetchFiles = useCallback(async ({ silent = false, maxDepth } = {}) => {
    if (!selectedProject?.name) {
      setFiles([]);
      return;
    }

    if (fetchInFlightRef.current) {
      return;
    }

    fetchInFlightRef.current = true;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const requestedMaxDepth = Number.isFinite(Number(maxDepth))
        ? Math.min(10, Math.max(FILE_TREE_INITIAL_MAX_DEPTH, Number(maxDepth)))
        : fileTreeMaxDepthRef.current;
      fileTreeMaxDepthRef.current = Math.max(fileTreeMaxDepthRef.current, requestedMaxDepth);

      const response = await api.getFiles(selectedProject.name, {
        maxDepth: requestedMaxDepth,
        showHidden: false,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ File fetch failed:', response.status, errorText);
        if (!silent) {
          setFiles([]);
        }
        return;
      }

      const data = await response.json();
      setFiles(data);
      loadingDirsRef.current = new Set();
      setLoadingDirs(new Set());
    } catch (error) {
      console.error('❌ Error fetching files:', error);
      if (!silent) {
        setFiles([]);
      }
    } finally {
      fetchInFlightRef.current = false;
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [selectedProject?.name]);

  const loadDirectoryChildren = useCallback(async (dirPath) => {
    if (!selectedProject?.name || !dirPath || loadingDirsRef.current.has(dirPath)) {
      return;
    }

    loadingDirsRef.current.add(dirPath);
    setLoadingDirs(new Set(loadingDirsRef.current));

    try {
      const response = await api.getFiles(selectedProject.name, {
        path: dirPath,
        maxDepth: FILE_TREE_CHILD_MAX_DEPTH,
        showHidden: false,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Directory fetch failed:', response.status, errorText);
        return;
      }

      const children = await response.json();
      setFiles((previousFiles) => updateDirectoryChildren(previousFiles, dirPath, children));
    } catch (error) {
      console.error('❌ Error fetching directory:', error);
    } finally {
      loadingDirsRef.current.delete(dirPath);
      setLoadingDirs(new Set(loadingDirsRef.current));
    }
  }, [selectedProject?.name]);

  const handleUpload = useCallback(async (uploadItems, targetDir = '') => {
    const rawFilesToUpload = Array.isArray(uploadItems) ? uploadItems : (uploadItems?.files || []);
    const rawDirectoriesToCreate = Array.isArray(uploadItems)
      ? getUploadDirectoriesFromFiles(uploadItems)
      : (uploadItems?.directories || []);
    const filesToUpload = rawFilesToUpload.filter((file) => (
      isVisibleUploadRelativePath(getUploadRelativePath(file))
    ));
    const directoriesToCreate = rawDirectoriesToCreate.filter((directoryPath) => (
      isVisibleUploadRelativePath(directoryPath)
    ));

    if ((!filesToUpload.length && !directoriesToCreate.length) || !selectedProject) return;
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    try {
      const formData = new FormData();
      formData.append('targetDir', targetDir);
      directoriesToCreate.forEach((directoryPath) => {
        const normalizedPath = normalizeBrowserRelativePath(directoryPath);
        if (normalizedPath) {
          formData.append('directories', normalizedPath);
        }
      });
      filesToUpload.forEach((file) => {
        const relativePath = getUploadRelativePath(file) || file.name;
        formData.append('relativePaths', relativePath);
        formData.append('files', file, file.name);
      });
      const res = await api.uploadFiles(selectedProject.name, formData);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Upload failed (${res.status})`);
      }
      const data = await res.json();
      const uploadedCount = (data.files?.length || 0) + (data.directories?.length || 0);
      const uploadDirectoryPaths = collectUploadResponseDirectoryPaths(data);
      const projectRoot = selectedProject.path || selectedProject.fullPath;

      if (uploadDirectoryPaths.length > 0 && projectRoot) {
        setExpandedDirs((previousDirs) => {
          const nextDirs = new Set(previousDirs);
          uploadDirectoryPaths.forEach((directoryPath) => {
            const absolutePath = buildProjectAbsolutePath(projectRoot, directoryPath);
            if (absolutePath) {
              nextDirs.add(absolutePath);
            }
          });
          return nextDirs;
        });
      }

      setUploadSuccess(t('fileTree.uploadSuccess', { count: uploadedCount }));
      setTimeout(() => setUploadSuccess(null), 3000);
      await fetchFiles({ silent: true, maxDepth: getUploadRefreshDepth(data) });
      dispatchProjectFilesChanged({ projectName: selectedProject.name });
    } catch (err) {
      setUploadError(err.message);
      setTimeout(() => setUploadError(null), 5000);
    } finally {
      setUploading(false);
    }
  }, [fetchFiles, selectedProject, t]);

  const handleFileInputChange = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) {
      handleUpload({
        files,
        directories: getUploadDirectoriesFromFiles(files),
      }, uploadTargetDirRef.current);
    }
    e.target.value = '';
  }, [handleUpload]);

  const handleFileDrop = useCallback(async (e, targetDir) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverDir(null);
    const dataTransfer = e.dataTransfer;

    try {
      const uploadItems = await getUploadItemsFromDataTransfer(dataTransfer);
      if (uploadItems.files.length || uploadItems.directories.length) {
        handleUpload(uploadItems, targetDir);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t('fileTree.folderReadError'));
      setTimeout(() => setUploadError(null), 5000);
    }
  }, [handleUpload, t]);

  const getDraggedItemFromEvent = useCallback((e) => {
    const transferData = e.dataTransfer?.getData(FILE_TREE_DRAG_MIME);

    if (transferData) {
      try {
        const parsed = JSON.parse(transferData);
        if ((parsed?.type === 'file' || parsed?.type === 'directory') && parsed.path) {
          return parsed;
        }
      } catch {
        // Fall back to component state when the browser blocks custom drag data.
      }
    }

    return draggedItem;
  }, [draggedItem]);

  const canMoveItemToDirectory = useCallback((item, targetDir) => {
    if (
      !item?.path ||
      (item.type !== 'file' && item.type !== 'directory')
    ) {
      return false;
    }

    const projectRoot = selectedProject?.path || selectedProject?.fullPath || '';
    const resolvedTargetDir = targetDir || projectRoot;
    const normalizedTargetDir = normalizeTreeMovePath(resolvedTargetDir);
    const normalizedSourcePath = normalizeTreeMovePath(item.path);

    if (!normalizedTargetDir || !normalizedSourcePath) {
      return false;
    }

    if (normalizeTreeMovePath(getParentDirectoryPath(item.path)) === normalizedTargetDir) {
      return false;
    }

    if (item.type === 'directory' && isSameOrNestedPath(normalizedSourcePath, normalizedTargetDir)) {
      return false;
    }

    return true;
  }, [selectedProject?.fullPath, selectedProject?.path]);

  const handleItemDragStart = useCallback((e, item) => {
    if (item.type !== 'file' && item.type !== 'directory') {
      e.preventDefault();
      return;
    }

    const dragPayload = {
      name: item.name,
      path: item.path,
      type: item.type,
    };

    setDraggedItem(dragPayload);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(FILE_TREE_DRAG_MIME, JSON.stringify(dragPayload));
    e.dataTransfer.setData('text/plain', item.path);
  }, []);

  const handleItemDragEnd = useCallback(() => {
    setDraggedItem(null);
    setDragOverDir(null);
  }, []);

  const handleDirectoryDragOver = useCallback((e, targetDir) => {
    const dataTypes = Array.from(e.dataTransfer?.types || []);
    const isInternalItemMove = dataTypes.includes(FILE_TREE_DRAG_MIME);
    const isExternalFileUpload = dataTypes.includes('Files');

    if (!isInternalItemMove && !isExternalFileUpload) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (isInternalItemMove) {
      const item = getDraggedItemFromEvent(e);
      if (canMoveItemToDirectory(item, targetDir) && !movingPath) {
        e.dataTransfer.dropEffect = 'move';
        setDragOverDir(targetDir);
      } else {
        e.dataTransfer.dropEffect = 'none';
      }
      return;
    }

    e.dataTransfer.dropEffect = 'copy';
    setDragOverDir(targetDir);
  }, [canMoveItemToDirectory, getDraggedItemFromEvent, movingPath]);

  const handleDirectoryDragLeave = useCallback((e, targetDir) => {
    e.stopPropagation();
    if (dragOverDir === targetDir) {
      setDragOverDir(null);
    }
  }, [dragOverDir]);

  const handleMoveItemDrop = useCallback(async (e, targetDir) => {
    const item = getDraggedItemFromEvent(e);
    setDragOverDir(null);

    if (!selectedProject?.name || !canMoveItemToDirectory(item, targetDir)) {
      setDraggedItem(null);
      return;
    }

    setMovingPath(item.path);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const response = await api.moveFile(selectedProject.name, item.path, targetDir);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || t('fileTree.moveError'));
      }

      const payload = await response.json();
      const projectRoot = selectedProject.path || selectedProject.fullPath;
      const oldRelativePath = toProjectRelativePath(item.path, projectRoot);
      const nextRelativePath = payload?.relativePath || item.path;
      const nextAbsolutePath = payload?.absolutePath || null;
      const destinationLabel = payload?.destinationDir || targetDir;
      const movedName = payload?.name || item.name;

      dispatchProjectFileMoved({
        projectName: selectedProject.name,
        oldRelativePath,
        newRelativePath: nextRelativePath,
        oldAbsolutePath: item.path,
        newAbsolutePath: nextAbsolutePath,
        name: movedName,
      });

      setUploadSuccess(t('fileTree.moveSuccess', { name: movedName, folder: destinationLabel }));
      setTimeout(() => setUploadSuccess(null), 3000);
      fetchFiles();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : t('fileTree.moveError'));
      setTimeout(() => setUploadError(null), 5000);
    } finally {
      setDraggedItem(null);
      setMovingPath(null);
    }
  }, [
    canMoveItemToDirectory,
    fetchFiles,
    getDraggedItemFromEvent,
    selectedProject?.fullPath,
    selectedProject?.name,
    selectedProject?.path,
    t,
  ]);

  const handleDirectoryDrop = useCallback((e, targetDir) => {
    e.preventDefault();
    e.stopPropagation();

    const dataTypes = Array.from(e.dataTransfer?.types || []);
    if (dataTypes.includes(FILE_TREE_DRAG_MIME)) {
      void handleMoveItemDrop(e, targetDir);
      return;
    }

    handleFileDrop(e, targetDir);
  }, [handleFileDrop, handleMoveItemDrop]);

  const handleRootDragOver = useCallback((e) => {
    const dataTypes = Array.from(e.dataTransfer?.types || []);
    const isInternalItemMove = dataTypes.includes(FILE_TREE_DRAG_MIME);
    const isExternalFileUpload = dataTypes.includes('Files');

    if (isInternalItemMove && isFileTreeItemRowEvent(e)) {
      return;
    }

    if (!isInternalItemMove && !isExternalFileUpload) {
      return;
    }

    e.preventDefault();

    if (isInternalItemMove) {
      const item = getDraggedItemFromEvent(e);
      e.dataTransfer.dropEffect = canMoveItemToDirectory(item, '') && !movingPath ? 'move' : 'none';
      return;
    }

    e.dataTransfer.dropEffect = 'copy';
  }, [canMoveItemToDirectory, getDraggedItemFromEvent, movingPath]);

  const handleRootDrop = useCallback((e) => {
    const dataTypes = Array.from(e.dataTransfer?.types || []);

    if (dataTypes.includes(FILE_TREE_DRAG_MIME)) {
      if (isFileTreeItemRowEvent(e)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      void handleMoveItemDrop(e, '');
      return;
    }

    handleFileDrop(e, '');
  }, [handleFileDrop, handleMoveItemDrop]);

  const startCreateFolder = useCallback((e, parentPath = '') => {
    e?.stopPropagation?.();
    const normalizedParentPath = parentPath || '';

    setNewFolderParentPath(normalizedParentPath);
    setNewFolderName('');
    setUploadError(null);
    setUploadSuccess(null);

    if (normalizedParentPath) {
      setExpandedDirs(prev => {
        const next = new Set(prev);
        next.add(normalizedParentPath);
        return next;
      });
    }
  }, []);

  const cancelCreateFolder = useCallback((e) => {
    e?.stopPropagation?.();
    setNewFolderParentPath(null);
    setNewFolderName('');
  }, []);

  const validateFolderName = useCallback((name) => {
    const trimmedName = name.trim();
    if (
      !trimmedName ||
      trimmedName === '.' ||
      trimmedName === '..' ||
      trimmedName.startsWith('.') ||
      trimmedName.includes('/') ||
      trimmedName.includes('\\')
    ) {
      return null;
    }
    return trimmedName;
  }, []);

  const handleCreateFolder = useCallback(async (e) => {
    e?.stopPropagation?.();

    if (!selectedProject?.name || newFolderParentPath === null) {
      return;
    }

    const folderName = validateFolderName(newFolderName);
    if (!folderName) {
      setUploadError('Enter a valid folder name without slashes or a leading dot.');
      setTimeout(() => setUploadError(null), 5000);
      return;
    }

    setCreatingFolder(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const response = await api.createProjectFolder(selectedProject.name, newFolderParentPath, folderName);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to create folder');
      }

      const payload = await response.json();
      const createdName = payload?.name || folderName;
      const parentLabel = payload?.parentDir || '.';

      if (newFolderParentPath) {
        setExpandedDirs(prev => {
          const next = new Set(prev);
          next.add(newFolderParentPath);
          return next;
        });
      }

      setNewFolderParentPath(null);
      setNewFolderName('');
      setUploadSuccess(`Created "${createdName}" in ${parentLabel}.`);
      setTimeout(() => setUploadSuccess(null), 3000);
      await fetchFiles();
      dispatchProjectFilesChanged({ projectName: selectedProject.name });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to create folder');
      setTimeout(() => setUploadError(null), 5000);
    } finally {
      setCreatingFolder(false);
    }
  }, [fetchFiles, newFolderName, newFolderParentPath, selectedProject?.name, t, validateFolderName]);

  const handleManualRefresh = useCallback(() => {
    void fetchFiles({ silent: true }).then(() => {
      if (selectedProject?.name) {
        dispatchProjectFilesChanged({ projectName: selectedProject.name });
      }
    });
  }, [fetchFiles, selectedProject?.name]);

  const changeAutoRefreshInterval = useCallback((intervalMs) => {
    if (!enableAutoRefresh) {
      return;
    }
    const nextInterval = Number(intervalMs);
    const safeInterval = AUTO_REFRESH_INTERVAL_OPTIONS.includes(nextInterval)
      ? nextInterval
      : DEFAULT_AUTO_REFRESH_INTERVAL_MS;

    setAutoRefreshIntervalMs(safeInterval);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(safeInterval));
    }
  }, [enableAutoRefresh]);

  const handleCopyPath = async (e, item) => {
    e.stopPropagation();
    const copied = await copyTextToClipboard(item.path);
    if (copied) {
      setCopiedPath(item.path);
      setTimeout(() => setCopiedPath(null), 2000);
    } else {
      console.warn('Unable to copy file path to clipboard:', item.path);
    }
  };

  const buildProjectFileContextItem = useCallback((item) => ({
    name: item.name,
    path: item.path,
    absolutePath: item.path,
    kind: item.type === 'directory' ? 'directory' : 'file',
  }), []);

  const handleAddItemToNewChat = useCallback((e, item) => {
    e.stopPropagation();
    if (!selectedProject || !onStartWorkspaceQa) {
      return;
    }

    onStartWorkspaceQa(selectedProject, '', {
      projectFiles: [buildProjectFileContextItem(item)],
    });
  }, [buildProjectFileContextItem, onStartWorkspaceQa, selectedProject]);

  const renderRowActions = (item, className = 'flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity') => (
    <span className={className}>
      {item.type === 'directory' && (
        <>
          <button
            className="p-0.5 rounded hover:bg-accent"
            title="New Folder"
            onClick={(e) => startCreateFolder(e, item.path)}
            disabled={creatingFolder}
          >
            <FolderPlus className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button
            className="p-0.5 rounded hover:bg-accent"
            title={t('fileTree.uploadToFolder')}
            onClick={(e) => { e.stopPropagation(); uploadTargetDirRef.current = item.path; fileInputRef.current?.click(); }}
          >
            <UploadCloud className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </>
      )}
      {(item.type === 'file' || item.type === 'directory') && (
        <button
          className="p-0.5 rounded hover:bg-accent"
          title={t('fileTree.addToNewChat')}
          onClick={(e) => handleAddItemToNewChat(e, item)}
        >
          <MessageSquarePlus className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
        </button>
      )}
      <button
        className="p-0.5 rounded hover:bg-accent"
        title={t('fileTree.copyPath')}
        onClick={(e) => handleCopyPath(e, item)}
      >
        {copiedPath === item.path
          ? <Check className="w-3.5 h-3.5 text-primary" />
          : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      <button
        className="p-0.5 rounded hover:bg-muted"
        title={t('fileTree.deleteFile')}
        onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
      >
        <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-primary" />
      </button>
    </span>
  );

  const handleDelete = useCallback(async (item) => {
    if (!selectedProject) return;
    const confirmed = window.confirm(t('fileTree.confirmDelete', { name: item.name }));
    if (!confirmed) return;
    setDeleting(true);
    try {
      const res = await api.deleteFile(selectedProject.name, item.path);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Delete failed (${res.status})`);
      }
      await fetchFiles();
      dispatchProjectFilesChanged({ projectName: selectedProject.name });
    } catch (err) {
      alert(err.message);
    } finally {
      setDeleting(false);
    }
  }, [fetchFiles, selectedProject, t]);

  useEffect(() => {
    fileTreeMaxDepthRef.current = FILE_TREE_INITIAL_MAX_DEPTH;
    void fetchFiles({ maxDepth: FILE_TREE_INITIAL_MAX_DEPTH });
  }, [fetchFiles]);

  useEffect(() => {
    if (!enableAutoRefresh || !autoRefreshMenuOpen || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (autoRefreshMenuRef.current && !autoRefreshMenuRef.current.contains(event.target)) {
        setAutoRefreshMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setAutoRefreshMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [autoRefreshMenuOpen, enableAutoRefresh]);

  useEffect(() => {
    if (!enableAutoRefresh || typeof window === 'undefined' || !selectedProject?.name || autoRefreshIntervalMs <= 0) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void fetchFiles({ silent: true });
    }, autoRefreshIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [autoRefreshIntervalMs, enableAutoRefresh, fetchFiles, selectedProject?.name]);

  useEffect(() => {
    if (typeof window === 'undefined' || !selectedProject?.name) {
      return undefined;
    }

    const handleProjectFileMoved = (event) => {
      const detail = event.detail || {};
      if (detail.projectName !== selectedProject.name) {
        return;
      }

      void fetchFiles();
    };

    window.addEventListener(PROJECT_FILE_MOVED_EVENT, handleProjectFileMoved);
    return () => window.removeEventListener(PROJECT_FILE_MOVED_EVENT, handleProjectFileMoved);
  }, [fetchFiles, selectedProject?.name]);

  useEffect(() => {
    setSelectedImage(null);
  }, [selectedProject?.name]);

  useEffect(() => {
    const visibleFiles = sortDisplayFileTree(hideInternalFileTreeItems(files));

    if (!searchQuery.trim()) {
      setFilteredFiles(visibleFiles);
    } else {
      const filtered = filterFiles(visibleFiles, searchQuery.toLowerCase());
      setFilteredFiles(filtered);
      const pathsToExpand = [];

      const expandMatches = (items) => {
        items.forEach(item => {
          if (item.type === 'directory' && item.children && item.children.length > 0) {
            pathsToExpand.push(item.path);
            expandMatches(item.children);
          }
        });
      };
      expandMatches(filtered);
      if (pathsToExpand.length > 0) {
        setExpandedDirs(prev => {
          const next = new Set(prev);
          pathsToExpand.forEach((path) => next.add(path));
          return next;
        });
      }
    }
  }, [fileTreeLocaleKey, files, searchQuery]);

  const filterFiles = (items, query, level = 0) => {
    return items.reduce((filtered, item) => {
      const displayName = getFileTreeDisplayName(item, level, fileTreeLocaleKey);
      const matchesName = item.name.toLowerCase().includes(query)
        || displayName.toLowerCase().includes(query);
      let filteredChildren = [];

      if (item.type === 'directory' && item.children) {
        filteredChildren = filterFiles(item.children, query, level + 1);
      }

      if (matchesName || filteredChildren.length > 0) {
        filtered.push({
          ...item,
          children: filteredChildren
        });
      }

      return filtered;
    }, []);
  };

  const toggleDirectory = (item) => {
    const path = typeof item === 'string' ? item : item.path;
    const willExpand = !expandedDirs.has(path);
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedDirs(newExpanded);

    if (
      willExpand &&
      item &&
      typeof item !== 'string' &&
      item.type === 'directory' &&
      !Array.isArray(item.children)
    ) {
      void loadDirectoryChildren(path);
    }
  };

  const changeViewMode = (mode) => {
    setViewMode(mode);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('file-tree-view-mode', mode);
    }
  };

  const autoRefreshLabel = t(`fileTree.autoRefreshOptions.${autoRefreshIntervalMs}`);
  const visibleDirectoryPaths = useMemo(
    () => collectDirectoryPaths(filteredFiles),
    [filteredFiles]
  );
  const unloadedVisibleDirectoryPaths = useMemo(
    () => collectUnloadedDirectoryPaths(filteredFiles),
    [filteredFiles]
  );
  const expandedVisibleDirectoryCount = useMemo(
    () => visibleDirectoryPaths.filter((path) => expandedDirs.has(path)).length,
    [expandedDirs, visibleDirectoryPaths]
  );
  const canToggleAllDirectories = visibleDirectoryPaths.length > 0;
  const shouldCollapseAllDirectories = canToggleAllDirectories
    && expandedVisibleDirectoryCount === visibleDirectoryPaths.length;
  const toggleAllDirectoriesLabel = t(
    shouldCollapseAllDirectories ? 'fileTree.collapseAll' : 'fileTree.expandAll'
  );

  const handleToggleAllDirectories = useCallback(() => {
    if (visibleDirectoryPaths.length === 0) {
      return;
    }

    if (shouldCollapseAllDirectories) {
      setExpandedDirs(new Set());
      return;
    }

    setExpandedDirs((prev) => {
      const next = new Set(prev);
      visibleDirectoryPaths.forEach((path) => next.add(path));
      return next;
    });
    unloadedVisibleDirectoryPaths.forEach((path) => {
      void loadDirectoryChildren(path);
    });
  }, [loadDirectoryChildren, shouldCollapseAllDirectories, unloadedVisibleDirectoryPaths, visibleDirectoryPaths]);

  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatRelativeTime = (date) => {
    if (!date) return '-';
    const now = new Date();
    const past = new Date(date);
    const diffInSeconds = Math.floor((now - past) / 1000);

    if (diffInSeconds < 60) return t('fileTree.justNow');
    if (diffInSeconds < 3600) return t('fileTree.minAgo', { count: Math.floor(diffInSeconds / 60) });
    if (diffInSeconds < 86400) return t('fileTree.hoursAgo', { count: Math.floor(diffInSeconds / 3600) });
    if (diffInSeconds < 2592000) return t('fileTree.daysAgo', { count: Math.floor(diffInSeconds / 86400) });
    return past.toLocaleDateString();
  };

  const formatExactTime = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleString();
  };

  const getFileIcon = (filename) => {
    const { icon: Icon } = getFileIconData(filename);
    return <Icon className={cn(ICON_SIZE, 'text-muted-foreground')} />;
  };

  const visibleImageFiles = useMemo(() => {
    const items = [];

    const walk = (nodes) => {
      nodes.forEach((item) => {
        if (item.type === 'file' && isImageFilename(item.name)) {
          items.push({
            name: item.name,
            path: item.path,
            projectName: selectedProject?.name,
          });
        }

        if (item.type === 'directory' && Array.isArray(item.children) && item.children.length > 0) {
          walk(item.children);
        }
      });
    };

    walk(filteredFiles);
    return items;
  }, [filteredFiles, selectedProject?.name]);
  const visibleMarkdownFiles = useMemo(() => {
    const items = [];

    const walk = (nodes) => {
      nodes.forEach((item) => {
        if (item.type === 'file' && isMarkdownFilename(item.name)) {
          items.push({
            name: item.name,
            path: item.path,
            projectName: selectedProject?.name,
          });
        }

        if (item.type === 'directory' && Array.isArray(item.children) && item.children.length > 0) {
          walk(item.children);
        }
      });
    };

    walk(filteredFiles);
    return items;
  }, [filteredFiles, selectedProject?.name]);

  const selectedImageIndex = useMemo(() => {
    if (!selectedImage) {
      return -1;
    }
    return visibleImageFiles.findIndex((item) => item.path === selectedImage.path);
  }, [selectedImage, visibleImageFiles]);

  const handleSelectAdjacentImage = useCallback((direction) => {
    if (selectedImageIndex < 0) {
      return;
    }

    const nextImage = visibleImageFiles[selectedImageIndex + direction];
    if (nextImage) {
      setSelectedImage(nextImage);
    }
  }, [selectedImageIndex, visibleImageFiles]);

  // ── Click handler shared across all view modes ──
  const handleItemClick = (item) => {
    if (item.type === 'directory') {
      toggleDirectory(item);
    } else if (isImageFilename(item.name)) {
      if (onFileOpen) {
        onFileOpen(item.path, {
          __chatPreviewNavigation: {
            kind: 'image-gallery',
            paths: visibleImageFiles.map((image) => image.path),
          },
        });
        return;
      }
      const nextImage = visibleImageFiles.find((image) => image.path === item.path) || {
        name: item.name,
        path: item.path,
        projectName: selectedProject.name,
      };
      setSelectedImage(nextImage);
    } else if (isMarkdownFilename(item.name) && onFileOpen) {
      const itemDirectory = getParentDirectoryPath(item.path);
      const siblingMarkdownPaths = visibleMarkdownFiles
        .filter((file) => getParentDirectoryPath(file.path) === itemDirectory)
        .map((file) => file.path);

      onFileOpen(item.path, {
        __chatPreviewNavigation: {
          kind: 'markdown-gallery',
          paths: siblingMarkdownPaths,
        },
      });
    } else if (onFileOpen) {
      onFileOpen(item.path);
    }
  };

  const getItemDragProps = (item) => {
    if (item.type === 'directory') {
      return {
        draggable: !movingPath,
        onDragStart: (e) => handleItemDragStart(e, item),
        onDragEnd: handleItemDragEnd,
        onDragOver: (e) => handleDirectoryDragOver(e, item.path),
        onDragLeave: (e) => handleDirectoryDragLeave(e, item.path),
        onDrop: (e) => handleDirectoryDrop(e, item.path),
      };
    }

    return {
      draggable: !movingPath,
      onDragStart: (e) => handleItemDragStart(e, item),
      onDragEnd: handleItemDragEnd,
    };
  };

  const getItemDragClass = (item) => cn(
    (item.type === 'file' || item.type === 'directory') && !movingPath && 'cursor-grab active:cursor-grabbing',
    movingPath === item.path && 'opacity-50'
  );

  const renderNewFolderInput = (parentPath, level = 0) => {
    if (newFolderParentPath !== parentPath) {
      return null;
    }

    return (
      <div
        className="flex items-center gap-1.5 rounded-sm border-l-2 border-primary/30 bg-accent/40 py-1 pr-2"
        style={{ paddingLeft: `${level * 16 + 4}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="flex items-center flex-shrink-0 ml-[18px]">
          <FolderPlus className="w-4 h-4 text-blue-500" />
        </span>
        <Input
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void handleCreateFolder(e);
            } else if (e.key === 'Escape') {
              cancelCreateFolder(e);
            }
          }}
          placeholder="Folder name"
          className="h-7 min-w-0 flex-1 text-xs"
          autoFocus
          disabled={creatingFolder}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleCreateFolder}
          disabled={creatingFolder || !newFolderName.trim()}
          title="Create Folder"
        >
          {creatingFolder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={cancelCreateFolder}
          disabled={creatingFolder}
          title="Cancel"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  };

  const renderDirectoryLoadingRow = (level) => (
    <div
      className="flex items-center gap-1.5 py-1 pr-2 text-xs text-muted-foreground"
      style={{ paddingLeft: `${level * 16 + 26}px` }}
    >
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      <span>{t('fileTree.loading')}</span>
    </div>
  );

  // ── Indent guide + folder/file icon rendering ──
  const renderIndentGuides = (level) => {
    if (level === 0) return null;
    return (
      <span className="flex items-center flex-shrink-0" aria-hidden="true">
        {Array.from({ length: level }).map((_, i) => (
          <span
            key={i}
            className="inline-block w-4 h-full border-l border-border/50"
          />
        ))}
      </span>
    );
  };

  const renderItemIcons = (item) => {
    const isDir = item.type === 'directory';
    const isOpen = expandedDirs.has(item.path);
    const isLoadingDir = isDir && loadingDirs.has(item.path);

    if (isDir) {
      return (
        <span className="flex items-center gap-0.5 flex-shrink-0">
          {isLoadingDir ? (
            <Loader2 className="w-3.5 h-3.5 text-muted-foreground/70 animate-spin" />
          ) : (
            <ChevronRight
              className={cn(
                'w-3.5 h-3.5 text-muted-foreground/70 transition-transform duration-150',
                isOpen && 'rotate-90'
              )}
            />
          )}
          {isOpen ? (
            <FolderOpen className="w-4 h-4 text-primary flex-shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}
        </span>
      );
    }

    return (
      <span className="flex items-center flex-shrink-0 ml-[18px]">
        {getFileIcon(item.name)}
      </span>
    );
  };

  // ─── Simple (Tree) View ────────────────────────────────────────────
  const renderFileTree = (items, level = 0) => {
    return items.map((item) => {
      const isDir = item.type === 'directory';
      const isOpen = isDir && expandedDirs.has(item.path);
      const displayName = getFileTreeDisplayName(item, level, fileTreeLocaleKey);
      return (
        <div key={item.path} className="select-none">
          <div
            data-file-tree-item-row="true"
            className={cn(
              'group flex items-center gap-1.5 py-[3px] pr-2 cursor-pointer rounded-sm',
              'hover:bg-accent/60 transition-colors duration-100',
              isDir && isOpen && 'border-l-2 border-primary/30',
              isDir && !isOpen && 'border-l-2 border-transparent',
              !isDir && 'border-l-2 border-transparent',
              isDir && dragOverDir === item.path && 'bg-primary/10 ring-1 ring-primary/40',
              getItemDragClass(item),
            )}
            style={{ paddingLeft: `${level * 16 + 4}px` }}
            onClick={() => handleItemClick(item)}
            {...getItemDragProps(item)}
          >
            {renderItemIcons(item)}
            <span className={cn(
              'text-[13px] leading-tight truncate flex-1',
              isDir ? 'font-medium text-foreground' : 'text-foreground/90'
            )} title={getFileTreeDisplayTitle(item, displayName)}>
              {displayName}
            </span>
            {renderRowActions(item)}
          </div>

          {isDir && renderNewFolderInput(item.path, level + 1)}

          {isDir && isOpen && loadingDirs.has(item.path) && !Array.isArray(item.children) && (
            renderDirectoryLoadingRow(level + 1)
          )}

          {isDir && isOpen && item.children && item.children.length > 0 && (
            <div className="relative">
              <span
                className="absolute top-0 bottom-0 border-l border-border/40"
                style={{ left: `${level * 16 + 14}px` }}
                aria-hidden="true"
              />
              {renderFileTree(item.children, level + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  // ─── Detailed View ────────────────────────────────────────────────
  const renderDetailedView = (items, level = 0) => {
    return items.map((item) => {
      const isDir = item.type === 'directory';
      const isOpen = isDir && expandedDirs.has(item.path);
      const displayName = getFileTreeDisplayName(item, level, fileTreeLocaleKey);
      return (
        <div key={item.path} className="select-none">
          <div
            data-file-tree-item-row="true"
            className={cn(
              'group grid grid-cols-12 gap-2 py-[3px] pr-2 hover:bg-accent/60 cursor-pointer items-center rounded-sm transition-colors duration-100',
              isDir && isOpen && 'border-l-2 border-primary/30',
              isDir && !isOpen && 'border-l-2 border-transparent',
              !isDir && 'border-l-2 border-transparent',
              isDir && dragOverDir === item.path && 'bg-primary/10 ring-1 ring-primary/40',
              getItemDragClass(item),
            )}
            style={{ paddingLeft: `${level * 16 + 4}px` }}
            onClick={() => handleItemClick(item)}
            {...getItemDragProps(item)}
          >
            <div className="col-span-7 flex items-center gap-1.5 min-w-0">
              {renderItemIcons(item)}
              <span className={cn(
                'text-[13px] leading-tight truncate flex-1',
                isDir ? 'font-medium text-foreground' : 'text-foreground/90'
              )} title={getFileTreeDisplayTitle(item, displayName)}>
                {displayName}
              </span>
              {renderRowActions(item)}
            </div>
            <div className="col-span-2 text-xs text-muted-foreground tabular-nums">
              {item.type === 'file' ? formatFileSize(item.size) : ''}
            </div>
            <div className="col-span-3 text-xs text-muted-foreground">
              {formatRelativeTime(item.modified)}
            </div>
          </div>

          {isDir && renderNewFolderInput(item.path, level + 1)}

          {isDir && isOpen && loadingDirs.has(item.path) && !Array.isArray(item.children) && (
            renderDirectoryLoadingRow(level + 1)
          )}

          {isDir && isOpen && item.children && (
            <div className="relative">
              <span
                className="absolute top-0 bottom-0 border-l border-border/40"
                style={{ left: `${level * 16 + 14}px` }}
                aria-hidden="true"
              />
              {renderDetailedView(item.children, level + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  // ─── Compact View ──────────────────────────────────────────────────
  const renderCompactView = (items, level = 0) => {
    return items.map((item) => {
      const isDir = item.type === 'directory';
      const isOpen = isDir && expandedDirs.has(item.path);
      const displayName = getFileTreeDisplayName(item, level, fileTreeLocaleKey);
      return (
        <div key={item.path} className="select-none">
          <div
            data-file-tree-item-row="true"
            className={cn(
              'group flex items-center justify-between py-[3px] pr-2 hover:bg-accent/60 cursor-pointer rounded-sm transition-colors duration-100',
              isDir && isOpen && 'border-l-2 border-primary/30',
              isDir && !isOpen && 'border-l-2 border-transparent',
              !isDir && 'border-l-2 border-transparent',
              isDir && dragOverDir === item.path && 'bg-primary/10 ring-1 ring-primary/40',
              getItemDragClass(item),
            )}
            style={{ paddingLeft: `${level * 16 + 4}px` }}
            onClick={() => handleItemClick(item)}
            {...getItemDragProps(item)}
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {renderItemIcons(item)}
              <span className={cn(
                'text-[13px] leading-tight truncate',
                isDir ? 'font-medium text-foreground' : 'text-foreground/90'
              )} title={getFileTreeDisplayTitle(item, displayName)}>
                {displayName}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-shrink-0 ml-2">
              {item.type === 'file' && (
                <span className="tabular-nums">{formatFileSize(item.size)}</span>
              )}
              <span className="tabular-nums whitespace-nowrap" title={formatExactTime(item.modified)}>
                {formatRelativeTime(item.modified)}
              </span>
              {renderRowActions(item, 'flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity')}
            </div>
          </div>

          {isDir && renderNewFolderInput(item.path, level + 1)}

          {isDir && isOpen && loadingDirs.has(item.path) && !Array.isArray(item.children) && (
            renderDirectoryLoadingRow(level + 1)
          )}

          {isDir && isOpen && item.children && (
            <div className="relative">
              <span
                className="absolute top-0 bottom-0 border-l border-border/40"
                style={{ left: `${level * 16 + 14}px` }}
                aria-hidden="true"
              />
              {renderCompactView(item.children, level + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  // ─── Loading state ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={cn('flex h-full items-center justify-center', embedded ? 'bg-card' : 'bg-background')}>
        <div className="text-muted-foreground text-sm">
          {t('fileTree.loading')}
        </div>
      </div>
    );
  }

  // ─── Main render ───────────────────────────────────────────────────
  return (
    <div className={cn('flex h-full flex-col', embedded ? 'bg-card' : 'bg-background')}>
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('fileTree.files')}
          </h3>
          <div className="flex items-center gap-0.5">
            {enableAutoRefresh && (
              <div className="relative" ref={autoRefreshMenuRef}>
                <Button
                  variant={autoRefreshIntervalMs > 0 ? 'secondary' : 'ghost'}
                  size="sm"
                  type="button"
                  className={cn(
                    'h-7 min-w-[58px] px-1.5 gap-1 text-[11px] tabular-nums',
                    autoRefreshMenuOpen && 'bg-accent text-accent-foreground'
                  )}
                  onClick={() => setAutoRefreshMenuOpen((open) => !open)}
                  title={t('fileTree.autoRefresh')}
                  aria-label={t('fileTree.autoRefresh')}
                  aria-haspopup="menu"
                  aria-expanded={autoRefreshMenuOpen}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span className="leading-none">{autoRefreshLabel}</span>
                  <ChevronDown className={cn('w-3 h-3 transition-transform', autoRefreshMenuOpen && 'rotate-180')} />
                </Button>

                {autoRefreshMenuOpen && (
                  <div
                    className="absolute right-0 top-full z-50 mt-1 w-28 overflow-hidden rounded-md border border-border bg-background py-1 shadow-lg"
                    role="menu"
                    aria-label={t('fileTree.autoRefresh')}
                  >
                    {AUTO_REFRESH_INTERVAL_OPTIONS.map((intervalMs) => {
                      const isSelected = intervalMs === autoRefreshIntervalMs;

                      return (
                        <button
                          key={intervalMs}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isSelected}
                          className={cn(
                            'flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                            isSelected && 'bg-accent text-accent-foreground'
                          )}
                          onClick={() => {
                            changeAutoRefreshInterval(intervalMs);
                            setAutoRefreshMenuOpen(false);
                          }}
                        >
                          <span>{t(`fileTree.autoRefreshOptions.${intervalMs}`)}</span>
                          {isSelected && <Check className="w-3.5 h-3.5" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="h-7 w-7 p-0"
              onClick={handleToggleAllDirectories}
              title={toggleAllDirectoriesLabel}
              aria-label={toggleAllDirectoriesLabel}
              disabled={!canToggleAllDirectories}
            >
              {shouldCollapseAllDirectories
                ? <Folder className="w-3.5 h-3.5" />
                : <FolderOpen className="w-3.5 h-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={(e) => startCreateFolder(e, '')}
              title="New Folder"
              disabled={creatingFolder}
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => { uploadTargetDirRef.current = ''; fileInputRef.current?.click(); }}
              title={t('fileTree.uploadFiles')}
              disabled={uploading}
            >
              <UploadCloud className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant={viewMode === 'compact' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => changeViewMode(viewMode === 'compact' ? 'detailed' : 'compact')}
              title={viewMode === 'compact' ? t('fileTree.detailedView') : t('fileTree.compactView')}
              aria-label={viewMode === 'compact' ? t('fileTree.detailedView') : t('fileTree.compactView')}
            >
              <Eye className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={handleManualRefresh}
              title={t('fileTree.refresh')}
              disabled={refreshing}
            >
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder={t('fileTree.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-7 pr-7 h-7 text-xs"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-0.5 top-1/2 transform -translate-y-1/2 h-5 w-5 p-0 hover:bg-accent"
              onClick={() => setSearchQuery('')}
              title={t('fileTree.clearSearch')}
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Column Headers for Detailed View */}
      {viewMode === 'detailed' && filteredFiles.length > 0 && (
        <div className="px-3 pt-1.5 pb-1 border-b border-border">
          <div className="grid grid-cols-12 gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            <div className="col-span-7">{t('fileTree.name')}</div>
            <div className="col-span-2">{t('fileTree.size')}</div>
            <div className="col-span-3">{t('fileTree.modified')}</div>
          </div>
        </div>
      )}

      {/* Upload status bar */}
      {uploading && (
        <div className="px-3 py-1.5 border-b border-border flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {t('fileTree.uploading')}
        </div>
      )}
      {uploadError && (
        <div className="px-3 py-1.5 border-b border-border text-xs text-foreground">
          {uploadError}
        </div>
      )}
      {uploadSuccess && (
        <div className="px-3 py-1.5 border-b border-border text-xs text-primary">
          {uploadSuccess}
        </div>
      )}

      <input
        type="file"
        ref={fileInputRef}
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />
      <div
        className="flex-1 relative min-h-0 overflow-hidden"
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
      >
        <ScrollArea className="h-full px-2 py-1">
          {files.length === 0 && newFolderParentPath !== '' ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-3">
                <Folder className="w-6 h-6 text-muted-foreground" />
              </div>
              <h4 className="font-medium text-foreground mb-1">{t('fileTree.noFilesFound')}</h4>
              <p className="text-sm text-muted-foreground">
                {t('fileTree.checkProjectPath')}
              </p>
            </div>
          ) : filteredFiles.length === 0 && searchQuery ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-3">
                <Search className="w-6 h-6 text-muted-foreground" />
              </div>
              <h4 className="font-medium text-foreground mb-1">{t('fileTree.noMatchesFound')}</h4>
              <p className="text-sm text-muted-foreground">
                {t('fileTree.tryDifferentSearch')}
              </p>
            </div>
          ) : (
            <div>
              {renderNewFolderInput('', 0)}
              {viewMode === 'simple' && renderFileTree(filteredFiles)}
              {viewMode === 'compact' && renderCompactView(filteredFiles)}
              {viewMode === 'detailed' && renderDetailedView(filteredFiles)}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Image Viewer Modal */}
      {selectedImage && (
        <ImageViewer
          file={selectedImage}
          onClose={() => setSelectedImage(null)}
          onPrevious={() => handleSelectAdjacentImage(-1)}
          onNext={() => handleSelectAdjacentImage(1)}
          hasPrevious={selectedImageIndex > 0}
          hasNext={selectedImageIndex >= 0 && selectedImageIndex < visibleImageFiles.length - 1}
          positionLabel={
            selectedImageIndex >= 0 && visibleImageFiles.length > 1
              ? t('fileTree.imageViewer.position', { current: selectedImageIndex + 1, total: visibleImageFiles.length })
              : null
          }
        />
      )}
    </div>
  );
}

export default FileTree;
