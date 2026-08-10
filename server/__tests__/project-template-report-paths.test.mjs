import { describe, expect, it } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';

const TEMPLATE_DIR = path.resolve(process.cwd(), 'server', 'templates');
const TEMPLATE_FILES = ['AGENTS.md', 'CLAUDE.md'];
const META_TEMPLATE_FILES = ['AGENTS.meta.md', 'CLAUDE.meta.md'];

describe('project template report persistence guidance', () => {
  it.each(TEMPLATE_FILES)('%s keeps report outputs in project folders', async (templateFile) => {
    const templatePath = path.join(TEMPLATE_DIR, templateFile);
    const content = await readFile(templatePath, 'utf8');

    expect(content).toContain('Literature/reports/');
    expect(content).toContain('Ideation/ideas/');
    expect(content).toContain('Experiment/analysis/');
    expect(content).toContain('Publication/manuscript/');
    expect(content).toContain('Publication/figures/');
    expect(content).toContain('Publication/tables/');
    expect(content).toContain('Publication/supplementary/');
    expect(content).toContain('Promotion/slides/');
    expect(content).toContain('Do **not** create new visible provider-named subfolders');
    expect(content).toContain('YYYY-MM-DD-topic.md');
    expect(content).toContain('YYYY-MM-DD-topic-v2.md');
    expect(content).toContain('Do **not** append provider');
    expect(content).toContain('01_survival_curve.pdf');

    expect(content).not.toContain('Literature/reports/<agent>/');
    expect(content).not.toContain('Ideation/ideas/<agent>/');
    expect(content).not.toContain('Experiment/analysis/<agent>/');
    expect(content).not.toContain('Publication/manuscript/<agent>/');
    expect(content).not.toContain('Publication/paper/');
    expect(content).not.toContain('Publication/attachments/');
    expect(content).not.toContain('Publication/cover_letter/');
    expect(content).not.toContain('Publication/journal_targets/');
    expect(content).not.toContain('Promotion/slides/<agent>/');
    expect(content).not.toContain('YYYY-MM-DD-topic-agent.md');
    expect(content).not.toContain('_claude.pdf');
    expect(content).not.toContain("current AI's subfolder");
    expect(content).not.toContain('agent-specific subfolder');
  });

  it.each([...TEMPLATE_FILES, ...META_TEMPLATE_FILES])('%s defaults report-style outputs to Chinese', async (templateFile) => {
    const templatePath = path.join(TEMPLATE_DIR, templateFile);
    const content = await readFile(templatePath, 'utf8');

    expect(content).toContain('Simplified Chinese (zh-CN)');
    expect(content).toContain('report-style chat handoffs');
  });
});
