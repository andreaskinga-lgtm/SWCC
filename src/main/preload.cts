import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopOperations, Result } from '../shared/application.js';

async function invoke<T>(channel: string, input?: unknown): Promise<Result<T>> {
  try { return await ipcRenderer.invoke(channel, input) as Result<T>; }
  catch {
    return { ok: false, error: { code: 'IPC', message: 'The desktop connection failed. Keep your edits in this window and retry saving. Do not quit until Saved appears.' } };
  }
}
const operations: DesktopOperations = {
  getState: () => invoke('swcc:get-state'),
  createYear: year => invoke('swcc:create-year', year),
  openYear: id => invoke('swcc:open-year', id),
  saveDraft: input => invoke('swcc:save-draft', input),
  acknowledgeStorage: () => invoke('swcc:acknowledge-storage'),
  getReview: id => invoke('swcc:get-review', id),
  saveReviewPosition: position => invoke('swcc:save-review-position', position),
  recordReviewVisits: input => invoke('swcc:record-review-visits', input),
  resetReviewSection: input => invoke('swcc:reset-review-section', input),
  launchReviewResources: id => invoke('swcc:launch-review-resources', id),
  resetReviewResources: id => invoke('swcc:reset-review-resources', id),
  getReviewDocument: () => invoke('swcc:get-review-document'),
  getReaderActive: () => invoke('swcc:reader-active'),
  onReaderActiveChanged: handler => {
    const listener = (_event: Electron.IpcRendererEvent, active: boolean) => handler(active);
    ipcRenderer.on('swcc:reader-active-changed', listener);
    return () => ipcRenderer.removeListener('swcc:reader-active-changed', listener);
  },
  completeClose: () => invoke('swcc:complete-close'),
  onCloseRequested: handler => {
    const listener = () => handler();
    ipcRenderer.on('swcc:close-requested', listener);
    return () => ipcRenderer.removeListener('swcc:close-requested', listener);
  },
};
contextBridge.exposeInMainWorld('swcc', operations);
