import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/desktop',
  workers: 1,
  timeout: process.env.CI ? 90_000 : 30_000,
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  use: { trace: 'retain-on-failure' },
});
