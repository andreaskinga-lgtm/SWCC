import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dismissActionFeedback, expectActionFeedback } from './feedback-helpers.js';

let desktop: ElectronApplication;
let page: Page;
let root: string;
test.beforeEach(async () => {
  root = resolve('.work', `desktop-forms-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  desktop = await electron.launch({ executablePath: process.env.SWCC_PACKAGED_EXECUTABLE,
    args: [...(process.env.SWCC_PACKAGED_EXECUTABLE ? [] : ['.']), `--user-data-dir=${resolve(root, 'storage')}`],
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
  await expectActionFeedback(page, 'CCP-2024-forms.pdf');
  await dismissActionFeedback(page);
  await expect(warning).toBeHidden();
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
  await expectActionFeedback(page, 'No output was published');
  await dismissActionFeedback(page);
  expect(existsSync(path)).toBe(false);
  await destination(resolve(root, 'absent', 'failed.pdf'));
  await warning.getByRole('button', { name: 'Export draft PDF', exact: true }).click();
  const failure = await expectActionFeedback(page, 'could not be completely written');
  await expect(failure.getByRole('alert')).toContainText('could not be completely written');
  await dismissActionFeedback(page);
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
  await expectActionFeedback(page, 'complete.pdf');
  await dismissActionFeedback(page);
  expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
});

test('failed draft flush retains edits and prevents stale export; retry exports the latest saved text', async () => {
  const path = resolve(root, 'latest.pdf');
  await destination(path);
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  function failSaving(enabled: boolean) {
    const executable = createRequire(import.meta.url)('electron') as string;
    const result = spawnSync(executable, ['tests/desktop/storage-fixture.mjs', resolve(root, 'storage/dataset/database.sqlite'), String(enabled)], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  failSaving(true);
  await page.getByLabel('Strengths', { exact: true }).fill('Dernier brouillon — café.');
  await page.getByRole('navigation').getByRole('button', { name: 'Year overview', exact: true }).click();
  await expectActionFeedback(page, 'disk full');
  await dismissActionFeedback(page);
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
  await expectActionFeedback(page, 'latest.pdf');
  await dismissActionFeedback(page);
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true }).promise;
  try {
    const content = (await (await pdf.getPage(2)).getTextContent()).items.flatMap(item => 'str' in item ? [item.str] : []).join(' ');
    expect(content.replace(/\s+/gu, ' ')).toContain('Dernier brouillon — café.');
  } finally { await pdf.destroy(); }
});

test('long edited narratives export through the same desktop action with readable continuations and recoverable glyph errors', async () => {
  test.setTimeout(60_000);
  const path = resolve(root, 'continuations.pdf');
  await destination(path);
  const strengths = Array.from({ length: 45 }, (_, i) => `Force${i}: café — écoute attentive.`).join('\n\n');
  const reflection = `${'Appliquer une réflexion différente. '.repeat(90)}FIN-REFLEXION`;
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await page.getByLabel('Strengths', { exact: true }).fill(`${strengths}\n🧠`);
  await page.getByRole('navigation').getByRole('button', { name: 'Year overview', exact: true }).click();
  await page.getByRole('button', { name: 'Record an activity', exact: true }).click();
  const activity = page.getByRole('dialog', { name: 'Record an activity' });
  await activity.getByLabel('Activity title').fill('Atelier partagé — unique');
  await activity.getByRole('button', { name: 'Save activity', exact: true }).click();
  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  for (const title of ['Premier but', 'Deuxième but']) {
    await editor.getByRole('button', { name: 'Create and link a goal', exact: true }).click();
    const goal = page.getByRole('dialog', { name: 'Create a shared learning goal' });
    await goal.getByLabel('Goal title').fill(title);
    await goal.getByRole('button', { name: 'Create goal', exact: true }).click();
    await expect(goal).toHaveCount(0);
  }
  await editor.getByLabel('Evidence notes').fill('Une seule preuve conservée.');
  await editor.getByLabel('Application to practice').fill(reflection);
  await page.getByRole('navigation').getByRole('button', { name: 'Year overview', exact: true }).click();
  await page.getByRole('button', { name: 'Export Forms PDF', exact: true }).click();
  const warning = page.getByRole('dialog', { name: 'Export annual forms' });
  await expect(warning).toContainText('readable continuation pages');
  await warning.getByRole('button', { name: 'Export draft PDF', exact: true }).click();
  const failure = await expectActionFeedback(page, 'not supported');
  await expect(failure.getByRole('alert')).toContainText('not supported');
  await dismissActionFeedback(page);
  expect(existsSync(path)).toBe(false);
  await warning.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await expect(page.getByLabel('Strengths', { exact: true })).toHaveValue(`${strengths}\n🧠`);
  await page.getByLabel('Strengths', { exact: true }).fill(strengths);
  // Deliberately consume the edit immediately, without waiting for debounce.
  await page.getByRole('navigation').getByRole('button', { name: 'Year overview', exact: true }).click();
  await page.getByRole('button', { name: 'Export Forms PDF', exact: true }).click();
  await warning.getByRole('button', { name: 'Export draft PDF', exact: true }).click();
  await expectActionFeedback(page, 'continuations.pdf');
  await dismissActionFeedback(page);
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true }).promise;
  try {
    expect(pdf.numPages).toBeGreaterThan(5);
    let actualStrengths = '';
    let actualReflection = '';
    let pdp = '';
    for (let n = 2; n <= pdf.numPages; n++) {
      const content = (await (await pdf.getPage(n)).getTextContent()).items.flatMap(item => 'str' in item ? [item] : []);
      const sat = content.some(item => item.str.includes('Self-Assessment'));
      const rect = sat ? [79.8549, 126.325, 192.437, 405.163] : [569.457, 123.052, 715.421, 421.526];
      const lines = content.filter(item => item.transform[4] >= rect[0] && item.transform[4] < rect[2]
        && item.transform[5] > rect[1] && item.transform[5] < rect[3]);
      const narrative = lines.map(item => item.str).join('');
      if (sat) actualStrengths += narrative;
      else {
        actualReflection += narrative;
        pdp += content.map(item => item.str).join(' ');
      }
      for (const line of lines) expect(Math.hypot(line.transform[0], line.transform[1])).toBeGreaterThanOrEqual(10);
      expect(await (await pdf.getPage(n)).getAnnotations()).toEqual([]);
    }
    const compact = (text: string) => text.replace(/\s/gu, '');
    expect(compact(actualStrengths)).toBe(compact(strengths));
    expect(compact(actualReflection)).toBe(compact(reflection));
    expect(pdp.split('Atelier partagé —')).toHaveLength(2);
    expect(pdp.split('Une seule preuve')).toHaveLength(2);
    expect(pdp).not.toMatch(/\b[AG]1\b|\bG2\b|Linked goals|No linked goal|\(continued\)|Planned/u);
    expect(pdp.split('Premier but')).toHaveLength(2);
    expect(pdp.split('Deuxième but')).toHaveLength(2);
    expect(await pdf.getFieldObjects()).toBeNull();
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
