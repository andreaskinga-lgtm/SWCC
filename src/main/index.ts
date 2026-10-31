import { app, BrowserWindow, dialog, ipcMain, powerMonitor } from 'electron';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, existsSync } from 'node:fs';
import { openApplication } from './data/application.js';
import { SOURCE_DOCUMENTS } from '../shared/application.js';
import type { ApplicationOperations, Result } from '../shared/application.js';
import { storageLayout } from './data/storage.js';

// This name is an upgrade contract, independent of the npm package/executable.
const customRoot = app.commandLine.getSwitchValue('user-data-dir');
const storageRoot = customRoot || join(app.getPath('appData'), 'SWCC');
let startupFailure: unknown;
try {
  if (customRoot && !isAbsolute(customRoot)) throw new Error('--user-data-dir must be an absolute path.');
  app.setPath('userData', storageRoot);
  const paths = storageLayout(storageRoot);
  mkdirSync(paths.runtime, { recursive: true });
  app.setPath('sessionData', paths.runtime);
  app.setPath('logs', join(paths.runtime, 'logs'));
} catch (error) { startupFailure = error; }

let window: BrowserWindow | null = null;
let application: ReturnType<typeof openApplication> | null = null;
let approvedClose = false;
let closeRequested = false;

function requestClose() {
  closeRequested = true;
  if (window && !window.webContents.isDestroyed()) {
    window.webContents.send('swcc:close-requested');
    window.show();
    window.focus();
  }
}
if (startupFailure) {
  app.whenReady().then(() => {
    dialog.showErrorBox('SWCC storage is unavailable', `Cannot use ${storageRoot}: ${String(startupFailure)}\nExisting records have not been replaced. Check folder permissions and available disk space.`);
    app.quit();
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.on('before-quit', event => {
    if (!approvedClose && window) { event.preventDefault(); requestClose(); }
  });
  app.on('window-all-closed', () => {
    application?.close();
    application = null;
    app.quit();
  });
  app.whenReady().then(async () => {
    try {
      application = openApplication(storageRoot);
      if (app.isPackaged) {
        for (const document of SOURCE_DOCUMENTS) {
          if (!existsSync(join(process.resourcesPath, 'sources', document.file))) throw new Error(`Bundled source document ${document.file} is missing. Reinstall SWCC; your dataset has not been replaced.`);
        }
      }
      const directory = fileURLToPath(new URL('.', import.meta.url));
      window = new BrowserWindow({
        title: 'SWCC — My learning portfolio',
        width: 1280, height: 900, minWidth: 520, minHeight: 550,
        backgroundColor: '#f2f4eb',
        webPreferences: {
          preload: join(directory, 'preload.cjs'),
          contextIsolation: true, nodeIntegration: false, sandbox: true,
        },
      });
      const rendererPath = join(directory, '../renderer/index.html');
      const devURL = !app.isPackaged ? process.env.SWCC_DEV_URL : undefined;
      if (devURL && devURL !== 'http://127.0.0.1:5173') throw new Error('The development renderer must use the local Vite server.');
      const trustedURL = devURL ? new URL(devURL).href : pathToFileURL(rendererPath).href;
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, target) => { if (target !== trustedURL) event.preventDefault(); });
      window.webContents.on('will-redirect', (event, target) => { if (target !== trustedURL) event.preventDefault(); });
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      window.webContents.session.setPermissionCheckHandler(() => false);
      window.on('close', event => {
        if (!approvedClose) { event.preventDefault(); requestClose(); }
      });
      window.on('query-session-end', event => { if (!approvedClose) { event.preventDefault(); requestClose(); } });
      // Electron 38 documents the event but omits it from this listener's type.
      powerMonitor.on('shutdown', ((event: Electron.Event) => {
        if (!approvedClose) { event.preventDefault(); requestClose(); }
      }) as () => void);
      window.webContents.on('render-process-gone', () => {
        dialog.showErrorBox('SWCC renderer stopped', 'The window stopped responding. Unsaved edits may not be durable. Saved records remain in local storage. Forced termination cannot flush edits.');
      });
      const operations = application.operations;
      const channels: Record<string, keyof ApplicationOperations> = {
        'swcc:get-state': 'getState', 'swcc:create-year': 'createYear', 'swcc:open-year': 'openYear',
        'swcc:save-draft': 'saveDraft', 'swcc:create-goal': 'createGoal', 'swcc:update-goal': 'updateGoal',
        'swcc:delete-goal': 'deleteGoal', 'swcc:acknowledge-storage': 'acknowledgeStorage',
      };
      function trusted(event: Electron.IpcMainInvokeEvent) {
        return event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame
          && event.senderFrame.url === trustedURL;
      }
      for (const [channel, key] of Object.entries(channels)) {
        ipcMain.handle(channel, (event, input: unknown) => {
          if (!trusted(event)) return { ok: false, error: { code: 'IPC', message: 'Request denied: untrusted application content.' } };
          const operation = operations[key] as (input: unknown) => Promise<Result<unknown>>;
          return operation(input);
        });
      }
      ipcMain.handle('swcc:complete-close', event => {
        if (!trusted(event) || !closeRequested) return { ok: false, error: { code: 'IPC', message: 'No close request is pending.' } };
        approvedClose = true;
        // Allow the IPC acknowledgement to reach the renderer before destruction.
        setImmediate(() => app.quit());
        return { ok: true, value: undefined };
      });
      if (devURL) await window.loadURL(trustedURL);
      else await window.loadFile(rendererPath);
    } catch (error) {
      dialog.showErrorBox('SWCC cannot open local records', `${error instanceof Error ? error.message : String(error)}\nStorage: ${storageRoot}\nNo empty replacement dataset was created. Preserve this folder and seek help before attempting recovery.`);
      application?.close();
      application = null;
      approvedClose = true;
      app.quit();
    }
  });
}
