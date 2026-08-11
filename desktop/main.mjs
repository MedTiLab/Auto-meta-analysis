import { app, BrowserWindow, clipboard, dialog, ipcMain, screen, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  resolveAppDataRoot,
  resolveAppDatabasePath,
  resolveDesktopLogFallbackPath,
  resolveLegacyDatabasePaths,
} from '../server/utils/storagePaths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const PRODUCT_NAME = 'MedAutoData';
const APP_ID = 'com.yzglab.medautodata';
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 960;
const MIN_WIDTH = 1100;
const MIN_HEIGHT = 720;
const SERVER_WAIT_TIMEOUT_MS = 30_000;
const WINDOW_STATE_SAVE_DELAY_MS = 250;
const LEGACY_WORKSPACE_ROOTS = ['dr-claw', 'vibelab'];

process.env.HOST ??= '127.0.0.1';
process.env.PORT ??= '3001';
process.env.MEDAUTODATA_DESKTOP = '1';

app.setName(PRODUCT_NAME);
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}
app.setPath('userData', path.join(app.getPath('appData'), PRODUCT_NAME));

let mainWindow = null;
let serverModulePromise = null;
let isQuitting = false;
let saveWindowStateTimer = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

ipcMain.handle('desktop:write-clipboard-text', async (_event, text) => {
  clipboard.writeText(typeof text === 'string' ? text : String(text ?? ''));
  return true;
});

ipcMain.handle('desktop:choose-directory', async (_event, defaultPath = '') => {
  const requestedPath = String(defaultPath || '').trim();
  const expandedPath = requestedPath.replace(/^~(?=$|[\\/])/, os.homedir());
  const openResult = await dialog.showOpenDialog(mainWindow || undefined, {
    title: 'Select Skill Directory',
    defaultPath: expandedPath ? path.resolve(expandedPath) : os.homedir(),
    properties: ['openDirectory'],
  });

  if (openResult.canceled || !openResult.filePaths[0]) {
    return { canceled: true };
  }

  return { canceled: false, filePath: openResult.filePaths[0] };
});

function sanitizeDesktopDownloadFileName(defaultFileName) {
  const fallbackName = 'download.zip';
  const safeBaseName = path.basename(String(defaultFileName || fallbackName))
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/^\.+/, '')
    .trim();

  return safeBaseName || fallbackName;
}

function bufferFromIpcData(data) {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }

  if (Array.isArray(data)) {
    return Buffer.from(data);
  }

  throw new Error('Invalid file data');
}

ipcMain.handle('desktop:save-file', async (_event, payload = {}) => {
  const defaultFileName = sanitizeDesktopDownloadFileName(payload.defaultFileName);
  const saveResult = await dialog.showSaveDialog(mainWindow || undefined, {
    defaultPath: path.join(app.getPath('downloads'), defaultFileName),
    filters: [
      { name: 'ZIP Archive', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { canceled: true };
  }

  await fs.promises.writeFile(saveResult.filePath, bufferFromIpcData(payload.data));
  return { canceled: false, filePath: saveResult.filePath };
});

function getDesktopLogPath() {
  const baseDir = app.isReady()
    ? app.getPath('userData')
    : path.dirname(resolveDesktopLogFallbackPath());
  return path.join(baseDir, 'desktop.log');
}

function logDesktop(message, details = null) {
  const suffix = details == null
    ? ''
    : ` ${typeof details === 'string' ? details : JSON.stringify(details)}`;
  const line = `[${new Date().toISOString()}] ${message}${suffix}`;
  console.log(line);

  try {
    fs.mkdirSync(path.dirname(getDesktopLogPath()), { recursive: true });
    fs.appendFileSync(getDesktopLogPath(), `${line}\n`, 'utf8');
  } catch {
    // Ignore log persistence failures.
  }
}

process.on('uncaughtException', (error) => {
  logDesktop('uncaughtException', error instanceof Error
    ? { message: error.message, stack: error.stack }
    : String(error));
});

process.on('unhandledRejection', (reason) => {
  logDesktop('unhandledRejection', reason instanceof Error
    ? { message: reason.message, stack: reason.stack }
    : String(reason));
});

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
      return parsed;
    }
  } catch {
    // First launch or invalid state file.
  }

  return null;
}

function saveWindowState(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  const bounds = window.getBounds();
  const state = {
    ...bounds,
    isMaximized: window.isMaximized(),
  };

  try {
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state), 'utf8');
  } catch (error) {
    logDesktop('Failed to save window state', error instanceof Error ? error.message : String(error));
  }
}

function scheduleWindowStateSave(window) {
  if (saveWindowStateTimer) {
    clearTimeout(saveWindowStateTimer);
  }

  saveWindowStateTimer = setTimeout(() => {
    saveWindowState(window);
    saveWindowStateTimer = null;
  }, WINDOW_STATE_SAVE_DELAY_MS);
}

function isWindowVisible(bounds) {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapWidth = Math.max(
      0,
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x),
    );
    const overlapHeight = Math.max(
      0,
      Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y),
    );

    return overlapWidth >= 240 && overlapHeight >= 180;
  });
}

function ensureWindowVisible(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  const bounds = window.getBounds();
  if (isWindowVisible(bounds)) {
    return;
  }

  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(Math.max(bounds.width || DEFAULT_WIDTH, MIN_WIDTH), Math.max(workArea.width - 48, MIN_WIDTH));
  const height = Math.min(Math.max(bounds.height || DEFAULT_HEIGHT, MIN_HEIGHT), Math.max(workArea.height - 64, MIN_HEIGHT));

  window.setBounds({
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = SERVER_WAIT_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        return;
      }
      lastError = new Error(`Unexpected health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await wait(500);
  }

  throw new Error(`Timed out waiting for local server at ${url}${lastError ? `: ${lastError.message}` : ''}`);
}

function resolveSharedDatabasePath(workspacesRoot) {
  const currentDbPath = resolveAppDatabasePath({
    dataDir: resolveAppDataRoot({ workspacesRoot }),
  });
  const currentSidecars = [`${currentDbPath}-shm`, `${currentDbPath}-wal`];

  if (fs.existsSync(currentDbPath)) {
    return currentDbPath;
  }

  const legacyDbPath = resolveLegacyDatabasePaths(app.getPath('home'))
    .find((candidatePath) => fs.existsSync(candidatePath));

  if (!legacyDbPath) {
    return currentDbPath;
  }

  const legacySidecars = [`${legacyDbPath}-shm`, `${legacyDbPath}-wal`];

  try {
    fs.mkdirSync(path.dirname(currentDbPath), { recursive: true });
    fs.copyFileSync(legacyDbPath, currentDbPath);

    legacySidecars.forEach((legacySidecar, index) => {
      if (fs.existsSync(legacySidecar) && !fs.existsSync(currentSidecars[index])) {
        fs.copyFileSync(legacySidecar, currentSidecars[index]);
      }
    });

    logDesktop('Migrated legacy auth database', { from: legacyDbPath, to: currentDbPath });
    return currentDbPath;
  } catch (error) {
    logDesktop('Failed to migrate legacy auth DB, using legacy path', error instanceof Error ? error.message : String(error));
    return legacyDbPath;
  }
}

function resolveSharedWorkspacesRoot() {
  const homeDir = app.getPath('home');
  const currentRoot = path.join(homeDir, 'medautodata');

  if (fs.existsSync(currentRoot)) {
    return currentRoot;
  }

  const legacyRoot = LEGACY_WORKSPACE_ROOTS
    .map((legacyRootName) => path.join(homeDir, legacyRootName))
    .find((candidatePath) => fs.existsSync(candidatePath));

  return legacyRoot || currentRoot;
}

function bootstrapDesktopEnvironment() {
  const workspacesRoot = process.env.WORKSPACES_ROOT || resolveSharedWorkspacesRoot();
  const dataRoot = resolveAppDataRoot({ workspacesRoot });
  const runtimeDir = path.join(dataRoot, 'runtime');
  const databasePath = process.env.DATABASE_PATH || resolveSharedDatabasePath(workspacesRoot);

  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.mkdirSync(workspacesRoot, { recursive: true });

  process.env.DATABASE_PATH = databasePath;
  process.env.WORKSPACES_ROOT = workspacesRoot;
  process.env.MEDAUTODATA_DATA_DIR = process.env.MEDAUTODATA_DATA_DIR || dataRoot;
  process.env.MEDAUTODATA_RUNTIME_DIR = process.env.MEDAUTODATA_RUNTIME_DIR || runtimeDir;
  process.env.DR_CLAW_RUNTIME_DIR = process.env.DR_CLAW_RUNTIME_DIR || process.env.MEDAUTODATA_RUNTIME_DIR;

  logDesktop('Desktop environment prepared', {
    databasePath,
    dataRoot,
    workspacesRoot,
    runtimeDir: process.env.MEDAUTODATA_RUNTIME_DIR,
  });
}

async function loadServerModule() {
  if (!serverModulePromise) {
    bootstrapDesktopEnvironment();
    serverModulePromise = import(pathToFileURL(path.join(projectRoot, 'server/index.js')).href);
  }

  return serverModulePromise;
}

async function stopBackend() {
  try {
    const serverModule = await loadServerModule();
    if (serverModule?.stopServer) {
      await serverModule.stopServer();
    }
  } catch (error) {
    logDesktop('Failed to stop backend cleanly', error instanceof Error ? error.message : String(error));
  }
}

function wireExternalNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

async function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  const serverModule = await loadServerModule();
  const { activePort } = await serverModule.startServer();
  const appUrl = `http://127.0.0.1:${activePort}`;
  await waitForServer(`${appUrl}/health`);

  const savedState = loadWindowState();
  const windowOptions = {
    width: savedState?.width || DEFAULT_WIDTH,
    height: savedState?.height || DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    autoHideMenuBar: true,
    show: false,
    center: !savedState,
    title: PRODUCT_NAME,
    backgroundColor: '#0b1020',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  if (savedState?.x != null && savedState?.y != null) {
    windowOptions.x = savedState.x;
    windowOptions.y = savedState.y;
  }

  mainWindow = new BrowserWindow(windowOptions);
  if (savedState?.isMaximized) {
    mainWindow.maximize();
  }

  ensureWindowVisible(mainWindow);
  wireExternalNavigation(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('move', () => scheduleWindowStateSave(mainWindow));
  mainWindow.on('resize', () => scheduleWindowStateSave(mainWindow));
  mainWindow.on('maximize', () => scheduleWindowStateSave(mainWindow));
  mainWindow.on('unmaximize', () => scheduleWindowStateSave(mainWindow));
  mainWindow.on('close', () => saveWindowState(mainWindow));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  logDesktop('Loading desktop window', { url: appUrl });
  await mainWindow.loadURL(appUrl);
  return mainWindow;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

async function bootstrap() {
  try {
    await app.whenReady();
    await createMainWindow();

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
        return;
      }

      focusMainWindow();
    });
  } catch (error) {
    logDesktop('Failed to start desktop app', error instanceof Error ? {
      message: error.message,
      stack: error.stack,
    } : String(error));
    dialog.showErrorBox(
      'MedAutoData Desktop Failed to Start',
      error?.stack || error?.message || String(error)
    );
    await stopBackend();
    app.exit(1);
  }
}

app.on('second-instance', () => {
  focusMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (isQuitting) {
    return;
  }

  event.preventDefault();
  isQuitting = true;
  saveWindowState(mainWindow);

  stopBackend().finally(() => {
    app.exit(0);
  });
});

bootstrap();
