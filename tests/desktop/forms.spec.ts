import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

let desktop: ElectronApplication;
let page: Page;
let root: string;
test.beforeEach(async () => {
  root = resolve('.work', `desktop-forms-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  desktop = await electron.launch({ executablePath: process.env.SWCC_PACKAGED_EXECUTABLE,
    args: [...(process.env.SWCC_PACKAGED_EXECUTABLE ? [] : ['.']), `--user-data-dir=${root}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  page = await desktop.firstWindow();
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
});
test.afterEach(async () => {
  await desktop?.close();
  rmSync(root, { recursive: true, force: true });
});
async function destination(path: string | null) {
  await desktop.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: filePath === null, filePath: filePath ?? '' });
  }, path);
}
test('C dashboard export warns for blank drafts, keyboard confirms, and writes real flattened source forms offline', async () => {
  const path = resolve(root, 'CCP-2024-forms.pdf');
  await destination(path);
  const exportButton = page.getByRole('button', { name: 'Export Forms PDF', exact: true });
  await exportButton.focus();
  await page.keyboard.press('Enter');
  const warning = page.getByRole('dialog', { name: 'Export annual forms' });
  await expect(warning).toContainText('Add your strengths.');
  await expect(warning).toContainText('Step 1 is not manually completed.');
  await expect(warning).toContainText('missing fields stay blank');
  expect(existsSync(path)).toBe(false);
  await warning.getByRole('button', { name: 'Export draft PDF', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Forms PDF written' })).toContainText('CCP-2024-forms.pdf');
  await expect(warning).not.toBeVisible();
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true }).promise;
  try {
    expect(pdf.numPages).toBe(3);
    const sat = await pdf.getPage(2);
    const content = (await sat.getTextContent()).items.flatMap(item => 'str' in item ? [item.str] : []).join(' ');
    expect(content).toContain('Self-Assessment');
    expect(await sat.getAnnotations()).toEqual([]);
  } finally { await pdf.destroy(); }
});

test('destination cancellation and storage errors remain distinct from success; busy export prevents navigation and dismissing the warning', async () => {
  const path = resolve(root, 'complete.pdf');
  await destination(null);
  await page.getByRole('button', { name: 'Export Forms PDF', exact: true }).click();
  const warning = page.getByRole('dialog', { name: 'Export annual forms' });
  await warning.getByRole('button', { name: 'Export draft PDF', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'export cancelled' })).toBeVisible();
  expect(existsSync(path)).toBe(false);
  await destination(resolve(root, 'absent', 'failed.pdf'));
  await warning.getByRole('button', { name: 'Export draft PDF', exact: true }).click();
  await expect(warning.getByRole('alert')).toContainText('could not be completely written');
  await expect(page.getByRole('status').filter({ hasText: 'Forms PDF written' })).toHaveCount(0);
  await desktop.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = () => new Promise(resolve => {
      (globalThis as typeof globalThis & { releaseFormsDestination: () => void }).releaseFormsDestination =
        () => resolve({ canceled: false, filePath });
    });
  }, path);
  await warning.getByRole('button', { name: 'Export draft PDF', exact: true }).click();
  await expect(warning.getByRole('status')).toContainText('Exporting Forms PDF');
  await expect(page.getByRole('navigation').getByRole('button', { name: 'All years', exact: true })).toBeDisabled();
  await warning.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(warning).toBeVisible();
  expect(existsSync(path)).toBe(false);
  await desktop.evaluate(() => {
    (globalThis as typeof globalThis & { releaseFormsDestination: () => void }).releaseFormsDestination();
  });
  await expect(page.getByRole('status').filter({ hasText: 'Forms PDF written' })).toBeVisible();
  expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
});

test('failed draft flush retains edits and prevents stale export; retry exports the latest saved text', async () => {
  const path = resolve(root, 'latest.pdf');
  await destination(path);
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  function failSaving(enabled: boolean) {
    const executable = createRequire(import.meta.url)('electron') as string;
    const result = spawnSync(executable, ['tests/desktop/storage-fixture.mjs', resolve(root, 'dataset/database.sqlite'), String(enabled)], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  failSaving(true);
  await page.getByLabel('Strengths', { exact: true }).fill('Dernier brouillon — café.');
  await page.getByRole('navigation').getByRole('button', { name: 'Year overview', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await expect(page.getByLabel('Strengths', { exact: true })).toHaveValue('Dernier brouillon — café.');
  await expect(page.getByRole('button', { name: 'Export Forms PDF', exact: true })).toHaveCount(0);
  expect(existsSync(path)).toBe(false);
  failSaving(false);
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Year overview', exact: true }).click();
  await page.getByRole('button', { name: 'Export Forms PDF', exact: true }).click();
  const warning = page.getByRole('dialog', { name: 'Export annual forms' });
  await expect(warning).not.toContainText('Add your strengths.');
  await warning.getByRole('button', { name: 'Export draft PDF', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Forms PDF written' })).toBeVisible();
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true }).promise;
  try {
    const content = (await (await pdf.getPage(2)).getTextContent()).items.flatMap(item => 'str' in item ? [item.str] : []).join(' ');
    expect(content).toContain('Dernier brouillon — café.');
  } finally { await pdf.destroy(); }
});

test('normal close waits for an in-flight forms export to finish publishing the complete PDF', async () => {
  const path = resolve(root, 'before-close.pdf');
  await desktop.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = () => new Promise(resolve => {
      (globalThis as typeof globalThis & { releaseFormsDestination: () => void }).releaseFormsDestination =
        () => resolve({ canceled: false, filePath });
    });
  }, path);
  await page.getByRole('button', { name: 'Export Forms PDF', exact: true }).click();
  const warning = page.getByRole('dialog', { name: 'Export annual forms' });
  await warning.getByRole('button', { name: 'Export draft PDF', exact: true }).click();
  await desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await expect(warning.getByRole('status')).toContainText('Exporting Forms PDF');
  expect(existsSync(path)).toBe(false);
  const closing = desktop.waitForEvent('close');
  await desktop.evaluate(() => {
    (globalThis as typeof globalThis & { releaseFormsDestination: () => void }).releaseFormsDestination();
  });
  await closing;
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true }).promise;
  try {
    expect(pdf.numPages).toBe(3);
    expect(await (await pdf.getPage(3)).getAnnotations()).toEqual([]);
  } finally { await pdf.destroy(); }
});
