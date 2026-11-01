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
async function interceptMotionStarts() {
  await page.evaluate(() => {
    type TestStats = { native: number; fallback: number };
    type NativeViewTransition = {
      ready: Promise<void>;
      updateCallbackDone: Promise<void>;
      finished: Promise<void>;
      skipTransition: () => void;
    };
    type TransitionDocument = { startViewTransition?: (update: () => void) => NativeViewTransition };
    type InstrumentedWindow = Window & { __swccTransitionStats?: TestStats };
    const target = window as InstrumentedWindow;
    const stats: TestStats = { native: 0, fallback: 0 };
    target.__swccTransitionStats = stats;
    const documentPrototype = Document.prototype as unknown as TransitionDocument;
    Object.defineProperty(documentPrototype, 'startViewTransition', {
      configurable: true,
      value(update: () => void) {
        stats.native++;
        update();
        return {
          ready: Promise.resolve(),
          updateCallbackDone: Promise.resolve(),
          finished: Promise.resolve(),
          skipTransition: () => {},
        };
      },
    });
    const elementPrototype = Element.prototype as unknown as {
      animate: (frames: Keyframe[], options: KeyframeAnimationOptions) => Animation;
    };
    const originalAnimate = elementPrototype.animate;
    Object.defineProperty(elementPrototype, 'animate', {
      configurable: true,
      value: function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
        if (this.matches('.page-transition-scope, .activity-editor')) stats.fallback++;
        return originalAnimate.call(this, frames, options);
      },
    });
  });
}
async function motionStartCounts() {
  return page.evaluate(() => (window as Window & { __swccTransitionStats?: { native: number; fallback: number } })
    .__swccTransitionStats ?? { native: 0, fallback: 0 });
}
async function holdFallbackTransitions() {
  await page.evaluate(() => {
    type TestStats = { started: number; animation: Animation | null };
    type TransitionDocument = { startViewTransition?: unknown };
    const target = window as Window & { __swccHeldTransitions?: TestStats };
    const stats: TestStats = { started: 0, animation: null };
    target.__swccHeldTransitions = stats;
    Object.defineProperty(Document.prototype as unknown as TransitionDocument, 'startViewTransition', {
      configurable: true,
      value: undefined,
    });
    const elementPrototype = Element.prototype;
    const originalAnimate = elementPrototype.animate;
    Object.defineProperty(elementPrototype, 'animate', {
      configurable: true,
      value: function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
        if (!this.matches('.page-transition-scope')) return originalAnimate.call(this, frames, options);
        stats.started++;
        const animation = originalAnimate.call(this, frames, { ...options, duration: 10_000 });
        stats.animation = animation;
        return animation;
      },
    });
  });
}
async function heldTransitionCounts() {
  return page.evaluate(() => {
    const stats = (window as Window & { __swccHeldTransitions?: { started: number; animation: Animation | null } })
      .__swccHeldTransitions;
    return { started: stats?.started ?? 0, playState: stats?.animation?.playState ?? 'none' };
  });
}
async function addActivity(title: string) {
  await page.getByRole('button', { name: 'Add activity', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Record an activity' });
  await dialog.getByLabel('Activity title').fill(title);
  await dialog.getByRole('button', { name: 'Save activity', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('selected activity borders keep the same corner radii as unselected cards', async () => {
  await navigate('Development plan');
  await addActivity('First activity');
  await addActivity('Second activity');

  for (const width of [1280, 620]) {
    await page.setViewportSize({ width, height: 800 });
    for (const ref of ['A1', 'A2']) {
      const selected = page.getByRole('button', { name: `Select activity ${ref}`, exact: true });
      await selected.focus();
      await selected.press('Enter');
      await expect(selected).toHaveAttribute('aria-pressed', 'true');
      const radii = await page.locator('.activity-index > button').evaluateAll(cards => cards.map(card => {
        const style = getComputedStyle(card);
        return {
          selected: card.getAttribute('aria-pressed') === 'true',
          corners: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius],
        };
      }));
      expect(radii.find(card => card.selected)?.corners).toEqual(radii.find(card => !card.selected)?.corners);
    }
  }
});

test('C learning map edits one shared activity from either goal, keeps supplementary work, and reflows for keyboard use', async () => {
  await navigate('Development plan');
  await page.getByRole('button', { name: 'Add activity', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Record an activity' });
  await create.getByLabel('Activity title').fill('Shared consultation');
  await create.getByRole('button', { name: 'Save activity', exact: true }).click();
  let editor = page.getByRole('article', { name: 'Activity editor A1' });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Completion date')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Create and link a goal', exact: true }).click();
  const goal = page.getByRole('dialog', { name: 'Create a learning goal' });
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
  await expect(page.getByRole('heading', { name: 'Development plan', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export Forms PDF' })).toHaveCount(0);
  await navigate('Backup and restore');
  await expect(page.getByRole('heading', { name: 'Development plan', exact: true })).toBeVisible();
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
  await addActivity('Second activity');
  const first = page.getByRole('button', { name: 'Select activity A1', exact: true });
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await page.waitForFunction(() => {
    const active = [...document.querySelectorAll('.page-transition-scope, .activity-editor')]
      .some(element => element.getAnimations().some(animation => animation.playState === 'running'));
    return !active && !document.documentElement.dataset.swccTransition;
  });
  await interceptMotionStarts();
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
    await page.getByRole('button', { name: 'Select activity A2', exact: true }).click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('alert')).toContainText('Completed activities require an actual completion date.');
    expect(await motionStartCounts()).toEqual({ native: 0, fallback: 0 });
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
  const first = page.getByRole('button', { name: 'Select activity A1', exact: true });
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await page.waitForFunction(() => {
    const active = [...document.querySelectorAll('.page-transition-scope, .activity-editor')]
      .some(element => element.getAnimations().some(animation => animation.playState === 'running'));
    return !active && !document.documentElement.dataset.swccTransition;
  });
  await interceptMotionStarts();
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
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await navigate('All years');
  await expect(editor.getByLabel('Activity title', { exact: true })).toHaveValue('Unsaved activity title');
  expect(await motionStartCounts()).toEqual({ native: 0, fallback: 0 });
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

test('goal references highlight their stable activity record and restore keyboard focus after pointer exit', async () => {
  const activityIds = await page.evaluate(async () => {
    const state = await window.swcc.getState();
    if (!state.ok || !state.value.selectedPackage) throw new Error('No selected package');
    let pkg = state.value.selectedPackage;
    const goalIds: string[] = [];
    for (const title of ['First goal', 'Second goal', 'Third goal']) {
      const result = await window.swcc.createGoal({
        packageId: pkg.id, expectedRevision: pkg.contentRevision, title,
      });
      if (!result.ok) throw new Error(result.error.message);
      pkg = result.value;
      goalIds.push(pkg.goals.at(-1)!.id);
    }
    const shared = await window.swcc.createActivity({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Same activity title',
      goalIds: goalIds.slice(0, 2),
    });
    if (!shared.ok) throw new Error(shared.error.message);
    pkg = shared.value;
    const linked = await window.swcc.createActivity({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Another linked activity',
      goalIds: [goalIds[2]],
    });
    if (!linked.ok) throw new Error(linked.error.message);
    pkg = linked.value;
    const supplementary = await window.swcc.createActivity({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Same activity title', goalIds: [],
    });
    if (!supplementary.ok) throw new Error(supplementary.error.message);
    return {
      shared: shared.value.activities[0].id,
      linked: linked.value.activities[1].id,
      supplementary: supplementary.value.activities[2].id,
    };
  });
  await page.reload();

  const card = (id: string) => page.locator(`.activity-node[data-activity-id="${id}"]`);
  const style = (id: string) => card(id).evaluate(element => {
    const computed = getComputedStyle(element);
    return {
      background: computed.backgroundColor,
      border: computed.borderColor,
      inset: computed.boxShadow.includes('inset'),
      filter: computed.filter,
    };
  });
  const firstGoal = page.getByRole('button', { name: 'Open A1 from G1', exact: true });
  const secondGoal = page.getByRole('button', { name: 'Open A1 from G2', exact: true });
  const otherGoal = page.getByRole('button', { name: 'Open A2 from G3', exact: true });

  await firstGoal.hover();
  await expect.poll(() => style(activityIds.shared)).toEqual({
    background: 'rgb(242, 244, 235)', border: 'rgb(82, 99, 50)', inset: true, filter: 'brightness(0.94)',
  });
  expect(await style(activityIds.linked)).not.toEqual(await style(activityIds.shared));
  expect(await style(activityIds.supplementary)).not.toEqual(await style(activityIds.shared));

  await card(activityIds.shared).hover();
  const directHover = await style(activityIds.shared);
  await firstGoal.hover();
  await expect.poll(() => style(activityIds.shared)).toEqual(directHover);

  await secondGoal.focus();
  await otherGoal.hover();
  await expect.poll(() => style(activityIds.linked)).toEqual(directHover);
  expect(await style(activityIds.shared)).not.toEqual(directHover);
  const board = await page.locator('.relationship-board').boundingBox();
  expect(board).not.toBeNull();
  await page.mouse.move(board!.x + board!.width / 2, board!.y + board!.height - 5);
  await expect.poll(() => style(activityIds.linked)).not.toEqual(directHover);
  await expect.poll(() => style(activityIds.shared)).toEqual(directHover);

  await page.getByRole('button', { name: 'View development plan', exact: true }).focus();
  await expect.poll(() => style(activityIds.shared)).not.toEqual(directHover);
  await secondGoal.click();
  await expect(page.getByRole('heading', { name: 'Development plan', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select activity A1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('article', { name: 'Activity editor A1' })).toBeVisible();
});

test('activity index and goal references swap one live editor with incoming-only motion', async () => {
  await page.evaluate(async () => {
    const state = await window.swcc.getState();
    if (!state.ok || !state.value.selectedPackage) throw new Error('No selected package');
    let pkg = state.value.selectedPackage;
    const goalResult = await window.swcc.createGoal({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Linked goal',
    });
    if (!goalResult.ok) throw new Error(goalResult.error.message);
    pkg = goalResult.value;
    for (const [title, status, completionDate] of [
      ['First activity', 'Planned', ''],
      ['Completed activity', 'Completed', '2024-01-15'],
      ['Third activity', 'Planned', ''],
    ]) {
      const result = await window.swcc.createActivity({
        packageId: pkg.id, expectedRevision: pkg.contentRevision, title, status: status as 'Planned' | 'Completed',
        completionDate, goalIds: [goalResult.value.goals[0].id],
      });
      if (!result.ok) throw new Error(result.error.message);
      pkg = result.value;
    }
  });
  await page.reload();
  await page.evaluate(() => {
    Object.defineProperty(Document.prototype, 'startViewTransition', { configurable: true, value: undefined });
  });
  await navigate('Development plan');
  await expect(page.getByRole('article', { name: 'Activity editor A1' })).toBeVisible();
  await page.waitForFunction(() => document.querySelector('.page-transition-scope')
    ?.getAnimations().some(animation => animation.playState === 'running'));
  await page.waitForFunction(() => !document.querySelector('.page-transition-scope')
    ?.getAnimations().some(animation => animation.playState === 'running'));

  const sidebar = page.locator('.map-plan-body > aside');
  const goalStrip = page.locator('.goal-connection-strip');
  const planDate = page.getByLabel('Plan date');
  const readiness = page.locator('.readiness-panel');
  const scrollBefore = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const before = await Promise.all([sidebar, goalStrip, planDate, readiness].map(element => element.boundingBox()));
  const second = page.getByRole('button', { name: 'Select activity A2', exact: true });
  await second.click();
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  const editor = page.getByRole('article', { name: 'Activity editor A2', exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Activity title')).toHaveValue('Completed activity');
  await expect(editor.getByLabel('Completion date')).toHaveValue('2024-01-15');
  await expect(editor.getByLabel('Completion date')).not.toBeFocused();
  await expect(page.getByRole('article', { name: /^Activity editor/ })).toHaveCount(1);
  await page.waitForFunction(() => {
    const element = document.querySelector('.activity-editor');
    if (!element) return false;
    const style = getComputedStyle(element);
    const offset = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m41;
    return Number(style.opacity) < 1 && offset > 0;
  }, null, { polling: 'raf' });
  await expect.poll(async () => {
    const after = await Promise.all([sidebar, goalStrip, planDate, readiness].map(element => element.boundingBox()));
    const scrollAfter = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    return before.map((box, index) => box && after[index] ? {
      x: Math.round(box.x + scrollBefore.x - after[index]!.x - scrollAfter.x),
      y: Math.round(box.y + scrollBefore.y - after[index]!.y - scrollAfter.y),
      width: Math.round(box.width - after[index]!.width),
      height: Math.round(box.height - after[index]!.height),
    } : null);
  }).toEqual(Array.from({ length: 4 }, () => ({ x: 0, y: 0, width: 0, height: 0 })));

  const thirdReference = page.getByRole('button', { name: 'Edit A3 from G1', exact: true });
  await thirdReference.click();
  await expect(page.getByRole('button', { name: 'Select activity A3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('article', { name: 'Activity editor A3', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: /^Activity editor/ })).toHaveCount(1);

  const thirdIndex = page.getByRole('button', { name: 'Select activity A3', exact: true });
  await thirdIndex.click();
  await expect(thirdIndex).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('article', { name: 'Activity editor A3', exact: true })).toBeVisible();
  const editorTransform = await page.locator('.activity-editor').evaluate(element => ({
    opacity: getComputedStyle(element).opacity,
    transform: getComputedStyle(element).transform,
  }));
  expect(editorTransform).toEqual({ opacity: '1', transform: 'none' });
});

test('micro-feedback follows real saves, focused writing, and records added to the visible plan', async () => {
  await navigate('Development plan');
  const status = page.getByRole('status', { name: 'Save status' });
  const pill = status.locator('.save-status-content');
  await expect(status).toHaveText('Saved');
  await expect(pill).not.toHaveAttribute('data-response', 'true');
  await expect(pill).toHaveCSS('background-color', 'rgb(242, 244, 235)');
  await page.evaluate(() => {
    const target = window as Window & { __swccMotionEvents?: string[] };
    target.__swccMotionEvents = [];
    document.addEventListener('animationstart', event => {
      const element = event.target;
      if (!(element instanceof Element)) return;
      const label = element.getAttribute('aria-label') ?? element.getAttribute('class') ?? element.tagName;
      target.__swccMotionEvents?.push(`${event.animationName}:${label}`);
    });
  });
  await expect(status.locator('svg')).toHaveCount(1);
  expect(await pill.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      radius: style.borderRadius,
      padding: style.padding,
      gap: style.gap,
      minWidth: style.minWidth,
    };
  })).toEqual({
    background: 'rgb(242, 244, 235)', radius: '20px', padding: '6px 9px', gap: '6px', minWidth: '80px',
  });
  await expect(pill).not.toHaveAttribute('data-response', 'true');

  const addActivityButton = page.getByRole('button', { name: 'Add activity', exact: true });
  const addActivityBounds = await addActivityButton.boundingBox();
  expect(addActivityBounds).not.toBeNull();
  await page.mouse.move(addActivityBounds!.x + addActivityBounds!.width / 2, addActivityBounds!.y + addActivityBounds!.height / 2);
  await page.mouse.down();
  await expect.poll(() => addActivityButton.evaluate(element => {
    const transform = getComputedStyle(element).transform;
    return transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a;
  })).toBeLessThan(0.99);
  await page.mouse.up();

  const createActivity = page.getByRole('dialog', { name: 'Record an activity' });
  await expect(createActivity).toBeVisible();
  expect(await createActivity.evaluate(element => getComputedStyle(element).animationName)).toBe('swcc-dialog-open');
  await createActivity.getByLabel('Activity title', { exact: true }).fill('Friendly movement');
  await createActivity.getByRole('button', { name: 'Save activity', exact: true }).click();
  await expect(createActivity).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select activity A1', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { __swccMotionEvents?: string[] })
    .__swccMotionEvents ?? [])).toContain('swcc-record-reveal:Select activity A1');
  await expect.poll(() => pill.getAttribute('data-response')).toBeNull();

  const editor = page.getByRole('article', { name: 'Activity editor A1' });
  const title = editor.getByLabel('Activity title', { exact: true });
  await title.focus();
  await expect(title).toHaveCSS('background-color', 'rgb(251, 252, 248)');
  await expect(title).toHaveCSS('border-color', 'rgb(82, 99, 50)');
  await title.fill('Updated activity title');
  await expect(status).toHaveText('Saving');
  await expect(status.locator('svg')).toHaveCount(0);
  await expect(pill).not.toHaveAttribute('data-response', 'true');
  await expect(status).toHaveText('Saved');
  await expect(status.locator('svg')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as Window & { __swccMotionEvents?: string[] })
    .__swccMotionEvents?.filter(event => event.startsWith('save-status-response:')).length ?? 0)).toBeGreaterThan(0);
  await expect(pill).not.toHaveAttribute('data-response', 'true');

  const createGoalButton = editor.getByRole('button', { name: 'Create and link a goal', exact: true });
  await createGoalButton.scrollIntoViewIfNeeded();
  const createGoalBounds = await createGoalButton.boundingBox();
  expect(createGoalBounds).not.toBeNull();
  await page.mouse.move(createGoalBounds!.x + createGoalBounds!.width / 2, createGoalBounds!.y + createGoalBounds!.height / 2);
  await page.mouse.down();
  expect(await createGoalButton.evaluate(element => getComputedStyle(element).transform)).toBe('none');
  await page.mouse.up();
  const createGoal = page.getByRole('dialog', { name: 'Create a learning goal' });
  await createGoal.getByLabel('Goal title').fill('Goal reveal');
  await createGoal.getByRole('button', { name: 'Create goal', exact: true }).click();
  await expect(createGoal).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as Window & { __swccMotionEvents?: string[] })
    .__swccMotionEvents ?? [])).toContain('swcc-record-reveal:G1 Goal reveal');
});

test('live archive motion-off preference stops in-flight movement and keeps later navigation static', async () => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await holdFallbackTransitions();
  try {
    await navigate('Development plan');
    await expect(page.getByRole('heading', { name: 'Development plan', exact: true })).toBeVisible();
    await expect.poll(heldTransitionCounts).toEqual({ started: 1, playState: 'running' });

    await page.evaluate(() => {
      const url = new URL(location.href);
      url.searchParams.set('prototype', 'friendlier');
      url.searchParams.set('motion', 'off');
      history.replaceState(null, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect.poll(heldTransitionCounts).toEqual({ started: 1, playState: 'idle' });

    await navigate('Self-assessment');
    await expect(page.getByRole('heading', { name: 'Self-assessment', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true })).toBeEnabled();
    expect(await heldTransitionCounts()).toEqual({ started: 1, playState: 'idle' });
  } finally {
    await page.evaluate(() => {
      const stats = (window as Window & { __swccHeldTransitions?: { animation: Animation | null } }).__swccHeldTransitions;
      stats?.animation?.cancel();
      const url = new URL(location.href);
      url.searchParams.delete('prototype');
      url.searchParams.delete('motion');
      history.replaceState(null, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }).catch(() => {});
  }
});

test('latest rapid activity and page intents cancel stale native callbacks without blocking future motion', async () => {
  await page.evaluate(() => {
    Object.defineProperty(Document.prototype, 'startViewTransition', { configurable: true, value: undefined });
  });
  await navigate('Development plan');
  await page.waitForFunction(() => document.querySelector('.page-transition-scope')
    ?.getAnimations().some(animation => animation.playState === 'running'));
  await page.waitForFunction(() => !document.querySelector('.page-transition-scope')
    ?.getAnimations().some(animation => animation.playState === 'running'));
  await addActivity('First activity');
  await addActivity('Second activity');
  await addActivity('Third activity');
  await page.getByRole('button', { name: 'Select activity A1', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.activity-editor')
    ?.getAnimations().some(animation => animation.playState === 'running'));
  await page.waitForFunction(() => !document.querySelector('.activity-editor')
    ?.getAnimations().some(animation => animation.playState === 'running'));

  const pageErrors: string[] = [];
  page.on('pageerror', failure => pageErrors.push(failure.message));
  await page.evaluate(() => {
    type TestTransition = { invoke: () => void };
    type TestHooks = { scopes: string[]; pending: TestTransition[]; skipped: number };
    type NativeViewTransition = {
      ready: Promise<void>;
      updateCallbackDone: Promise<void>;
      finished: Promise<void>;
      skipTransition: () => void;
    };
    type TransitionDocument = {
      startViewTransition?: (update: () => void) => NativeViewTransition;
    };
    type InstrumentedWindow = Window & { __swccTransitionTest?: TestHooks };
    const target = window as InstrumentedWindow;
    const hooks: TestHooks = { scopes: [], pending: [], skipped: 0 };
    target.__swccTransitionTest = hooks;
    const prototype = Document.prototype as unknown as TransitionDocument;
    Object.defineProperty(prototype, 'startViewTransition', {
      configurable: true,
      value: function (this: Document, update: () => void): NativeViewTransition {
        hooks.scopes.push(document.documentElement.dataset.swccTransition ?? '');
        let resolveUpdate: (() => void) | undefined;
        let rejectUpdate: ((failure: unknown) => void) | undefined;
        let resolveFinished: (() => void) | undefined;
        let rejectFinished: ((failure: unknown) => void) | undefined;
        const updateCallbackDone = new Promise<void>((resolve, reject) => {
          resolveUpdate = resolve;
          rejectUpdate = reject;
        });
        const finished = new Promise<void>((resolve, reject) => {
          resolveFinished = resolve;
          rejectFinished = reject;
        });
        hooks.pending.push({
          invoke: () => {
            try {
              update();
              resolveUpdate?.();
              resolveFinished?.();
            } catch (failure) {
              rejectUpdate?.(failure);
              rejectFinished?.(failure);
              throw failure;
            }
          },
        });
        return {
          ready: Promise.resolve(),
          updateCallbackDone,
          finished,
          skipTransition: () => {
            hooks.skipped++;
            const failure = new DOMException('Transition skipped', 'AbortError');
            rejectUpdate?.(failure);
            rejectFinished?.(failure);
          },
        };
      },
    });
  });

  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[aria-label="Select activity A2"]')?.click();
    document.querySelector<HTMLButtonElement>('[aria-label="Select activity A1"]')?.click();
  });
  await expect.poll(() => page.evaluate(() => (window as Window & { __swccTransitionTest?: { scopes: string[] } })
    .__swccTransitionTest?.scopes.length ?? 0)).toBe(1);
  await expect(page.getByRole('button', { name: 'Select activity A1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as Window & { __swccTransitionTest?: { skipped: number } })
    .__swccTransitionTest?.skipped)).toBe(1);
  await page.evaluate(() => (window as Window & { __swccTransitionTest?: { pending: Array<{ invoke: () => void }> } })
    .__swccTransitionTest?.pending[0]?.invoke());
  await expect(page.getByRole('article', { name: 'Activity editor A1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select activity A2', exact: true })).not.toHaveAttribute('aria-pressed', 'true');

  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[aria-label="Select activity A2"]')?.click();
    document.querySelector<HTMLButtonElement>('[aria-label="Select activity A3"]')?.click();
  });
  await expect.poll(() => page.evaluate(() => (window as Window & { __swccTransitionTest?: { scopes: string[] } })
    .__swccTransitionTest?.scopes.length ?? 0)).toBe(3);
  expect(await page.evaluate(() => (window as Window & { __swccTransitionTest?: { skipped: number } })
    .__swccTransitionTest?.skipped)).toBe(2);
  await page.evaluate(() => {
    const pending = (window as Window & { __swccTransitionTest?: { pending: Array<{ invoke: () => void }> } })
      .__swccTransitionTest?.pending ?? [];
    pending[1]?.invoke();
    pending[2]?.invoke();
  });
  await expect(page.getByRole('button', { name: 'Select activity A3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('article', { name: 'Activity editor A3', exact: true })).toBeVisible();

  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[aria-label="Select activity A2"]')?.click());
  await expect.poll(() => page.evaluate(() => (window as Window & { __swccTransitionTest?: { scopes: string[] } })
    .__swccTransitionTest?.scopes.length ?? 0)).toBe(4);
  await page.evaluate(() => (window as Window & { __swccTransitionTest?: { pending: Array<{ invoke: () => void }> } })
    .__swccTransitionTest?.pending[3]?.invoke());
  await expect(page.getByRole('button', { name: 'Select activity A2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('article', { name: 'Activity editor A2', exact: true })).toBeVisible();

  const review = page.getByRole('navigation').getByRole('button', { name: 'Review', exact: true });
  const assessment = page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true });
  await review.click();
  await expect(review).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (window as Window & { __swccTransitionTest?: { scopes: string[] } })
    .__swccTransitionTest?.scopes.length ?? 0)).toBe(5);
  await assessment.click();
  await expect(assessment).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (window as Window & { __swccTransitionTest?: { scopes: string[] } })
    .__swccTransitionTest?.scopes.length ?? 0)).toBe(6);
  expect(await page.evaluate(() => (window as Window & { __swccTransitionTest?: { skipped: number } })
    .__swccTransitionTest?.skipped)).toBe(3);
  await page.evaluate(() => {
    const pending = (window as Window & { __swccTransitionTest?: { pending: Array<{ invoke: () => void }> } })
      .__swccTransitionTest?.pending ?? [];
    pending[4]?.invoke();
    pending[5]?.invoke();
  });
  await expect(assessment).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Self-assessment', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { __swccTransitionTest?: { scopes: string[] } })
    .__swccTransitionTest?.scopes)).toEqual(['activity', 'activity', 'activity', 'activity', 'page', 'page']);
  await expect.poll(() => pageErrors).toEqual([]);
});
