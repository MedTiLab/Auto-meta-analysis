#!/usr/bin/env node
/**
 * Minimal regression checks for the deepmed integration plan:
 * - Research-brief template field coverage (4 primary templates)
 * - TypeScript `npm run typecheck`
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const templatesDir = path.join(root, 'server', 'taskmaster-templates');

const REQUIRED_BRIEF_PATHS = [
  'sections.survey.core_research_question',
  'sections.survey.knowledge_base_scope',
  'sections.survey.seed_papers',
  'sections.survey.evidence_requirements',
  'sections.ideation.clinical_or_scientific_gap',
];

const PRIMARY_TEMPLATE_IDS = [
  'ai-research-dataset',
  'ai-research-method-model',
  'ai-research-position-paper',
  'medical-ukb-cohort',
];

function collectSectionFieldPaths(sectionFields) {
  const out = new Set();
  if (!sectionFields || typeof sectionFields !== 'object') return out;
  for (const group of Object.values(sectionFields)) {
    if (!Array.isArray(group)) continue;
    for (const field of group) {
      if (field && typeof field.path === 'string') out.add(field.path);
    }
  }
  return out;
}

const errors = [];

for (const id of PRIMARY_TEMPLATE_IDS) {
  const fp = path.join(templatesDir, `${id}.json`);
  if (!fs.existsSync(fp)) {
    errors.push(`Missing template: ${fp}`);
    continue;
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    errors.push(`Invalid JSON ${fp}: ${e.message}`);
    continue;
  }
  if (raw.format !== 'research-brief-json') {
    errors.push(`Template ${id}: expected format "research-brief-json"`);
  }
  const paths = collectSectionFieldPaths(raw.sectionFields);
  for (const req of REQUIRED_BRIEF_PATHS) {
    if (!paths.has(req)) {
      errors.push(`Template ${id}: sectionFields missing ${req}`);
    }
  }
}

if (errors.length) {
  console.error('[deepmed-smoke] Template checks failed:\n', errors.join('\n'));
  process.exit(1);
}

console.log('[deepmed-smoke] Template checks passed for:', PRIMARY_TEMPLATE_IDS.join(', '));

const typecheck = spawnSync('npm', ['run', 'typecheck'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (typecheck.status !== 0) {
  console.error('[deepmed-smoke] typecheck failed');
  process.exit(typecheck.status ?? 1);
}

console.log('[deepmed-smoke] All checks passed');
