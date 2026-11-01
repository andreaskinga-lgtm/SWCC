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
let writesFailing = false;
async function launch(tz = 'America/Toronto') {
  desktop = await electron.launch({
    args: ['.', `--user-data-dir=${root}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', TZ: tz },
  });
  page = await desktop.firstWindow();
  await page.context().setOffline(true);
}
test.beforeEach(async () => {
  root = resolve('.work', `desktop-activities-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  await launch();
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
});
test.afterEach(async () => {
  if (writesFailing) failWrites(false);
  await desktop?.close();
  rmSync(root, { recursive: true, force: true });
});
function failWrites(enabled: boolean) {
  const fixture = spawnSync(electronExecutable, ['tests/desktop/storage-fixture.mjs', resolve(root, 'dataset/database.sqlite'), String(enabled)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
  });
  if (fixture.status !== 0) throw new Error(fixture.stderr);
  writesFailing = enabled;
}
async function navigate(name: string) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}
async function addActivity(title: string) {
  await page.getByRole('button', { name: 'Add activity', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Record an activity' });
  await dialog.getByLabel('Activity title').fill(title);
  await dialog.getByRole('button', { name: 'Save activity', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('C learning map edits one shared activity from either goal, keeps supplementary work, and reflows for keyboard use', async () => {
  await page.getByRole('button', { name: 'Record an activity', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Record an activity' });
  await create.getByLabel('Activity title').fill('Shared consultation');
  await create.getByRole('button', { name: 'Save activity', exact: true }).click();
  let editor = page.getByRole('article', { name: 'Activity editor A1' });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Completion date')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Create and link a goal', exact: true }).click();
  const goal = page.getByRole('dialog', { name: 'Create a shared learning goal' });
  await goal.getByLabel('Goal title').fill('Reflective supervision');
  await goal.getByRole('button', { name: 'Create goal', exact: true }).click();
  await expect(goal).toHaveCount(0);
  await editor.getByRole('button', { name: 'Create and link a goal', exact: true }).click();
  await goal.getByLabel('Goal title').fill('Trauma-informed practice');
  await goal.getByRole('button', { name: 'Create goal', exact: true }).click();
  await expect(goal).toHaveCount(0);
  await editor.getByLabel('Evidence notes').fill('Consultation notes from one session');
  await editor.getByLabel('Evidence links').fill('https://example.org/notes');
  await editor.getByLabel('Application to practice').fill('I changed my consultation approach.');
  await editor.getByLabel('Activity status').selectOption('Completed');
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saving');
  await expect(editor.getByText('Completed activities require an actual completion date.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await editor.getByLabel('Completion date').fill('2023-12-30');
  await expect(editor.getByText(/This date is outside 2024/)).toBeVisible();
  await page.getByLabel('Plan date').fill('2023-12-31');
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  expect(await page.getByLabel('Step 3 missing items').allTextContents()).toEqual([]);
  await expect(page.getByRole('status', { name: 'Step 3 readiness' })).toHaveText('Ready');
  await addActivity('Supplementary reading');
  await expect(page.getByRole('status', { name: 'Step 3 readiness' })).toHaveText('Ready');
  await page.setViewportSize({ width: 620, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const g1 = page.getByRole('button', { name: 'Edit A1 from G1', exact: true });
  await g1.focus();
  await g1.press('Enter');
  await expect(editor.getByLabel('Evidence notes')).toHaveValue('Consultation notes from one session');
  await page.getByRole('button', { name: 'Edit A1 from G2', exact: true }).press('Enter');
  await expect(editor.getByLabel('Application to practice')).toHaveValue('I changed my consultation approach.');
  await expect(page.getByRole('article', { name: /Activity editor/ })).toHaveCount(1);
  await page.setViewportSize({ width: 520, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await navigate('Self-assessment');
  await expect(page.getByLabel('Goal title G1')).toHaveValue('Reflective supervision');
  await expect(page.getByLabel('Goal title G2')).toHaveValue('Trauma-informed practice');
  await navigate('Year overview');
  await expect(page.getByRole('button', { name: /Open activity A1/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Open activity A1/ })).toContainText('G1');
  await expect(page.getByRole('button', { name: /Open activity A1/ })).toContainText('G2');
  await expect(page.getByRole('button', { name: /Open activity A2/ })).toContainText('No linked goal');
  await desktop.close();
  await launch('Pacific/Auckland');
  await page.getByRole('button', { name: /Open activity A1/ }).click();
  editor = page.getByRole('article', { name: 'Activity editor A1' });
  await expect(editor.getByLabel('Completion date')).toHaveValue('2023-12-30');
  await expect(editor.getByLabel('Completion date')).not.toBeFocused();
  await expect(page.getByLabel('Plan date')).toHaveValue('2023-12-31');
  await expect(editor.getByLabel('Evidence notes')).toHaveValue('Consultation notes from one session');
});

test('completion date is visible only for Completed and stays with the activity when hidden', async () => {
  await navigate('Development plan');
  await addActivity('Date entry');
  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  const status = editor.getByLabel('Activity status');
  const date = editor.getByLabel('Completion date');
  await expect(date).toHaveCount(0);

  await status.selectOption('Completed');
  await expect(date).toBeVisible();
  await expect(date).toHaveValue('');
  await expect(date).toBeFocused();
  await page.keyboard.press('Escape');
  await date.fill('2023-12-30');
  await expect(editor.getByText(/This date is outside 2024/)).toBeVisible();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');

  await status.selectOption('Planned');
  await expect(date).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  await status.selectOption('In Progress');
  await expect(date).toHaveCount(0);
  await status.selectOption('Completed');
  await expect(date).toBeVisible();
  await expect(date).toHaveValue('2023-12-30');
  await page.keyboard.press('Escape');
  await navigate('Year overview');
  await page.getByRole('button', { name: /Open activity A1/ }).click();
  const reopened = page.getByRole('article', { name: 'Activity editor A1' });
  await expect(reopened.getByLabel('Completion date')).toHaveValue('2023-12-30');
  await expect(reopened.getByLabel('Completion date')).not.toBeFocused();
});

test('fallback calendar selects a date when the native picker is unavailable', async () => {
  await navigate('Development plan');
  await addActivity('Fallback date entry');
  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  await page.evaluate(() => {
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
      configurable: true,
      value() { throw new Error('Native picker unavailable'); },
    });
  });
  await editor.getByLabel('Activity status').selectOption('Completed');
  const calendar = editor.getByRole('group', { name: 'Choose a completion date' });
  await expect(calendar).toBeVisible();
  await calendar.getByRole('button', { name: 'Previous month' }).click();
  await calendar.getByRole('gridcell').first().click();
  const date = editor.getByLabel('Completion date');
  const selectedDate = await date.inputValue();
  expect(selectedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(calendar).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  const savedActivity = await page.evaluate(async () => {
    const state = await window.swcc.getState();
    if (!state.ok) throw new Error(state.error.message);
    return state.value.selectedPackage?.activities[0];
  });
  expect(savedActivity).toMatchObject({ status: 'Completed', completionDate: selectedDate });
});

test('a missing Completed date stays pending without a write error and protects action-time flushes', async () => {
  await navigate('All years');
  await page.getByLabel('New package year').fill('2023');
  await page.getByLabel('New package year').press('Enter');
  await page.getByLabel('Year package').selectOption({ label: '2024' });
  await navigate('Development plan');
  await addActivity('Incomplete completion');
  await addActivity('Another activity');
  await page.getByRole('button', { name: 'Select activity A1' }).click();
  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  const date = editor.getByLabel('Completion date');
  await editor.getByLabel('Activity status').selectOption('Completed');
  await expect(date).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editor.getByLabel('Activity status')).toHaveValue('Completed');
  await expect(date).toHaveValue('');
  await expect(editor.getByText('Completed activities require an actual completion date.', { exact: true })).toBeVisible();
  await page.waitForTimeout(600);

  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();
  await expect(page.locator('.error-panel')).toHaveCount(0);
  await expect(page.locator('.action-feedback-dialog')).toBeHidden();
  const savedActivity = await page.evaluate(async () => {
    const state = await window.swcc.getState();
    if (!state.ok) throw new Error(state.error.message);
    return state.value.selectedPackage?.activities[0];
  });
  expect(savedActivity).toMatchObject({ status: 'Planned', completionDate: '' });

  await page.getByRole('button', { name: 'Select activity A2' }).click();
  await expect(editor.getByLabel('Activity title')).toHaveValue('Incomplete completion');
  await page.getByRole('button', { name: 'Complete Step 3' }).click();
  await expect(page.getByRole('alert')).toContainText('Completed activities require an actual completion date.');
  await expect(page.getByRole('status', { name: 'Step 3 readiness' })).not.toHaveText('Completed');
  const selectedYear = await page.getByLabel('Year package').inputValue();
  await page.getByLabel('Year package').selectOption({ label: '2023' });
  await expect(page.getByLabel('Year package')).toHaveValue(selectedYear);
  await navigate('Year overview');
  await expect(page.getByRole('heading', { name: 'Give your learning a place.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export Forms PDF' })).toHaveCount(0);
  await navigate('Backup and restore');
  await expect(page.getByRole('heading', { name: 'Give your learning a place.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create full backup' })).toHaveCount(0);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  expect(desktop.windows()).toHaveLength(1);
  await date.fill('9999-12-31');
  await expect(editor.getByText('The completion date cannot be in the future.', { exact: true })).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();
  const stillPlanned = await page.evaluate(async () => {
    const state = await window.swcc.getState();
    if (!state.ok) throw new Error(state.error.message);
    return state.value.selectedPackage?.activities[0];
  });
  expect(stillPlanned).toMatchObject({ status: 'Planned', completionDate: '' });
  await date.fill('2023-12-30');
  await expect(editor.getByText(/This date is outside 2024/)).toBeVisible();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  const completedActivity = await page.evaluate(async () => {
    const state = await window.swcc.getState();
    if (!state.ok) throw new Error(state.error.message);
    return state.value.selectedPackage?.activities[0];
  });
  expect(completedActivity).toMatchObject({ status: 'Completed', completionDate: '2023-12-30' });
});

test('a missing completion date keeps Retry beside its inline message without an error panel or modal', async () => {
  await navigate('Development plan');
  await addActivity('Inline date recovery');
  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  const date = editor.getByLabel('Completion date');
  const status = page.getByRole('status', { name: 'Save status' });

  try {
    await editor.getByLabel('Activity status').selectOption('Completed');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await expect(status).toHaveText('Not saved');
    await expect(editor.getByText('Completed activities require an actual completion date.', { exact: true })).toBeVisible();
    await expect(page.locator('.error-panel')).toHaveCount(0);
    const retry = page.getByRole('button', { name: 'Retry save', exact: true });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(status).toHaveText('Not saved');
    await expect(editor.getByText('Completed activities require an actual completion date.', { exact: true })).toBeVisible();
    await expect(page.locator('.action-feedback-dialog')).toBeHidden();
  } finally {
    if (await date.count()) {
      await page.keyboard.press('Escape');
      await date.fill('2024-01-15');
      await expect(status).toHaveText('Saved');
    }
  }
});

test('an incomplete date cannot clear a genuine failed-save retry before a successful write', async () => {
  await navigate('Development plan');
  await addActivity('Original activity');
  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  failWrites(true);
  await editor.getByLabel('Activity title', { exact: true }).fill('Retained activity title');
  await expectActionFeedback(page, 'disk full');
  await dismissActionFeedback(page);
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();

  await editor.getByLabel('Activity status').selectOption('Completed');
  const date = editor.getByLabel('Completion date');
  await expect(date).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor.getByText('Completed activities require an actual completion date.', { exact: true })).toBeVisible();
  await page.waitForTimeout(600);

  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await expect(page.getByRole('alert')).toContainText('disk full');
  await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();
  await expect(page.locator('.action-feedback-dialog')).toBeHidden();
  const persistedActivity = await page.evaluate(async () => {
    const state = await window.swcc.getState();
    if (!state.ok) throw new Error(state.error.message);
    return state.value.selectedPackage?.activities[0];
  });
  expect(persistedActivity).toMatchObject({ title: 'Original activity', status: 'Planned', completionDate: '' });

  failWrites(false);
  await date.fill('2024-01-15');
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  const savedActivity = await page.evaluate(async () => {
    const state = await window.swcc.getState();
    if (!state.ok) throw new Error(state.error.message);
    return state.value.selectedPackage?.activities[0];
  });
  expect(savedActivity).toMatchObject({ title: 'Retained activity title', status: 'Completed', completionDate: '2024-01-15' });
});

test('failed activity edits and creations remain visible, block navigation and close, and retry once', async () => {
  await navigate('Development plan');
  await addActivity('Original activity');
  await addActivity('Another saved activity');
  await page.getByRole('button', { name: 'Select activity A1', exact: true }).click();
  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  failWrites(true);
  await editor.getByLabel('Activity title', { exact: true }).fill('Unsaved activity title');
  await editor.getByLabel('Evidence notes').fill('Retain this evidence');
  await expectActionFeedback(page, 'disk full');
  await dismissActionFeedback(page);
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await expect(editor.getByLabel('Activity title', { exact: true })).toHaveValue('Unsaved activity title');
  await page.getByRole('button', { name: 'Select activity A2', exact: true }).click();
  await expect(editor.getByLabel('Activity title', { exact: true })).toHaveValue('Unsaved activity title');
  await navigate('All years');
  await expect(editor.getByLabel('Activity title', { exact: true })).toHaveValue('Unsaved activity title');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect(page.getByRole('alert')).toContainText('disk full');
  expect(desktop.windows()).toHaveLength(1);
  failWrites(false);
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  failWrites(true);
  await page.getByRole('button', { name: 'Add activity', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Record an activity' });
  await dialog.getByLabel('Activity title').fill('Pending supplementary activity');
  await dialog.getByRole('button', { name: 'Save activity', exact: true }).click();
  await expectActionFeedback(page, 'disk full');
  await dismissActionFeedback(page);
  await expect(dialog.getByRole('alert')).toContainText('disk full');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Activity title')).toHaveValue('Pending supplementary activity');
  failWrites(false);
  await dialog.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select activity A3', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Select activity A4', exact: true })).toHaveCount(0);
  await desktop.close();
  await launch();
  await page.getByRole('button', { name: /Open activity A1/ }).click();
  const reopened = page.getByRole('article', { name: 'Activity editor A1' });
  await expect(reopened.getByLabel('Activity title', { exact: true })).toHaveValue('Unsaved activity title');
  await expect(reopened.getByLabel('Evidence notes')).toHaveValue('Retain this evidence');
});

test('invalid links remain protected; only explicit valid browser actions launch and report failures', async () => {
  await navigate('Development plan');
  await addActivity('Link evidence');
  await desktop.evaluate(({ shell }) => {
    shell.openExternal = async () => { throw new Error('Browser launch unavailable'); };
  });
  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  await editor.getByLabel('Evidence links').fill('file:///etc/passwd');
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await expect(editor.getByRole('button', { name: 'Open evidence link 1' })).toHaveCount(0);
  await navigate('Year overview');
  await expect(editor.getByLabel('Evidence links')).toHaveValue('file:///etc/passwd');
  await editor.getByLabel('Evidence links').fill('https://example.org/notes');
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  await expect(editor.getByRole('alert')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Open evidence link 1' }).click();
  await expectActionFeedback(page, 'Browser launch unavailable');
  await expect(editor.getByLabel('Evidence links')).toHaveValue('https://example.org/notes');
  await dismissActionFeedback(page);
});

test('explicit retry of an invalid evidence link shows failure feedback and keeps the edit retryable', async () => {
  await navigate('Development plan');
  await addActivity('Invalid evidence link');
  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  const links = editor.getByLabel('Evidence links');
  const feedback = page.locator('.action-feedback-dialog');

  try {
    await links.fill('file:///etc/passwd');
    await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
    await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();
    await expect(feedback).toBeHidden();

    await page.getByRole('button', { name: 'Retry save', exact: true }).click();
    const failure = await expectActionFeedback(page, 'Use valid HTTP or HTTPS evidence links');
    await expect(failure.getByRole('alert')).toContainText('Use valid HTTP or HTTPS evidence links');
    await expect(links).toHaveValue('file:///etc/passwd');
    await dismissActionFeedback(page);
    await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
    await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();
    await expect(links).toHaveValue('file:///etc/passwd');
  } finally {
    if (await feedback.isVisible().catch(() => false)) await dismissActionFeedback(page);
    await links.fill('https://example.org/notes');
    await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  }
});
