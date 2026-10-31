import { afterEach, expect, test } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import yauzl from 'yauzl';
import yazl from 'yazl';
import Database from 'better-sqlite3';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { FullBackupManifest } from '../src/shared/backup.js';
import { openApplication } from '../src/main/data/application.js';
import type { Result } from '../src/shared/application.js';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
const roots: string[] = [];
const apps: ReturnType<typeof openApplication>[] = [];
function storage() {
  const root = resolve('.work', `restore-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}
afterEach(() => {
  apps.splice(0).forEach(app => app.close());
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
});
async function contents(path: string): Promise<Map<string, Buffer>> {
  return new Promise((resolveZip, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) { reject(error); return; }
      const files = new Map<string, Buffer>();
      zip.on('error', reject);
      zip.on('entry', entry => {
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) { reject(error); return; }
          const chunks: Buffer[] = [];
          stream.on('error', reject);
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => { files.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
        });
      });
      zip.on('end', () => resolveZip(files));
      zip.readEntry();
    });
  });
}
async function writeZip(path: string, files: Map<string, Buffer>, extra?: { path: string; bytes: Buffer; mode?: number }) {
  const zip = new yazl.ZipFile();
  for (const [name, bytes] of files) zip.addBuffer(bytes, name);
  if (extra) zip.addBuffer(extra.bytes, extra.path, { mode: extra.mode });
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(path));
}
async function fixture() {
  const root = storage();
  const output = storage();
  const archive = resolve(output, 'genuine.zip');
  let selected = archive;
  const source = resolve(output, 'notes.txt');
  writeFileSync(source, 'Verifiable original evidence');
  const app = openApplication(root, {}, undefined, { chooseFile: async () => source }, undefined,
    { chooseDestination: async () => archive }, { chooseArchive: async () => selected });
  apps.push(app);
  let pkg = value(await app.operations.createYear(2024));
  pkg = value(await app.operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Goal' }));
  pkg = value(await app.operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Activity', goalIds: [pkg.goals[0].id],
  }));
  const imported = value(await app.operations.importEvidence({ packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision }));
  if (imported.cancelled) throw new Error('Unexpected cancellation');
  pkg = imported.package;
  value(await app.operations.recordDeclaration({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, date: '2024-12-31', confirmIncomplete: true,
  }));
  value(await app.operations.createYear(2025));
  value(await app.operations.createFullBackup());
  const files = await contents(archive);
  const manifest = JSON.parse(files.get('manifest.json')!.toString()) as FullBackupManifest;
  const before = value(await app.operations.getState());
  const review = value(await app.operations.getReview(pkg.id));
  const evidence = value(await app.operations.getEvidence(pkg.id));
  const databaseBytes = readFileSync(resolve(root, 'dataset/database.sqlite'));
  const evidencePath = resolve(root, 'dataset', manifest.files.find(file => file.path.startsWith('evidence/'))!.path);
  const evidenceBytes = readFileSync(evidencePath);
  const unrelated = resolve(root, 'restore-staging/unrelated');
  mkdirSync(unrelated, { recursive: true });
  writeFileSync(resolve(unrelated, 'keep.txt'), 'Not owned by this operation');
  const hostile = resolve(output, 'hostile.swcc-backup.zip');
  return {
    root, output, files, manifest, pkg, operations: app.operations,
    select: () => { selected = hostile; }, hostile,
    save: async () => { files.set('manifest.json', Buffer.from(JSON.stringify(manifest))); await writeZip(hostile, files); selected = hostile; },
    tamperDatabase: (sql: string) => {
      const path = resolve(output, 'tampered.sqlite');
      writeFileSync(path, files.get('database.sqlite')!);
      const db = new Database(path);
      try { db.pragma('foreign_keys = OFF'); db.pragma('ignore_check_constraints = ON'); db.exec(sql); }
      finally { db.close(); }
      const bytes = readFileSync(path);
      files.set('database.sqlite', bytes);
      const entry = manifest.files.find(file => file.path === 'database.sqlite')!;
      entry.byteCount = bytes.length;
      entry.sha256 = createHash('sha256').update(bytes).digest('hex');
    },
    unchanged: async () => {
      expect(value(await app.operations.getState())).toEqual(before);
      expect(value(await app.operations.getReview(pkg.id))).toEqual(review);
      expect(value(await app.operations.getEvidence(pkg.id))).toEqual(evidence);
      expect(readFileSync(resolve(root, 'dataset/database.sqlite'))).toEqual(databaseBytes);
      expect(readFileSync(evidencePath)).toEqual(evidenceBytes);
      expect(readFileSync(resolve(unrelated, 'keep.txt')).toString()).toBe('Not owned by this operation');
      expect(readdirSync(resolve(root, 'restore-staging'))).toEqual(['unrelated']);
      value(await app.operations.openYear(pkg.id));
      expect(value(await app.operations.getState()).selectedPackage?.activities[0].title).toBe('Activity');
    },
  };
}

test('a genuine all-year backup previews its records against the current dataset and cancels without changing either', async () => {
  const root = storage();
  const archive = resolve(storage(), 'renamed.data');
  const notes = resolve(root, 'notes.txt');
  writeFileSync(notes, 'Original evidence');
  const app = openApplication(root, { now: () => new Date('2026-10-31T12:00:00.000Z') },
    undefined, { chooseFile: async () => notes }, undefined,
    { chooseDestination: async () => archive }, { chooseArchive: async () => archive });
  apps.push(app);
  const operations = app.operations;
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Learn' }));
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Consultation', goalIds: [pkg.goals[0].id],
  }));
  value(await operations.importEvidence({ packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision }));
  value(await operations.createYear(2025));
  value(await operations.createFullBackup());
  value(await operations.createYear(2026));
  const before = value(await operations.getState());
  const database = readFileSync(resolve(root, 'dataset/database.sqlite'));
  const outcome = value(await operations.inspectFullBackup());
  expect(outcome).toMatchObject({ cancelled: false, preview: {
    createdAt: '2026-10-31T12:00:00.000Z',
    backup: { years: [2025, 2024], goals: 1, activities: 1, evidenceFiles: 1 },
    current: { years: [2026, 2025, 2024], goals: 1, activities: 1, evidenceFiles: 1 },
  } });
  expect(value(await operations.getState())).toEqual(before);
  expect(readFileSync(resolve(root, 'dataset/database.sqlite'))).toEqual(database);
  value(await operations.cancelRestorePreview());
  expect(readdirSync(resolve(root, 'restore-staging'))).toEqual([]);
  expect(value(await operations.getState())).toEqual(before);
  value(await operations.openYear(pkg.id));
  expect(value(await operations.getEvidence(pkg.id))[0].integrity).toBe('readable');
});

test('an archive with exhausted stable reference counters is rejected rather than repairing or replacing records', async () => {
  const f = await fixture();
  f.tamperDatabase("UPDATE reference_counters SET next_number = 1 WHERE kind = 'G'");
  await f.save();
  const result = await f.operations.inspectFullBackup();
  if (result.ok) await f.operations.cancelRestorePreview();
  expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION', message: expect.stringMatching(/reference counter/i) } });
  await f.unchanged();
});

test('completed activity dates are validated as real date-only values even when archive hashes are correct', async () => {
  const f = await fixture();
  f.tamperDatabase("UPDATE learning_activities SET status = 'Completed', completion_date = '2024-02-30'");
  await f.save();
  const result = await f.operations.inspectFullBackup();
  if (result.ok) await f.operations.cancelRestorePreview();
  expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(/date/i) } });
  await f.unchanged();
});

test('undeclared database evidence ownership cannot be hidden behind a valid ZIP inventory', async () => {
  const f = await fixture();
  f.tamperDatabase('DELETE FROM evidence_attachments');
  await f.save();
  const result = await f.operations.inspectFullBackup();
  if (result.ok) await f.operations.cancelRestorePreview();
  expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(/evidence.*inventory|inventory.*evidence/i) } });
  await f.unchanged();
});

test('an otherwise intact backup with an unrecognized executable schema is rejected', async () => {
  const f = await fixture();
  f.tamperDatabase("CREATE TRIGGER replace_titles AFTER INSERT ON learning_goals BEGIN UPDATE learning_goals SET title = 'Changed'; END");
  await f.save();
  const result = await f.operations.inspectFullBackup();
  if (result.ok) await f.operations.cancelRestorePreview();
  expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(/schema/i) } });
  await f.unchanged();
});

test('manual completion cannot claim a revision newer than its owning annual step', async () => {
  const f = await fixture();
  f.tamperDatabase(`INSERT INTO step_completions VALUES('${f.pkg.id}', 'plan', 999, '2024-12-31T12:00:00.000Z')`);
  await f.save();
  const result = await f.operations.inspectFullBackup();
  if (result.ok) await f.operations.cancelRestorePreview();
  expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(/revision/i) } });
  await f.unchanged();
});

test('SQLite affinity cannot disguise a malformed stored revision as valid user data', async () => {
  const f = await fixture();
  f.tamperDatabase("UPDATE year_packages SET content_revision = 'not-a-number'");
  await f.save();
  const result = await f.operations.inspectFullBackup();
  if (result.ok) await f.operations.cancelRestorePreview();
  expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(/revision/i) } });
  await f.unchanged();
});

test.each([
  ["UPDATE app_metadata SET last_backup_revision = 999, last_backup_at = '2026-10-31T12:00:00.000Z'", /backup.*revision/i],
  ["UPDATE year_packages SET declaration_recorded_at = NULL WHERE declaration_date IS NOT NULL", /declaration/i],
  ["UPDATE learning_goals SET updated_at = 'not-an-instant'", /timestamp/i],
  ["UPDATE learning_activities SET evidence_links = '[\"file:///records\"]'", /evidence link/i],
])('malformed persisted metadata and relationships are rejected: %s', async (sql, cause) => {
  const f = await fixture();
  f.tamperDatabase(sql);
  await f.save();
  const result = await f.operations.inspectFullBackup();
  if (result.ok) await f.operations.cancelRestorePreview();
  expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(cause) } });
  await f.unchanged();
});

test.each([
  ['portfolio', (m: FullBackupManifest) => { Object.assign(m, { kind: 'portfolio' }); }],
  ['future archive', (m: FullBackupManifest) => { Object.assign(m, { archiveVersion: 2 }); }],
  ['future schema', (m: FullBackupManifest) => { m.schemaVersion = 999; }],
  ['unsupported old schema', (m: FullBackupManifest) => { m.schemaVersion = 1; }],
  ['wrong application', (m: FullBackupManifest) => { Object.assign(m, { appId: 'elsewhere' }); }],
  ['wrong source', (m: FullBackupManifest) => { m.sourceSetId = 'elsewhere'; }],
  ['invalid creation date', (m: FullBackupManifest) => { m.createdAt = '2026-02-30T00:00:00.000Z'; }],
  ['invalid revision type', (m: FullBackupManifest) => { Object.assign(m, { dataRevision: '1' }); }],
  ['extra field', (m: FullBackupManifest) => { Object.assign(m, { invented: true }); }],
  ['duplicate inventory', (m: FullBackupManifest) => { m.files.push(m.files[0]); }],
  ['wrong SHA-256', (m: FullBackupManifest) => { m.files[0].sha256 = '0'.repeat(64); }],
  ['wrong size', (m: FullBackupManifest) => { m.files[0].byteCount++; }],
  ['declared oversize evidence', (m: FullBackupManifest) => { m.files[1].byteCount = 52_428_801; }],
] as const)('hostile %s manifest cannot change live records or backup status', async (_name, modify) => {
  const f = await fixture();
  modify(f.manifest);
  await f.save();
  const result = await f.operations.inspectFullBackup();
  if (result.ok) await f.operations.cancelRestorePreview();
  expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  await f.unchanged();
});

test.each([
  'malformed manifest', 'no manifest', 'missing evidence', 'undeclared file', 'duplicate entry', 'symlink',
  'parent traversal', 'absolute path', 'Windows absolute path', 'backslash path',
] as const)('hostile ZIP %s is rejected without changing the live dataset', async kind => {
  const f = await fixture();
  let extra: { path: string; bytes: Buffer; mode?: number } | undefined;
  if (kind === 'malformed manifest') f.files.set('manifest.json', Buffer.from('{broken'));
  if (kind === 'no manifest') f.files.delete('manifest.json');
  if (kind === 'missing evidence') f.files.delete(f.manifest.files[1].path);
  if (kind === 'undeclared file') extra = { path: 'unexpected.txt', bytes: Buffer.from('No') };
  if (kind === 'duplicate entry') extra = { path: 'database.sqlite', bytes: f.files.get('database.sqlite')! };
  if (kind === 'symlink') extra = { path: 'link.txt', bytes: Buffer.from('../dataset/database.sqlite'), mode: 0o120777 };
  const dangerousPaths: Record<string, string> = {
    'parent traversal': '../escaped.txt',
    'absolute path': '/absolute/file',
    'Windows absolute path': 'C:/secret/file',
    'backslash path': '..\\escaped.txt',
  };
  const dangerous = dangerousPaths[kind];
  if (dangerous) extra = { path: 'x'.repeat(dangerous.length), bytes: Buffer.from('Never extract') };
  await writeZip(f.hostile, f.files, extra);
  if (dangerous) {
    const bytes = readFileSync(f.hostile);
    const marker = Buffer.from('x'.repeat(dangerous.length));
    let offset = bytes.indexOf(marker);
    while (offset !== -1) { bytes.write(dangerous, offset); offset = bytes.indexOf(marker, offset + marker.length); }
    writeFileSync(f.hostile, bytes);
  }
  f.select();
  const result = await f.operations.inspectFullBackup();
  if (result.ok) await f.operations.cancelRestorePreview();
  expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  await f.unchanged();
});

test.each([
  ['foreign ownership', "UPDATE activity_goal_links SET package_id = (SELECT id FROM year_packages WHERE year = 2025)"],
  ['missing owner', "UPDATE evidence_attachments SET activity_id = '00000000-0000-0000-0000-000000000000'"],
  ['invalid status', "UPDATE learning_activities SET status = 'Finished'"],
  ['source mismatch', "UPDATE year_packages SET source_set_id = 'elsewhere'"],
  ['schema mismatch', 'PRAGMA user_version = 999'],
  ['missing metadata', 'DELETE FROM app_metadata'],
  ['unsafe evidence path', "UPDATE evidence_attachments SET managed_path = '../outside.txt'"],
  ['future completion', "UPDATE learning_activities SET status = 'Completed', completion_date = '9999-12-31'"],
] as const)('hash-correct database with %s is rejected', async (_kind, sql) => {
  const f = await fixture();
  f.tamperDatabase(sql);
  await f.save();
  const result = await f.operations.inspectFullBackup();
  if (result.ok) await f.operations.cancelRestorePreview();
  expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  await f.unchanged();
});

test('corrupt SQLite bytes are not repaired or replaced with an empty substitute', async () => {
  const f = await fixture();
  const corrupt = Buffer.from('Not a database');
  f.files.set('database.sqlite', corrupt);
  f.manifest.files[0].byteCount = corrupt.length;
  f.manifest.files[0].sha256 = createHash('sha256').update(corrupt).digest('hex');
  await f.save();
  expect(await f.operations.inspectFullBackup()).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  await f.unchanged();
});

test('the actual inflated evidence stream is bounded at 50 MiB even when ZIP and manifest sizes lie', async () => {
  const f = await fixture();
  const path = f.manifest.files[1].path;
  f.files.set(path, Buffer.alloc(52_428_801));
  await f.save();
  const bytes = readFileSync(f.hostile);
  for (let offset = 0; offset < bytes.length - 46; offset++) {
    if (bytes.readUInt32LE(offset) === 0x02014b50
      && bytes.subarray(offset + 46, offset + 46 + bytes.readUInt16LE(offset + 28)).toString() === path)
      bytes.writeUInt32LE(f.manifest.files[1].byteCount, offset + 24);
  }
  writeFileSync(f.hostile, bytes);
  const result = await f.operations.inspectFullBackup();
  expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(/actual extraction limit.*50 MiB/i) } });
  await f.unchanged();
});

test('ambiguous duplicate manifest properties are rejected instead of accepting whichever value is last', async () => {
  const f = await fixture();
  f.files.set('manifest.json', Buffer.from(JSON.stringify(f.manifest).replace('"kind":', '"kind":"portfolio","kind":')));
  await writeZip(f.hostile, f.files);
  f.select();
  const result = await f.operations.inspectFullBackup();
  if (result.ok) await f.operations.cancelRestorePreview();
  expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(/duplicate.*manifest/i) } });
  await f.unchanged();
});

test('cancellation during actual extraction removes only operation staging and keeps live evidence usable', async () => {
  const f = await fixture();
  const path = f.manifest.files[1].path;
  const large = Buffer.alloc(16 * 1024 * 1024, 65);
  f.files.set(path, large);
  f.manifest.files[1].byteCount = large.length;
  f.manifest.files[1].sha256 = createHash('sha256').update(large).digest('hex');
  await f.save();
  const inspecting = f.operations.inspectFullBackup();
  await expect.poll(async () => value(await f.operations.getRestoreProgress()).bytesCompleted, { interval: 1 }).toBeGreaterThan(100_000);
  expect(await f.operations.createYear(2026)).toMatchObject({ ok: false, error: { code: 'BUSY' } });
  value(await f.operations.cancelRestorePreview());
  expect(value(await inspecting)).toEqual({ cancelled: true });
  expect(value(await f.operations.getRestoreProgress()).phase).toBe('idle');
  await f.unchanged();
});

test('staging cannot be redirected into the live dataset through a symbolic link', async () => {
  const f = await fixture();
  rmSync(resolve(f.root, 'restore-staging'), { recursive: true });
  symlinkSync(resolve(f.root, 'dataset'), resolve(f.root, 'restore-staging'));
  await f.save();
  expect(await f.operations.inspectFullBackup()).toMatchObject({ ok: false, error: { message: expect.stringMatching(/staging.*symbolic link/i) } });
  expect(readdirSync(resolve(f.root, 'dataset')).filter(name => name.startsWith('inspection-'))).toEqual([]);
  rmSync(resolve(f.root, 'restore-staging'));
  mkdirSync(resolve(f.root, 'restore-staging/unrelated'), { recursive: true });
  writeFileSync(resolve(f.root, 'restore-staging/unrelated/keep.txt'), 'Not owned by this operation');
  await f.unchanged();
});

test('an evidence extraction never writes beyond 50 MiB before reporting a lying oversized stream', async () => {
  const f = await fixture();
  const path = f.manifest.files[1].path;
  f.files.set(path, Buffer.alloc(52_428_801, 65));
  await f.save();
  const bytes = readFileSync(f.hostile);
  for (let offset = 0; offset < bytes.length - 46; offset++) {
    if (bytes.readUInt32LE(offset) === 0x02014b50
      && bytes.subarray(offset + 46, offset + 46 + bytes.readUInt16LE(offset + 28)).toString() === path)
      bytes.writeUInt32LE(f.manifest.files[1].byteCount, offset + 24);
  }
  writeFileSync(f.hostile, bytes);
  let maximumWritten = 0;
  const timer = setInterval(() => {
    for (const name of readdirSync(resolve(f.root, 'restore-staging')).filter(name => name.startsWith('inspection-'))) {
      const extracted = resolve(f.root, 'restore-staging', name, path);
      if (existsSync(extracted)) maximumWritten = Math.max(maximumWritten, statSync(extracted).size);
    }
  }, 1);
  let result;
  try { result = await f.operations.inspectFullBackup(); }
  finally { clearInterval(timer); }
  expect(maximumWritten).toBeGreaterThan(0);
  expect(maximumWritten).toBeLessThanOrEqual(52_428_800);
  expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(/50 MiB/i) } });
  await f.unchanged();
});

test('failed staging cleanup remains an actionable failure and can be retried without touching live records', async () => {
  const f = await fixture();
  const outcome = value(await f.operations.inspectFullBackup());
  expect(outcome.cancelled).toBe(false);
  const name = readdirSync(resolve(f.root, 'restore-staging')).find(name => name.startsWith('inspection-'))!;
  const stagedYear = dirname(resolve(f.root, 'restore-staging', name, f.manifest.files[1].path));
  chmodSync(stagedYear, 0o555);
  let cancelled;
  try { cancelled = await f.operations.cancelRestorePreview(); }
  finally { chmodSync(stagedYear, 0o700); }
  expect(cancelled).toMatchObject({ ok: false, error: { code: 'STORAGE', message: expect.stringMatching(/retry staging cleanup/i) } });
  expect(value(await f.operations.getRestoreProgress()).phase).toBe('cleanup');
  value(await f.operations.cancelRestorePreview());
  await f.unchanged();
});

test('current manual completion cannot claim a step whose saved records never satisfy readiness', async () => {
  const f = await fixture();
  f.tamperDatabase(`INSERT INTO step_completions SELECT id, 'plan', plan_revision, '2026-10-31T12:00:00.000Z'
    FROM year_packages WHERE year = 2025`);
  await f.save();
  const result = await f.operations.inspectFullBackup();
  if (result.ok) await f.operations.cancelRestorePreview();
  expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(/completion.*readiness/i) } });
  await f.unchanged();
});

test('a genuine completed annual package and declaration remain valid in the preview without modifying live completion', async () => {
  const root = storage();
  const archive = resolve(storage(), 'complete.zip');
  const app = openApplication(root, {}, {
    openExternal: async () => {},
    readDocument: () => readFileSync('Code-of-Ethics-and-Standards-of-Practice-September-7-2018 (1).pdf'),
  }, undefined, undefined, { chooseDestination: async () => archive }, { chooseArchive: async () => archive });
  apps.push(app);
  const operations = app.operations;
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.saveDraft({
    packageId: pkg.id, expectedRevision: pkg.contentRevision,
    draft: { assessmentDate: '2024-01-01', planDate: '2024-01-02', strengths: 'Strengths', peerFeedback: '',
      learningNeeds: 'Learning needs', annualStandards: ['code-of-ethics'] },
  }));
  pkg = value(await operations.createGoal({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Goal' }));
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Completed consultation',
    goalIds: [pkg.goals[0].id], status: 'Completed', completionDate: '2024-12-01',
    evidenceDescription: 'Consultation notes', applicationToPractice: 'Applied the learning',
  }));
  value(await operations.recordReviewVisits({ packageId: pkg.id, pages: Array.from({ length: 48 }, (_, i) => i + 1) }));
  value(await operations.launchReviewResources(pkg.id));
  for (const step of ['review', 'assessment', 'plan'] as const) {
    const workflow = value(await operations.getWorkflow(pkg.id));
    pkg = value(await operations.completeStep({ packageId: pkg.id, step, expectedRevision: workflow.steps[step].relevantRevision }));
  }
  value(await operations.recordDeclaration({ packageId: pkg.id, expectedRevision: pkg.contentRevision, date: '2024-12-31' }));
  value(await operations.createFullBackup());
  const before = value(await operations.getState());
  expect(before.years[0].status).toBe('Complete');
  expect(value(await operations.inspectFullBackup())).toMatchObject({
    cancelled: false, preview: { backup: { years: [2024], goals: 1, activities: 1, evidenceFiles: 0 } },
  });
  value(await operations.cancelRestorePreview());
  expect(value(await operations.getState())).toEqual(before);
});
