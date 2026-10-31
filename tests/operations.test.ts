import { afterEach, expect, test } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openApplication } from '../src/main/data/application.js';
import Database from 'better-sqlite3';
import type { Result } from '../src/shared/application.js';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function storage() {
  const root = resolve('.work', `dataset-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

test('a worker reopens the selected year and incomplete assessment after restart', async () => {
  const root = storage();
  let app = openApplication(root, { now: () => new Date('2026-10-31T15:00:00Z'), today: () => '2026-10-31' });
  const created = await app.operations.createYear(2024);
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.error.message);
  expect(created.value.assessmentDate).toBe('2026-10-31');
  expect(created.value.planDate).toBe('2026-10-31');
  const saved = await app.operations.saveDraft({
    packageId: created.value.id, expectedRevision: 0,
    draft: { assessmentDate: '2024-02-29', planDate: '2024-01-19', strengths: 'A still unfinished thought', peerFeedback: '', learningNeeds: '' },
  });
  expect(saved.ok).toBe(true);
  app.close();
  app = openApplication(root, { today: () => '2026-11-01' });
  const state = await app.operations.getState();
  expect(state.ok && state.value.selectedPackage).toMatchObject({
    year: 2024, assessmentDate: '2024-02-29', planDate: '2024-01-19', strengths: 'A still unfinished thought', contentRevision: 1,
  });
  app.close();
});

test('years stay newest first; duplicate and invalid operations leave the selected package intact', async () => {
  const app = openApplication(storage());
  const past = value(await app.operations.createYear(2020));
  const current = value(await app.operations.createYear(2026));
  expect(await app.operations.createYear(2020)).toMatchObject({
    ok: false, error: { code: 'DUPLICATE_YEAR', existingPackageId: past.id },
  });
  expect(await app.operations.createYear(2026.5)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  expect(await app.operations.openYear('not-an-id')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  expect(value(await app.operations.getState()).years.map(year => year.year)).toEqual([2026, 2020]);
  expect(value(await app.operations.getState()).selectedPackage?.id).toBe(current.id);
  await app.operations.openYear(past.id);
  const revision = value(await app.operations.getState()).dataRevision;
  await app.operations.openYear(current.id);
  expect(value(await app.operations.getState()).dataRevision).toBe(revision);
  app.close();
});

test('only meaningful draft edits advance relevant revisions; stale or invalid writes preserve the draft', async () => {
  const app = openApplication(storage());
  let record = value(await app.operations.createYear(2024));
  const draft = { assessmentDate: record.assessmentDate, planDate: record.planDate, strengths: '', learningNeeds: '', peerFeedback: '' };
  record = value(await app.operations.saveDraft({ packageId: record.id, expectedRevision: 0, draft }));
  expect(record.contentRevision).toBe(0);
  record = value(await app.operations.saveDraft({ packageId: record.id, expectedRevision: 0, draft: { ...draft, strengths: 'Café — unfinished' } }));
  expect(record).toMatchObject({ contentRevision: 1, assessmentRevision: 1, planRevision: 0 });
  expect(await app.operations.saveDraft({ packageId: record.id, expectedRevision: 0, draft })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  expect(await app.operations.saveDraft({ packageId: record.id, expectedRevision: 1, draft: { ...draft, assessmentDate: '2024-02-30' } })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  expect(value(await app.operations.getState()).selectedPackage?.strengths).toBe('Café — unfinished');
  app.close();
});

test('first-run acknowledgement persists without recurring acknowledgement or spurious revisions', async () => {
  const root = storage();
  let app = openApplication(root);
  expect(value(await app.operations.getState()).acknowledgedAt).toBeNull();
  const acknowledged = value(await app.operations.acknowledgeStorage());
  await app.operations.acknowledgeStorage();
  expect(value(await app.operations.getState()).dataRevision).toBe(acknowledged.dataRevision);
  app.close();
  app = openApplication(root);
  expect(value(await app.operations.getState()).acknowledgedAt).toBe(acknowledged.acknowledgedAt);
  app.close();
});

test('a real SQLite write failure is actionable, preserves saved records, and can be retried', async () => {
  const root = storage();
  const app = openApplication(root);
  const record = value(await app.operations.createYear(2026));
  const fixture = new Database(resolve(root, 'dataset/database.sqlite'));
  fixture.exec(`CREATE TRIGGER simulate_disk_failure BEFORE UPDATE ON year_packages BEGIN SELECT RAISE(FAIL, 'disk full'); END`);
  const input = { packageId: record.id, expectedRevision: 0, draft: {
    assessmentDate: record.assessmentDate, planDate: record.planDate, peerFeedback: '', learningNeeds: '', strengths: 'Never lose this edit',
  } };
  expect(await app.operations.saveDraft(input)).toMatchObject({ ok: false, error: { code: 'STORAGE', message: expect.stringContaining('disk full') } });
  expect(value(await app.operations.getState()).selectedPackage?.strengths).toBe('');
  fixture.exec('DROP TRIGGER simulate_disk_failure');
  expect(value(await app.operations.saveDraft(input)).strengths).toBe('Never lose this edit');
  fixture.close();
  app.close();
});

test('corrupt and future-schema datasets are refused rather than replaced by empty records', async () => {
  const corruptRoot = storage();
  mkdirSync(resolve(corruptRoot, 'dataset'));
  const corruptFile = resolve(corruptRoot, 'dataset/database.sqlite');
  writeFileSync(corruptFile, 'not a SQLite database');
  expect(() => openApplication(corruptRoot)).toThrow('has not been replaced');
  expect(readFileSync(corruptFile, 'utf8')).toBe('not a SQLite database');
  const root = storage();
  const app = openApplication(root);
  const record = value(await app.operations.createYear(2024));
  app.close();
  const fixture = new Database(resolve(root, 'dataset/database.sqlite'));
  fixture.pragma('user_version = 999');
  fixture.close();
  expect(() => openApplication(root)).toThrow('newer than supported');
  const repair = new Database(resolve(root, 'dataset/database.sqlite'));
  repair.pragma('user_version = 1');
  repair.close();
  const reopened = openApplication(root);
  expect(value(await reopened.operations.getState()).selectedPackage?.id).toBe(record.id);
  reopened.close();
});

test('a missing or truncated database in an existing dataset never silently becomes an empty portfolio', async () => {
  const root = storage();
  const app = openApplication(root);
  const record = value(await app.operations.createYear(2024));
  app.close();
  const file = resolve(root, 'dataset/database.sqlite');
  renameSync(file, `${file}.recovery-copy`);
  expect(() => openApplication(root)).toThrow('database is missing');
  renameSync(`${file}.recovery-copy`, file);
  const reopened = openApplication(root);
  expect(value(await reopened.operations.getState()).selectedPackage?.id).toBe(record.id);
  reopened.close();
  renameSync(file, `${file}.recovery-copy`);
  writeFileSync(file, '');
  expect(() => openApplication(root)).toThrow('database is empty');
});

test('a failed migration and invalid ownership are reported while the saved package remains recoverable', async () => {
  const root = storage();
  const app = openApplication(root);
  const record = value(await app.operations.createYear(2024));
  app.close();
  const file = resolve(root, 'dataset/database.sqlite');
  let fixture = new Database(file);
  fixture.pragma('user_version = 0');
  fixture.close();
  expect(() => openApplication(root)).toThrow('already exists');
  fixture = new Database(file);
  fixture.pragma('user_version = 1');
  fixture.pragma('foreign_keys = OFF');
  fixture.prepare('UPDATE app_metadata SET selected_package_id = ?').run(randomUUID());
  fixture.close();
  expect(() => openApplication(root)).toThrow('relationships are invalid');
  fixture = new Database(file);
  fixture.prepare('UPDATE app_metadata SET selected_package_id = ?').run(record.id);
  fixture.close();
  const recovered = openApplication(root);
  expect(value(await recovered.operations.getState()).selectedPackage?.id).toBe(record.id);
  recovered.close();
});

test('long incomplete narratives are saved in full without an invented text quota', async () => {
  const app = openApplication(storage());
  const record = value(await app.operations.createYear(2026));
  const narrative = 'Reflection across my practice. '.repeat(40_000);
  const saved = await app.operations.saveDraft({
    packageId: record.id, expectedRevision: 0,
    draft: { assessmentDate: record.assessmentDate, planDate: record.planDate, strengths: narrative, peerFeedback: '', learningNeeds: '' },
  });
  expect(saved.ok).toBe(true);
  expect(value(await app.operations.getState()).selectedPackage?.strengths === narrative).toBe(true);
  app.close();
});
