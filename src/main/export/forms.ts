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

interface TextRecord { text: string; ref?: string }
interface FieldGeometry { width: number; height: number; padding: number; lineHeight: number; capacity: number }
function paginate(records: TextRecord[], geometry: FieldGeometry, font: PDFFont, label: string): string[][] {
  const pages: string[][] = [[]];
  for (const record of records) {
    const lines = fieldLines(record.text, geometry.width - geometry.padding * 2, font, label);
    let offset = 0;
    let page = pages[pages.length - 1];
    if (page.length) {
      if (geometry.capacity - page.length < Math.min(lines.length + 1, 3)) pages.push(page = []);
      else page.push('');
    }
    while (offset < lines.length) {
      if (page.length === geometry.capacity) pages.push(page = []);
      if (!page.length && offset && record.ref) page.push(`${record.ref} (continued)`);
      const count = Math.min(geometry.capacity - page.length, lines.length - offset);
      page.push(...lines.slice(offset, offset + count));
      offset += count;
    }
  }
  return pages;
}

function paginateActivities(records: { ref: string; texts: string[] }[], geometries: FieldGeometry[], font: PDFFont): string[][][] {
  const capacity = Math.min(...geometries.map(geometry => geometry.capacity));
  const pages: string[][][] = [[[], [], []]];
  for (const record of records) {
    const lines = record.texts.map((text, index) =>
      fieldLines(text, geometries[index].width - geometries[index].padding * 2, font, fieldLabels[`Text${40 + index}`]));
    const offsets = [0, 0, 0];
    let page = pages[pages.length - 1];
    if (page[0].length) {
      if (capacity - page[0].length < Math.min(Math.max(...lines.map(column => column.length)) + 1, 3))
        pages.push(page = [[], [], []]);
      else page.forEach(column => column.push(''));
    }
    while (lines.some((column, index) => offsets[index] < column.length)) {
      if (page[0].length === capacity) pages.push(page = [[], [], []]);
      const continued = offsets.some(offset => offset > 0);
      const remaining = lines.map((column, index) => column.length - offsets[index]);
      const count = Math.min(capacity - page[0].length - Number(continued), Math.max(...remaining));
      // Reserve the same rows until every column of this activity is exhausted.
      page.forEach((column, index) => {
        if (continued) column.push(remaining[index] ? `${record.ref} (continued)` : '');
        const part = lines[index].slice(offsets[index], offsets[index] + count);
        column.push(...part, ...Array<string>(count - part.length).fill(''));
        offsets[index] += part.length;
      });
    }
  }
  return pages;
}

export async function exportAnnualForms(snapshot: AnnualFormsSnapshot, system: FormsSystem, fail: Fail): Promise<FormsExportOutcome> {
  let destination: string | null;
  try { destination = await system.chooseDestination({ defaultName: `CCP-${snapshot.package.year}-forms.pdf` }); }
  catch (error) {
    fail('EXPORT', `The forms destination dialog could not be opened: ${error instanceof Error ? error.message : String(error)}. Retry the export. No output was published.`);
  }
  if (!destination) return { cancelled: true };
  let bytes: Uint8Array;
  let pageCount: number;
  try { ({ bytes, pageCount } = await generateForms(snapshot, system)); }
  catch (error) {
    if (error instanceof FormsOverflow) fail('OVERFLOW', error.message);
    fail('EXPORT', `Forms PDF could not be generated: ${error instanceof Error ? error.message : String(error)}. No output was published.`);
  }
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
    ref: goal.ref, text: [`${goal.ref} ${goal.title}`, goal.description].filter(Boolean).join('\n'),
  }));
  const activities = pkg.activities.map(activity => ({
    ref: activity.ref,
    texts: [
      [`${activity.ref} ${activity.title}`, activity.description,
        `${activity.status}${activity.completionDate ? ` — ${activity.completionDate}` : ''}`,
        activity.goalIds.length ? `Linked goals: ${pkg.goals.filter(goal => activity.goalIds.includes(goal.id)).map(goal => goal.ref).join(', ')}` : 'No linked goal',
      ].filter(Boolean).join('\n'),
      [activity.ref, activity.evidenceDescription, ...activity.evidenceLinks,
        ...snapshot.attachments.filter(entry => entry.activityId === activity.id).map(entry =>
          `${entry.ref} ${entry.originalName}${entry.integrity === 'readable' ? '' : ` [${entry.integrity}; repair required]`}`),
      ].filter(Boolean).join('\n'),
      [activity.ref, activity.applicationToPractice].filter(Boolean).join('\n'),
    ],
  }));
  const layouts: { page: number; kind: string; dateField: string; date: string; fields: Record<string, TextRecord[]> }[] = [
    { page: 7, kind: 'SAT', dateField: 'Date44_af_date', date: pkg.assessmentDate,
      fields: { Text35: [{ text: pkg.strengths }], Text36: [{ text: pkg.peerFeedback }],
        Text37: [{ text: pkg.learningNeeds }], Text38: goals } },
    { page: 10, kind: 'PDP', dateField: 'Date43_af_date', date: pkg.planDate,
      fields: { Text39: goals, Text40: [], Text41: [], Text42: [] } },
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
    if (layout.page === 10) {
      const grouped = paginateActivities(activities, [geometry.Text40, geometry.Text41, geometry.Text42], measuredFont);
      ['Text40', 'Text41', 'Text42'].forEach((name, index) => { columns[name] = grouped.map(page => page[index]); });
    }
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
        [layout.dateField]: index ? [] : dateLines };
      for (const [name, lines] of Object.entries(fields)) {
        const field = form.getTextField(name);
        field.setText('');
        field.setFontSize(10);
        field.updateAppearances(font, () => {
          const { height, padding, lineHeight } = geometry[name];
          return drawLinesOfText(lines.map(line => font.encodeText(line)), {
            color: rgb(0, 0, 0), font: font.name, size: 10, lineHeight,
            x: padding, y: height - padding - font.heightAtSize(10, { descender: false }),
            rotate: degrees(0), xSkew: degrees(0), ySkew: degrees(0),
          });
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
