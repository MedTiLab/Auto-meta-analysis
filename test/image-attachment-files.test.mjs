import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

import {
  buildTempAttachmentFilename,
  toPortableAtPath,
} from '../server/utils/imageAttachmentFiles.js';

test('buildTempAttachmentFilename prefixes original names to avoid Windows reserved basenames', () => {
  assert.equal(buildTempAttachmentFilename(0, 'con.png', 'image/png'), '1_con.png');
  assert.equal(buildTempAttachmentFilename(1, 'aux.jpg', 'image/jpeg'), '2_aux.jpg');
});

test('buildTempAttachmentFilename sanitizes names and normalizes svg mime extensions', () => {
  assert.equal(buildTempAttachmentFilename(0, 'my diagram?.png', 'image/png'), '1_my_diagram_.png');
  assert.equal(buildTempAttachmentFilename(2, '', 'image/svg+xml'), 'image_2.svg');
});

test('toPortableAtPath produces Gemini-compatible relative paths on POSIX', () => {
  const result = toPortableAtPath(
    '/workspace/.tmp/attachments/123/example.png',
    '/workspace',
    path.posix,
  );

  assert.equal(result, '@.tmp/attachments/123/example.png');
});

test('toPortableAtPath normalizes Windows separators to forward slashes', () => {
  const result = toPortableAtPath(
    'C:\\workspace\\.tmp\\attachments\\123\\example.png',
    'C:\\workspace',
    path.win32,
  );

  assert.equal(result, '@.tmp/attachments/123/example.png');
});

test('toPortableAtPath keeps absolute Windows paths when drives differ', () => {
  const result = toPortableAtPath(
    'D:\\temp\\example.png',
    'C:\\workspace',
    path.win32,
  );

  assert.equal(result, '@D:/temp/example.png');
});
