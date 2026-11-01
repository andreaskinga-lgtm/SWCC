import { afterEach, expect, test } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openApplication } from '../src/main/data/application.js';
import type { Result } from '../src/shared/application.js';
import Database from 'better-sqlite3';
import { DraftSession } from '../src/renderer/draft-session.js';

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
  const root = resolve('.work', `activities-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}
function open(root = storage()) {
  const app = openApplication(root, { today: () => '2026-10-31' });
  apps.push(app);
  return app.operations;
}

test('one activity supports two goals with one evidence and reflection record after restart', async () => {
  const root = storage();
  const operations = open(root);
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Reflective supervision' }));
  pkg = value(await operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Trauma-informed practice' }));
  const goalIds = pkg.goals.map(goal => goal.id);
  const assessmentRevision = pkg.assessmentRevision;
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision,
    title: 'Shared consultation', goalIds,
    evidenceDescription: 'Consultation notes', applicationToPractice: 'Changed my consultation approach.',
  }));
  expect(pkg.activities).toHaveLength(1);
  expect(pkg.activities[0]).toMatchObject({
    ref: 'A1', goalIds, status: 'Planned', completionDate: '',
    evidenceDescription: 'Consultation notes', applicationToPractice: 'Changed my consultation approach.',
  });

  expect(pkg.assessmentRevision).toBe(assessmentRevision);
  const other = value(await operations.createYear(2025));
  expect(await operations.updateActivity({
    packageId: other.id, expectedRevision: other.contentRevision, activityId: pkg.activities[0].id, title: 'Wrong year',
  })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  expect(await operations.createActivity({
    packageId: other.id, expectedRevision: other.contentRevision, title: 'Wrong links', goalIds,
  })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  expect(await operations.updateActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId: pkg.activities[0].id, goalIds: [goalIds[0], goalIds[0]],
  })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  value(await operations.openYear(pkg.id));
  apps.pop()!.close();
  const reopened = value(await open(root).getState()).selectedPackage!;
  expect(reopened.activities).toEqual(pkg.activities);
});

test('completion needs a real nonfuture date; drafts and out-of-year dates remain honest and editable', async () => {
  const root = storage();
  const operations = open(root);
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createActivity({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Reading' }));
  const activityId = pkg.activities[0].id;
  for (const completionDate of ['', '2024-02-30', '2026-11-01']) {
    expect(await operations.updateActivity({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId, status: 'Completed', completionDate,
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  }
  pkg = value(await operations.updateActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId, status: 'In Progress',
  }));
  expect(pkg.activities[0]).toMatchObject({ status: 'In Progress', completionDate: '' });
  pkg = value(await operations.updateActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId, status: 'Completed', completionDate: '2023-12-30',
  }));
  expect(pkg.activities[0]).toMatchObject({ status: 'Completed', completionDate: '2023-12-30', evidenceDescription: '', applicationToPractice: '' });
  const previousTZ = process.env.TZ;
  try {
    apps.pop()!.close();
    process.env.TZ = 'Pacific/Auckland';
    expect(value(await open(root).getState()).selectedPackage?.activities[0].completionDate).toBe('2023-12-30');
    apps.pop()!.close();
    process.env.TZ = 'America/Los_Angeles';
    expect(value(await open(root).getState()).selectedPackage?.activities[0].completionDate).toBe('2023-12-30');
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test('a missing completion date keeps a failed activity save actionable until the retained edit is written', async () => {
  const root = storage();
  const app = openApplication(root, { today: () => '2026-10-31' });
  apps.push(app);
  let pkg = value(await app.operations.createYear(2024));
  pkg = value(await app.operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Original activity',
  }));
  const activityId = pkg.activities[0].id;
  const fixture = new Database(resolve(root, 'dataset/database.sqlite'));
  fixture.exec(`CREATE TRIGGER simulate_activity_write_failure BEFORE UPDATE ON learning_activities BEGIN SELECT RAISE(FAIL, 'disk full'); END`);
  const session = new DraftSession(app.operations);
  session.open(pkg);

  try {
    session.editActivity(activityId, { title: 'Retained activity title' });
    await expect(session.flush()).rejects.toThrow('disk full');
    expect(session.getSnapshot()).toMatchObject({
      status: 'Not saved',
      error: expect.stringContaining('disk full'),
      record: { activities: [{ title: 'Retained activity title', status: 'Planned' }] },
    });

    session.editActivity(activityId, { status: 'Completed', completionDate: '' });
    await expect(session.flush()).rejects.toThrow('Completed activities require an actual completion date.');
    expect(session.getSnapshot()).toMatchObject({
      status: 'Not saved',
      error: expect.stringContaining('disk full'),
      record: { activities: [{ title: 'Retained activity title', status: 'Completed', completionDate: '' }] },
    });
    expect(value(await app.operations.getState()).selectedPackage?.activities[0])
      .toMatchObject({ title: 'Original activity', status: 'Planned', completionDate: '' });

    fixture.exec('DROP TRIGGER simulate_activity_write_failure');
    session.editActivity(activityId, { completionDate: '2024-01-15' });
    await session.flush();
    expect(session.getSnapshot()).toMatchObject({
      status: 'Saved',
      error: null,
      record: { activities: [{ title: 'Retained activity title', status: 'Completed', completionDate: '2024-01-15' }] },
    });
    expect(value(await app.operations.getState()).selectedPackage?.activities[0])
      .toMatchObject({ title: 'Retained activity title', status: 'Completed', completionDate: '2024-01-15' });
  } finally {
    fixture.close();
  }
});

test('creating a goal during activity entry atomically links the shared goal without reusing references', async () => {
  const operations = open();
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Retired goal' }));
  pkg = value(await operations.deleteGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, goalId: pkg.goals[0].id, confirmed: true }));
  pkg = value(await operations.createActivity({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Consultation' }));
  const before = pkg;
  pkg = value(await operations.createGoal({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Inline goal', activityId: pkg.activities[0].id,
  }));
  expect(pkg.goals).toHaveLength(1);
  expect(pkg.goals[0]).toMatchObject({ ref: 'G2', title: 'Inline goal' });
  expect(pkg.activities[0].goalIds).toEqual([pkg.goals[0].id]);
  expect(pkg.assessmentRevision).toBe(before.assessmentRevision + 1);
  expect(pkg.planRevision).toBe(before.planRevision + 1);
  expect(value(await operations.openYear(pkg.id)).goals).toEqual(pkg.goals);
  pkg = value(await operations.deleteGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, goalId: pkg.goals[0].id, confirmed: true }));
  expect(pkg.activities[0]).toMatchObject({ title: 'Consultation', goalIds: [] });
});

test('Step 3 requires all linked work, but supplementary drafts do not block readiness', async () => {
  const operations = open();
  let pkg = value(await operations.createYear(2024));
  expect(value(await operations.getPlanReadiness(pkg.id)).missing).toContain('Add at least one learning goal.');
  pkg = value(await operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Supervision' }));
  pkg = value(await operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Practice' }));
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Shared consultation', goalIds: pkg.goals.map(goal => goal.id),
  }));
  expect(value(await operations.getPlanReadiness(pkg.id)).missing).toEqual([
    'G1 needs completed supporting work.', 'G2 needs completed supporting work.',
    'A1 must be Completed.', 'A1 needs evidence notes, a valid link, or a readable evidence file.', 'A1 needs an application-to-practice reflection.',
  ]);
  const sharedId = pkg.activities[0].id;
  pkg = value(await operations.updateActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId: sharedId,
    status: 'Completed', completionDate: '2024-06-15', evidenceDescription: 'Consultation notes', applicationToPractice: 'I changed my approach.',
  }));
  expect(value(await operations.getPlanReadiness(pkg.id))).toEqual({ ready: true, missing: [] });
  pkg = value(await operations.createActivity({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Supplementary reading' }));
  expect(value(await operations.getPlanReadiness(pkg.id)).ready).toBe(true);
  const supplementaryId = pkg.activities[1].id;
  pkg = value(await operations.updateActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId: supplementaryId, goalIds: [pkg.goals[0].id],
  }));
  expect(value(await operations.getPlanReadiness(pkg.id)).missing).toContain('A2 must be Completed.');
  pkg = value(await operations.updateActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId: supplementaryId, goalIds: [], description: 'Still editable',
  }));
  expect(value(await operations.getPlanReadiness(pkg.id)).ready).toBe(true);
  pkg = value(await operations.saveDraft({ packageId: pkg.id, expectedRevision: pkg.contentRevision, draft: {
    assessmentDate: pkg.assessmentDate, planDate: '', strengths: '', peerFeedback: '', learningNeeds: '', annualStandards: [],
  } }));
  expect(value(await operations.getPlanReadiness(pkg.id)).missing).toEqual(['Enter a valid plan date.']);
});

test('evidence links validate offline and open only explicitly, with browser failures reported', async () => {
  const root = storage();
  const launched: string[] = [];
  let browserFails = false;
  const app = openApplication(root, { today: () => '2026-10-31' }, {
    readDocument: () => new Uint8Array(),
    openExternal: async url => { if (browserFails) throw new Error('No browser available'); launched.push(url); },
  });
  apps.push(app);
  const operations = app.operations;
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Supervision' }));
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Consultation',
    goalIds: [pkg.goals[0].id], status: 'Completed', completionDate: '2024-06-15',
    evidenceLinks: ['https://example.org/notes', 'http://example.org/book'], applicationToPractice: 'Applied the learning.',
  }));
  expect(launched).toEqual([]);
  expect(value(await operations.getPlanReadiness(pkg.id)).ready).toBe(true);
  const activityId = pkg.activities[0].id;
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://', 'https://user:password@example.org', 'https://example.org/a b']) {
    expect(await operations.updateActivity({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId, evidenceLinks: [url],
    })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  }
  expect(await operations.openEvidenceLink({ packageId: pkg.id, activityId, url: 'file:///etc/passwd' }))
    .toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  expect(await operations.openEvidenceLink({ packageId: pkg.id, activityId, url: 'https://example.org/other' }))
    .toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  expect(await operations.openEvidenceLink({ packageId: pkg.id, activityId, url: 'https://example.org/notes' })).toEqual({ ok: true, value: undefined });
  expect(launched).toEqual(['https://example.org/notes']);
  browserFails = true;
  expect(await operations.openEvidenceLink({ packageId: pkg.id, activityId, url: 'https://example.org/notes' }))
    .toMatchObject({ ok: false, error: { code: 'BROWSER', message: expect.stringContaining('No browser available') } });
});

test('activity edits change only Step 3 revisions; no-op relationships and invalid creation preserve saved work', async () => {
  const operations = open();
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'First goal' }));
  pkg = value(await operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Second goal' }));
  for (const invalid of [
    { title: ' ' }, { title: 'Wrong state', status: 'Cancelled' },
    { title: 'Impossible date', status: 'Completed', completionDate: '2024-02-30' },
  ]) {
    expect(await operations.createActivity({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, ...invalid,
    } as Parameters<typeof operations.createActivity>[0])).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  }
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'One activity', goalIds: pkg.goals.map(goal => goal.id),
  }));
  expect(pkg.activities[0].ref).toBe('A1');
  const assessmentRevision = pkg.assessmentRevision;
  const reviewRevision = pkg.reviewRevision;
  const activityId = pkg.activities[0].id;
  const edits = [
    { title: 'Renamed activity' }, { description: 'Description' }, { status: 'In Progress' },
    { status: 'Completed', completionDate: '2024-06-15' }, { evidenceDescription: 'Evidence notes' },
    { evidenceLinks: ['https://example.org/notes'] }, { applicationToPractice: 'Application reflection' },
    { goalIds: [pkg.goals[0].id] },
  ] as const;
  for (const patch of edits) {
    const before = pkg;
    pkg = value(await operations.updateActivity({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId, ...patch,
    } as Parameters<typeof operations.updateActivity>[0]));
    expect(pkg).toMatchObject({
      contentRevision: before.contentRevision + 1, planRevision: before.planRevision + 1, assessmentRevision, reviewRevision,
    });
  }
  pkg = value(await operations.updateActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId, goalIds: pkg.goals.map(goal => goal.id),
  }));
  const revision = pkg.contentRevision;
  pkg = value(await operations.updateActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId, goalIds: pkg.goals.map(goal => goal.id).reverse(),
  }));
  expect(pkg.contentRevision).toBe(revision);
  expect(await operations.updateActivity({
    packageId: pkg.id, expectedRevision: revision - 1, activityId, title: 'Stale edit',
  })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  expect(value(await operations.openYear(pkg.id)).activities[0].title).toBe('Renamed activity');
});
