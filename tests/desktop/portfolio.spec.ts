import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import yauzl from 'yauzl';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { dismissActionFeedback, expectActionFeedback } from './feedback-helpers.js';

let desktop: ElectronApplication;
let page: Page;
let root: string;
test.beforeEach(async () => {
  root = resolve('.work', `desktop-portfolio-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  desktop = await electron.launch({ executablePath: process.env.SWCC_PACKAGED_EXECUTABLE,
    args: [...(process.env.SWCC_PACKAGED_EXECUTABLE ? [] : ['.']), `--user-data-dir=${resolve(root, 'storage')}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  page = await desktop.firstWindow();
  await page.context().setOffline(true);
  expect(page.url()).toMatch(/^file:/);
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
});
test.afterEach(async () => {
  await page?.evaluate(() => window.swcc.cancelPortfolioExport()).catch(() => {});
  await desktop?.evaluate(() => {
    const release = (globalThis as typeof globalThis & { releasePortfolioDialog?: () => void }).releasePortfolioDialog;
    release?.();
  }).catch(() => {});
  await desktop?.close();
  rmSync(root, { recursive: true, force: true });
});
async function destination(path: string | null) {
  await desktop.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: filePath === null, filePath: filePath ?? '' });
  }, path);
}
async function contents(path: string): Promise<Map<string, Buffer>> {
  return new Promise((resolveZip, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) { reject(error); return; }
      const entries = new Map<string, Buffer>();
      zip.on('error', reject);
      zip.on('entry', entry => {
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) { reject(error); return; }
          const chunks: Buffer[] = [];
          stream.on('error', reject);
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => { entries.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
        });
      });
      zip.on('end', () => resolveZip(entries));
      zip.readEntry();
    });
  });
}

test('portfolio failed progress Result is visible and retry keeps the same in-flight export', async () => {
  await desktop.evaluate(({ dialog, ipcMain }) => {
    dialog.showSaveDialog = () => new Promise(resolveDialog => {
      (globalThis as typeof globalThis & { releasePortfolioDialog: () => void }).releasePortfolioDialog =
        () => resolveDialog({ canceled: true, filePath: '' });
    });
    ipcMain.removeHandler('swcc:get-portfolio-progress');
    ipcMain.handle('swcc:get-portfolio-progress', () => ({
      ok: false, error: { code: 'IPC', message: 'portfolio progress connection interrupted' },
    }));
  });
  await page.getByRole('button', { name: 'Export Complete Portfolio ZIP', exact: true }).click();
  const warning = page.getByRole('dialog', { name: 'Export complete annual portfolio' });
  await warning.getByRole('button', { name: 'Export draft ZIP', exact: true }).click();
  const progressFeedback = await expectActionFeedback(page, 'portfolio progress connection interrupted');
  await expect(progressFeedback.getByRole('alert')).toContainText('portfolio progress connection interrupted');
  await desktop.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('swcc:get-portfolio-progress');
    ipcMain.handle('swcc:get-portfolio-progress', () => ({
      ok: true, value: { phase: 'choosing', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0 },
    }));
  });
  await progressFeedback.getByRole('button', { name: 'Retry portfolio progress', exact: true }).click();
  await expect(progressFeedback).toBeHidden();
  await expect(page.getByRole('button', { name: 'Retry portfolio progress', exact: true })).toHaveCount(0);
  await expect(warning).toBeVisible();
  await desktop.evaluate(() => {
    (globalThis as typeof globalThis & { releasePortfolioDialog: () => void }).releasePortfolioDialog();
  });
  await expectActionFeedback(page, 'Portfolio export cancelled');
  await dismissActionFeedback(page);
});

test('C dashboard keyboard portfolio export consumes latest edits and writes real long forms and original evidence offline', async () => {
  test.setTimeout(60_000);
  const path = resolve(root, 'CCP-2024-portfolio.zip');
  const source = resolve(root, 'CON.txt');
  const original = Buffer.from('Original learning evidence — café.');
  writeFileSync(source, original);
  await destination(path);
  await page.getByRole('navigation').getByRole('button', { name: 'Development plan', exact: true }).click();
  await page.getByRole('button', { name: 'Add activity', exact: true }).click();
  const activity = page.getByRole('dialog', { name: 'Record an activity' });
  await activity.getByLabel('Activity title').fill('Shared learning');
  await activity.getByRole('button', { name: 'Save activity', exact: true }).click();
  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  for (const title of ['First goal', 'Second goal']) {
    await editor.getByRole('button', { name: 'Create and link a goal', exact: true }).click();
    const goal = page.getByRole('dialog', { name: 'Create a learning goal' });
    await goal.getByLabel('Goal title').fill(title);
    await goal.getByRole('button', { name: 'Create goal', exact: true }).click();
    await expect(goal).toHaveCount(0);
  }
  await desktop.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, source);
  await editor.getByRole('button', { name: 'Import evidence file', exact: true }).click();
  await expect(editor).toContainText('CON.txt');
  const reflection = `${'Appliquer la réflexion. '.repeat(130)}REFLECTION-END`;
  await editor.getByLabel('Application to practice').fill(reflection);
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  const strengths = `${'Écoute attentive. '.repeat(160)}STRENGTHS-END`;
  await page.getByLabel('Strengths', { exact: true }).fill(strengths);
  await page.getByRole('navigation').getByRole('button', { name: 'Year overview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export Forms PDF', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Export Complete Portfolio ZIP', exact: true }).focus();
  await page.keyboard.press('Enter');
  const warning = page.getByRole('dialog', { name: 'Export complete annual portfolio' });
  await expect(warning).toContainText('Step 1 is not manually completed.');
  await expect(warning).toContainText('not a restorable full-app backup');
  await expect(warning).not.toContainText('Add your strengths.');
  expect(existsSync(path)).toBe(false);
  await warning.getByRole('button', { name: 'Export draft ZIP', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expectActionFeedback(page, 'CCP-2024-portfolio.zip');
  await dismissActionFeedback(page);
  await expect(warning).toBeHidden();
  const zip = await contents(path);
  expect(zip.get('evidence/E1/_CON.txt')).toEqual(original);
  expect(zip.get('evidence-index.txt')?.toString()).toContain('A1 | E1');
  const manifest = JSON.parse(zip.get('manifest.json')!.toString());
  expect(manifest.kind).toBe('portfolio');
  expect(manifest.attachments).toMatchObject([{ ref: 'E1', originalName: 'CON.txt',
    sha256: createHash('sha256').update(original).digest('hex') }]);
  const pdf = await getDocument({ data: new Uint8Array(zip.get('CCP-2024-forms.pdf')!), useSystemFonts: true }).promise;
  try {
    expect(pdf.numPages).toBeGreaterThan(5);
    let text = '';
    for (let n = 1; n <= pdf.numPages; n++) {
      text += (await (await pdf.getPage(n)).getTextContent()).items.flatMap(item => 'str' in item ? [item.str] : []).join(' ');
    }
    expect(text.match(/Shared learning/g)).toHaveLength(1);
    expect(text).not.toMatch(/\b[AGE][12]\b|Linked goals|No linked goal|\(continued\)|Planned/u);
    expect(text.match(/CON\.txt/g)).toHaveLength(1);
    expect(text.match(/First goal/g)).toHaveLength(2);
    expect(text.match(/Second goal/g)).toHaveLength(2);
    expect(text.match(/STRENGTHS-END/g)).toHaveLength(1);
    expect(text.match(/REFLECTION-END/g)).toHaveLength(1);
  } finally { await pdf.destroy(); }
  await page.getByRole('navigation').getByRole('button', { name: 'Backup and restore', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Backup status' })).toContainText('No successful full backup recorded.');
});

test('portfolio progress protects mutations and close, remains keyboard-accessible when narrow, and cancels without publishing', async () => {
  const path = resolve(root, 'CCP-2024-portfolio.zip');
  await desktop.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = () => new Promise(resolveDialog => {
      (globalThis as typeof globalThis & { releasePortfolioDialog: () => void }).releasePortfolioDialog =
        () => resolveDialog({ canceled: false, filePath });
    });
  }, path);
  await page.getByRole('button', { name: 'Export Complete Portfolio ZIP', exact: true }).click();
  const warning = page.getByRole('dialog', { name: 'Export complete annual portfolio' });
  await warning.getByRole('button', { name: 'Export draft ZIP', exact: true }).click();
  await expect(warning.getByRole('status', { name: 'Portfolio export progress' })).toContainText('Choose where');
  await expect(page.getByRole('navigation').getByRole('button', { name: 'All years', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.swcc.createYear(2023))).toMatchObject({ ok: false, error: { code: 'BUSY' } });
  await warning.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(warning).toBeVisible();
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expectActionFeedback(page, 'portfolio export is still running');
  await dismissActionFeedback(page);
  expect(desktop.windows()).toHaveLength(1);
  await page.setViewportSize({ width: 620, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await warning.getByRole('button', { name: 'Cancel portfolio export', exact: true }).focus();
  await page.keyboard.press('Enter');
  await desktop.evaluate(() => {
    (globalThis as typeof globalThis & { releasePortfolioDialog: () => void }).releasePortfolioDialog();
  });
  await expectActionFeedback(page, 'Portfolio export cancelled');
  await dismissActionFeedback(page);
  expect(existsSync(path)).toBe(false);
  expect(desktop.windows()).toHaveLength(1);
  await warning.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('navigation').getByRole('button', { name: 'All years', exact: true })).toBeEnabled();
});

function storageFailure(action: string) {
  const executable = createRequire(import.meta.url)('electron') as string;
  const result = spawnSync(executable, ['tests/desktop/storage-fixture.mjs', resolve(root, 'storage/dataset/database.sqlite'), action], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
}

test('failed draft and real review flushes prevent stale portfolio export and retain edits for a successful retry', async () => {
  const path = resolve(root, 'CCP-2024-portfolio.zip');
  await destination(path);
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  storageFailure('true');
  await page.getByLabel('Strengths', { exact: true }).fill('Retained latest strengths — café.');
  await page.getByRole('navigation').getByRole('button', { name: 'Year overview', exact: true }).click();
  await expectActionFeedback(page, 'disk full');
  await dismissActionFeedback(page);
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await expect(page.getByLabel('Strengths', { exact: true })).toHaveValue('Retained latest strengths — café.');
  await expect(page.getByRole('button', { name: 'Export Complete Portfolio ZIP', exact: true })).toHaveCount(0);
  expect(existsSync(path)).toBe(false);
  storageFailure('false');
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Review', exact: true }).click();
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
  await page.getByRole('navigation').getByRole('button', { name: 'Year overview', exact: true }).click();
  await expect(page.getByLabel('Physical PDF page', { exact: true })).toHaveValue('2');
  await expect(page.getByRole('button', { name: 'Export Complete Portfolio ZIP', exact: true })).toHaveCount(0);
  expect(existsSync(path)).toBe(false);
  storageFailure('review-repair');
  await page.getByRole('button', { name: 'Retry review save', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Year overview', exact: true }).click();
  await page.getByRole('button', { name: 'Export Complete Portfolio ZIP', exact: true }).click();
  const warning = page.getByRole('dialog', { name: 'Export complete annual portfolio' });
  await expect(warning).not.toContainText('Add your strengths.');
  await warning.getByRole('button', { name: 'Export draft ZIP', exact: true }).click();
  await expectActionFeedback(page, 'Complete Portfolio ZIP');
  await dismissActionFeedback(page);
  const zip = await contents(path);
  const pdf = await getDocument({ data: new Uint8Array(zip.get('CCP-2024-forms.pdf')!), useSystemFonts: true }).promise;
  try {
    const sat = (await (await pdf.getPage(2)).getTextContent()).items.flatMap(item => 'str' in item ? [item.str] : []).join(' ');
    expect(sat.replace(/\s+/gu, ' ')).toContain('Retained latest strengths — café.');
    const checklist = (await (await pdf.getPage(1)).getTextContent()).items.flatMap(item => 'str' in item ? [item.str] : []);
    expect(checklist).toContain('X');
  } finally { await pdf.destroy(); }
});

test('real ZIP output errors and cancellation preserve the prior portfolio and permit successful retry', async () => {
  const path = resolve(root, 'CCP-2024-portfolio.zip');
  writeFileSync(path, 'Previous complete file');
  await destination(null);
  await page.getByRole('button', { name: 'Export Complete Portfolio ZIP', exact: true }).click();
  const warning = page.getByRole('dialog', { name: 'Export complete annual portfolio' });
  await warning.getByRole('button', { name: 'Export draft ZIP', exact: true }).click();
  await expectActionFeedback(page, 'Portfolio export cancelled');
  await dismissActionFeedback(page);
  expect(readFileSync(path).toString()).toBe('Previous complete file');
  await destination(path);
  await desktop.evaluate(() => {
    const fs = process.getBuiltinModule('fs') as typeof import('node:fs');
    const original = fs.WriteStream.prototype._write;
    fs.WriteStream.prototype._write = function(chunk, encoding, done) {
      if (String(this.path).includes('.swcc-portfolio-')) done(new Error('ENOSPC: disk full'));
      else original.call(this, chunk, encoding, done);
    };
    (globalThis as typeof globalThis & { restorePortfolioWrites: () => void }).restorePortfolioWrites =
      () => { fs.WriteStream.prototype._write = original; };
  });
  await warning.getByRole('button', { name: 'Export draft ZIP', exact: true }).click();
  const failure = await expectActionFeedback(page, 'disk full');
  await expect(failure.getByRole('alert')).toContainText('disk full');
  await dismissActionFeedback(page);
  expect(readFileSync(path).toString()).toBe('Previous complete file');
  await desktop.evaluate(() => {
    (globalThis as typeof globalThis & { restorePortfolioWrites: () => void }).restorePortfolioWrites();
  });
  await warning.getByRole('button', { name: 'Export draft ZIP', exact: true }).click();
  await expectActionFeedback(page, 'Complete Portfolio ZIP');
  await dismissActionFeedback(page);
  expect((await contents(path)).has('CCP-2024-forms.pdf')).toBe(true);
});
