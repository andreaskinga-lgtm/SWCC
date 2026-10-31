import { afterEach, expect, test } from 'vitest';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import yauzl from 'yauzl';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
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
  const root = resolve('.work', `portfolio-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}
const templates = {
  chooseDestination: async () => null,
  readChecklist: () => readFileSync('Step One SWCC.pdf'),
  readAssessment: () => readFileSync('OCSWSSW-CCP-Assess-Tool-2026-English.pdf'),
  readFont: () => readFileSync('resources/fonts/NotoSans-Regular.ttf'),
};
afterEach(() => {
  apps.splice(0).forEach(app => app.close());
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
});
async function contents(path: string): Promise<Map<string, Buffer>> {
  return new Promise((resolveZip, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) { reject(error); return; }
      const entries = new Map<string, Buffer>();
      zip.on('error', reject);
      zip.on('entry', entry => {
        if (entries.has(entry.fileName)) { zip.close(); reject(new Error('Duplicate archive entry')); return; }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) { zip.close(); reject(error); return; }
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

test('annual portfolio warns for drafts and archives complete forms and original shared and supplementary evidence once', async () => {
  const root = storage();
  const destination = resolve(storage(), 'CCP-2024-portfolio.zip');
  const source = resolve(root, 'café.txt');
  const original = Buffer.from('Original evidence — café.\n');
  writeFileSync(source, original);
  let suggested = '';
  const app = openApplication(root, { now: () => new Date('2026-10-31T12:00:00Z') }, undefined,
    { chooseFile: async () => source }, templates, undefined, {
      chooseDestination: async name => { suggested = name; return destination; },
    });

  apps.push(app);
  const operations = app.operations;
  let pkg = value(await operations.createYear(2024));
  for (const title of ['First goal', 'Second goal']) pkg = value(await operations.createGoal({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title,
  }));
  const strengths = `${'Écoute attentive. '.repeat(170)}STRENGTHS-END`;
  const reflection = `${'Apply the shared learning. '.repeat(120)}REFLECTION-END`;
  pkg = value(await operations.saveDraft({
    packageId: pkg.id, expectedRevision: pkg.contentRevision,
    draft: { assessmentDate: pkg.assessmentDate, planDate: pkg.planDate, strengths,
      peerFeedback: '', learningNeeds: '', annualStandards: [] },
  }));
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Shared workshop',
    goalIds: pkg.goals.map(goal => goal.id), applicationToPractice: reflection,
  }));
  const shared = pkg.activities[0];
  const imported = value(await operations.importEvidence({
    packageId: pkg.id, activityId: shared.id, expectedRevision: pkg.contentRevision,
  }));
  if (imported.cancelled) throw new Error('Unexpected cancellation');
  pkg = imported.package;
  pkg = value(await operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Supplementary reading',
  }));
  const supplementary = value(await operations.importEvidence({
    packageId: pkg.id, activityId: pkg.activities[1].id, expectedRevision: pkg.contentRevision,
  }));
  if (supplementary.cancelled) throw new Error('Unexpected cancellation');
  pkg = supplementary.package;
  expect(await operations.exportPortfolio({ packageId: pkg.id }))
    .toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED', missing: expect.arrayContaining(['Step 1 is not manually completed.']) } });
  const before = value(await operations.getState());
  const result = value(await operations.exportPortfolio({ packageId: pkg.id, confirmDraft: true }));
  expect(result).toMatchObject({ cancelled: false, fileName: 'CCP-2024-portfolio.zip' });
  expect(suggested).toBe('CCP-2024-portfolio.zip');
  const zip = await contents(destination);
  expect([...zip.keys()].sort()).toEqual([
    'CCP-2024-forms.pdf', 'evidence-index.txt', 'evidence/E1/café.txt', 'evidence/E2/café.txt', 'manifest.json',
  ]);
  for (const path of ['evidence/E1/café.txt', 'evidence/E2/café.txt']) expect(zip.get(path)).toEqual(original);
  const manifest = JSON.parse(zip.get('manifest.json')!.toString());
  expect(manifest).toMatchObject({
    kind: 'portfolio', archiveVersion: 1, year: 2024, createdAt: '2026-10-31T12:00:00.000Z',
    sourceSetId: 'swcc-supplied-2018-2026-v1', contentRevision: pkg.contentRevision,
    attachments: [
      { ref: 'E1', activityRef: 'A1', originalName: 'café.txt', importedAt: imported.attachment.importedAt },
      { ref: 'E2', activityRef: 'A2', originalName: 'café.txt' },
    ],
  });
  expect(manifest.files.map((file: { path: string }) => file.path).sort()).toEqual([...zip.keys()].filter(path => path !== 'manifest.json').sort());
  for (const file of manifest.files) {
    const bytes = zip.get(file.path)!;
    expect(file.byteCount).toBe(bytes.length);
    expect(file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  }
  expect(manifest.attachments[0].sha256).toBe(imported.attachment.sha256);
  const index = zip.get('evidence-index.txt')!.toString();
  expect(index).toContain('A1');
  expect(index).toContain('A2');
  expect(index).toContain('evidence/E1/café.txt');
  expect(index).toContain('evidence/E2/café.txt');
  expect(index).not.toContain('Apply the shared learning');
  const pdf = await getDocument({ data: new Uint8Array(zip.get('CCP-2024-forms.pdf')!), useSystemFonts: true }).promise;
  try {
    expect(pdf.numPages).toBeGreaterThan(5);
    let text = '';
    let actualStrengths = '';
    let actualReflection = '';
    for (let page = 1; page <= pdf.numPages; page++) {
      const rendered = await pdf.getPage(page);
      const content = (await rendered.getTextContent()).items.flatMap(item => 'str' in item ? [item] : []);
      text += content.map(item => item.str).join(' ');
      const sat = content.some(item => item.str.includes('Self-Assessment'));
      const pdp = content.some(item => item.str.includes('Professional Development'));
      if (sat || pdp) {
        const rect = sat ? [79.8549, 126.325, 192.437, 405.163] : [569.457, 123.052, 715.421, 421.526];
        const narrative = content.filter(item => item.transform[4] >= rect[0] && item.transform[4] < rect[2]
          && item.transform[5] > rect[1] && item.transform[5] < rect[3]);
        for (const line of narrative) expect(Math.hypot(line.transform[0], line.transform[1])).toBeGreaterThanOrEqual(10);
        const projected = narrative.filter(item => !/^A[12](?: \(continued\))?$/u.test(item.str)).map(item => item.str).join('');
        if (sat) actualStrengths += projected;
        else actualReflection += projected;
      }
      expect(await rendered.getAnnotations()).toEqual([]);
    }
    expect(actualStrengths.replace(/\s/gu, '')).toBe(strengths.replace(/\s/gu, ''));
    expect(actualReflection.replace(/\s/gu, '')).toBe(reflection.replace(/\s/gu, ''));
    expect(text.match(/Shared workshop/g)).toHaveLength(1);
    expect(text.match(/Supplementary reading/g)).toHaveLength(1);
    expect(text).toContain('Linked goals: G1, G2');
    expect(text).toContain('No linked goal');
    expect(text.match(/STRENGTHS-END/g)).toHaveLength(1);
    expect(text.match(/REFLECTION-END/g)).toHaveLength(1);
  } finally { await pdf.destroy(); }
  expect(value(await operations.getState())).toMatchObject({
    dataRevision: before.dataRevision, lastBackupAt: null, lastBackupRevision: null,
  });
});

test('original awkward and reserved filenames become portable while duplicate and accented names retain their metadata and bytes', async () => {
  const root = storage();
  const destination = resolve(storage(), 'CCP-2024-portfolio.zip');
  let selected = '';
  const app = openApplication(root, {}, undefined, { chooseFile: async () => selected }, templates, undefined,
    { chooseDestination: async () => destination });
  apps.push(app);
  let pkg = value(await app.operations.createYear(2024));
  pkg = value(await app.operations.createActivity({
    packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Evidence inventory',
  }));
  const names = ['CON.txt', 'aux.txt', 'COM1.report.txt', 'LPT¹.csv', 'NUL .txt', ' .hidden.txt',
    'résumé.txt', 're\u0301sume\u0301.txt', 'bad<>:"\\|?*\u0001.txt', 'hidden\u0085\u202e.txt', `${'.'.repeat(235)}.txt`, 'CON.txt'];
  for (const [index, name] of names.entries()) {
    const directory = resolve(root, `input-${index}`);
    mkdirSync(directory);
    selected = resolve(directory, name);
    writeFileSync(selected, `original-${index}`);
    const imported = value(await app.operations.importEvidence({
      packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision,
    }));
    if (imported.cancelled) throw new Error('Unexpected cancellation');
    pkg = imported.package;
  }
  value(await app.operations.exportPortfolio({ packageId: pkg.id, confirmDraft: true }));
  const zip = await contents(destination);
  const manifest = JSON.parse(zip.get('manifest.json')!.toString());
  expect(manifest.attachments).toHaveLength(names.length);
  const archivePaths = new Set<string>();
  for (const [index, attachment] of manifest.attachments.entries()) {
    expect(attachment.originalName.normalize('NFC')).toBe(names[index].normalize('NFC'));
    expect(attachment.path).toMatch(new RegExp(`^evidence/E${index + 1}/[^/]+$`));
    const name = attachment.path.split('/')[2];
    expect(name).not.toMatch(/[<>:"/\\|?*]|\p{Cc}|\p{Cf}/u);
    expect(name).not.toMatch(/^[. ]|[. ]$/u);
    expect(name.normalize('NFKC').split('.')[0].trim()).not.toMatch(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]|CONIN\$|CONOUT\$)$/iu);
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(180);
    expect(name).toMatch(/\.(txt|csv)$/u);
    expect(zip.get(attachment.path)?.toString()).toBe(`original-${index}`);
    expect(zip.get('evidence-index.txt')!.toString()).toContain(JSON.stringify(attachment.originalName));
    archivePaths.add(attachment.path);
  }
  expect(archivePaths.size).toBe(names.length);
});

test('portfolio drains admitted evidence writes and prevents concurrent edits, deletions and other archives until publication', async () => {
  const root = storage();
  const destination = resolve(storage(), 'CCP-2024-portfolio.zip');
  const source = resolve(root, 'pending.txt');
  writeFileSync(source, 'Evidence admitted before portfolio');
  let release!: (path: string) => void;
  const selection = new Promise<string>(resolveSelection => { release = resolveSelection; });
  const app = openApplication(root, {}, undefined, { chooseFile: () => selection }, templates, {
    chooseDestination: async () => resolve(storage(), 'backup.zip'),
  }, { chooseDestination: async () => destination });
  apps.push(app);
  const operations = app.operations;
  let pkg = value(await operations.createYear(2024));
  pkg = value(await operations.createActivity({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Initial activity' }));
  const importing = operations.importEvidence({
    packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision,
  });
  const exporting = operations.exportPortfolio({ packageId: pkg.id, confirmDraft: true });
  try {
    expect(await operations.deleteYear({ packageId: pkg.id, expectedRevision: pkg.contentRevision, confirmed: true }))
      .toMatchObject({ ok: false, error: { code: 'BUSY' } });
    expect(await operations.updateActivity({
      packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision, title: 'Mid-export mutation',
    })).toMatchObject({ ok: false, error: { code: 'BUSY' } });
    expect(await operations.recordReviewVisits({ packageId: pkg.id, pages: [2] }))
      .toMatchObject({ ok: false, error: { code: 'BUSY' } });
    expect(await operations.deleteActivity({
      packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision, confirmed: true,
    })).toMatchObject({ ok: false, error: { code: 'BUSY' } });
    expect(await operations.saveDraft({
      packageId: pkg.id, expectedRevision: pkg.contentRevision,
      draft: { assessmentDate: pkg.assessmentDate, planDate: pkg.planDate, strengths: 'Mid-export',
        peerFeedback: '', learningNeeds: '', annualStandards: [] },
    })).toMatchObject({ ok: false, error: { code: 'BUSY' } });
    expect(await operations.removeEvidence({
      packageId: pkg.id, activityId: pkg.activities[0].id, evidenceId: randomUUID(), expectedRevision: pkg.contentRevision,
    })).toMatchObject({ ok: false, error: { code: 'BUSY' } });
    expect(await operations.completeStep({ packageId: pkg.id, step: 'assessment', expectedRevision: pkg.assessmentRevision }))
      .toMatchObject({ ok: false, error: { code: 'BUSY' } });
    expect(await operations.recordDeclaration({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, date: '2024-10-31', confirmIncomplete: true,
    })).toMatchObject({ ok: false, error: { code: 'BUSY' } });
    expect(await operations.exportForms({ packageId: pkg.id, confirmDraft: true }))
      .toMatchObject({ ok: false, error: { code: 'BUSY' } });
    expect(await operations.exportPortfolio({ packageId: pkg.id, confirmDraft: true }))
      .toMatchObject({ ok: false, error: { code: 'BUSY' } });
    expect(await operations.createFullBackup()).toMatchObject({ ok: false, error: { code: 'BUSY' } });
    await expect.poll(async () => value(await operations.getPortfolioProgress()).phase).toBe('waiting');
    expect(value(await operations.getState()).selectedPackage?.activities[0].title).toBe('Initial activity');
  } finally {
    release(source);
    await importing;
    await exporting;
  }
  const imported = value(await importing);
  if (imported.cancelled) throw new Error('Unexpected cancellation');
  value(await exporting);
  const zip = await contents(destination);
  expect(zip.get('evidence/E1/pending.txt')?.toString()).toBe('Evidence admitted before portfolio');
  expect(JSON.parse(zip.get('manifest.json')!.toString()).contentRevision).toBe(imported.package.contentRevision);
  expect(value(await operations.getPortfolioProgress()).phase).toBe('idle');
  value(await operations.updateActivity({
    packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: imported.package.contentRevision, title: 'After export',
  }));
});

test.each(['missing', 'corrupt', 'changed-during-archive', 'symlink'] as const)(
  '%s evidence fails the public export without omitting bytes or replacing the prior complete file', async failure => {
    const root = storage();
    const output = storage();
    const destination = resolve(output, 'CCP-2024-portfolio.zip');
    const source = resolve(root, 'notes.txt');
    writeFileSync(source, 'original evidence');
    writeFileSync(destination, 'previous complete portfolio');
    let managed = '';
    const app = openApplication(root, {}, undefined, { chooseFile: async () => source }, templates, undefined, {
      chooseDestination: async () => destination,
      openOutput: path => {
        if (failure === 'changed-during-archive') writeFileSync(managed, 'modified evidence');
        return createWriteStream(path, { flags: 'wx' });
      },
    });
    apps.push(app);
    let pkg = value(await app.operations.createYear(2024));
    pkg = value(await app.operations.createActivity({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Evidence integrity',
    }));
    const imported = value(await app.operations.importEvidence({
      packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision,
    }));
    if (imported.cancelled) throw new Error('Unexpected cancellation');
    const directory = resolve(root, 'dataset/evidence/2024');
    managed = resolve(directory, readdirSync(directory)[0]);
    if (failure === 'missing') rmSync(managed);
    if (failure === 'corrupt') writeFileSync(managed, 'modified evidence');
    if (failure === 'symlink') { rmSync(managed); symlinkSync(source, managed); }
    expect(await app.operations.exportPortfolio({ packageId: pkg.id, confirmDraft: true }))
      .toMatchObject({ ok: false, error: { code: 'EVIDENCE' } });
    expect(readFileSync(destination).toString()).toBe('previous complete portfolio');
    expect(readdirSync(output)).toEqual(['CCP-2024-portfolio.zip']);
    expect(existsSync(resolve(root, 'runtime')) ? readdirSync(resolve(root, 'runtime')) : []).toEqual([]);
    expect(value(await app.operations.getPortfolioProgress()).phase).toBe('idle');
  },
);

test.each(['disk', 'pdf', 'destination', 'cancel-dialog', 'cancel-archive'] as const)(
  '%s failure or cancellation never publishes a partial-success portfolio and releases busy protection', async failure => {
    const root = storage();
    const output = storage();
    const destination = resolve(output, 'CCP-2024-portfolio.zip');
    writeFileSync(destination, 'previous complete portfolio');
    let started!: () => void;
    const writing = new Promise<void>(resolveWriting => { started = resolveWriting; });
    const app = openApplication(root, {}, undefined, undefined, {
      ...templates, readFont: () => failure === 'pdf' ? new Uint8Array() : templates.readFont(),
    }, undefined, {
      chooseDestination: async () => failure === 'cancel-dialog' ? null : failure === 'destination'
        ? resolve(root, 'dataset', 'unsafe.zip') : destination,
      openOutput: path => {
        if (failure === 'disk') return new Writable({ write: (_chunk, _encoding, done) => done(new Error('ENOSPC: disk full')) });
        if (failure === 'cancel-archive') return new Writable({ write: () => { started(); } });
        return createWriteStream(path, { flags: 'wx' });
      },
    });
    apps.push(app);
    const pkg = value(await app.operations.createYear(2024));
    const exporting = app.operations.exportPortfolio({ packageId: pkg.id, confirmDraft: true });
    if (failure === 'cancel-archive') {
      await writing;
      const progress = value(await app.operations.getPortfolioProgress());
      expect(progress.phase).toBe('archiving');
      expect(progress.bytesTotal).toBeGreaterThan(0);
      value(await app.operations.cancelPortfolioExport());
    }
    const result = await exporting;
    if (failure.startsWith('cancel-')) expect(result).toEqual({ ok: true, value: { cancelled: true } });
    else expect(result).toMatchObject({ ok: false, error: { code: failure === 'pdf' ? 'EXPORT' : failure === 'destination' ? 'VALIDATION' : 'STORAGE' } });
    expect(readFileSync(destination).toString()).toBe('previous complete portfolio');
    expect(readdirSync(output)).toEqual(['CCP-2024-portfolio.zip']);
    expect(existsSync(resolve(root, 'runtime')) ? readdirSync(resolve(root, 'runtime')) : []).toEqual([]);
    expect(existsSync(resolve(root, 'dataset/unsafe.zip'))).toBe(false);
    expect(value(await app.operations.getPortfolioProgress()).phase).toBe('idle');
    value(await app.operations.createYear(2023));
  },
);

test('cancelling while waiting for an admitted import leaves that independent import intact', async () => {
  const root = storage();
  const destination = resolve(storage(), 'CCP-2024-portfolio.zip');
  const source = resolve(root, 'notes.txt');
  writeFileSync(source, 'retained original');
  let release!: (path: string) => void;
  const selected = new Promise<string>(resolveSelection => { release = resolveSelection; });
  const app = openApplication(root, {}, undefined, { chooseFile: () => selected }, templates, undefined,
    { chooseDestination: async () => destination });
  apps.push(app);
  let pkg = value(await app.operations.createYear(2024));
  pkg = value(await app.operations.createActivity({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Independent import' }));
  const importing = app.operations.importEvidence({
    packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision,
  });
  const exporting = app.operations.exportPortfolio({ packageId: pkg.id, confirmDraft: true });
  try {
    await expect.poll(async () => value(await app.operations.getPortfolioProgress()).phase).toBe('waiting');
    value(await app.operations.cancelPortfolioExport());
    expect(await exporting).toEqual({ ok: true, value: { cancelled: true } });
    expect(existsSync(destination)).toBe(false);
  } finally { release(source); await importing; }
  expect(value(await app.operations.getEvidence(pkg.id))).toMatchObject([{ ref: 'E1', integrity: 'readable' }]);
});

test('portfolio is rejected while full backup owns collection, and drains an already admitted Forms PDF export', async () => {
  const root = storage();
  const output = storage();
  let releaseBackup!: (path: string | null) => void;
  let releaseForms!: (path: string | null) => void;
  const backupSelection = new Promise<string | null>(resolveSelection => { releaseBackup = resolveSelection; });
  const formsSelection = new Promise<string | null>(resolveSelection => { releaseForms = resolveSelection; });
  const app = openApplication(root, {}, undefined, undefined, {
    ...templates, chooseDestination: () => formsSelection,
  }, { chooseDestination: () => backupSelection }, {
    chooseDestination: async () => resolve(output, 'CCP-2024-portfolio.zip'),
  });
  apps.push(app);
  const pkg = value(await app.operations.createYear(2024));
  const backup = app.operations.createFullBackup();
  try {
    expect(await app.operations.exportPortfolio({ packageId: pkg.id, confirmDraft: true }))
      .toMatchObject({ ok: false, error: { code: 'BUSY' } });
  } finally { releaseBackup(null); await backup; }
  const forms = app.operations.exportForms({ packageId: pkg.id, confirmDraft: true });
  const portfolio = app.operations.exportPortfolio({ packageId: pkg.id, confirmDraft: true });
  try {
    await expect.poll(async () => value(await app.operations.getPortfolioProgress()).phase).toBe('waiting');
    expect(existsSync(resolve(output, 'CCP-2024-portfolio.zip'))).toBe(false);
  } finally {
    releaseForms(resolve(output, 'CCP-2024-forms.pdf'));
    await forms;
    await portfolio;
  }
  value(await forms);
  value(await portfolio);
  expect((await contents(resolve(output, 'CCP-2024-portfolio.zip'))).has('CCP-2024-forms.pdf')).toBe(true);
});
