import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCursorCliArgs,
  getCursorCliDisplayCommand,
  getCursorCliShellCommand,
} from '../server/utils/cursorCommand.js';

test('Cursor editor binary expands to agent subcommand args', () => {
  assert.deepEqual(
    buildCursorCliArgs('cursor', ['status']),
    ['agent', 'status'],
  );
});

test('Legacy cursor agent binaries keep original args', () => {
  assert.deepEqual(
    buildCursorCliArgs('cursor-agent', ['status']),
    ['status'],
  );
  assert.deepEqual(
    buildCursorCliArgs('agent', ['status']),
    ['status'],
  );
});

test('Display command reflects cursor agent invocation', () => {
  assert.equal(getCursorCliDisplayCommand('cursor'), 'cursor agent');
  assert.equal(getCursorCliDisplayCommand('cursor-agent'), 'cursor-agent');
});

test('Shell command quotes cursor paths with spaces', () => {
  assert.equal(
    getCursorCliShellCommand('/Applications/Cursor App/bin/cursor'),
    '"/Applications/Cursor App/bin/cursor" agent',
  );
});
