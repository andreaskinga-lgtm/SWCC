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
  createGoal: input => invoke('swcc:create-goal', input),
  updateGoal: input => invoke('swcc:update-goal', input),
  deleteGoal: input => invoke('swcc:delete-goal', input),
  acknowledgeStorage: () => invoke('swcc:acknowledge-storage'),
  completeClose: () => invoke('swcc:complete-close'),
  onCloseRequested: handler => {
    const listener = () => handler();
    ipcRenderer.on('swcc:close-requested', listener);
    return () => ipcRenderer.removeListener('swcc:close-requested', listener);
  },
};
contextBridge.exposeInMainWorld('swcc', operations);
