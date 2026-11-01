import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

let desktop: ElectronApplication;
let page: Page;
let root: string;

test.beforeEach(async () => {
  root = resolve('.work', `desktop-assessment-action-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  desktop = await electron.launch({
    executablePath: process.env.SWCC_PACKAGED_EXECUTABLE,
    args: [...(process.env.SWCC_PACKAGED_EXECUTABLE ? [] : ['.']), `--user-data-dir=${root}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  page = await desktop.firstWindow();
  await page.context().setOffline(true);
});

test.afterEach(async () => {
  await desktop?.close();
  rmSync(root, { recursive: true, force: true });
});

async function createYear() {
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
}

async function addGoal(title: string) {
  await page.getByRole('button', { name: 'Add goal', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a learning goal' });
  await dialog.getByLabel('Goal title').fill(title);
  await dialog.getByRole('button', { name: 'Add goal', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

async function showOverview() {
  await page.getByRole('navigation').getByRole('button', { name: 'Year overview', exact: true }).click();
}

async function gapAfter(content: Locator, action: Locator) {
  const [contentBox, actionBox] = await Promise.all([content.boundingBox(), action.boundingBox()]);
  if (!contentBox || !actionBox) throw new Error('Overview content and assessment action must be visible.');
  return actionBox.y - (contentBox.y + contentBox.height);
}

test('the empty-goals overview action is clearly separated and opens self-assessment', async () => {
  await createYear();

  const action = page.getByRole('button', { name: 'Write your self assessment', exact: true });
  const emptyGoals = page.getByText('No goals yet. Add one from self-assessment or development plan.', { exact: true });
  await expect(emptyGoals).toBeVisible();
  await expect(action).toBeVisible();
  expect(await gapAfter(emptyGoals, action)).toBeGreaterThan(16);

  await action.click();
  await expect(page.getByRole('heading', { name: 'Self-assessment', exact: true })).toBeVisible();
  await addGoal('First learning goal');
  await showOverview();

  const oneGoalAction = page.getByRole('button', { name: 'Write your self assessment', exact: true });
  const firstGoal = page.getByRole('heading', { name: 'First learning goal', exact: true }).locator('xpath=..');
  await expect(oneGoalAction).toBeVisible();
  expect(await gapAfter(firstGoal, oneGoalAction)).toBeGreaterThan(16);

  await oneGoalAction.click();
  await addGoal('Second learning goal');
  await showOverview();

  const multipleGoalsAction = page.getByRole('button', { name: 'Write your self assessment', exact: true });
  const lastGoal = page.getByRole('heading', { name: 'Second learning goal', exact: true }).locator('xpath=..');
  await expect(multipleGoalsAction).toBeVisible();
  expect(await gapAfter(lastGoal, multipleGoalsAction)).toBeGreaterThan(16);

  await multipleGoalsAction.click();
  await expect(page.getByLabel('Strengths')).toHaveValue('');
  await expect(page.getByLabel('Learning needs and interests')).toHaveValue('');
  await expect(page.getByRole('group', { name: 'Relevant annual standards' }).getByRole('checkbox', { name: 'Code of Ethics' }))
    .not.toBeChecked();
  await page.getByLabel('Peer feedback').fill('Peers value my collaboration.');
  await showOverview();

  const updateAction = page.getByRole('button', { name: 'Update your self assessment', exact: true });
  await expect(updateAction).toBeVisible();
  expect(await gapAfter(lastGoal, updateAction)).toBeGreaterThan(16);

  await updateAction.click();
  await expect(page.getByLabel('Peer feedback')).toHaveValue('Peers value my collaboration.');
  await page.getByLabel('Peer feedback').fill('');
  await showOverview();
  await expect(page.getByRole('button', { name: 'Write your self assessment', exact: true })).toBeVisible();
});

test('the development-plan overview action matches self-assessment spacing with empty and existing activities', async () => {
  await createYear();
  async function expectMatchingSpacing() {
    const assessmentAction = page.getByRole('button', { name: 'Write your self assessment', exact: true });
    const planAction = page.getByRole('button', { name: 'View development plan', exact: true });
    const assessmentGap = await gapAfter(page.locator('.goal-nodes'), assessmentAction);
    const planGap = await gapAfter(page.locator('.activity-nodes'), planAction);
    expect.soft(planGap).toBeGreaterThan(16);
    expect.soft(planGap).toBeCloseTo(assessmentGap, 1);
  }
  for (const width of [1280, 620]) {
    await page.setViewportSize({ width, height: 800 });
    await expectMatchingSpacing();
  }

  await page.getByRole('button', { name: 'View development plan', exact: true }).click();
  await page.getByRole('button', { name: 'Add activity', exact: true }).click();
  const activity = page.getByRole('dialog', { name: 'Record an activity' });
  await activity.getByLabel('Activity title', { exact: true }).fill('Existing learning activity');
  await activity.getByRole('button', { name: 'Save activity', exact: true }).click();
  await expect(activity).not.toBeVisible();
  await showOverview();

  for (const width of [1280, 620]) {
    await page.setViewportSize({ width, height: 800 });
    await expectMatchingSpacing();
    const lastActivity = page.getByRole('button', { name: 'Open activity A1: Existing learning activity', exact: true });
    expect.soft(await gapAfter(lastActivity, page.getByRole('button', { name: 'View development plan', exact: true })))
      .toBeGreaterThan(16);
  }
  await page.getByRole('button', { name: 'View development plan', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Activity editor A1' })).toBeVisible();
});

test('the first four navigation destinations share a responsive marker while bottom selections stay static', async () => {
  await createYear();
  const nav = page.getByRole('navigation');
  const marker = nav.locator(':scope > span[aria-hidden="true"]');
  await expect(marker).toHaveCount(1);

  async function aligned(name: string) {
    const [markerBox, buttonBox] = await Promise.all([
      marker.boundingBox(),
      nav.getByRole('button', { name, exact: true }).boundingBox(),
    ]);
    if (!markerBox || !buttonBox) return false;
    return Math.abs(markerBox.x - buttonBox.x) < 1
      && Math.abs(markerBox.y - buttonBox.y) < 1
      && Math.abs(markerBox.width - buttonBox.width) < 1
      && Math.abs(markerBox.height - buttonBox.height) < 1;
  }

  await expect.poll(() => aligned('Year overview')).toBe(true);
  const overviewIcon = await nav.getByRole('button', { name: 'Year overview' }).locator('svg').boundingBox();
  const start = await marker.boundingBox();
  const review = nav.getByRole('button', { name: 'Review', exact: true });
  const reviewBounds = await review.boundingBox();
  expect(reviewBounds).not.toBeNull();
  await page.mouse.move(reviewBounds!.x + reviewBounds!.width / 2, reviewBounds!.y + reviewBounds!.height / 2);
  await page.mouse.down();
  await expect.poll(() => review.evaluate(element => {
    const transform = getComputedStyle(element).transform;
    return transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a;
  })).toBeLessThan(0.97);
  await page.mouse.up();
  await expect(review).toHaveAttribute('aria-current', 'page');
  const destination = await review.boundingBox();
  expect(start).not.toBeNull();
  expect(destination).not.toBeNull();
  await page.waitForFunction(({ from, to }) => {
    const selection = document.querySelector('nav > span[aria-hidden="true"]');
    if (!selection) return false;
    const box = selection.getBoundingClientRect();
    return Math.abs(box.y - from) > 1 && Math.abs(box.y - to) > 1;
  }, { from: start!.y, to: destination!.y }, { polling: 'raf' });
  await expect.poll(() => aligned('Review')).toBe(true);
  const overviewIconAfter = await nav.getByRole('button', { name: 'Year overview' }).locator('svg').boundingBox();
  expect(overviewIconAfter).not.toBeNull();
  expect(Math.abs(overviewIconAfter!.x - overviewIcon!.x)).toBeLessThan(1);
  expect(Math.abs(overviewIconAfter!.y - overviewIcon!.y)).toBeLessThan(1);
  expect(Math.abs(overviewIconAfter!.width - overviewIcon!.width)).toBeLessThan(1);
  expect(Math.abs(overviewIconAfter!.height - overviewIcon!.height)).toBeLessThan(1);

  for (const name of ['Self-assessment', 'Development plan']) {
    const button = nav.getByRole('button', { name, exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => aligned(name)).toBe(true);
  }

  for (const name of ['All years', 'Backup and restore']) {
    const button = nav.getByRole('button', { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'page');
    await expect(marker).toBeHidden();
    await expect.poll(async () => button.evaluate(element => {
      const alpha = getComputedStyle(element).backgroundColor.match(/,\s*([\d.]+)\)$/);
      return alpha ? Number(alpha[1]) : 0;
    })).toBeGreaterThan(0.1);
  }

  await nav.getByRole('button', { name: 'Development plan', exact: true }).click();
  await expect.poll(() => aligned('Development plan')).toBe(true);
  await page.setViewportSize({ width: 620, height: 800 });
  await expect.poll(() => aligned('Development plan')).toBe(true);
  await nav.getByRole('button', { name: 'All years', exact: true }).click();
  await expect(marker).toBeHidden();
  await nav.getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await expect.poll(() => aligned('Self-assessment')).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a page change commits immediately and moves only incoming content when native snapshots are unavailable', async () => {
  await createYear();
  await page.evaluate(() => {
    Object.defineProperty(Document.prototype, 'startViewTransition', { configurable: true, value: undefined });
  });
  const header = page.getByRole('banner');
  const headerBefore = await header.boundingBox();
  const review = page.getByRole('navigation').getByRole('button', { name: 'Review', exact: true });
  await review.click();
  await expect(review).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Standards review', exact: true })).toBeVisible();
  const content = page.locator('.page-transition-scope');
  await page.waitForFunction(() => {
    const element = document.querySelector('.page-transition-scope');
    if (!element) return false;
    const style = getComputedStyle(element);
    const offset = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m41;
    return Number(style.opacity) < 1 && offset > 0;
  }, null, { polling: 'raf' });
  expect(await header.boundingBox()).toEqual(headerBefore);
  await expect.poll(() => content.evaluate(element => {
    const style = getComputedStyle(element);
    const offset = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m41;
    return Number(style.opacity) >= 0.999 && Math.abs(offset) < 0.1;
  })).toBe(true);
});

test('native snapshots use separate page and activity scopes when Electron supports them', async () => {
  await createYear();
  await page.evaluate(async () => {
    const state = await window.swcc.getState();
    if (!state.ok || !state.value.selectedPackage) throw new Error('No selected package');
    let pkg = state.value.selectedPackage;
    for (const title of ['First activity', 'Second activity']) {
      const result = await window.swcc.createActivity({
        packageId: pkg.id, expectedRevision: pkg.contentRevision, title, goalIds: [],
      });
      if (!result.ok) throw new Error(result.error.message);
      pkg = result.value;
    }
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Year overview', exact: true })).toBeVisible();
  const instrumented = await page.evaluate(() => {
    type NativeViewTransition = {
      ready: Promise<void>;
      updateCallbackDone: Promise<void>;
      finished: Promise<void>;
      skipTransition: () => void;
    };
    type TransitionDocument = {
      startViewTransition?: (update: () => void) => NativeViewTransition;
    };
    type InstrumentedWindow = Window & { __swccTransitionScopes?: string[] };
    const prototype = Document.prototype as unknown as TransitionDocument;
    const original = prototype.startViewTransition;
    if (!original) return false;
    const target = window as InstrumentedWindow;
    target.__swccTransitionScopes = [];
    Object.defineProperty(prototype, 'startViewTransition', {
      configurable: true,
      value: function (this: Document, update: () => void) {
        target.__swccTransitionScopes?.push(document.documentElement.dataset.swccTransition ?? '');
        return original.call(this, update);
      },
    });
    return true;
  });
  test.skip(!instrumented, 'This Electron renderer does not expose native view transitions.');

  await page.getByRole('navigation').getByRole('button', { name: 'Development plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Development plan', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { __swccTransitionScopes?: string[] })
    .__swccTransitionScopes ?? [])).toContain('page');
  await page.getByRole('button', { name: 'Select activity A2', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Activity editor A2', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { __swccTransitionScopes?: string[] })
    .__swccTransitionScopes ?? [])).toEqual(['page', 'activity']);
});

test('a live reduced-motion preference change stops in-flight movement but preserves navigation', async () => {
  await createYear();
  await page.evaluate(() => {
    Object.defineProperty(Document.prototype, 'startViewTransition', { configurable: true, value: undefined });
  });
  const review = page.getByRole('navigation').getByRole('button', { name: 'Review', exact: true });
  await review.click();
  await expect(review).toHaveAttribute('aria-current', 'page');
  await page.waitForFunction(() => document.querySelector('.page-transition-scope')
    ?.getAnimations().some(animation => animation.playState === 'running'));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-swcc-motion-disabled'))).toBe(true);
  await expect.poll(() => page.locator('.page-transition-scope').evaluate(element =>
    element.getAnimations().every(animation => animation.playState !== 'running'))).toBe(true);
  expect(await page.locator('.page-transition-scope').evaluate(element => ({
    opacity: getComputedStyle(element).opacity,
    transform: getComputedStyle(element).transform,
  }))).toEqual({ opacity: '1', transform: 'none' });

  const assessment = page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true });
  await assessment.click();
  await expect(assessment).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Self-assessment', exact: true })).toBeVisible();
  expect(await page.locator('.page-transition-scope').evaluate(element =>
    element.getAnimations().some(animation => animation.playState === 'running'))).toBe(false);
  const marker = page.locator('.rail-selection-marker');
  const markerBox = await marker.boundingBox();
  const assessmentBox = await assessment.boundingBox();
  expect(markerBox).not.toBeNull();
  expect(assessmentBox).not.toBeNull();
  expect(Math.abs(markerBox!.y - assessmentBox!.y)).toBeLessThan(1);
});
