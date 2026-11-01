import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { open, rename, rm } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { degrees, drawLinesOfText, PDFDocument, PDFName, rgb } from 'pdf-lib';
import { ANNUAL_STANDARDS } from '../../shared/application.js';
import type { PDFFont } from 'pdf-lib';
import type { EvidenceAttachment, OperationError, YearPackage } from '../../shared/application.js';
import type { FormsExportOutcome } from '../../shared/forms.js';
import { reviewReadiness } from '../../shared/review.js';
import type { ReviewProgress } from '../../shared/review.js';
import { exportDestination } from './destination.js';

export interface FormsSystem {
  chooseDestination(selection: { defaultName: string }): Promise<string | null>;
  readChecklist(): Uint8Array;
  readAssessment(): Uint8Array;
  readFont(): Uint8Array;
}
export interface AnnualFormsSnapshot {
  package: YearPackage;
  review: ReviewProgress;
  attachments: EvidenceAttachment[];
}
type Fail = (code: OperationError['code'], message: string) => never;
class FormsOverflow extends Error {}
const fieldLabels: Record<string, string> = {
  Text35: 'SAT strengths', Text36: 'SAT peer feedback', Text37: 'SAT learning needs/interests', Text38: 'SAT goals',
  Text39: 'PDP goals', Text40: 'PDP activities', Text41: 'PDP evidence', Text42: 'PDP application to practice',
  Date44_af_date: 'Assessment date', Date43_af_date: 'Plan date',
};

function fieldLines(text: string, width: number, font: PDFFont, label: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  const supported = new Set(font.getCharacterSet());
  for (const character of normalized) {
    if (character !== '\n' && !supported.has(character.codePointAt(0)!))
      throw new Error(`${label} contains a character not supported by the bundled font (${character}). Replace it before retrying; it has not been silently omitted.`);
  }
  const lines: string[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const paragraph of normalized.split('\n')) {
    const characters = Array.from(segmenter.segment(paragraph), entry => entry.segment);
    if (!characters.length) lines.push('');
    let offset = 0;
    while (offset < characters.length) {
      let count = 1;
      if (font.widthOfTextAtSize(characters[offset], 10) > width)
        throw new FormsOverflow(`${label} contains a grapheme that cannot fit the source field at 10 pt. No output was published.`);
      while (offset + count < characters.length && font.widthOfTextAtSize(characters.slice(offset, offset + count + 1).join(''), 10) <= width) count++;
      if (offset + count < characters.length) {
        let whitespace = -1;
        for (let index = 0; index < count; index++) if (/\s/u.test(characters[offset + index])) whitespace = index;
        if (whitespace > 0) count = whitespace + 1;
      }
      lines.push(characters.slice(offset, offset + count).join(''));
      offset += count;
    }
  }
  return lines;
}

interface TextRecord { text: string }
interface PositionedLine { text: string; row: number }
interface FieldGeometry { width: number; height: number; padding: number; lineHeight: number; capacity: number }
function paginate(records: TextRecord[], geometry: FieldGeometry, font: PDFFont, label: string): PositionedLine[][] {
  const pages: PositionedLine[][] = [[]];
  for (const record of records) {
    if (!record.text.trim()) continue;
    const lines = fieldLines(record.text, geometry.width - geometry.padding * 2, font, label);
    let page = pages[pages.length - 1];
    let row = page.length ? page[page.length - 1].row + 1.5 : 0;
    for (const text of lines) {
      if (row > geometry.capacity - 1) {
        pages.push(page = []);
        row = 0;
      }
      page.push({ text, row });
      row++;
    }
  }
  return pages;
}

export async function exportAnnualForms(snapshot: AnnualFormsSnapshot, dataset: string, system: FormsSystem, fail: Fail): Promise<FormsExportOutcome> {
  let destination: string | null;
  try { destination = await system.chooseDestination({ defaultName: `CCP-${snapshot.package.year}-forms.pdf` }); }
  catch (error) {
    fail('EXPORT', `The forms destination dialog could not be opened: ${error instanceof Error ? error.message : String(error)}. Retry the export. No output was published.`);
  }
  if (!destination) return { cancelled: true };
  destination = await exportDestination(destination, dataset, 'forms PDF', fail);
  const { bytes, pageCount } = await generateAnnualForms(snapshot, system, fail);
  const partial = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.partial`);
  try {
    const file = await open(partial, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); }
    finally { await file.close(); }
    await rename(partial, destination);
  } catch (error) {
    fail('STORAGE', `Forms PDF could not be completely written: ${error instanceof Error ? error.message : String(error)}. Check destination permissions and available disk space, then retry. No output was published.`);
  } finally { await rm(partial, { force: true }).catch(() => {}); }
  return { cancelled: false, fileName: basename(destination), pageCount };
}

export async function generateAnnualForms(snapshot: AnnualFormsSnapshot, system: FormsSystem, fail: Fail) {
  const broken = snapshot.attachments.find(entry => entry.integrity !== 'readable');
  if (broken) fail('EVIDENCE', `${broken.ref} cannot be included (${broken.integrity}). Replace or remove this evidence entry before retrying. No output was published.`);
  try { return await generateForms(snapshot, system); }
  catch (error) {
    if (error instanceof FormsOverflow) fail('OVERFLOW', error.message);
    fail('EXPORT', `Forms PDF could not be generated: ${error instanceof Error ? error.message : String(error)}. No output was published.`);
  }
}

async function generateForms(snapshot: AnnualFormsSnapshot, system: FormsSystem): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const output = await PDFDocument.create();
  const checklist = await PDFDocument.load(system.readChecklist());
  const [checklistPage] = await output.copyPages(checklist, [0]);
  output.addPage(checklistPage);
  const template = system.readAssessment();
  const fontBytes = system.readFont();
  output.registerFontkit(fontkit);
  const checklistFont = await output.embedFont(fontBytes, { subset: true });
  const metrics = fontkit.create(fontBytes);
  const xGlyph = metrics.glyphForCodePoint(88).bbox;
  const units = metrics.unitsPerEm;
  const checks = [...reviewReadiness(snapshot.review).sections.map(section => section.checked), Boolean(snapshot.review.resourcesLaunchedAt)];
  // Centers measured on the actual image-based source at 1.5 px per PDF point.
  const rows = [227, 260, 294, 328, 399, 433, 467, 501, 535, 569, 602, 637, 671];
  checks.forEach((checked, index) => {
    if (!checked) return;
    checklistPage.drawText('X', {
      font: checklistFont, size: 10,
      x: (index < 4 ? 159 : 165) / 1.5 - (xGlyph.minX + xGlyph.maxX) * 10 / units / 2,
      y: 792 - rows[index] / 1.5 - (xGlyph.minY + xGlyph.maxY) * 10 / units / 2,
    });
  });
  const pkg = snapshot.package;
  const goals = pkg.goals.map(goal => ({
    text: [goal.title, goal.description].filter(text => text.trim()).join('\n'),
  }));
  const activities = pkg.activities.map(activity => ({
    texts: [
      [activity.title, activity.description].filter(text => text.trim()).join('\n'),
      [activity.evidenceDescription, ...activity.evidenceLinks,
        ...snapshot.attachments.filter(entry => entry.activityId === activity.id).map(entry =>
          entry.originalName.replace(/\p{Cc}|\p{Cf}/gu, character => `\\u{${character.codePointAt(0)!.toString(16)}}`)),
      ].filter(text => text.trim()).join('\n'),
      activity.applicationToPractice,
    ],
  }));
  const layouts: { page: number; kind: string; dateField: string; date: string; fields: Record<string, TextRecord[]> }[] = [
    { page: 7, kind: 'SAT', dateField: 'Date44_af_date', date: pkg.assessmentDate,
      fields: { Text35: [{ text: pkg.strengths }], Text36: [{ text: pkg.peerFeedback }],
        Text37: [{ text: pkg.learningNeeds }], Text38: goals } },
    { page: 10, kind: 'PDP', dateField: 'Date43_af_date', date: pkg.planDate,
      fields: { Text39: goals, ...Object.fromEntries(['Text40', 'Text41', 'Text42']
        .map((name, index) => [name, activities.map(activity => ({ text: activity.texts[index] }))])) } },
  ];
  for (const layout of layouts) {
    const measurement = await PDFDocument.load(template);
    measurement.registerFontkit(fontkit);
    const measuredFont = await measurement.embedFont(fontBytes, { subset: true });
    const geometry: Record<string, FieldGeometry> = {};
    for (const name of [...Object.keys(layout.fields), layout.dateField]) {
      const { width, height } = measurement.getForm().getTextField(name).acroField.getWidgets()[0].getRectangle();
      const padding = name.startsWith('Date') ? 1 : 2;
      const lineHeight = measuredFont.heightAtSize(10) * 1.1;
      geometry[name] = { width, height, padding, lineHeight,
        capacity: Math.floor((height - padding * 2 - measuredFont.heightAtSize(10)) / lineHeight) + 1 };
    }
    const columns = Object.fromEntries(Object.entries(layout.fields).map(([name, records]) =>
      [name, paginate(records, geometry[name], measuredFont, fieldLabels[name])]));
    const count = Math.max(1, ...Object.values(columns).map(pages => pages.length));
    const dateLines = fieldLines(layout.date, geometry[layout.dateField].width - 2, measuredFont, fieldLabels[layout.dateField]);
    if (dateLines.length > geometry[layout.dateField].capacity) throw new FormsOverflow('The date does not fit the source field. No output was published.');
    for (let index = 0; index < count; index++) {
      const source = await PDFDocument.load(template);
      source.registerFontkit(fontkit);
      const font = await source.embedFont(fontBytes, { subset: true });
      const form = source.getForm();
      ANNUAL_STANDARDS.forEach((standard, standardIndex) => {
        const field = form.getCheckBox(`Check Box ${standardIndex + 14}`);
        if (layout.page === 7 && !index && pkg.annualStandards.includes(standard.id)) field.check();
        else field.uncheck();
      });
      form.updateFieldAppearances(font);
      const fields = { ...Object.fromEntries(Object.entries(columns).map(([name, pages]) => [name, pages[index] ?? []])),
        [layout.dateField]: index ? [] : dateLines.map((text, row) => ({ text, row })) };
      for (const [name, lines] of Object.entries(fields)) {
        const field = form.getTextField(name);
        field.setText('');
        field.setFontSize(10);
        field.updateAppearances(font, () => {
          const { height, padding, lineHeight } = geometry[name];
          return lines.flatMap(line => drawLinesOfText([font.encodeText(line.text)], {
            color: rgb(0, 0, 0), font: font.name, size: 10, lineHeight,
            x: padding, y: height - padding - font.heightAtSize(10, { descender: false }) - line.row * lineHeight,
            rotate: degrees(0), xSkew: degrees(0), ySkew: degrees(0),
          }));
        });
      }
      form.flatten({ updateFieldAppearances: false });
      const [page] = await output.copyPages(source, [layout.page]);
      output.addPage(page);
      page.drawText(`CCP ${pkg.year} — ${layout.kind} — ${index ? 'continuation ' : 'page '}${index + 1} of ${count}`, {
        font: checklistFont, size: 10, x: 80, y: 65, color: rgb(0.25, 0.25, 0.25),
      });
    }
  }
  for (const page of output.getPages()) {
    page.node.delete(PDFName.of('Annots'));
    page.node.delete(PDFName.of('AA'));
  }
  output.setTitle(`CCP ${pkg.year} — annual forms`);
  return { bytes: await output.save(), pageCount: output.getPageCount() };
}
