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
