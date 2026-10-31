import { afterEach, expect, test } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { openApplication } from '../src/main/data/application.js';
import type { DeleteActivity, DeleteGoal, DeleteYear, EvidenceRequest, Result } from '../src/shared/application.js';
import type { EvidenceSystem } from '../src/main/data/evidence.js';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const roots: string[] = [];
const apps: ReturnType<typeof openApplication>[] = [];
afterEach(() => {
  apps.splice(0).forEach(app => app.close());
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
});

function storage() {
  const root = resolve('.work', `deletion-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

function open(root = storage(), evidenceSystem?: EvidenceSystem) {
  const app = openApplication(root, { today: () => '2026-10-31' }, undefined, evidenceSystem);
  apps.push(app);
  return app.operations;
}

test('goal deletion requires public-operation confirmation', async () => {
  const operations = open();
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createGoal({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Reflective supervision',
  }));
  const request = {
    packageId: pkg.id, goalId: pkg.goals[0].id, expectedRevision: pkg.contentRevision, confirmed: false,
  } as unknown as DeleteGoal;

  expect(await operations.deleteGoal(request))
    .toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' } });
  expect(value(await operations.openYear(pkg.id))).toMatchObject({
    contentRevision: pkg.contentRevision,
    goals: [{ id: pkg.goals[0].id, ref: 'G1', title: 'Reflective supervision' }],
  });
});

test('goal deletion preserves shared activities and managed bytes, including supplementary records', async () => {
  const root = storage();
  const source = resolve(root, 'shared.pdf');
  const bytes = Buffer.from('%PDF-1.4\nshared activity evidence');
  writeFileSync(source, bytes);
  const operations = open(root, { chooseFile: async () => source });
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'First goal' }));
  pkg = value(await operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Second goal' }));
  const [firstGoal, secondGoal] = pkg.goals;
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'One shared activity',
    goalIds: [firstGoal.id, secondGoal.id], evidenceDescription: 'Notes stay with the activity',
    applicationToPractice: 'Reflection stays with the activity',
  }));
  const sharedActivity = pkg.activities[0];
  const imported = value(await operations.importEvidence({
    packageId: pkg.id, activityId: sharedActivity.id, expectedRevision: pkg.contentRevision,
  }));
  if (imported.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  pkg = imported.package;
  const before = pkg;

  pkg = value(await operations.deleteGoal({
    packageId: pkg.id, goalId: firstGoal.id, expectedRevision: pkg.contentRevision, confirmed: true,
  }));
  expect(pkg).toMatchObject({
    contentRevision: before.contentRevision + 1,
    assessmentRevision: before.assessmentRevision + 1,
    planRevision: before.planRevision + 1,
    goals: [{ id: secondGoal.id, ref: 'G2', title: 'Second goal' }],
    activities: [{
      id: sharedActivity.id, ref: 'A1', goalIds: [secondGoal.id],
      evidenceDescription: 'Notes stay with the activity', applicationToPractice: 'Reflection stays with the activity',
    }],
  });
  expect(value(await operations.getEvidence(pkg.id))).toMatchObject([
    { id: imported.attachment.id, ref: 'E1', activityId: sharedActivity.id, integrity: 'readable' },
  ]);
  expect(Buffer.from(value(await operations.previewEvidence({
    packageId: pkg.id, activityId: sharedActivity.id, evidenceId: imported.attachment.id,
  })).data)).toEqual(bytes);

  pkg = value(await operations.deleteGoal({
    packageId: pkg.id, goalId: secondGoal.id, expectedRevision: pkg.contentRevision, confirmed: true,
  }));
  expect(pkg).toMatchObject({
    goals: [],
    activities: [{
      id: sharedActivity.id, ref: 'A1', goalIds: [],
      evidenceDescription: 'Notes stay with the activity', applicationToPractice: 'Reflection stays with the activity',
    }],
  });
  expect(Buffer.from(value(await operations.previewEvidence({
    packageId: pkg.id, activityId: sharedActivity.id, evidenceId: imported.attachment.id,
  })).data)).toEqual(bytes);
  pkg = value(await operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'New goal' }));
  expect(pkg.goals[0].ref).toBe('G3');
  expect(pkg.activities[0].goalIds).toEqual([]);
});

test('activity deletion removes only its own managed evidence and keeps references monotonic', async () => {
  const root = storage();
  const firstFile = resolve(root, 'first.pdf');
  const secondFile = resolve(root, 'second.pdf');
  const firstBytes = Buffer.from('%PDF-1.4\nfirst activity evidence');
  const secondBytes = Buffer.from('%PDF-1.4\nother activity evidence');
  writeFileSync(firstFile, firstBytes);
  writeFileSync(secondFile, secondBytes);
  let selected = firstFile;
  const operations = open(root, { chooseFile: async () => selected });
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Goal one' }));
  pkg = value(await operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Goal two' }));
  const [goalOne, goalTwo] = pkg.goals;
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Shared activity',
    goalIds: [goalOne.id, goalTwo.id], evidenceDescription: 'Keep its notes', applicationToPractice: 'Keep its reflection',
  }));
  const deletedActivity = pkg.activities[0];
  const firstEvidence = value(await operations.importEvidence({
    packageId: pkg.id, activityId: deletedActivity.id, expectedRevision: pkg.contentRevision,
  } as EvidenceRequest));
  if (firstEvidence.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  pkg = firstEvidence.package;
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Other activity', goalIds: [goalTwo.id],
  }));
  const retainedActivity = pkg.activities[1];
  selected = secondFile;
  const secondEvidence = value(await operations.importEvidence({
    packageId: pkg.id, activityId: retainedActivity.id, expectedRevision: pkg.contentRevision,
  } as EvidenceRequest));
  if (secondEvidence.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  pkg = secondEvidence.package;

  const otherYear = value(await operations.createYear(2025));
  expect(await operations.deleteActivity({
    packageId: otherYear.id, activityId: deletedActivity.id, expectedRevision: otherYear.contentRevision, confirmed: true,
  })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  expect(await operations.deleteActivity({
    packageId: pkg.id, activityId: deletedActivity.id, expectedRevision: pkg.contentRevision, confirmed: false,
  } as unknown as DeleteActivity)).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' } });
  expect(value(await operations.openYear(pkg.id)).activities.map(activity => activity.id)).toEqual([deletedActivity.id, retainedActivity.id]);
  const before = value(await operations.openYear(pkg.id));

  pkg = value(await operations.deleteActivity({
    packageId: before.id, activityId: deletedActivity.id, expectedRevision: before.contentRevision, confirmed: true,
  }));
  expect(pkg).toMatchObject({
    contentRevision: before.contentRevision + 1,
    assessmentRevision: before.assessmentRevision,
    planRevision: before.planRevision + 1,
    goals: [{ id: goalOne.id, ref: 'G1' }, { id: goalTwo.id, ref: 'G2' }],
    activities: [{ id: retainedActivity.id, ref: 'A2', goalIds: [goalTwo.id] }],
  });
  expect(value(await operations.getEvidence(pkg.id))).toMatchObject([
    { id: secondEvidence.attachment.id, ref: 'E2', activityId: retainedActivity.id, integrity: 'readable' },
  ]);
  expect(Buffer.from(value(await operations.previewEvidence({
    packageId: pkg.id, activityId: retainedActivity.id, evidenceId: secondEvidence.attachment.id,
  })).data)).toEqual(secondBytes);
  expect(Buffer.from(readFileSync(secondFile))).toEqual(secondBytes);

  pkg = value(await operations.createActivity({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Replacement activity' }));
  expect(pkg.activities.at(-1)?.ref).toBe('A3');
  selected = firstFile;
  const nextEvidence = value(await operations.importEvidence({
    packageId: pkg.id, activityId: pkg.activities.at(-1)!.id, expectedRevision: pkg.contentRevision,
  } as EvidenceRequest));
  if (nextEvidence.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  expect(nextEvidence.attachment.ref).toBe('E3');

  apps.pop()!.close();
  const reopened = open(root);
  expect(value(await reopened.getState()).selectedPackage?.activities.map(activity => activity.ref)).toEqual(['A2', 'A3']);
  expect(value(await reopened.getEvidence(pkg.id)).map(entry => entry.ref)).toEqual(['E2', 'E3']);
});

test('year deletion cleans only that package and selects an existing year or the empty list', async () => {
  const root = storage();
  const olderFile = resolve(root, 'older.pdf');
  const retainedFile = resolve(root, 'retained.pdf');
  const olderBytes = Buffer.from('%PDF-1.4\nolder year');
  const retainedBytes = Buffer.from('%PDF-1.4\nretained year');
  writeFileSync(olderFile, olderBytes);
  writeFileSync(retainedFile, retainedBytes);
  let selected = olderFile;
  const operations = open(root, { chooseFile: async () => selected });
  let older = value(await operations.createYear(2023));
  older = value(await operations.createActivity({ packageId: older.id, expectedRevision: older.contentRevision, title: 'Older activity' }));
  const olderActivity = older.activities[0];
  const olderEvidence = value(await operations.importEvidence({
    packageId: older.id, activityId: olderActivity.id, expectedRevision: older.contentRevision,
  }));
  if (olderEvidence.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  older = olderEvidence.package;

  let retained = value(await operations.createYear(2024));
  retained = value(await operations.createActivity({ packageId: retained.id, expectedRevision: retained.contentRevision, title: 'Retained activity' }));
  const retainedActivity = retained.activities[0];
  selected = retainedFile;
  const retainedEvidence = value(await operations.importEvidence({
    packageId: retained.id, activityId: retainedActivity.id, expectedRevision: retained.contentRevision,
  }));
  if (retainedEvidence.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  retained = retainedEvidence.package;
  value(await operations.openYear(older.id));

  expect(await operations.deleteYear({
    packageId: older.id, expectedRevision: older.contentRevision, confirmed: false,
  } as unknown as DeleteYear)).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' } });
  expect(await operations.deleteYear({
    packageId: randomUUID(), expectedRevision: 0, confirmed: true,
  })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  expect(value(await operations.getEvidence(retained.id))).toMatchObject([
    { id: retainedEvidence.attachment.id, ref: 'E1', integrity: 'readable' },
  ]);
  const dataRevision = value(await operations.getState()).dataRevision;

  let state = value(await operations.deleteYear({
    packageId: older.id, expectedRevision: older.contentRevision, confirmed: true,
  }));
  expect(state).toMatchObject({
    years: [{ id: retained.id, year: 2024, contentRevision: retained.contentRevision }],
    selectedPackage: { id: retained.id, year: 2024, activities: [{ id: retainedActivity.id, ref: 'A1' }] },
    dataRevision: dataRevision + 1,
  });
  expect(readdirSync(resolve(root, 'dataset', 'evidence', '2023'))).toEqual([]);
  expect(value(await operations.getEvidence(retained.id))).toMatchObject([
    { id: retainedEvidence.attachment.id, ref: 'E1', integrity: 'readable' },
  ]);
  expect(Buffer.from(value(await operations.previewEvidence({
    packageId: retained.id, activityId: retainedActivity.id, evidenceId: retainedEvidence.attachment.id,
  })).data)).toEqual(retainedBytes);

  state = value(await operations.deleteYear({
    packageId: retained.id, expectedRevision: retained.contentRevision, confirmed: true,
  }));
  expect(state).toMatchObject({ years: [], selectedPackage: null, dataRevision: dataRevision + 2 });
  expect(value(await operations.getState())).toMatchObject({ years: [], selectedPackage: null });
});

test('database deletion failures restore staged files and leave the activity usable', async () => {
  const root = storage();
  const source = resolve(root, 'recoverable.pdf');
  const bytes = Buffer.from('%PDF-1.4\nrecoverable evidence');
  writeFileSync(source, bytes);
  const operations = open(root, { chooseFile: async () => source });
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createActivity({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Keep this activity' }));
  const activity = pkg.activities[0];
  const imported = value(await operations.importEvidence({
    packageId: pkg.id, activityId: activity.id, expectedRevision: pkg.contentRevision,
  }));
  if (imported.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  pkg = imported.package;
  const fixture = new Database(resolve(root, 'dataset', 'database.sqlite'));
  fixture.exec(`CREATE TRIGGER reject_activity_delete BEFORE DELETE ON learning_activities BEGIN SELECT RAISE(FAIL, 'delete blocked'); END`);

  expect(await operations.deleteActivity({
    packageId: pkg.id, activityId: activity.id, expectedRevision: pkg.contentRevision, confirmed: true,
  })).toMatchObject({ ok: false, error: { code: 'STORAGE', message: expect.stringContaining('delete blocked') } });
  expect(value(await operations.openYear(pkg.id))).toMatchObject({
    activities: [{ id: activity.id, ref: 'A1', title: 'Keep this activity' }],
  });
  expect(value(await operations.getEvidence(pkg.id))).toMatchObject([
    { id: imported.attachment.id, ref: 'E1', integrity: 'readable' },
  ]);
  expect(Buffer.from(value(await operations.previewEvidence({
    packageId: pkg.id, activityId: activity.id, evidenceId: imported.attachment.id,
  })).data)).toEqual(bytes);
  expect(readdirSync(resolve(root, 'dataset', 'evidence')).filter(name => name.startsWith('.deletion-'))).toEqual([]);

  fixture.exec('DROP TRIGGER reject_activity_delete');
  fixture.close();
});

test('file staging failures preserve all records and managed files', async () => {
  const root = storage();
  const firstFile = resolve(root, 'first.pdf');
  const secondFile = resolve(root, 'second.pdf');
  const firstBytes = Buffer.from('%PDF-1.4\nfirst file');
  const secondBytes = Buffer.from('%PDF-1.4\nsecond file');
  writeFileSync(firstFile, firstBytes);
  writeFileSync(secondFile, secondBytes);
  let selected = firstFile;
  let moves = 0;
  const operations = open(root, {
    chooseFile: async () => selected,
    moveManagedFile: (sourcePath, destinationPath) => {
      moves++;
      if (moves === 3) throw new Error('simulated evidence move failure');
      renameSync(sourcePath, destinationPath);
    },
  });
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createActivity({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Keep both files' }));
  const activity = pkg.activities[0];
  const first = value(await operations.importEvidence({ packageId: pkg.id, activityId: activity.id, expectedRevision: pkg.contentRevision }));
  if (first.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  pkg = first.package;
  selected = secondFile;
  const second = value(await operations.importEvidence({ packageId: pkg.id, activityId: activity.id, expectedRevision: pkg.contentRevision }));
  if (second.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  pkg = second.package;

  expect(await operations.deleteActivity({
    packageId: pkg.id, activityId: activity.id, expectedRevision: pkg.contentRevision, confirmed: true,
  })).toMatchObject({ ok: false, error: { code: 'STORAGE', message: expect.stringContaining('Records were not deleted') } });
  expect(value(await operations.openYear(pkg.id))).toMatchObject({ activities: [{ id: activity.id, ref: 'A1' }] });
  expect(value(await operations.getEvidence(pkg.id))).toMatchObject([
    { id: first.attachment.id, ref: 'E1', integrity: 'readable' },
    { id: second.attachment.id, ref: 'E2', integrity: 'readable' },
  ]);
  expect(Buffer.from(value(await operations.previewEvidence({
    packageId: pkg.id, activityId: activity.id, evidenceId: first.attachment.id,
  })).data)).toEqual(firstBytes);
  expect(Buffer.from(value(await operations.previewEvidence({
    packageId: pkg.id, activityId: activity.id, evidenceId: second.attachment.id,
  })).data)).toEqual(secondBytes);
  expect(readdirSync(resolve(root, 'dataset', 'evidence')).filter(name => name.startsWith('.deletion-'))).toEqual([]);
});

test('post-commit file cleanup failures return a recovery path and recover on restart', async () => {
  const root = storage();
  const source = resolve(root, 'recovery.pdf');
  writeFileSync(source, Buffer.from('%PDF-1.4\nrecoverable cleanup'));
  const operations = open(root, {
    chooseFile: async () => source,
    removeDeletionStage: () => { throw new Error('staging folder is locked'); },
  });
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createActivity({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Explicitly removed' }));
  const activity = pkg.activities[0];
  const imported = value(await operations.importEvidence({
    packageId: pkg.id, activityId: activity.id, expectedRevision: pkg.contentRevision,
  }));
  if (imported.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  pkg = imported.package;

  const result = await operations.deleteActivity({
    packageId: pkg.id, activityId: activity.id, expectedRevision: pkg.contentRevision, confirmed: true,
  });
  expect(result).toMatchObject({
    ok: false, error: {
      code: 'STORAGE', committed: true, recoveryPath: expect.stringContaining('.deletion-'),
      message: expect.stringContaining('recoverable staging folder'),
    },
  });
  if (result.ok) throw new Error('The cleanup failure unexpectedly reported success.');
  expect(value(await operations.openYear(pkg.id)).activities).toEqual([]);
  expect(readdirSync(resolve(root, 'dataset', 'evidence')).filter(name => name.startsWith('.deletion-'))).toEqual([
    result.error.recoveryPath!.split('/').at(-1),
  ]);

  apps.pop()!.close();
  const reopened = open(root);
  expect(value(await reopened.openYear(pkg.id)).activities).toEqual([]);
  expect(readdirSync(resolve(root, 'dataset', 'evidence')).filter(name => name.startsWith('.deletion-'))).toEqual([]);
});

test('individual evidence cleanup failures are reported after commit and recover on restart', async () => {
  const root = storage();
  const source = resolve(root, 'evidence-recovery.pdf');
  writeFileSync(source, Buffer.from('%PDF-1.4\nrecoverable evidence cleanup'));
  const operations = open(root, {
    chooseFile: async () => source,
    removeDeletionStage: () => { throw new Error('staging folder is locked'); },
  });
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Evidence removal recovery',
  }));
  const activity = pkg.activities[0];
  const imported = value(await operations.importEvidence({
    packageId: pkg.id, activityId: activity.id, expectedRevision: pkg.contentRevision,
  }));
  if (imported.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');

  const result = await operations.removeEvidence({
    packageId: pkg.id, activityId: activity.id, evidenceId: imported.attachment.id,
    expectedRevision: imported.package.contentRevision,
  });
  expect(result).toMatchObject({
    ok: false, error: {
      code: 'STORAGE', committed: true, recoveryPath: expect.stringContaining('.deletion-'),
      message: expect.stringContaining('was removed from the database'),
    },
  });
  if (result.ok) throw new Error('The cleanup failure unexpectedly reported success.');
  expect(value(await operations.getEvidence(pkg.id))).toEqual([]);
  expect(value(await operations.openYear(pkg.id)).activities).toHaveLength(1);
  expect(readdirSync(resolve(root, 'dataset', 'evidence')).filter(name => name.startsWith('.deletion-'))).toEqual([
    result.error.recoveryPath!.split('/').at(-1),
  ]);

  apps.pop()!.close();
  const reopened = open(root);
  expect(value(await reopened.openYear(pkg.id)).activities).toHaveLength(1);
  expect(value(await reopened.getEvidence(pkg.id))).toEqual([]);
  expect(readdirSync(resolve(root, 'dataset', 'evidence')).filter(name => name.startsWith('.deletion-'))).toEqual([]);
});
