import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractSessionModeFromMetadata,
  extractSessionModeFromText,
  inferSessionModeFromUserMessage,
  readExplicitSessionModeFromMetadata,
} from '../server/utils/sessionMode.js';

test('readExplicitSessionModeFromMetadata normalizes casing', () => {
  assert.equal(readExplicitSessionModeFromMetadata({ sessionMode: 'WORKSPACE_QA' }), 'workspace_qa');
  assert.equal(readExplicitSessionModeFromMetadata({ mode: 'Research' }), 'research');
  assert.equal(readExplicitSessionModeFromMetadata({ sessionMode: 'unknown' }), null);
});

test('extractSessionModeFromMetadata falls back to research for invalid values', () => {
  assert.equal(extractSessionModeFromMetadata({ sessionMode: 'WORKSPACE_QA' }), 'workspace_qa');
  assert.equal(extractSessionModeFromMetadata({ mode: 'invalid-value' }), 'research');
  assert.equal(extractSessionModeFromMetadata(null), 'research');
});

test('extractSessionModeFromText reads explicit context markers', () => {
  assert.equal(extractSessionModeFromText('[Context: session-mode=workspace_qa]\nhelp'), 'workspace_qa');
  assert.equal(extractSessionModeFromText('[Context: session-mode=research]\nhelp'), 'research');
  assert.equal(extractSessionModeFromText('plain message'), null);
});

test('inferSessionModeFromUserMessage avoids false positives for generic coding language', () => {
  assert.equal(inferSessionModeFromUserMessage('Can you explain how this function works?'), null);
  assert.equal(inferSessionModeFromUserMessage('Write a test for this change'), null);
  assert.equal(inferSessionModeFromUserMessage('I have a file that needs updating'), null);
});

test('inferSessionModeFromUserMessage keeps high-confidence workspace and research signals', () => {
  assert.equal(inferSessionModeFromUserMessage('Create a pull request for this fix'), 'workspace_qa');
  assert.equal(inferSessionModeFromUserMessage('Please push this commit to the repo'), 'workspace_qa');
  assert.equal(inferSessionModeFromUserMessage('Research this code pattern and summarize related papers'), 'research');
});
