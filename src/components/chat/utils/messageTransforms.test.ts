import { describe, expect, it } from 'vitest';

import { convertSessionMessages } from './messageTransforms';

describe('convertSessionMessages', () => {
  it('keeps the visible user request when raw history contains execution memory', () => {
    const converted = convertSessionMessages([
      {
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                '<execution_memory>',
                'Current objective: Review the report',
                'Open microtasks:',
                '- Check novelty',
                '</execution_memory>',
                '',
                'User request:',
                '还是bug 啊，发消息，不知道刷新，不出现在前端web页面了。',
              ].join('\n'),
            },
          ],
        },
        timestamp: '2026-04-05T04:39:14.069Z',
      },
    ]);

    expect(converted).toHaveLength(1);
    expect(converted[0]?.type).toBe('user');
    expect(converted[0]?.content).toBe('还是bug 啊，发消息，不知道刷新，不出现在前端web页面了。');
  });

  it('hides leaked MedHelp identity prompt blocks from user bubbles', () => {
    const converted = convertSessionMessages([
      {
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
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
              ].join('\n'),
            },
          ],
        },
        timestamp: '2026-05-19T03:30:14.069Z',
      },
    ]);

    expect(converted).toHaveLength(1);
    expect(converted[0]?.type).toBe('user');
    expect(converted[0]?.content).toBe('你是谁');
  });

  it('strips injected guided prompts and file notes while preserving visible metadata', () => {
    const filePath = '/Users/gaoyuzhen/medautodata/proj-2026-04-07-13-55-11/.med-help/chat-attachments/1775566214792/data raw.sav';
    const converted = convertSessionMessages([
      {
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                '请协助我完成“启动 Meta 项目”。请按项目记忆文件执行，并先判断当前阶段、缺失项和下一步任务。可用技能：meta-pipeline-planner, meta-analysis-workflow, literature-review。',
                '',
                '我的任务：',
                '',
                '帮我看看这里可以研究啥内容。',
                '',
                '[Files available at the following paths]',
                `1. ${filePath}`,
              ].join('\n'),
            },
          ],
        },
        timestamp: '2026-04-07T12:50:14.069Z',
      },
    ]);

    expect(converted).toHaveLength(1);
    expect(converted[0]?.type).toBe('user');
    expect(converted[0]?.content).toBe('帮我看看这里可以研究啥内容。');
    expect(converted[0]?.attachedPrompt).toMatchObject({
      scenarioTitle: '启动 Meta 项目',
      scenarioIcon: '🧭',
    });
    expect(converted[0]?.attachments).toEqual([
      {
        name: 'data raw.sav',
        kind: 'file',
        path: filePath,
      },
    ]);
  });

});
