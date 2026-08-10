import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';

import { getMinerUCredentials } from '../../utils/mineruCredentials.js';
import { scoreParsedDocument } from './parse-quality.js';

const DEFAULT_MINERU_BASE_URL = 'https://mineru.net';
const MINERU_BATCH_UPLOAD_PATH = '/api/v4/file-urls/batch';
const MINERU_BATCH_RESULT_PATH = '/api/v4/extract-results/batch';

function getMinerUConfig(userId = null) {
  const credentials = getMinerUCredentials(userId);
  return {
    apiKey: credentials.apiToken,
    baseUrl: process.env.MINERU_API_BASE_URL || DEFAULT_MINERU_BASE_URL,
    timeoutMs: Number(process.env.MINERU_TIMEOUT_MS || 300000),
    pollIntervalMs: Number(process.env.MINERU_POLL_INTERVAL_MS || 3000),
    modelVersion: process.env.MINERU_MODEL_VERSION || 'vlm',
  };
}

function joinUrl(baseUrl, pathname) {
  const normalizedBase = String(baseUrl || DEFAULT_MINERU_BASE_URL).replace(/\/+$/, '');
  return `${normalizedBase}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function unwrapMinerUResponse(payload, action) {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`MinerU ${action} returned an empty response`);
  }

  const code = payload.code ?? payload.err_code;
  const isSuccessCode = code == null || code === 0 || code === '0' || code === 200 || code === '200';
  if (!isSuccessCode) {
    throw new Error(payload.msg || payload.message || payload.error || `MinerU ${action} failed with code ${code}`);
  }

  return payload.data ?? payload;
}

async function fetchMinerUJson(url, init, action) {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = safeJsonParse(text);
  if (!response.ok) {
    throw new Error(`MinerU ${action} failed (${response.status}): ${text.slice(0, 500)}`);
  }
  if (!payload) {
    throw new Error(`MinerU ${action} returned non-JSON response`);
  }

  return unwrapMinerUResponse(payload, action);
}

function getOptionValue(options, snakeKey, camelKey = snakeKey.replace(/_([a-z])/g, (_, char) => char.toUpperCase())) {
  if (Object.prototype.hasOwnProperty.call(options || {}, snakeKey)) return options[snakeKey];
  if (Object.prototype.hasOwnProperty.call(options || {}, camelKey)) return options[camelKey];
  return undefined;
}

function sanitizeMinerUDataId(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9_.-]/g, '_')
    .slice(0, 128)
    || `pdf_${Date.now()}`;
}

function sanitizeOutputBasename(value) {
  return String(value || 'document')
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 140)
    || 'document';
}

async function createMinerUBatchTask({ pdfPath, options, config }) {
  const stats = await fsPromises.stat(pdfPath);
  const dataId = sanitizeMinerUDataId(
    getOptionValue(options, 'data_id', 'dataId')
      || `${path.basename(pdfPath)}-${stats.size}-${Math.round(stats.mtimeMs)}`,
  );
  const modelVersion = getOptionValue(options, 'model_version', 'modelVersion') || config.modelVersion;
  const fileEntry = {
    name: path.basename(pdfPath),
    data_id: dataId,
  };
  const isOcr = getOptionValue(options, 'is_ocr', 'isOcr');
  const pageRanges = getOptionValue(options, 'page_ranges', 'pageRanges') ?? getOptionValue(options, 'page_range', 'pageRange');
  if (isOcr !== undefined) fileEntry.is_ocr = isOcr;
  if (pageRanges !== undefined) fileEntry.page_ranges = pageRanges;

  const body = {
    files: [fileEntry],
    model_version: modelVersion,
  };

  [
    'enable_formula',
    'enable_table',
    'language',
    'extra_formats',
    'callback',
    'seed',
  ].forEach((key) => {
    const value = getOptionValue(options, key);
    if (value !== undefined) body[key] = value;
  });

  const data = await fetchMinerUJson(joinUrl(config.baseUrl, MINERU_BATCH_UPLOAD_PATH), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, 'batch upload URL creation');

  const batchId = data.batch_id || data.batchId || data.id;
  const fileUrls = data.file_urls || data.fileUrls || data.files || data.urls || [];
  const firstFile = Array.isArray(fileUrls) ? fileUrls[0] : fileUrls;
  const uploadUrl = typeof firstFile === 'string'
    ? firstFile
    : firstFile?.url || firstFile?.upload_url || firstFile?.uploadUrl || firstFile?.presigned_url || firstFile?.presignedUrl;

  if (!batchId || !uploadUrl) {
    throw new Error('MinerU did not return batch_id and upload URL');
  }

  return { batchId, uploadUrl, dataId };
}

async function uploadPdfToSignedUrl({ pdfPath, uploadUrl }) {
  const stats = await fsPromises.stat(pdfPath);
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': String(stats.size),
    },
    body: fs.createReadStream(pdfPath),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`MinerU PDF upload failed (${response.status}): ${text.slice(0, 500)}`);
  }
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function getBatchResultItem(data, dataId) {
  const resultList = data.extract_result
    || data.extractResults
    || data.results
    || data.files
    || data.file_results
    || data.fileResults
    || [];
  const items = Array.isArray(resultList) ? resultList : [resultList];
  return items.find((item) => item?.data_id === dataId || item?.dataId === dataId) || items[0] || data;
}

async function pollMinerUBatchResult({ batchId, dataId, config }) {
  const deadline = Date.now() + config.timeoutMs;
  let lastItem = null;

  while (Date.now() < deadline) {
    const data = await fetchMinerUJson(
      joinUrl(config.baseUrl, `${MINERU_BATCH_RESULT_PATH}/${encodeURIComponent(batchId)}`),
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      },
      'batch result polling',
    );
    const item = getBatchResultItem(data, dataId);
    lastItem = item;
    const status = normalizeStatus(item?.state || item?.status || item?.extract_status || item?.extractStatus || data?.status);

    if (item?.full_zip_url || item?.fullZipUrl || item?.zip_url || item?.zipUrl || item?.md_url || item?.markdown_url || item?.markdownUrl) {
      return item;
    }
    if (['done', 'finished', 'success', 'succeeded', 'completed', 'parsed'].includes(status)) {
      return item;
    }
    if (['failed', 'error', 'canceled', 'cancelled', 'timeout'].includes(status)) {
      throw new Error(item?.err_msg || item?.error || item?.message || `MinerU parsing failed with status ${status}`);
    }

    await delay(config.pollIntervalMs);
  }

  throw new Error(`MinerU parsing timed out after ${Math.round(config.timeoutMs / 1000)}s. Last status: ${normalizeStatus(lastItem?.status || lastItem?.state) || 'unknown'}`);
}

async function downloadBuffer(url, action) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.MINERU_DOWNLOAD_TIMEOUT_MS || 180000));
  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`MinerU ${action} download failed (${response.status}): ${text.slice(0, 500)}`);
    }

    return response.buffer();
  } finally {
    clearTimeout(timeout);
  }
}

async function listFilesRecursive(directory) {
  const results = [];
  async function visit(current) {
    const entries = await fsPromises.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        results.push(entryPath);
      }
    }
  }
  await visit(directory);
  return results;
}

function pickMarkdownFile(files) {
  const markdownFiles = files.filter((file) => /\.md$/i.test(file));
  return markdownFiles.find((file) => /(^|[/\\])full\.md$/i.test(file))
    || markdownFiles.find((file) => /(^|[/\\])document\.md$/i.test(file))
    || markdownFiles[0]
    || null;
}

function pickTablesFile(files) {
  const jsonFiles = files.filter((file) => /\.json$/i.test(file));
  return jsonFiles.find((file) => /table/i.test(path.basename(file)))
    || jsonFiles.find((file) => /middle\.json$/i.test(path.basename(file)))
    || null;
}

async function extractMinerUZipResult({ zipUrl, outputDir }) {
  const rawDir = path.join(outputDir, 'raw');
  await fsPromises.mkdir(rawDir, { recursive: true });
  const archiveBuffer = await downloadBuffer(zipUrl, 'result zip');
  const archivePath = path.join(rawDir, 'mineru-result.zip');
  await fsPromises.writeFile(archivePath, archiveBuffer);

  const zip = new AdmZip(archiveBuffer);
  zip.extractAllTo(rawDir, true);
  const files = await listFilesRecursive(rawDir);
  const markdownPath = pickMarkdownFile(files);
  if (!markdownPath) {
    throw new Error('MinerU result zip did not contain a Markdown file');
  }

  const tablesPath = pickTablesFile(files);
  const figurePaths = files.filter((file) => /\.(png|jpe?g|webp)$/i.test(file));
  const markdown = await fsPromises.readFile(markdownPath, 'utf8');
  let tables = [];
  if (tablesPath) {
    try {
      tables = JSON.parse(await fsPromises.readFile(tablesPath, 'utf8'));
    } catch {
      tables = [];
    }
  }

  return {
    markdown,
    tables,
    pageMap: {},
    figurePaths,
    metadata: {
      resultSource: 'full_zip_url',
      rawDir,
      archivePath,
      markdownPath,
      tablesPath,
    },
  };
}

async function fetchMarkdownResult({ markdownUrl }) {
  const buffer = await downloadBuffer(markdownUrl, 'Markdown');
  return {
    markdown: buffer.toString('utf8'),
    tables: [],
    pageMap: {},
    figurePaths: [],
    metadata: { resultSource: 'markdown_url' },
  };
}

async function callMinerUProvider({ pdfPath, outputDir, options, config }) {
  if (!config.apiKey) {
    return {
      status: 'failed',
      error: 'MinerU is not configured. Add a MinerU API token in Settings or set MINERU_API_TOKEN.',
    };
  }

  const { batchId, uploadUrl, dataId } = await createMinerUBatchTask({ pdfPath, options, config });
  await uploadPdfToSignedUrl({ pdfPath, uploadUrl });
  const result = await pollMinerUBatchResult({ batchId, dataId, config });
  const fullZipUrl = result.full_zip_url || result.fullZipUrl || result.zip_url || result.zipUrl;
  const markdownUrl = result.md_url || result.markdown_url || result.markdownUrl;

  if (fullZipUrl) {
    const zipResult = await extractMinerUZipResult({ zipUrl: fullZipUrl, outputDir });
    return {
      ...zipResult,
      metadata: {
        ...zipResult.metadata,
        batchId,
        dataId,
        providerStatus: result.status || result.state || result.extract_status || null,
      },
    };
  }
  if (markdownUrl) {
    const markdownResult = await fetchMarkdownResult({ markdownUrl });
    return {
      ...markdownResult,
      metadata: {
        ...markdownResult.metadata,
        batchId,
        dataId,
        providerStatus: result.status || result.state || result.extract_status || null,
      },
    };
  }

  return {
    status: 'failed',
    error: 'MinerU finished but did not return full_zip_url or markdown_url.',
  };
}

async function normalizeMinerUOutput({ outputDir, providerResult, outputBasename = 'document' }) {
  await fsPromises.mkdir(path.join(outputDir, 'figures'), { recursive: true });
  const basename = sanitizeOutputBasename(outputBasename);

  const paths = {
    markdownPath: path.join(outputDir, `${basename}.md`),
    tablesPath: path.join(outputDir, 'tables.json'),
    figuresDir: path.join(outputDir, 'figures'),
    pageMapPath: path.join(outputDir, 'page_map.json'),
    parseReportPath: path.join(outputDir, 'parse_report.json'),
  };

  if (providerResult?.markdown && !fs.existsSync(paths.markdownPath)) {
    await fsPromises.writeFile(paths.markdownPath, providerResult.markdown, 'utf8');
  }
  if (providerResult?.tables && !fs.existsSync(paths.tablesPath)) {
    await fsPromises.writeFile(paths.tablesPath, `${JSON.stringify(providerResult.tables, null, 2)}\n`, 'utf8');
  }
  if (providerResult?.pageMap && !fs.existsSync(paths.pageMapPath)) {
    await fsPromises.writeFile(paths.pageMapPath, `${JSON.stringify(providerResult.pageMap, null, 2)}\n`, 'utf8');
  }
  if (Array.isArray(providerResult?.figurePaths)) {
    for (const figurePath of providerResult.figurePaths) {
      const name = path.basename(figurePath);
      if (!name) continue;
      await fsPromises.copyFile(figurePath, path.join(paths.figuresDir, name)).catch(() => undefined);
    }
  }

  const hasMarkdown = fs.existsSync(paths.markdownPath);
  const hasTables = fs.existsSync(paths.tablesPath);
  const hasPageMap = fs.existsSync(paths.pageMapPath);

  if (!hasMarkdown) {
    return {
      status: 'failed',
      error: `MinerU provider did not produce ${basename}.md. Adjust the provider adapter for the configured API contract.`,
      ...paths,
      qualityScore: 0,
    };
  }

  if (!hasTables) {
    await fsPromises.writeFile(paths.tablesPath, '[]\n', 'utf8');
  }
  if (!hasPageMap) {
    await fsPromises.writeFile(paths.pageMapPath, '{}\n', 'utf8');
  }

  const quality = scoreParsedDocument(paths);
  await fsPromises.writeFile(paths.parseReportPath, `${JSON.stringify({
    parser: 'mineru',
    status: quality.level === 'failed' ? 'needs_review' : 'parsed',
    quality,
    providerResult: providerResult?.metadata || null,
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');

  return {
    status: quality.level === 'failed' ? 'needs_review' : 'parsed',
    ...paths,
    qualityScore: quality.score,
    error: null,
  };
}

export async function parsePdfWithMinerU({ pdfPath, outputDir, outputBasename = 'document', options = {}, userId = null } = {}) {
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    return { status: 'failed', error: 'PDF file does not exist', qualityScore: 0 };
  }

  await fsPromises.mkdir(outputDir, { recursive: true });
  const config = getMinerUConfig(userId);
  try {
    const providerResult = await callMinerUProvider({ pdfPath, outputDir, options, config });
    if (providerResult?.status === 'failed') {
      return {
        status: 'failed',
        error: providerResult.error || 'MinerU parsing failed',
        qualityScore: 0,
      };
    }
    return await normalizeMinerUOutput({ outputDir, providerResult, outputBasename });
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      qualityScore: 0,
    };
  }
}
