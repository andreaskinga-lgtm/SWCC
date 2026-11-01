import { afterEach, expect, test } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
test('forms destinations cannot overwrite managed evidence, including symbolic-linked storage locations', async () => {
  const root = storage();
  const data = resolve(root, 'storage');
  const source = resolve(root, 'certificate.pdf');
  const original = readFileSync('Step One SWCC.pdf');
  writeFileSync(source, original);
  let destination = resolve(root, 'annual.pdf');
  const app = openApplication(data, {}, undefined, { chooseFile: async () => source }, {
    ...formsSystem(destination), chooseDestination: async () => destination,
  });
  try {
    let pkg = value(await app.operations.createYear(2024));
    pkg = value(await app.operations.createActivity({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Keep original evidence',
    }));
    const imported = value(await app.operations.importEvidence({
      packageId: pkg.id, activityId: pkg.activities[0].id, expectedRevision: pkg.contentRevision,
    }));
    if (imported.cancelled) throw new Error('Unexpected cancellation.');
    const evidenceDirectory = resolve(data, 'dataset/evidence/2024');
    const managed = resolve(evidenceDirectory, readdirSync(evidenceDirectory)[0]);
    const linkedDirectory = resolve(root, 'linked-storage');
    const linkedFile = resolve(root, 'linked-evidence.pdf');
    symlinkSync(evidenceDirectory, linkedDirectory);
    symlinkSync(managed, linkedFile);
    for (const target of [managed, resolve(linkedDirectory, 'forms.pdf'), linkedFile]) {
      destination = target;
      expect(await app.operations.exportForms({ packageId: pkg.id, confirmDraft: true })).toMatchObject({
        ok: false, error: { code: 'VALIDATION' },
      });
      expect(readFileSync(managed)).toEqual(original);
      expect(value(await app.operations.getEvidence(pkg.id))).toMatchObject([{ integrity: 'readable' }]);
    }
    expect(existsSync(resolve(evidenceDirectory, 'forms.pdf'))).toBe(false);
  } finally { app.close(); }
});
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

async function sourceRender(number: number) {
  const source = await getDocument({ data: new Uint8Array(readFileSync('OCSWSSW-CCP-Assess-Tool-2026-English.pdf')),
    useSystemFonts: true }).promise;
  try { return await render(source, number); }
  finally { await source.destroy(); }
}

async function inspectLayout(pdf: PDFDocumentProxy, number: number, source: Awaited<ReturnType<typeof render>>,
  rects: readonly (readonly number[])[], extra: readonly (readonly number[])[] = []) {
  const generated = await render(pdf, number).catch(error => {
    throw new Error(`Render page ${number} of ${pdf.numPages}: ${String(error)}`);
  });
  const before = source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
  const after = generated.getContext('2d').getImageData(0, 0, generated.width, generated.height).data;
  const allowed = [...rects, ...extra, [78, 62, 400, 78]];
  const textBounds = (await Promise.all(rects.map(rect => column(pdf, number, rect))))
    .flat().map(line => [line.transform[4] - 1, line.transform[5] - 4,
      line.transform[4] + line.width + 1, line.transform[5] + line.height + 2]);
  let unexpected = 0;
  let fieldDecorations = 0;
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const at = (y * source.width + x) * 4;
    if (Math.abs(before[at] - after[at]) <= 40) continue;
    const inside = (rect: readonly number[], padding = 0) => x / 1.5 >= rect[0] - padding
      && x / 1.5 <= rect[2] + padding && 612 - y / 1.5 >= rect[1] - padding
      && 612 - y / 1.5 <= rect[3] + padding;
    if (rects.some(rect => inside(rect)) && !textBounds.some(rect => inside(rect))) fieldDecorations++;
    if (allowed.some(rect => x / 1.5 >= rect[0] - 1 && x / 1.5 <= rect[2] + 1
      && 612 - y / 1.5 >= rect[1] - 1 && 612 - y / 1.5 <= rect[3] + 1)) continue;
    unexpected++;
  }
  expect(unexpected, `no changes outside measured fields / continuation label, page ${number}`).toBe(0);
  expect(fieldDecorations, `only narrative ink inside fields, with no separators or marks in gaps/exhausted fields, page ${number}`).toBe(0);
  return generated;
}

test('empty drafts require acknowledgement then export a real flattened checklist, SAT and PDP with independent dates', async () => {
  const root = storage();
  const destination = resolve(root, 'draft.pdf');
  const app = openApplication(resolve(root, 'storage'), { today: () => '2026-10-31' }, undefined, undefined, formsSystem(destination));
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

test('annual forms retain only authored narratives and filenames, with natural independent field flow and intact checklist marks', async () => {
  const root = storage();
  const destination = resolve(root, 'annual.pdf');
  const evidenceFile = resolve(root, 'E88-A77-G66-présence.txt');
  writeFileSync(evidenceFile, 'Original evidence bytes, not an embedded PDF attachment.');
  const app = openApplication(resolve(root, 'storage'), { today: () => '2026-10-31' },
    { openExternal: async () => {}, readDocument: () => new Uint8Array() },
    { chooseFile: async () => evidenceFile, openPath: async () => '' }, formsSystem(destination));
  try {
    let pkg = value(await app.operations.createYear(2024));
    pkg = value(await app.operations.saveDraft({
      packageId: pkg.id, expectedRevision: pkg.contentRevision,
      draft: { assessmentDate: '2024-01-20', planDate: '2024-02-01', strengths: 'Empathie café — écoute.',
        peerFeedback: '“Très bien.”', learningNeeds: 'Développer la réflexion.', annualStandards: ['meaning-of-client', 'principle-viii'] },
    }));
    for (const title of ['G44 Supervision', 'Consultation']) pkg = value(await app.operations.createGoal({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title, description: `Objectif ${title}.`,
    }));
    pkg = value(await app.operations.createActivity({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'A55 Séminaire partagé', description: 'Atelier unique.',
      goalIds: pkg.goals.map(goal => goal.id), status: 'Completed', completionDate: '2024-03-01',
      evidenceDescription: 'E33 Notes conservées.', evidenceLinks: ['https://example.org/A99/G98/E97/café'],
      applicationToPractice: 'A22 Écouter autrement.',
    }));
    const imported = value(await app.operations.importEvidence({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId: pkg.activities[0].id,
    }));
    if (imported.cancelled) throw new Error('Evidence fixture cancelled');
    pkg = imported.package;
    const secondImport = value(await app.operations.importEvidence({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId: pkg.activities[0].id,
    }));
    if (secondImport.cancelled) throw new Error('Evidence fixture cancelled');
    pkg = secondImport.package;
    pkg = value(await app.operations.createActivity({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Sans preuve ni réflexion',
      description: ' \n\n', evidenceDescription: ' \n\n', applicationToPractice: ' \n\n',
    }));
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
      for (const narrative of ['Empathie café', '“Très bien.”', 'Développer la réflexion.'])
        expect(compact(sat).split(compact(narrative)), sat).toHaveLength(2);
      for (const narrative of ['Objectif G44 Supervision.', 'Objectif Consultation.']) {
        expect(compact(sat).split(compact(narrative))).toHaveLength(2);
        expect(compact(pdp).split(compact(narrative))).toHaveLength(2);
      }
      for (const narrative of ['A55 Séminaire partagé', 'Atelier unique.', 'E33 Notes conservées.', 'A22 Écouter autrement.',
        'Sans preuve ni réflexion', 'Lecture supplémentaire', 'Livre personnel.', 'Prendre du recul.',
        'https://example.org/A99/G98/E97/café']) expect(compact(pdp).split(compact(narrative)), narrative).toHaveLength(2);
      expect(compact(pdp).split('E88-A77-G66-présence.txt')).toHaveLength(3);
      for (const generated of [/\b[AGE][123]\b/u, /Linked goals|No linked goal|\(continued\)/u,
        /Completed|Planned|2024-03-01/u]) {
        expect(sat).not.toMatch(generated);
        expect(pdp).not.toMatch(generated);
      }
      const activities = await column(pdf, 3, pdpRects[1]);
      const evidence = await column(pdf, 3, pdpRects[2]);
      const reflections = await column(pdf, 3, pdpRects[3]);
      const supplementaryActivity = activities.find(line => line.str.includes('Lecture'))!;
      const supplementaryEvidence = evidence.find(line => line.str.includes('Livre personnel.'))!;
      const supplementaryReflection = reflections.find(line => line.str.includes('Prendre du recul.'))!;
      const missingActivity = activities.find(line => line.str.includes('Sans preuve'))!;
      const activityGap = missingActivity.transform[5] - supplementaryActivity.transform[5];
      expect(activityGap).toBeGreaterThan(15);
      expect(activityGap).toBeLessThan(25);
      // Unequal fields flow independently; an empty record leaves no evidence/reflection slot.
      expect(supplementaryEvidence.transform[5]).toBeLessThan(supplementaryActivity.transform[5] - 5);
      expect(supplementaryReflection.transform[5]).toBeGreaterThan(supplementaryActivity.transform[5] + 5);
      const reflectionGap = reflections[0].transform[5] - supplementaryReflection.transform[5];
      expect(reflectionGap).toBeGreaterThan(15);
      expect(reflectionGap).toBeLessThan(25);
      expect(await pdf.getAttachments()).toBeNull();
      await inspectLayout(pdf, 3, await sourceRender(11), pdpRects, [[111.273, 88.3613, 208.146, 105.38]]);
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
  const app = openApplication(resolve(root, 'storage'), {}, undefined, undefined, formsSystem(destination));
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
        [3, [412.365, 124.361, 547.857, 421.526], url],
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

const satRects = [
  [79.8549, 126.325, 192.437, 405.163],
  [211.419, 126.325, 310.256, 404.508],
  [331.201, 125.016, 432.002, 404.508],
  [572.075, 126.325, 710.839, 403.854],
] as const;
const pdpRects = [
  [84.4367, 124.361, 232.365, 422.181],
  [253.31, 122.398, 390.111, 421.526],
  [412.365, 124.361, 547.857, 421.526],
  [569.457, 123.052, 715.421, 421.526],
] as const;
async function column(pdf: PDFDocumentProxy, number: number, rect: readonly number[]) {
  const content = await (await pdf.getPage(number)).getTextContent();
  return content.items.filter(item => 'str' in item && item.str
    && item.transform[4] >= rect[0] && item.transform[4] < rect[2]
    && item.transform[5] > rect[1] && item.transform[5] < rect[3])
    .flatMap(item => 'str' in item ? [item] : []);
}
const compact = (text: string) => text.replace(/\s/gu, '');
function narrative(lines: { str: string }[]) {
  return lines.map(line => line.str).join('');
}

test('SAT continuations carry each full annual narrative and goal once at readable size in the original layout', async () => {
  const root = storage();
  const destination = resolve(root, 'sat-stress.pdf');
  const app = openApplication(resolve(root, 'storage'), {}, undefined, undefined, formsSystem(destination));
  const strengths = Array.from({ length: 28 }, (_, n) => `Force${n}: café, écoute — “précision”.`).join('\n\n');
  const feedback = `Une seule voix.\n\ncafe\u0301; e\u0301coute; office, affinité.\n${'À bientôt; progrès! '.repeat(110)}FIN-AVIS`;
  const needs = `Besoin initial.\n\nhttps://example.org/${'AbCdÉf'.repeat(95)}\n${'MotIninterrompu'.repeat(32)}\nFIN-BESOINS`;
  try {
    let pkg = value(await app.operations.createYear(2024));
    pkg = value(await app.operations.saveDraft({ packageId: pkg.id, expectedRevision: pkg.contentRevision,
      draft: { assessmentDate: '2024-01-20', planDate: '2024-02-01', strengths, peerFeedback: feedback,
        learningNeeds: needs, annualStandards: ['principle-viii'] } }));
    for (let n = 1; n <= 12; n++) pkg = value(await app.operations.createGoal({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title: `Objectif unique ${n}`,
      description: n === 1 ? 'Première description. '.repeat(100) : `Description ${n} — fin.`,
    }));
    const result = value(await app.operations.exportForms({ packageId: pkg.id, confirmDraft: true }));
    expect(result.cancelled).toBe(false);
    const original = await sourceRender(8);
    const pdf = await getDocument({ data: new Uint8Array(readFileSync(destination)), useSystemFonts: true }).promise;
    try {
      const pages: number[] = [];
      for (let n = 2; n <= pdf.numPages; n++) if ((await text(pdf, n)).includes('Self-Assessment')) pages.push(n);
      expect(pages.length).toBeGreaterThan(2);
      if (!result.cancelled) expect(result.pageCount).toBe(pdf.numPages);
      const expected = [strengths, feedback, needs,
        pkg.goals.map(goal => `${goal.title}\n${goal.description}`).join('\n')];
      for (const [index, rect] of satRects.entries()) {
        let actual = '';
        for (const n of pages) {
          const lines = await column(pdf, n, rect);
          actual += narrative(lines);
          for (const line of lines) {
            expect(line.transform[4] + line.width).toBeLessThanOrEqual(rect[2] - 1.9);
            expect(Math.hypot(line.transform[0], line.transform[1])).toBeGreaterThanOrEqual(10);
            expect(line.transform[5] + line.height).toBeLessThan(rect[3] - 1);
            expect(line.transform[5]).toBeGreaterThan(rect[1] + 2);
          }
        }
        expect(compact(actual), `complete SAT column ${index}`).toBe(compact(expected[index]));
      }
      for (const n of pages) {
        expect(await text(pdf, n)).toContain(`CCP 2024 — SAT`);
        expect(await (await pdf.getPage(n)).getAnnotations()).toEqual([]);
        expect((await pdf.getPage(n)).view).toEqual([0, 0, 792, 612]);
      }
      expect(await pdf.getFieldObjects()).toBeNull();
      expect(await pdf.getJSActions()).toBeNull();
      const firstFeedback = await column(pdf, pages[0], satRects[1]);
      expect(firstFeedback[0].transform[5] - firstFeedback[1].transform[5]).toBeGreaterThan(25);
      const directory = resolve('.work/forms-continuation-inspection');
      if (process.env.SWCC_EXPORT_INSPECT === '1') {
        mkdirSync(directory, { recursive: true });
        writeFileSync(resolve(directory, 'sat-stress.pdf'), readFileSync(destination));
        writeFileSync(resolve(directory, 'sat-source.png'), original.toBuffer('image/png'));
      }
      for (const n of pages) {
        const rendered = await inspectLayout(pdf, n, original, satRects,
          [[106.037, 88.3613, 204.874, 105.38], ...(n === pages[0] ? [[444.78, 216.108, 452.28, 223.608]] : [])]);
        if (process.env.SWCC_EXPORT_INSPECT === '1')
          writeFileSync(resolve(directory, `sat-${n - 1}.png`), rendered.toBuffer('image/png'));
      }
    } finally { await pdf.destroy(); }
  } finally { app.close(); }
}, 30_000);

test('PDP fields continue independently without labels, alignment gaps or repeated content, leaving exhausted fields blank', async () => {
  const root = storage();
  const destination = resolve(root, 'pdp-stress.pdf');
  const evidenceFile = resolve(root, 'attestation-présence.txt');
  writeFileSync(evidenceFile, 'Exact managed evidence bytes.');
  const app = openApplication(resolve(root, 'storage'), { today: () => '2026-10-31' }, undefined,
    { chooseFile: async () => evidenceFile, openPath: async () => '' }, formsSystem(destination));
  const url = `https://example.org/${'UrlÉnormeSansSéparateur'.repeat(60)}`;
  const inputs = Array.from({ length: 12 }, (_, index) => ({
    title: `Atelier unique ${index + 1} — café`,
    description: index === 1 ? 'Description ample, étape suivante. '.repeat(100) : `Description brève ${index + 1}.`,
    evidenceDescription: index === 1 ? 'Preuve détaillée.\n\n'.repeat(28) : index === 2 ? '' : `Preuve unique ${index + 1}.`,
    evidenceLinks: index === 1 ? [url, `http://example.org/${'Word'.repeat(65)}`] : [],
    applicationToPractice: index === 0 ? 'Réflexion vaste — “élargir”. '.repeat(150)
      : index === 2 ? ''
      : index === 3 ? 'Premier paragraphe.\n\nDeuxième paragraphe: naïve, coöperation, œil; ponctuation…\nDernière ligne.'
      : `Réflexion brève ${index + 1}.`,
  }));
  try {
    let pkg = value(await app.operations.createYear(2024));
    for (let n = 1; n <= 14; n++) pkg = value(await app.operations.createGoal({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title: `But distinct ${n}`, description: `Récit du but ${n}.`,
    }));
    for (const [index, input] of inputs.entries()) {
      pkg = value(await app.operations.createActivity({ ...input, packageId: pkg.id, expectedRevision: pkg.contentRevision,
        goalIds: index === 0 ? pkg.goals.slice(0, 2).map(goal => goal.id)
          : index === 2 ? [] : [pkg.goals[index % pkg.goals.length].id],
        status: 'Completed', completionDate: '2024-03-01' }));
      if (index === 0) {
        const imported = value(await app.operations.importEvidence({
          packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId: pkg.activities[0].id,
        }));
        if (imported.cancelled) throw new Error('Evidence fixture cancelled');
        pkg = imported.package;
      }
    }
    const result = value(await app.operations.exportForms({ packageId: pkg.id, confirmDraft: true }));
    const original = await sourceRender(11);
    const pdf = await getDocument({ data: new Uint8Array(readFileSync(destination)), useSystemFonts: true }).promise;
    try {
      const pages: number[] = [];
      for (let n = 2; n <= pdf.numPages; n++) if ((await text(pdf, n)).includes('Development')) pages.push(n);
      expect(pages.length).toBeGreaterThan(2);
      if (!result.cancelled) expect(result.pageCount).toBe(pdf.numPages);
      const expected = [
        Array.from({ length: 14 }, (_, i) => `But distinct ${i + 1}\nRécit du but ${i + 1}.`).join('\n'),
        inputs.map(input => `${input.title}\n${input.description}`).join('\n'),
        inputs.map((input, i) => [input.evidenceDescription, ...input.evidenceLinks,
          ...(i === 0 ? ['attestation-présence.txt'] : [])].join('\n')).join('\n'),
        inputs.map(input => input.applicationToPractice).join('\n'),
      ];
      for (const [index, rect] of pdpRects.entries()) {
        let actual = '';
        for (const n of pages) {
          const lines = await column(pdf, n, rect);
          actual += narrative(lines);
          for (const line of lines) {
            expect(line.transform[4]).toBeGreaterThanOrEqual(rect[0] + 1.9);
            expect(line.transform[4] + line.width).toBeLessThanOrEqual(rect[2] - 1.9);
            expect(Math.hypot(line.transform[0], line.transform[1])).toBeGreaterThanOrEqual(10);
            expect(line.transform[5]).toBeGreaterThan(rect[1] + 2);
            expect(line.transform[5] + line.height).toBeLessThan(rect[3] - 1);
          }
        }
        expect(compact(actual), `complete PDP column ${index}`).toBe(compact(expected[index]));
      }
      const lastPages: number[] = [];
      for (const rect of pdpRects) {
        let last = 0;
        for (const n of pages) if ((await column(pdf, n, rect)).length) last = n;
        lastPages.push(last);
      }
      expect(new Set(lastPages).size).toBeGreaterThan(1);
      const firstActivities = await column(pdf, pages[0], pdpRects[1]);
      expect(firstActivities.some(line => line.str.includes('Atelier unique 2'))).toBe(true);
      const firstReflections = await column(pdf, pages[0], pdpRects[3]);
      expect(firstReflections.some(line => line.str.includes('Réflexion brève 2'))).toBe(false);
      for (const n of pages) {
        expect(await text(pdf, n)).not.toMatch(/\b[AGE]\d+\b|Linked goals|No linked goal|\(continued\)|Completed|2024-03-01/u);
        expect(await (await pdf.getPage(n)).getAnnotations()).toEqual([]);
        expect(await text(pdf, n)).toContain('CCP 2024 — PDP');
      }
      expect(await pdf.getFieldObjects()).toBeNull();
      expect(await pdf.getJSActions()).toBeNull();
      expect(await pdf.getAttachments()).toBeNull();
      const directory = resolve('.work/forms-continuation-inspection');
      if (process.env.SWCC_EXPORT_INSPECT === '1') {
        mkdirSync(directory, { recursive: true });
        writeFileSync(resolve(directory, 'pdp-stress.pdf'), readFileSync(destination));
        writeFileSync(resolve(directory, 'pdp-source.png'), original.toBuffer('image/png'));
      }
      for (const n of pages) {
        const rendered = await inspectLayout(pdf, n, original, pdpRects, [[111.273, 88.3613, 208.146, 105.38]]);
        if (process.env.SWCC_EXPORT_INSPECT === '1')
          writeFileSync(resolve(directory, `pdp-${n - pages[0] + 1}.png`), rendered.toBuffer('image/png'));
      }
    } finally { await pdf.destroy(); }
  } finally { app.close(); }
}, 30_000);

test('unsupported glyphs fail explicitly without silently changing the narrative or replacing a complete file', async () => {
  const root = storage();
  const destination = resolve(root, 'existing.pdf');
  writeFileSync(destination, 'Previous complete export');
  const app = openApplication(resolve(root, 'storage'), {}, undefined, undefined, formsSystem(destination));
  try {
    let pkg = value(await app.operations.createYear(2024));
    pkg = value(await app.operations.saveDraft({
      packageId: pkg.id, expectedRevision: pkg.contentRevision,
      draft: { assessmentDate: '', planDate: '', strengths: 'Keep this unsupported character: 🧠',
        peerFeedback: '', learningNeeds: '', annualStandards: [] },
    }));
    const result = await app.operations.exportForms({ packageId: pkg.id, confirmDraft: true });
    expect(result).toMatchObject({ ok: false, error: { code: 'EXPORT', message: expect.stringMatching(/not supported.*🧠/u) } });
    expect(readFileSync(destination, 'utf8')).toBe('Previous complete export');
    expect(readdirSync(root).some(name => name.endsWith('.partial'))).toBe(false);
  } finally { app.close(); }
});

test.each(['missing', 'corrupt'] as const)('forms report %s evidence explicitly rather than printing a repair annotation or replacing the prior PDF', async failure => {
  const root = storage();
  const destination = resolve(root, 'existing.pdf');
  const evidenceFile = resolve(root, 'certificate.txt');
  writeFileSync(destination, 'Previous complete export');
  writeFileSync(evidenceFile, 'Original evidence bytes.');
  const data = resolve(root, 'storage');
  const app = openApplication(data, {}, undefined, { chooseFile: async () => evidenceFile }, formsSystem(destination));
  try {
    let pkg = value(await app.operations.createYear(2024));
    pkg = value(await app.operations.createActivity({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, title: 'Evidence integrity',
    }));
    const imported = value(await app.operations.importEvidence({
      packageId: pkg.id, expectedRevision: pkg.contentRevision, activityId: pkg.activities[0].id,
    }));
    if (imported.cancelled) throw new Error('Evidence fixture cancelled');
    const directory = resolve(data, 'dataset/evidence/2024');
    const managed = resolve(directory, readdirSync(directory)[0]);
    if (failure === 'missing') rmSync(managed);
    else writeFileSync(managed, 'Changed evidence bytes.');
    expect(await app.operations.exportForms({ packageId: pkg.id, confirmDraft: true })).toMatchObject({
      ok: false, error: { code: 'EVIDENCE', message: expect.stringMatching(/E1.*replace or remove/iu) },
    });
    expect(readFileSync(destination, 'utf8')).toBe('Previous complete export');
  } finally { app.close(); }
});

test('an export captures assessment, review and evidence synchronously before its asynchronous destination dialog', async () => {
  const root = storage();
  const destination = resolve(root, 'snapshot.pdf');
  let release!: (path: string) => void;
  const chooser = new Promise<string>(resolve => { release = resolve; });
  const evidenceFile = resolve(root, 'original.txt');
  writeFileSync(evidenceFile, 'snapshot evidence');
  const app = openApplication(resolve(root, 'storage'), {}, undefined,
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
      expect(await text(pdf, 3)).toContain('original.txt');
      expect(await text(pdf, 3)).not.toMatch(/\b[AE]1\b/u);
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
  const app = openApplication(resolve(root, 'storage'), {}, undefined, undefined, {
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
