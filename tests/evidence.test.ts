import { afterEach, expect, test } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { openApplication } from '../src/main/data/application.js';
import type { Result } from '../src/shared/application.js';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const roots: string[] = [];
const apps: ReturnType<typeof openApplication>[] = [];

afterEach(() => {
  apps.splice(0).forEach(app => app.close());
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
});

function storage() {
  const root = resolve('.work', `evidence-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

test('imported evidence survives source movement and is readable plan evidence', async () => {
  const root = storage();
  const source = resolve(root, 'support.txt');
  const originalBytes = 'Captured notes';
  writeFileSync(source, originalBytes);
  const opened: { path: string; bytes: string }[] = [];
  const app = openApplication(root, {
    now: () => new Date('2024-06-15T12:00:00.000Z'),
    today: () => '2024-06-15',
  }, undefined, {
    chooseFile: async () => source,
    openPath: async path => {
      opened.push({ path, bytes: readFileSync(path, 'utf8') });
      return '';
    },
  });
  apps.push(app);
  const operations = app.operations;
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createGoal({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Reflective supervision',
  }));
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Consultation',
    goalIds: [pkg.goals[0].id], status: 'Completed', completionDate: '2024-06-10',
    applicationToPractice: 'I changed my consultation approach.',
  }));
  const activityId = pkg.activities[0].id;
  const revisions = {
    content: pkg.contentRevision,
    assessment: pkg.assessmentRevision,
    plan: pkg.planRevision,
    data: value(await operations.getState()).dataRevision,
  };
  expect(value(await operations.getPlanReadiness(pkg.id)).missing).toContain(
    'A1 needs evidence notes, a valid link, or a readable evidence file.',
  );

  const imported = value(await operations.importEvidence({
    packageId: pkg.id, activityId, expectedRevision: pkg.contentRevision,
  }));
  expect(imported.cancelled).toBe(false);
  if (imported.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  expect(imported.attachment).toMatchObject({
    ref: 'E1',
    packageId: pkg.id,
    activityId,
    originalName: 'support.txt',
    type: 'txt',
    byteCount: 14,
    sha256: '197b652d58e142c80a9409c06695cc6f3d6a8b798b35d3f9e94e8ccbd1cef4ea',
    integrity: 'readable',
  });
  pkg = imported.package;
  expect(pkg).toMatchObject({
    contentRevision: revisions.content + 1,
    assessmentRevision: revisions.assessment,
    planRevision: revisions.plan + 1,
  });
  expect(value(await operations.getState()).dataRevision).toBe(revisions.data + 1);
  expect(value(await operations.getPlanReadiness(pkg.id))).toEqual({ ready: true, missing: [] });
  expect(value(await operations.getEvidence(pkg.id))).toEqual([imported.attachment]);

  const moved = resolve(root, 'moved-support.txt');
  renameSync(source, moved);
  const openedResult = await operations.openEvidence({
    packageId: pkg.id, activityId, evidenceId: imported.attachment.id,
  });
  expect(openedResult).toEqual({ ok: true, value: undefined });
  expect(opened.map(item => item.bytes)).toEqual([originalBytes]);
  expect(opened[0].path).not.toBe(moved);
  expect(opened[0].path).toContain('evidence');
});

test('imports permit exactly 50 MiB and reject larger, unsupported, and directory selections', async () => {
  const root = storage();
  const exact = resolve(root, 'exact.pdf');
  const larger = resolve(root, 'larger.pdf');
  const unsupported = resolve(root, 'script.exe');
  const directory = resolve(root, 'folder.txt');
  writeFileSync(exact, '');
  writeFileSync(larger, '');
  truncateSync(exact, 52_428_800);
  truncateSync(larger, 52_428_801);
  writeFileSync(unsupported, 'not evidence');
  mkdirSync(directory);
  let selected = exact;
  const app = openApplication(root, { today: () => '2024-06-15' }, undefined, {
    chooseFile: async () => selected,
  });
  apps.push(app);
  const operations = app.operations;
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Read an article',
  }));
  const activityId = pkg.activities[0].id;

  const exactImport = value(await operations.importEvidence({
    packageId: pkg.id, activityId, expectedRevision: pkg.contentRevision,
  }));
  expect(exactImport.cancelled).toBe(false);
  if (exactImport.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  expect(exactImport.attachment).toMatchObject({
    ref: 'E1', originalName: 'exact.pdf', byteCount: 52_428_800, integrity: 'readable',
  });
  pkg = exactImport.package;

  for (const [path, error] of [
    [larger, { code: 'FILE_TOO_LARGE', message: expect.stringContaining('50 MiB') }],
    [unsupported, { code: 'UNSUPPORTED_FILE', message: expect.stringContaining('not a supported evidence type') }],
    [directory, { code: 'UNREADABLE', message: expect.stringContaining('Choose a file, not a directory') }],
  ] as const) {
    selected = path;
    expect(await operations.importEvidence({
      packageId: pkg.id, activityId, expectedRevision: pkg.contentRevision,
    })).toMatchObject({ ok: false, error });
    expect(value(await operations.getEvidence(pkg.id)).map(entry => entry.ref)).toEqual(['E1']);
  }
});

test('cancelled, unreadable, and out-of-space imports create no evidence or partial output', async () => {
  const root = storage();
  const source = resolve(root, 'evidence.txt');
  writeFileSync(source, 'some real source bytes');
  let selected: string | null = null;
  let copyError: NodeJS.ErrnoException = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  const app = openApplication(root, { today: () => '2024-06-15' }, undefined, {
    chooseFile: async () => selected,
    copyToTemporary: async (_sourcePath, temporaryPath) => {
      writeFileSync(temporaryPath, 'partial output');
      throw copyError;
    },
  });
  apps.push(app);
  const operations = app.operations;
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Review notes',
  }));
  const activityId = pkg.activities[0].id;
  const revision = pkg.contentRevision;
  const dataRevision = value(await operations.getState()).dataRevision;

  expect(value(await operations.importEvidence({
    packageId: pkg.id, activityId, expectedRevision: revision,
  }))).toEqual({ cancelled: true });
  selected = resolve(root, 'no-longer-readable.txt');
  expect(await operations.importEvidence({
    packageId: pkg.id, activityId, expectedRevision: revision,
  })).toMatchObject({ ok: false, error: { code: 'UNREADABLE', message: expect.stringContaining('could not read the selected file') } });
  selected = source;
  copyError = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  expect(await operations.importEvidence({
    packageId: pkg.id, activityId, expectedRevision: revision,
  })).toMatchObject({ ok: false, error: { code: 'UNREADABLE', message: expect.stringContaining('could not read the selected file') } });
  copyError = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  expect(await operations.importEvidence({
    packageId: pkg.id, activityId, expectedRevision: revision,
  })).toMatchObject({ ok: false, error: { code: 'STORAGE', message: expect.stringContaining('out of space') } });
  expect(value(await operations.getEvidence(pkg.id))).toEqual([]);
  expect(value(await operations.getState()).dataRevision).toBe(dataRevision);
  expect(readdirSync(resolve(root, 'dataset/evidence/2024'))).toEqual([]);
});

test('a metadata commit failure removes the published copy and leaves E1 available', async () => {
  const root = storage();
  const source = resolve(root, 'metadata.txt');
  writeFileSync(source, 'transactional evidence');
  const app = openApplication(root, {}, undefined, { chooseFile: async () => source });
  apps.push(app);
  const operations = app.operations;
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Review a certificate',
  }));
  const activityId = pkg.activities[0].id;
  const revision = pkg.contentRevision;
  const fixture = new Database(resolve(root, 'dataset/database.sqlite'));
  fixture.exec(`CREATE TRIGGER reject_evidence_insert BEFORE INSERT ON evidence_attachments
    BEGIN SELECT RAISE(FAIL, 'metadata write failed'); END`);

  expect(await operations.importEvidence({ packageId: pkg.id, activityId, expectedRevision: revision }))
    .toMatchObject({ ok: false, error: { code: 'STORAGE', message: expect.stringContaining('metadata write failed') } });
  expect(value(await operations.getEvidence(pkg.id))).toEqual([]);
  expect(readdirSync(resolve(root, 'dataset/evidence/2024'))).toEqual([]);

  fixture.exec('DROP TRIGGER reject_evidence_insert');
  fixture.close();
  const imported = value(await operations.importEvidence({ packageId: pkg.id, activityId, expectedRevision: revision }));
  if (imported.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  expect(imported.attachment.ref).toBe('E1');
});

test('replacement cleanup failure preserves the committed E reference and retries durable old-byte cleanup on restart', async () => {
  const root = storage();
  const source = resolve(root, 'certificate.pdf');
  writeFileSync(source, '%PDF-1.4\nold certificate');
  const app = openApplication(root, {}, undefined, {
    chooseFile: async () => source,
    removeDeletionStage: () => { throw new Error('old evidence folder is locked'); },
  });
  apps.push(app);
  let pkg = value(await app.operations.createYear(2024));
  pkg = value(await app.operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Replace a certificate',
  }));
  const activityId = pkg.activities[0].id;
  const imported = value(await app.operations.importEvidence({
    packageId: pkg.id, activityId, expectedRevision: pkg.contentRevision,
  }));
  if (imported.cancelled) throw new Error('Unexpected cancellation.');
  const replacementBytes = '%PDF-1.4\nnew certificate';
  writeFileSync(source, replacementBytes);
  const result = await app.operations.replaceEvidence({
    packageId: pkg.id, activityId, evidenceId: imported.attachment.id,
    expectedRevision: imported.package.contentRevision,
  });
  expect(result).toMatchObject({
    ok: false, error: { code: 'STORAGE', committed: true, recoveryPath: expect.stringContaining('.deletion-') },
  });
  const committed = value(await app.operations.openYear(pkg.id));
  expect(committed.contentRevision).toBe(imported.package.contentRevision + 1);
  expect(value(await app.operations.getEvidence(pkg.id))).toMatchObject([
    { id: imported.attachment.id, ref: 'E1', integrity: 'readable', byteCount: replacementBytes.length },
  ]);
  expect(Buffer.from(value(await app.operations.previewEvidence({
    packageId: pkg.id, activityId, evidenceId: imported.attachment.id,
  })).data).toString()).toBe(replacementBytes);
  expect(readdirSync(resolve(root, 'dataset/evidence')).some(name => name.startsWith('.deletion-'))).toBe(true);
  apps.pop()!.close();
  const reopened = openApplication(root);
  apps.push(reopened);
  expect(value(await reopened.operations.openYear(pkg.id))).toEqual(committed);
  expect(value(await reopened.operations.getEvidence(pkg.id))).toMatchObject([{ integrity: 'readable' }]);
  expect(readdirSync(resolve(root, 'dataset/evidence')).filter(name => name.startsWith('.deletion-'))).toEqual([]);
  expect(readdirSync(resolve(root, 'dataset/evidence/2024'))).toHaveLength(1);
});

test('identically named files receive distinct E references and retain independent managed bytes', async () => {
  const root = storage();
  const firstSource = resolve(root, 'first', 'certificate.txt');
  const secondSource = resolve(root, 'second', 'certificate.txt');
  mkdirSync(resolve(root, 'first'));
  mkdirSync(resolve(root, 'second'));
  writeFileSync(firstSource, 'first certificate');
  writeFileSync(secondSource, 'second certificate');
  let selected = firstSource;
  const opened: string[] = [];
  const app = openApplication(root, {}, undefined, {
    chooseFile: async () => selected,
    openPath: async path => { opened.push(readFileSync(path, 'utf8')); return ''; },
  });
  apps.push(app);
  const operations = app.operations;
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Collect certificates',
  }));
  const activityId = pkg.activities[0].id;
  const first = value(await operations.importEvidence({
    packageId: pkg.id, activityId, expectedRevision: pkg.contentRevision,
  }));
  if (first.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  selected = secondSource;
  const second = value(await operations.importEvidence({
    packageId: pkg.id, activityId, expectedRevision: first.package.contentRevision,
  }));
  if (second.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');

  expect([first.attachment, second.attachment]).toMatchObject([
    { ref: 'E1', originalName: 'certificate.txt', byteCount: 17, integrity: 'readable' },
    { ref: 'E2', originalName: 'certificate.txt', byteCount: 18, integrity: 'readable' },
  ]);
  expect(second.attachment.id).not.toBe(first.attachment.id);
  for (const attachment of [first.attachment, second.attachment]) {
    expect(await operations.openEvidence({ packageId: pkg.id, activityId, evidenceId: attachment.id }))
      .toEqual({ ok: true, value: undefined });
  }
  expect(opened).toEqual(['first certificate', 'second certificate']);
});

test('missing and corrupt evidence can be repaired and removed without recycling its E reference', async () => {
  const root = storage();
  const firstSource = resolve(root, 'first.txt');
  const replacementSource = resolve(root, 'replacement.csv');
  const nextSource = resolve(root, 'next.txt');
  writeFileSync(firstSource, 'first managed bytes');
  writeFileSync(replacementSource, 'replacement,managed,bytes');
  writeFileSync(nextSource, 'next evidence');
  let selected = firstSource;
  const managedPaths: string[] = [];
  let currentTime = '2024-06-15T12:00:00.000Z';
  const app = openApplication(root, {
    now: () => new Date(currentTime),
    today: () => '2024-06-15',
  }, undefined, {
    chooseFile: async () => selected,
    openPath: async path => { managedPaths.push(path); return ''; },
  });
  apps.push(app);
  const operations = app.operations;
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createGoal({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Keep my learning evidence',
  }));
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Complete consultation',
    goalIds: [pkg.goals[0].id], status: 'Completed', completionDate: '2024-06-10',
    applicationToPractice: 'I changed my consultation practice.',
  }));
  const activityId = pkg.activities[0].id;
  const initialRevisions = { assessment: pkg.assessmentRevision, plan: pkg.planRevision };
  const imported = value(await operations.importEvidence({
    packageId: pkg.id, activityId, expectedRevision: pkg.contentRevision,
  }));
  if (imported.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  const original = imported.attachment;
  pkg = imported.package;
  expect(value(await operations.getPlanReadiness(pkg.id))).toEqual({ ready: true, missing: [] });
  await operations.openEvidence({ packageId: pkg.id, activityId, evidenceId: original.id });
  const originalPath = managedPaths.at(-1)!;
  const dataRevision = value(await operations.getState()).dataRevision;
  rmSync(originalPath);
  expect(value(await operations.getEvidence(pkg.id))).toMatchObject([{ id: original.id, ref: 'E1', integrity: 'missing' }]);
  expect(value(await operations.getPlanReadiness(pkg.id))).toMatchObject({
    ready: false, missing: expect.arrayContaining(['A1 needs evidence notes, a valid link, or a readable evidence file.']),
  });

  selected = replacementSource;
  currentTime = '2024-06-16T12:00:00.000Z';
  const repaired = value(await operations.replaceEvidence({
    packageId: pkg.id, activityId, evidenceId: original.id, expectedRevision: pkg.contentRevision,
  }));
  if (repaired.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  expect(repaired.attachment).toMatchObject({
    id: original.id, ref: 'E1', packageId: pkg.id, activityId, originalName: 'replacement.csv',
    type: 'csv', byteCount: 25, integrity: 'readable', importedAt: currentTime,
  });
  expect(repaired.package).toMatchObject({
    contentRevision: pkg.contentRevision + 1,
    assessmentRevision: initialRevisions.assessment,
    planRevision: initialRevisions.plan + 2,
  });
  expect(value(await operations.getState()).dataRevision).toBe(dataRevision + 1);
  expect(value(await operations.getPlanReadiness(pkg.id))).toEqual({ ready: true, missing: [] });

  await operations.openEvidence({ packageId: pkg.id, activityId, evidenceId: original.id });
  const repairedPath = managedPaths.at(-1)!;
  writeFileSync(repairedPath, 'tampered bytes');
  expect(value(await operations.getEvidence(pkg.id))).toMatchObject([{ id: original.id, ref: 'E1', integrity: 'corrupt' }]);
  expect(await operations.previewEvidence({ packageId: pkg.id, activityId, evidenceId: original.id }))
    .toMatchObject({ ok: false, error: { code: 'EVIDENCE', message: expect.stringContaining('SHA-256 integrity check') } });
  expect(value(await operations.getPlanReadiness(pkg.id)).ready).toBe(false);

  pkg = value(await operations.removeEvidence({
    packageId: pkg.id, activityId, evidenceId: original.id, expectedRevision: repaired.package.contentRevision,
  }));
  expect(value(await operations.getEvidence(pkg.id))).toEqual([]);
  expect(pkg).toMatchObject({
    contentRevision: repaired.package.contentRevision + 1,
    assessmentRevision: initialRevisions.assessment,
    planRevision: initialRevisions.plan + 3,
  });
  expect(value(await operations.getState()).dataRevision).toBe(dataRevision + 2);

  selected = nextSource;
  const next = value(await operations.importEvidence({
    packageId: pkg.id, activityId, expectedRevision: pkg.contentRevision,
  }));
  if (next.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  expect(next.attachment.ref).toBe('E2');
});

test('PDF and image previews return safe bytes; desktop open errors are propagated for other documents', async () => {
  const root = storage();
  const pdfPath = resolve(root, 'notes.pdf');
  const imagePath = resolve(root, 'image.png');
  const documentPath = resolve(root, 'report.docx');
  const pdfBytes = Buffer.from('%PDF-1.4\nlocal fixture');
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/YQAAAABJRU5ErkJggg==', 'base64');
  writeFileSync(pdfPath, pdfBytes);
  writeFileSync(imagePath, imageBytes);
  writeFileSync(documentPath, 'document bytes');
  let selected = pdfPath;
  const app = openApplication(root, {}, undefined, {
    chooseFile: async () => selected,
    openPath: async () => 'No application is associated with this file type.',
  });
  apps.push(app);
  const operations = app.operations;
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Inspect documents',
  }));
  const activityId = pkg.activities[0].id;
  const revisions = { content: pkg.contentRevision, plan: pkg.planRevision, data: value(await operations.getState()).dataRevision };

  const pdf = value(await operations.importEvidence({ packageId: pkg.id, activityId, expectedRevision: pkg.contentRevision }));
  if (pdf.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  const pdfPreview = value(await operations.previewEvidence({ packageId: pkg.id, activityId, evidenceId: pdf.attachment.id }));
  expect(pdfPreview).toMatchObject({ ref: 'E1', originalName: 'notes.pdf', type: 'application/pdf' });
  expect(Buffer.from(pdfPreview.data)).toEqual(pdfBytes);
  pkg = pdf.package;

  selected = imagePath;
  const image = value(await operations.importEvidence({ packageId: pkg.id, activityId, expectedRevision: pkg.contentRevision }));
  if (image.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  const imagePreview = value(await operations.previewEvidence({ packageId: pkg.id, activityId, evidenceId: image.attachment.id }));
  expect(imagePreview).toMatchObject({ ref: 'E2', originalName: 'image.png', type: 'image/png' });
  expect(Buffer.from(imagePreview.data)).toEqual(imageBytes);
  pkg = image.package;

  selected = documentPath;
  const document = value(await operations.importEvidence({ packageId: pkg.id, activityId, expectedRevision: pkg.contentRevision }));
  if (document.cancelled) throw new Error('The evidence chooser unexpectedly cancelled.');
  expect(await operations.previewEvidence({ packageId: pkg.id, activityId, evidenceId: document.attachment.id }))
    .toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  expect(await operations.openEvidence({ packageId: pkg.id, activityId, evidenceId: document.attachment.id }))
    .toMatchObject({ ok: false, error: { code: 'OPEN', message: expect.stringContaining('No application is associated') } });
  expect(value(await operations.getState()).dataRevision).toBe(revisions.data + 3);
  expect(document.package.planRevision).toBe(revisions.plan + 3);
});
