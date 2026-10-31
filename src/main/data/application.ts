import Database from 'better-sqlite3';
import { mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ANNUAL_STANDARDS, localDate, SOURCE_SET_ID, validDate } from '../../shared/application.js';
import type {
  AnnualStandardId, ApplicationOperations, AppState, CreateGoal, DeleteGoal, Draft, Goal,
  OperationError, Result, SaveDraft, UpdateGoal, YearPackage,
} from '../../shared/application.js';
import { migrate, SCHEMA_VERSION } from './migrations.js';
import { storageLayout } from './storage.js';
import { reviewOperations } from './review.js';
import type { ReviewSystem } from './review.js';

class ApplicationFailure extends Error {
  constructor(readonly detail: OperationError) { super(detail.message); }
}
function fail(code: OperationError['code'], message: string): never {
  throw new ApplicationFailure({ code, message });
}
function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[\da-f-]{36}$/i.test(value)) fail('VALIDATION', 'Choose a valid year package.');
}
function validateSave(input: SaveDraft) {
  if (!input || typeof input !== 'object') fail('VALIDATION', 'The draft request is invalid. Your edits have not been saved.');
  identifier(input.packageId);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('VALIDATION', 'The draft revision is invalid.');
  const keys: (keyof Draft)[] = ['assessmentDate', 'planDate', 'strengths', 'peerFeedback', 'learningNeeds'];
  if (!input.draft || typeof input.draft !== 'object' || Object.keys(input.draft).some(key => ![...keys, 'annualStandards'].includes(key as keyof Draft))) fail('VALIDATION', 'The draft contains unsupported fields.');
  for (const key of keys) {
    if (typeof input.draft[key] !== 'string') fail('VALIDATION', 'Draft fields must be text.');
  }
  if (!Array.isArray(input.draft.annualStandards)
    || input.draft.annualStandards.some((id: unknown) => !ANNUAL_STANDARDS.some(standard => standard.id === id))
    || new Set(input.draft.annualStandards).size !== input.draft.annualStandards.length) {
    fail('VALIDATION', 'Choose each supported annual standard at most once.');
  }
  for (const key of ['assessmentDate', 'planDate'] as const) {
    if (input.draft[key] !== '' && !validDate(input.draft[key])) fail('VALIDATION', 'Use a valid YYYY-MM-DD date, or leave it blank in a draft.');
  }
}
function validateGoalRequest(input: unknown, allowedKeys: readonly string[]) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('VALIDATION', 'The learning-goal request is invalid.');
  const request = input as Record<string, unknown>;
  if (Object.keys(request).some(key => !allowedKeys.includes(key))) fail('VALIDATION', 'The learning-goal request contains unsupported fields.');
  identifier(request.packageId);
  if (!Number.isSafeInteger(request.expectedRevision) || (request.expectedRevision as number) < 0) fail('VALIDATION', 'The package revision is invalid.');
  return request;
}
function validateCreateGoal(input: CreateGoal) {
  const request = validateGoalRequest(input, ['packageId', 'expectedRevision', 'title', 'description']);
  if (typeof request.title !== 'string' || !request.title.trim()) fail('VALIDATION', 'Enter a learning-goal title before saving.');
  if (request.description !== undefined && typeof request.description !== 'string') fail('VALIDATION', 'The learning-goal description must be text.');
}
function validateUpdateGoal(input: UpdateGoal) {
  const request = validateGoalRequest(input, ['packageId', 'goalId', 'expectedRevision', 'title', 'description']);
  identifier(request.goalId);
  if (request.title !== undefined && (typeof request.title !== 'string' || !request.title.trim())) fail('VALIDATION', 'A learning-goal title cannot be blank.');
  if (request.description !== undefined && typeof request.description !== 'string') fail('VALIDATION', 'The learning-goal description must be text.');
}
function validateDeleteGoal(input: DeleteGoal) {
  const request = validateGoalRequest(input, ['packageId', 'goalId', 'expectedRevision']);
  identifier(request.goalId);
}

export function openApplication(storageRoot: string, clock: { now?: () => Date; today?: () => string } = {}, reviewSystem?: ReviewSystem) {
  const paths = storageLayout(storageRoot);
  const dataset = paths.dataset;
  const databaseFile = paths.database;
  let db: Database.Database | undefined;
  try {
    mkdirSync(dataset, { recursive: true });
    if (!existsSync(databaseFile) && readdirSync(dataset).length > 0) throw new Error('The database is missing from an existing dataset. Recover the complete dataset from a backup.');
    if (existsSync(databaseFile) && statSync(databaseFile).size === 0) throw new Error('The database is empty. Preserve the dataset and recover from a backup.');
    db = new Database(databaseFile);
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('SQLite integrity check failed.');
    migrate(db);
    if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Dataset relationships are invalid.');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    mkdirSync(paths.evidence, { recursive: true });
  } catch (error) {
    db?.close();
    throw new Error(`Cannot open local records: ${error instanceof Error ? error.message : String(error)} The existing dataset has not been replaced.`, { cause: error });
  }
  const database = db;
  const now = () => (clock.now?.() ?? new Date()).toISOString();
  const today = () => clock.today?.() ?? localDate();
  const packageSelect = `SELECT id, year, source_set_id AS sourceSetId, assessment_date AS assessmentDate,
    plan_date AS planDate, strengths, peer_feedback AS peerFeedback, learning_needs AS learningNeeds,
    content_revision AS contentRevision, assessment_revision AS assessmentRevision, plan_revision AS planRevision,
    review_revision AS reviewRevision, created_at AS createdAt, updated_at AS updatedAt FROM year_packages`;
  function getGoals(packageId: string): Goal[] {
    const rows = database.prepare(`SELECT id, package_id AS packageId, reference_number AS referenceNumber,
      title, description, created_at AS createdAt, updated_at AS updatedAt
      FROM learning_goals WHERE package_id = ? ORDER BY reference_number`).all(packageId) as
      (Omit<Goal, 'ref'> & { referenceNumber: number })[];
    return rows.map(({ referenceNumber, ...goal }) => ({ ...goal, ref: `G${referenceNumber}` }));
  }
  function getPackage(id: string): YearPackage {
    const record = database.prepare(`${packageSelect} WHERE id = ?`).get(id) as Omit<YearPackage, 'annualStandards' | 'goals'> | undefined;
    if (!record) fail('NOT_FOUND', 'This year package no longer exists. Open All years to choose another.');
    const selected = new Set((database.prepare('SELECT standard_id AS standardId FROM annual_standards WHERE package_id = ?')
      .all(id) as { standardId: string }[]).map(row => row.standardId));
    return {
      ...record,
      annualStandards: ANNUAL_STANDARDS.filter(standard => selected.has(standard.id)).map(standard => standard.id),
      goals: getGoals(id),
    };
  }
  function advanceGoalRevisions(packageId: string, timestamp: string) {
    database.prepare(`UPDATE year_packages SET content_revision = content_revision + 1,
      assessment_revision = assessment_revision + 1, plan_revision = plan_revision + 1, updated_at = ? WHERE id = ?`)
      .run(timestamp, packageId);
    database.prepare('UPDATE app_metadata SET data_revision = data_revision + 1 WHERE id = 1').run();
  }
  function state(): AppState {
    const meta = database.prepare(`SELECT selected_package_id AS selectedPackageId, acknowledged_at AS acknowledgedAt,
      data_revision AS dataRevision, last_backup_at AS lastBackupAt, last_backup_revision AS lastBackupRevision FROM app_metadata WHERE id = 1`)
      .get() as { selectedPackageId: string | null } & Omit<AppState, 'years' | 'selectedPackage' | 'schemaVersion' | 'storageDirectory'>;
    return {
      years: database.prepare('SELECT id, year, content_revision AS contentRevision FROM year_packages ORDER BY year DESC').all() as AppState['years'],
      selectedPackage: meta.selectedPackageId ? getPackage(meta.selectedPackageId) : null,
      acknowledgedAt: meta.acknowledgedAt,
      dataRevision: meta.dataRevision,
      lastBackupAt: meta.lastBackupAt,
      lastBackupRevision: meta.lastBackupRevision,
      schemaVersion: SCHEMA_VERSION,
      storageDirectory: dataset,
    };
  }
  async function operation<T>(work: () => T): Promise<Result<T>> {
    try { return { ok: true, value: work() }; }
    catch (error) {
      return { ok: false, error: error instanceof ApplicationFailure ? error.detail : {
        code: 'STORAGE',
        message: `Local records could not be saved or read: ${error instanceof Error ? error.message : String(error)}. Keep this window open, check available disk space and folder permissions, then retry.`,
      } };
    }
  }
  const operations: ApplicationOperations = {
    ...reviewOperations(database, now, reviewSystem),
    getState: () => operation(state),
    createYear: year => operation(() => database.transaction(() => {
      if (!Number.isInteger(year) || year < 1 || year > 9999) fail('VALIDATION', 'Enter a calendar year from 1 to 9999.');
      const existing = database.prepare('SELECT id FROM year_packages WHERE year = ?').get(year) as { id: string } | undefined;
      if (existing) throw new ApplicationFailure({ code: 'DUPLICATE_YEAR', message: `${year} already has a package. Open the existing year instead.`, existingPackageId: existing.id });
      const id = randomUUID();
      const timestamp = now();
      const date = today();
      if (!validDate(date)) fail('VALIDATION', 'The local system date is invalid. Correct it before creating a year.');
      database.prepare(`INSERT INTO year_packages(id, year, source_set_id, assessment_date, plan_date, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?)`).run(id, year, SOURCE_SET_ID, date, date, timestamp, timestamp);
      for (const kind of ['G', 'A', 'E']) database.prepare('INSERT INTO reference_counters(package_id, kind) VALUES(?, ?)').run(id, kind);
      database.prepare('UPDATE app_metadata SET selected_package_id = ?, data_revision = data_revision + 1 WHERE id = 1').run(id);
      return getPackage(id);
    }).immediate()),
    openYear: id => operation(() => {
      identifier(id);
      const record = getPackage(id);
      database.prepare('UPDATE app_metadata SET selected_package_id = ? WHERE id = 1').run(id);
      return record;
    }),
    saveDraft: input => operation(() => database.transaction(() => {
      validateSave(input);
      const record = getPackage(input.packageId);
      if (record.contentRevision !== input.expectedRevision) fail('CONFLICT', 'This package changed since it was opened. Saving is blocked to avoid overwriting changes. Copy your unsaved text elsewhere for recovery; restart only after preserving your edits, then reconcile them with the saved record.');
      const draft = input.draft;
      const standardsChanged = record.annualStandards.length !== draft.annualStandards.length
        || record.annualStandards.some(id => !draft.annualStandards.includes(id));
      const assessmentChanged = ['assessmentDate', 'strengths', 'peerFeedback', 'learningNeeds'].some(key => record[key as keyof Draft] !== draft[key as keyof Draft])
        || standardsChanged;
      const planChanged = record.planDate !== draft.planDate;
      if (!assessmentChanged && !planChanged) return record;
      database.prepare(`UPDATE year_packages SET assessment_date = ?, plan_date = ?, strengths = ?, peer_feedback = ?, learning_needs = ?,
        content_revision = content_revision + 1, assessment_revision = assessment_revision + ?, plan_revision = plan_revision + ?, updated_at = ?
        WHERE id = ?`).run(draft.assessmentDate, draft.planDate, draft.strengths, draft.peerFeedback, draft.learningNeeds,
        Number(assessmentChanged), Number(planChanged), now(), input.packageId);
      if (standardsChanged) {
        database.prepare('DELETE FROM annual_standards WHERE package_id = ?').run(input.packageId);
        const insert = database.prepare('INSERT INTO annual_standards(package_id, standard_id) VALUES(?, ?)');
        for (const id of draft.annualStandards as AnnualStandardId[]) insert.run(input.packageId, id);
      }
      database.prepare('UPDATE app_metadata SET data_revision = data_revision + 1 WHERE id = 1').run();
      return getPackage(input.packageId);
    }).immediate()),
    createGoal: input => operation(() => database.transaction(() => {
      validateCreateGoal(input);
      const record = getPackage(input.packageId);
      if (record.contentRevision !== input.expectedRevision) fail('CONFLICT', 'This package changed since it was opened. Saving is blocked to avoid overwriting changes. Retry after reopening the current year.');
      const counter = database.prepare('SELECT next_number AS nextNumber FROM reference_counters WHERE package_id = ? AND kind = ?')
        .get(input.packageId, 'G') as { nextNumber: number } | undefined;
      if (!counter) fail('STORAGE', 'The learning-goal reference counter is missing. Preserve this dataset and retry after recovery.');
      const timestamp = now();
      const id = randomUUID();
      database.prepare('UPDATE reference_counters SET next_number = next_number + 1 WHERE package_id = ? AND kind = ?').run(input.packageId, 'G');
      database.prepare(`INSERT INTO learning_goals(id, package_id, reference_number, title, description, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?)`).run(id, input.packageId, counter.nextNumber, input.title, input.description ?? '', timestamp, timestamp);
      advanceGoalRevisions(input.packageId, timestamp);
      return getPackage(input.packageId);
    }).immediate()),
    updateGoal: input => operation(() => database.transaction(() => {
      validateUpdateGoal(input);
      const record = getPackage(input.packageId);
      if (record.contentRevision !== input.expectedRevision) fail('CONFLICT', 'This package changed since it was opened. Saving is blocked to avoid overwriting changes. Retry after reopening the current year.');
      const goal = database.prepare(`SELECT title, description FROM learning_goals WHERE id = ? AND package_id = ?`)
        .get(input.goalId, input.packageId) as { title: string; description: string } | undefined;
      if (!goal) fail('NOT_FOUND', 'This learning goal no longer exists in this year.');
      const title = input.title ?? goal.title;
      const description = input.description ?? goal.description;
      if (title === goal.title && description === goal.description) return record;
      const timestamp = now();
      database.prepare('UPDATE learning_goals SET title = ?, description = ?, updated_at = ? WHERE id = ? AND package_id = ?')
        .run(title, description, timestamp, input.goalId, input.packageId);
      advanceGoalRevisions(input.packageId, timestamp);
      return getPackage(input.packageId);
    }).immediate()),
    deleteGoal: input => operation(() => database.transaction(() => {
      validateDeleteGoal(input);
      const record = getPackage(input.packageId);
      if (record.contentRevision !== input.expectedRevision) fail('CONFLICT', 'This package changed since it was opened. Saving is blocked to avoid overwriting changes. Retry after reopening the current year.');
      const deleted = database.prepare('DELETE FROM learning_goals WHERE id = ? AND package_id = ?').run(input.goalId, input.packageId);
      if (!deleted.changes) fail('NOT_FOUND', 'This learning goal no longer exists in this year.');
      advanceGoalRevisions(input.packageId, now());
      return getPackage(input.packageId);
    }).immediate()),
    acknowledgeStorage: () => operation(() => {
      database.prepare('UPDATE app_metadata SET acknowledged_at = ?, data_revision = data_revision + 1 WHERE id = 1 AND acknowledged_at IS NULL').run(now());
      return state();
    }),
  };
  return { operations, close: () => database.close() };
}
