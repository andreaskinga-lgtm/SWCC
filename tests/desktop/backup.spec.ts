import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dismissActionFeedback, expectActionFeedback } from './feedback-helpers.js';

let desktop: ElectronApplication;
let page: Page;
let root: string;
let output: string;
async function launch() {
  desktop = await electron.launch({
    executablePath: process.env.SWCC_PACKAGED_EXECUTABLE,
    args: [...(process.env.SWCC_PACKAGED_EXECUTABLE ? [] : ['.']), `--user-data-dir=${root}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  page = await desktop.firstWindow();
  await page.context().setOffline(true);
  expect(page.url()).toMatch(/^file:/);
}
test.beforeEach(async () => {
  const id = randomUUID();
  root = resolve('.work', `desktop-backup-${id}`);
  output = resolve('.work', `desktop-backup-output-${id}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(output);
  await launch();
});
test.afterEach(async () => {
  await desktop?.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(output, { recursive: true, force: true });
});
async function navigate(name: string) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}
async function saveDialog(cancelled = false) {
  await desktop.evaluate(({ dialog }, selection) => {
    dialog.showSaveDialog = async () => ({ canceled: selection.cancelled, filePath: selection.path });
  }, { path: resolve(output, 'saved.swcc-backup.zip'), cancelled });
}
function storageFailure(action: string) {
  const executable = createRequire(import.meta.url)('electron') as string;
  const result = spawnSync(executable, ['tests/desktop/storage-fixture.mjs', resolve(root, 'dataset/database.sqlite'), action], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
}

test('backup progress IPC rejection is visible and retry resumes monitoring without restarting the backup', async () => {
  await page.getByRole('button', { name: 'I understand' }).click();
  await navigate('Backup and restore');
  await desktop.evaluate(({ dialog, ipcMain }) => {
    dialog.showSaveDialog = () => new Promise(resolveDialog => {
      (globalThis as typeof globalThis & { cancelBackupDialog: () => void }).cancelBackupDialog =
        () => resolveDialog({ canceled: true, filePath: '' });
    });
    ipcMain.removeHandler('swcc:get-backup-progress');
    ipcMain.handle('swcc:get-backup-progress', () => { throw new Error('backup progress connection interrupted'); });
  });
  try {
    await page.getByRole('button', { name: 'Create full backup', exact: true }).click();
    const progressFeedback = await expectActionFeedback(page, 'The desktop connection failed');
    await expect(progressFeedback.getByRole('alert')).toContainText('The desktop connection failed');
    await desktop.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('swcc:get-backup-progress');
      ipcMain.handle('swcc:get-backup-progress', () => ({
        ok: true, value: { phase: 'choosing', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0 },
      }));
    });
    await progressFeedback.getByRole('button', { name: 'Retry backup progress', exact: true }).click();
    await expect(progressFeedback).toBeHidden();
    await expect(page.getByRole('button', { name: 'Retry backup progress', exact: true })).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'Backup progress' })).toContainText('Choose where');
  } finally {
    await desktop.evaluate(() => {
      (globalThis as typeof globalThis & { cancelBackupDialog: () => void }).cancelBackupDialog();
    });
  }
  await expectActionFeedback(page, 'Backup cancelled');
  await dismissActionFeedback(page);
});

test('C backup screen creates a real full archive after flushing drafts; quiet status survives restart and later changes', async () => {
  await expect(page.getByRole('heading', { name: 'Your records stay on this device.' })).toBeVisible();
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
  await navigate('Self-assessment');
  await page.getByLabel('Strengths').fill('Draft committed before backup');
  await navigate('Backup and restore');
  await expect(page.getByRole('status', { name: 'Backup status' })).toContainText('No successful full backup');
  await expect(page.getByRole('heading', { name: 'Restore all years' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview full backup' })).toBeEnabled();
  await saveDialog();
  const backup = page.getByRole('button', { name: 'Create full backup', exact: true });
  await backup.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Backup status' })).toContainText('No changes since');
  await expectActionFeedback(page, 'Full backup saved');
  await dismissActionFeedback(page);
  expect(readFileSync(resolve(output, 'saved.swcc-backup.zip')).subarray(0, 2).toString()).toBe('PK');
  const state = await page.evaluate(async () => window.swcc.getState());
  expect(state).toMatchObject({ ok: true, value: { selectedPackage: { strengths: 'Draft committed before backup' } } });
  await desktop.close();
  await launch();
  await expect(page.getByRole('heading', { name: 'Your records stay on this device.' })).toHaveCount(0);
  await navigate('Backup and restore');
  await expect(page.getByRole('status', { name: 'Backup status' })).toContainText('No changes since');
  await navigate('Self-assessment');
  await page.getByLabel('Strengths').fill('Later work needs a new backup');
  await navigate('Backup and restore');
  await expect(page.getByRole('status', { name: 'Backup status' })).toContainText('Changes not backed up');
  await page.setViewportSize({ width: 620, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a failed draft flush keeps text visible and blocks backup; cancelling the save dialog leaves status unchanged', async () => {
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
  await navigate('Self-assessment');
  storageFailure('true');
  await page.getByLabel('Strengths').fill('Keep these unsaved strengths');
  await navigate('Backup and restore');
  await expectActionFeedback(page, 'disk full');
  await dismissActionFeedback(page);
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await expect(page.getByLabel('Strengths')).toHaveValue('Keep these unsaved strengths');
  await expect(page.getByRole('button', { name: 'Create full backup' })).toHaveCount(0);
  expect(readdirSync(output)).toEqual([]);
  storageFailure('false');
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await navigate('Backup and restore');
  await saveDialog(true);
  await page.getByRole('button', { name: 'Create full backup', exact: true }).click();
  await expectActionFeedback(page, 'Backup cancelled');
  await dismissActionFeedback(page);
  await expect(page.getByRole('status', { name: 'Backup status' })).toContainText('No successful full backup');
  expect(readdirSync(output)).toEqual([]);
});

test('backup shows busy progress, rejects conflicting typed operations and protects close while an OS dialog is pending', async () => {
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
  await navigate('Backup and restore');
  await desktop.evaluate(({ dialog }) => {
    dialog.showSaveDialog = () => new Promise(resolveDialog => {
      (globalThis as typeof globalThis & { cancelBackupDialog: () => void }).cancelBackupDialog =
        () => resolveDialog({ canceled: true, filePath: '' });
    });
  });
  await page.getByRole('button', { name: 'Create full backup', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Backup progress' })).toContainText('Choose where');
  await expect(page.getByRole('navigation').getByRole('button', { name: 'All years', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.swcc.createYear(2024))).toMatchObject({ ok: false, error: { code: 'BUSY' } });
  expect(await page.evaluate(async () => {
    const state = await window.swcc.getState();
    if (!state.ok || !state.value.selectedPackage) throw new Error('No saved package');
    return window.swcc.exportForms({ packageId: state.value.selectedPackage.id, confirmDraft: true });
  })).toMatchObject({ ok: false, error: { code: 'BUSY' } });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expectActionFeedback(page, 'full backup is still running');
  await dismissActionFeedback(page);
  expect(desktop.windows().length).toBe(1);
  await desktop.evaluate(() => {
    (globalThis as typeof globalThis & { cancelBackupDialog: () => void }).cancelBackupDialog();
  });
  await expectActionFeedback(page, 'Backup cancelled');
  await dismissActionFeedback(page);
  await expect(page.getByRole('status', { name: 'Backup progress' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(desktop.windows().length).toBe(1);
  await expect(page.getByRole('navigation').getByRole('button', { name: 'All years', exact: true })).toBeEnabled();
  expect(readdirSync(output)).toEqual([]);
});

test('failed real reader writes block backup navigation until retained review progress can be saved', async () => {
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
  await navigate('Review');
  storageFailure('review-fail');
  await desktop.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true });
    BrowserWindow.getAllWindows()[0].focus();
  });
  await page.getByLabel('Physical PDF page', { exact: true }).fill('2');
  await page.getByLabel('Physical PDF page', { exact: true }).press('Enter');
  await expect(page.getByRole('img', { name: 'Supplied Code of Ethics, physical page 2', exact: true })).toBeVisible();
  await expectActionFeedback(page, 'disk full');
  await dismissActionFeedback(page);
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await navigate('Backup and restore');
  await expect(page.getByLabel('Physical PDF page', { exact: true })).toHaveValue('2');
  await expect(page.getByRole('button', { name: 'Create full backup' })).toHaveCount(0);
  storageFailure('review-repair');
  await page.getByRole('button', { name: 'Retry review save', exact: true }).click();
  await navigate('Backup and restore');
  await saveDialog();
  await page.getByRole('button', { name: 'Create full backup', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Backup status' })).toContainText('No changes since');
  const review = await page.evaluate(async () => {
    const state = await window.swcc.getState();
    if (!state.ok || !state.value.selectedPackage) throw new Error('No saved package');
    return window.swcc.getReview(state.value.selectedPackage.id);
  });
  if (!review.ok) throw new Error(review.error.message);
  expect(review.value.visitedPages).toContain(2);
});
