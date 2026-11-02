import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dismissActionFeedback, expectActionFeedback } from './feedback-helpers.js';
import { desktopEnvironment } from './environment.js';

const electronExecutable = createRequire(import.meta.url)('electron') as string;

let desktop: ElectronApplication;
let page: Page;
let root: string;
async function launch(timezone = 'America/Toronto') {
  desktop = await electron.launch({
    executablePath: process.env.SWCC_PACKAGED_EXECUTABLE,
    args: [...(process.env.SWCC_PACKAGED_EXECUTABLE ? [] : ['.']), `--user-data-dir=${root}`],
    env: desktopEnvironment({ TZ: timezone }),
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
  root = resolve('.work', `desktop-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  await launch();
});
test.afterEach(async () => {
  await desktop?.close();
  rmSync(root, { recursive: true, force: true });
});

test('keyboard creation, duplicate recovery and autosaved dates survive production restart offline', async () => {
  const remoteRequests: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); });
  await expect(page.getByRole('heading', { name: 'Your year packages' })).toBeVisible();
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await page.getByLabel('Strengths').fill('Café practice — unfinished reflection');
  await page.getByLabel('Assessment date').fill('2024-02-29');
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  await page.getByRole('navigation').getByRole('button', { name: 'Development plan', exact: true }).click();
  await page.getByLabel('Plan date').fill('2023-12-30');
  await expect(page.getByText('This date is outside 2024.')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  await page.getByRole('button', { name: 'All years', exact: true }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
  const duplicate = page.getByRole('dialog', { name: 'Year package already exists' });
  await expect(duplicate.getByRole('alert')).toContainText('already has a package');
  await duplicate.getByRole('button', { name: 'Open existing package' }).click();
  await expect(duplicate).toBeHidden();
  await desktop.close();
  await launch('Pacific/Honolulu');
  await expect(page.getByRole('button', { name: 'I understand' })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await expect(page.getByLabel('Strengths')).toHaveValue('Café practice — unfinished reflection');
  await expect(page.getByLabel('Assessment date')).toHaveValue('2024-02-29');
  await page.getByRole('navigation').getByRole('button', { name: 'Development plan', exact: true }).click();
  await expect(page.getByLabel('Plan date')).toHaveValue('2023-12-30');
  await page.setViewportSize({ width: 620, height: 800 });
  await page.getByRole('button', { name: 'All years', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('New package year')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(remoteRequests).toEqual([]);
});

test('plain page headings replace slogans while useful prompts and warnings remain', async () => {
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');

  for (const name of ['Year overview', 'Self-assessment', 'Development plan', 'Backup and restore']) {
    await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name, level: 1, exact: true })).toBeVisible();
    await expect(page.locator('.page-heading p')).toHaveCount(0);
  }
  await expect(page.getByRole('main')).toContainText('Backups are not encrypted');
  await expect(page.getByRole('main')).toContainText('It does not merge them');

  await page.getByRole('navigation').getByRole('button', { name: 'Development plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No activities yet', exact: true })).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Select Add activity');
  await page.getByRole('button', { name: 'Add activity', exact: true }).click();
  const activity = page.getByRole('dialog', { name: 'Record an activity', exact: true });
  await expect(activity.getByLabel('Activity title', { exact: true })).toBeVisible();
  await expect(activity.getByRole('group', { name: 'Linked goals (optional)' })).toBeVisible();
  await expect(activity).not.toContainText('Record it once');
  await activity.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await expect(page.getByRole('main')).toContainText('What are you doing well in your practice?');
  await expect(page.getByRole('list', { name: 'Step 2 missing items' })).toContainText('Add your strengths');

  await page.getByRole('navigation').getByRole('button', { name: 'Year overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Annual progress', exact: true })).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('Close the annual loop');
  await expect(page.getByRole('main')).not.toContainText('Work freely. Complete deliberately.');
  await expect(page.locator('.board-footer')).toHaveCount(0);
  await page.getByRole('button', { name: 'Export Forms PDF', exact: true }).click();
  const forms = page.getByRole('dialog', { name: 'Export annual forms', exact: true });
  await expect(forms).toContainText('Evidence files are not included');
  await expect(forms).toContainText('not a restorable full-app backup');
  await expect(forms.getByRole('button', { name: 'Export draft PDF', exact: true })).toBeEnabled();
  await forms.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.getByRole('navigation').getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Standards review', level: 1, exact: true })).toBeVisible();
  await expect(page.locator('.page-heading')).toContainText('Code of Ethics and Standards of Practice');
});

function failWrites(enabled: boolean) {
  const fixture = spawnSync(electronExecutable, ['tests/desktop/storage-fixture.mjs', resolve(root, 'dataset/database.sqlite'), String(enabled)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
  });
  if (fixture.status !== 0) throw new Error(fixture.stderr);
}
test('failed autosave reports once until a successful retry persists retained edits', async () => {
  await page.getByLabel('New package year').press('Enter');
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await failWrites(true);
  await page.getByLabel('Strengths').fill('Do not discard this');
  const firstFailure = await expectActionFeedback(page, 'disk full');
  await expect(firstFailure.getByRole('alert')).toContainText('disk full');
  await dismissActionFeedback(page);
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
  await page.getByLabel('Strengths').fill('Keep the latest retained edit');
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await expect(page.locator('.action-feedback-dialog')).toBeHidden();
  await page.getByRole('button', { name: 'All years', exact: true }).click();
  await expect(page.getByLabel('Strengths')).toHaveValue('Keep the latest retained edit');
  await expect(page.locator('.action-feedback-dialog')).toBeHidden();
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect(page.getByRole('alert')).toContainText('disk full');
  await expect(page.locator('.action-feedback-dialog')).toBeHidden();
  expect(await desktop.windows()).toHaveLength(1);
  await desktop.evaluate(({ app }) => app.quit());
  await expect(page.getByRole('status', { name: 'Save status' })).not.toHaveText('Saved');
  await expect(page.locator('.action-feedback-dialog')).toBeHidden();
  expect(desktop.windows()).toHaveLength(1);
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expectActionFeedback(page, 'disk full');
  await dismissActionFeedback(page);
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await failWrites(false);
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  await expect(page.locator('.action-feedback-dialog')).toBeHidden();

  await failWrites(true);
  await page.getByLabel('Learning needs and interests').fill('A distinct failure after recovery');
  await expectActionFeedback(page, 'disk full');
  await dismissActionFeedback(page);
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  await failWrites(false);
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');

  await desktop.close();
  await launch();
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await expect(page.getByLabel('Strengths')).toHaveValue('Keep the latest retained edit');
  await expect(page.getByLabel('Learning needs and interests')).toHaveValue('A distinct failure after recovery');
});

test('closing immediately after typing flushes the pending draft before the process exits', async () => {
  await page.getByLabel('New package year').press('Enter');
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await page.getByLabel('Learning needs and interests').fill('A last-second edit');
  const closed = desktop.waitForEvent('close');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  await launch();
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await expect(page.getByLabel('Learning needs and interests')).toHaveValue('A last-second edit');
});

test('keystrokes during a real SQLite busy write remain visible and are saved in order', async () => {
  await page.getByLabel('New package year').press('Enter');
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  const lock = spawn(electronExecutable, ['tests/desktop/storage-fixture.mjs', resolve(root, 'dataset/database.sqlite'), 'lock'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    lock.stdout.once('data', () => resolve());
    lock.once('error', reject);
  });
  await page.getByLabel('Strengths').fill('First snapshot');
  await page.waitForTimeout(600);
  await page.getByLabel('Strengths').fill('Latest typing while Saving');
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  await desktop.close();
  await launch();
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await expect(page.getByLabel('Strengths')).toHaveValue('Latest typing while Saving');
});

test('a second launch of the same OS-user dataset exits without creating a competing window', async () => {
  const second = spawn(process.env.SWCC_PACKAGED_EXECUTABLE || electronExecutable, [
    ...(process.env.SWCC_PACKAGED_EXECUTABLE ? [] : ['.']), `--user-data-dir=${root}`,
  ], { env: desktopEnvironment(), stdio: 'ignore' });
  const status = await new Promise<number | null>((resolve, reject) => { second.once('exit', resolve); second.once('error', reject); });
  expect(status).toBe(0);
  expect(desktop.windows()).toHaveLength(1);
  await expect(page.getByLabel('New package year')).toBeVisible();
});

for (const viewport of [
  { name: 'wide', width: 1280, height: 800 },
  { name: 'narrow', width: 620, height: 800 },
  { name: 'short', width: 1280, height: 380 },
  { name: 'narrow and short', width: 620, height: 260 },
]) {
  test(`portfolio navigation stays anchored and independently reachable in a ${viewport.name} window`, async () => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.getByRole('button', { name: 'I understand' }).click();
    await page.evaluate(async () => {
      const created = await window.swcc.createYear(2024);
      if (!created.ok) throw new Error(created.error.message);
      let pkg = created.value;
      for (let index = 1; index <= 12; index++) {
        const result = await window.swcc.createGoal({
          packageId: pkg.id, expectedRevision: pkg.contentRevision,
          title: `Learning goal ${index}`, description: 'Develop reflective practice through regular consultation.',
        });
        if (!result.ok) throw new Error(result.error.message);
        pkg = result.value;
      }
      for (let year = 2023; year >= 2012; year--) {
        const result = await window.swcc.createYear(year);
        if (!result.ok) throw new Error(result.error.message);
      }
      const opened = await window.swcc.openYear(pkg.id);
      if (!opened.ok) throw new Error(opened.error.message);
    });
    await page.reload();
    await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
    await expect(page.getByLabel('Goal title G12')).toHaveValue('Learning goal 12');
    await page.evaluate(() => window.scrollTo(0, 0));
    const rail = page.getByRole('complementary', { name: 'Portfolio navigation' });
    const initialRail = await rail.boundingBox();
    expect(initialRail).not.toBeNull();
    const main = await page.getByRole('main').boundingBox();
    expect(main).not.toBeNull();
    if (viewport.width < 700) {
      expect(main!.y).toBeGreaterThanOrEqual(initialRail!.y + initialRail!.height);
      const first = await page.getByRole('navigation').getByRole('button', { name: 'Year overview', exact: true }).boundingBox();
      const third = await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).boundingBox();
      const fourth = await page.getByRole('navigation').getByRole('button', { name: 'Development plan', exact: true }).boundingBox();
      expect(third!.y).toBeCloseTo(first!.y, 0);
      expect(fourth!.y).toBeGreaterThan(first!.y);
    } else {
      expect(main!.x).toBeGreaterThanOrEqual(initialRail!.x + initialRail!.width);
      if (viewport.height >= 400) {
        const allYears = await page.getByRole('navigation').getByRole('button', { name: 'All years', exact: true }).boundingBox();
        const backup = await page.getByRole('navigation').getByRole('button', { name: 'Backup and restore', exact: true }).boundingBox();
        expect(backup!.y + backup!.height).toBeGreaterThan(viewport.height - 40);
        expect(backup!.y - (allYears!.y + allYears!.height)).toBeLessThanOrEqual(20);
      }
    }
    await page.mouse.move(viewport.width - 100, viewport.height - 30);
    await page.mouse.wheel(0, 1200);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(1000);
    const scrolledRail = await rail.boundingBox();
    expect(scrolledRail).not.toBeNull();
    expect(scrolledRail!.y).toBeCloseTo(initialRail!.y, 0);
    expect(scrolledRail!.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.getByRole('banner')).not.toBeInViewport();
    const destinations = [
      { name: 'Year overview', heading: 'Year overview' },
      { name: 'Review', heading: 'Standards review' },
      { name: 'Self-assessment', heading: 'Self-assessment' },
      { name: 'Development plan', heading: 'Development plan' },
      { name: 'All years', heading: 'Your year packages' },
      { name: 'Backup and restore', heading: 'Backup and restore' },
    ];
    const documentScroll = await page.evaluate(() => window.scrollY);
    if (viewport.height < 400) {
      await page.mouse.move(scrolledRail!.width / 2, scrolledRail!.height / 2);
      await page.mouse.wheel(0, 1200);
      await expect(page.getByRole('navigation').getByRole('button', { name: 'Backup and restore', exact: true })).toBeInViewport({ ratio: 1 });
      expect(await rail.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(documentScroll);
    }
    await page.getByRole('navigation').getByRole('button', { name: 'Year overview', exact: true }).focus();
    for (let index = 0; index < destinations.length; index++) {
      if (index > 0) await page.keyboard.press('Tab');
      const action = page.getByRole('navigation').getByRole('button', { name: destinations[index].name, exact: true });
      await expect(action).toBeFocused();
      await expect(action).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => window.scrollY)).toBe(documentScroll);
    }
    await page.keyboard.press('Tab');
    const yearPicker = page.getByRole('combobox', { name: 'Year package', exact: true });
    await expect(yearPicker).toBeFocused();
    await expect(yearPicker).toBeInViewport({ ratio: 1 });
    const focused = await yearPicker.boundingBox();
    if (viewport.width < 700) expect(focused!.y).toBeGreaterThanOrEqual(scrolledRail!.height);
    else expect(focused!.x).toBeGreaterThanOrEqual(scrolledRail!.width);
    const narratives = ['Strengths', 'Peer feedback', 'Learning needs and interests'];
    for (let index = 0; index < narratives.length; index++) {
      const narrative = page.getByRole('textbox', { name: narratives[index], exact: true });
      if (index === 0) await narrative.focus();
      else await page.keyboard.press('Tab');
      await expect(narrative).toBeFocused();
      await expect(narrative).toBeInViewport();
      if (viewport.width < 700 && viewport.height < 400) {
        await page.keyboard.insertText('Reflect on learning and its application to practice.\n'.repeat(8));
        await expect(narrative).toBeInViewport({ ratio: 1 });
      }
      const focusedNarrative = await narrative.boundingBox();
      if (viewport.width < 700) expect(focusedNarrative!.y).toBeGreaterThanOrEqual(scrolledRail!.height);
      else expect(focusedNarrative!.x).toBeGreaterThanOrEqual(scrolledRail!.width);
    }
    const standard = page.getByRole('checkbox', { name: 'Code of Ethics', exact: true });
    await standard.focus();
    await expect(standard).toBeInViewport({ ratio: 1 });
    const focusedStandard = await standard.boundingBox();
    if (viewport.width < 700) expect(focusedStandard!.y).toBeGreaterThanOrEqual(scrolledRail!.height);
    else expect(focusedStandard!.x).toBeGreaterThanOrEqual(scrolledRail!.width);
    for (const destination of destinations) {
      const nextScroll = await page.evaluate(() =>
        Math.min(window.scrollY + 1200, document.documentElement.scrollHeight - window.innerHeight));
      await page.mouse.move(viewport.width - 100, viewport.height - 30);
      await page.mouse.wheel(0, 1200);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(nextScroll);
      expect(nextScroll).toBeGreaterThan(0);
      const beforeNavigation = await page.evaluate(() => window.scrollY);
      const action = page.getByRole('navigation').getByRole('button', { name: destination.name, exact: true });
      await action.scrollIntoViewIfNeeded();
      await expect(action).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => window.scrollY)).toBe(beforeNavigation);
      await action.click();
      await expect(action).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('heading', { name: destination.heading, exact: true })).toBeVisible();
      const currentRail = await rail.boundingBox();
      expect(currentRail!.y).toBeCloseTo(initialRail!.y, 0);
      expect(currentRail!.height).toBeLessThanOrEqual(viewport.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
    await expect(page.getByLabel('Goal title G12')).toHaveValue('Learning goal 12');
  });
}
