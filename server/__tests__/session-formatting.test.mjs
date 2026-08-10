import { describe, expect, it } from 'vitest';

import { buildSessionDisplayName, stripInternalContextPrefix } from '../utils/sessionFormatting.js';

describe('session formatting', () => {
  it('removes execution memory blocks and preserves the visible user request', () => {
    const raw = [
      '<execution_memory>',
      'Current objective: Review the report',
      'Open microtasks:',
      '- Check novelty',
      '</execution_memory>',
      '',
      'User request:',
      '你对结果满意吗？看看我写的报告，创新性怎么样',
    ].join('\n');

    expect(stripInternalContextPrefix(raw, false)).toBe('你对结果满意吗？看看我写的报告，创新性怎么样');
  });

  it('returns null when the message only contains execution memory scaffolding', () => {
    const raw = [
      '<execution_memory>',
      'Current objective: Continue from the latest state',
      '</execution_memory>',
      '',
      'User request:',
    ].join('\n');

    expect(stripInternalContextPrefix(raw, false)).toBeNull();
  });

  it('removes research lessons blocks and preserves the visible user request', () => {
    const raw = [
      '<research_lessons>',
      'Relevant lessons from previous corrections:',
      '- Verify coding before binary exposure definitions: Check the original coding first.',
      '</research_lessons>',
      '',
      'User request:',
      '继续分析结果并避免重复之前的编码错误',
    ].join('\n');

    expect(stripInternalContextPrefix(raw, false)).toBe('继续分析结果并避免重复之前的编码错误');
  });

  it('removes nested context markers exposed after research lessons for new file Q&A sessions', () => {
    const raw = [
      '<research_lessons>',
      'Relevant lessons from previous corrections:',
      '- Keep analysis scoped to the requested file.',
      '</research_lessons>',
      '',
      'User request:',
      '[Context: session-mode=workspace_qa]',
      '[Context: Treat this as a lightweight workspace Q&A session.]',
      '',
      '请帮我解释一下文件 `src/components/FileTree.jsx`。它的作用是什么？',
    ].join('\n');

    expect(stripInternalContextPrefix(raw, false)).toBe(
      '请帮我解释一下文件 `src/components/FileTree.jsx`。它的作用是什么？',
    );
    expect(buildSessionDisplayName(raw)).toBe(
      '请帮我解释一下文件 `src/components/FileTree.jsx`。它的作用是什么？',
    );
  });

  it('removes user preference memory blocks before visible content', () => {
    const raw = [
      '<analysis_preferences>',
      'Preferred analysis language for this conversation:',
      '- Prefer Python for data analysis code, scripts, package choices, and runnable examples unless the user explicitly asks for another language.',
      '</analysis_preferences>',
      '',
      '<user_preferences>',
      'Saved user preferences:',
      '- [workflow] Keep answers concise',
      '</user_preferences>',
      '',
      '<execution_memory>',
      'Current objective: Continue the review',
      '</execution_memory>',
      '',
      'User request:',
      '继续帮我检查摘要部分',
    ].join('\n');

    expect(stripInternalContextPrefix(raw, false)).toBe('继续帮我检查摘要部分');
  });

  it('removes leaked MedHelp identity prompt blocks before visible content', () => {
    const raw = [
      '<medhelp_assistant_identity>',
      '## MedHelp Assistant Identity',
      'When the user asks who or what you are, answer only with the product identity.',
      'Use: "我是 MedHelp 智能体。" in Chinese.',
      '</medhelp_assistant_identity>',
      '',
      '[Context: session-mode=research]',
      '[Context: This is a research workflow session.]',
      '',
      '你是谁',
    ].join('\n');

    expect(stripInternalContextPrefix(raw, false)).toBe('你是谁');
    expect(buildSessionDisplayName(raw)).toBe('你是谁');
  });

  it('removes a user request label after command tags are stripped', () => {
    const raw = [
      '<command-name>Read</command-name>',
      '<command-message>Reading file</command-message>',
      '',
      'User request:',
      '请总结这个文件',
    ].join('\n');

    expect(stripInternalContextPrefix(raw, false)).toBe('请总结这个文件');
  });

  it('builds a session title from the first visible user line', () => {
    const raw = [
      '[Context: session-mode=research]',
      '',
      '# 帮我分析 NHANES 中 BMI 与死亡风险的关系',
      '',
      '补充要求：先做描述统计',
    ].join('\n');

    expect(buildSessionDisplayName(raw)).toBe('帮我分析 NHANES 中 BMI 与死亡风险的关系');
  });

  it('returns null when no visible user text remains after stripping internal context', () => {
    const raw = [
      '<user_preferences>',
      'Saved user preferences:',
      '- Keep answers concise',
      '</user_preferences>',
      '',
      '[Context: session-mode=research]',
    ].join('\n');

    expect(buildSessionDisplayName(raw)).toBeNull();
  });

  it('returns null for leaked skill markdown documents', () => {
    const raw = [
      '---',
      'name: pubmed-database',
      'description: Direct REST API access to PubMed.',
      '---',
      '',
      '# PubMed Database',
      '',
      '## Overview',
      '',
      "PubMed is the U.S. National Library of Medicine's comprehensive database.",
      '',
      '## When to Use This Skill',
      '',
      'This skill should be used when searching biomedical literature.',
    ].join('\n');

    expect(stripInternalContextPrefix(raw, false)).toBeNull();
    expect(buildSessionDisplayName(raw)).toBeNull();
  });
});
