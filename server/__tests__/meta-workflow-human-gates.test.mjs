import { readFile } from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { isHumanReviewer, isPdfHumanAudited } from '../services/meta-analysis/workflow-gates.js';

describe('Meta workflow authorization gates', () => {
  it('uses named AI reviewer passes plus explicit user overrides without requiring a human rescreen queue', async () => {
    const [
      projectTemplate,
      analysisTemplate,
      metaAgentsTemplate,
      metaClaudeTemplate,
      zhChat,
      enChat,
    ] = await Promise.all([
      readFile(path.resolve('server/taskmaster-templates/medical-meta-project.json'), 'utf8'),
      readFile(path.resolve('server/taskmaster-templates/medical-meta-analysis.json'), 'utf8'),
      readFile(path.resolve('server/templates/AGENTS.meta.md'), 'utf8'),
      readFile(path.resolve('server/templates/CLAUDE.meta.md'), 'utf8'),
      readFile(path.resolve('src/i18n/locales/zh-CN/chat.json'), 'utf8'),
      readFile(path.resolve('src/i18n/locales/en/chat.json'), 'utf8'),
    ]);

    expect(projectTemplate).toContain('Claude second-screen reviewer');
    expect(projectTemplate).toContain('two human reviewers are not required');
    expect(projectTemplate).toContain('fulltext_manifest.json/csv');
    expect(projectTemplate).toContain('Only user-authorized or confirmed extraction rows can feed 07_data_analysis/');

    expect(analysisTemplate).toContain('named Claude second-screen review');
    expect(analysisTemplate).toContain('source-linked and reviewable by Claude plus the user');
    expect(analysisTemplate).toContain('Zotero attachments are synced back');
    expect(analysisTemplate).toContain('Prepare meta_input.csv only from user-authorized or confirmed extraction rows');
    expect(analysisTemplate).toContain('meta_project_startup_report');
    expect(analysisTemplate).toContain('01_protocol/project_startup_report.md');
    expect(analysisTemplate).toContain('cannot-extract report');
    expect(analysisTemplate).toContain('code/ subfolder');

    expect(metaAgentsTemplate).toContain('01_protocol/project_startup_report.md');
    expect(metaAgentsTemplate).toContain('05_data_extraction/cannot_extract_data_report.md');
    expect(metaAgentsTemplate).toContain('07_data_analysis/code/');
    expect(metaAgentsTemplate).toContain('Compress context into files');

    expect(metaClaudeTemplate).toContain('01_protocol/project_startup_report.md');
    expect(metaClaudeTemplate).toContain('04_full_text_review/unavailable_full_text_report.md');
    expect(metaClaudeTemplate).toContain('targeted human-review checkpoints');

    expect(zhChat).toContain('按当前仍缺可用全文的记录更新缺口清单');
    expect(zhChat).toContain('项目启动报告保存到 01_protocol/project_startup_report.md');
    expect(zhChat).toContain('不能提取报告');
    expect(zhChat).toContain('MEDHELP_API_TOKEN/MEDHELP_AUTHORIZATION');
    expect(zhChat).toContain('优先导出 RIS 格式的文献管理文件');
    expect(zhChat).toContain('如果 RIS 导入失败，立即暂停自动推送');
    expect(zhChat).toContain('不要把题摘 AI 二筛作为硬性前置规则');
    expect(zhChat).toContain('Zotero 附件同步回来后读取 PDF、Markdown、HTML 或文本材料');

    expect(enChat).toContain('Zotero Communication');
    expect(enChat).toContain('save the project startup report to 01_protocol/project_startup_report.md');
    expect(enChat).toContain('cannot-extract report');
    expect(enChat).toContain('update the gap list from records that still lack usable full text');
    expect(enChat).toContain('MEDHELP_API_TOKEN/MEDHELP_AUTHORIZATION');
    expect(enChat).toContain('Prefer exporting a RIS reference-management file first');
    expect(enChat).toContain('if RIS import fails, pause automatic handoff immediately');
    expect(enChat).toContain('Do not treat title/abstract AI second screen as a hard prerequisite');
    expect(enChat).toContain('After Zotero attachments are synced back, read PDF, Markdown, HTML, or text materials');
  });

  it('counts named AI reviewers and trusted PDF sources as workflow-ready gates', () => {
    expect(isHumanReviewer('claude')).toBe(true);
    expect(isHumanReviewer('ai_pre_screen')).toBe(false);
    expect(isHumanReviewer('system:auto')).toBe(false);

    expect(isPdfHumanAudited({
      status: 'downloaded',
      license_status: 'human_audit_pending:open_access',
    })).toBe(true);
    expect(isPdfHumanAudited({
      status: 'downloaded',
      license_status: 'human_audit_pending:unknown',
    })).toBe(false);
  });
});
