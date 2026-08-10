import fs from 'fs';
import os from 'os';
import path from 'path';

export const DEFAULT_WORKSPACE_DIRNAME = 'autometa_workspace';

export function resolveDefaultWorkspacesRoot(options = {}) {
  const platform = options.platform || process.platform;
  const homeDir = options.homeDir || os.homedir();
  const pathExists = options.pathExists || fs.existsSync;

  if (platform === 'win32') {
    for (const driveRoot of ['D:\\', 'E:\\']) {
      if (pathExists(driveRoot)) {
        return path.win32.join(driveRoot, DEFAULT_WORKSPACE_DIRNAME);
      }
    }

    return path.win32.join(homeDir, DEFAULT_WORKSPACE_DIRNAME);
  }

  return path.join(homeDir, DEFAULT_WORKSPACE_DIRNAME);
}
