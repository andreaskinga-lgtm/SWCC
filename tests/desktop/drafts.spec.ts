import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const electronExecutable = createRequire(import.meta.url)('electron') as string;

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
  await page.getByLabel('Plan date').fill('2023-12-30');
  await expect(page.getByText('This date is outside 2024.')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  await page.getByRole('button', { name: 'All years', exact: true }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
  await expect(page.getByRole('alert')).toContainText('already has a package');
  await page.getByRole('button', { name: 'Open existing package' }).click();
  await desktop.close();
  await launch('Pacific/Honolulu');
  await expect(page.getByRole('button', { name: 'I understand' })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await expect(page.getByLabel('Strengths')).toHaveValue('Café practice — unfinished reflection');
  await expect(page.getByLabel('Assessment date')).toHaveValue('2024-02-29');
  await expect(page.getByLabel('Plan date')).toHaveValue('2023-12-30');
  await page.setViewportSize({ width: 620, height: 800 });
  await page.getByRole('button', { name: 'All years', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('New package year')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(remoteRequests).toEqual([]);
});

function failWrites(enabled: boolean) {
  const fixture = spawnSync(electronExecutable, ['tests/desktop/storage-fixture.mjs', resolve(root, 'dataset/database.sqlite'), String(enabled)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
  });
  if (fixture.status !== 0) throw new Error(fixture.stderr);
}
test('failed autosave keeps edits visible and blocks navigation and close until a retry succeeds', async () => {
  await page.getByLabel('New package year').press('Enter');
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await failWrites(true);
  await page.getByLabel('Strengths').fill('Do not discard this');
  await expect(page.getByRole('alert')).toContainText('disk full');
  await expect(page.getByRole('status', { name: 'Save status' })).not.toHaveText('Saved');
  await page.getByRole('button', { name: 'All years', exact: true }).click();
  await expect(page.getByLabel('Strengths')).toHaveValue('Do not discard this');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect(page.getByRole('alert')).toContainText('disk full');
  expect(await desktop.windows()).toHaveLength(1);
  await desktop.evaluate(({ app }) => app.quit());
  await expect(page.getByRole('status', { name: 'Save status' })).not.toHaveText('Saved');
  expect(desktop.windows()).toHaveLength(1);
  await failWrites(false);
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  await page.getByRole('button', { name: 'All years', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your year packages' })).toBeVisible();
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
  ], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, stdio: 'ignore' });
  const status = await new Promise<number | null>((resolve, reject) => { second.once('exit', resolve); second.once('error', reject); });
  expect(status).toBe(0);
  expect(desktop.windows()).toHaveLength(1);
  await expect(page.getByLabel('New package year')).toBeVisible();
});
