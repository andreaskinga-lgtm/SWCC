import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopOperations, Result } from '../shared/application.js';

async function invoke<T>(channel: string, input?: unknown): Promise<Result<T>> {
  try { return await ipcRenderer.invoke(channel, input) as Result<T>; }
  catch {
    return { ok: false, error: { code: 'IPC', message: 'The desktop connection failed. Keep your edits in this window and retry saving. Do not quit until Saved appears.' } };
  }
}
const operations: DesktopOperations = {
  replaceFullDataset: input => invoke('swcc:replace-full-dataset', input),
  exportPortfolio: input => invoke('swcc:export-portfolio', input),
  getPortfolioProgress: () => invoke('swcc:get-portfolio-progress'),
  cancelPortfolioExport: () => invoke('swcc:cancel-portfolio-export'),
  inspectFullBackup: () => invoke('swcc:inspect-full-backup'),
  getRestoreProgress: () => invoke('swcc:get-restore-progress'),
  cancelRestorePreview: () => invoke('swcc:cancel-restore-preview'),
  exportForms: input => invoke('swcc:export-forms', input),
  createFullBackup: () => invoke('swcc:create-full-backup'),
  getBackupProgress: () => invoke('swcc:get-backup-progress'),
  cancelFullBackup: () => invoke('swcc:cancel-full-backup'),
  getWorkflow: id => invoke('swcc:get-workflow', id),
  completeStep: input => invoke('swcc:complete-step', input),
  recordDeclaration: input => invoke('swcc:record-declaration', input),
  getState: () => invoke('swcc:get-state'),
  createYear: year => invoke('swcc:create-year', year),
  openYear: id => invoke('swcc:open-year', id),
  saveDraft: input => invoke('swcc:save-draft', input),
  createGoal: input => invoke('swcc:create-goal', input),
  updateGoal: input => invoke('swcc:update-goal', input),
  deleteGoal: input => invoke('swcc:delete-goal', input),
  createActivity: input => invoke('swcc:create-activity', input),
  updateActivity: input => invoke('swcc:update-activity', input),
  deleteActivity: input => invoke('swcc:delete-activity', input),
  deleteYear: input => invoke('swcc:delete-year', input),
  getPlanReadiness: id => invoke('swcc:get-plan-readiness', id),
  openEvidenceLink: input => invoke('swcc:open-evidence-link', input),
  getEvidence: id => invoke('swcc:get-evidence', id),
  importEvidence: input => invoke('swcc:import-evidence', input),
  replaceEvidence: input => invoke('swcc:replace-evidence', input),
  removeEvidence: input => invoke('swcc:remove-evidence', input),
  previewEvidence: input => invoke('swcc:preview-evidence', input),
  openEvidence: input => invoke('swcc:open-evidence', input),
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
