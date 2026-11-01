import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const electronExecutable = createRequire(import.meta.url)('electron') as string;
let desktop: ElectronApplication;
let page: Page;
let root: string;
let deleteWritesFailing = false;

async function launch() {
  desktop = await electron.launch({
    args: ['.', `--user-data-dir=${root}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  page = await desktop.firstWindow();
  await page.context().setOffline(true);
}

async function navigate(name: string) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}

async function chooseFile(path: string) {
  await desktop.evaluate(({ dialog }, sourcePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourcePath] });
  }, path);
}

function failActivityDeletes(enabled: boolean) {
  const fixture = spawnSync(electronExecutable, [
    'tests/desktop/storage-fixture.mjs', resolve(root, 'dataset/database.sqlite'),
    enabled ? 'activity-delete-fail' : 'activity-delete-repair',
  ], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
  if (fixture.status !== 0) throw new Error(fixture.stderr);
  deleteWritesFailing = enabled;
}

async function addGoal(title: string) {
  await page.getByRole('button', { name: 'Add goal', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a learning goal' });
  await dialog.getByLabel('Goal title').fill(title);
  await dialog.getByRole('button', { name: 'Create goal', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function addActivity(title: string, linkedGoals: string[] = []) {
  await page.getByRole('button', { name: 'Add activity', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Record an activity' });
  await dialog.getByLabel('Activity title').fill(title);
  for (const goal of linkedGoals) await dialog.getByRole('checkbox', { name: new RegExp(goal) }).check();
  await dialog.getByRole('button', { name: 'Save activity', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function importEvidence(activityRef: string, path: string, evidenceRef: string) {
  await chooseFile(path);
  const editor = page.getByRole('article', { name: `Activity editor ${activityRef}` });
  await editor.getByRole('button', { name: 'Import evidence file', exact: true }).click();
  await expect(page.getByRole('article', { name: `Evidence ${evidenceRef}` })).toContainText('Readable');
}

test.beforeEach(async () => {
  root = resolve('.work', `desktop-deletions-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  await launch();
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
  await navigate('Development plan');
});

test.afterEach(async () => {
  if (deleteWritesFailing) failActivityDeletes(false);
  await desktop?.close();
  rmSync(root, { recursive: true, force: true });
});

test('cancelling goal, activity, and year confirmations leaves each record intact', async () => {
  await addGoal('Reflective supervision');
  await addActivity('Shared consultation', ['G1']);

  await page.getByRole('button', { name: 'Delete goal G1', exact: true }).click();
  const goalConfirmation = page.getByRole('dialog', { name: 'Delete G1?' });
  await goalConfirmation.getByRole('button', { name: 'Keep goal' }).click();
  await expect(goalConfirmation).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'G1 Reflective supervision' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete activity A1', exact: true }).click();
  const activityConfirmation = page.getByRole('dialog', { name: 'Delete activity A1?' });
  await activityConfirmation.getByRole('button', { name: 'Keep activity' }).click();
  await expect(activityConfirmation).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Activity editor A1' })).toBeVisible();

  await navigate('All years');
  await page.getByRole('button', { name: 'Delete year 2024', exact: true }).click();
  const yearConfirmation = page.getByRole('dialog', { name: 'Delete year 2024?' });
  await expect(yearConfirmation).toContainText('at least 10 years');
  await yearConfirmation.getByRole('button', { name: 'Keep year' }).click();
  await expect(yearConfirmation).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open 2024', exact: true })).toBeVisible();
});

test('goal deletion flushes activity edits, preserves evidence, and leaves the activity supplementary', async () => {
  const evidenceFile = resolve(root, 'shared.pdf');
  writeFileSync(evidenceFile, readFileSync(resolve('Step One SWCC.pdf')));
  await addGoal('Goal one');
  await addGoal('Goal two');
  await addActivity('One shared activity', ['G1', 'G2']);
  await importEvidence('A1', evidenceFile, 'E1');

  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  await editor.getByLabel('Evidence notes').fill('Pending notes survive removing a goal');
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saving');
  await page.getByRole('button', { name: 'Delete goal G1', exact: true }).click();
  const firstConfirmation = page.getByRole('dialog', { name: 'Delete G1?' });
  await firstConfirmation.getByRole('button', { name: 'Delete goal', exact: true }).click();
  await expect(firstConfirmation).toHaveCount(0);
  await expect(editor.getByLabel('Evidence notes')).toHaveValue('Pending notes survive removing a goal');
  await expect(page.getByRole('button', { name: 'Edit A1 from G2', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Evidence E1' })).toContainText('Readable');

  await page.getByRole('button', { name: 'Delete goal G2', exact: true }).click();
  const secondConfirmation = page.getByRole('dialog', { name: 'Delete G2?' });
  await secondConfirmation.getByRole('button', { name: 'Delete goal', exact: true }).click();
  await expect(secondConfirmation).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Activity editor A1' })).toBeVisible();
  await expect(editor).toContainText('No linked goal · supplementary learning.');
  await expect(page.getByRole('article', { name: 'Evidence E1' })).toContainText('Readable');
  await editor.getByRole('button', { name: 'Preview E1', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Preview E1 · shared.pdf' }).getByRole('img', { name: 'Evidence PDF page 1' })).toBeVisible();
});

test('activity and year cleanup preserve other years and navigate without creating a replacement', async () => {
  const firstFile = resolve(root, 'first.pdf');
  const secondFile = resolve(root, 'second.pdf');
  const nextYearFile = resolve(root, 'next-year.pdf');
  writeFileSync(firstFile, Buffer.from('%PDF-1.4\nfirst activity'));
  writeFileSync(secondFile, Buffer.from('%PDF-1.4\nsecond activity'));
  writeFileSync(nextYearFile, Buffer.from('%PDF-1.4\nnext year'));
  await addGoal('Keep the goal');
  await addActivity('Remove this activity', ['G1']);
  await importEvidence('A1', firstFile, 'E1');
  await addActivity('Keep this activity', ['G1']);
  await importEvidence('A2', secondFile, 'E2');

  await page.getByRole('button', { name: 'Select activity A1', exact: true }).click();
  await page.getByRole('button', { name: 'Delete activity A1', exact: true }).click();
  const activityConfirmation = page.getByRole('dialog', { name: 'Delete activity A1?' });
  await expect(activityConfirmation).toContainText('permanently deletes A1, its evidence files');
  await activityConfirmation.getByRole('button', { name: 'Delete A1', exact: true }).click();
  await expect(activityConfirmation).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Activity editor A2' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Evidence E1' })).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Evidence E2' })).toContainText('Readable');
  await expect(page.getByRole('article', { name: 'G1 Keep the goal' })).toBeVisible();

  await navigate('All years');
  await page.getByLabel('New package year').fill('2025');
  await page.getByRole('button', { name: 'Create year package', exact: true }).click();
  await navigate('Development plan');
  await addActivity('Other-year activity');
  await importEvidence('A1', nextYearFile, 'E1');

  await navigate('All years');
  await page.getByRole('button', { name: 'Delete year 2024', exact: true }).click();
  const olderYearConfirmation = page.getByRole('dialog', { name: 'Delete year 2024?' });
  await olderYearConfirmation.getByRole('button', { name: 'Delete 2024 year package', exact: true }).click();
  await expect(olderYearConfirmation).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Year overview', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Year package', exact: true }).locator('option:checked')).toHaveText('2025');
  await navigate('Development plan');
  await expect(page.getByRole('article', { name: 'Evidence E1' })).toContainText('Readable');

  await navigate('All years');
  await page.getByRole('button', { name: 'Delete year 2025', exact: true }).click();
  const finalYearConfirmation = page.getByRole('dialog', { name: 'Delete year 2025?' });
  await finalYearConfirmation.getByRole('button', { name: 'Delete 2025 year package', exact: true }).click();
  await expect(finalYearConfirmation).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your year packages' })).toBeVisible();
  await expect(page.getByText('Start with this year, or create a past year to backfill your records.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Open \d{4}/ })).toHaveCount(0);
});

test('a database failure is reported while the activity and managed evidence remain usable', async () => {
  const evidenceFile = resolve(root, 'keep.pdf');
  writeFileSync(evidenceFile, Buffer.from('%PDF-1.4\nkeep this evidence'));
  await addActivity('Keep after failure');
  await importEvidence('A1', evidenceFile, 'E1');
  failActivityDeletes(true);

  await page.getByRole('button', { name: 'Delete activity A1', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete activity A1?' });
  await confirmation.getByRole('button', { name: 'Delete A1', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toContainText('delete blocked');
  await expect(page.getByRole('article', { name: 'Activity editor A1' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Evidence E1' })).toContainText('Readable');
});
