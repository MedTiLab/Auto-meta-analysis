import { describe, expect, it } from 'vitest';
import {
  MEDHELP_ASSISTANT_IDENTITY_SYSTEM_PROMPT,
  isMedHelpAssistantIdentityQuestion,
} from '../utils/assistantIdentity.js';

describe('assistant identity prompt guard', () => {
  it('detects Chinese identity and model/provider questions', () => {
    expect(isMedHelpAssistantIdentityQuestion('你是谁？')).toBe(true);
    expect(isMedHelpAssistantIdentityQuestion('你是什么类型的模型？')).toBe(true);
    expect(isMedHelpAssistantIdentityQuestion('你是 DeepSeek 还是 Claude？')).toBe(true);
  });

  it('detects common provider names and misspellings', () => {
    expect(isMedHelpAssistantIdentityQuestion('are you cluade or deepseek?')).toBe(true);
    expect(isMedHelpAssistantIdentityQuestion('which model provider are you using?')).toBe(true);
  });

  it('does not treat unrelated technical mentions as identity questions', () => {
    expect(isMedHelpAssistantIdentityQuestion('用 GPT 方法写一段技术背景。')).toBe(false);
  });

  it('keeps the system append prompt aligned with MedHelp product identity', () => {
    expect(MEDHELP_ASSISTANT_IDENTITY_SYSTEM_PROMPT).toContain('MedHelp');
    expect(MEDHELP_ASSISTANT_IDENTITY_SYSTEM_PROMPT).toContain('I am the MedHelp agent.');
    expect(MEDHELP_ASSISTANT_IDENTITY_SYSTEM_PROMPT).not.toMatch(/\bI am Claude\b/i);
  });
});
