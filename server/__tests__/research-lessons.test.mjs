import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildResearchAwarePromptPrefix,
  captureResearchLessonsFromText,
  readResearchLessons,
} from '../execution-memory/lessons.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medautodata-research-lessons-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('research lessons', () => {
  it('captures and deduplicates confirmed lessons from corrective user text', async () => {
    const projectPath = await createTempProject();

    const text = '这一步不对，先核对原始变量编码和问卷 codebook，再定义 binary exposure。跨人群 transportability 结论前也要先做 adjusted/PSM 分析，不能只看 crude 结果。';

    const firstCapture = await captureResearchLessonsFromText(projectPath, text, {
      provider: 'claude',
      sessionId: 'sess-1',
      stage: 'extraction',
      source: 'user_command',
    });

    const secondCapture = await captureResearchLessonsFromText(projectPath, text, {
      provider: 'claude',
      sessionId: 'sess-1',
      stage: 'extraction',
      source: 'user_command',
    });

    const state = await readResearchLessons(projectPath);
    const slugs = state.items.map((item) => item.slug);

    expect(firstCapture.synced).toBe(true);
    expect(secondCapture.synced).toBe(true);
    expect(slugs).toContain('verify-variable-coding-before-binary-definitions');
    expect(slugs).toContain('run-adjusted-analyses-before-transportability-claims');

    const codingLesson = state.items.find((item) => item.slug === 'verify-variable-coding-before-binary-definitions');
    expect(codingLesson.status).toBe('confirmed');
    expect(codingLesson.timesSeen).toBe(2);
    expect(codingLesson.stageHints).toContain('extraction');

    const markdownPath = path.join(projectPath, '.pipeline', 'docs', 'research_lessons.md');
    await expect(fs.readFile(markdownPath, 'utf8')).resolves.toContain('Verify coding before binary exposure definitions');
  });

  it('builds a hidden prompt prefix from confirmed lessons without execution memory when requested', async () => {
    const projectPath = await createTempProject();

    await captureResearchLessonsFromText(
      projectPath,
      '记住：跨人群 transportability 结论前必须先做 adjusted 和 sensitivity analysis，不能直接下结论。',
      {
        provider: 'claude',
        sessionId: 'sess-2',
        stage: 'publication',
        source: 'user_command',
      },
    );

    const prompt = await buildResearchAwarePromptPrefix(
      {
        scope: 'session',
        projectPath,
        provider: 'claude',
        sessionId: 'sess-2',
        stage: 'publication',
      },
      '请继续检查报告的讨论部分。',
      {
        includeExecutionMemory: false,
        fallbackCommand: 'Continue.',
      },
    );

    expect(prompt).toContain('<research_lessons>');
    expect(prompt).toContain('Run adjusted analyses before transportability claims');
    expect(prompt).toContain('User request:\n请继续检查报告的讨论部分。');
    expect(prompt).not.toContain('<execution_memory>');
  });

  it('injects task context and execution memory for Claude by default', async () => {
    const projectPath = await createTempProject();
    const sessionId = 'claude-task-context-session';
    const sessionDir = path.join(projectPath, '.pipeline', 'sessions', sessionId);
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionDir, 'microtasks.json'),
      `${JSON.stringify({
        version: 1,
        scope: 'session',
        sessionId,
        provider: 'claude',
        currentObjective: 'Finish the current Meta extraction task.',
        currentTaskId: '7',
        currentTaskTitle: 'Extract effect estimates',
        stage: 'extraction',
        items: [
          { id: 'm1', title: 'Confirm eligible full texts', status: 'completed' },
          { id: 'm2', title: 'Extract adjusted effect estimates', status: 'pending' },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    const prompt = await buildResearchAwarePromptPrefix(
      {
        scope: 'session',
        projectPath,
        provider: 'claude',
        sessionId,
        stage: 'extraction',
      },
      '继续执行。',
      {
        taskContext: {
          id: '7',
          title: 'Extract effect estimates',
          stage: 'extraction',
          status: 'in-progress',
          priority: 'high',
          description: 'Extract adjusted effect estimates and variance fields from included studies.',
          details: 'Use the full-text evidence table and save a Markdown task report.',
          testStrategy: 'Verify every extraction row has source page and conversion notes.',
          nextActionPrompt: 'Extract adjusted effect estimates, write outputs, and update task bookkeeping.',
          whyNext: 'This task is already in progress and should be finished first.',
          requiredInputs: ['included_studies', 'full_text_sources'],
          suggestedSkills: ['meta-analysis-workflow'],
          dependencies: ['6'],
        },
      },
    );

    expect(prompt).toContain('<task_context>');
    expect(prompt).toContain('Task ID: 7');
    expect(prompt).toContain('Why this task is next: This task is already in progress');
    expect(prompt).toContain('Next action prompt: Extract adjusted effect estimates');
    expect(prompt).toContain('Required inputs: included_studies, full_text_sources');
    expect(prompt).toContain('<execution_memory>');
    expect(prompt).toContain('Current objective: Finish the current Meta extraction task.');
    expect(prompt).toContain('Open microtasks:');
    expect(prompt).toContain('Extract adjusted effect estimates');
    expect(prompt).toContain('User request:\n继续执行。');
  });
});
