import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/operations.test.ts'], fileParallelism: false, pool: 'forks' },
});
