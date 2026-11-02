import { app, BrowserWindow, dialog, ipcMain, powerMonitor, shell } from 'electron';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { openApplication } from './data/application.js';
import { SUPPORTED_EVIDENCE_EXTENSIONS } from './data/evidence.js';
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
let exportingForms: Promise<Result<unknown>> | null = null;

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
      const directory = fileURLToPath(new URL('.', import.meta.url));
      application = openApplication(storageRoot, {}, {
        openExternal: url => shell.openExternal(url),
        readDocument: () => readFileSync(app.isPackaged
          ? join(process.resourcesPath, 'sources', 'ethics-2018.pdf')
          : join(directory, '../../resources/sources/Code-of-Ethics-and-Standards-of-Practice-September-7-2018.pdf')),
      }, {
        chooseFile: async selection => {
          const options = {
            title: `Add evidence to ${selection.activityRef}`,
            properties: ['openFile'] as ['openFile'],
            filters: [{ name: 'Supported evidence', extensions: [...SUPPORTED_EVIDENCE_EXTENSIONS] }],
          };
          const result = window
            ? await dialog.showOpenDialog(window, options)
            : await dialog.showOpenDialog(options);
          return result.canceled ? null : result.filePaths[0] ?? null;
        },
        openPath: path => shell.openPath(path),
      }, {
        chooseDestination: async selection => {
          const options = { title: 'Export Forms PDF', defaultPath: selection.defaultName,
            filters: [{ name: 'PDF document', extensions: ['pdf'] }] };
          const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
          return result.canceled ? null : result.filePath ?? null;
        },
        readTemplate: () => readFileSync(app.isPackaged
          ? join(process.resourcesPath, 'templates', 'annual-forms.pdf') : join(directory, '../../resources/templates/annual-forms.pdf')),
        readFont: () => readFileSync(app.isPackaged
          ? join(process.resourcesPath, 'fonts', 'NotoSans-Regular.ttf') : join(directory, '../../resources/fonts/NotoSans-Regular.ttf')),
      }, {
        chooseDestination: async suggestedName => {
          const options = {
            title: 'Back up all years', defaultPath: suggestedName,
            filters: [{ name: 'SWCC full backup ZIP', extensions: ['zip'] }],
          };
          const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
          if (result.canceled || !result.filePath) return null;
          return result.filePath.endsWith('.swcc-backup.zip') ? result.filePath : `${result.filePath}.swcc-backup.zip`;
        },
      }, {
        chooseArchive: async () => {
          const options = {
            title: 'Preview a full-app backup', properties: ['openFile'] as ['openFile'],
            filters: [{ name: 'Full backup ZIP', extensions: ['zip'] }, { name: 'All files', extensions: ['*'] }],
          };
          const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
          return result.canceled ? null : result.filePaths[0] ?? null;
        },
      }, {
        chooseDestination: async suggestedName => {
          const options = { title: 'Export Complete Portfolio ZIP', defaultPath: suggestedName,
            filters: [{ name: 'Annual portfolio ZIP (not a full backup)', extensions: ['zip'] }] };
          const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
          if (result.canceled || !result.filePath) return null;
          return /\.zip$/i.test(result.filePath) ? result.filePath : `${result.filePath}.zip`;
        },
      });
      if (app.isPackaged) {
        for (const document of SOURCE_DOCUMENTS) {
          if (!existsSync(join(process.resourcesPath, 'sources', document.file))) throw new Error(`Bundled source document ${document.file} is missing. Reinstall SWCC; your dataset has not been replaced.`);
        }
        if (!existsSync(join(process.resourcesPath, 'templates', 'annual-forms.pdf')))
          throw new Error('Bundled export template annual-forms.pdf is missing. Reinstall SWCC; your dataset has not been replaced.');
      }
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
        'swcc:replace-full-dataset': 'replaceFullDataset',
        'swcc:export-portfolio': 'exportPortfolio', 'swcc:get-portfolio-progress': 'getPortfolioProgress',
        'swcc:cancel-portfolio-export': 'cancelPortfolioExport',
        'swcc:inspect-full-backup': 'inspectFullBackup', 'swcc:get-restore-progress': 'getRestoreProgress',
        'swcc:cancel-restore-preview': 'cancelRestorePreview',
        'swcc:export-forms': 'exportForms',
        'swcc:create-full-backup': 'createFullBackup', 'swcc:get-backup-progress': 'getBackupProgress',
        'swcc:cancel-full-backup': 'cancelFullBackup',
        'swcc:get-workflow': 'getWorkflow', 'swcc:complete-step': 'completeStep',
        'swcc:record-declaration': 'recordDeclaration',
        'swcc:get-state': 'getState', 'swcc:create-year': 'createYear', 'swcc:open-year': 'openYear',
        'swcc:save-draft': 'saveDraft', 'swcc:create-goal': 'createGoal', 'swcc:update-goal': 'updateGoal',
        'swcc:delete-goal': 'deleteGoal', 'swcc:acknowledge-storage': 'acknowledgeStorage',
        'swcc:create-activity': 'createActivity', 'swcc:update-activity': 'updateActivity',
        'swcc:delete-activity': 'deleteActivity', 'swcc:delete-year': 'deleteYear',
        'swcc:get-plan-readiness': 'getPlanReadiness', 'swcc:open-evidence-link': 'openEvidenceLink',
        'swcc:get-evidence': 'getEvidence', 'swcc:import-evidence': 'importEvidence',
        'swcc:replace-evidence': 'replaceEvidence', 'swcc:remove-evidence': 'removeEvidence',
        'swcc:preview-evidence': 'previewEvidence', 'swcc:open-evidence': 'openEvidence',
        'swcc:get-review': 'getReview', 'swcc:save-review-position': 'saveReviewPosition',
        'swcc:record-review-visits': 'recordReviewVisits', 'swcc:reset-review-section': 'resetReviewSection',
        'swcc:launch-review-resources': 'launchReviewResources', 'swcc:reset-review-resources': 'resetReviewResources',
        'swcc:get-review-document': 'getReviewDocument',
      };
      function trusted(event: Electron.IpcMainInvokeEvent) {
        return event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame
          && event.senderFrame.url === trustedURL;
      }
      for (const [channel, key] of Object.entries(channels)) {
        ipcMain.handle(channel, (event, input: unknown) => {
          if (!trusted(event)) return { ok: false, error: { code: 'IPC', message: 'Request denied: untrusted application content.' } };
          if (key === 'recordReviewVisits' && (!window?.isVisible() || !window.isFocused() || window.isMinimized()))
            return { ok: false, error: { code: 'INACTIVE', message: 'Return to the active reader to track this page.' } };
          const operation = operations[key] as (input: unknown) => Promise<Result<unknown>>;
          if (key === 'exportForms') {
            if (exportingForms) return { ok: false, error: { code: 'EXPORT', message: 'A Forms PDF export is already running. Wait for it to finish before exporting again.' } };
            exportingForms = operation(input).finally(() => { exportingForms = null; });
            return exportingForms;
          }
          return operation(input);
        });
      }
      const readerActive = () => Boolean(window?.isVisible() && window.isFocused() && !window.isMinimized());
      ipcMain.handle('swcc:reader-active', event => trusted(event)
        ? { ok: true, value: readerActive() }
        : { ok: false, error: { code: 'IPC', message: 'Request denied: untrusted application content.' } });
      const notifyReaderActive = () => window?.webContents.send('swcc:reader-active-changed', readerActive());
      window.on('focus', notifyReaderActive);
      window.on('blur', notifyReaderActive);
      window.on('show', notifyReaderActive);
      window.on('hide', notifyReaderActive);
      window.on('minimize', notifyReaderActive);
      window.on('restore', notifyReaderActive);
      ipcMain.handle('swcc:complete-close', async event => {
        if (!trusted(event) || !closeRequested) return { ok: false, error: { code: 'IPC', message: 'No close request is pending.' } };
        await exportingForms;
        const progress = await operations.getBackupProgress();
        if (!progress.ok || progress.value.phase !== 'idle') return {
          ok: false, error: { code: 'BUSY', message: 'A full backup is still running. Wait for it to finish or cancel it, then close SWCC deliberately.' },
        };
        const portfolio = await operations.getPortfolioProgress();
        if (!portfolio.ok || portfolio.value.phase !== 'idle') return {
          ok: false, error: { code: 'BUSY', message: 'A portfolio export is still running. Wait for it to finish or cancel it, then close SWCC deliberately.' },
        };
        const restore = await operations.getRestoreProgress();
        if (!restore.ok || !['idle', 'preview'].includes(restore.value.phase)) return {
          ok: false, error: { code: 'BUSY', message: ['protecting', 'moving', 'reopening', 'verifying', 'recovering'].includes(restore.ok ? restore.value.phase : '')
            ? 'Dataset replacement is still running. Wait for validation or recovery, then close SWCC deliberately.'
            : 'Backup inspection is still running. Wait for it or cancel inspection, then close SWCC deliberately.' },
        };
        const cancelled = await operations.cancelRestorePreview();
        if (!cancelled.ok) return cancelled;
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
