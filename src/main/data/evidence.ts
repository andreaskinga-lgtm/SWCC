import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, createReadStream, createWriteStream, existsSync, fsyncSync, mkdirSync, openSync,
  readSync, renameSync, statSync, unlinkSync,
} from 'node:fs';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type Database from 'better-sqlite3';
import type {
  EvidenceActionRequest, EvidenceAttachment, EvidenceImportOutcome,
  EvidenceIntegrity, EvidencePreview, EvidenceRequest, OperationError, RemoveEvidenceRequest,
  ReplaceEvidenceRequest, YearPackage,
} from '../../shared/application.js';

export const MAX_EVIDENCE_BYTES = 52_428_800;
export const SUPPORTED_EVIDENCE_EXTENSIONS = [
  'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'doc', 'docx',
  'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'txt', 'csv',
] as const;

const supportedExtensions = new Set<string>(SUPPORTED_EVIDENCE_EXTENSIONS);
const previewTypes: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

interface EvidenceRow {
  id: string;
  packageId: string;
  activityId: string;
  referenceNumber: number;
  originalName: string;
  managedPath: string;
  type: string;
  byteCount: number;
  sha256: string;
  importedAt: string;
}

interface CopyResult {
  byteCount: number;
  sha256: string;
}

export interface EvidenceSelection {
  packageId: string;
  activityId: string;
  activityRef: string;
  activityTitle: string;
}

export interface EvidenceSystem {
  chooseFile?: (selection: EvidenceSelection) => Promise<string | null>;
  openPath?: (managedPath: string) => Promise<string>;
  copyToTemporary?: (sourcePath: string, temporaryPath: string, maximumBytes: number) => Promise<CopyResult>;
}

export interface EvidenceOperations {
  getEvidence(packageId: string): EvidenceAttachment[];
  importEvidence(input: EvidenceRequest): Promise<EvidenceImportOutcome>;
  replaceEvidence(input: ReplaceEvidenceRequest): Promise<EvidenceImportOutcome>;
  removeEvidence(input: RemoveEvidenceRequest): YearPackage;
  previewEvidence(input: EvidenceActionRequest): EvidencePreview;
  openEvidence(input: EvidenceActionRequest): Promise<void>;
  readableActivityIds(packageId: string): ReadonlySet<string>;
}

class CopyFailure extends Error {
  constructor(readonly kind: 'source' | 'storage', readonly original: unknown) {
    super(original instanceof Error ? original.message : String(original));
  }
}

class FileTooLarge extends Error {}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function copyAndHash(sourcePath: string, temporaryPath: string, maximumBytes: number): Promise<CopyResult> {
  return new Promise((resolveCopy, rejectCopy) => {
    const hash = createHash('sha256');
    let byteCount = 0;
    let firstFailure: { kind: 'source' | 'storage'; error: unknown } | undefined;
    const reader = createReadStream(sourcePath);
    const writer = createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 });
    reader.once('error', error => { firstFailure ??= { kind: 'source', error }; });
    writer.once('error', error => { firstFailure ??= { kind: 'storage', error }; });
    const measure = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteCount += chunk.byteLength;
        if (byteCount > maximumBytes) {
          callback(new FileTooLarge());
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    void pipeline(reader, measure, writer).then(() => {
      try {
        const descriptor = openSync(temporaryPath, 'r+');
        try { fsyncSync(descriptor); }
        finally { closeSync(descriptor); }
        resolveCopy({ byteCount, sha256: hash.digest('hex') });
      } catch (error) { rejectCopy(new CopyFailure('storage', error)); }
    }, error => {
      if (error instanceof FileTooLarge) rejectCopy(error);
      else if (firstFailure) rejectCopy(new CopyFailure(firstFailure.kind, firstFailure.error));
      else rejectCopy(new CopyFailure('storage', error));
    });
  });
}

function removeFile(path: string) {
  try { unlinkSync(path); }
  catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
}

function copyFailure(error: unknown, fail: (code: OperationError['code'], message: string) => never): never {
  if (error instanceof FileTooLarge) {
    return fail('FILE_TOO_LARGE', `This file is larger than 50 MiB (${MAX_EVIDENCE_BYTES.toLocaleString()} bytes). Choose a smaller file.`);
  }
  const failure = error instanceof CopyFailure ? error : null;
  const code = errorCode(failure?.original ?? error);
  if (code === 'ENOSPC' || code === 'EDQUOT') {
    return fail('STORAGE', 'SWCC could not store this evidence because the device is out of space. Free disk space and retry; no evidence was added.');
  }
  if (failure?.kind === 'storage' && (code === 'EACCES' || code === 'EPERM')) {
    return fail('STORAGE', 'SWCC cannot write to its managed evidence folder. Check folder permissions and retry; no evidence was added.');
  }
  if (failure?.kind === 'source' || !failure) {
    return fail('UNREADABLE', `SWCC could not read the selected file. Check its permissions and that it is available, then select it again. ${messageOf(failure?.original ?? error)}`);
  }
  return fail('STORAGE', `SWCC could not save this evidence file. Check the managed storage folder and available disk space, then retry. ${messageOf(failure.original)}`);
}

function asEntry(row: EvidenceRow, integrity: EvidenceIntegrity): EvidenceAttachment {
  return {
    id: row.id,
    packageId: row.packageId,
    activityId: row.activityId,
    ref: `E${row.referenceNumber}`,
    originalName: row.originalName,
    type: row.type,
    byteCount: row.byteCount,
    sha256: row.sha256,
    importedAt: row.importedAt,
    integrity,
  };
}

export function evidenceOperations(
  db: Database.Database,
  evidenceRoot: string,
  getPackage: (id: string) => YearPackage,
  now: () => string,
  fail: (code: OperationError['code'], message: string) => never,
  identifier: (value: unknown) => void,
  system: EvidenceSystem = {},
): EvidenceOperations {
  const root = resolve(evidenceRoot);
  const rowSelect = `SELECT id, package_id AS packageId, activity_id AS activityId,
    reference_number AS referenceNumber, original_filename AS originalName, managed_path AS managedPath,
    type, byte_count AS byteCount, sha256, imported_at AS importedAt FROM evidence_attachments`;

  function managedFilePath(managedPath: string): string | null {
    if (!managedPath || isAbsolute(managedPath) || managedPath.includes('\\') || managedPath.includes('\0')) return null;
    const parts = managedPath.split('/');
    if (parts.some(part => !part || part === '.' || part === '..')) return null;
    const path = resolve(root, ...parts);
    const relativePath = relative(root, path);
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return null;
    return path;
  }

  function rowsForPackage(packageId: string): EvidenceRow[] {
    return db.prepare(`${rowSelect} WHERE package_id = ? ORDER BY reference_number`).all(packageId) as EvidenceRow[];
  }

  function rowFor(input: EvidenceActionRequest): EvidenceRow {
    const row = db.prepare(`${rowSelect} WHERE id = ? AND package_id = ? AND activity_id = ?`)
      .get(input.evidenceId, input.packageId, input.activityId) as EvidenceRow | undefined;
    if (!row) fail('NOT_FOUND', 'This evidence entry no longer exists on this activity in this year.');
    return row;
  }

  function inspect(row: EvidenceRow, includeBytes = false): { integrity: EvidenceIntegrity; bytes?: Buffer } {
    const path = managedFilePath(row.managedPath);
    if (!path) return { integrity: 'corrupt' };
    if (!Number.isSafeInteger(row.byteCount) || row.byteCount < 0 || row.byteCount > MAX_EVIDENCE_BYTES)
      return { integrity: 'corrupt' };
    let descriptor: number | undefined;
    try {
      descriptor = openSync(path, 'r');
      const bytes = includeBytes ? Buffer.allocUnsafe(row.byteCount) : undefined;
      const buffer = Buffer.allocUnsafe(64 * 1024);
      const hash = createHash('sha256');
      let byteCount = 0;
      while (true) {
        const count = readSync(descriptor, buffer, 0, buffer.byteLength, null);
        if (!count) break;
        if (byteCount + count > row.byteCount) return { integrity: 'corrupt' };
        hash.update(buffer.subarray(0, count));
        if (bytes) buffer.copy(bytes, byteCount, 0, count);
        byteCount += count;
      }
      if (byteCount !== row.byteCount || hash.digest('hex') !== row.sha256)
        return { integrity: 'corrupt' };
      return { integrity: 'readable', bytes };
    } catch (error) {
      return { integrity: errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR' ? 'missing' : 'unreadable' };
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }

  function evidenceEntry(row: EvidenceRow): EvidenceAttachment {
    return asEntry(row, inspect(row).integrity);
  }

  function readableActivityIds(packageId: string): ReadonlySet<string> {
    return new Set(rowsForPackage(packageId).filter(row => inspect(row).integrity === 'readable').map(row => row.activityId));
  }

  function validateMutation(input: unknown, fields: readonly string[]): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('VALIDATION', 'The evidence request is invalid.');
    const request = input as Record<string, unknown>;
    if (Object.keys(request).some(key => !fields.includes(key))) fail('VALIDATION', 'The evidence request contains unsupported fields.');
    identifier(request.packageId);
    identifier(request.activityId);
    if (!Number.isSafeInteger(request.expectedRevision) || (request.expectedRevision as number) < 0)
      fail('VALIDATION', 'The package revision is invalid.');
    return request;
  }

  function validateAction(input: unknown): EvidenceActionRequest {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('VALIDATION', 'The evidence request is invalid.');
    const request = input as Record<string, unknown>;
    if (Object.keys(request).some(key => !['packageId', 'activityId', 'evidenceId'].includes(key)))
      fail('VALIDATION', 'The evidence request contains unsupported fields.');
    identifier(request.packageId);
    identifier(request.activityId);
    identifier(request.evidenceId);
    return request as unknown as EvidenceActionRequest;
  }

  function assertCurrentPackage(packageId: string, activityId: string, expectedRevision: number) {
    const pkg = getPackage(packageId);
    if (pkg.contentRevision !== expectedRevision)
      fail('CONFLICT', 'This year changed before the evidence operation completed. Keep your edits and retry after saving the current record.');
    const activity = pkg.activities.find(item => item.id === activityId);
    if (!activity) fail('NOT_FOUND', 'This activity no longer exists in this year.');
    return { pkg, activity };
  }

  function selectedFile(path: unknown): { path: string; originalName: string; type: string; size: number } {
    if (typeof path !== 'string' || !path || path.includes('\0')) fail('UNREADABLE', 'Select a file, not a folder.');
    let stats;
    try { stats = statSync(path); }
    catch (error) {
      fail('UNREADABLE', `SWCC could not read the selected file. Check its permissions and that it is available, then select it again. ${messageOf(error)}`);
    }
    if (!stats.isFile()) fail('UNREADABLE', 'Choose a file, not a directory.');
    const originalName = basename(path);
    const type = extname(originalName).slice(1).toLowerCase();
    if (!supportedExtensions.has(type)) {
      fail('UNSUPPORTED_FILE', `“${originalName}” is not a supported evidence type. Choose PDF, PNG, JPG, JPEG, WEBP, GIF, BMP, DOC, DOCX, XLS, XLSX, PPT, PPTX, RTF, TXT, or CSV.`);
    }
    if (stats.size > MAX_EVIDENCE_BYTES)
      fail('FILE_TOO_LARGE', `“${originalName}” is larger than 50 MiB (${MAX_EVIDENCE_BYTES.toLocaleString()} bytes). Choose a smaller file.`);
    return { path, originalName, type, size: stats.size };
  }

  async function chooseSource(input: EvidenceRequest): Promise<{ pkg: YearPackage; activityId: string; path: string } | null> {
    const initial = assertCurrentPackage(input.packageId, input.activityId, input.expectedRevision);
    if (!system.chooseFile) fail('IPC', 'The evidence file chooser is unavailable. Restart SWCC and retry.');
    let path: string | null;
    try {
      path = await system.chooseFile({
        packageId: input.packageId,
        activityId: input.activityId,
        activityRef: initial.activity.ref,
        activityTitle: initial.activity.title,
      });
    } catch (error) {
      fail('UNREADABLE', `The evidence file chooser could not be opened. Check SWCC's file permissions and retry. ${messageOf(error)}`);
    }
    if (path === null) return null;
    selectedFile(path);
    return { pkg: initial.pkg, activityId: input.activityId, path };
  }

  function advanceEvidenceRevision(packageId: string, activityId: string, timestamp: string) {
    db.prepare('UPDATE learning_activities SET updated_at = ? WHERE id = ? AND package_id = ?')
      .run(timestamp, activityId, packageId);
    db.prepare(`UPDATE year_packages SET content_revision = content_revision + 1,
      plan_revision = plan_revision + 1, updated_at = ? WHERE id = ?`).run(timestamp, packageId);
    db.prepare('UPDATE app_metadata SET data_revision = data_revision + 1 WHERE id = 1').run();
  }

  function stageDirectory(year: number): string {
    const directory = resolve(root, String(year));
    try { mkdirSync(directory, { recursive: true, mode: 0o700 }); }
    catch (error) {
      if (errorCode(error) === 'ENOSPC' || errorCode(error) === 'EDQUOT')
        fail('STORAGE', 'SWCC could not store this evidence because the device is out of space. Free disk space and retry; no evidence was added.');
      if (errorCode(error) === 'EACCES' || errorCode(error) === 'EPERM')
        fail('STORAGE', 'SWCC cannot write to its managed evidence folder. Check folder permissions and retry; no evidence was added.');
      fail('STORAGE', `SWCC could not prepare managed evidence storage. Check disk space and folder permissions, then retry. ${messageOf(error)}`);
    }
    return directory;
  }

  async function copySelected(sourcePath: string, temporaryPath: string): Promise<CopyResult> {
    try {
      const copied = await (system.copyToTemporary ?? copyAndHash)(sourcePath, temporaryPath, MAX_EVIDENCE_BYTES);
      if (!Number.isSafeInteger(copied.byteCount) || copied.byteCount < 0 || copied.byteCount > MAX_EVIDENCE_BYTES)
        throw new FileTooLarge();
      if (!/^[\da-f]{64}$/i.test(copied.sha256)) throw new Error('The evidence hash could not be calculated.');
      return { byteCount: copied.byteCount, sha256: copied.sha256.toLowerCase() };
    } catch (error) {
      copyFailure(error, fail);
    }
  }

  function cleanup(path: string | null) {
    if (!path) return;
    try { removeFile(path); }
    catch { fail('STORAGE', 'SWCC could not remove an incomplete evidence copy. Keep the application open, check managed-folder permissions, and contact support before retrying.'); }
  }

  async function importEvidence(input: EvidenceRequest): Promise<EvidenceImportOutcome> {
    const request = validateMutation(input, ['packageId', 'activityId', 'expectedRevision']) as unknown as EvidenceRequest;
    const chosen = await chooseSource(request);
    if (!chosen) return { cancelled: true };
    const source = selectedFile(chosen.path);
    const directory = stageDirectory(chosen.pkg.year);
    const id = randomUUID();
    const temporaryPath = resolve(directory, `.import-${id}.partial`);
    let publishedPath: string | null = null;
    const copied = await copySelected(source.path, temporaryPath).catch(error => {
      try { cleanup(temporaryPath); }
      catch (cleanupError) { throw cleanupError; }
      throw error;
    });
    let created: { row: EvidenceRow; package: YearPackage };
    try {
      created = db.transaction(() => {
        const { pkg, activity } = assertCurrentPackage(request.packageId, request.activityId, request.expectedRevision);
        const counter = db.prepare("SELECT next_number AS nextNumber FROM reference_counters WHERE package_id = ? AND kind = 'E'")
          .get(request.packageId) as { nextNumber: number } | undefined;
        if (!counter) fail('STORAGE', 'The evidence reference counter is missing. Preserve this dataset and retry after recovery.');
        const managedPath = `${pkg.year}/E${counter.nextNumber}-${id}.${source.type}`;
        const finalPath = managedFilePath(managedPath);
        if (!finalPath) fail('STORAGE', 'SWCC could not allocate a safe managed evidence location.');
        renameSync(temporaryPath, finalPath);
        publishedPath = finalPath;
        const importedAt = now();
        db.prepare(`INSERT INTO evidence_attachments(
          id, package_id, activity_id, reference_number, original_filename, managed_path, type, byte_count, sha256, imported_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id, request.packageId, request.activityId, counter.nextNumber, source.originalName, managedPath,
          source.type, copied.byteCount, copied.sha256, importedAt,
        );
        db.prepare("UPDATE reference_counters SET next_number = next_number + 1 WHERE package_id = ? AND kind = 'E'")
          .run(request.packageId);
        advanceEvidenceRevision(request.packageId, activity.id, importedAt);
        return {
          row: db.prepare(`${rowSelect} WHERE id = ?`).get(id) as EvidenceRow,
          package: getPackage(request.packageId),
        };
      }).immediate();
    } catch (error) {
      cleanup(temporaryPath);
      cleanup(publishedPath);
      throw error;
    }
    return { cancelled: false, attachment: asEntry(created.row, 'readable'), package: created.package };
  }

  async function replaceEvidence(input: ReplaceEvidenceRequest): Promise<EvidenceImportOutcome> {
    const request = validateMutation(input, ['packageId', 'activityId', 'expectedRevision', 'evidenceId']) as unknown as ReplaceEvidenceRequest;
    identifier(request.evidenceId);
    const chosen = await chooseSource(request);
    if (!chosen) return { cancelled: true };
    const source = selectedFile(chosen.path);
    const existing = rowFor(request);
    const directory = stageDirectory(chosen.pkg.year);
    const temporaryPath = resolve(directory, `.replace-${randomUUID()}.partial`);
    let publishedPath: string | null = null;
    const copied = await copySelected(source.path, temporaryPath).catch(error => {
      try { cleanup(temporaryPath); }
      catch (cleanupError) { throw cleanupError; }
      throw error;
    });
    let updated: { row: EvidenceRow; package: YearPackage };
    try {
      updated = db.transaction(() => {
        const { pkg, activity } = assertCurrentPackage(request.packageId, request.activityId, request.expectedRevision);
        const current = rowFor(request);
        const managedPath = `${pkg.year}/E${current.referenceNumber}-${randomUUID()}.${source.type}`;
        const finalPath = managedFilePath(managedPath);
        if (!finalPath) fail('STORAGE', 'SWCC could not allocate a safe managed evidence location.');
        renameSync(temporaryPath, finalPath);
        publishedPath = finalPath;
        const importedAt = now();
        db.prepare(`UPDATE evidence_attachments SET original_filename = ?, managed_path = ?, type = ?,
          byte_count = ?, sha256 = ?, imported_at = ? WHERE id = ? AND package_id = ? AND activity_id = ?`)
          .run(source.originalName, managedPath, source.type, copied.byteCount, copied.sha256, importedAt,
            request.evidenceId, request.packageId, request.activityId);
        advanceEvidenceRevision(request.packageId, activity.id, importedAt);
        return {
          row: db.prepare(`${rowSelect} WHERE id = ?`).get(request.evidenceId) as EvidenceRow,
          package: getPackage(request.packageId),
        };
      }).immediate();
    } catch (error) {
      cleanup(temporaryPath);
      cleanup(publishedPath);
      throw error;
    }
    const previousPath = managedFilePath(existing.managedPath);
    if (previousPath) {
      try { removeFile(previousPath); } catch { /* The committed replacement remains usable. */ }
    }
    return { cancelled: false, attachment: asEntry(updated.row, 'readable'), package: updated.package };
  }

  function removeEvidence(input: RemoveEvidenceRequest): YearPackage {
    const request = validateMutation(input, ['packageId', 'activityId', 'evidenceId', 'expectedRevision']) as unknown as RemoveEvidenceRequest;
    identifier(request.evidenceId);
    assertCurrentPackage(request.packageId, request.activityId, request.expectedRevision);
    const existing = rowFor(request);
    const originalPath = managedFilePath(existing.managedPath);
    const tombstone = originalPath ? `${originalPath}.remove-${randomUUID()}` : null;
    let moved = false;
    if (originalPath && existsSync(originalPath)) {
      try { renameSync(originalPath, tombstone!); moved = true; }
      catch (error) {
        fail('STORAGE', `SWCC could not remove ${`E${existing.referenceNumber}`} from managed storage. Check folder permissions and retry. ${messageOf(error)}`);
      }
    }
    try {
      const removed = db.transaction(() => {
        const { activity } = assertCurrentPackage(request.packageId, request.activityId, request.expectedRevision);
        rowFor(request);
        const result = db.prepare('DELETE FROM evidence_attachments WHERE id = ? AND package_id = ? AND activity_id = ?')
          .run(request.evidenceId, request.packageId, request.activityId);
        if (!result.changes) fail('NOT_FOUND', 'This evidence entry no longer exists on this activity in this year.');
        advanceEvidenceRevision(request.packageId, activity.id, now());
        return getPackage(request.packageId);
      }).immediate();
      if (moved) {
        try { removeFile(tombstone!); } catch { /* The record is removed; leftover bytes are not exposed to the renderer. */ }
      }
      return removed;
    } catch (error) {
      if (moved && tombstone && originalPath && existsSync(tombstone)) {
        try { renameSync(tombstone, originalPath); } catch { /* Preserve the original transaction error. */ }
      }
      throw error;
    }
  }

  function checkedRow(input: EvidenceActionRequest, includeBytes = false): { row: EvidenceRow; bytes?: Buffer } {
    validateAction(input);
    getPackage(input.packageId);
    const row = rowFor(input);
    const checked = inspect(row, includeBytes);
    if (checked.integrity !== 'readable' || (includeBytes && !checked.bytes)) {
      const description = checked.integrity === 'missing' ? 'is missing'
        : checked.integrity === 'corrupt' ? 'failed its SHA-256 integrity check' : 'cannot be read';
      fail('EVIDENCE', `${`E${row.referenceNumber}`} ${description}. Replace or remove this evidence entry before using it.`);
    }
    return { row, bytes: checked.bytes };
  }

  return {
    getEvidence: packageId => {
      identifier(packageId);
      getPackage(packageId);
      return rowsForPackage(packageId).map(row => evidenceEntry(row));
    },
    importEvidence,
    replaceEvidence,
    removeEvidence: input => removeEvidence(input),
    previewEvidence: input => {
      const { row, bytes } = checkedRow(input, true);
      const mediaType = previewTypes[row.type];
      if (!mediaType) fail('VALIDATION', 'Only PDF and image evidence can be previewed internally. Use the explicit open action for other supported documents.');
      if (!bytes) fail('EVIDENCE', `E${row.referenceNumber} could not be read for preview.`);
      return {
        ref: `E${row.referenceNumber}`,
        originalName: row.originalName,
        type: mediaType,
        data: Uint8Array.from(bytes),
      } satisfies EvidencePreview;
    },
    openEvidence: async input => {
      const { row } = checkedRow(input);
      if (previewTypes[row.type]) fail('VALIDATION', 'Preview PDFs and images inside SWCC. Open-in-application is for other supported documents.');
      const path = managedFilePath(row.managedPath);
      if (!path) fail('EVIDENCE', `E${row.referenceNumber} has an invalid managed location. Replace or remove this evidence entry.`);
      if (!system.openPath) fail('OPEN', 'The desktop cannot open this document. Check that an associated application is installed.');
      let error: string;
      try {
        error = await system.openPath(path);
      } catch (error) {
        fail('OPEN', `E${row.referenceNumber} could not be opened: ${messageOf(error)}`);
      }
      if (error) fail('OPEN', `E${row.referenceNumber} could not be opened: ${error}`);
    },
    readableActivityIds,
  };
}
