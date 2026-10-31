import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { addAbortSignal, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import type { FullBackupManifest } from '../../shared/backup.js';
import type { DatasetSummary, RestorePreview, RestoreProgress } from '../../shared/restore.js';
import { ANNUAL_STANDARDS, SOURCE_SET_ID, validDate } from '../../shared/application.js';
import { activityDateError, validEvidenceLink } from '../../shared/plan.js';
import type { ActivityFields } from '../../shared/application.js';
import { migrate, SCHEMA_VERSION } from './migrations.js';
import { MAX_EVIDENCE_BYTES, SUPPORTED_EVIDENCE_EXTENSIONS } from './evidence.js';
import type { storageLayout } from './storage.js';

export interface RestoreSystem {
  chooseArchive: () => Promise<string | null>;
}
export class RestoreCleanupFailure extends Error {
  constructor(readonly directory: string, error: unknown) {
    super(`Inspection staging could not be removed: ${error instanceof Error ? error.message : String(error)}. Live records are unchanged. Check folder permissions and retry staging cleanup.`);
  }
}
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_DATABASE_BYTES = 512 * 1024 * 1024;
const MAX_FILES = 50_000;
function validInstant(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    && !value.startsWith('0000') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
let supportedSchema: string | undefined;
function schemaSignature(db: Database.Database) {
  const rows = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all() as
    { type: string; name: string; tbl_name: string; sql: string | null }[];
  return JSON.stringify(rows.map(row => ({
    ...row,
    sql: row.sql?.match(/'(?:[^']|'')*'|"(?:""|[^"])*"|[^\s'"]+/g)?.join(' ') ?? null,
  })));
}
function validateSchema(db: Database.Database) {
  if (!supportedSchema) {
    const reference = new Database(':memory:');
    try { migrate(reference); supportedSchema = schemaSignature(reference); }
    finally { reference.close(); }
  }
  if (schemaSignature(db) !== supportedSchema)
    throw new Error('The backup database schema does not match the supported SWCC schema. Missing or altered constraints, tables, indexes, views and triggers are not accepted.');
}
async function validateStoredTypes(db: Database.Database, signal: AbortSignal) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  let checked = 0;
  for (const { name } of tables) {
    const columns = db.pragma(`table_info(${name})`) as { name: string; type: string; notnull: number; pk: number }[];
    for (const row of db.prepare(`SELECT * FROM ${name}`).iterate() as Iterable<Record<string, unknown>>) {
      for (const column of columns) {
        const value = row[column.name];
        if (value === null && !column.notnull && !column.pk) continue;
        if ((column.type === 'TEXT' && typeof value !== 'string')
          || (column.type === 'INTEGER' && !Number.isSafeInteger(value))
          || (column.type === 'REAL' && (typeof value !== 'number' || !Number.isFinite(value))))
          throw new Error(`Invalid stored ${name}.${column.name} type. The backup will not be repaired or replaced with empty data.`);
        if (column.name.endsWith('_at') && !validInstant(value))
          throw new Error(`Invalid operational timestamp in ${name}.${column.name}.`);
        if (column.type === 'TEXT' && ['id', 'package_id', 'activity_id', 'goal_id', 'selected_package_id'].includes(column.name)
          && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(value as string))
          throw new Error(`Invalid stable record identifier in ${name}.${column.name}.`);
      }
      if (typeof row.created_at === 'string' && typeof row.updated_at === 'string' && row.created_at > row.updated_at)
        throw new Error(`The ${name} update timestamp precedes its creation timestamp.`);
      for (const [key, value] of Object.entries(row)) {
        if (key.endsWith('_revision') && value !== null && (value as number) < 0)
          throw new Error(`Invalid negative revision in ${name}.${key}.`);
      }
      if ((row.reference_number !== undefined && (row.reference_number as number) < 1)
        || (row.next_number !== undefined && ((row.next_number as number) < 1 || (row.next_number as number) >= Number.MAX_SAFE_INTEGER)))
        throw new Error('A stable reference or reference counter is invalid.');
      if (name === 'year_packages' && ((row.year as number) < 1 || (row.year as number) > 9999))
        throw new Error('An annual package year is invalid.');
      if (['learning_goals', 'learning_activities'].includes(name) && !(row.title as string).trim())
        throw new Error('A saved goal or activity has a blank title.');
      if (name === 'learning_activities' && !['Planned', 'In Progress', 'Completed'].includes(row.status as string))
        throw new Error('A saved activity has an invalid status.');
      if (name === 'reference_counters' && !['G', 'A', 'E'].includes(row.kind as string))
        throw new Error('A stable reference counter has an invalid kind.');
      if (name === 'annual_standards' && !ANNUAL_STANDARDS.some(standard => standard.id === row.standard_id))
        throw new Error('An annual standard selection is incompatible with the supplied documents.');
      if (['review_states', 'review_visits'].includes(name) && (row.document_id !== 'ethics-2018'
        || (row.page as number) < 1 || (row.page as number) > 48))
        throw new Error('Review document identity or physical page is invalid.');
      if (name === 'review_states' && ((row.offset as number) < 0 || (row.offset as number) > 1
        || (row.zoom as number) < 75 || (row.zoom as number) > 200 || (row.zoom as number) % 25 !== 0))
        throw new Error('Review reader position or zoom is invalid.');
      if (name === 'step_completions' && !['review', 'assessment', 'plan'].includes(row.step as string))
        throw new Error('An annual manual completion step is invalid.');
      if (name === 'evidence_attachments' && (!(row.original_filename as string).length
        || !SUPPORTED_EVIDENCE_EXTENSIONS.includes(row.type as typeof SUPPORTED_EVIDENCE_EXTENSIONS[number])
        || (row.byte_count as number) < 0 || (row.byte_count as number) > MAX_EVIDENCE_BYTES || !/^[\da-f]{64}$/.test(row.sha256 as string)))
        throw new Error('Managed evidence metadata has an invalid type, size, name or SHA-256.');
      if (++checked % 1000 === 0) {
        await new Promise<void>(resolveTick => setImmediate(resolveTick));
        signal.throwIfAborted();
      }
    }
  }
}

export function datasetSummary(db: Database.Database): DatasetSummary {
  const count = (table: string) => (db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count;
  return {
    years: (db.prepare('SELECT year FROM year_packages ORDER BY year DESC').all() as { year: number }[]).map(row => row.year),
    goals: count('learning_goals'), activities: count('learning_activities'), evidenceFiles: count('evidence_attachments'),
  };
}
function safePath(path: string) {
  if (!path || path.includes('\\') || path.includes(':') || path.includes('\0')
    || path.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error(`Unsafe archive path: ${JSON.stringify(path)}. Absolute paths and parent traversal are not allowed.`);
}
function object(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)))
    throw new Error('The backup manifest has malformed or unsupported fields.');
}
function manifestFrom(bytes: Buffer): FullBackupManifest {
  const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const manifest: unknown = JSON.parse(json);
  const objects: (Set<string> | null)[] = [];
  for (const token of json.matchAll(/"(?:\\.|[^"\\])*"|[{}[\]]/g)) {
    if (token[0] === '{') objects.push(new Set());
    else if (token[0] === '[') objects.push(null);
    else if (token[0] === '}' || token[0] === ']') objects.pop();
    else if (/^\s*:/.test(json.slice(token.index + token[0].length))) {
      const key = JSON.parse(token[0]) as string;
      const keys = objects.at(-1)!;
      if (keys.has(key)) throw new Error('Duplicate property in the backup manifest.');
      keys.add(key);
    }
  }
  if (manifest && typeof manifest === 'object' && 'kind' in manifest && manifest.kind === 'portfolio')
    throw new Error('Annual portfolio archives are not restorable full-app backups. Choose a full backup of all years.');
  object(manifest, ['kind', 'archiveVersion', 'schemaVersion', 'appId', 'sourceSetId', 'createdAt', 'dataRevision', 'files']);
  if (manifest.kind !== 'full-backup') throw new Error('This archive is not a full-app backup.');
  if (manifest.archiveVersion !== 1) throw new Error('This backup archive version is unsupported. Use a compatible SWCC build.');
  if (manifest.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported backup schema. This build inspects schema ${SCHEMA_VERSION} only; use a compatible SWCC build.`);
  if (manifest.appId !== 'org.swcc.desktop') throw new Error('This archive belongs to a different application.');
  if (manifest.sourceSetId !== SOURCE_SET_ID) throw new Error('The backup source set is incompatible with the supplied SWCC documents.');
  if (!validInstant(manifest.createdAt))
    throw new Error('The backup creation date is invalid.');
  if (!Number.isSafeInteger(manifest.dataRevision) || (manifest.dataRevision as number) < 0)
    throw new Error('The backup data revision is invalid.');
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > MAX_FILES)
    throw new Error('The backup file inventory is missing or exceeds the supported inspection limit.');
  const names = new Set<string>();
  for (const file of manifest.files) {
    object(file, ['path', 'byteCount', 'sha256']);
    if (typeof file.path !== 'string') throw new Error('A backup inventory path is not text.');
    safePath(file.path);
    if (file.path !== 'database.sqlite' && !/^evidence\/[1-9]\d{0,3}\/E[1-9]\d*-[\da-f-]{36}\.[a-z]+$/.test(file.path))
      throw new Error(`Unsupported backup inventory path: ${file.path}.`);
    if (names.has(file.path.toLowerCase())) throw new Error(`Duplicate inventory entry: ${file.path}.`);
    names.add(file.path.toLowerCase());
    const limit = file.path === 'database.sqlite' ? MAX_DATABASE_BYTES : MAX_EVIDENCE_BYTES;
    if (!Number.isSafeInteger(file.byteCount) || (file.byteCount as number) < 0 || (file.byteCount as number) > limit)
      throw new Error(`Invalid file size for ${file.path}; evidence is limited to 50 MiB.`);
    if (typeof file.sha256 !== 'string' || !/^[\da-f]{64}$/.test(file.sha256))
      throw new Error(`Invalid SHA-256 for ${file.path}.`);
  }
  if (!names.has('database.sqlite')) throw new Error('The backup inventory is missing database.sqlite.');
  return manifest as unknown as FullBackupManifest;
}
async function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolveZip, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: false },
      (error, zip) => error || !zip ? reject(error ?? new Error('Cannot read ZIP.')) : resolveZip(zip));
  });
}
async function entriesFrom(zip: ZipFile, signal: AbortSignal): Promise<Map<string, Entry>> {
  return new Promise((resolveEntries, reject) => {
    const entries = new Map<string, Entry>();
    const names = new Set<string>();
    zip.once('error', reject);
    const abort = () => { zip.close(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    const finish = () => signal.removeEventListener('abort', abort);
    zip.on('entry', entry => {
      try {
        signal.throwIfAborted();
        safePath(entry.fileName);
        const type = (entry.externalFileAttributes >>> 16) & 0o170000;
        if ((type && type !== 0o100000) || (entry.externalFileAttributes & 0x10))
          throw new Error(`Archive symlinks, directories and special files are not allowed: ${entry.fileName}.`);
        if (entry.generalPurposeBitFlag & 1) throw new Error('Encrypted archives are not supported.');
        if (names.has(entry.fileName.toLowerCase())) throw new Error(`Duplicate archive entry: ${entry.fileName}.`);
        names.add(entry.fileName.toLowerCase());
        entries.set(entry.fileName, entry);
        if (entries.size > MAX_FILES + 1) throw new Error('Too many archive entries to inspect safely.');
        zip.readEntry();
      } catch (error) { finish(); reject(error); }
    });
    zip.once('error', finish);
    zip.once('end', () => { finish(); resolveEntries(entries); });
    if (signal.aborted) { abort(); return; }
    zip.readEntry();
  });
}
async function streamFor(zip: ZipFile, entry: Entry) {
  return new Promise<import('node:stream').Readable>((resolveStream, reject) => {
    zip.openReadStream(entry, (error, stream) => error || !stream ? reject(error ?? new Error('Cannot read archive entry.')) : resolveStream(stream));
  });
}

export async function inspectArchive(
  archive: string, paths: ReturnType<typeof storageLayout>, current: () => DatasetSummary,
  signal: AbortSignal, report: (progress: RestoreProgress) => void,
): Promise<{ directory: string; preview: RestorePreview }> {
  let directory: string | undefined;
  const zip = await openZip(archive);
  let zipError: unknown;
  zip.on('error', error => { zipError = error; });
  const progress: RestoreProgress = { phase: 'reading', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0 };
  try {
    report({ ...progress });
    signal.throwIfAborted();
    const entries = await entriesFrom(zip, signal);
    const manifestEntry = entries.get('manifest.json');
    if (!manifestEntry) throw new Error('This ZIP is missing a full-backup manifest.');
    const chunks: Buffer[] = [];
    let manifestSize = 0;
    for await (const chunk of addAbortSignal(signal, await streamFor(zip, manifestEntry))) {
      signal.throwIfAborted();
      manifestSize += (chunk as Buffer).length;
      if (manifestSize > MAX_MANIFEST_BYTES) throw new Error('The backup manifest exceeds the 4 MiB inspection limit.');
      chunks.push(chunk as Buffer);
    }
    if (manifestSize !== manifestEntry.uncompressedSize)
      throw new Error('The actual manifest size disagrees with ZIP metadata.');
    const manifest = manifestFrom(Buffer.concat(chunks));
    if (entries.size !== manifest.files.length + 1 || manifest.files.some(file => !entries.has(file.path)))
      throw new Error('The archive inventory has missing or undeclared files. No files may be silently omitted.');
    const root = await realpath(dirname(paths.dataset));
    const staging = join(root, 'restore-staging');
    const fromDataset = relative(await realpath(paths.dataset), staging);
    if (!fromDataset || (!fromDataset.startsWith(`..${sep}`) && fromDataset !== '..' && !isAbsolute(fromDataset)))
      throw new Error('Restore staging must be outside the resolved live dataset. Preserve the dataset and repair its storage layout.');
    await mkdir(staging, { mode: 0o700 }).catch(error => {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
    });
    const stagingInfo = await lstat(staging);
    if (!stagingInfo.isDirectory() || stagingInfo.isSymbolicLink() || await realpath(staging) !== staging)
      throw new Error('Restore staging must be a regular directory outside the live dataset, not a symbolic link.');
    const ownedDirectory = join(staging, `inspection-${randomUUID()}`);
    await mkdir(ownedDirectory, { mode: 0o700 });
    directory = ownedDirectory;
    progress.phase = 'extracting';
    progress.filesTotal = manifest.files.length;
    progress.bytesTotal = manifest.files.reduce((sum, file) => sum + file.byteCount, 0);
    report({ ...progress });
    for (const file of manifest.files) {
      signal.throwIfAborted();
      const entry = entries.get(file.path)!;
      const destination = join(directory, file.path);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      let byteCount = 0;
      const hash = createHash('sha256');
      const limit = file.path === 'database.sqlite' ? MAX_DATABASE_BYTES : MAX_EVIDENCE_BYTES;
      const checking = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          byteCount += chunk.length;
          if (byteCount > limit) { callback(new Error(`${file.path} exceeds the actual extraction limit (${file.path === 'database.sqlite' ? '512 MiB' : '50 MiB'}).`)); return; }
          hash.update(chunk);
          progress.bytesCompleted += chunk.length;
          report({ ...progress });
          callback(null, chunk);
        },
      });
      await pipeline(await streamFor(zip, entry), checking, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal });
      if (byteCount !== file.byteCount || byteCount !== entry.uncompressedSize)
        throw new Error(`The actual size of ${file.path} does not match its inventory or ZIP metadata.`);
      if (hash.digest('hex') !== file.sha256) throw new Error(`SHA-256 integrity check failed for ${file.path}.`);
      progress.filesCompleted++;
      report({ ...progress });
    }
    if (zipError) throw zipError;
    signal.throwIfAborted();
    progress.phase = 'validating';
    report({ ...progress });
    const db = new Database(join(directory, 'database.sqlite'), { readonly: true, fileMustExist: true });
    let backup: DatasetSummary;
    try {
      db.pragma('trusted_schema = OFF');
      db.pragma('query_only = ON');
      validateSchema(db);
      await validateStoredTypes(db, signal);
      if (db.pragma('integrity_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length)
        throw new Error('The staged database failed its integrity or relationship check.');
      if (db.pragma('user_version', { simple: true }) !== manifest.schemaVersion)
        throw new Error('The database schema version disagrees with the manifest.');
      if (db.prepare('SELECT 1 FROM year_packages WHERE source_set_id != ?').get(SOURCE_SET_ID))
        throw new Error('The database contains an incompatible source set.');
      const meta = db.prepare('SELECT data_revision AS revision FROM app_metadata WHERE id = 1').get() as { revision: number } | undefined;
      if (!meta || meta.revision !== manifest.dataRevision
        || (db.prepare('SELECT count(*) AS count FROM app_metadata').get() as { count: number }).count !== 1)
        throw new Error('The database metadata or data revision disagrees with the manifest.');
      const metadata = db.prepare('SELECT last_backup_at, last_backup_revision FROM app_metadata WHERE id = 1').get() as
        { last_backup_at: string | null; last_backup_revision: number | null };
      if ((metadata.last_backup_at === null) !== (metadata.last_backup_revision === null)
        || (metadata.last_backup_revision !== null && (metadata.last_backup_revision < 0 || metadata.last_backup_revision > meta.revision)))
        throw new Error('The saved backup timestamp and revision relationship is invalid.');
      if (db.prepare(`SELECT 1 FROM year_packages WHERE assessment_revision > content_revision
        OR plan_revision > content_revision`).get()
        || (db.prepare('SELECT coalesce(sum(content_revision + review_revision), 0) AS revision FROM year_packages').get() as { revision: number }).revision > meta.revision)
        throw new Error('The annual and application data revision relationships are invalid.');
      if (db.prepare(`SELECT 1 FROM year_packages WHERE (declaration_date IS NULL) != (declaration_recorded_at IS NULL)`).get())
        throw new Error('A declaration date is missing its recorded timestamp, or conversely.');
      if (db.prepare(`SELECT 1 FROM step_completions c JOIN year_packages p ON p.id = c.package_id
        WHERE c.completed_revision > CASE c.step WHEN 'review' THEN p.review_revision
        WHEN 'assessment' THEN p.assessment_revision WHEN 'plan' THEN p.plan_revision END`).get())
        throw new Error('A manual completion revision is newer than its owning annual step.');
      for (const row of db.prepare('SELECT assessment_date, plan_date, declaration_date FROM year_packages').all() as
        { assessment_date: string; plan_date: string; declaration_date: string | null }[]) {
        for (const date of [row.assessment_date, row.plan_date]) {
          if (typeof date !== 'string' || (date !== '' && !validDate(date))) throw new Error('An annual draft date is invalid.');
        }
        if (row.declaration_date !== null && !validDate(row.declaration_date)) throw new Error('A declaration date is invalid.');
      }
      for (const row of db.prepare('SELECT status, completion_date AS completionDate, evidence_links AS evidenceLinks FROM learning_activities').all() as
        (Pick<ActivityFields, 'status' | 'completionDate'> & { evidenceLinks: string })[]) {
        const error = activityDateError(row);
        if (error) throw new Error(`An activity date is invalid: ${error}`);
        const links: unknown = JSON.parse(row.evidenceLinks);
        if (!Array.isArray(links) || links.some(link => typeof link !== 'string' || !validEvidenceLink(link)))
          throw new Error('An activity contains invalid evidence links.');
      }
      for (const [kind, table] of [['G', 'learning_goals'], ['A', 'learning_activities'], ['E', 'evidence_attachments']]) {
        if (db.prepare(`SELECT 1 FROM year_packages p LEFT JOIN reference_counters c
          ON c.package_id = p.id AND c.kind = ? WHERE c.next_number IS NULL
          OR c.next_number <= (SELECT coalesce(max(reference_number), 0) FROM ${table} WHERE package_id = p.id)`).get(kind))
          throw new Error(`A stable ${kind} reference counter is missing or would reuse an allocated reference.`);
      }
      const evidence = db.prepare(`SELECT e.managed_path AS path, e.byte_count AS byteCount, e.sha256,
        p.year, e.reference_number AS reference, e.type FROM evidence_attachments e
        JOIN year_packages p ON p.id = e.package_id`).all() as
        { path: string; byteCount: number; sha256: string; year: number; reference: number; type: string }[];
      const inventory = new Map(manifest.files.filter(file => file.path !== 'database.sqlite').map(file => [file.path, file]));
      if (evidence.length !== inventory.size) throw new Error('The database evidence records disagree with the archive inventory.');
      for (const row of evidence) {
        const file = inventory.get(`evidence/${row.path}`);
        if (!new RegExp(`^${row.year}/E${row.reference}-[\\da-f-]{36}\\.${row.type}$`).test(row.path)
          || !file || row.byteCount !== file.byteCount || row.sha256 !== file.sha256)
          throw new Error('A managed evidence path, size or hash disagrees with its database ownership and archive inventory.');
      }
      backup = datasetSummary(db);
    } finally { db.close(); }
    signal.throwIfAborted();
    return { directory, preview: { fileName: basename(archive), createdAt: manifest.createdAt, backup, current: current() } };
  } catch (error) {
    if (directory) {
      try { await rm(directory, { recursive: true, force: true }); }
      catch (cleanupError) { throw new RestoreCleanupFailure(directory, cleanupError); }
    }
    throw error;
  } finally { zip.close(); }
}
