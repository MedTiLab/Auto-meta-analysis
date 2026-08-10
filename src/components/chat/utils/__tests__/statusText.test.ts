import { describe, expect, it } from 'vitest';

import { resolveChatStatusText, shouldAppendStatusEllipsis } from '../statusText';

const translations: Record<string, string> = {
  'status.thinking': '思考中',
  'status.processing': '处理中',
  'status.analyzing': '分析中',
  'status.working': '执行中',
  'status.computing': '计算中',
  'status.reasoning': '推理中',
  'status.runningCode': '正在运行代码',
  'status.resuming': '恢复中',
  'status.initializing': '初始化中',
  'status.restarting': '重启中',
};

const t = ((key: string) => translations[key] ?? key) as any;

describe('resolveChatStatusText', () => {
  it('translates leaked i18n keys into readable text', () => {
    expect(resolveChatStatusText('status.runningCode', t)).toBe('正在运行代码');
  });

  it('normalizes common internal status values and typos', () => {
    expect(resolveChatStatusText('Running code...', t)).toBe('正在运行代码');
    expect(resolveChatStatusText('runing code', t)).toBe('正在运行代码');
    expect(resolveChatStatusText('running', t)).toBe('处理中');
  });

  it('preserves custom status messages', () => {
    expect(resolveChatStatusText('Inspecting repo structure', t)).toBe('Inspecting repo structure');
  });

  it('falls back to a readable default when status is empty or unknown key-like text', () => {
    expect(resolveChatStatusText('', t)).toBe('思考中');
    expect(resolveChatStatusText('status.missingKey', t, 'status.processing')).toBe('处理中');
  });
});

describe('shouldAppendStatusEllipsis', () => {
  it('avoids duplicate ellipsis when the status already ends with punctuation', () => {
    expect(shouldAppendStatusEllipsis('思考中')).toBe(true);
    expect(shouldAppendStatusEllipsis('思考中...')).toBe(false);
    expect(shouldAppendStatusEllipsis('Processing…')).toBe(false);
  });
});
