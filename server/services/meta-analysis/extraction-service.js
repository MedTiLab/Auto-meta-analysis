import fs from 'fs';

function readText(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath, fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function flattenTableText(tables) {
  if (!tables) return '';
  if (Array.isArray(tables)) {
    return tables.map((table, index) => `Table ${table.label || index + 1}\n${JSON.stringify(table)}`).join('\n\n');
  }
  return JSON.stringify(tables);
}

function extractDiagnosticNumbers(text) {
  const patterns = {
    TP: /\b(?:TP|true\s*positive[s]?)\b[^0-9]{0,20}(\d{1,5})/i,
    FP: /\b(?:FP|false\s*positive[s]?)\b[^0-9]{0,20}(\d{1,5})/i,
    FN: /\b(?:FN|false\s*negative[s]?)\b[^0-9]{0,20}(\d{1,5})/i,
    TN: /\b(?:TN|true\s*negative[s]?)\b[^0-9]{0,20}(\d{1,5})/i,
    sensitivity: /\b(?:sensitivity|sens)\b[^0-9]{0,20}(\d+(?:\.\d+)?%?)/i,
    specificity: /\b(?:specificity|spec)\b[^0-9]{0,20}(\d+(?:\.\d+)?%?)/i,
    AUC: /\b(?:AUC|area\s+under\s+the\s+curve)\b[^0-9]{0,20}(\d+(?:\.\d+)?)/i,
  };

  const values = {};
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = text.match(pattern);
    if (!match) continue;
    const raw = match[1];
    values[key] = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
  }
  return values;
}

function firstAuthorFromReference(reference = {}) {
  const first = Array.isArray(reference.authors) ? reference.authors[0] : null;
  return first?.family || first?.given || null;
}

export function extractDiagnosticCandidates({ reference, parsedDocument } = {}) {
  const markdown = readText(parsedDocument?.markdown_path);
  const tables = readJson(parsedDocument?.tables_path, []);
  const combined = `${flattenTableText(tables)}\n\n${markdown}`;
  const values = extractDiagnosticNumbers(combined);
  const required = ['TP', 'FP', 'FN', 'TN'];
  const missingFields = required.filter((field) => values[field] == null);
  const evidenceText = combined
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => /(TP|FP|FN|TN|true positive|false positive|sensitivity|specificity)/i.test(line))
    || 'No explicit diagnostic 2x2 evidence found in parsed document.';

  return [{
    extractionType: 'diagnostic',
    fieldName: 'diagnosticData',
    valueJson: {
      study: {
        first_author: firstAuthorFromReference(reference),
        year: reference?.year ?? null,
        title: reference?.title || null,
        journal: reference?.journal || null,
      },
      diagnosticData: [{
        group: 'overall',
        TP: values.TP ?? null,
        FP: values.FP ?? null,
        FN: values.FN ?? null,
        TN: values.TN ?? null,
        sensitivity: values.sensitivity ?? null,
        specificity: values.specificity ?? null,
        AUC: values.AUC ?? null,
        derived: false,
        derivationNote: null,
      }],
      missingFields,
      warnings: missingFields.length > 0
        ? ['Candidate extraction is incomplete and requires reviewer confirmation.']
        : [],
    },
    evidenceText,
    evidenceLocation: 'MinerU parsed markdown/tables',
    page: null,
    tableLabel: null,
    confidence: missingFields.length === 0 ? 0.65 : 0.25,
    reviewStatus: missingFields.length === 0 ? 'candidate' : 'needs_review',
  }];
}

export function normalizeDiagnosticExtractionValue(value = {}) {
  const row = Array.isArray(value.diagnosticData) ? value.diagnosticData[0] : value;
  return {
    firstAuthor: value.study?.first_author || value.study?.firstAuthor || null,
    year: value.study?.year ?? null,
    country: value.study?.country || null,
    cancerType: value.study?.cancer_type || value.study?.cancerType || null,
    biomarker: value.indexTest?.biomarker || value.biomarker || null,
    sampleType: value.indexTest?.sample_type || value.indexTest?.sampleType || value.sampleType || null,
    assayMethod: value.indexTest?.assay_method || value.indexTest?.assayMethod || value.assayMethod || null,
    cutoff: value.indexTest?.cutoff || value.cutoff || null,
    TP: row?.TP ?? null,
    FP: row?.FP ?? null,
    FN: row?.FN ?? null,
    TN: row?.TN ?? null,
    sensitivity: row?.sensitivity ?? null,
    specificity: row?.specificity ?? null,
    AUC: row?.AUC ?? null,
  };
}
