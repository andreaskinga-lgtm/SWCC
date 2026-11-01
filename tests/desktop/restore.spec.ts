import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dismissActionFeedback, expectActionFeedback } from './feedback-helpers.js';

let desktop: ElectronApplication;
let page: Page;
let root: string;
let output: string;
test.beforeEach(async () => {
  const id = randomUUID();
  root = resolve('.work', `desktop-restore-${id}`);
  output = resolve('.work', `desktop-restore-output-${id}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(output);
  desktop = await electron.launch({
    executablePath: process.env.SWCC_PACKAGED_EXECUTABLE,
    args: [...(process.env.SWCC_PACKAGED_EXECUTABLE ? [] : ['.']), `--user-data-dir=${root}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  page = await desktop.firstWindow();
  await page.context().setOffline(true);
  expect(page.url()).toMatch(/^file:/);
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
});
test.afterEach(async () => {
  await desktop?.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(output, { recursive: true, force: true });
});
async function navigate(name: string) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}
async function chooseArchive(path: string | null) {
  await desktop.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: !path, filePaths: path ? [path] : [] });
  }, path);
}
async function expectDismissedFeedback(message: string) {
  await expectActionFeedback(page, message);
  await dismissActionFeedback(page);
}
function storageFailure(failing: boolean | string) {
  const executable = createRequire(import.meta.url)('electron') as string;
  const result = spawnSync(executable, ['tests/desktop/storage-fixture.mjs', resolve(root, 'dataset/database.sqlite'), String(failing)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
}

  async function replacementPreview() {
    const archive = resolve(output, 'transaction.swcc-backup.zip');
    await navigate('Backup and restore');
    await desktop.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, archive);
    await page.getByRole('button', { name: 'Create full backup', exact: true }).click();
    await expectDismissedFeedback('Full backup saved');
    await navigate('All years');
    await page.getByLabel('New package year').fill('2026');
    await page.getByLabel('New package year').press('Enter');
    await navigate('Backup and restore');
    await chooseArchive(archive);
    await page.getByRole('button', { name: 'Preview full backup', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Preview full-app restore' })).toBeVisible();
    return archive;
  }

  async function protectiveWrite(mode: 'pause' | 'fail') {
    await desktop.evaluate(async (_electron, mode) => {
      const { syncBuiltinESMExports } = process.getBuiltinModule('node:module');
      const fs = process.getBuiltinModule('node:fs');
      const original = fs.createWriteStream;
      const fixture = globalThis as typeof globalThis & { releaseProtectiveWrite?: () => void };
      fs.createWriteStream = ((path, options) => {
        const stream = original(path, options);
        if (String(path).includes('restore-recovery') && String(path).endsWith('.partial')) {
          if (mode === 'fail') queueMicrotask(() => stream.destroy(new Error('Injected protective output failure')));
          else {
            const write = stream._write;
            let held = false;
            stream._write = function (chunk, encoding, callback) {
              if (held) { write.call(this, chunk, encoding, callback); return; }
              held = true;
              fixture.releaseProtectiveWrite = () => write.call(this, chunk, encoding, callback);
            };
          }
        }
        return stream;
      }) as typeof original;
      syncBuiltinESMExports();
      const release = () => {
        fixture.releaseProtectiveWrite?.();
        fixture.releaseProtectiveWrite = undefined;
        fs.createWriteStream = original;
        syncBuiltinESMExports();
      };
      (globalThis as typeof globalThis & { restoreOutputFixture: () => void }).restoreOutputFixture = release;
    }, mode);
  }
  async function releaseProtectiveWrite() {
    await desktop.evaluate(() => {
      (globalThis as typeof globalThis & { restoreOutputFixture?: () => void }).restoreOutputFixture?.();
    });
  }

  test('actual protective ZIP progress blocks renderer editing, cancellation, competing operations and normal close until verified replacement finishes', async () => {
    await replacementPreview();
    await protectiveWrite('pause');
    try {
      const dialog = page.getByRole('dialog', { name: 'Preview full-app restore' });
      await dialog.getByRole('button', { name: 'Replace all years', exact: true }).click();
      await expect.poll(() => desktop.evaluate(() =>
        Boolean((globalThis as typeof globalThis & { releaseProtectiveWrite?: () => void }).releaseProtectiveWrite))).toBe(true);
      await expect(dialog.getByRole('status', { name: 'Replacement progress' })).toContainText('protective full backup');
      await expect(dialog.getByRole('button', { name: 'Cancel, keep current data' })).toBeDisabled();
      await expect(page.getByRole('navigation').getByRole('button', { name: 'All years', exact: true })).toBeDisabled();
      expect(await page.evaluate(() => window.swcc.createYear(2027))).toMatchObject({ ok: false, error: { code: 'BUSY' } });
      expect(await page.evaluate(() => window.swcc.cancelRestorePreview())).toMatchObject({ ok: false, error: { code: 'BUSY' } });
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      await expectActionFeedback(page, 'Dataset replacement is still running');
      expect(desktop.windows().length).toBe(1);
      await dismissActionFeedback(page);
    } finally { await releaseProtectiveWrite(); }
    await expectDismissedFeedback('All years restored');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(desktop.windows().length).toBe(1);
    await expect(page.locator('.error-panel')).toHaveCount(0);
  });

  test('a real protective output failure explains abort, keeps current records usable and permits a successful retry', async () => {
    await replacementPreview();
    const before = await page.evaluate(() => window.swcc.getState());
    await protectiveWrite('fail');
    try {
      await page.getByRole('dialog').getByRole('button', { name: 'Replace all years', exact: true }).click();
      const failure = await expectActionFeedback(page, 'Injected protective output failure');
      await expect(failure.getByRole('alert')).toContainText('current dataset remains usable');
      await dismissActionFeedback(page);
      await expect(page.locator('.action-feedback-dialog')).toBeHidden();
      await expect(page.getByRole('dialog', { name: 'Preview full-app restore' })).toHaveCount(0);
      expect(await page.evaluate(() => window.swcc.getState())).toEqual(before);
    } finally { await releaseProtectiveWrite(); }
    await chooseArchive(resolve(output, 'transaction.swcc-backup.zip'));
    await page.getByRole('button', { name: 'Preview full backup', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'Preview full-app restore' });
    await expect(preview).toBeVisible();
    await preview.getByRole('button', { name: 'Replace all years', exact: true }).click();
    await expectDismissedFeedback('All years restored');
  });

  test('actual desktop startup reads an interrupted replacement journal first and explains recovered prior years', async () => {
    const archive = await replacementPreview();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel, keep current data' }).click();
    await expectDismissedFeedback('Backup inspection cancelled');
    await desktop.close();
    const executable = createRequire(import.meta.url)('electron') as string;
    const killed = spawnSync(executable, ['tests/restore-process.mjs', root, archive, 'replace', 'replacement-moved'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30_000,
    });
    expect(killed.signal, killed.stderr).toBe('SIGKILL');
    desktop = await electron.launch({ args: ['.', `--user-data-dir=${root}`], env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
    page = await desktop.firstWindow();
    await page.context().setOffline(true);
    await expectActionFeedback(page, 'prior usable dataset has been recovered');
    await dismissActionFeedback(page);
    await navigate('All years');
    await expect(page.getByRole('button', { name: 'Open 2026' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open 2024' })).toBeVisible();
  });

  test('failed real review flush blocks inspection and retains the actually displayed page until retry', async () => {
    await navigate('Review');
    storageFailure('review-fail');
    await desktop.evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows()[0].focus(); });
    await page.getByLabel('Physical PDF page', { exact: true }).fill('2');
    await page.getByLabel('Physical PDF page', { exact: true }).press('Enter');
    await expect(page.getByRole('img', { name: 'Supplied Code of Ethics, physical page 2', exact: true })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
    await navigate('Backup and restore');
    await expect(page.getByLabel('Physical PDF page', { exact: true })).toHaveValue('2');
    await expect(page.getByRole('button', { name: 'Preview full backup', exact: true })).toHaveCount(0);
    storageFailure('review-repair');
    await page.getByRole('button', { name: 'Retry review save', exact: true }).click();
    await navigate('Backup and restore');
    await chooseArchive(null);
    await page.getByRole('button', { name: 'Preview full backup', exact: true }).click();
    await expectDismissedFeedback('Backup inspection cancelled');
  });
test('the real C renderer previews a genuine backup, shows replacement counts and cancels without restoring', async () => {
  const archive = resolve(output, 'actual.swcc-backup.zip');
  const source = resolve(output, 'notes.txt');
  writeFileSync(source, 'Original attachment');
  await chooseArchive(source);
  await page.evaluate(async () => {
    const state = await window.swcc.getState();
    if (!state.ok || !state.value.selectedPackage) throw new Error('No year');
    let pkg = state.value.selectedPackage;
    const goal = await window.swcc.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Learning goal' });
    if (!goal.ok) throw new Error(goal.error.message);
    pkg = goal.value;
    const activity = await window.swcc.createActivity({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Consultation', goalIds: [pkg.goals[0].id],
    });

    if (!activity.ok) throw new Error(activity.error.message);
    pkg = activity.value;
    const imported = await window.swcc.importEvidence({ packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId: pkg.activities[0].id });
    if (!imported.ok) throw new Error(imported.error.message);
  });
  await navigate('All years');
  await page.getByRole('button', { name: 'Open 2024' }).click();
  await navigate('Self-assessment');
  await page.getByLabel('Strengths').fill('Saved before inspection');
  await navigate('Backup and restore');
  await desktop.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, archive);
  await page.getByRole('button', { name: 'Create full backup', exact: true }).click();
  await expectDismissedFeedback('Full backup saved');
  await navigate('All years');
  await page.getByLabel('New package year').fill('2025');
  await page.getByLabel('New package year').press('Enter');
  await navigate('Backup and restore');
  const before = await page.evaluate(() => window.swcc.getState());
  await chooseArchive(archive);
  const preview = page.getByRole('button', { name: 'Preview full backup', exact: true });
  await preview.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Preview full-app restore' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.restore-compare section').nth(0)).toContainText('2024');
  await expect(dialog.locator('.restore-compare section').nth(0)).toContainText('1 goals · 1 activities · 1 evidence files');
  await expect(dialog.locator('.restore-compare section').nth(1)).toContainText('2025, 2024');
  await expect(dialog.getByRole('button', { name: 'Replace all years', exact: true })).toBeEnabled();
  await expect(dialog).toContainText('No records have been restored');
  expect(await page.evaluate(() => window.swcc.getState())).toEqual(before);
  await page.setViewportSize({ width: 620, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel, keep current data' }).click();
  await expect(dialog).toHaveCount(0);
  await expectDismissedFeedback('Backup inspection cancelled');
  expect(readdirSync(resolve(root, 'restore-staging'))).toEqual([]);
  expect(await page.evaluate(() => window.swcc.getState())).toEqual(before);
  await navigate('All years');
  await page.getByRole('button', { name: 'Open 2024' }).click();
  await navigate('Self-assessment');
  await expect(page.getByLabel('Strengths')).toHaveValue('Saved before inspection');
});

test('explicit keyboard confirmation replaces the real dataset and refreshes the actual renderer without a false backup status', async () => {
  const archive = resolve(output, 'replace.swcc-backup.zip');
  await navigate('Self-assessment');
  await page.getByLabel('Strengths').fill('Restored annual writing');
  await navigate('Backup and restore');
  await desktop.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, archive);
  await page.getByRole('button', { name: 'Create full backup', exact: true }).click();
  await expectDismissedFeedback('Full backup saved');
  await navigate('All years');
  await page.getByLabel('New package year').fill('2026');
  await page.getByLabel('New package year').press('Enter');
  await navigate('Backup and restore');
  await chooseArchive(archive);
  await page.getByRole('button', { name: 'Preview full backup', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Preview full-app restore' });
  await expect(dialog).toContainText('2026, 2024');
  const confirm = dialog.getByRole('button', { name: 'Replace all years', exact: true });
  await confirm.focus();
  await page.keyboard.press('Enter');
  await expectDismissedFeedback('All years restored');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Backup status' })).toContainText('No successful full backup');
  expect(readdirSync(resolve(root, 'restore-recovery')).length).toBe(1);
  expect(readdirSync(resolve(root, 'restore-staging'))).toEqual([]);
  await navigate('All years');
  await expect(page.getByRole('button', { name: 'Open 2026' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open 2024' }).click();
  await navigate('Self-assessment');
  await expect(page.getByLabel('Strengths')).toHaveValue('Restored annual writing');
});

test('a real fresh installation confirms and restores a populated backup using an actual protective empty-dataset backup', async () => {
  const archive = await replacementPreview();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel, keep current data' }).click();
  await desktop.close();
  rmSync(root, { recursive: true, force: true });
  root = resolve(output, 'fresh-install');
  mkdirSync(root);
  desktop = await electron.launch({ args: ['.', `--user-data-dir=${root}`], env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  page = await desktop.firstWindow();
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'I understand' }).click();
  await navigate('Backup and restore');
  await chooseArchive(archive);
  await page.getByRole('button', { name: 'Preview full backup', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.restore-compare section').nth(1)).toContainText('Years: None');
  await dialog.getByRole('button', { name: 'Replace all years', exact: true }).click();
  await expectDismissedFeedback('All years restored');
  await navigate('All years');
  await expect(page.getByRole('button', { name: 'Open 2024' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open 2026' })).toHaveCount(0);
});

test('restoring the same selected ID refreshes both writing and remembered reader state rather than keeping current cached values', async () => {
  const archive = resolve(output, 'same-id.swcc-backup.zip');
  await navigate('Self-assessment');
  await page.getByLabel('Strengths').fill('Archived same-ID strengths');
  await navigate('Backup and restore');
  await desktop.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, archive);
  await page.getByRole('button', { name: 'Create full backup', exact: true }).click();
  await expectDismissedFeedback('Full backup saved');
  await navigate('Self-assessment');
  await page.getByLabel('Strengths').fill('Current same-ID strengths to replace');
  await navigate('Review');
  await page.getByLabel('Physical PDF page', { exact: true }).fill('2');
  await page.getByLabel('Physical PDF page', { exact: true }).press('Enter');
  await expect(page.getByRole('img', { name: 'Supplied Code of Ethics, physical page 2', exact: true })).toBeVisible();
  await navigate('Backup and restore');
  await chooseArchive(archive);
  await page.getByRole('button', { name: 'Preview full backup', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Replace all years', exact: true }).click();
  await expectDismissedFeedback('All years restored');
  await navigate('Self-assessment');
  await expect(page.getByLabel('Strengths')).toHaveValue('Archived same-ID strengths');
  await navigate('Review');
  await expect(page.getByLabel('Physical PDF page', { exact: true })).toHaveValue('1');
});

test('failed real draft flush blocks inspection navigation and keeps the pending text available to retry', async () => {
  await navigate('Self-assessment');
  storageFailure(true);
  await page.getByLabel('Strengths').fill('Keep this unsaved draft, do not inspect');
  await navigate('Backup and restore');
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await expect(page.getByLabel('Strengths')).toHaveValue('Keep this unsaved draft, do not inspect');
  await expect(page.getByRole('button', { name: 'Preview full backup' })).toHaveCount(0);
  expect(readdirSync(output)).toEqual([]);
  storageFailure(false);
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await navigate('Backup and restore');
  const before = await page.evaluate(() => window.swcc.getState());
  await chooseArchive(null);
  await page.getByRole('button', { name: 'Preview full backup', exact: true }).click();
  await expectDismissedFeedback('Backup inspection cancelled');
  expect(await page.evaluate(() => window.swcc.getState())).toEqual(before);
});

test('inspection errors remain actionable without a restoration-shaped success or altered backup status', async () => {
  const invalid = resolve(output, 'portfolio.swcc-backup.zip');
  writeFileSync(invalid, 'Not a ZIP at all');
  await navigate('Backup and restore');
  const before = await page.evaluate(() => window.swcc.getState());
  await chooseArchive(invalid);
  await page.getByRole('button', { name: 'Preview full backup', exact: true }).click();
  const inspectionFailure = await expectActionFeedback(page, 'Backup inspection failed');
  await expect(inspectionFailure.getByRole('alert')).toContainText('Backup inspection failed');
  await dismissActionFeedback(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Backup status' })).toContainText('No successful full backup');
  await expect(page.locator('.action-feedback-dialog')).toBeHidden();
  expect(await page.evaluate(() => window.swcc.getState())).toEqual(before);
  await expect(page.getByRole('button', { name: 'Preview full backup', exact: true })).toBeEnabled();
});

test('real inspection progress protects edits and close while choosing an archive; OS cancellation keeps records', async () => {
  await navigate('Backup and restore');
  const before = await page.evaluate(() => window.swcc.getState());
  await desktop.evaluate(({ dialog }) => {
    dialog.showOpenDialog = () => new Promise(resolveDialog => {
      (globalThis as typeof globalThis & { cancelInspectionDialog: () => void }).cancelInspectionDialog =
        () => resolveDialog({ canceled: true, filePaths: [] });
    });
  });
  await page.getByRole('button', { name: 'Preview full backup', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Inspection progress' })).toContainText('Choose a full backup');
  await expect(page.getByRole('navigation').getByRole('button', { name: 'All years', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.swcc.createYear(2025))).toMatchObject({ ok: false, error: { code: 'BUSY' } });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expectActionFeedback(page, 'inspection is still running');
  await dismissActionFeedback(page);
  expect(desktop.windows().length).toBe(1);
  await desktop.evaluate(() => {
    (globalThis as typeof globalThis & { cancelInspectionDialog: () => void }).cancelInspectionDialog();
  });
  await expectDismissedFeedback('Backup inspection cancelled');
  await expect(page.getByRole('status', { name: 'Inspection progress' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.swcc.getState())).toEqual(before);
  expect(desktop.windows().length).toBe(1);
});
