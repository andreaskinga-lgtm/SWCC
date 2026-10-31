import type Database from 'better-sqlite3';
import type { OperationError, Result } from '../../shared/application.js';
import { REVIEW_DOCUMENT_ID, REVIEW_RESOURCES_URL, REVIEW_SECTIONS, reviewReadiness } from '../../shared/review.js';
import type { ReviewOperations, ReviewState } from '../../shared/review.js';

export interface ReviewSystem {
  openExternal(url: string): Promise<void>;
  readDocument(): Uint8Array;
}
class ReviewFailure extends Error {
  constructor(readonly code: OperationError['code'], message: string) { super(message); }
}
export function reviewOperations(db: Database.Database, now: () => string, system?: ReviewSystem): ReviewOperations {
  function packageRevision(id: string) {
    if (typeof id !== 'string' || !/^[\da-f-]{36}$/i.test(id)) throw new ReviewFailure('VALIDATION', 'Choose a valid year package.');
    const record = db.prepare('SELECT review_revision AS revision FROM year_packages WHERE id = ?').get(id) as { revision: number } | undefined;
    if (!record) throw new ReviewFailure('NOT_FOUND', 'This year package no longer exists.');
    return record.revision;
  }
  function state(id: string): ReviewState {
    const revision = packageRevision(id);
    const position = db.prepare(`SELECT page, offset, zoom, resources_launched_at AS resourcesLaunchedAt FROM review_states
      WHERE package_id = ? AND document_id = ?`).get(id, REVIEW_DOCUMENT_ID) as Pick<ReviewState, 'page' | 'offset' | 'zoom' | 'resourcesLaunchedAt'> | undefined;
    const progress = {
      ...(position ?? { page: 1, offset: 0, zoom: 100, resourcesLaunchedAt: null }),
      visitedPages: (db.prepare('SELECT page FROM review_visits WHERE package_id = ? AND document_id = ? ORDER BY page')
        .all(id, REVIEW_DOCUMENT_ID) as { page: number }[]).map(row => row.page),
    };
    return { ...progress, packageId: id, documentId: REVIEW_DOCUMENT_ID, reviewRevision: revision,
      resourcesAvailable: progress.visitedPages.includes(48), readiness: reviewReadiness(progress) };
  }
  function ensure(id: string) {
    packageRevision(id);
    db.prepare('INSERT OR IGNORE INTO review_states(package_id, document_id) VALUES(?, ?)').run(id, REVIEW_DOCUMENT_ID);
  }
  function changed(id: string, reset = false) {
    db.prepare('UPDATE app_metadata SET data_revision = data_revision + 1 WHERE id = 1').run();
    if (reset) db.prepare('UPDATE year_packages SET review_revision = review_revision + 1, updated_at = ? WHERE id = ?').run(now(), id);
  }
  async function operation<T>(work: () => T | Promise<T>): Promise<Result<T>> {
    try { return { ok: true, value: await work() }; }
    catch (error) {
      return { ok: false, error: { code: error instanceof ReviewFailure ? error.code : 'STORAGE',
        message: error instanceof ReviewFailure ? error.message
          : `Review could not be saved or opened: ${error instanceof Error ? error.message : String(error)}. Keep the reader open, check disk space and folder permissions, then retry.` } };
    }
  }
  return {
    getReview: id => operation(() => state(id)),
    saveReviewPosition: input => operation(() => db.transaction(() => {
      if (!input || !Number.isInteger(input.page) || input.page < 1 || input.page > 48
        || !Number.isFinite(input.offset) || input.offset < 0 || input.offset > 1
        || !Number.isInteger(input.zoom) || input.zoom < 75 || input.zoom > 200 || input.zoom % 25 !== 0)
        throw new ReviewFailure('VALIDATION', 'Choose physical page 1–48, a valid reading position and zoom 75–200%.');
      const previous = state(input.packageId);
      if (previous.page === input.page && previous.offset === input.offset && previous.zoom === input.zoom) return previous;
      ensure(input.packageId);
      db.prepare('UPDATE review_states SET page = ?, offset = ?, zoom = ? WHERE package_id = ? AND document_id = ?')
        .run(input.page, input.offset, input.zoom, input.packageId, REVIEW_DOCUMENT_ID);
      changed(input.packageId);
      return state(input.packageId);
    }).immediate()),
    recordReviewVisits: input => operation(() => db.transaction(() => {
      if (!input || !Array.isArray(input.pages) || input.pages.length > 48
        || input.pages.some(page => !Number.isInteger(page) || page < 1 || page > 48))
        throw new ReviewFailure('VALIDATION', 'Review visits must be physical pages 1–48.');
      packageRevision(input.packageId);
      let added = 0;
      for (const page of new Set(input.pages)) added += db.prepare('INSERT OR IGNORE INTO review_visits(package_id, document_id, page) VALUES(?, ?, ?)')
        .run(input.packageId, REVIEW_DOCUMENT_ID, page).changes;
      if (added) changed(input.packageId);
      return state(input.packageId);
    }).immediate()),
    resetReviewSection: input => operation(() => db.transaction(() => {
      const section = REVIEW_SECTIONS.find(section => section.id === input?.sectionId);
      if (!section) throw new ReviewFailure('VALIDATION', 'Choose a mapped review section to reset.');
      packageRevision(input.packageId);
      let removed = 0;
      for (const page of section.pages) removed += db.prepare('DELETE FROM review_visits WHERE package_id = ? AND document_id = ? AND page = ?')
        .run(input.packageId, REVIEW_DOCUMENT_ID, page).changes;
      if (removed) changed(input.packageId, true);
      return state(input.packageId);
    }).immediate()),
    launchReviewResources: id => operation(async () => {
      const previous = state(id);
      if (!previous.resourcesAvailable) throw new ReviewFailure('VALIDATION', 'Display physical page 48 in the active reader before opening Other required resources.');
      const unchanged = previous.resourcesLaunchedAt ? 'The previous successful launch remains recorded.' : 'Resources remain unchecked.';
      if (!system) throw new ReviewFailure('BROWSER', `The default browser is unavailable. Check your browser association and try again. ${unchanged}`);
      try { await system.openExternal(REVIEW_RESOURCES_URL); }
      catch (error) { throw new ReviewFailure('BROWSER', `The default browser could not be launched: ${error instanceof Error ? error.message : String(error)}. Check the default browser in your OS settings, then retry. ${unchanged}`); }
      return db.transaction(() => {
        ensure(id);
        if (!state(id).resourcesLaunchedAt) {
          db.prepare('UPDATE review_states SET resources_launched_at = ? WHERE package_id = ? AND document_id = ?').run(now(), id, REVIEW_DOCUMENT_ID);
          changed(id);
        }
        return state(id);
      }).immediate();
    }),
    resetReviewResources: id => operation(() => db.transaction(() => {
      const previous = state(id);
      if (previous.resourcesLaunchedAt) {
        db.prepare('UPDATE review_states SET resources_launched_at = NULL WHERE package_id = ? AND document_id = ?').run(id, REVIEW_DOCUMENT_ID);
        changed(id, true);
      }
      return state(id);
    }).immediate()),
    getReviewDocument: () => operation(() => {
      if (!system) throw new ReviewFailure('STORAGE', 'The bundled standards PDF is unavailable. Reinstall SWCC; your records have not been replaced.');
      return new Uint8Array(system.readDocument());
    }),
  };
}
