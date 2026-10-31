import { afterEach, expect, test } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { REVIEW_SECTIONS } from '../src/shared/review.js';
import { openApplication } from '../src/main/data/application.js';
import type { Result } from '../src/shared/application.js';

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function storage() {
  const root = resolve('.work', `forms-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}
function formsSystem(destination: string) {
  return {
    chooseDestination: async () => destination,
    readChecklist: () => readFileSync('Step One SWCC.pdf'),
    readAssessment: () => readFileSync('OCSWSSW-CCP-Assess-Tool-2026-English.pdf'),
    readFont: () => readFileSync('resources/fonts/NotoSans-Regular.ttf'),
  };
}
async function text(pdf: PDFDocumentProxy, number: number) {
  return (await (await pdf.getPage(number)).getTextContent()).items.flatMap(item => 'str' in item ? [item.str] : []).join(' ');
}
async function render(pdf: PDFDocumentProxy, number: number) {
  const page = await pdf.getPage(number);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(viewport.width, viewport.height);
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D, viewport }).promise;
  return canvas;
}

test('empty drafts require acknowledgement then export a real flattened checklist, SAT and PDP with independent dates', async () => {
  const root = storage();
  const destination = resolve(root, 'draft.pdf');
  const app = openApplication(root, { today: () => '2026-10-31' }, undefined, undefined, formsSystem(destination));
  try {
    let pkg = value(await app.operations.createYear(2024));
    pkg = value(await app.operations.saveDraft({
      packageId: pkg.id, expectedRevision: pkg.contentRevision,
      draft: { assessmentDate: '2024-01-20', planDate: '2024-02-01', strengths: '', peerFeedback: '',
        learningNeeds: '', annualStandards: [] },
    }));
    expect(await app.operations.exportForms({ packageId: pkg.id })).toMatchObject({
      ok: false, error: { code: 'CONFIRMATION_REQUIRED', missing: expect.arrayContaining(['Add your strengths.']) },
    });

    expect(value(await app.operations.exportForms({ packageId: pkg.id, confirmDraft: true })))
      .toMatchObject({ cancelled: false, fileName: 'draft.pdf', pageCount: 3 });
    const pdf = await getDocument({ data: new Uint8Array(readFileSync(destination)), useSystemFonts: true }).promise;
    expect(pdf.numPages).toBe(3);
    try {
      expect(pdf.numPages).toBe(3);
      const sat = await pdf.getPage(2);
      const pdp = await pdf.getPage(3);
      expect(await text(pdf, 2)).toContain('2024-01-20');
      expect(await text(pdf, 2)).not.toContain('2024-02-01');
      expect(await text(pdf, 3)).toContain('2024-02-01');
      expect(await text(pdf, 3)).not.toContain('2024-01-20');
      expect(await text(pdf, 2)).toContain('Self-Assessment');
      expect(await text(pdf, 3)).toContain('Development');
      expect(await sat.getAnnotations()).toEqual([]);
      expect(await pdp.getAnnotations()).toEqual([]);
      expect(await pdf.getFieldObjects()).toBeNull();
      expect(await pdf.getJSActions()).toBeNull();
    } finally { await pdf.destroy(); }
  } finally { app.close(); }
});

test('annual narratives and shared/supplementary activities appear once with stable references, accents and measured checklist marks', async () => {
  const root = storage();
  const destination = resolve(root, 'annual.pdf');
  const evidenceFile = resolve(root, 'présence.txt');
  writeFileSync(evidenceFile, 'Original evidence bytes, not an embedded PDF attachment.');
  const app = openApplication(root, { today: () => '2026-10-31' },
    { openExternal: async () => {}, readDocument: () => new Uint8Array() },
    { chooseFile: async () => evidenceFile, openPath: async () => '' }, formsSystem(destination));
  try {
    let pkg = value(await app.operations.createYear(2024));
    pkg = value(await app.operations.saveDraft({
      packageId: pkg.id, expectedRevision: pkg.contentRevision,
      draft: { assessmentDate: '2024-01-20', planDate: '2024-02-01', strengths: 'Empathie café — écoute.',
        peerFeedback: '“Très bien.”', learningNeeds: 'Développer la réflexion.', annualStandards: ['meaning-of-client', 'principle-viii'] },
    }));
    for (const title of ['Supervision', 'Consultation']) pkg = value(await app.operations.createGoal({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title, description: `Objectif ${title}.`,
    }));
    pkg = value(await app.operations.createActivity({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Séminaire partagé', description: 'Atelier unique.',
      goalIds: pkg.goals.map(goal => goal.id), status: 'Completed', completionDate: '2024-03-01',
      evidenceDescription: 'Notes conservées.', evidenceLinks: ['https://example.org/café'],
      applicationToPractice: 'Écouter autrement.',
    }));
    const imported = value(await app.operations.importEvidence({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId: pkg.activities[0].id,
    }));
    if (imported.cancelled) throw new Error('Evidence fixture cancelled');
    pkg = imported.package;
    pkg = value(await app.operations.createActivity({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Lecture supplémentaire',
      evidenceDescription: 'Livre personnel.', applicationToPractice: 'Prendre du recul.',
    }));
    value(await app.operations.recordReviewVisits({ packageId: pkg.id,
      pages: [...new Set([...REVIEW_SECTIONS.flatMap(section => [...section.pages]), 48])] }));
    value(await app.operations.launchReviewResources(pkg.id));
    expect(value(await app.operations.getWorkflow(pkg.id)).steps.review.status).toBe('Ready');
    value(await app.operations.exportForms({ packageId: pkg.id, confirmDraft: true }));
    const source = await getDocument({ data: new Uint8Array(readFileSync('Step One SWCC.pdf')), useSystemFonts: true }).promise;
    const original = await render(source, 1);
    await source.destroy();
    const assessmentSource = await getDocument({
      data: new Uint8Array(readFileSync('OCSWSSW-CCP-Assess-Tool-2026-English.pdf')), useSystemFonts: true,
    }).promise;
    const originalSat = await render(assessmentSource, 8);
    await assessmentSource.destroy();
    const pdf = await getDocument({ data: new Uint8Array(readFileSync(destination)), useSystemFonts: true }).promise;
    try {
      const sat = await text(pdf, 2);
      const pdp = await text(pdf, 3);
      for (const narrative of ['Empathie café', '“Très bien.”', 'Développer la réflexion.']) expect(sat.split(narrative)).toHaveLength(2);
      for (const narrative of ['Objectif Supervision.', 'Objectif Consultation.']) {
        expect(sat.split(narrative)).toHaveLength(2);
        expect(pdp.split(narrative)).toHaveLength(2);
      }
      for (const narrative of ['Séminaire partagé', 'Atelier unique.', 'Notes conservées.', 'Écouter autrement.',
        'Lecture supplémentaire', 'Livre personnel.', 'Prendre du recul.', 'E1 présence.txt']) expect(pdp.split(narrative)).toHaveLength(2);
      expect(pdp).toContain('G1, G2');
      expect(pdp).toContain('No linked goal');
      expect(pdp.match(/\bA1\b/g)).toHaveLength(3);
      expect(pdp.match(/\bA2\b/g)).toHaveLength(3);
      expect(await pdf.getAttachments()).toBeNull();
      const renderedSat = await render(pdf, 2);
      const satBefore = originalSat.getContext('2d').getImageData(0, 0, originalSat.width, originalSat.height).data;
      const satAfter = renderedSat.getContext('2d').getImageData(0, 0, renderedSat.width, renderedSat.height).data;
      const checkboxBottoms = [387.75, 372.06, 356.37, 341, 325.25, 309.75, 294.084, 278.556, 262.956, 247.284, 231.75, 216.108];
      for (const [index, bottom] of checkboxBottoms.entries()) {
        let changed = 0;
        const x = Math.round(448.53 * 1.5);
        const y = Math.round((612 - bottom - 3.75) * 1.5);
        for (let py = y - 3; py <= y + 3; py++) for (let px = x - 3; px <= x + 3; px++) {
          const at = (py * originalSat.width + px) * 4;
          if (Math.abs(satBefore[at] - satAfter[at]) > 40) changed++;
        }
        if (index === 1 || index === 11) expect(changed, `annual standard ${index + 1}`).toBeGreaterThan(4);
        else expect(changed, `unselected standard ${index + 1}`).toBeLessThan(4);
      }
      const generated = await render(pdf, 1);
      const before = original.getContext('2d').getImageData(0, 0, original.width, original.height).data;
      const after = generated.getContext('2d').getImageData(0, 0, generated.width, generated.height).data;
      const rows = [227, 260, 294, 328, 399, 433, 467, 501, 535, 569, 602, 637, 671];
      for (const [index, y] of rows.entries()) {
        const x = index < 4 ? 159 : 165;
        let changed = 0;
        for (let py = y - 8; py <= y + 8; py++) for (let px = x - 7; px <= x + 7; px++) {
          const at = (py * original.width + px) * 4;
          if (Math.abs(before[at] - after[at]) > 40) changed++;
        }
        expect(changed, `checklist row ${index + 1}`).toBeGreaterThan(15);
      }
      if (process.env.SWCC_EXPORT_INSPECT === '1') {
        const directory = resolve('.work/forms-inspection');
        mkdirSync(directory, { recursive: true });
        writeFileSync(resolve(directory, 'annual.pdf'), readFileSync(destination));
        writeFileSync(resolve(directory, 'checklist.png'), generated.toBuffer('image/png'));
        for (const [number, name] of [[2, 'sat'], [3, 'pdp']] as const)
          writeFileSync(resolve(directory, `${name}.png`), (await render(pdf, number)).toBuffer('image/png'));
      }
    } finally { await pdf.destroy(); }
  } finally { app.close(); }
});

test('long words and URLs wrap completely within the measured source fields at 10 pt', async () => {
  const root = storage();
  const destination = resolve(root, 'wrapped.pdf');
  const app = openApplication(root, {}, undefined, undefined, formsSystem(destination));
  try {
    let pkg = value(await app.operations.createYear(2024));
    const narrative = `Début ${'AbCdEf'.repeat(18)} fin.`;
    const url = `https://example.org/${'LongWord'.repeat(16)}`;
    pkg = value(await app.operations.saveDraft({
      packageId: pkg.id, expectedRevision: pkg.contentRevision,
      draft: { assessmentDate: '', planDate: '', strengths: narrative, peerFeedback: '', learningNeeds: '', annualStandards: [] },
    }));
    pkg = value(await app.operations.createActivity({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Atelier', evidenceLinks: [url],
    }));
    value(await app.operations.exportForms({ packageId: pkg.id, confirmDraft: true }));
    const pdf = await getDocument({ data: new Uint8Array(readFileSync(destination)), useSystemFonts: true }).promise;
    try {
      for (const [pageNumber, rect, expected] of [
        [2, [79.8549, 126.325, 192.437, 405.163], narrative],
        [3, [412.365, 124.361, 547.857, 421.526], `A1 ${url}`],
      ] as const) {
        const content = await (await pdf.getPage(pageNumber)).getTextContent();
        const lines = content.items.filter(item => 'str' in item && item.str
          && item.transform[4] >= rect[0] && item.transform[4] < rect[2]
          && item.transform[5] > rect[1] && item.transform[5] < rect[3]);
        expect(lines.flatMap(item => 'str' in item ? [item.str] : []).join('').replace(/\s/g, ''))
          .toBe(expected.replace(/\s/g, ''));
        expect(lines.length).toBeGreaterThan(3);
        for (const item of lines) {
          if (!('str' in item)) continue;
          expect(item.transform[4]).toBeGreaterThanOrEqual(rect[0] + 1.9);
          expect(item.transform[4] + item.width).toBeLessThanOrEqual(rect[2] - 1.9);
          expect(Math.hypot(item.transform[0], item.transform[1])).toBeGreaterThanOrEqual(10);
          expect(item.transform[5]).toBeGreaterThan(rect[1] + 2);
          expect(item.transform[5] + item.height).toBeLessThan(rect[3] - 1);
        }
      }
      const rendered = await render(pdf, 2);
      expect(rendered.width).toBe(1188);
    } finally { await pdf.destroy(); }
  } finally { app.close(); }
});

test.each(['SAT strengths', 'PDP reflection'])('%s that cannot fit fails explicitly without truncating or replacing an existing file', async area => {
  const root = storage();
  const destination = resolve(root, 'existing.pdf');
  writeFileSync(destination, 'Previous complete export');
  const app = openApplication(root, {}, undefined, undefined, formsSystem(destination));
  try {
    let pkg = value(await app.operations.createYear(2024));
    if (area === 'SAT strengths') {
      pkg = value(await app.operations.saveDraft({
        packageId: pkg.id, expectedRevision: pkg.contentRevision,
        draft: { assessmentDate: '', planDate: '', strengths: 'A long paragraph with accents café. '.repeat(500),
          peerFeedback: '', learningNeeds: '', annualStandards: [] },
      }));
    } else {
      pkg = value(await app.operations.createActivity({ packageId: pkg.id, expectedRevision: pkg.contentRevision,
        title: 'Learning', applicationToPractice: `https://example.org/${'longunbroken'.repeat(500)}` }));
    }
    const result = await app.operations.exportForms({ packageId: pkg.id, confirmDraft: true });
    expect(result).toMatchObject({ ok: false, error: { code: 'OVERFLOW', message: expect.stringMatching(/continuation/i) } });
    expect(readFileSync(destination, 'utf8')).toBe('Previous complete export');
    expect(readdirSync(root).some(name => name.endsWith('.partial'))).toBe(false);
  } finally { app.close(); }
});

test('an export captures assessment, review and evidence synchronously before its asynchronous destination dialog', async () => {
  const root = storage();
  const destination = resolve(root, 'snapshot.pdf');
  let release!: (path: string) => void;
  const chooser = new Promise<string>(resolve => { release = resolve; });
  const evidenceFile = resolve(root, 'original.txt');
  writeFileSync(evidenceFile, 'snapshot evidence');
  const app = openApplication(root, {}, undefined,
    { chooseFile: async () => evidenceFile, openPath: async () => '' },
    { ...formsSystem(destination), chooseDestination: () => chooser });
  try {
    let pkg = value(await app.operations.createYear(2024));
    pkg = value(await app.operations.saveDraft({
      packageId: pkg.id, expectedRevision: pkg.contentRevision,
      draft: { assessmentDate: '2024-01-20', planDate: '2024-02-01', strengths: 'Captured assessment',
        peerFeedback: '', learningNeeds: '', annualStandards: ['principle-v'] },
    }));
    pkg = value(await app.operations.createActivity({ packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Captured activity' }));
    const imported = value(await app.operations.importEvidence({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId: pkg.activities[0].id,
    }));
    if (imported.cancelled) throw new Error('Evidence fixture cancelled');
    pkg = imported.package;
    value(await app.operations.recordReviewVisits({ packageId: pkg.id, pages: [2] }));
    const exporting = app.operations.exportForms({ packageId: pkg.id, confirmDraft: true });
    pkg = value(await app.operations.saveDraft({
      packageId: pkg.id, expectedRevision: pkg.contentRevision,
      draft: { assessmentDate: '2024-06-20', planDate: '2024-07-01', strengths: 'Newer edit',
        peerFeedback: '', learningNeeds: '', annualStandards: [] },
    }));
    value(await app.operations.resetReviewSection({ packageId: pkg.id, sectionId: 'ethics' }));
    value(await app.operations.removeEvidence({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId: pkg.activities[0].id, evidenceId: imported.attachment.id,
    }));
    release(destination);
    value(await exporting);
    const pdf = await getDocument({ data: new Uint8Array(readFileSync(destination)), useSystemFonts: true }).promise;
    try {
      expect(await text(pdf, 2)).toContain('Captured assessment');
      expect(await text(pdf, 2)).not.toContain('Newer edit');
      expect(await text(pdf, 2)).toContain('2024-01-20');
      expect(await text(pdf, 3)).toContain('E1 original.txt');
      expect(await text(pdf, 1)).toContain('X');
    } finally { await pdf.destroy(); }
  } finally { app.close(); }
});

test('destination cancellation, missing templates and failed publication never replace an existing complete output', async () => {
  const root = storage();
  const destination = resolve(root, 'complete.pdf');
  writeFileSync(destination, 'Previous complete export');
  let selected: string | null = null;
  let brokenTemplate = false;
  let failedDialog = false;
  const app = openApplication(root, {}, undefined, undefined, {
    ...formsSystem(destination),
    chooseDestination: async () => {
      if (failedDialog) throw new Error('Destination dialog unavailable');
      return selected;
    },
    readAssessment: () => brokenTemplate ? new Uint8Array([1, 2, 3]) : readFileSync('OCSWSSW-CCP-Assess-Tool-2026-English.pdf'),
  });
  try {
    const pkg = value(await app.operations.createYear(2024));
    const request = { packageId: pkg.id, confirmDraft: true as const };
    expect(value(await app.operations.exportForms(request))).toEqual({ cancelled: true });
    failedDialog = true;
    expect(await app.operations.exportForms(request)).toMatchObject({
      ok: false, error: { code: 'EXPORT', message: expect.stringContaining('destination dialog') },
    });
    failedDialog = false;
    selected = destination;
    brokenTemplate = true;
    expect(await app.operations.exportForms(request)).toMatchObject({ ok: false, error: { code: 'EXPORT' } });
    expect(readFileSync(destination, 'utf8')).toBe('Previous complete export');
    brokenTemplate = false;
    selected = resolve(root, 'absent-directory', 'failed.pdf');
    expect(await app.operations.exportForms(request)).toMatchObject({ ok: false, error: { code: 'STORAGE' } });
    expect(existsSync(selected)).toBe(false);
    selected = root; // A directory cannot be replaced with a file; fail at publication after the write.
    expect(await app.operations.exportForms(request)).toMatchObject({ ok: false, error: { code: 'STORAGE' } });
    expect(readFileSync(destination, 'utf8')).toBe('Previous complete export');
    expect(readdirSync(resolve(root, '..')).some(name => name.startsWith(`.${root.split('/').at(-1)}.`))).toBe(false);
  } finally { app.close(); }
});
