import { afterEach, expect, test } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openApplication } from '../src/main/data/application.js';
import type { ApplicationOperations, Draft, Result, YearPackage } from '../src/shared/application.js';
import { ANNUAL_STEPS } from '../src/shared/workflow.js';
import type { AnnualStep } from '../src/shared/workflow.js';
import { REVIEW_SECTIONS } from '../src/shared/review.js';
import Database from 'better-sqlite3';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function storage() {
  const root = resolve('.work', `completion-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}
function draft(pkg: YearPackage, patch: Partial<Draft> = {}): Draft {
  return {
    assessmentDate: pkg.assessmentDate, planDate: pkg.planDate, strengths: pkg.strengths,
    peerFeedback: pkg.peerFeedback, learningNeeds: pkg.learningNeeds, annualStandards: pkg.annualStandards,
    ...patch,
  };
}

test('ready assessment stays unconfirmed until explicit completion, independently of other steps', async () => {
  const root = storage();
  let time = '2026-10-31T18:00:00Z';
  let app = openApplication(root, { now: () => new Date(time), today: () => '2026-10-31' });
  let pkg = value(await app.operations.createYear(2026));
  expect(await app.operations.completeStep({ packageId: pkg.id, step: 'assessment', expectedRevision: pkg.assessmentRevision }))
    .toMatchObject({ ok: false, error: { code: 'NOT_READY', missing: expect.arrayContaining(['Add your strengths.']) } });
  pkg = value(await app.operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Reflect on practice' }));
  pkg = value(await app.operations.saveDraft({
    packageId: pkg.id, expectedRevision: pkg.contentRevision,
    draft: draft(pkg, { strengths: 'Listening', learningNeeds: 'Develop supervision skills', annualStandards: ['principle-ii'] }),
  }));
  expect(value(await app.operations.getWorkflow(pkg.id)).steps).toMatchObject({
    assessment: { status: 'Ready', completedAt: null }, review: { status: 'Draft' }, plan: { ready: false },
  });
  pkg = value(await app.operations.completeStep({ packageId: pkg.id, step: 'assessment', expectedRevision: pkg.assessmentRevision }));
  expect(value(await app.operations.getWorkflow(pkg.id)).steps.assessment).toMatchObject({
    status: 'Completed', completedRevision: pkg.assessmentRevision, completedAt: '2026-10-31T18:00:00.000Z',
  });
  time = '2026-11-01T18:00:00Z';
  const revision = value(await app.operations.getState()).dataRevision;
  await app.operations.completeStep({ packageId: pkg.id, step: 'assessment', expectedRevision: pkg.assessmentRevision });
  expect(value(await app.operations.getState()).dataRevision).toBe(revision);
  app.close();
  app = openApplication(root);
  expect(value(await app.operations.getWorkflow(pkg.id)).steps.assessment).toMatchObject({
    status: 'Completed', completedAt: '2026-10-31T18:00:00.000Z',
  });
  expect(value(await app.operations.getState()).years[0].status).toBe('In Progress');
  app.close();
});

test('historical declarations warn about incomplete steps and retain external date and app-entry timestamp after edits', async () => {
  const root = storage();
  let app = openApplication(root, { now: () => new Date('2026-10-31T19:00:00Z'), today: () => '2026-10-31' });
  let pkg = value(await app.operations.createYear(2024));
  const request = { packageId: pkg.id, date: '2024-12-20', expectedRevision: pkg.contentRevision };
  expect(await app.operations.recordDeclaration(request)).toMatchObject({
    ok: false, error: { code: 'CONFIRMATION_REQUIRED', message: expect.stringContaining('incomplete') },
  });
  expect(value(await app.operations.openYear(pkg.id)).declarationDate).toBeNull();
  pkg = value(await app.operations.recordDeclaration({ ...request, confirmIncomplete: true }));
  expect(pkg).toMatchObject({ declarationDate: '2024-12-20', declarationRecordedAt: '2026-10-31T19:00:00.000Z' });
  expect(value(await app.operations.getWorkflow(pkg.id)).status).toBe('In Progress');
  expect(await app.operations.recordDeclaration({
    ...request, expectedRevision: pkg.contentRevision, date: '2024-02-30', confirmIncomplete: true,
  })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  pkg = value(await app.operations.saveDraft({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, draft: draft(pkg, { strengths: 'Corrected later' }),
  }));
  app.close();
  app = openApplication(root, { now: () => new Date('2026-11-02T19:00:00Z') });
  pkg = value(await app.operations.openYear(pkg.id));
  expect(pkg).toMatchObject({
    declarationDate: '2024-12-20', declarationRecordedAt: '2026-10-31T19:00:00.000Z',
  });
  const revision = value(await app.operations.getState()).dataRevision;
  expect(value(await app.operations.recordDeclaration({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, date: '2024-12-20', confirmIncomplete: true,
  })).declarationRecordedAt).toBe('2026-10-31T19:00:00.000Z');
  expect(value(await app.operations.getState()).dataRevision).toBe(revision);
  expect(value(await app.operations.getState()).years[0].status).toBe('In Progress');
  app.close();
});

async function readyYear(ops: ApplicationOperations, year: number) {
  let pkg = value(await ops.createYear(year));
  pkg = value(await ops.saveDraft({
    packageId: pkg.id, expectedRevision: pkg.contentRevision,
    draft: draft(pkg, { strengths: 'Listening', learningNeeds: 'Reflective practice', annualStandards: ['principle-ii'] }),
  }));
  pkg = value(await ops.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Reflective practice' }));
  pkg = value(await ops.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Peer consultation', goalIds: [pkg.goals[0].id],
    status: 'Completed', completionDate: '2024-06-01', evidenceDescription: 'Consultation notes',
    applicationToPractice: 'Ask reflective questions.',
  }));
  value(await ops.recordReviewVisits({ packageId: pkg.id, pages: [...new Set([...REVIEW_SECTIONS.flatMap(section => [...section.pages]), 48])] }));
  value(await ops.launchReviewResources(pkg.id));
  return pkg;
}
async function completeYear(ops: ApplicationOperations, year: number) {
  let pkg = await readyYear(ops, year);
  for (const step of ['plan', 'assessment', 'review'] as const) pkg = value(await ops.completeStep({
    packageId: pkg.id, step, expectedRevision: pkg[`${step}Revision`],
  }));
  return value(await ops.recordDeclaration({ packageId: pkg.id, expectedRevision: pkg.contentRevision, date: '2024-12-20' }));
}

type Change = {
  name: string; affected: AnnualStep[];
  apply: (ops: ApplicationOperations, pkg: YearPackage) => Promise<unknown>;
};
const assessment = (patch: Partial<Draft>): Change['apply'] => async (ops, pkg) => value(await ops.saveDraft({
  packageId: pkg.id, expectedRevision: pkg.contentRevision, draft: draft(pkg, patch),
}));
const activity = (patch: Parameters<ApplicationOperations['updateActivity']>[0]): Change['apply'] => async (ops, pkg) => value(await ops.updateActivity({
  ...patch, packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId: pkg.activities[0].id,
}));
const activityPatch = (patch: Partial<Parameters<ApplicationOperations['updateActivity']>[0]>): Change['apply'] =>
  activity({ packageId: '', activityId: '', expectedRevision: 0, ...patch });
const changes: Change[] = [
  { name: 'strengths', affected: ['assessment'], apply: assessment({ strengths: 'Still ready after correction' }) },
  { name: 'learning needs', affected: ['assessment'], apply: assessment({ learningNeeds: 'Updated reflective needs' }) },
  { name: 'optional peer feedback', affected: ['assessment'], apply: assessment({ peerFeedback: 'Not applicable' }) },
  { name: 'assessment date', affected: ['assessment'], apply: assessment({ assessmentDate: '2024-01-01' }) },
  { name: 'annual standards', affected: ['assessment'], apply: assessment({ annualStandards: ['code-of-ethics'] }) },
  { name: 'goal creation', affected: ['assessment', 'plan'], apply: async (ops, pkg) => value(await ops.createGoal({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Second goal',
  })) },
  { name: 'goal title', affected: ['assessment', 'plan'], apply: async (ops, pkg) => value(await ops.updateGoal({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, goalId: pkg.goals[0].id, title: 'Corrected goal',
  })) },
  { name: 'goal description', affected: ['assessment', 'plan'], apply: async (ops, pkg) => value(await ops.updateGoal({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, goalId: pkg.goals[0].id, description: 'More context',
  })) },
  { name: 'goal deletion', affected: ['assessment', 'plan'], apply: async (ops, pkg) => value(await ops.deleteGoal({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, goalId: pkg.goals[0].id, confirmed: true,
  })) },
  { name: 'plan date', affected: ['plan'], apply: assessment({ planDate: '2024-01-02' }) },
  { name: 'activity title', affected: ['plan'], apply: activityPatch({ title: 'Corrected consultation title' }) },
  { name: 'activity description', affected: ['plan'], apply: activityPatch({ description: 'More context' }) },
  { name: 'activity status', affected: ['plan'], apply: activityPatch({ status: 'In Progress' }) },
  { name: 'activity date', affected: ['plan'], apply: activityPatch({ completionDate: '2024-06-02' }) },
  { name: 'activity links', affected: ['plan'], apply: activityPatch({ goalIds: [] }) },
  { name: 'evidence notes', affected: ['plan'], apply: activityPatch({ evidenceDescription: 'Corrected notes' }) },
  { name: 'evidence links', affected: ['plan'], apply: activityPatch({ evidenceLinks: ['https://example.org/learning'] }) },
  { name: 'reflection', affected: ['plan'], apply: activityPatch({ applicationToPractice: 'Corrected application' }) },
  { name: 'supplementary activity creation', affected: ['plan'], apply: async (ops, pkg) => value(await ops.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Supplementary reading',
  })) },
  { name: 'activity deletion', affected: ['plan'], apply: async (ops, pkg) => value(await ops.deleteActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId: pkg.activities[0].id, confirmed: true,
  })) },
  { name: 'review section reset', affected: ['review'], apply: async (ops, pkg) => value(await ops.resetReviewSection({
    packageId: pkg.id, sectionId: 'principle-ii',
  })) },
  { name: 'resources reset', affected: ['review'], apply: async (ops, pkg) => value(await ops.resetReviewResources(pkg.id)) },
];

test.each(changes)('$name reopens only affected manual completions, preserving declarations and the other year', async change => {
  const app = openApplication(storage(), { now: () => new Date('2026-10-31T19:00:00Z'), today: () => '2026-10-31' },
    { openExternal: async () => {}, readDocument: () => new Uint8Array() });
  const first = await completeYear(app.operations, 2024);
  const other = await completeYear(app.operations, 2025);
  expect(value(await app.operations.getState()).years.map(row => row.status)).toEqual(['Complete', 'Complete']);
  const before = value(await app.operations.getWorkflow(first.id));
  await change.apply(app.operations, first);
  const after = value(await app.operations.getWorkflow(first.id));
  for (const step of ANNUAL_STEPS) {
    if (change.affected.includes(step)) expect(after.steps[step].status).not.toBe('Completed');
    else expect(after.steps[step]).toEqual(before.steps[step]);
  }
  expect(after.status).toBe('In Progress');
  expect(value(await app.operations.openYear(first.id))).toMatchObject({
    declarationDate: '2024-12-20', declarationRecordedAt: '2026-10-31T19:00:00.000Z',
  });
  expect(value(await app.operations.getWorkflow(other.id)).status).toBe('Complete');
  app.close();
});

test('evidence import, replacement and removal reopen only the plan, even when notes keep it ready', async () => {
  const root = storage();
  const file = resolve(root, 'evidence.txt');
  writeFileSync(file, 'Retained evidence');
  const app = openApplication(root, { today: () => '2026-10-31' },
    { openExternal: async () => {}, readDocument: () => new Uint8Array() },
    { chooseFile: async () => file, openPath: async () => '' });
  let pkg = await completeYear(app.operations, 2024);
  const before = value(await app.operations.getWorkflow(pkg.id));
  let evidenceId = '';
  for (const action of ['import', 'replace', 'remove']) {
    const request = { packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision };
    if (action === 'remove') pkg = value(await app.operations.removeEvidence({ ...request, evidenceId }));
    else {
      const outcome = value(action === 'import'
        ? await app.operations.importEvidence(request)
        : await app.operations.replaceEvidence({ ...request, evidenceId }));
      if (outcome.cancelled) throw new Error('Unexpected file cancellation');
      pkg = outcome.package;
      evidenceId = outcome.attachment.id;
    }
    const changed = value(await app.operations.getWorkflow(pkg.id));
    expect(changed.steps).toMatchObject({
      review: before.steps.review, assessment: before.steps.assessment, plan: { status: 'Ready' },
    });
    pkg = value(await app.operations.completeStep({ packageId: pkg.id, step: 'plan', expectedRevision: pkg.planRevision }));
    expect(value(await app.operations.getWorkflow(pkg.id)).status).toBe('Complete');
  }
  app.close();
});

test('rereading, reader preferences, navigation, unchanged saves and evidence opens preserve every confirmation', async () => {
  const root = storage();
  let file = resolve(root, 'evidence.txt');
  writeFileSync(file, 'Retained evidence');
  const app = openApplication(root, { today: () => '2026-10-31' },
    { openExternal: async () => {}, readDocument: () => new Uint8Array() },
    { chooseFile: async () => file, openPath: async () => '' });
  let pkg = await completeYear(app.operations, 2024);
  const outcome = value(await app.operations.importEvidence({
    packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision,
  }));
  if (outcome.cancelled) throw new Error('Unexpected cancellation');
  file = resolve(root, 'evidence.png');
  writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  const image = value(await app.operations.importEvidence({
    packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: outcome.package.contentRevision,
  }));
  if (image.cancelled) throw new Error('Unexpected cancellation');
  pkg = value(await app.operations.completeStep({ packageId: pkg.id, step: 'plan', expectedRevision: image.package.planRevision }));
  const before = value(await app.operations.getWorkflow(pkg.id));
  const contentRevision = pkg.contentRevision;
  await app.operations.openYear(pkg.id);
  value(await app.operations.saveDraft({ packageId: pkg.id, expectedRevision: pkg.contentRevision, draft: draft(pkg) }));
  value(await app.operations.updateGoal({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, goalId: pkg.goals[0].id, title: pkg.goals[0].title,
  }));
  value(await app.operations.updateActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId: pkg.activities[0].id,
    title: pkg.activities[0].title, goalIds: [...pkg.activities[0].goalIds].reverse(),
  }));
  value(await app.operations.saveReviewPosition({ packageId: pkg.id, page: 48, offset: 0.2, zoom: 125 }));
  value(await app.operations.recordReviewVisits({ packageId: pkg.id, pages: [2, 48, 1] }));
  value(await app.operations.launchReviewResources(pkg.id));
  value(await app.operations.openEvidence({ packageId: pkg.id, activityId: pkg.activities[0].id, evidenceId: outcome.attachment.id }));
  value(await app.operations.previewEvidence({ packageId: pkg.id, activityId: pkg.activities[0].id, evidenceId: image.attachment.id }));
  expect(value(await app.operations.getWorkflow(pkg.id))).toEqual(before);
  expect(value(await app.operations.openYear(pkg.id)).contentRevision).toBe(contentRevision);
  app.close();
});

test('the integrated version-6 dataset upgrades without inferring completion from readiness or losing records', async () => {
  const root = storage();
  let app = openApplication(root, { today: () => '2026-10-31' },
    { openExternal: async () => {}, readDocument: () => new Uint8Array() });
  const pkg = await readyYear(app.operations, 2024);
  const review = value(await app.operations.getReview(pkg.id));
  const revision = value(await app.operations.getState()).dataRevision;
  app.close();
  const fixture = new Database(resolve(root, 'dataset/database.sqlite'));
  fixture.exec('DROP TABLE step_completions; ALTER TABLE year_packages DROP COLUMN declaration_date; ALTER TABLE year_packages DROP COLUMN declaration_recorded_at;');
  fixture.pragma('user_version = 6');
  fixture.close();
  app = openApplication(root);
  expect(value(await app.operations.openYear(pkg.id))).toEqual(pkg);
  expect(value(await app.operations.getReview(pkg.id))).toEqual(review);
  expect(value(await app.operations.getState()).dataRevision).toBe(revision);
  expect(value(await app.operations.getWorkflow(pkg.id)).steps).toMatchObject({
    review: { status: 'Ready', completedAt: null }, assessment: { status: 'Ready', completedAt: null },
    plan: { status: 'Ready', completedAt: null },
  });
  app.close();
});

test('a ready edit requires new confirmation; stale, incomplete and failed completion never rewrite the timestamp', async () => {
  const root = storage();
  let time = '2026-10-31T19:00:00Z';
  const app = openApplication(root, { now: () => new Date(time), today: () => '2026-10-31' },
    { openExternal: async () => {}, readDocument: () => new Uint8Array() });
  let pkg = await completeYear(app.operations, 2024);
  const oldRevision = pkg.assessmentRevision;
  pkg = value(await app.operations.saveDraft({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, draft: draft(pkg, { strengths: 'Corrected but still ready' }),
  }));
  expect(value(await app.operations.getWorkflow(pkg.id)).steps.assessment.status).toBe('Ready');
  expect(await app.operations.completeStep({ packageId: pkg.id, step: 'assessment', expectedRevision: oldRevision }))
    .toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  const fixture = new Database(resolve(root, 'dataset/database.sqlite'));
  fixture.exec(`CREATE TRIGGER fail_completion BEFORE UPDATE ON step_completions BEGIN SELECT RAISE(FAIL, 'disk full'); END`);
  const request = { packageId: pkg.id, step: 'assessment' as const, expectedRevision: pkg.assessmentRevision };
  expect(await app.operations.completeStep(request)).toMatchObject({ ok: false, error: { code: 'STORAGE' } });
  expect(value(await app.operations.getWorkflow(pkg.id)).steps.assessment).toMatchObject({
    status: 'Ready', completedAt: '2026-10-31T19:00:00.000Z',
  });
  fixture.exec('DROP TRIGGER fail_completion');
  time = '2026-11-01T19:00:00Z';
  pkg = value(await app.operations.completeStep(request));
  expect(value(await app.operations.getWorkflow(pkg.id)).status).toBe('Complete');
  expect(pkg.stepCompletions.assessment.completedAt).toBe('2026-11-01T19:00:00.000Z');
  const confirmations = pkg.stepCompletions;
  pkg = value(await app.operations.recordDeclaration({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, date: '2024-12-21',
  }));
  expect(pkg).toMatchObject({
    stepCompletions: confirmations, declarationDate: '2024-12-21', declarationRecordedAt: '2026-11-01T19:00:00.000Z',
  });
  expect(value(await app.operations.getWorkflow(pkg.id)).status).toBe('Complete');
  pkg = value(await app.operations.saveDraft({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, draft: draft(pkg, { strengths: '' }),
  }));
  expect(await app.operations.completeStep({ ...request, expectedRevision: pkg.assessmentRevision }))
    .toMatchObject({ ok: false, error: { code: 'NOT_READY', missing: ['Add your strengths.'] } });
  expect(value(await app.operations.openYear(pkg.id)).stepCompletions.assessment.completedAt).toBe('2026-11-01T19:00:00.000Z');
  fixture.close();
  app.close();
});
