import path from 'path';
import { promises as fs } from 'fs';

const MAX_ARTIFACT_BYTES = 512 * 1024;
const TEXT_ARTIFACT_EXTENSIONS = new Set([
  '.csv',
  '.json',
  '.jsonl',
  '.md',
  '.markdown',
  '.rst',
  '.text',
  '.tsv',
  '.txt',
]);

const METRIC_PATTERNS = [
  { metric: 'HR', regex: /\b(?:HR|hazard ratio)\s*(?:=|:)?\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/i },
  { metric: 'OR', regex: /\b(?:OR|odds ratio)\s*(?:=|:)?\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/i },
  { metric: 'RR', regex: /\b(?:RR|risk ratio)\s*(?:=|:)?\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/i },
  { metric: 'AUC', regex: /\b(?:AUC|AUROC)\s*(?:=|:)?\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/i },
  { metric: 'C-index', regex: /\b(?:c-index|c index|concordance index)\s*(?:=|:)?\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/i },
  { metric: 'F1', regex: /\bF1\s*(?:score)?\s*(?:=|:)?\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?%?)/i },
  { metric: 'Accuracy', regex: /\baccuracy\s*(?:=|:)?\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?%?)/i },
  { metric: 'Sensitivity', regex: /\bsensitivity\s*(?:=|:)?\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?%?)/i },
  { metric: 'Specificity', regex: /\bspecificity\s*(?:=|:)?\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?%?)/i },
  { metric: 'Precision', regex: /\bprecision\s*(?:=|:)?\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?%?)/i },
  { metric: 'Recall', regex: /\brecall\s*(?:=|:)?\s*(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?%?)/i },
];

const METRIC_KEY_SPECS = [
  { metric: 'HR', keys: ['hr', 'hazard_ratio', 'hazardratio'] },
  { metric: 'OR', keys: ['or', 'odds_ratio', 'oddsratio'] },
  { metric: 'RR', keys: ['rr', 'risk_ratio', 'riskratio'] },
  { metric: 'AUC', keys: ['auc', 'auroc'] },
  { metric: 'C-index', keys: ['c_index', 'cindex', 'concordance_index'] },
  { metric: 'F1', keys: ['f1', 'f1_score'] },
  { metric: 'Accuracy', keys: ['accuracy'] },
  { metric: 'Sensitivity', keys: ['sensitivity'] },
  { metric: 'Specificity', keys: ['specificity'] },
  { metric: 'Precision', keys: ['precision'] },
  { metric: 'Recall', keys: ['recall'] },
];

const LABEL_KEYS = ['label', 'name', 'term', 'variable', 'outcome', 'endpoint', 'feature', 'comparison', 'group', 'model', 'biomarker', 'exposure'];
const PVALUE_KEYS = ['p', 'p_value', 'pvalue', 'adj_p', 'adjusted_p', 'q_value', 'qvalue'];
const CI_LOW_KEYS = ['ci_lower', 'ci_low', 'lower_ci', 'conf_low', 'confidence_low'];
const CI_HIGH_KEYS = ['ci_upper', 'ci_high', 'upper_ci', 'conf_high', 'confidence_high'];

function extractStructuredStatEntries(text, options = {}) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const findings = [];
  const seen = new Set();
  const candidates = text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.?!])\s+/))
    .map((entry) => compactWhitespace(entry))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.length < 12 || candidate.length > 360) {
      continue;
    }

    const parsed = parseStatCandidate(candidate, options);
    if (!parsed) {
      continue;
    }

    const key = parsed.summary.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    findings.push(parsed);
  }

  return findings;
}

async function extractConfirmedFindingsFromArtifact(projectPath, artifactPath) {
  if (!projectPath || !artifactPath) {
    return [];
  }

  const resolvedPath = resolveProjectArtifactPath(projectPath, artifactPath);
  if (!resolvedPath) {
    return [];
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!TEXT_ARTIFACT_EXTENSIONS.has(ext)) {
    return [];
  }

  let stat;
  try {
    stat = await fs.stat(resolvedPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) {
    return [];
  }

  const raw = await fs.readFile(resolvedPath, 'utf8');
  if (!raw.trim()) {
    return [];
  }

  const sourceFile = normalizeArtifactSourceFile(projectPath, artifactPath);
  if (ext === '.json') {
    try {
      const value = JSON.parse(raw);
      return dedupeStructuredFindings(extractFindingsFromJsonValue(value, { sourceFile }));
    } catch {
      return dedupeStructuredFindings(extractStructuredStatEntries(raw, { sourceFile }));
    }
  }

  if (ext === '.jsonl') {
    const entries = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 80);
    const findings = [];
    for (const line of entries) {
      try {
        findings.push(...extractFindingsFromJsonValue(JSON.parse(line), { sourceFile }));
      } catch {
        findings.push(...extractStructuredStatEntries(line, { sourceFile }));
      }
    }
    return dedupeStructuredFindings(findings);
  }

  if (ext === '.csv' || ext === '.tsv') {
    return dedupeStructuredFindings(extractFindingsFromDelimitedText(raw, ext === '.tsv' ? '\t' : ',', { sourceFile }));
  }

  return dedupeStructuredFindings(extractStructuredStatEntries(raw, { sourceFile }));
}

function parseStatCandidate(candidate, options = {}) {
  const metricMatch = METRIC_PATTERNS.find(({ regex }) => regex.test(candidate));
  const pValueMatch = candidate.match(/\bp\s*(<=|>=|=|<|>)\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)/i);
  const ciMatch = candidate.match(/\b(?:95%\s*)?CI\b[^0-9-]*([0-9]+(?:\.\d+)?)\s*(?:-|–|—|to|,)\s*([0-9]+(?:\.\d+)?)/i);

  if (!metricMatch && !pValueMatch && !ciMatch) {
    return null;
  }

  const valueMatch = metricMatch ? candidate.match(metricMatch.regex) : null;
  const metric = metricMatch?.metric || null;
  const value = valueMatch?.[1] || null;
  const pValue = pValueMatch ? `${pValueMatch[1]} ${pValueMatch[2]}` : null;
  const ci = ciMatch ? `${ciMatch[1]}-${ciMatch[2]}` : null;
  const summary = compactWhitespace(candidate);

  return {
    summary,
    metric,
    value,
    pValue,
    ci,
    sourceFile: options.sourceFile || null,
  };
}

function extractFindingsFromDelimitedText(raw, delimiter, options = {}) {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return extractStructuredStatEntries(raw, options);
  }

  const headers = splitDelimitedLine(lines[0], delimiter).map((entry) => normalizeHeader(entry));
  const labelIndexes = headers
    .map((header, index) => (LABEL_KEYS.includes(header) ? index : -1))
    .filter((index) => index >= 0);
  const pValueIndex = headers.findIndex((header) => PVALUE_KEYS.includes(header));
  const ciLowIndex = headers.findIndex((header) => CI_LOW_KEYS.includes(header));
  const ciHighIndex = headers.findIndex((header) => CI_HIGH_KEYS.includes(header));
  const explicitCiIndex = headers.findIndex((header) => header === 'ci' || header === 'confidence_interval');
  const metricValueIndex = headers.findIndex((header) => header === 'value' || header === 'estimate');
  const metricNameIndex = headers.findIndex((header) => header === 'metric' || header === 'measure');
  const directMetricColumns = METRIC_KEY_SPECS.flatMap(({ metric, keys }) => (
    headers
      .map((header, index) => (keys.includes(header) ? { metric, index } : null))
      .filter(Boolean)
  ));

  const findings = [];
  for (const line of lines.slice(1, 41)) {
    const row = splitDelimitedLine(line, delimiter);
    const label = labelIndexes
      .map((index) => compactWhitespace(row[index] || ''))
      .find(Boolean) || '';
    const pValue = pValueIndex >= 0 ? compactWhitespace(row[pValueIndex] || '') : '';
    const ciLow = ciLowIndex >= 0 ? compactWhitespace(row[ciLowIndex] || '') : '';
    const ciHigh = ciHighIndex >= 0 ? compactWhitespace(row[ciHighIndex] || '') : '';
    const explicitCi = explicitCiIndex >= 0 ? compactWhitespace(row[explicitCiIndex] || '') : '';

    if (metricNameIndex >= 0 && metricValueIndex >= 0) {
      const metric = normalizeMetricName(row[metricNameIndex]);
      const value = compactWhitespace(row[metricValueIndex] || '');
      if (metric && value) {
        findings.push(buildStructuredFinding({
          label,
          metric,
          value,
          pValue,
          ci: explicitCi || (ciLow && ciHigh ? `${ciLow}-${ciHigh}` : ''),
          sourceFile: options.sourceFile || null,
        }));
      }
      continue;
    }

    let directMatches = 0;
    for (const entry of directMetricColumns) {
      const value = compactWhitespace(row[entry.index] || '');
      if (!value) {
        continue;
      }
      directMatches += 1;
      findings.push(buildStructuredFinding({
        label,
        metric: entry.metric,
        value,
        pValue,
        ci: explicitCi || (ciLow && ciHigh ? `${ciLow}-${ciHigh}` : ''),
        sourceFile: options.sourceFile || null,
      }));
    }

    if (directMatches === 0) {
      findings.push(...extractStructuredStatEntries(row.join(' '), options));
    }
  }

  return findings.filter(Boolean);
}

function extractFindingsFromJsonValue(value, options = {}, findings = [], depth = 0) {
  if (depth > 5 || findings.length > 80) {
    return findings;
  }

  if (typeof value === 'string') {
    findings.push(...extractStructuredStatEntries(value, options));
    return findings;
  }

  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 40)) {
      extractFindingsFromJsonValue(entry, options, findings, depth + 1);
      if (findings.length > 80) {
        break;
      }
    }
    return findings;
  }

  if (!value || typeof value !== 'object') {
    return findings;
  }

  const metricEntries = [];
  for (const { metric, keys } of METRIC_KEY_SPECS) {
    const key = Object.keys(value).find((entry) => keys.includes(normalizeHeader(entry)));
    if (!key) {
      continue;
    }
    const rawMetricValue = value[key];
    if (!isScalarMetricValue(rawMetricValue)) {
      continue;
    }
    metricEntries.push({ metric, value: compactWhitespace(rawMetricValue) });
  }

  if (metricEntries.length === 0) {
    const metricName = normalizeMetricName(value.metric || value.measure || '');
    const metricValue = isScalarMetricValue(value.value || value.estimate) ? compactWhitespace(value.value || value.estimate) : '';
    if (metricName && metricValue) {
      metricEntries.push({ metric: metricName, value: metricValue });
    }
  }

  if (metricEntries.length > 0) {
    const label = LABEL_KEYS
      .map((key) => compactWhitespace(value[key] || ''))
      .find(Boolean) || '';
    const pValue = PVALUE_KEYS
      .map((key) => compactWhitespace(value[key] || ''))
      .find(Boolean) || '';
    const ciLow = CI_LOW_KEYS
      .map((key) => compactWhitespace(value[key] || ''))
      .find(Boolean) || '';
    const ciHigh = CI_HIGH_KEYS
      .map((key) => compactWhitespace(value[key] || ''))
      .find(Boolean) || '';
    const explicitCi = compactWhitespace(value.ci || value.confidence_interval || '');
    for (const entry of metricEntries) {
      findings.push(buildStructuredFinding({
        label,
        metric: entry.metric,
        value: entry.value,
        pValue,
        ci: explicitCi || (ciLow && ciHigh ? `${ciLow}-${ciHigh}` : ''),
        sourceFile: options.sourceFile || null,
      }));
    }
  }

  for (const nestedValue of Object.values(value)) {
    if (nestedValue && typeof nestedValue === 'object') {
      extractFindingsFromJsonValue(nestedValue, options, findings, depth + 1);
      if (findings.length > 80) {
        break;
      }
    } else if (typeof nestedValue === 'string' && STAT_TEXT_HINT.test(nestedValue)) {
      findings.push(...extractStructuredStatEntries(nestedValue, options));
    }
  }

  return findings;
}

function buildStructuredFinding({ label, metric, value, pValue, ci, sourceFile }) {
  if (!metric && !pValue && !ci) {
    return null;
  }

  let body = '';
  if (metric && value) {
    body = `${metric} ${value}`;
  } else if (metric) {
    body = metric;
  }
  if (ci) {
    body = body ? `${body} (95% CI ${ci})` : `95% CI ${ci}`;
  }
  if (pValue) {
    body = body ? `${body}, p = ${normalizePValue(pValue)}` : `p = ${normalizePValue(pValue)}`;
  }

  const summary = compactWhitespace([label ? `${label}:` : '', body].join(' '));
  if (!summary) {
    return null;
  }

  return {
    summary,
    metric: metric || null,
    value: value || null,
    pValue: normalizePValue(pValue),
    ci: ci || null,
    sourceFile: sourceFile || null,
  };
}

function dedupeStructuredFindings(findings = []) {
  const seen = new Set();
  const deduped = [];
  for (const finding of findings) {
    if (!finding?.summary) {
      continue;
    }
    const key = finding.summary.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

function splitDelimitedLine(line, delimiter) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map((value) => compactWhitespace(value.replace(/^"|"$/g, '')));
}

function normalizeMetricName(value) {
  const normalized = normalizeHeader(value);
  const spec = METRIC_KEY_SPECS.find(({ keys }) => keys.includes(normalized));
  if (spec) {
    return spec.metric;
  }
  if (normalized === 'f1' || normalized === 'f1_score') return 'F1';
  if (normalized === 'auc' || normalized === 'auroc') return 'AUC';
  return compactWhitespace(value);
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[%()\[\]{}]/g, '')
    .replace(/[\s/-]+/g, '_');
}

function normalizePValue(value) {
  return compactWhitespace(value || '').replace(/^\s*([<>]=?|=)\s*/, '$1 ').trim() || null;
}

function isScalarMetricValue(value) {
  return typeof value === 'string' || typeof value === 'number';
}

function normalizeArtifactSourceFile(projectPath, artifactPath) {
  const resolved = resolveProjectArtifactPath(projectPath, artifactPath);
  if (!resolved) {
    return compactWhitespace(artifactPath);
  }
  return path.relative(projectPath, resolved).replace(/\\/g, '/') || compactWhitespace(artifactPath);
}

function resolveProjectArtifactPath(projectPath, artifactPath) {
  const normalizedProjectPath = path.resolve(projectPath);
  const resolvedPath = path.isAbsolute(artifactPath)
    ? path.resolve(artifactPath)
    : path.resolve(projectPath, artifactPath);
  if (resolvedPath === normalizedProjectPath || resolvedPath.startsWith(`${normalizedProjectPath}${path.sep}`)) {
    return resolvedPath;
  }
  return null;
}

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const STAT_TEXT_HINT = /\b(?:p\s*[<=>]|hr\b|hazard ratio|or\b|odds ratio|rr\b|risk ratio|auc\b|accuracy\b|f1\b|sensitivity\b|specificity\b|ci\b|confidence interval)\b/i;

export {
  extractConfirmedFindingsFromArtifact,
  extractStructuredStatEntries,
};
