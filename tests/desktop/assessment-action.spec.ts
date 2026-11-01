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
  await expect(page.getByRole('heading', { name: 'Reflect on your practice.' })).toBeVisible();
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
