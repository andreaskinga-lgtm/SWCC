import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

let desktop: ElectronApplication;
let page: Page;
let root: string;

test.beforeEach(async () => {
  root = resolve('.work', `desktop-feedback-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  desktop = await electron.launch({
    executablePath: process.env.SWCC_PACKAGED_EXECUTABLE,
    args: [...(process.env.SWCC_PACKAGED_EXECUTABLE ? [] : ['.']), `--user-data-dir=${root}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
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

async function navigate(name: string) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}

async function addGoal(title: string) {
  await page.getByRole('button', { name: 'Add goal', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a learning goal' });
  await dialog.getByLabel('Goal title', { exact: true }).fill(title);
  await dialog.getByRole('button', { name: 'Add goal', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('explicit success and readiness feedback stay centered, accessible, and dismiss to their trigger', async () => {
  await page.evaluate(() => {
    const target = window as Window & { __swccMotionEvents?: string[] };
    target.__swccMotionEvents = [];
    document.addEventListener('animationstart', event => {
      target.__swccMotionEvents?.push(event.animationName);
    });
  });
  await navigate('Self-assessment');
  await page.getByLabel('Assessment date').fill('2024-06-01');
  await page.getByLabel('Strengths').fill('Listening and follow-up');
  await page.getByLabel('Learning needs and interests').fill('Reflective supervision');
  await page.getByRole('checkbox', { name: 'Code of Ethics', exact: true }).check();
  await addGoal('Deepen supervision');
  await page.setViewportSize({ width: 900, height: 480 });

  const completeAssessment = page.getByRole('button', { name: 'Complete Step 2', exact: true });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await completeAssessment.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await completeAssessment.click();

  const success = page.getByRole('dialog', { name: 'Step 2 completed' });
  await expect(success).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { __swccMotionEvents?: string[] })
    .__swccMotionEvents ?? [])).toContain('swcc-dialog-open');
  await expect.poll(() => page.evaluate(() => (window as Window & { __swccMotionEvents?: string[] })
    .__swccMotionEvents ?? [])).toContain('swcc-sprout-response');
  await expect(success.getByRole('status')).toContainText('manually confirmed');
  await page.waitForFunction(() => {
    const dialog = document.getElementById('action-feedback-title')?.closest('dialog');
    if (!dialog) return false;
    const bounds = dialog.getBoundingClientRect();
    return Math.abs(bounds.y + bounds.height / 2 - window.innerHeight / 2) < 0.5;
  }, null, { polling: 'raf' });
  const successBounds = await success.boundingBox();
  expect(successBounds).not.toBeNull();
  expect(successBounds!.y + successBounds!.height / 2).toBeCloseTo(240, 0);
  const close = success.getByRole('button', { name: 'Close feedback' });
  const ok = success.getByRole('button', { name: 'OK', exact: true });
  await close.focus();
  await page.keyboard.press('Tab');
  await expect(ok).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await ok.click();
  await expect(success).toBeHidden();
  await expect(completeAssessment).toBeFocused();

  await navigate('Development plan');
  const sproutStartsBeforeFailure = await page.evaluate(() => (window as Window & { __swccMotionEvents?: string[] })
    .__swccMotionEvents?.filter(name => name === 'swcc-sprout-response').length ?? 0);
  const completePlan = page.getByRole('button', { name: 'Complete Step 3', exact: true });
  await completePlan.scrollIntoViewIfNeeded();
  await completePlan.click();
  const failure = page.getByRole('dialog', { name: 'Step 3 is not ready' });
  expect(await page.evaluate(() => (window as Window & { __swccMotionEvents?: string[] })
    .__swccMotionEvents?.filter(name => name === 'swcc-sprout-response').length ?? 0)).toBe(sproutStartsBeforeFailure);
  await expect(failure.getByRole('list', { name: 'Step 3 readiness reasons' }).getByRole('listitem'))
    .toHaveText(['G1 needs completed supporting work.']);
  await failure.getByText('This step is not ready for manual completion.').click();
  await expect(failure).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(failure).toBeHidden();
  await expect(completePlan).toBeFocused();

  await completePlan.click();
  await expect(failure).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(failure).toBeHidden();
  await expect(completePlan).toBeFocused();
});

test('every development-plan reason remains separately readable in a constrained, scrollable feedback modal', async () => {
  await page.evaluate(async () => {
    const state = await window.swcc.getState();
    if (!state.ok || !state.value.selectedPackage) throw new Error('No selected package');
    let pkg = state.value.selectedPackage;
    for (let index = 1; index <= 18; index++) {
      const goalResult = await window.swcc.createGoal({
        packageId: pkg.id, expectedRevision: pkg.contentRevision, title: `Learning goal ${index}`,
      });
      if (!goalResult.ok) throw new Error(goalResult.error.message);
      pkg = goalResult.value;
      const goal = pkg.goals.at(-1)!;
      const activityResult = await window.swcc.createActivity({
        packageId: pkg.id, expectedRevision: pkg.contentRevision, title: `Planned activity ${index}`, goalIds: [goal.id],
      });
      if (!activityResult.ok) throw new Error(activityResult.error.message);
      pkg = activityResult.value;
    }
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Year overview' })).toBeVisible();
  await navigate('Development plan');
  await page.setViewportSize({ width: 520, height: 300 });
  const completePlan = page.getByRole('button', { name: 'Complete Step 3', exact: true });
  await completePlan.scrollIntoViewIfNeeded();
  await completePlan.click();

  const feedback = page.getByRole('dialog', { name: 'Step 3 is not ready' });
  const list = feedback.getByRole('list', { name: 'Step 3 readiness reasons' });
  const items = list.getByRole('listitem');
  await expect(items).toHaveCount(72);
  await expect(items.first()).toHaveText('G1 needs completed supporting work.');
  await expect(items.nth(18)).toHaveText('A1 must be Completed.');
  await expect(items.nth(19)).toHaveText('A1 needs evidence notes, a valid link, or a readable evidence file.');
  await expect(items.nth(20)).toHaveText('A1 needs an application-to-practice reflection.');
  await expect(items.last()).toHaveText('A18 needs an application-to-practice reflection.');

  const content = feedback.locator('.action-feedback-content');
  const dimensions = await content.evaluate(element => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  const bounds = await feedback.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.width).toBeLessThanOrEqual(520);
  expect(bounds!.height).toBeLessThanOrEqual(300);

  await items.first().click();
  await expect(feedback).toBeVisible();
  await content.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(feedback.getByRole('button', { name: 'OK', exact: true })).toBeInViewport({ ratio: 1 });
  await feedback.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(feedback).toBeHidden();
  await expect(completePlan).toBeFocused();
});
