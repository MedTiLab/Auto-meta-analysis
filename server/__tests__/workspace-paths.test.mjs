import { describe, expect, it } from 'vitest';
import path from 'path';
import { resolveDefaultWorkspacesRoot } from '../utils/workspacePaths.js';

describe('AutoMeta workspace defaults', () => {
  it('uses autometa_workspace under the home directory on macOS and Linux', () => {
    expect(resolveDefaultWorkspacesRoot({
      platform: 'darwin',
      homeDir: '/Users/researcher',
    })).toBe(path.join('/Users/researcher', 'autometa_workspace'));

    expect(resolveDefaultWorkspacesRoot({
      platform: 'linux',
      homeDir: '/home/researcher',
    })).toBe(path.join('/home/researcher', 'autometa_workspace'));
  });

  it('prefers the D drive on Windows when it is available', () => {
    expect(resolveDefaultWorkspacesRoot({
      platform: 'win32',
      homeDir: 'C:\\Users\\researcher',
      pathExists: (candidate) => candidate === 'D:\\',
    })).toBe('D:\\autometa_workspace');
  });

  it('uses the E drive when D is unavailable', () => {
    expect(resolveDefaultWorkspacesRoot({
      platform: 'win32',
      homeDir: 'C:\\Users\\researcher',
      pathExists: (candidate) => candidate === 'E:\\',
    })).toBe('E:\\autometa_workspace');
  });

  it('falls back to the Windows user directory when D and E are unavailable', () => {
    expect(resolveDefaultWorkspacesRoot({
      platform: 'win32',
      homeDir: 'C:\\Users\\researcher',
      pathExists: () => false,
    })).toBe('C:\\Users\\researcher\\autometa_workspace');
  });
});
