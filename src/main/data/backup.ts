import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Writable } from 'node:stream';
import { SOURCE_SET_ID } from '../../shared/application.js';
import type { OperationError } from '../../shared/application.js';
import type { ArchiveFile, BackupProgress, FullBackupManifest, FullBackupOutcome } from '../../shared/backup.js';
import { MAX_BACKUP_DATABASE_BYTES, MAX_BACKUP_FILES, MAX_BACKUP_MANIFEST_BYTES } from '../../shared/backup.js';
import { archiveManifestBytes, ArchiveSourceFailure, writeArchive } from '../archive.js';
import { SCHEMA_VERSION } from './migrations.js';
import type { storageLayout } from './storage.js';
import { MAX_EVIDENCE_BYTES } from './evidence.js';
import { exportDestination } from '../export/destination.js';

export interface BackupSystem {
  chooseDestination: (suggestedName: string) => Promise<string | null>;
  openOutput?: (temporaryPath: string) => Writable;
}

export async function createFullBackup(
  db: Database.Database,
  paths: ReturnType<typeof storageLayout>,
  createdAt: string,
  system: BackupSystem | undefined,
  signal: AbortSignal,
  drainMutations: () => Promise<void>,
  report: (progress: BackupProgress) => void,
  fail: (code: OperationError['code'], message: string) => never,
  protective = false,
): Promise<FullBackupOutcome> {
  let progress: BackupProgress = { phase: 'choosing', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0 };
  const phase = (next: BackupProgress['phase']) => { progress = { ...progress, phase: next }; report(progress); };
  if (!system) throw new Error('The full-backup save dialog is unavailable.');
  const selected = await system.chooseDestination(`SWCC-${createdAt.replace(/[:.]/g, '-')}.swcc-backup.zip`);
  if (!selected || signal.aborted) return { cancelled: true };
  const destination = await exportDestination(selected, paths.dataset, 'backup', fail, protective);
  const staging = join(paths.runtime, `backup-${randomUUID()}`);
  const temporary = join(dirname(destination), `.swcc-backup-${randomUUID()}.partial`);
  try {
    phase('waiting');
    signal.throwIfAborted();
    let aborted!: () => void;
    const stopped = new Promise<void>(resolveStopped => { aborted = resolveStopped; });
    signal.addEventListener('abort', aborted, { once: true });
    try { await Promise.race([drainMutations(), stopped]); }
    finally { signal.removeEventListener('abort', aborted); }
    signal.throwIfAborted();
    phase('snapshot');
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const snapshot = join(staging, 'database.sqlite');
    await db.backup(snapshot, { progress: () => {
      signal.throwIfAborted();
      return 100;
    } });
    signal.throwIfAborted();
    const snapshotDb = new Database(snapshot, { readonly: true, fileMustExist: true });
    let meta: { revision: number };
    let evidence: { path: string; byteCount: number; sha256: string; year: number; reference: number; type: string }[];
    try {
      if (snapshotDb.pragma('quick_check', { simple: true }) !== 'ok'
        || (snapshotDb.pragma('foreign_key_check') as unknown[]).length)
        throw new Error('The SQLite snapshot failed its integrity or relationship check.');
      if (snapshotDb.prepare('SELECT 1 FROM year_packages WHERE source_set_id != ?').get(SOURCE_SET_ID))
        throw new Error('This dataset contains an incompatible source set. Preserve your records and seek recovery help.');
      meta = snapshotDb.prepare('SELECT data_revision AS revision FROM app_metadata WHERE id = 1').get() as { revision: number };
      evidence = snapshotDb.prepare(`SELECT e.managed_path AS path, e.byte_count AS byteCount, e.sha256,
        p.year, e.reference_number AS reference, e.type FROM evidence_attachments e
        JOIN year_packages p ON p.id = e.package_id ORDER BY e.managed_path`).all() as typeof evidence;
    } finally { snapshotDb.close(); }
    if ((await lstat(paths.evidence)).isSymbolicLink())
      fail('EVIDENCE', 'The managed evidence directory is a symbolic link. Preserve the dataset and repair managed storage before backing up.');
    for (const file of evidence) {
      const safeName = new RegExp(`^${file.year}/E${file.reference}-[\\da-f-]{36}\\.${file.type}$`, 'i');
      if (!safeName.test(file.path) || file.byteCount < 0 || file.byteCount > MAX_EVIDENCE_BYTES || !/^[\da-f]{64}$/i.test(file.sha256))
        fail('EVIDENCE', `E${file.reference} in ${file.year} has invalid managed evidence metadata. Preserve the dataset and repair this entry.`);
      try {
        const directory = await lstat(join(paths.evidence, String(file.year)));
        const actual = await lstat(join(paths.evidence, file.path));
        if (!directory.isDirectory() || directory.isSymbolicLink() || !actual.isFile() || actual.isSymbolicLink()
          || actual.size !== file.byteCount) throw new Error('Missing, changed, or unsafe managed file.');
      } catch (error) {
        fail('EVIDENCE', `E${file.reference} in ${file.year} cannot be included: ${error instanceof Error ? error.message : String(error)}. Replace or remove this evidence entry; no bytes were omitted.`);
      }
    }
    const sources = [
      { path: 'database.sqlite', sourcePath: snapshot, byteCount: (await stat(snapshot)).size },
      ...evidence.map(file => ({
        ...file, path: `evidence/${file.path}`, sourcePath: join(paths.evidence, file.path),
      })),
    ];
    function manifest(files: ArchiveFile[]): FullBackupManifest {
      const value: FullBackupManifest = {
        kind: 'full-backup', archiveVersion: 1, schemaVersion: SCHEMA_VERSION, appId: 'org.swcc.desktop',
        sourceSetId: SOURCE_SET_ID, createdAt, dataRevision: meta.revision, files,
      };
      if (files.length > MAX_BACKUP_FILES || sources[0].byteCount > MAX_BACKUP_DATABASE_BYTES
        || archiveManifestBytes(value).byteLength > MAX_BACKUP_MANIFEST_BYTES)
        fail('STORAGE', 'This full backup exceeds the supported restore inspection limit (4 MiB manifest, 512 MiB database, or 50,000 files). No backup was published. Your records and evidence remain; use a compatible SWCC build before backing up this dataset.');
      return value;
    }
    manifest(sources.map(source => ({
      path: source.path, byteCount: source.byteCount, sha256: '0'.repeat(64),
    })));
    progress.filesTotal = sources.length;
    progress.bytesTotal = sources.reduce((sum, source) => sum + source.byteCount, 0);
    phase('archiving');
    await writeArchive(temporary, sources, manifest, (bytes, completed) => {
      progress = { ...progress, bytesCompleted: progress.bytesCompleted + bytes,
        filesCompleted: progress.filesCompleted + Number(completed) };
      report(progress);
    }, signal, system.openOutput);
    signal.throwIfAborted();
    phase('publishing');
    const file = await open(temporary, 'r+');
    try { await file.sync(); }
    finally { await file.close(); }
    await rm(staging, { recursive: true });
    await rename(temporary, destination);
    if (!protective) db.prepare('UPDATE app_metadata SET last_backup_at = ?, last_backup_revision = ? WHERE id = 1')
      .run(createdAt, meta.revision);
    return { cancelled: false, fileName: basename(destination), createdAt, dataRevision: meta.revision };
  } catch (error) {
    if (signal.aborted && progress.phase !== 'publishing') return { cancelled: true };
    if (error instanceof ArchiveSourceFailure && error.path.startsWith('evidence/'))
      fail('EVIDENCE', `${error.message}. No evidence was omitted. Replace or remove this evidence entry before retrying the full backup.`);
    throw error;
  } finally {
    await rm(temporary, { force: true });
    await rm(staging, { recursive: true, force: true });
  }
}
