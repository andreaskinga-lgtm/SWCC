import Database from 'better-sqlite3';
import { mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { localDate, SOURCE_SET_ID, validDate } from '../../shared/application.js';
import type { ApplicationOperations, AppState, Draft, OperationError, Result, SaveDraft, YearPackage } from '../../shared/application.js';
import { migrate, SCHEMA_VERSION } from './migrations.js';
import { storageLayout } from './storage.js';

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
  if (!input.draft || typeof input.draft !== 'object' || Object.keys(input.draft).some(key => !keys.includes(key as keyof Draft))) fail('VALIDATION', 'The draft contains unsupported fields.');
  for (const key of keys) {
    if (typeof input.draft[key] !== 'string') fail('VALIDATION', 'Draft fields must be text.');
  }
  for (const key of ['assessmentDate', 'planDate'] as const) {
    if (input.draft[key] !== '' && !validDate(input.draft[key])) fail('VALIDATION', 'Use a valid YYYY-MM-DD date, or leave it blank in a draft.');
  }
}

export function openApplication(storageRoot: string, clock: { now?: () => Date; today?: () => string } = {}) {
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
    created_at AS createdAt, updated_at AS updatedAt FROM year_packages`;
  function getPackage(id: string): YearPackage {
    const record = database.prepare(`${packageSelect} WHERE id = ?`).get(id) as YearPackage | undefined;
    if (!record) fail('NOT_FOUND', 'This year package no longer exists. Open All years to choose another.');
    return record;
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
      const assessmentChanged = ['assessmentDate', 'strengths', 'peerFeedback', 'learningNeeds'].some(key => record[key as keyof Draft] !== draft[key as keyof Draft]);
      const planChanged = record.planDate !== draft.planDate;
      if (!assessmentChanged && !planChanged) return record;
      database.prepare(`UPDATE year_packages SET assessment_date = ?, plan_date = ?, strengths = ?, peer_feedback = ?, learning_needs = ?,
        content_revision = content_revision + 1, assessment_revision = assessment_revision + ?, plan_revision = plan_revision + ?, updated_at = ?
        WHERE id = ?`).run(draft.assessmentDate, draft.planDate, draft.strengths, draft.peerFeedback, draft.learningNeeds,
        Number(assessmentChanged), Number(planChanged), now(), input.packageId);
      database.prepare('UPDATE app_metadata SET data_revision = data_revision + 1 WHERE id = 1').run();
      return getPackage(input.packageId);
    }).immediate()),
    acknowledgeStorage: () => operation(() => {
      database.prepare('UPDATE app_metadata SET acknowledged_at = ?, data_revision = data_revision + 1 WHERE id = 1 AND acknowledged_at IS NULL').run(now());
      return state();
    }),
  };
  return { operations, close: () => database.close() };
}
