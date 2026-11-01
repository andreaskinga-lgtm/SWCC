import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { copyFileSync, mkdirSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

let desktop: ElectronApplication;
let page: Page;
let root: string;

async function launch() {
  desktop = await electron.launch({
    args: ['.', `--user-data-dir=${root}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  page = await desktop.firstWindow();
  await page.context().setOffline(true);
}

async function chooseFile(path: string) {
  await desktop.evaluate(({ dialog }, sourcePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourcePath] });
  }, path);
}

async function createActivity(title: string) {
  await page.getByRole('navigation').getByRole('button', { name: 'Development plan', exact: true }).click();
  await page.getByRole('button', { name: 'Add activity', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Record an activity' });
  await dialog.getByLabel('Activity title').fill(title);
  await dialog.getByRole('button', { name: 'Save activity', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test.beforeEach(async () => {
  root = resolve('.work', `desktop-evidence-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  await launch();
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
  await createActivity('Keep a copy of my certificate');
});

test.afterEach(async () => {
  await desktop?.close();
  rmSync(root, { recursive: true, force: true });
});

test('a PDF import is managed independently from its source and previews offline in SWCC', async () => {
  const source = resolve(root, 'certificate.pdf');
  const moved = resolve(root, 'moved-certificate.pdf');
  copyFileSync(resolve('Step One SWCC.pdf'), source);
  await chooseFile(source);

  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  await editor.getByRole('button', { name: 'Import evidence file', exact: true }).click();
  const evidence = page.getByRole('article', { name: 'Evidence E1' });
  await expect(evidence).toContainText('certificate.pdf');
  await expect(evidence).toContainText('Readable');

  renameSync(source, moved);
  await evidence.getByRole('button', { name: 'Preview E1', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview E1 · certificate.pdf' });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('img', { name: 'Evidence PDF page 1' })).toBeVisible();
  await preview.getByRole('button', { name: 'Close dialog' }).click();
  await expect(preview).toHaveCount(0);
});

for (const action of ['import', 'replacement']) test(`${action} adopts its saved revision beneath retained typing and protects in-flight navigation`, async () => {
  const source = resolve(root, 'original.txt');
  const replacement = resolve(root, 'new.txt');
  writeFileSync(source, 'original evidence');
  writeFileSync(replacement, 'new evidence');
  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  if (action === 'replacement') {
    await chooseFile(source);
    await editor.getByRole('button', { name: 'Import evidence file', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Evidence E1' })).toContainText('original.txt');
  }
  await desktop.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => new Promise(resolveDialog => {
      (globalThis as typeof globalThis & { releaseEvidence: () => void }).releaseEvidence =
        () => resolveDialog({ canceled: false, filePaths: [path] });
    });
  }, replacement);
  await editor.getByRole('button', { name: action === 'replacement' ? 'Replace E1' : 'Import evidence file', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Import evidence file', exact: true })).toBeDisabled();
  await editor.getByLabel('Evidence notes').fill('Typed while evidence is being selected');
  await page.getByLabel('Plan date').fill('2024-05-06');
  await page.waitForTimeout(600);
  await page.getByRole('navigation').getByRole('button', { name: 'All years', exact: true }).click();
  await expect(editor.getByLabel('Evidence notes')).toHaveValue('Typed while evidence is being selected');
  await expect(page.getByRole('heading', { name: 'Your year packages' })).toHaveCount(0);
  await desktop.evaluate(() => {
    (globalThis as typeof globalThis & { releaseEvidence: () => void }).releaseEvidence();
  });
  await expect(page.getByRole('heading', { name: 'Your year packages' })).toBeVisible();
  await page.getByRole('button', { name: 'Open 2024', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Development plan', exact: true }).click();
  await expect(editor.getByLabel('Evidence notes')).toHaveValue('Typed while evidence is being selected');
  await expect(page.getByLabel('Plan date')).toHaveValue('2024-05-06');
  await expect(page.getByRole('article', { name: 'Evidence E1' })).toContainText('new.txt');
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  await desktop.close();
  await launch();
  await page.getByRole('navigation').getByRole('button', { name: 'Development plan', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Activity editor A1' }).getByLabel('Evidence notes')).toHaveValue('Typed while evidence is being selected');
});

test('a committed import retains invalid edits visibly and correction saves against its new revision', async () => {
  const source = resolve(root, 'notes.txt');
  writeFileSync(source, 'original evidence');
  await desktop.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => new Promise(resolveDialog => {
      (globalThis as typeof globalThis & { releaseEvidence: () => void }).releaseEvidence =
        () => resolveDialog({ canceled: false, filePaths: [path] });
    });
  }, source);
  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  await editor.getByRole('button', { name: 'Import evidence file', exact: true }).click();
  await editor.getByLabel('Activity title', { exact: true }).fill('');
  await editor.getByLabel('Evidence notes').fill('Retain these notes beside the invalid title');
  await page.waitForTimeout(600);
  await desktop.evaluate(() => {
    (globalThis as typeof globalThis & { releaseEvidence: () => void }).releaseEvidence();
  });
  await expect(page.getByRole('article', { name: 'Evidence E1' })).toContainText('Readable');
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await expect(editor.getByLabel('Activity title', { exact: true })).toHaveValue('');
  await expect(editor.getByLabel('Evidence notes')).toHaveValue('Retain these notes beside the invalid title');
  await editor.getByLabel('Activity title', { exact: true }).fill('Corrected activity title');
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  const saved = await page.evaluate(() => window.swcc.getState());
  expect(saved).toMatchObject({ ok: true, value: { selectedPackage: {
    activities: [{ title: 'Corrected activity title', evidenceDescription: 'Retain these notes beside the invalid title' }],
  } } });
});

test('committed replacement cleanup failure refreshes the renderer revision and old-byte cleanup retries on restart', async () => {
  const source = resolve(root, 'certificate.txt');
  writeFileSync(source, 'old evidence');
  await chooseFile(source);
  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  await editor.getByRole('button', { name: 'Import evidence file', exact: true }).click();
  const evidence = page.getByRole('article', { name: 'Evidence E1' });
  await expect(evidence).toContainText('Readable');
  writeFileSync(source, 'new certificate bytes');
  await desktop.evaluate(() => {
    const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs');
    const module = process.getBuiltinModule('node:module') as typeof import('node:module');
    const remove = fs.rmSync;
    fs.rmSync = (path, options) => {
      if (String(path).includes('.deletion-')) throw new Error('old evidence folder is locked');
      remove(path, options);
    };
    module.syncBuiltinESMExports();
    (globalThis as typeof globalThis & { repairEvidenceCleanup: () => void }).repairEvidenceCleanup =
      () => { fs.rmSync = remove; module.syncBuiltinESMExports(); };
  });
  try {
    await evidence.getByRole('button', { name: 'Replace E1', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('new file remains usable');
    await expect(evidence).toContainText('21 bytes');
    await expect(evidence).toContainText('Readable');
    await editor.getByLabel('Evidence notes').fill('Saved after a committed cleanup failure');
    await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
    expect(readdirSync(resolve(root, 'dataset/evidence')).some(name => name.startsWith('.deletion-'))).toBe(true);
  } finally {
    await desktop.evaluate(() => {
      (globalThis as typeof globalThis & { repairEvidenceCleanup: () => void }).repairEvidenceCleanup();
    });
  }
  await desktop.close();
  await launch();
  await page.getByRole('navigation').getByRole('button', { name: 'Development plan', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Activity editor A1' }).getByLabel('Evidence notes')).toHaveValue('Saved after a committed cleanup failure');
  expect(readdirSync(resolve(root, 'dataset/evidence')).filter(name => name.startsWith('.deletion-'))).toEqual([]);
});

test('an image preview uses imported bytes and other-document open errors remain visible', async () => {
  const image = resolve(root, 'letter.png');
  const document = resolve(root, 'report.docx');
  writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/YQAAAABJRU5ErkJggg==', 'base64'));
  writeFileSync(document, 'word document');
  await chooseFile(image);
  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  await editor.getByRole('button', { name: 'Import evidence file', exact: true }).click();
  const imageEvidence = page.getByRole('article', { name: 'Evidence E1' });
  await imageEvidence.getByRole('button', { name: 'Preview E1', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview E1 · letter.png' });
  await expect(preview.getByRole('img', { name: 'Evidence preview E1 · letter.png' })).toBeVisible();
  await preview.getByRole('button', { name: 'Close dialog' }).click();

  await chooseFile(document);
  await editor.getByRole('button', { name: 'Import evidence file', exact: true }).click();
  const documentEvidence = page.getByRole('article', { name: 'Evidence E2' });
  await desktop.evaluate(({ shell }) => {
    shell.openPath = async () => 'No application is associated with this file type.';
  });
  await documentEvidence.getByRole('button', { name: 'Open E2 in installed app', exact: true }).click();
  await expect(documentEvidence.getByRole('alert')).toContainText('No application is associated with this file type.');
});

test('a missing E entry is visible, replaceable under the same reference, and removable', async () => {
  const source = resolve(root, 'original.pdf');
  const replacement = resolve(root, 'replacement.txt');
  writeFileSync(source, 'original evidence');
  writeFileSync(replacement, 'replacement evidence');
  await chooseFile(source);
  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  await editor.getByRole('button', { name: 'Import evidence file', exact: true }).click();
  const evidence = page.getByRole('article', { name: 'Evidence E1' });
  await expect(evidence).toContainText('Readable');

  const managedDirectory = resolve(root, 'dataset', 'evidence', '2024');
  const managedPath = resolve(managedDirectory, readdirSync(managedDirectory)[0]);
  writeFileSync(managedPath, 'tampered evidence');
  await editor.getByRole('button', { name: 'Preview E1', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('SHA-256 integrity check');
  await editor.getByRole('button', { name: 'Check file integrity', exact: true }).click();
  await expect(evidence).toContainText('E1 failed its SHA-256 integrity check; replace it or remove it.');

  unlinkSync(managedPath);
  await editor.getByRole('button', { name: 'Check file integrity', exact: true }).click();
  await expect(evidence).toContainText('E1 is missing; replace it or remove it.');

  await chooseFile(replacement);
  await evidence.getByRole('button', { name: 'Replace E1', exact: true }).click();
  await expect(evidence).toContainText('replacement.txt');
  await expect(evidence).toContainText('Readable');

  await evidence.getByRole('button', { name: 'Remove E1', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Remove evidence E1?' });
  await confirmation.getByRole('button', { name: 'Remove evidence', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(evidence).toHaveCount(0);
});
