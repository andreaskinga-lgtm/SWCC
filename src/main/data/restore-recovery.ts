import { randomUUID } from 'node:crypto';
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import type { BackupProgress, FullBackupManifest } from '../../shared/backup.js';
import type { RestoreProgress } from '../../shared/restore.js';
import type { OperationError } from '../../shared/application.js';
import { createFullBackup } from './backup.js';
import { inspectArchive, manifestFrom, validateDataset } from './restore.js';
import type { RestoreSystem } from './restore.js';
import type { storageLayout } from './storage.js';

type Paths = ReturnType<typeof storageLayout>;
interface Journal {
  version: 1;
  id: string;
  stagingId: string;
  phase: 'prepared' | 'validated' | 'recovered' | 'recovering-prior' | 'recovering-protective';
}
function syncDirectory(path: string) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function durableFile(path: string, data: unknown) {
  const partial = `${path}.${randomUUID()}.partial`;
  const fd = openSync(partial, 'wx', 0o600);
  try {
    try { writeFileSync(fd, JSON.stringify(data)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(partial, path);
    syncDirectory(dirname(path));
  } finally { rmSync(partial, { force: true }); }
}
function move(from: string, to: string) {
  renameSync(from, to);
  syncDirectory(dirname(from));
  if (dirname(from) !== dirname(to)) syncDirectory(dirname(to));
}
function regularDirectory(path: string) {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(path) !== resolve(path))
    throw new Error(`Recovery needs a regular, confined directory: ${path}. Preserve all recovery copies.`);
}
function recoveryPaths(paths: Paths, journal: Journal) {
  const root = dirname(paths.dataset);
  regularDirectory(root);
  const recovery = join(root, 'restore-recovery');
  regularDirectory(recovery);
  const directory = join(recovery, journal.id);
  regularDirectory(directory);
  return {
    directory, prior: join(directory, 'prior'), protective: join(directory, 'protective-dataset'),
    rejected: join(directory, 'unverified-replacement'),
    staging: join(paths.restoreStaging, journal.stagingId),
    archive: join(directory, 'protective.swcc-backup.zip'),
  };
}
function readJournal(paths: Paths): Journal {
  const info = lstatSync(paths.recoveryJournal);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error('The restore recovery journal is unsafe or unreadable.');
  const journal = JSON.parse(readFileSync(paths.recoveryJournal, 'utf8')) as Journal;
  if (!journal || Object.keys(journal).sort().join(',') !== 'id,phase,stagingId,version'
    || journal.version !== 1 || !/^restore-[\da-f-]{36}$/.test(journal.id)
    || !/^inspection-[\da-f-]{36}$/.test(journal.stagingId)
    || !['prepared', 'validated', 'recovered', 'recovering-prior', 'recovering-protective'].includes(journal.phase))
    throw new Error('The restore recovery journal is invalid. Preserve the dataset and recovery folder; no empty dataset will be opened.');
  return journal;
}
function manifest(path: string): FullBackupManifest {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024) throw new Error('Unsafe recovery manifest; preserve the recovery copies.');
  return manifestFrom(readFileSync(path));
}
function validateCopy(path: string, saved: FullBackupManifest, verifyDatabaseBytes = false) {
  regularDirectory(path);
  validateDataset(path, saved, undefined, verifyDatabaseBytes);
}
function syncStaging(path: string, saved: FullBackupManifest) {
  const directories = new Set<string>([path]);
  for (const file of saved.files) {
    let directory = dirname(join(path, file.path));
    while (directory !== path) { directories.add(directory); directory = dirname(directory); }
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    regularDirectory(directory);
    syncDirectory(directory);
  }
}
function finish(paths: Paths, journal: Journal) {
  const owned = recoveryPaths(paths, journal);
  rmSync(paths.recoveryJournal);
  syncDirectory(dirname(paths.recoveryJournal));
  // The archive remains a recoverable full backup even after successful replacement.
  try {
    for (const path of [owned.prior, owned.protective, owned.rejected, owned.staging]) {
      if (existsSync(path)) { regularDirectory(path); rmSync(path, { recursive: true }); syncDirectory(dirname(path)); }
    }
    return '';
  } catch (error) {
    return ` Cleanup could not finish: ${String(error)}. Verified records remain usable; preserve the operation-owned copies at ${owned.directory}.`;
  }
}
export function recoverRestore(paths: Paths, boundary?: RestoreSystem['boundary'], reopen?: () => void): string | null {
  if (!existsSync(paths.recoveryJournal)) return null;
  const journal = readJournal(paths);
  const owned = recoveryPaths(paths, journal);
  const priorManifest = manifest(join(owned.directory, 'prior-manifest.json'));
  function complete(message: string, saved = priorManifest) {
    reopen?.();
    validateCopy(paths.dataset, saved);
    boundary?.('recovery-reopened');
    return `${message} Protective backup: ${owned.archive}${finish(paths, journal)}`;
  }
  if (journal.phase === 'validated') {
    let valid = false;
    try {
      validateCopy(paths.dataset, manifest(join(owned.directory, 'incoming-manifest.json')));
      valid = true;
    } catch {
      // Recheck after restart before completing an interrupted commit.
    }
    if (valid) {
      return complete('An interrupted restore had already passed full validation. The restored dataset is usable.',
        manifest(join(owned.directory, 'incoming-manifest.json')));
    }
  }
  if (journal.phase === 'recovered') {
    validateCopy(paths.dataset, priorManifest);
    return complete('An interrupted restore recovered your prior usable dataset.');
  }
  const recoverySource = journal.phase === 'recovering-prior' ? owned.prior
    : journal.phase === 'recovering-protective' ? owned.protective : null;
  if (recoverySource && !existsSync(recoverySource)) {
    validateCopy(paths.dataset, priorManifest);
    durableFile(paths.recoveryJournal, { ...journal, phase: 'recovered' });
    return complete('An interrupted restore recovered your prior usable dataset.');
  }
  let source: string;
  if (recoverySource) {
    source = recoverySource;
    validateCopy(source, priorManifest);
  } else if (existsSync(owned.prior)) {
    source = owned.prior;
    try { validateCopy(source, priorManifest); }
    catch { source = owned.protective; validateCopy(source, priorManifest); }
  } else if (existsSync(owned.protective)) {
    source = owned.protective;
    validateCopy(source, priorManifest);
  } else {
    validateCopy(paths.dataset, priorManifest);
    durableFile(paths.recoveryJournal, { ...journal, phase: 'recovered' });
    return complete('Restore stopped before replacement. Your prior usable dataset is intact.');
  }
  durableFile(paths.recoveryJournal, { ...journal, phase: source === owned.prior ? 'recovering-prior' : 'recovering-protective' });
  if (existsSync(paths.dataset)) {
    regularDirectory(paths.dataset);
    // A restart between recovery moves must never overwrite either copy.
    if (existsSync(owned.rejected)) throw new Error('Recovery has multiple replacement copies. Preserve them and retry with recovery help.');
    move(paths.dataset, owned.rejected);
  }
  move(source, paths.dataset);
  boundary?.('recovery-prior-moved');
  validateCopy(paths.dataset, priorManifest);
  durableFile(paths.recoveryJournal, { ...journal, phase: 'recovered' });
  return complete('Restore failed or was interrupted. Your prior usable dataset has been recovered; no incoming records were kept.');
}

export async function replaceDataset(
  db: Database.Database, paths: Paths, incoming: { directory: string; manifest: FullBackupManifest },
  now: string, system: RestoreSystem | undefined, drain: () => Promise<void>,
  close: () => void, reopen: () => void, report: (phase: RestoreProgress['phase'], progress?: BackupProgress) => void,
  fail: (code: OperationError['code'], message: string) => never,
) {
  const recovery = join(dirname(paths.dataset), 'restore-recovery');
  mkdirSync(recovery, { recursive: true, mode: 0o700 });
  regularDirectory(recovery);
  const id = `restore-${randomUUID()}`;
  const directory = join(recovery, id);
  mkdirSync(directory, { mode: 0o700 });
  const archive = join(directory, 'protective.swcc-backup.zip');
  let journaled = false;
  let closed = false;
  let protectedStaging: string | undefined;
  try {
    report('protecting');
    const signal = new AbortController().signal;
    const backup = await createFullBackup(db, paths, now, {
      chooseDestination: async () => archive, openOutput: system?.protectiveOutput,
    }, signal, drain, progress => report('protecting', progress), fail, true);
    if (backup.cancelled) throw new Error('The protective full backup was cancelled.');
    const protective = await inspectArchive(archive, paths, () => ({ years: [], goals: 0, activities: 0, evidenceFiles: 0 }), signal, () => {});
    protectedStaging = protective.directory;
    durableFile(join(directory, 'prior-manifest.json'), protective.manifest);
    durableFile(join(directory, 'incoming-manifest.json'), incoming.manifest);
    syncStaging(protective.directory, protective.manifest);
    move(protective.directory, join(directory, 'protective-dataset'));
    protectedStaging = undefined;
    await system?.boundary?.('protected');
    validateCopy(incoming.directory, incoming.manifest, true);
    syncStaging(incoming.directory, incoming.manifest);
    close(); closed = true;
    const journal: Journal = { version: 1, id, stagingId: basename(incoming.directory), phase: 'prepared' };
    durableFile(paths.recoveryJournal, journal);
    journaled = true;
    await system?.boundary?.('journaled');
    report('moving');
    move(paths.dataset, join(directory, 'prior'));
    await system?.boundary?.('prior-moved');
    move(incoming.directory, paths.dataset);
    await system?.boundary?.('replacement-moved');
    report('reopening');
    reopen(); closed = false;
    await system?.boundary?.('reopened');
    report('verifying');
    validateCopy(paths.dataset, incoming.manifest);
    await system?.boundary?.('validated');
    durableFile(paths.recoveryJournal, { ...journal, phase: 'validated' });
    await system?.boundary?.('committed');
    const cleanupWarning = finish(paths, { ...journal, phase: 'validated' });
    return { protectiveBackup: archive, cleanupWarning };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (journaled) {
      report('recovering');
      if (!closed) { close(); closed = true; }
      try {
        const recovered = recoverRestore(paths, system?.boundary, reopen);
        closed = false;
        fail('STORAGE', `Replacement failed: ${reason}. ${recovered}`);
      } catch (recoveryError) {
        if (recoveryError instanceof Error && recoveryError.message.startsWith('Replacement failed:')) throw recoveryError;
        fail('STORAGE', `Replacement failed: ${reason}. Recovery could not finish: ${String(recoveryError)}. Records are unavailable, not empty. Preserve ${paths.recoveryJournal} and ${directory}; restart to retry recovery.`);
      }
    }
    if (closed) reopen();
    if (protectedStaging) rmSync(protectedStaging, { recursive: true, force: true });
    // A verified protective archive is retained even when replacement is aborted.
    if (!existsSync(archive)) rmSync(directory, { recursive: true, force: true });
    fail('STORAGE', `Replacement stopped before changing live data: ${reason}. Your current dataset remains usable. ${existsSync(archive) ? `Protective backup: ${archive}` : 'No protective backup was completed.'}`);
  }
}
