import Database from 'better-sqlite3';
import { mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ANNUAL_STANDARDS, localDate, SOURCE_SET_ID, validDate } from '../../shared/application.js';
import type {
  AnnualStandardId, ApplicationOperations, AppState, CreateGoal, DeleteActivity, DeleteGoal, DeleteYear,
  Draft, Goal, OperationError, Result, SaveDraft, UpdateGoal, YearPackage,
} from '../../shared/application.js';
import { migrate, SCHEMA_VERSION } from './migrations.js';
import { storageLayout } from './storage.js';
import { readReviewProgress, reviewOperations } from './review.js';
import type { ReviewSystem } from './review.js';
import { activityOperations, getActivities } from './activities.js';
import { evaluatePlanReadiness, validEvidenceLink } from '../../shared/plan.js';
import { evidenceOperations, EvidenceCleanupFailure, recoverEvidenceDeletions } from './evidence.js';
import type { EvidenceSystem } from './evidence.js';
import { ANNUAL_STEPS, evaluateWorkflow, packageStatus } from '../../shared/workflow.js';
import type { AnnualStep, StepCompletion } from '../../shared/workflow.js';
import { formsExportWarnings } from '../../shared/forms.js';
import { exportAnnualForms } from '../export/forms.js';
import type { FormsSystem } from '../export/forms.js';
import { createFullBackup } from './backup.js';
import type { BackupSystem } from './backup.js';
import type { BackupProgress } from '../../shared/backup.js';
import { exportAnnualPortfolio } from '../export/portfolio.js';
import type { PortfolioSystem } from '../export/portfolio.js';
import type { PortfolioProgress } from '../../shared/portfolio.js';
import { datasetSummary, inspectArchive, RestoreCleanupFailure } from './restore.js';
import { recoverRestore, recoveryJournalExists, replaceDataset } from './restore-recovery.js';
import type { RestoreSystem } from './restore.js';
import type { RestoreProgress } from '../../shared/restore.js';
import { rm } from 'node:fs/promises';

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
  const request = validateGoalRequest(input, ['packageId', 'expectedRevision', 'title', 'description', 'activityId']);
  if (typeof request.title !== 'string' || !request.title.trim()) fail('VALIDATION', 'Enter a learning-goal title before saving.');
  if (request.description !== undefined && typeof request.description !== 'string') fail('VALIDATION', 'The learning-goal description must be text.');
  if (request.activityId !== undefined) identifier(request.activityId);
}
function validateUpdateGoal(input: UpdateGoal) {
  const request = validateGoalRequest(input, ['packageId', 'goalId', 'expectedRevision', 'title', 'description']);
  identifier(request.goalId);
  if (request.title !== undefined && (typeof request.title !== 'string' || !request.title.trim())) fail('VALIDATION', 'A learning-goal title cannot be blank.');
  if (request.description !== undefined && typeof request.description !== 'string') fail('VALIDATION', 'The learning-goal description must be text.');
}
function validateDeleteGoal(input: DeleteGoal) {
  const request = validateGoalRequest(input, ['packageId', 'goalId', 'expectedRevision', 'confirmed']);
  if (request.confirmed !== true) fail('CONFIRMATION_REQUIRED', 'Confirm this goal deletion before continuing.');
  identifier(request.goalId);
}
function validateDeleteActivity(input: DeleteActivity) {
  const request = validateGoalRequest(input, ['packageId', 'activityId', 'expectedRevision', 'confirmed']);
  if (request.confirmed !== true) fail('CONFIRMATION_REQUIRED', 'Confirm this activity and its evidence deletion before continuing.');
  identifier(request.activityId);
}
function validateDeleteYear(input: DeleteYear) {
  const request = validateGoalRequest(input, ['packageId', 'expectedRevision', 'confirmed']);
  if (request.confirmed !== true) fail('CONFIRMATION_REQUIRED', 'Confirm this year package and its managed evidence deletion before continuing.');
}

export function openApplication(
  storageRoot: string,
  clock: { now?: () => Date; today?: () => string } = {},
  reviewSystem?: ReviewSystem,
  evidenceSystem?: EvidenceSystem,
  formsSystem?: FormsSystem,
  backupSystem?: BackupSystem,
  restoreSystem?: RestoreSystem,
  portfolioSystem?: PortfolioSystem,
) {
  const paths = storageLayout(storageRoot);
  const dataset = paths.dataset;
  const databaseFile = paths.database;
  let db: Database.Database | undefined;
  function openDatabase() {
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
      recoverEvidenceDeletions(db, paths.evidence);
    } catch (error) {
      if (db?.open) db.close();
      throw new Error(`Cannot open local records: ${error instanceof Error ? error.message : String(error)} The existing dataset has not been replaced.`, { cause: error });
    }
    return db;
  }
  let recoveryNotice: string | null;
  try { recoveryNotice = recoverRestore(paths, restoreSystem?.boundary, () => { openDatabase(); }); }
  catch (error) {
    if (db?.open) db.close();
    throw error;
  }
  let database = db?.open ? db : openDatabase();
  const now = () => (clock.now?.() ?? new Date()).toISOString();
  const today = () => clock.today?.() ?? localDate();
  const packageSelect = `SELECT id, year, source_set_id AS sourceSetId, assessment_date AS assessmentDate,
    plan_date AS planDate, strengths, peer_feedback AS peerFeedback, learning_needs AS learningNeeds,
    content_revision AS contentRevision, assessment_revision AS assessmentRevision, plan_revision AS planRevision,
    review_revision AS reviewRevision, declaration_date AS declarationDate, declaration_recorded_at AS declarationRecordedAt,
    created_at AS createdAt, updated_at AS updatedAt FROM year_packages`;
  function getGoals(packageId: string): Goal[] {
    const rows = database.prepare(`SELECT id, package_id AS packageId, reference_number AS referenceNumber,
      title, description, created_at AS createdAt, updated_at AS updatedAt
      FROM learning_goals WHERE package_id = ? ORDER BY reference_number`).all(packageId) as
      (Omit<Goal, 'ref'> & { referenceNumber: number })[];
    return rows.map(({ referenceNumber, ...goal }) => ({ ...goal, ref: `G${referenceNumber}` }));
  }
  function getPackage(id: string): YearPackage {
    const record = database.prepare(`${packageSelect} WHERE id = ?`).get(id) as Omit<YearPackage, 'annualStandards' | 'goals' | 'activities'> | undefined;
    if (!record) fail('NOT_FOUND', 'This year package no longer exists. Open All years to choose another.');
    const selected = new Set((database.prepare('SELECT standard_id AS standardId FROM annual_standards WHERE package_id = ?')
      .all(id) as { standardId: string }[]).map(row => row.standardId));
    const completions = database.prepare(`SELECT step, completed_revision AS completedRevision, completed_at AS completedAt
      FROM step_completions WHERE package_id = ?`).all(id) as (StepCompletion & { step: AnnualStep })[];
    const completion = (step: AnnualStep): StepCompletion => {
      const saved = completions.find(row => row.step === step);
      return { completedRevision: saved?.completedRevision ?? null, completedAt: saved?.completedAt ?? null };
    };
    return {
      ...record,
      stepCompletions: { review: completion('review'), assessment: completion('assessment'), plan: completion('plan') },
      annualStandards: ANNUAL_STANDARDS.filter(standard => selected.has(standard.id)).map(standard => standard.id),
      goals: getGoals(id),
      activities: getActivities(database, id),
    };
  }
  function advanceGoalRevisions(packageId: string, timestamp: string) {
    database.prepare(`UPDATE year_packages SET content_revision = content_revision + 1,
      assessment_revision = assessment_revision + 1, plan_revision = plan_revision + 1, updated_at = ? WHERE id = ?`)
      .run(timestamp, packageId);
    database.prepare('UPDATE app_metadata SET data_revision = data_revision + 1 WHERE id = 1').run();
  }
  function advanceActivityRevisions(packageId: string, timestamp: string) {
    database.prepare(`UPDATE year_packages SET content_revision = content_revision + 1,
      plan_revision = plan_revision + 1, updated_at = ? WHERE id = ?`).run(timestamp, packageId);
    database.prepare('UPDATE app_metadata SET data_revision = data_revision + 1 WHERE id = 1').run();
  }
  function state(): AppState {
    const meta = database.prepare(`SELECT selected_package_id AS selectedPackageId, acknowledged_at AS acknowledgedAt,
      data_revision AS dataRevision, last_backup_at AS lastBackupAt, last_backup_revision AS lastBackupRevision FROM app_metadata WHERE id = 1`)
      .get() as { selectedPackageId: string | null } & Omit<AppState, 'years' | 'selectedPackage' | 'schemaVersion' | 'storageDirectory'>;
    return {
      years: (database.prepare('SELECT id, year, content_revision AS contentRevision FROM year_packages ORDER BY year DESC')
        .all() as Omit<AppState['years'][number], 'status'>[]).map(row => ({
        ...row, status: packageStatus(getPackage(row.id), readReviewProgress(database, row.id)),
      })),
      selectedPackage: meta.selectedPackageId ? getPackage(meta.selectedPackageId) : null,
      acknowledgedAt: meta.acknowledgedAt,
      dataRevision: meta.dataRevision,
      lastBackupAt: meta.lastBackupAt,
      lastBackupRevision: meta.lastBackupRevision,
      schemaVersion: SCHEMA_VERSION,
      storageDirectory: dataset,
      recoveryNotice,
    };
  }
  async function operation<T>(work: () => T | Promise<T>, failureMessage = 'Local records could not be saved or read'): Promise<Result<T>> {
    try { return { ok: true, value: await work() }; }
    catch (error) {
      if (error instanceof EvidenceCleanupFailure) return {
        ok: false,
        error: { code: 'STORAGE', message: error.message, committed: true, recoveryPath: error.recoveryPath },
      };
      return { ok: false, error: error instanceof ApplicationFailure ? error.detail : {
        code: 'STORAGE',
        message: `${failureMessage}: ${error instanceof Error ? error.message : String(error)}. Keep this window open, check available disk space and folder permissions, then retry.`,
      } };
    }
  }
  let evidence = evidenceOperations(database, paths.evidence, getPackage, now, fail, identifier, evidenceSystem);
  let review = reviewOperations(database, now, reviewSystem);
  function reopen() {
    database = openDatabase();
    evidence = evidenceOperations(database, paths.evidence, getPackage, now, fail, identifier, evidenceSystem);
    review = reviewOperations(database, now, reviewSystem);
  }
  let backupController: AbortController | null = null;
  let portfolioController: AbortController | null = null;
  const idleProgress = (): BackupProgress => ({
    phase: 'idle', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0,
  });
  let backupProgress = idleProgress();
  let portfolioProgress: PortfolioProgress = idleProgress();
  let restoreController: AbortController | null = null;
  let restoreDirectory: string | null = null;
  let validatedPreview: Awaited<ReturnType<typeof inspectArchive>> | null = null;
  let previewRevision: number | null = null;
  let replacing = false;
  const idleRestore = (): RestoreProgress => ({ phase: 'idle', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0 });
  let restoreProgress = idleRestore();
  let inspecting: Promise<Result<import('../../shared/restore.js').RestoreInspectionOutcome>> | null = null;
  const mutations = new Set<Promise<unknown>>();
  const operations: ApplicationOperations = {
    replaceFullDataset: input => operation(async () => {
      if (replacing || restoreController || backupController || portfolioController) fail('BUSY', 'A backup, portfolio export or restore is running. Wait for it to finish.');
      if (!input || input.confirmed !== true || Object.keys(input).some(key => !['previewId', 'confirmed'].includes(key))
        || !validatedPreview || input.previewId !== validatedPreview.preview.id)
        fail('CONFIRMATION_REQUIRED', 'Inspect a complete full backup and explicitly confirm that validated preview before replacing all years.');
      replacing = true;
      const incoming = validatedPreview;
      try {
        restoreProgress = { ...restoreProgress, phase: 'protecting' };
        await Promise.allSettled([...mutations]);
        if (state().dataRevision !== previewRevision) fail('CONFLICT', 'Your current data changed since this preview. Inspect again before confirming replacement.');
        const outcome = await replaceDataset(database, paths, incoming, now(), restoreSystem,
          async () => { await Promise.allSettled([...mutations]); }, () => { if (database.open) database.close(); },
          reopen, (phase, progress) => {
            restoreProgress = { phase, filesCompleted: progress?.filesCompleted ?? 0, filesTotal: progress?.filesTotal ?? 0,
              bytesCompleted: progress?.bytesCompleted ?? 0, bytesTotal: progress?.bytesTotal ?? 0 };
          }, fail);
        return { state: state(), ...outcome };
      } finally {
        replacing = false;
        validatedPreview = null;
        previewRevision = null;
        if (restoreDirectory && !recoveryJournalExists(paths)) await rm(restoreDirectory, { recursive: true, force: true });
        restoreDirectory = null;
        restoreProgress = idleRestore();
      }
    }),
    exportPortfolio: input => operation(async () => {
      if (backupController || portfolioController || restoreController || replacing || !database.open || recoveryJournalExists(paths))
        fail('BUSY', 'An archive operation or restore recovery is running. Wait for it to finish before exporting a portfolio.');
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(key => !['packageId', 'confirmDraft'].includes(key))
        || (input.confirmDraft !== undefined && input.confirmDraft !== true))
        fail('VALIDATION', 'Choose a year package and confirm any draft warning before exporting.');
      identifier(input.packageId);
      const { packageId, confirmDraft } = input;
      const controller = new AbortController();
      portfolioController = controller;
      portfolioProgress = { ...idleProgress(), phase: 'waiting' };
      try {
        let stopped!: () => void;
        const cancelled = new Promise<void>(resolveCancelled => { stopped = resolveCancelled; });
        controller.signal.addEventListener('abort', stopped, { once: true });
        try { await Promise.race([Promise.allSettled([...mutations]), cancelled]); }
        finally { controller.signal.removeEventListener('abort', stopped); }
        if (controller.signal.aborted) return { cancelled: true };
        portfolioProgress = { ...idleProgress(), phase: 'snapshot' };
        const snapshot = database.transaction(() => {
          const record = getPackage(packageId);
          const review = readReviewProgress(database, record.id);
          const attachments = evidence.getEvidence(record.id);
          const workflow = evaluateWorkflow(record, review, today(), new Set(attachments
            .filter(entry => entry.integrity === 'readable').map(entry => entry.activityId)));
          const missing = formsExportWarnings(record, workflow);
          if (missing.length && !confirmDraft) throw new ApplicationFailure({
            code: 'CONFIRMATION_REQUIRED', message: 'This annual package is incomplete. Review the missing items and explicitly export a draft.', missing,
          });
          const rows = database.prepare('SELECT id, managed_path AS managedPath FROM evidence_attachments WHERE package_id = ?')
            .all(record.id) as { id: string; managedPath: string }[];
          const meta = database.prepare('SELECT data_revision AS dataRevision FROM app_metadata WHERE id = 1').get() as { dataRevision: number };
          return { package: record, review, attachments, ...meta,
            evidenceFiles: attachments.map(attachment => ({
              attachment, managedPath: rows.find(row => row.id === attachment.id)!.managedPath,
            })) };
        })();
        if (!formsSystem || !portfolioSystem) fail('EXPORT', 'The portfolio export resources or destination dialog are unavailable. No output was published.');
        return await exportAnnualPortfolio(snapshot, paths, now(), formsSystem, portfolioSystem, controller.signal,
          progress => { portfolioProgress = progress; }, fail);
      } finally {
        portfolioController = null;
        portfolioProgress = idleProgress();
      }
    }, 'Complete Portfolio ZIP could not be completed. No output was published'),
    getPortfolioProgress: () => operation(() => ({ ...portfolioProgress })),
    cancelPortfolioExport: () => operation(() => {
      if (portfolioProgress.phase === 'publishing') fail('BUSY', 'The complete portfolio is being published. Wait for publication to finish.');
      portfolioController?.abort();
    }),
    inspectFullBackup: () => {
      if (restoreController || restoreDirectory || backupController || portfolioController || replacing || !database.open || recoveryJournalExists(paths))
        return operation(() => fail('BUSY', 'Finish or cancel the current archive operation or recover local records before choosing another archive.'));
      restoreController = new AbortController();
      const controller = restoreController;
      restoreProgress = { ...idleRestore(), phase: 'choosing' };
      inspecting = operation(async () => {
        try {
          if (!restoreSystem) fail('VALIDATION', 'The backup archive dialog is unavailable.');
          const archive = await restoreSystem.chooseArchive();
          if (!archive || controller.signal.aborted) return { cancelled: true as const };
          await Promise.allSettled([...mutations]);
          const inspected = await inspectArchive(archive, paths, () => datasetSummary(database), controller.signal,
            progress => { restoreProgress = progress; });
          restoreDirectory = inspected.directory;
          validatedPreview = inspected;
          previewRevision = state().dataRevision;
          restoreProgress = { ...restoreProgress, phase: 'preview' };
          return { cancelled: false as const, preview: inspected.preview };
        } catch (error) {
          if (error instanceof RestoreCleanupFailure) {
            restoreDirectory = error.directory;
            restoreProgress = { ...restoreProgress, phase: 'cleanup' };
            fail('STORAGE', error.message);
          }
          if (controller.signal.aborted) return { cancelled: true as const };
          fail('VALIDATION', `Backup inspection failed: ${error instanceof Error ? error.message : String(error)} Live records have not been replaced. Choose a complete, compatible full backup.`);
        } finally {
          restoreController = null;
          inspecting = null;
          if (!restoreDirectory) restoreProgress = idleRestore();
        }
      });
      return inspecting;
    },
    getRestoreProgress: () => operation(() => ({ ...restoreProgress })),
    cancelRestorePreview: () => operation(async () => {
      if (replacing) fail('BUSY', 'Replacement has been confirmed. Wait for validation or recovery; it cannot safely be cancelled during directory moves.');
      restoreController?.abort();
      if (inspecting) await inspecting;
      if (restoreDirectory) {
        try { await rm(restoreDirectory, { recursive: true, force: true }); }
        catch (error) {
          restoreProgress = { ...restoreProgress, phase: 'cleanup' };
          fail('STORAGE', new RestoreCleanupFailure(restoreDirectory, error).message);
        }
        restoreDirectory = null;
      }
      validatedPreview = null;
      previewRevision = null;
      restoreProgress = idleRestore();
    }),
    createFullBackup: () => operation(async () => {
      if (backupController || restoreController || portfolioController || replacing || !database.open || recoveryJournalExists(paths))
        fail('BUSY', 'An archive operation or restore recovery is already running. Wait for it to finish.');
      backupController = new AbortController();
      backupProgress = { ...idleProgress(), phase: 'choosing' };
      try {
        return await createFullBackup(database, paths, now(), backupSystem, backupController.signal,
          async () => { await Promise.allSettled([...mutations]); },
          progress => { backupProgress = progress; }, fail);
      } finally {
        backupController = null;
        backupProgress = idleProgress();
      }
    }, 'Full backup could not be completed. The last successful backup status is unchanged'),
    getBackupProgress: () => operation(() => ({ ...backupProgress })),
    cancelFullBackup: () => operation(() => {
      if (backupProgress.phase === 'publishing') fail('BUSY', 'The complete archive is being published. Wait for publication to finish.');
      backupController?.abort();
    }),
    ...Object.fromEntries(Object.keys(review).map(key => [key, (input: unknown) =>
      (review[key as keyof typeof review] as (input: unknown) => Promise<Result<unknown>>)(input)])) as unknown as typeof review,
    exportForms: input => operation(() => {
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(key => !['packageId', 'confirmDraft'].includes(key)))
        fail('VALIDATION', 'Choose a year package and confirm any draft warning before exporting.');
      identifier(input.packageId);
      if (input.confirmDraft !== undefined && input.confirmDraft !== true)
        fail('VALIDATION', 'Confirm the incomplete-package warning before exporting a draft.');
      const snapshot = database.transaction(() => {
        const record = getPackage(input.packageId);
        const review = readReviewProgress(database, record.id);
        const attachments = evidence.getEvidence(record.id);
        const workflow = evaluateWorkflow(record, review, today(), new Set(attachments
          .filter(entry => entry.integrity === 'readable').map(entry => entry.activityId)));
        const missing = formsExportWarnings(record, workflow);
        if (missing.length && !input.confirmDraft) throw new ApplicationFailure({
          code: 'CONFIRMATION_REQUIRED', message: 'This annual package is incomplete. Review the missing items and explicitly export a draft.', missing,
        });
        return { package: record, review, attachments };
      })();
      if (!formsSystem) fail('EXPORT', 'The forms destination dialog is unavailable. No output was published.');
      return exportAnnualForms(snapshot, formsSystem, fail);
    }),
    getWorkflow: id => operation(() => {
      identifier(id);
      return evaluateWorkflow(getPackage(id), readReviewProgress(database, id), today(), evidence.readableActivityIds(id));
    }),
    completeStep: input => operation(() => database.transaction(() => {
      const request = validateGoalRequest(input, ['packageId', 'step', 'expectedRevision']);
      if (!ANNUAL_STEPS.includes(request.step as AnnualStep)) fail('VALIDATION', 'Choose an annual step to complete.');
      const record = getPackage(input.packageId);
      const step = evaluateWorkflow(record, readReviewProgress(database, record.id), today(), evidence.readableActivityIds(record.id)).steps[input.step];
      if (step.relevantRevision !== input.expectedRevision) fail('CONFLICT', 'This step changed. Review its current readiness before completing it.');
      if (!step.ready) throw new ApplicationFailure({
        code: 'NOT_READY', message: `This step is not ready. ${step.missing.join(' ')}`, missing: step.missing,
      });
      if (step.status === 'Completed') return record;
      database.prepare(`INSERT INTO step_completions(package_id, step, completed_revision, completed_at) VALUES(?, ?, ?, ?)
        ON CONFLICT(package_id, step) DO UPDATE SET completed_revision = excluded.completed_revision, completed_at = excluded.completed_at`)
        .run(record.id, input.step, step.relevantRevision, now());
      database.prepare('UPDATE app_metadata SET data_revision = data_revision + 1 WHERE id = 1').run();
      return getPackage(record.id);
    }).immediate()),
    recordDeclaration: input => operation(() => database.transaction(() => {
      const request = validateGoalRequest(input, ['packageId', 'date', 'expectedRevision', 'confirmIncomplete']);
      if (typeof request.date !== 'string' || !validDate(request.date))
        fail('VALIDATION', 'Enter the actual external submission date as a valid YYYY-MM-DD date.');
      if (request.confirmIncomplete !== undefined && request.confirmIncomplete !== true)
        fail('VALIDATION', 'Confirm the incomplete-steps warning before recording this date.');
      const record = getPackage(input.packageId);
      if (record.contentRevision !== input.expectedRevision) fail('CONFLICT', 'This package changed. Reopen declaration entry before recording the date.');
      const workflow = evaluateWorkflow(record, readReviewProgress(database, record.id), today(), evidence.readableActivityIds(record.id));
      const incomplete = ANNUAL_STEPS.filter(step => workflow.steps[step].status !== 'Completed');
      if (incomplete.length && !input.confirmIncomplete) throw new ApplicationFailure({
        code: 'CONFIRMATION_REQUIRED',
        message: 'Your application steps are incomplete. You may still record an external submission that already happened. SWCC does not submit or verify declarations.',
        missing: incomplete.map(step => `${step} is not manually completed.`),
      });
      if (record.declarationDate === input.date) return record;
      const timestamp = now();
      database.prepare(`UPDATE year_packages SET declaration_date = ?, declaration_recorded_at = ?,
        content_revision = content_revision + 1, updated_at = ? WHERE id = ?`).run(input.date, timestamp, timestamp, record.id);
      database.prepare('UPDATE app_metadata SET data_revision = data_revision + 1 WHERE id = 1').run();
      return getPackage(record.id);
    }).immediate()),
    getEvidence: id => operation(() => evidence.getEvidence(id)),
    importEvidence: input => operation(() => evidence.importEvidence(input)),
    replaceEvidence: input => operation(() => evidence.replaceEvidence(input)),
    removeEvidence: input => operation(() => evidence.removeEvidence(input)),
    previewEvidence: input => operation(() => evidence.previewEvidence(input)),
    openEvidence: input => operation(() => evidence.openEvidence(input)),
    getPlanReadiness: id => operation(() => {
      identifier(id);
      return evaluatePlanReadiness(getPackage(id), today(), evidence.readableActivityIds(id));
    }),
    openEvidenceLink: input => operation(async () => {
      if (!input || typeof input !== 'object' || typeof input.url !== 'string' || !validEvidenceLink(input.url))
        fail('VALIDATION', 'Only valid HTTP or HTTPS evidence links can be opened.');
      identifier(input.packageId);
      identifier(input.activityId);
      const activity = getPackage(input.packageId).activities.find(item => item.id === input.activityId);
      if (!activity || !activity.evidenceLinks.includes(input.url)) fail('NOT_FOUND', 'Save this evidence link on an activity in this year before opening it.');
      if (!reviewSystem) fail('BROWSER', 'The default browser is unavailable. Your evidence link is still saved.');
      try { await reviewSystem.openExternal(input.url); }
      catch (error) { fail('BROWSER', `The browser could not be launched: ${error instanceof Error ? error.message : String(error)}. Your evidence link is still saved. Check your default browser and retry.`); }
    }),
    createActivity: input => operation(async () => {
      const result = await activityOperations(database, getPackage, now, today, fail, identifier).createActivity(input);
      if (!result.ok) throw new ApplicationFailure(result.error);
      return result.value;
    }),
    updateActivity: input => operation(async () => {
      const result = await activityOperations(database, getPackage, now, today, fail, identifier).updateActivity(input);
      if (!result.ok) throw new ApplicationFailure(result.error);
      return result.value;
    }),
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
      if (input.activityId && !record.activities.some(activity => activity.id === input.activityId))
        fail('NOT_FOUND', 'Choose an activity in this year before creating a linked goal.');
      const counter = database.prepare('SELECT next_number AS nextNumber FROM reference_counters WHERE package_id = ? AND kind = ?')
        .get(input.packageId, 'G') as { nextNumber: number } | undefined;
      if (!counter) fail('STORAGE', 'The learning-goal reference counter is missing. Preserve this dataset and retry after recovery.');
      const timestamp = now();
      const id = randomUUID();
      database.prepare('UPDATE reference_counters SET next_number = next_number + 1 WHERE package_id = ? AND kind = ?').run(input.packageId, 'G');
      database.prepare(`INSERT INTO learning_goals(id, package_id, reference_number, title, description, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?)`).run(id, input.packageId, counter.nextNumber, input.title, input.description ?? '', timestamp, timestamp);
      if (input.activityId) {
        database.prepare('INSERT INTO activity_goal_links(activity_id, goal_id, package_id) VALUES(?, ?, ?)')
          .run(input.activityId, id, input.packageId);
        database.prepare('UPDATE learning_activities SET updated_at = ? WHERE id = ?').run(timestamp, input.activityId);
      }
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
    deleteActivity: input => operation(() => {
      validateDeleteActivity(input);
      const before = getPackage(input.packageId);
      if (before.contentRevision !== input.expectedRevision) fail('CONFLICT', 'This package changed before activity deletion. Preserve your edits and retry after saving the current year.');
      const activity = before.activities.find(item => item.id === input.activityId);
      if (!activity) fail('NOT_FOUND', 'This activity no longer exists in this year.');
      const staged = evidence.stageDeletion(input.packageId, before.year, activity.id);
      let updated: YearPackage;
      try {
        updated = database.transaction(() => {
          const current = getPackage(input.packageId);
          if (current.contentRevision !== input.expectedRevision) fail('CONFLICT', 'This package changed before activity deletion. Preserve your edits and retry after saving the current year.');
          if (!current.activities.some(item => item.id === input.activityId)) fail('NOT_FOUND', 'This activity no longer exists in this year.');
          const deleted = database.prepare('DELETE FROM learning_activities WHERE id = ? AND package_id = ?')
            .run(input.activityId, input.packageId);
          if (!deleted.changes) fail('NOT_FOUND', 'This activity no longer exists in this year.');
          advanceActivityRevisions(input.packageId, now());
          return getPackage(input.packageId);
        }).immediate();
      } catch (error) {
        try { evidence.rollbackDeletion(staged); }
        catch (recoveryError) {
          throw new ApplicationFailure({
            code: 'STORAGE',
            message: `Activity deletion failed and its managed evidence could not be fully restored. The activity record remains. Preserve the recovery folder at ${staged?.directory ?? paths.evidence}. ${error instanceof Error ? error.message : String(error)} ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
            recoveryPath: staged?.directory,
          });
        }
        throw error;
      }
      try { evidence.finalizeDeletion(staged); }
      catch (error) {
        throw new ApplicationFailure({
          code: 'STORAGE',
          message: error instanceof Error ? error.message : String(error),
          committed: true,
          recoveryPath: staged?.directory,
        });
      }
      return updated;
    }),
    deleteYear: input => operation(() => {
      validateDeleteYear(input);
      const before = getPackage(input.packageId);
      if (before.contentRevision !== input.expectedRevision) fail('CONFLICT', 'This package changed before year deletion. Preserve your edits and retry after saving the current year.');
      const staged = evidence.stageDeletion(input.packageId, before.year);
      let updated: AppState;
      try {
        updated = database.transaction(() => {
          const current = getPackage(input.packageId);
          if (current.contentRevision !== input.expectedRevision) fail('CONFLICT', 'This package changed before year deletion. Preserve your edits and retry after saving the current year.');
          const metadata = database.prepare('SELECT selected_package_id AS selectedPackageId FROM app_metadata WHERE id = 1')
            .get() as { selectedPackageId: string | null };
          const selectedPackageId = metadata.selectedPackageId === input.packageId
            ? (database.prepare('SELECT id FROM year_packages WHERE id != ? ORDER BY year DESC LIMIT 1').get(input.packageId) as { id: string } | undefined)?.id ?? null
            : metadata.selectedPackageId;
          database.prepare('UPDATE app_metadata SET selected_package_id = ?, data_revision = data_revision + 1 WHERE id = 1')
            .run(selectedPackageId);
          const deleted = database.prepare('DELETE FROM year_packages WHERE id = ?').run(input.packageId);
          if (!deleted.changes) fail('NOT_FOUND', 'This year package no longer exists.');
          return state();
        }).immediate();
      } catch (error) {
        try { evidence.rollbackDeletion(staged); }
        catch (recoveryError) {
          throw new ApplicationFailure({
            code: 'STORAGE',
            message: `Year deletion failed and its managed evidence could not be fully restored. The year package remains. Preserve the recovery folder at ${staged?.directory ?? paths.evidence}. ${error instanceof Error ? error.message : String(error)} ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
            recoveryPath: staged?.directory,
          });
        }
        throw error;
      }
      try { evidence.finalizeDeletion(staged); }
      catch (error) {
        throw new ApplicationFailure({
          code: 'STORAGE',
          message: error instanceof Error ? error.message : String(error),
          committed: true,
          recoveryPath: staged?.directory,
        });
      }
      return updated;
    }),
    acknowledgeStorage: () => operation(() => {
      database.prepare('UPDATE app_metadata SET acknowledged_at = ?, data_revision = data_revision + 1 WHERE id = 1 AND acknowledged_at IS NULL').run(now());
      return state();
    }),
  };
  const protectedOperations = [
    'completeStep', 'recordDeclaration', 'createYear', 'openYear', 'saveDraft', 'createGoal', 'updateGoal',
    'deleteGoal', 'createActivity', 'updateActivity', 'deleteActivity', 'deleteYear',
    'importEvidence', 'replaceEvidence', 'removeEvidence', 'acknowledgeStorage', 'exportForms',
    'saveReviewPosition', 'recordReviewVisits', 'resetReviewSection', 'launchReviewResources', 'resetReviewResources',
  ] as const satisfies readonly (keyof ApplicationOperations)[];
  for (const key of protectedOperations) {
    const original = operations[key] as (input: unknown) => Promise<Result<unknown>>;
    const guarded = async (input: unknown): Promise<Result<unknown>> => {
      if (backupController || restoreController || portfolioController || replacing || !database.open || recoveryJournalExists(paths)) return {
        ok: false, error: { code: 'BUSY', message: backupController || portfolioController
          ? `A ${portfolioController ? 'portfolio export' : 'full backup'} is collecting your records and evidence. Wait for it to finish, then retry; your edit has not been applied.`
          : 'Restore or recovery is running. Wait for it to finish, then retry; your edit has not been applied.' },
      };
      const running = original(input);
      mutations.add(running);
      try { return await running; }
      finally { mutations.delete(running); }
    };
    Object.assign(operations, { [key]: guarded });
  }
  const guardedReads = [
    'getState', 'getWorkflow', 'getPlanReadiness', 'getEvidence', 'previewEvidence',
    'openEvidence', 'openEvidenceLink', 'getReview', 'getReviewDocument',
  ] as const satisfies readonly (keyof ApplicationOperations)[];
  for (const key of guardedReads) {
    const original = operations[key] as (input: unknown) => Promise<Result<unknown>>;
    Object.assign(operations, { [key]: (input: unknown): Promise<Result<unknown>> => {
      if (replacing) return operation(() => fail('BUSY', 'Dataset replacement is running. Wait for full validation or recovery before reading restored records.'));
      if (!database.open || recoveryJournalExists(paths)) return operation(() =>
        fail('STORAGE', `Recovery has not finished. Records are unavailable, not empty. Preserve ${paths.recoveryJournal} and the recovery copies; restart SWCC to retry.`));
      return original(input);
    } });
  }
  return { operations, close: () => {
    if (backupController || portfolioController) throw new Error('Wait for the archive operation to finish before closing local records.');
    if (restoreController || restoreDirectory || replacing) throw new Error('Finish the restore or cancel its preview before closing local records.');
    if (database.open) database.close();
  } };
}
