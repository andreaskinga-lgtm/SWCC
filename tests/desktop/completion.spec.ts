import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

let desktop: ElectronApplication;
let page: Page;
let root: string;
async function launch(timezone = 'America/Toronto') {
  desktop = await electron.launch({
    executablePath: process.env.SWCC_PACKAGED_EXECUTABLE,
    args: [...(process.env.SWCC_PACKAGED_EXECUTABLE ? [] : ['.']), `--user-data-dir=${root}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', TZ: timezone },
  });
  page = await desktop.firstWindow();
  await page.context().setOffline(true);
  expect(page.url()).toMatch(/^file:/);
}
test.beforeEach(async () => {
  root = resolve('.work', `desktop-completion-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  await launch();
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
async function preparePlan() {
  await navigate('Self-assessment');
  await page.getByLabel('Assessment date').fill('2024-01-20');
  await page.getByLabel('Strengths').fill('Listening and follow-up');
  await page.getByLabel('Learning needs and interests').fill('Reflective supervision');
  await page.getByRole('checkbox', { name: 'Code of Ethics', exact: true }).check();
  await page.getByRole('button', { name: 'Add goal', exact: true }).click();
  const goal = page.getByRole('dialog', { name: 'Add a learning goal' });
  await goal.getByLabel('Goal title', { exact: true }).fill('Deepen supervision');
  await goal.getByRole('button', { name: 'Add goal', exact: true }).click();
  await expect(goal).not.toBeVisible();
  await navigate('Year overview');
  await page.getByRole('button', { name: 'Record an activity', exact: true }).click();
  const activity = page.getByRole('dialog', { name: 'Record an activity' });
  await activity.getByLabel('Activity title', { exact: true }).fill('Peer consultation');
  await activity.getByRole('checkbox', { name: 'G1 Deepen supervision' }).check();
  await activity.getByRole('button', { name: 'Save activity', exact: true }).click();
  await expect(activity).not.toBeVisible();
  await page.getByLabel('Plan date').fill('2024-02-01');
  await page.getByLabel('Completion date', { exact: true }).fill('2024-03-01');
  await page.getByLabel('Activity status').selectOption('Completed');
  await page.getByLabel('Evidence notes').fill('Consultation notes retained');
  await page.getByLabel('Application to practice', { exact: true }).fill('Use reflective questions in supervision');
}
async function selectedPackage() {
  return page.evaluate(async () => {
    const result = await window.swcc.getState();
    if (!result.ok || !result.value.selectedPackage) throw new Error('No selected package');
    return result.value.selectedPackage;
  });
}
function storageFailure(action: string) {
  const executable = createRequire(import.meta.url)('electron') as string;
  const result = spawnSync(executable, ['tests/desktop/storage-fixture.mjs', resolve(root, 'dataset/database.sqlite'), action], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
}
async function readPage(number: number) {
  await desktop.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true });
    BrowserWindow.getAllWindows()[0].show();
    BrowserWindow.getAllWindows()[0].focus();
  });
  await page.getByLabel('Physical PDF page', { exact: true }).fill(String(number));
  await page.getByLabel('Physical PDF page', { exact: true }).press('Enter');
  await expect(page.getByRole('img', { name: `Supplied Code of Ethics, physical page ${number}`, exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const state = await window.swcc.getState();
    if (!state.ok || !state.value.selectedPackage) throw new Error('No package');
    const review = await window.swcc.getReview(state.value.selectedPackage.id);
    if (!review.ok) throw new Error(review.error.message);
    return review.value.visitedPages;
  })).toContain(number);
}

test('keyboard manual completion works in any order beside C’s map; historical entry warns and survives restart', async () => {
  await preparePlan();
  await expect(page.getByRole('status', { name: 'Step 3 readiness' })).toHaveText('Ready');
  const complete = page.getByRole('button', { name: 'Complete Step 3', exact: true });
  await complete.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Step 3 readiness' })).toHaveText('Completed');
  await navigate('Year overview');
  const workflow = page.getByRole('complementary', { name: 'Annual workflow' });
  await expect(workflow.getByRole('status', { name: 'Step 1 readiness' })).not.toHaveText('Completed');
  await expect(workflow.getByRole('status', { name: 'Step 2 readiness' })).toHaveText('Ready');
  await expect(workflow.getByRole('status', { name: 'Step 3 readiness' })).toHaveText('Completed');
  await workflow.getByRole('button', { name: 'Complete Step 2', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(workflow.getByRole('status', { name: 'Step 2 readiness' })).toHaveText('Completed');
  await workflow.getByRole('button', { name: 'Record submission date', exact: true }).click();
  const declaration = page.getByRole('dialog', { name: 'Record external submission date' });
  await expect(declaration.getByRole('alert')).toContainText('application steps are incomplete');
  await expect(declaration).toContainText('does not submit or verify');
  await declaration.getByLabel('Actual external submission date').fill('2024-12-20');
  await declaration.getByRole('button', { name: 'Record submission date', exact: true }).click();
  await expect(workflow).toContainText('Submission date recorded: 2024-12-20');
  await expect(page.getByRole('status', { name: 'Annual package status' })).toHaveText('In Progress');
  await workflow.getByRole('button', { name: 'Export Forms PDF' }).click();
  await expect(page.getByRole('dialog', { name: 'Export annual forms' })).toContainText('separate Complete Portfolio ZIP action');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const composition = await page.locator('.map-overview').evaluate(element => {
    const board = element.querySelector('.relationship-board')!.getBoundingClientRect();
    const checklist = element.querySelector('.map-checklist')!.getBoundingClientRect();
    return { adjacent: board.right <= checklist.left, topDifference: Math.abs(board.top - checklist.top) };
  });
  expect(composition.adjacent).toBe(true);
  expect(composition.topDifference).toBeLessThan(10);
  await desktop.close();
  await launch('Pacific/Honolulu');
  await expect(page.getByRole('complementary', { name: 'Annual workflow' })).toContainText('Submission date recorded: 2024-12-20');
  await navigate('All years');
  await expect(page.locator('.year-list')).toContainText('In Progress');
});

test('completed review survives real rereading; current manual confirmations plus a declaration alone make a year Complete', async () => {
  test.setTimeout(90_000);
  await preparePlan();
  await page.getByRole('button', { name: 'Complete Step 3', exact: true }).click();
  await navigate('Year overview');
  await page.getByRole('button', { name: 'Complete Step 2', exact: true }).click();
  await navigate('Review');
  for (const number of [2, 4, 7, 8, ...Array.from({ length: 32 }, (_, index) => index + 9), 48]) await readPage(number);
  await desktop.evaluate(({ shell }) => { shell.openExternal = async () => {}; });
  await page.getByRole('button', { name: 'Open resources', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Step 1 readiness' })).toHaveText('Ready');
  await page.getByRole('button', { name: 'Complete Step 1', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Step 1 readiness' })).toHaveText('Completed');
  const confirmed = (await selectedPackage()).stepCompletions.review;
  await readPage(2);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await navigate('Year overview');
  await expect(page.getByRole('status', { name: 'Step 1 readiness' })).toHaveText('Completed');
  expect((await selectedPackage()).stepCompletions.review).toEqual(confirmed);
  await expect(page.getByRole('status', { name: 'Annual package status' })).toHaveText('In Progress');
  await page.getByRole('button', { name: 'Record submission date', exact: true }).click();
  const declaration = page.getByRole('dialog', { name: 'Record external submission date' });
  await expect(declaration.getByRole('alert')).toHaveCount(0);
  await declaration.getByLabel('Actual external submission date').fill('2024-12-20');
  await declaration.getByRole('button', { name: 'Record submission date', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Annual package status' })).toHaveText('Complete');
  const recorded = await selectedPackage();
  await navigate('Review');
  await page.getByRole('button', { name: 'Reset Meaning of Client', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Step 1 readiness' })).not.toHaveText('Completed');
  storageFailure('review-fail');
  await page.getByLabel('Physical PDF page', { exact: true }).fill('4');
  await page.getByLabel('Physical PDF page', { exact: true }).press('Enter');
  await expect(page.getByRole('alert')).toContainText('disk full');
  await page.getByRole('button', { name: 'Complete Step 1', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  expect((await selectedPackage()).stepCompletions.review).toEqual(confirmed);
  storageFailure('review-repair');
  await page.getByRole('button', { name: 'Retry review save', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Step 1 readiness' })).toHaveText('Ready');
  await page.getByRole('button', { name: 'Complete Step 1', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Step 1 readiness' })).toHaveText('Completed');
  await navigate('All years');
  await expect(page.locator('.year-list')).toContainText('Complete');
  await page.getByLabel('New package year').fill('2025');
  await page.getByLabel('New package year').press('Enter');
  await expect(page.getByRole('status', { name: 'Annual package status' })).toHaveText('Draft');
  await expect(page.getByRole('complementary', { name: 'Annual workflow' })).not.toContainText('2024-12-20');
  await page.getByLabel('Year package').selectOption({ label: '2024' });
  await expect(page.getByRole('status', { name: 'Annual package status' })).toHaveText('Complete');
  await navigate('Development plan');
  await page.getByLabel('Application to practice', { exact: true }).fill('A later, still substantive reflection');
  await navigate('Year overview');
  await expect(page.getByRole('status', { name: 'Step 3 readiness' })).toHaveText('Ready');
  await expect(page.getByRole('status', { name: 'Step 1 readiness' })).toHaveText('Completed');
  await expect(page.getByRole('status', { name: 'Step 2 readiness' })).toHaveText('Completed');
  await expect(page.getByRole('status', { name: 'Annual package status' })).toHaveText('In Progress');
  await page.setViewportSize({ width: 620, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Complete Step 3', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Annual package status' })).toHaveText('Complete');
  expect(await selectedPackage()).toMatchObject({
    declarationDate: recorded.declarationDate, declarationRecordedAt: recorded.declarationRecordedAt,
  });
  await desktop.close();
  await launch();
  await expect(page.getByRole('status', { name: 'Annual package status' })).toHaveText('Complete');
  await navigate('All years');
  const rows = page.locator('.year-list li');
  await expect(rows.first()).toContainText('2025');
  await expect(rows.first()).toContainText('Draft');
  await expect(rows.last()).toContainText('Complete');
});

test('failed draft flush leaves confirmation unchanged and edits visible until retry and renewed manual completion', async () => {
  await preparePlan();
  await navigate('Self-assessment');
  await page.getByRole('button', { name: 'Complete Step 2', exact: true }).click();
  const confirmed = (await selectedPackage()).stepCompletions.assessment;
  storageFailure('true');
  await page.getByLabel('Strengths').fill('Unsaved but still substantive strengths');
  await page.getByRole('button', { name: 'Complete Step 2', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('disk full');
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await expect(page.getByLabel('Strengths')).toHaveValue('Unsaved but still substantive strengths');
  expect((await selectedPackage()).stepCompletions.assessment).toEqual(confirmed);
  expect((await selectedPackage()).strengths).toBe('Listening and follow-up');
  storageFailure('false');
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Step 2 readiness' })).toHaveText('Ready');
  await page.getByRole('button', { name: 'Complete Step 2', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Step 2 readiness' })).toHaveText('Completed');
  expect((await selectedPackage()).stepCompletions.assessment.completedAt).not.toBe(confirmed.completedAt);
});

test('unready completion remains actionable and explains missing items without locking other steps', async () => {
  await page.getByRole('button', { name: 'Complete Step 3', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Add at least one learning goal.');
  expect((await selectedPackage()).stepCompletions.plan.completedAt).toBeNull();
  await expect(page.getByRole('button', { name: 'Complete Step 2', exact: true })).toBeEnabled();
  await navigate('Self-assessment');
  await expect(page.getByLabel('Strengths')).toBeVisible();
  await page.getByRole('button', { name: 'Complete Step 2', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Add your strengths.');
});
