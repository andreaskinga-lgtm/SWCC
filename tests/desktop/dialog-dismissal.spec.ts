import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { desktopEnvironment } from './environment.js';
import { expectActionFeedback } from './feedback-helpers.js';

const electronExecutable = createRequire(import.meta.url)('electron') as string;
let desktop: ElectronApplication;
let page: Page;
let root: string;

test.beforeEach(async () => {
  root = resolve('.work', `desktop-dialog-dismissal-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  desktop = await electron.launch({
    executablePath: process.env.SWCC_PACKAGED_EXECUTABLE,
    args: [...(process.env.SWCC_PACKAGED_EXECUTABLE ? [] : ['.']), `--user-data-dir=${root}`],
    env: desktopEnvironment(),
  });
  page = await desktop.firstWindow();
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'I understand' }).click();
  await page.getByLabel('New package year').fill('2024');
  await page.getByLabel('New package year').press('Enter');
  await page.getByRole('navigation').getByRole('button', { name: 'Self-assessment', exact: true }).click();
  await page.getByRole('button', { name: 'Add goal', exact: true }).click();
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

async function dragToBackdrop(dialog: Locator, text: Locator, expectSelection = true) {
  const [dialogBox, textBox] = await Promise.all([
    dialog.boundingBox(),
    expectSelection ? text.boundingBox() : text.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
  ]);
  expect(dialogBox).not.toBeNull();
  expect(textBox).not.toBeNull();
  const y = textBox!.y + textBox!.height / 2;
  const outsideX = dialogBox!.x + dialogBox!.width + 20;
  const startX = expectSelection ? textBox!.x + textBox!.width / 2 : textBox!.x + Math.min(4, textBox!.width / 2);
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(outsideX, y, { steps: 8 });
  if (expectSelection) expect(await page.evaluate(() => window.getSelection()?.toString())).not.toBe('');
  await page.mouse.up();
  return { outsideX, y };
}

test('dragging a text selection from a dialog to its backdrop does not dismiss it, but a backdrop click does', async () => {
  const dialog = page.getByRole('dialog', { name: 'Add a learning goal' });
  const copy = dialog.getByText('Goals appear in both your self-assessment and development plan.', { exact: true });
  const { outsideX, y } = await dragToBackdrop(dialog, copy);
  await expect(dialog).toBeVisible();
  await page.mouse.click(outsideX, y);
  await expect(dialog).toBeHidden();
});

test('dragging from feedback content to its backdrop does not dismiss it', async () => {
  const dialog = page.getByRole('dialog', { name: 'Add a learning goal' });
  await dialog.getByLabel('Goal title').fill('Pending goal');
  failWrites(true);
  await dialog.getByRole('button', { name: 'Add goal', exact: true }).click();
  const feedback = await expectActionFeedback(page, 'disk full');
  failWrites(false);
  const { outsideX, y } = await dragToBackdrop(feedback, feedback.getByRole('alert'), false);

  await expect(feedback).toBeVisible();
  await page.mouse.click(outsideX, y);
  await expect(feedback).toBeHidden();
});
