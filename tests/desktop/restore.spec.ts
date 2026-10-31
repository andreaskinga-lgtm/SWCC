import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

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
function storageFailure(failing: boolean) {
  const executable = createRequire(import.meta.url)('electron') as string;
  const result = spawnSync(executable, ['tests/desktop/storage-fixture.mjs', resolve(root, 'dataset/database.sqlite'), String(failing)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
}

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
  await expect(page.locator('.operation-feedback')).toContainText('Full backup saved');
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
  await expect(dialog.getByRole('button', { name: 'Replace all years', exact: true })).toBeDisabled();
  await expect(dialog).toContainText('No records have been restored');
  expect(await page.evaluate(() => window.swcc.getState())).toEqual(before);
  await page.setViewportSize({ width: 620, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel, keep current data' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.operation-feedback')).toContainText('Inspection cancelled');
  expect(readdirSync(resolve(root, 'restore-staging'))).toEqual([]);
  expect(await page.evaluate(() => window.swcc.getState())).toEqual(before);
  await navigate('All years');
  await page.getByRole('button', { name: 'Open 2024' }).click();
  await navigate('Self-assessment');
  await expect(page.getByLabel('Strengths')).toHaveValue('Saved before inspection');
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
  await expect(page.locator('.operation-feedback')).toContainText('Inspection cancelled');
  expect(await page.evaluate(() => window.swcc.getState())).toEqual(before);
});

test('inspection errors remain actionable without a restoration-shaped success or altered backup status', async () => {
  const invalid = resolve(output, 'portfolio.swcc-backup.zip');
  writeFileSync(invalid, 'Not a ZIP at all');
  await navigate('Backup and restore');
  const before = await page.evaluate(() => window.swcc.getState());
  await chooseArchive(invalid);
  await page.getByRole('button', { name: 'Preview full backup', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Backup inspection failed');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Backup status' })).toContainText('No successful full backup');
  await expect(page.locator('.operation-feedback')).toHaveCount(0);
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
  await expect(page.getByRole('alert')).toContainText('inspection is still running');
  expect(desktop.windows().length).toBe(1);
  await desktop.evaluate(() => {
    (globalThis as typeof globalThis & { cancelInspectionDialog: () => void }).cancelInspectionDialog();
  });
  await expect(page.locator('.operation-feedback')).toContainText('Inspection cancelled');
  await expect(page.getByRole('status', { name: 'Inspection progress' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.swcc.getState())).toEqual(before);
  expect(desktop.windows().length).toBe(1);
});
