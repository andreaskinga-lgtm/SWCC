import { afterEach, expect, test } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import yauzl from 'yauzl';
import Database from 'better-sqlite3';
import { Writable } from 'node:stream';
import { openApplication } from '../src/main/data/application.js';
import type { Result } from '../src/shared/application.js';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
const roots: string[] = [];
const apps: ReturnType<typeof openApplication>[] = [];
function storage() {
  const root = resolve('.work', `backup-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}
afterEach(() => {
  apps.splice(0).forEach(app => app.close());
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
});

test('backup waits for admitted evidence imports and rejects concurrent edits and deletion until publication', async () => {
  const root = storage();
  const destination = resolve(storage(), 'SWCC-test.swcc-backup.zip');
  const source = resolve(root, 'notes.txt');
  writeFileSync(source, 'Captured notes');
  let release!: (path: string) => void;
  const selected = new Promise<string>(resolveSelection => { release = resolveSelection; });
  const app = openApplication(root, {}, undefined, { chooseFile: () => selected }, {
    chooseDestination: async () => destination,
  });
  apps.push(app);
  const operations = app.operations;
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Consultation',
  }));
  const importing = operations.importEvidence({
    packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision,
  });
  const backingUp = operations.createFullBackup();
  expect(await operations.deleteYear({ packageId: pkg.id, expectedRevision: pkg.contentRevision, confirmed: true }))
    .toMatchObject({ ok: false, error: { code: 'BUSY' } });
  expect(await operations.updateActivity({
    packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision, title: 'Changed mid-backup',
  })).toMatchObject({ ok: false, error: { code: 'BUSY' } });
  expect(await operations.recordReviewVisits({ packageId: pkg.id, pages: [2] }))
    .toMatchObject({ ok: false, error: { code: 'BUSY' } });
  expect(await operations.createFullBackup()).toMatchObject({ ok: false, error: { code: 'BUSY' } });
  await expect.poll(async () => value(await operations.getBackupProgress()).phase).toBe('waiting');
  release(source);
  const imported = value(await importing);
  if (imported.cancelled) throw new Error('Unexpected cancellation');
  value(await backingUp);
  const zip = await contents(destination);
  expect([...zip.values()].some(bytes => bytes.toString() === 'Captured notes')).toBe(true);
  const state = value(await operations.getState());
  expect(state.lastBackupRevision).toBe(state.dataRevision);
  expect(value(await operations.getBackupProgress()).phase).toBe('idle');
  value(await operations.openYear(pkg.id));
  expect(value(await operations.getState()).dataRevision).toBe(state.dataRevision);
  pkg = value(await operations.updateActivity({
    packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: imported.package.contentRevision, title: 'Later change',
  }));
  expect(value(await operations.getState())).toMatchObject({
    lastBackupRevision: state.dataRevision, dataRevision: state.dataRevision + 1,
  });
  expect(pkg.activities[0].title).toBe('Later change');
});
async function contents(path: string): Promise<Map<string, Buffer>> {
  return new Promise((resolveZip, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) { reject(error); return; }
      const entries = new Map<string, Buffer>();
      zip.on('error', reject);
      zip.on('entry', entry => {
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) { reject(error); return; }
          const chunks: Buffer[] = [];
          stream.on('error', reject);
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolveZip(entries));
      zip.readEntry();
    });
  });
}

test.each(['missing', 'corrupt'] as const)('%s evidence stops backup without replacing an existing archive or its successful status', async kind => {
  const root = storage();
  const destination = resolve(storage(), 'SWCC-test.swcc-backup.zip');
  const source = resolve(root, 'notes.txt');
  writeFileSync(source, 'Captured notes');
  const app = openApplication(root, {}, undefined, { chooseFile: async () => source }, {
    chooseDestination: async () => destination,
  });
  apps.push(app);
  const operations = app.operations;
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createActivity({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Consultation' }));
  const imported = value(await operations.importEvidence({
    packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision,
  }));
  if (imported.cancelled) throw new Error('Unexpected cancellation');
  value(await operations.createFullBackup());
  const before = value(await operations.getState());
  const archive = readFileSync(destination);
  const managed = resolve(root, 'dataset/evidence/2024', readdirSync(resolve(root, 'dataset/evidence/2024'))[0]);
  if (kind === 'missing') rmSync(managed);
  else writeFileSync(managed, 'Modified notes');
  expect(await operations.createFullBackup()).toMatchObject({ ok: false, error: { code: 'EVIDENCE' } });
  expect(readFileSync(destination)).toEqual(archive);
  expect(value(await operations.getState())).toMatchObject({
    lastBackupAt: before.lastBackupAt, lastBackupRevision: before.lastBackupRevision, dataRevision: before.dataRevision,
  });
  expect(readdirSync(resolve(destination, '..'))).toEqual(['SWCC-test.swcc-backup.zip']);
  expect(readdirSync(resolve(root, 'runtime'))).toEqual([]);
  expect(value(await operations.getBackupProgress()).phase).toBe('idle');
});

test('backup rejects evidence outside the managed dataset, including symlinks and traversal metadata', async () => {
  const root = storage();
  const destination = resolve(storage(), 'SWCC-test.swcc-backup.zip');
  const source = resolve(root, 'notes.txt');
  writeFileSync(source, 'Captured notes');
  const app = openApplication(root, {}, undefined, { chooseFile: async () => source }, {
    chooseDestination: async () => destination,
  });
  apps.push(app);
  const operations = app.operations;
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createActivity({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Consultation' }));
  const imported = value(await operations.importEvidence({
    packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision,
  }));
  if (imported.cancelled) throw new Error('Unexpected cancellation');
  const managed = resolve(root, 'dataset/evidence/2024', readdirSync(resolve(root, 'dataset/evidence/2024'))[0]);
  rmSync(managed);
  symlinkSync(source, managed);
  expect(await operations.createFullBackup()).toMatchObject({ ok: false, error: { code: 'EVIDENCE' } });
  rmSync(managed);
  const fixture = new Database(resolve(root, 'dataset/database.sqlite'));
  fixture.prepare('UPDATE evidence_attachments SET managed_path = ? WHERE id = ?').run('../../notes.txt', imported.attachment.id);
  fixture.close();
  expect(await operations.createFullBackup()).toMatchObject({ ok: false, error: { code: 'EVIDENCE' } });
  expect(value(await operations.getState())).toMatchObject({ lastBackupAt: null, lastBackupRevision: null });
});

test('backup cannot overwrite any part of its own storage, even through a destination directory symlink', async () => {
  const root = storage();
  const outside = storage();
  let destination = resolve(root, 'dataset/backup.swcc-backup.zip');
  const app = openApplication(root, {}, undefined, undefined, { chooseDestination: async () => destination });
  apps.push(app);
  value(await app.operations.createYear(2024));
  expect(await app.operations.createFullBackup()).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  symlinkSync(resolve(root, 'dataset'), resolve(outside, 'shortcut'));
  destination = resolve(outside, 'shortcut/backup.swcc-backup.zip');
  expect(await app.operations.createFullBackup()).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  expect(value(await app.operations.getState()).years.map(year => year.year)).toEqual([2024]);
});

test('failed streamed writes and snapshot storage failures preserve the prior archive and backup metadata', async () => {
  const root = storage();
  const destination = resolve(storage(), 'SWCC-test.swcc-backup.zip');
  let failOutput = false;
  const app = openApplication(root, {}, undefined, undefined, {
    chooseDestination: async () => destination,
    openOutput: path => new Writable({
      write(chunk, _encoding, done) {
        appendFileSync(path, chunk, { mode: 0o600 });
        done(failOutput ? Object.assign(new Error('Device out of space'), { code: 'ENOSPC' }) : undefined);
      },
    }),
  });
  apps.push(app);
  const operations = app.operations;
  value(await operations.createYear(2024));
  value(await operations.createFullBackup());
  const archive = readFileSync(destination);
  const before = value(await operations.getState());
  value(await operations.createYear(2023));
  failOutput = true;
  expect(await operations.createFullBackup()).toMatchObject({
    ok: false, error: { code: 'STORAGE', message: expect.stringContaining('Full backup could not be completed') },
  });
  expect(readFileSync(destination)).toEqual(archive);
  expect(readdirSync(resolve(destination, '..'))).toEqual(['SWCC-test.swcc-backup.zip']);
  rmSync(resolve(root, 'runtime'), { recursive: true });
  writeFileSync(resolve(root, 'runtime'), 'Blocked staging location');
  expect(await operations.createFullBackup()).toMatchObject({ ok: false, error: { code: 'STORAGE' } });
  expect(readFileSync(destination)).toEqual(archive);
  expect(value(await operations.getState())).toMatchObject({
    lastBackupAt: before.lastBackupAt, lastBackupRevision: before.lastBackupRevision, dataRevision: before.dataRevision + 1,
  });
  expect(value(await operations.getBackupProgress()).phase).toBe('idle');
});

test('cancelling during streamed collection removes partial output and unlocks editing without advancing backup status', async () => {
  const root = storage();
  const destination = resolve(storage(), 'SWCC-test.swcc-backup.zip');
  let release!: () => void;
  let paused = true;
  const app = openApplication(root, {}, undefined, undefined, {
    chooseDestination: async () => destination,
    openOutput: path => new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, done) {
        appendFileSync(path, chunk, { mode: 0o600 });
        if (paused) { paused = false; release = done; }
        else done();
      },
    }),
  });
  apps.push(app);
  const operations = app.operations;
  const pkg = value(await operations.createYear(2024));
  const backingUp = operations.createFullBackup();
  await expect.poll(async () => value(await operations.getBackupProgress()).phase).toBe('archiving');
  const progress = value(await operations.getBackupProgress());
  expect(progress.bytesTotal).toBeGreaterThan(0);
  expect(progress.filesTotal).toBe(1);
  expect(existsSync(destination)).toBe(false);
  expect(await operations.deleteYear({ packageId: pkg.id, expectedRevision: pkg.contentRevision, confirmed: true }))
    .toMatchObject({ ok: false, error: { code: 'BUSY' } });
  value(await operations.cancelFullBackup());
  release?.();
  expect(value(await backingUp)).toEqual({ cancelled: true });
  expect(existsSync(destination)).toBe(false);
  expect(readdirSync(resolve(destination, '..'))).toEqual([]);
  expect(readdirSync(resolve(root, 'runtime'))).toEqual([]);
  expect(value(await operations.getState())).toMatchObject({ lastBackupAt: null, lastBackupRevision: null });
  expect(value(await operations.getBackupProgress()).phase).toBe('idle');
  value(await operations.createYear(2023));
});

test('cancelling while waiting for an admitted import does not discard the import or leave backup stuck busy', async () => {
  const root = storage();
  const destination = resolve(storage(), 'SWCC-test.swcc-backup.zip');
  const source = resolve(root, 'notes.txt');
  writeFileSync(source, 'Captured notes');
  let release!: (path: string) => void;
  const selected = new Promise<string>(resolveSelection => { release = resolveSelection; });
  const app = openApplication(root, {}, undefined, { chooseFile: () => selected }, {
    chooseDestination: async () => destination,
  });
  apps.push(app);
  const operations = app.operations;
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createActivity({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Consultation' }));
  const importing = operations.importEvidence({
    packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision,
  });
  let finished = false;
  const backingUp = operations.createFullBackup().then(result => { finished = true; return result; });
  try {
    await expect.poll(async () => value(await operations.getBackupProgress()).phase).toBe('waiting');
    value(await operations.cancelFullBackup());
    await expect.poll(() => finished, { timeout: 500 }).toBe(true);
    expect(value(await backingUp)).toEqual({ cancelled: true });
    expect(value(await operations.getBackupProgress()).phase).toBe('idle');
  } finally {
    release(source);
    await importing;
    await backingUp;
  }
  expect(value(await operations.getEvidence(pkg.id))).toMatchObject([{ ref: 'E1', integrity: 'readable' }]);
  expect(existsSync(destination)).toBe(false);
  expect(value(await operations.getState())).toMatchObject({ lastBackupAt: null, lastBackupRevision: null });
});

test('failed final publication never updates successful status and a later retry still works', async () => {
  const root = storage();
  const outside = storage();
  let destination = resolve(outside, 'good.swcc-backup.zip');
  const app = openApplication(root, {}, undefined, undefined, { chooseDestination: async () => destination });
  apps.push(app);
  const operations = app.operations;
  value(await operations.createYear(2024));
  value(await operations.createFullBackup());
  const before = value(await operations.getState());
  const original = readFileSync(destination);
  value(await operations.createYear(2023));
  destination = resolve(outside, 'blocked.swcc-backup.zip');
  mkdirSync(destination);
  expect(await operations.createFullBackup()).toMatchObject({ ok: false, error: { code: 'STORAGE' } });
  expect(value(await operations.getState())).toMatchObject({
    lastBackupAt: before.lastBackupAt, lastBackupRevision: before.lastBackupRevision,
  });
  expect(readFileSync(resolve(outside, 'good.swcc-backup.zip'))).toEqual(original);
  expect(readdirSync(outside).sort()).toEqual(['blocked.swcc-backup.zip', 'good.swcc-backup.zip']);
  destination = resolve(outside, 'retry.swcc-backup.zip');
  value(await operations.createFullBackup());
  const after = value(await operations.getState());
  expect(after.lastBackupRevision).toBe(after.dataRevision);
});

test('full backup preserves all years and WAL records in a portable ZIP with original evidence and inventory', async () => {
  const root = storage();
  const destination = resolve(storage(), 'SWCC-test.swcc-backup.zip');
  const source = resolve(root, 'notes.txt');
  writeFileSync(source, 'Captured notes');
  const clock = { now: () => new Date('2024-06-15T12:00:00.000Z'), today: () => '2024-06-15' };
  const app = openApplication(root, clock, {
    openExternal: async () => {}, readDocument: () => new Uint8Array(),
  }, { chooseFile: async () => source }, {
    chooseDestination: async () => destination,
  });

  apps.push(app);
  const operations = app.operations;
  value(await operations.acknowledgeStorage());
  let old = value(await operations.createYear(2023));
  old = value(await operations.createActivity({ packageId: old.id, expectedRevision: old.contentRevision, title: 'Earlier supplementary learning' }));
  const oldImported = value(await operations.importEvidence({
    packageId: old.id, activityId: old.activities[0].id, expectedRevision: old.contentRevision,
  }));
  if (oldImported.cancelled) throw new Error('Unexpected cancellation');
  old = oldImported.package;
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.saveDraft({
    packageId: pkg.id, expectedRevision: pkg.contentRevision,
    draft: { assessmentDate: pkg.assessmentDate, planDate: pkg.planDate, peerFeedback: '',
      strengths: 'Listening', learningNeeds: 'Supervision', annualStandards: ['code-of-ethics'] },
  }));
  pkg = value(await operations.createGoal({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Reflective supervision',
  }));
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Consultation', goalIds: [pkg.goals[0].id],
  }));
  const imported = value(await operations.importEvidence({
    packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision,
  }));
  if (imported.cancelled) throw new Error('Unexpected cancellation');
  pkg = imported.package;
  rmSync(source);
  value(await operations.recordReviewVisits({ packageId: pkg.id, pages: [2, 4, 48] }));
  value(await operations.saveReviewPosition({ packageId: pkg.id, page: 48, offset: 0.25, zoom: 125 }));
  value(await operations.launchReviewResources(pkg.id));
  pkg = value(await operations.completeStep({ packageId: pkg.id, step: 'assessment', expectedRevision: pkg.assessmentRevision }));
  pkg = value(await operations.recordDeclaration({
    packageId: pkg.id, date: '2024-06-10', expectedRevision: pkg.contentRevision, confirmIncomplete: true,
  }));
  const before = value(await operations.getState());
  expect(statSync(resolve(root, 'dataset/database.sqlite-wal')).size).toBeGreaterThan(0);
  const outcome = value(await operations.createFullBackup());
  expect(outcome).toMatchObject({ cancelled: false, fileName: 'SWCC-test.swcc-backup.zip', dataRevision: before.dataRevision });
  const zip = await contents(destination);
  const manifest = JSON.parse(zip.get('manifest.json')!.toString());
  expect(manifest).toMatchObject({
    kind: 'full-backup', archiveVersion: 1, schemaVersion: before.schemaVersion,
    appId: 'org.swcc.desktop', sourceSetId: 'swcc-supplied-2018-2026-v1',
    createdAt: '2024-06-15T12:00:00.000Z', dataRevision: before.dataRevision,
  });
  const evidenceFile = manifest.files.find((file: { path: string }) => file.path.startsWith('evidence/'));
  expect(manifest.files).toHaveLength(3);
  for (const file of manifest.files) {
    const bytes = zip.get(file.path)!;
    expect(file).toMatchObject({ byteCount: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  expect(evidenceFile).toMatchObject({
    byteCount: 14, sha256: '197b652d58e142c80a9409c06695cc6f3d6a8b798b35d3f9e94e8ccbd1cef4ea',
  });
  expect(zip.get(evidenceFile.path)?.toString()).toBe('Captured notes');
  expect([...zip.keys()].sort()).toEqual(['manifest.json', ...manifest.files.map((file: { path: string }) => file.path)].sort());
  const snapshotRoot = storage();
  mkdirSync(resolve(snapshotRoot, 'dataset'));
  writeFileSync(resolve(snapshotRoot, 'dataset/database.sqlite'), zip.get('database.sqlite')!);
  for (const file of manifest.files.filter((file: { path: string }) => file.path.startsWith('evidence/'))) {
    mkdirSync(resolve(snapshotRoot, 'dataset', file.path, '..'), { recursive: true });
    writeFileSync(resolve(snapshotRoot, 'dataset', file.path), zip.get(file.path)!);
  }
  const snapshot = openApplication(snapshotRoot, clock);
  apps.push(snapshot);
  expect(value(await snapshot.operations.getState()).years.map(year => year.year)).toEqual([2024, 2023]);
  expect(value(await snapshot.operations.openYear(old.id))).toEqual(old);
  expect(value(await snapshot.operations.openYear(pkg.id))).toEqual(pkg);
  expect(value(await snapshot.operations.getReview(pkg.id))).toEqual(value(await operations.getReview(pkg.id)));
  expect(value(await snapshot.operations.getEvidence(pkg.id))).toEqual([imported.attachment]);
  expect(value(await snapshot.operations.getEvidence(old.id))).toEqual([oldImported.attachment]);
  expect(value(await operations.getState())).toMatchObject({
    dataRevision: before.dataRevision, lastBackupAt: manifest.createdAt, lastBackupRevision: before.dataRevision,
  });
  expect(readFileSync(destination).subarray(0, 2).toString()).toBe('PK');
});
