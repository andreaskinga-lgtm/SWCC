import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function expectActionFeedback(page: Page, text: string) {
  const dialog = page.locator('.action-feedback-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(text);
  return dialog;
}

export async function dismissActionFeedback(page: Page) {
  const dialog = page.locator('.action-feedback-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog).toBeHidden();
}
