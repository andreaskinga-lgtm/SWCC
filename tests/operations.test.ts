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
    draft: { assessmentDate: '2024-02-29', planDate: '2024-01-19', strengths: 'A still unfinished thought', peerFeedback: '', learningNeeds: '', annualStandards: [] },
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
  const draft = { assessmentDate: record.assessmentDate, planDate: record.planDate, strengths: '', learningNeeds: '', peerFeedback: '', annualStandards: [] };
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
    assessmentDate: record.assessmentDate, planDate: record.planDate, peerFeedback: '', learningNeeds: '', strengths: 'Never lose this edit', annualStandards: [],
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
  const schemaVersion = value(await app.operations.getState()).schemaVersion;
  app.close();
  const fixture = new Database(resolve(root, 'dataset/database.sqlite'));
  fixture.pragma('user_version = 999');
  fixture.close();
  expect(() => openApplication(root)).toThrow('newer than supported');
  const repair = new Database(resolve(root, 'dataset/database.sqlite'));
  repair.pragma(`user_version = ${schemaVersion}`);
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
  const schemaVersion = value(await app.operations.getState()).schemaVersion;
  app.close();
  const file = resolve(root, 'dataset/database.sqlite');
  let fixture = new Database(file);
  fixture.pragma('user_version = 0');
  fixture.close();
  expect(() => openApplication(root)).toThrow('already exists');
  fixture = new Database(file);
  fixture.pragma(`user_version = ${schemaVersion}`);
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
    draft: { assessmentDate: record.assessmentDate, planDate: record.planDate, strengths: narrative, peerFeedback: '', learningNeeds: '', annualStandards: [] },
  });
  expect(saved.ok).toBe(true);
  expect(value(await app.operations.getState()).selectedPackage?.strengths === narrative).toBe(true);
  app.close();
});

test('annual standards persist independently and advance only the assessment revision', async () => {
  const root = storage();
  let app = openApplication(root, { today: () => '2024-06-15' });
  const firstYear = value(await app.operations.createYear(2024));
  const saved = value(await app.operations.saveDraft({
    packageId: firstYear.id,
    expectedRevision: firstYear.contentRevision,
    draft: {
      assessmentDate: firstYear.assessmentDate,
      planDate: firstYear.planDate,
      strengths: '',
      peerFeedback: '',
      learningNeeds: '',
      annualStandards: ['code-of-ethics', 'principle-viii'],
    },
  }));
  expect(saved).toMatchObject({
    annualStandards: ['code-of-ethics', 'principle-viii'],
    contentRevision: 1,
    assessmentRevision: 1,
    planRevision: 0,
  });

  const secondYear = value(await app.operations.createYear(2025));
  expect(secondYear.annualStandards).toEqual([]);
  await app.operations.openYear(firstYear.id);
  app.close();

  app = openApplication(root, { today: () => '2024-06-16' });
  const reopened = value(await app.operations.getState()).selectedPackage;
  expect(reopened).toMatchObject({
    id: firstYear.id,
    annualStandards: ['code-of-ethics', 'principle-viii'],
    assessmentRevision: 1,
    planRevision: 0,
  });

  const changedPlanDate = value(await app.operations.saveDraft({
    packageId: firstYear.id,
    expectedRevision: saved.contentRevision,
    draft: {
      assessmentDate: saved.assessmentDate,
      planDate: '2023-12-30',
      strengths: saved.strengths,
      peerFeedback: saved.peerFeedback,
      learningNeeds: saved.learningNeeds,
      annualStandards: saved.annualStandards,
    },
  }));
  expect(changedPlanDate).toMatchObject({ assessmentRevision: 1, planRevision: 1 });
  const changedAssessmentDate = value(await app.operations.saveDraft({
    packageId: firstYear.id,
    expectedRevision: changedPlanDate.contentRevision,
    draft: {
      assessmentDate: '2024-06-14',
      planDate: changedPlanDate.planDate,
      strengths: changedPlanDate.strengths,
      peerFeedback: changedPlanDate.peerFeedback,
      learningNeeds: changedPlanDate.learningNeeds,
      annualStandards: changedPlanDate.annualStandards,
    },
  }));
  expect(changedAssessmentDate).toMatchObject({ assessmentRevision: 2, planRevision: 1 });
  app.close();
});

test('shared learning goals keep stable references and advance both relevant revisions', async () => {
  const root = storage();
  let app = openApplication(root, { today: () => '2024-06-15' });
  const firstYear = value(await app.operations.createYear(2024));
  const withStandard = value(await app.operations.saveDraft({
    packageId: firstYear.id,
    expectedRevision: firstYear.contentRevision,
    draft: {
      assessmentDate: firstYear.assessmentDate,
      planDate: firstYear.planDate,
      strengths: '',
      peerFeedback: '',
      learningNeeds: '',
      annualStandards: ['code-of-ethics'],
    },
  }));
  const created = value(await app.operations.createGoal({
    packageId: firstYear.id,
    expectedRevision: withStandard.contentRevision,
    title: 'Build reflective supervision practice',
  }));
  const original = created.goals[0];
  expect(original).toMatchObject({ ref: 'G1', title: 'Build reflective supervision practice', description: '' });
  expect(created.annualStandards).toEqual(['code-of-ethics']);
  expect(created).toMatchObject({ contentRevision: 2, assessmentRevision: 2, planRevision: 1 });

  const secondYear = value(await app.operations.createYear(2025));
  expect(secondYear).toMatchObject({ annualStandards: [], goals: [] });
  await app.operations.openYear(firstYear.id);
  const dataRevision = value(await app.operations.getState()).dataRevision;
  const unchanged = value(await app.operations.updateGoal({
    packageId: firstYear.id,
    goalId: original.id,
    expectedRevision: created.contentRevision,
    title: original.title,
    description: original.description,
  }));
  expect(unchanged).toMatchObject({ contentRevision: 2, assessmentRevision: 2, planRevision: 1 });
  expect(value(await app.operations.getState()).dataRevision).toBe(dataRevision);

  const updated = value(await app.operations.updateGoal({
    packageId: firstYear.id,
    goalId: original.id,
    expectedRevision: created.contentRevision,
    title: 'Strengthen reflective supervision',
  }));
  expect(updated.goals[0]).toMatchObject({
    id: original.id,
    ref: 'G1',
    title: 'Strengthen reflective supervision',
    description: '',
  });
  expect(updated).toMatchObject({ contentRevision: 3, assessmentRevision: 3, planRevision: 2 });
  const descriptionUpdated = value(await app.operations.updateGoal({
    packageId: firstYear.id,
    goalId: original.id,
    expectedRevision: updated.contentRevision,
    description: 'Seek structured consultation after complex cases.',
  }));
  expect(descriptionUpdated.goals[0]).toMatchObject({
    id: original.id,
    ref: 'G1',
    title: 'Strengthen reflective supervision',
    description: 'Seek structured consultation after complex cases.',
  });
  expect(descriptionUpdated).toMatchObject({ contentRevision: 4, assessmentRevision: 4, planRevision: 3 });
  expect(await app.operations.updateGoal({
    packageId: firstYear.id,
    goalId: original.id,
    expectedRevision: descriptionUpdated.contentRevision,
    title: '   ',
    description: descriptionUpdated.goals[0].description,
  })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });

  const deleted = value(await app.operations.deleteGoal({
    packageId: firstYear.id,
    goalId: original.id,
    expectedRevision: descriptionUpdated.contentRevision,
  }));
  expect(deleted).toMatchObject({ goals: [], contentRevision: 5, assessmentRevision: 5, planRevision: 4 });
  const next = value(await app.operations.createGoal({
    packageId: firstYear.id,
    expectedRevision: deleted.contentRevision,
    title: 'G2 remains available after G1 is removed',
  }));
  expect(next.goals[0].ref).toBe('G2');
  expect(next.goals[0].id).not.toBe(original.id);
  expect(next.annualStandards).toEqual(['code-of-ethics']);

  app.close();
  app = openApplication(root, { today: () => '2024-06-16' });
  const reopened = value(await app.operations.openYear(firstYear.id));
  expect(reopened).toMatchObject({
    goals: [{ id: next.goals[0].id, ref: 'G2', title: 'G2 remains available after G1 is removed' }],
    annualStandards: ['code-of-ethics'],
    contentRevision: 6,
    assessmentRevision: 6,
    planRevision: 5,
  });
  app.close();
});

test('review resumes per year and checks a section only after all mapped physical pages', async () => {
  const root = storage();
  let app = openApplication(root);
  const first = value(await app.operations.createYear(2026));
  const second = value(await app.operations.createYear(2025));
  expect(value(await app.operations.getReview(first.id))).toMatchObject({
    visitedPages: [], page: 1, offset: 0, zoom: 100,
    readiness: { ready: false, missing: expect.arrayContaining(['Review Code of Ethics.', 'Launch Other required resources in the default browser.']) },
  });
  let review = value(await app.operations.recordReviewVisits({ packageId: first.id, pages: [11, 15, 48] }));
  expect(review.readiness.sections.find(section => section.id === 'principle-ii')?.checked).toBe(false);
  expect(review.resourcesAvailable).toBe(true);
  review = value(await app.operations.recordReviewVisits({ packageId: first.id, pages: [12, 13, 14] }));
  expect(review.readiness.sections.find(section => section.id === 'principle-ii')?.checked).toBe(true);
  await app.operations.saveReviewPosition({ packageId: first.id, page: 15, offset: 0.375, zoom: 150 });
  app.close();
  app = openApplication(root);
  expect(value(await app.operations.getReview(first.id))).toMatchObject({ visitedPages: [11, 12, 13, 14, 15, 48], page: 15, offset: 0.375, zoom: 150 });
  expect(value(await app.operations.getReview(second.id))).toMatchObject({ visitedPages: [], page: 1, zoom: 100, resourcesAvailable: false });
  app.close();
});

test('review resets reopen only Step 1; rereading, position, and browser success never invalidate it', async () => {
  const root = storage();
  let browserFailure = true;
  const launches: string[] = [];
  const system = {
    openExternal: async (url: string) => {
      launches.push(url);
      if (browserFailure) throw new Error('No browser association');
    },
    readDocument: () => new Uint8Array(readFileSync('Code-of-Ethics-and-Standards-of-Practice-September-7-2018 (1).pdf')),
  };
  const app = openApplication(root, { now: () => new Date('2026-10-31T20:00:00Z') }, system);
  const record = value(await app.operations.createYear(2026));
  expect(await app.operations.launchReviewResources(record.id)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  expect(launches).toEqual([]);
  // These are operation claims, not viewport claims; real viewport tests exercise their producer.
  let review = value(await app.operations.recordReviewVisits({ packageId: record.id, pages: Array.from({ length: 48 }, (_, index) => index + 1) }));
  expect(review.readiness.sections.every(section => section.checked)).toBe(true);
  expect(review.readiness.missing).toEqual(['Launch Other required resources in the default browser.']);
  expect(await app.operations.launchReviewResources(record.id)).toMatchObject({ ok: false, error: { code: 'BROWSER', message: expect.stringContaining('No browser association') } });
  expect(value(await app.operations.getReview(record.id)).resourcesLaunchedAt).toBeNull();
  browserFailure = false;
  review = value(await app.operations.launchReviewResources(record.id));
  expect(launches).toEqual([
    'https://www.ocswssw.org/registrants/continuing-competence-program/',
    'https://www.ocswssw.org/registrants/continuing-competence-program/',
  ]);
  expect(review).toMatchObject({ resourcesLaunchedAt: '2026-10-31T20:00:00.000Z', readiness: { ready: true }, reviewRevision: 0 });
  const savedRevision = value(await app.operations.getState()).dataRevision;
  await app.operations.recordReviewVisits({ packageId: record.id, pages: [2, 48] });
  await app.operations.launchReviewResources(record.id);
  expect(value(await app.operations.getState()).dataRevision).toBe(savedRevision);
  await app.operations.saveReviewPosition({ packageId: record.id, page: 40, offset: 0.2, zoom: 200 });
  expect(value(await app.operations.getReview(record.id)).reviewRevision).toBe(0);
  review = value(await app.operations.resetReviewSection({ packageId: record.id, sectionId: 'principle-iv' }));
  expect(review.reviewRevision).toBe(1);
  expect(review.visitedPages).not.toContain(19);
  expect(review.visitedPages).not.toContain(26);
  expect(review.visitedPages).toContain(27);
  expect(review.readiness.missing).toEqual(['Review Principle IV: The Social Work and Social Service Work Record.']);
  review = value(await app.operations.resetReviewResources(record.id));
  expect(review).toMatchObject({ resourcesLaunchedAt: null, reviewRevision: 2 });
  await app.operations.resetReviewResources(record.id);
  await app.operations.resetReviewSection({ packageId: record.id, sectionId: 'principle-iv' });
  expect(value(await app.operations.getReview(record.id)).reviewRevision).toBe(2);
  expect(value(await app.operations.openYear(record.id))).toMatchObject({ assessmentRevision: 0, planRevision: 0, contentRevision: 0, reviewRevision: 2 });
  expect(value(await app.operations.getReviewDocument())).toEqual(system.readDocument());
  app.close();
  const reopened = openApplication(root);
  expect(value(await reopened.operations.getReview(record.id))).toMatchObject({ reviewRevision: 2, resourcesLaunchedAt: null, page: 40, offset: 0.2, zoom: 200 });
  reopened.close();
});

test.each([
  { version: 1, reviewOnly: false, label: 'foundation' },
  { version: 2, reviewOnly: false, label: 'annual standards' },
  { version: 3, reviewOnly: false, label: 'assessment and goals' },
  { version: 4, reviewOnly: false, label: 'integrated assessment, goals and review' },
  { version: 2, reviewOnly: true, label: 'parallel review' },
])('$label datasets upgrade without losing records, counters or independent revisions', async ({ version, reviewOnly }) => {
  const root = storage();
  let app = openApplication(root, { now: () => new Date('2026-10-31T20:00:00Z'), today: () => '2024-06-15' }, {
    openExternal: async () => {},
    readDocument: () => new Uint8Array(),
  });
  let record = value(await app.operations.createYear(2024));
  const standards = !reviewOnly && version >= 2 ? ['code-of-ethics'] as const : [];
  record = value(await app.operations.saveDraft({
    packageId: record.id, expectedRevision: record.contentRevision,
    draft: { assessmentDate: record.assessmentDate, planDate: '2024-06-14', strengths: 'Keep my reflection',
      learningNeeds: 'Keep my learning needs', peerFeedback: '', annualStandards: [...standards] },
  }));
  if (version >= 3) {
    record = value(await app.operations.createGoal({
      packageId: record.id, expectedRevision: record.contentRevision, title: 'Keep my shared goal',
    }));
  }
  if (reviewOnly || version >= 4) {
    value(await app.operations.recordReviewVisits({ packageId: record.id, pages: [2, 11, 48] }));
    value(await app.operations.saveReviewPosition({ packageId: record.id, page: 48, offset: 0.25, zoom: 150 }));
    value(await app.operations.launchReviewResources(record.id));
    expect(value(await app.operations.resetReviewSection({ packageId: record.id, sectionId: 'ethics' })).reviewRevision).toBe(1);
  }
  record = value(await app.operations.openYear(record.id));
  const savedReview = value(await app.operations.getReview(record.id));
  const revision = value(await app.operations.getState()).dataRevision;
  app.close();
  const fixture = new Database(resolve(root, 'dataset/database.sqlite'));
  fixture.exec('DROP TABLE activity_goal_links; DROP TABLE learning_activities; DROP INDEX goal_package_ownership;');
  if (!reviewOnly && version < 4) {
    fixture.exec('DROP TABLE review_visits; DROP TABLE review_states; ALTER TABLE year_packages DROP COLUMN review_revision;');
  }
  if (version < 3) fixture.exec('DROP TABLE learning_goals;');
  if (version === 1 || reviewOnly) fixture.exec('DROP TABLE annual_standards;');
  fixture.pragma(`user_version = ${version}`);
  fixture.close();

  app = openApplication(root);
  expect(value(await app.operations.getState())).toMatchObject({ selectedPackage: record, dataRevision: revision });
  expect(value(await app.operations.getReview(record.id))).toEqual(savedReview);
  const visited = value(await app.operations.recordReviewVisits({ packageId: record.id, pages: [4] }));
  expect(visited.reviewRevision).toBe(savedReview.reviewRevision);
  const edited = value(await app.operations.createGoal({
    packageId: record.id, expectedRevision: record.contentRevision, title: 'New goal after upgrade',
  }));
  expect(edited.goals.at(-1)?.ref).toBe(version >= 3 ? 'G2' : 'G1');
  expect(edited.goals.slice(0, -1)).toEqual(record.goals);
  expect(edited).toMatchObject({
    assessmentRevision: record.assessmentRevision + 1, planRevision: record.planRevision + 1,
    reviewRevision: savedReview.reviewRevision, annualStandards: record.annualStandards,
  });
  expect(value(await app.operations.getReview(record.id))).toEqual(visited);
  app.close();
  app = openApplication(root);
  expect(value(await app.operations.getState()).selectedPackage).toEqual(edited);
  expect(value(await app.operations.getReview(record.id))).toEqual(visited);
  app.close();
});

test('an ambiguous parallel schema fails explicitly without replacing the saved review or schema', async () => {
  const root = storage();
  const app = openApplication(root);
  const record = value(await app.operations.createYear(2024));
  await app.operations.recordReviewVisits({ packageId: record.id, pages: [48] });
  app.close();
  const fixture = new Database(resolve(root, 'dataset/database.sqlite'));
  fixture.exec('DROP TABLE annual_standards; DROP TABLE learning_goals; DROP TABLE review_states;');
  fixture.pragma('user_version = 2');
  fixture.close();
  expect(() => openApplication(root)).toThrow('unrecognized migration layout');
  const preserved = new Database(resolve(root, 'dataset/database.sqlite'));
  expect(preserved.pragma('user_version', { simple: true })).toBe(2);
  expect(preserved.prepare('SELECT id FROM year_packages').get()).toEqual({ id: record.id });
  expect(preserved.prepare('SELECT page FROM review_visits').all()).toEqual([{ page: 48 }]);
  expect(preserved.prepare("SELECT name FROM sqlite_master WHERE name = 'annual_standards'").get()).toBeUndefined();
  preserved.close();
});
