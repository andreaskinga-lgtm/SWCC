import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dismissActionFeedback, expectActionFeedback } from './feedback-helpers.js';

let desktop: ElectronApplication;
let page: Page;
let root: string;
let assetErrors: string[];
async function launch() {
  desktop = await electron.launch({
    executablePath: process.env.SWCC_PACKAGED_EXECUTABLE,
    args: [...(process.env.SWCC_PACKAGED_EXECUTABLE ? [] : ['.']), `--user-data-dir=${root}`],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  page = await desktop.firstWindow();
  assetErrors = [];
  page.on('console', message => {
    if (/Warning:.*(font|CMap|fetch)|Unable to load|Setting up fake worker/i.test(message.text())) assetErrors.push(message.text());
  });
  page.on('requestfailed', request => { if (/pdf-assets|pdf\.worker/.test(request.url())) assetErrors.push(request.failure()?.errorText ?? request.url()); });
  await page.context().setOffline(true);
  const runtime = await desktop.evaluate(({ app, BrowserWindow }) => ({
    packaged: app.isPackaged, url: BrowserWindow.getAllWindows()[0].webContents.getURL(), storage: app.getPath('userData'),
  }));
  expect(runtime.packaged).toBe(Boolean(process.env.SWCC_PACKAGED_EXECUTABLE));
  expect(runtime.url).toMatch(/^file:/);
  expect(runtime.storage).toBe(root);
  await activate();
}
async function activate() {
  await desktop.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true });
    const reader = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:'))!;
    reader.show();
    reader.focus();
  });
}
test.beforeEach(async () => {
  root = resolve('.work', `review-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  await launch();
  await page.getByRole('button', { name: 'I understand' }).click();
  await expect(page.getByRole('button', { name: 'Create year package', exact: true })).toBeEnabled();
  await page.getByLabel('New package year').fill('2026');
  await page.getByLabel('New package year').press('Enter');
  await expect(page.getByRole('heading', { name: 'Connect learning to practice.' })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Review', exact: true }).click();
});
test.afterEach(async () => {
  await desktop?.close();
  rmSync(root, { recursive: true, force: true });
  expect(assetErrors).toEqual([]);
});
async function review() {
  return page.evaluate(async () => {
    const state = await window.swcc.getState();
    if (!state.ok || !state.value.selectedPackage) throw new Error('No selected year');
    const result = await window.swcc.getReview(state.value.selectedPackage.id);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
}
async function goTo(number: number, active = true) {
  if (active) await activate();
  await page.getByLabel('Physical PDF page', { exact: true }).fill(String(number));
  await page.getByLabel('Physical PDF page', { exact: true }).press('Enter');
  await expect(page.getByRole('img', { name: `Supplied Code of Ethics, physical page ${number}`, exact: true })).toBeVisible();
}
for (const rejected of [false, true]) test(`reader activation ${rejected ? 'rejection' : 'failed Result'} is visible and retry resumes actual viewport tracking`, async () => {
  await desktop.evaluate(({ ipcMain }, rejectQuery) => {
    ipcMain.removeHandler('swcc:reader-active');
    ipcMain.handle('swcc:reader-active', () => {
      if (rejectQuery) throw new Error('activation connection interrupted');
      return { ok: false, error: { code: 'IPC', message: 'activation connection interrupted' } };
    });
  }, rejected);
  await goTo(4, false);
  await expect(page.getByRole('alert')).toContainText(rejected ? 'The desktop connection failed' : 'activation connection interrupted');
  expect((await review()).visitedPages).not.toContain(4);
  await desktop.evaluate(({ ipcMain, BrowserWindow }) => {
    ipcMain.removeHandler('swcc:reader-active');
    ipcMain.handle('swcc:reader-active', () => ({ ok: true, value: BrowserWindow.getAllWindows()[0].isFocused() }));
  });
  await page.getByRole('button', { name: 'Retry review tracking', exact: true }).click();
  await expect.poll(async () => (await review()).visitedPages).toContain(4);
  await expect(page.getByRole('button', { name: 'Retry review tracking', exact: true })).toHaveCount(0);
});

test('local real PDF display checks only visited pages; jumps, years and restart retain honest progress', async () => {
  const remoteRequests: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); });
  await expect(page.getByRole('img', { name: 'Supplied Code of Ethics, physical page 1', exact: true })).toBeVisible();
  expect(page.workers().some(worker => /^file:.*pdf\.worker/.test(worker.url()))).toBe(true);
  expect(await page.locator('canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100) dark++;
    }
    return dark;
  })).toBeGreaterThan(1000);
  await goTo(11);
  await expect.poll(async () => (await review()).visitedPages).toContain(11);
  expect((await review()).readiness.sections.find(section => section.id === 'principle-ii')?.checked).toBe(false);
  await goTo(15);
  await expect.poll(async () => (await review()).visitedPages).toContain(15);
  expect((await review()).visitedPages).not.toContain(12);
  for (const number of [12, 13, 14]) {
    await goTo(number);
    await expect.poll(async () => (await review()).visitedPages).toContain(number);
  }
  await expect(page.getByRole('button', { name: 'Reset Principle II: Competence and Integrity', exact: true })).toBeVisible();
  await goTo(48);
  await expect(page.getByRole('button', { name: 'Open resources', exact: true })).toBeVisible();
  expect((await review()).readiness.ready).toBe(false);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(async () => (await review()).zoom).toBe(125);
  await page.getByRole('button', { name: 'All years', exact: true }).click();
  await page.getByLabel('New package year').fill('2025');
  await page.getByLabel('New package year').press('Enter');
  await page.getByRole('navigation').getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Supplied Code of Ethics, physical page 1', exact: true })).toBeVisible();
  expect((await review()).visitedPages).not.toContain(48);
  await page.getByLabel('Year package').selectOption({ label: '2026' });
  await page.getByRole('navigation').getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByLabel('Physical PDF page', { exact: true })).toHaveValue('48');
  await desktop.close();
  await launch();
  await page.getByRole('navigation').getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByLabel('Physical PDF page', { exact: true })).toHaveValue('48');
  expect((await review()).zoom).toBe(125);
  expect((await review()).visitedPages).toEqual(expect.arrayContaining([11, 12, 13, 14, 15, 48]));
  expect(remoteRequests).toEqual([]);
});

test('only exact half-smaller-height displays qualify, not slivers or inactive/offscreen rendering', async () => {
  await expect(page.getByRole('img', { name: 'Supplied Code of Ethics, physical page 1', exact: true })).toBeVisible();
  // Render while a different real window owns OS focus, then position the page before reactivation.
  await desktop.evaluate(({ BrowserWindow }) => {
    const other = new BrowserWindow({ width: 300, height: 200 });
    void other.loadURL('about:blank');
    other.focus();
  });
  await expect.poll(() => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:'))!.isFocused())).toBe(false);
  await goTo(2, false);
  expect((await review()).visitedPages).not.toContain(2);
  const dimensions = await page.getByRole('region', { name: 'PDF page viewport' }).evaluate(root => {
    const page = root.querySelector('canvas')!;
    // A 400px reader and a 700+px page give a 200px boundary, independent of page percentage.
    (root as HTMLElement).style.height = '400px';
    (root as HTMLElement).style.minHeight = '400px';
    const spacer = document.createElement('div');
    spacer.style.height = '500px';
    spacer.style.flexShrink = '0';
    root.appendChild(spacer);
    page.style.height = '800px';
    root.scrollTop = page.offsetTop - (root as HTMLElement).offsetTop + page.getBoundingClientRect().height - 199;
    const rect = page.getBoundingClientRect();
    const viewport = root.getBoundingClientRect();
    return { height: rect.height, readerHeight: root.clientHeight, visible: Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top + root.clientTop) };
  });
  expect(dimensions.height).toBeGreaterThan(400);
  expect(dimensions.readerHeight).toBe(400);
  expect(dimensions.visible).toBeCloseTo(199, 0);
  await activate();
  await page.waitForTimeout(250);
  expect((await review()).visitedPages).not.toContain(2);
  const boundary = await page.getByRole('region', { name: 'PDF page viewport' }).evaluate(root => {
    const canvas = root.querySelector('canvas')!;
    const viewport = root.getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    // The page bottom is just 199px below the top of the 400px reader.
    root.scrollTop += rect.bottom - (viewport.top + root.clientTop) - 200;
    return canvas.getBoundingClientRect().bottom - (viewport.top + root.clientTop);
  });
  expect(boundary).toBe(200);
  expect(await page.evaluate(() => document.hasFocus())).toBe(true);
  await expect.poll(async () => (await review()).visitedPages).toContain(2);
  const revision = (await review()).reviewRevision;
  await goTo(11);
  await expect.poll(async () => (await review()).visitedPages).toContain(11);
  await goTo(12);
  await expect.poll(async () => (await review()).visitedPages).toContain(12);
  await page.getByRole('button', { name: 'Reset Principle II: Competence and Integrity', exact: true }).click();
  await expect.poll(async () => (await review()).reviewRevision).toBe(revision + 1);
  expect((await review()).visitedPages).not.toContain(11);
  expect((await review()).visitedPages).not.toContain(12);
});

test('a page smaller than its viewport uses half the page height; hidden final pages unlock nothing', async () => {
  await expect(page.locator('canvas')).toBeVisible();
  await desktop.evaluate(({ BrowserWindow }) => {
    const reader = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:'))!;
    reader.hide();
  });
  await goTo(48, false);
  expect(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:'))!.isVisible())).toBe(false);
  expect((await review()).visitedPages).not.toContain(48);
  await expect(page.getByRole('button', { name: 'Open resources', exact: true })).toHaveCount(0);
  await goTo(4, false);
  const dimensions = await page.getByRole('region', { name: 'PDF page viewport' }).evaluate(root => {
    const canvas = root.querySelector('canvas')!;
    (root as HTMLElement).style.height = '600px';
    (root as HTMLElement).style.minHeight = '600px';
    canvas.style.height = '400px';
    const spacer = document.createElement('div');
    spacer.style.height = '700px';
    spacer.style.flexShrink = '0';
    root.appendChild(spacer);
    root.scrollTop = canvas.offsetTop - (root as HTMLElement).offsetTop + 201;
    return { page: canvas.getBoundingClientRect().height, reader: root.clientHeight };
  });
  expect(dimensions).toEqual({ page: 400, reader: 600 });
  await activate();
  await page.waitForTimeout(200);
  expect((await review()).visitedPages).not.toContain(4);
  await page.getByRole('region', { name: 'PDF page viewport' }).evaluate(root => { root.scrollTop -= 1; });
  await expect.poll(async () => (await review()).visitedPages).toContain(4);
  expect((await review()).visitedPages).not.toContain(48);
});

test('browser failure stays unchecked; explicit main-process launch and reset persist honestly', async () => {
  await goTo(48);
  await expect(page.getByRole('button', { name: 'Open resources', exact: true })).toBeVisible();
  await desktop.evaluate(({ shell }) => {
    shell.openExternal = async () => { throw new Error('Default browser association missing'); };
  });
  await page.getByRole('button', { name: 'Open resources', exact: true }).click();
  await expectActionFeedback(page, 'Default browser association missing');
  await dismissActionFeedback(page);
  expect((await review()).resourcesLaunchedAt).toBeNull();
  await desktop.evaluate(({ shell }) => {
    shell.openExternal = async (url: string) => {
      if (url !== 'https://www.ocswssw.org/registrants/continuing-competence-program/') throw new Error('Wrong resources URL');
    };
  });
  await page.getByRole('button', { name: 'Open resources', exact: true }).click();
  await expect(page.getByText('Default-browser launch recorded:', { exact: false })).toBeVisible();
  expect((await review()).resourcesLaunchedAt).not.toBeNull();
  const revision = (await review()).reviewRevision;
  await page.getByRole('button', { name: 'Reset resources action', exact: true }).click();
  await expect.poll(async () => (await review()).resourcesLaunchedAt).toBeNull();
  expect((await review()).reviewRevision).toBe(revision + 1);
  await desktop.close();
  await launch();
  await page.getByRole('navigation').getByRole('button', { name: 'Review', exact: true }).click();
  expect((await review()).resourcesLaunchedAt).toBeNull();
  expect((await review()).reviewRevision).toBe(revision + 1);
});

test('keyboard review navigation reflows narrowly and remembers the actual scroll position', async () => {
  await goTo(19);
  await expect.poll(async () => (await review()).visitedPages).toContain(19);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  const offset = await page.getByRole('region', { name: 'PDF page viewport' }).evaluate(root => {
    root.scrollTop = 160;
    return root.scrollTop / root.querySelector('canvas')!.getBoundingClientRect().height;
  });
  await expect.poll(async () => (await review()).offset).toBeCloseTo(offset, 3);
  await page.getByRole('button', { name: 'All years', exact: true }).click();
  const persisted = await page.evaluate(async () => {
    const result = await window.swcc.getState();
    if (!result.ok) throw new Error(result.error.message);
    const state = await window.swcc.getReview(result.value.years[0].id);
    if (!state.ok) throw new Error(state.error.message);
    return state.value.offset;
  });
  expect(persisted).toBeCloseTo(offset, 3);
  await page.getByRole('button', { name: 'Open 2026', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  expect(await page.getByRole('region', { name: 'PDF page viewport' }).evaluate(root => root.scrollTop)).toBeCloseTo(160, 0);
  await page.setViewportSize({ width: 620, height: 800 });
  await page.getByRole('button', { name: 'Next PDF page', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Physical PDF page', { exact: true })).toHaveValue('20');
  await expect(page.locator('canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('failed review writes keep visits pending and block navigation and close until a real retry', async () => {
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  const executable = createRequire(import.meta.url)('electron') as string;
  function failReview(failed: boolean) {
    const fixture = spawnSync(executable, ['tests/desktop/storage-fixture.mjs', resolve(root, 'dataset/database.sqlite'), failed ? 'review-fail' : 'review-repair'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
    });
    if (fixture.status !== 0) throw new Error(fixture.stderr);
  }
  failReview(true);
  await goTo(2);
  await expect(page.getByRole('alert')).toContainText('disk full');
  expect((await review()).visitedPages).not.toContain(2);
  await page.getByRole('button', { name: 'All years', exact: true }).click();
  await expect(page.getByLabel('Physical PDF page', { exact: true })).toHaveValue('2');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Not saved');
  expect(desktop.windows()).toHaveLength(1);
  failReview(false);
  await page.getByRole('button', { name: 'Retry review save', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  await expect.poll(async () => (await review()).visitedPages).toContain(2);
  await page.getByRole('button', { name: 'All years', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your year packages' })).toBeVisible();
});

test('an offscreen rendered page is not visited until the real reader scrolls into the window', async () => {
  await expect(page.locator('canvas')).toBeVisible();
  await desktop.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].hide();
  });
  await goTo(7, false);
  await page.locator('.pdf-reader').evaluate(reader => {
    (reader as HTMLElement).style.position = 'static';
    (reader as HTMLElement).style.marginTop = '1000px';
    window.scrollTo(0, 0);
  });
  await activate();
  await page.waitForTimeout(200);
  expect((await review()).visitedPages).not.toContain(7);
  await page.getByRole('region', { name: 'PDF page viewport' }).scrollIntoViewIfNeeded();
  await expect.poll(async () => (await review()).visitedPages).toContain(7);
});
