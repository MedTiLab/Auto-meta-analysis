import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Test the shouldAutoOpenUrlFromOutput detection patterns.
 * Extracted from server/index.js for isolated testing.
 */

function shouldAutoOpenUrlFromOutput(value = '') {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('browser didn\'t open') ||
    normalized.includes('open this url') ||
    normalized.includes('continue in your browser') ||
    normalized.includes('press enter to open') ||
    normalized.includes('open_url:') ||
    normalized.includes('paste code here')
  );
}

test('Detects "paste code here" from Claude CLI auth', () => {
  assert.ok(shouldAutoOpenUrlFromOutput(
    'Paste code here if prompted >'
  ));
});

test('Detects "paste code here" case-insensitively', () => {
  assert.ok(shouldAutoOpenUrlFromOutput(
    'PASTE CODE HERE'
  ));
});

test('Detects "browser didn\'t open"', () => {
  assert.ok(shouldAutoOpenUrlFromOutput(
    'If your browser didn\'t open, click this link'
  ));
});

test('Detects "open this url"', () => {
  assert.ok(shouldAutoOpenUrlFromOutput(
    'Please open this URL to authenticate'
  ));
});

test('Detects "continue in your browser"', () => {
  assert.ok(shouldAutoOpenUrlFromOutput(
    'Continue in your browser to complete authentication'
  ));
});

test('Detects "press enter to open"', () => {
  assert.ok(shouldAutoOpenUrlFromOutput(
    'Press Enter to open the login page'
  ));
});

test('Detects "open_url:" prefix', () => {
  assert.ok(shouldAutoOpenUrlFromOutput(
    'open_url: https://accounts.google.com/...'
  ));
});

test('Does not trigger on unrelated output', () => {
  assert.ok(!shouldAutoOpenUrlFromOutput('npm install completed'));
  assert.ok(!shouldAutoOpenUrlFromOutput('compiling...'));
  assert.ok(!shouldAutoOpenUrlFromOutput(''));
});
