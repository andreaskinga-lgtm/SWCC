import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dismissActionFeedback, expectActionFeedback } from './feedback-helpers.js';

const electronExecutable = createRequire(import.meta.url)('electron') as string;

let desktop: ElectronApplication;
let page: Page;
let root: string;
async function launch() {
  desktop = await electron.launch({
    executablePath: process.env.SWCC_PACKAGED_EXECUTABLE,
    args: [...(process.env.SWCC_PACKAGED_EXECUTABLE ? [] : ['.']), `--user-data-dir=${root}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', TZ: 'America/Toronto' },
  });
  page = await desktop.firstWindow();
  await page.context().setOffline(true);
  const runtime = await desktop.evaluate(({ app, BrowserWindow }) => ({
    packaged: app.isPackaged,
    url: BrowserWindow.getAllWindows()[0].webContents.getURL(),
    storage: app.getPath('userData'),
  }));
  expect(runtime.packaged).toBe(Boolean(process.env.SWCC_PACKAGED_EXECUTABLE));
  expect(runtime.url).toMatch(/^file:/);
  expect(runtime.storage).toBe(root);
}
test.beforeEach(async () => {
  root = resolve('.work', `desktop-goals-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  await launch();
});
test.afterEach(async () => {
  await desktop?.close();
  rmSync(root, { recursive: true, force: true });
});

function failWrites(enabled: boolean) {
  const fixture = spawnSync(electronExecutable, ['tests/desktop/storage-fixture.mjs', resolve(root, 'dataset/database.sqlite'), String(enabled)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
  });
  if (fixture.status !== 0) throw new Error(fixture.stderr);
}

async function expectAssessmentTabOrder(goalRefs: string[]) {
  const standards = page.getByRole('group', { name: 'Relevant annual standards' });
  await standards.getByRole('checkbox').last().focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Add goal', exact: true })).toBeFocused();
  for (const ref of goalRefs) {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: `Delete goal ${ref}`, exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(`Goal title ${ref}`)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(`Goal description ${ref}`)).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Complete Step 2', exact: true })).toBeFocused();
}

test('assessment readiness and shared goals persist across both views and restart', async () => {
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });

  const status = page.getByRole('status', { name: 'Step 2 readiness' });
  const writing = page.getByRole('region', { name: 'Self-assessment writing' });
  const readiness = page.getByRole('complementary', { name: 'Self-assessment readiness' });
  const goals = page.getByRole('region', { name: 'Learning goals' });
  const standards = page.getByRole('group', { name: 'Relevant annual standards' });
  await expect(status).toHaveText('In progress');
  await expect(standards.getByRole('checkbox')).toHaveCount(12);
  await expect(writing.getByRole('region', { name: 'Learning goals' })).toHaveCount(1);
  const wideWriting = await writing.boundingBox();
  const wideReadiness = await readiness.boundingBox();
  const wideGoals = await goals.boundingBox();
  const wideStandards = await standards.boundingBox();
  expect(wideWriting).not.toBeNull();
  expect(wideReadiness).not.toBeNull();
  expect(wideGoals).not.toBeNull();
  expect(wideStandards).not.toBeNull();
  expect(wideReadiness!.x + wideReadiness!.width).toBeLessThan(wideWriting!.x);
  expect(wideGoals!.x).toBeGreaterThanOrEqual(wideWriting!.x);
  expect(wideGoals!.x + wideGoals!.width).toBeLessThanOrEqual(wideWriting!.x + wideWriting!.width);
  expect(wideGoals!.y).toBeGreaterThan(wideStandards!.y + wideStandards!.height);
  await expectAssessmentTabOrder([]);

  const initialAssessmentDate = await page.getByLabel('Assessment date').inputValue();
  await page.getByLabel('Assessment date').fill('');
  await expect(page.getByText('Enter a valid assessment date.', { exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  await page.getByLabel('Assessment date').fill(initialAssessmentDate);
  await expect(page.getByText('Choose at least one annual standard.', { exact: true })).toBeVisible();
  await expect(page.getByText('Add at least one learning goal.', { exact: true })).toBeVisible();
  await page.getByLabel('Strengths').fill('   ');
  await page.getByLabel('Learning needs and interests').fill('\n\t ');
  await standards.getByRole('checkbox', { name: 'Code of Ethics' }).check();
  await expect(status).toHaveText('In progress');
  await expect(page.getByText('Add your strengths.', { exact: true })).toBeVisible();
  await expect(page.getByText('Describe your learning needs and interests.', { exact: true })).toBeVisible();

  await page.getByLabel('Strengths').fill('I build trust through consistent follow-up.');
  await page.getByLabel('Learning needs and interests').fill('I want to deepen reflective supervision.');
  await page.getByRole('button', { name: 'Add goal', exact: true }).click();
  const assessmentDialog = page.getByRole('dialog', { name: 'Add a learning goal' });
  await assessmentDialog.getByLabel('Goal title').fill('Build reflective supervision practice');
  await assessmentDialog.getByLabel('Description (optional)').fill('Seek structured consultation after complex cases.');
  await assessmentDialog.getByRole('button', { name: 'Add goal', exact: true }).click();
  await expect(status).toHaveText('Ready');
  await expect(page.getByLabel('Goal title G1')).toHaveValue('Build reflective supervision practice');

  await page.getByRole('navigation').getByRole('button', { name: 'Development plan', exact: true }).click();
  const planDate = await page.getByLabel('Plan date').inputValue();
  await expect(page.getByRole('article', { name: /G1 Build reflective supervision practice/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add goal', exact: true }).click();
  const planDialog = page.getByRole('dialog', { name: 'Create a learning goal' });
  await planDialog.getByLabel('Goal title').fill('Explore trauma-informed approaches');
  await planDialog.getByRole('button', { name: 'Create goal', exact: true }).click();
  await expect(page.getByRole('article', { name: /G2 Explore trauma-informed approaches/ })).toBeVisible();

  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await expect(page.getByLabel('Goal title G2')).toHaveValue('Explore trauma-informed approaches');
  await page.setViewportSize({ width: 960, height: 1000 });
  const narrowWriting = await writing.boundingBox();
  const narrowReadiness = await readiness.boundingBox();
  const narrowGoals = await goals.boundingBox();
  const narrowStandards = await standards.boundingBox();
  expect(narrowWriting).not.toBeNull();
  expect(narrowReadiness).not.toBeNull();
  expect(narrowGoals).not.toBeNull();
  expect(narrowStandards).not.toBeNull();
  expect(narrowGoals!.x).toBeGreaterThanOrEqual(narrowWriting!.x);
  expect(narrowGoals!.x + narrowGoals!.width).toBeLessThanOrEqual(narrowWriting!.x + narrowWriting!.width);
  expect(narrowGoals!.y).toBeGreaterThan(narrowStandards!.y + narrowStandards!.height);
  expect(narrowReadiness!.y).toBeGreaterThan(narrowWriting!.y + narrowWriting!.height);
  await expectAssessmentTabOrder(['G1', 'G2']);

  await page.getByLabel('Assessment date').fill('2023-12-30');
  await expect(page.getByText(/This date is outside 2024\./)).toBeVisible();
  await page.setViewportSize({ width: 620, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('navigation').getByRole('button', { name: 'Development plan', exact: true }).click();
  await expect(page.getByLabel('Plan date')).toHaveValue(planDate);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');

  await desktop.close();
  await launch();
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await expect(page.getByLabel('Assessment date')).toHaveValue('2023-12-30');
  await expect(page.getByRole('group', { name: 'Relevant annual standards' }).getByRole('checkbox', { name: 'Code of Ethics' })).toBeChecked();
  await expect(page.getByLabel('Goal title G1')).toHaveValue('Build reflective supervision practice');
  await expect(page.getByLabel('Goal title G2')).toHaveValue('Explore trauma-informed approaches');
});

test('a failed shared-goal edit stays visible and blocks navigation and close until retry', async () => {
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await page.getByRole('button', { name: 'Add goal', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a learning goal' });
  await dialog.getByLabel('Goal title').fill('Original goal title');
  await dialog.getByRole('button', { name: 'Add goal', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');

  failWrites(true);
  await page.getByLabel('Goal title G1').fill('Unsaved goal title');
  await expectActionFeedback(page, 'disk full');
  await dismissActionFeedback(page);
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await page.getByRole('navigation').getByRole('button', { name: 'All years', exact: true }).click();
  await expect(page.getByLabel('Goal title G1')).toHaveValue('Unsaved goal title');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect(page.getByRole('alert')).toContainText('disk full');
  expect(await desktop.windows()).toHaveLength(1);

  failWrites(false);
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  await desktop.close();
  await launch();
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await expect(page.getByLabel('Goal title G1')).toHaveValue('Unsaved goal title');
});

test('a failed new-goal write remains in its dialog and retries without allocating a second reference', async () => {
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  failWrites(true);
  await page.getByRole('button', { name: 'Add goal', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a learning goal' });
  await dialog.getByLabel('Goal title').fill('Pending shared goal');
  await dialog.getByRole('button', { name: 'Add goal', exact: true }).click();
  await expectActionFeedback(page, 'disk full');
  await dismissActionFeedback(page);
  await expect(dialog.getByRole('alert')).toContainText('disk full');
  await expect(dialog.getByLabel('Goal title')).toHaveValue('Pending shared goal');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toBeVisible();

  failWrites(false);
  await dialog.getByRole('button', { name: 'Retry save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Goal title G1')).toHaveValue('Pending shared goal');
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
});
