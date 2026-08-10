import fs from 'fs';

function readText(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath, fallback) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

export function scoreParsedDocument({ markdownPath, tablesPath, pageMapPath } = {}) {
  const markdown = readText(markdownPath);
  const lower = markdown.toLowerCase();
  const tables = readJson(tablesPath, []);
  const pageMap = readJson(pageMapPath, null);
  let score = 0;
  const checks = [];

  const add = (name, points, passed) => {
    checks.push({ name, points, passed });
    if (passed) score += points;
  };

  add('title', 20, /^#\s+\S/m.test(markdown) || lower.includes('title'));
  add('abstract', 20, lower.includes('abstract'));
  add('body_length', 20, markdown.replace(/\s+/g, ' ').length > 3000);
  add('tables', 15, Array.isArray(tables) ? tables.length > 0 : Boolean(tables && Object.keys(tables).length));
  add('page_map', 10, Boolean(pageMap && (Array.isArray(pageMap) ? pageMap.length : Object.keys(pageMap).length)));
  add('references', 10, lower.includes('references'));
  add('clean_text', 5, !markdown.includes('\uFFFD') && !/[^\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]/.test(markdown));

  const level = score >= 80 ? 'good' : score >= 60 ? 'usable' : score >= 40 ? 'poor' : 'failed';
  return { score, level, checks };
}
