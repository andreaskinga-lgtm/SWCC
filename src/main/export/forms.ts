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

function fieldLines(text: string, width: number, capacity: number, font: PDFFont, label: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').normalize('NFC');
  const supported = new Set(font.getCharacterSet());
  for (const character of normalized) {
    if (character !== '\n' && !supported.has(character.codePointAt(0)!))
      throw new Error(`${label} contains a character not supported by the bundled font (${character}). Replace it before retrying; it has not been silently omitted.`);
  }
  const lines: string[] = [];
  function add(line: string) {
    lines.push(line);
    if (lines.length > capacity) throw new FormsOverflow(
      `${label} does not fit the source layout at 10 pt. Continuation pages are not available yet (ticket 09). Shorten this content or wait for continuation support. No output was published.`,
    );
  }
  for (const paragraph of normalized.split('\n')) {
    const characters = Array.from(paragraph);
    if (!characters.length) add('');
    while (characters.length) {
      let count = 1;
      if (font.widthOfTextAtSize(characters[0], 10) > width) throw new FormsOverflow(`${label} cannot fit a character at 10 pt. Continuation support is required. No output was published.`);
      while (count < characters.length && font.widthOfTextAtSize(characters.slice(0, count + 1).join(''), 10) <= width) count++;
      if (count < characters.length) {
        let whitespace = -1;
        for (let index = 0; index < count; index++) if (/\s/u.test(characters[index])) whitespace = index;
        if (whitespace > 0) count = whitespace;
      }
      add(characters.splice(0, count).join(''));
      while (characters.length && /^\s$/u.test(characters[0])) characters.shift();
    }
  }
  return lines;
}

export async function exportAnnualForms(snapshot: AnnualFormsSnapshot, system: FormsSystem, fail: Fail): Promise<FormsExportOutcome> {
  let destination: string | null;
  try { destination = await system.chooseDestination({ defaultName: `CCP-${snapshot.package.year}-forms.pdf` }); }
  catch (error) {
    fail('EXPORT', `The forms destination dialog could not be opened: ${error instanceof Error ? error.message : String(error)}. Retry the export. No output was published.`);
  }
  if (!destination) return { cancelled: true };
  let bytes: Uint8Array;
  try { bytes = await generateForms(snapshot, system); }
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
  return { cancelled: false, fileName: basename(destination), pageCount: 3 };
}

async function generateForms(snapshot: AnnualFormsSnapshot, system: FormsSystem): Promise<Uint8Array> {
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
  const goals = pkg.goals.map(goal => [`${goal.ref} ${goal.title}`, goal.description].filter(Boolean).join('\n')).join('\n\n');
  const activities = pkg.activities.map(activity => [
    `${activity.ref} ${activity.title}`, activity.description,
    `${activity.status}${activity.completionDate ? ` — ${activity.completionDate}` : ''}`,
    activity.goalIds.length ? `Linked goals: ${pkg.goals.filter(goal => activity.goalIds.includes(goal.id)).map(goal => goal.ref).join(', ')}` : 'No linked goal',
  ].filter(Boolean).join('\n')).join('\n\n');
  const evidence = pkg.activities.map(activity => [
    activity.ref, activity.evidenceDescription, ...activity.evidenceLinks,
    ...snapshot.attachments.filter(entry => entry.activityId === activity.id).map(entry =>
      `${entry.ref} ${entry.originalName}${entry.integrity === 'readable' ? '' : ` [${entry.integrity}; repair required]`}`),
  ].filter(Boolean).join('\n')).join('\n\n');
  const reflections = pkg.activities.map(activity => [activity.ref, activity.applicationToPractice].filter(Boolean).join('\n')).join('\n\n');
  const layouts: { page: number; fields: Record<string, string> }[] = [
    { page: 7, fields: { Text35: pkg.strengths, Text36: pkg.peerFeedback, Text37: pkg.learningNeeds,
      Text38: goals, Date44_af_date: pkg.assessmentDate } },
    { page: 10, fields: { Text39: goals, Text40: activities, Text41: evidence, Text42: reflections, Date43_af_date: pkg.planDate } },
  ];
  for (const layout of layouts) {
    const source = await PDFDocument.load(template);
    source.registerFontkit(fontkit);
    const font = await source.embedFont(fontBytes, { subset: true });
    const form = source.getForm();
    ANNUAL_STANDARDS.forEach((standard, index) => {
      const field = form.getCheckBox(`Check Box ${index + 14}`);
      if (layout.page === 7 && pkg.annualStandards.includes(standard.id)) field.check();
      else field.uncheck();
    });
    form.updateFieldAppearances(font);
    for (const [name, text] of Object.entries(layout.fields)) {
      const field = form.getTextField(name);
      field.setText(text);
      field.setFontSize(10);
      field.updateAppearances(font, (_field, widget) => {
        const { width, height } = widget.getRectangle();
        const padding = name.startsWith('Date') ? 1 : 2;
        const lineHeight = font.heightAtSize(10) * 1.1;
        const capacity = Math.floor((height - padding * 2 - font.heightAtSize(10)) / lineHeight) + 1;
        const lines = fieldLines(text, width - padding * 2, capacity, font, fieldLabels[name]);
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
  }
  for (const page of output.getPages()) {
    page.node.delete(PDFName.of('Annots'));
    page.node.delete(PDFName.of('AA'));
  }
  output.setTitle(`CCP ${pkg.year} — annual forms`);
  return output.save();
}
