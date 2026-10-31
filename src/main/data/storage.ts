import { join } from 'node:path';

export function storageLayout(root: string) {
  const dataset = join(root, 'dataset');
  return {
    dataset,
    database: join(dataset, 'database.sqlite'),
    evidence: join(dataset, 'evidence'),
    runtime: join(root, 'runtime'),
    restoreStaging: join(root, 'restore-staging'),
    recoveryJournal: join(root, 'recovery.json'),
  };
}
