import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { Writable } from 'node:stream';
import type { EvidenceAttachment, OperationError } from '../../shared/application.js';
import type { PortfolioExportOutcome, PortfolioManifest, PortfolioProgress } from '../../shared/portfolio.js';
import { ArchiveSourceFailure, writeArchive } from '../archive.js';
import { MAX_EVIDENCE_BYTES, SUPPORTED_EVIDENCE_EXTENSIONS } from '../data/evidence.js';
import type { storageLayout } from '../data/storage.js';
import { generateAnnualForms } from './forms.js';
import type { AnnualFormsSnapshot, FormsSystem } from './forms.js';

export interface PortfolioSystem {
  chooseDestination: (suggestedName: string) => Promise<string | null>;
  openOutput?: (partialPath: string) => Writable;
}
export interface PortfolioSnapshot extends AnnualFormsSnapshot {
  dataRevision: number;
  evidenceFiles: { attachment: EvidenceAttachment; managedPath: string }[];
}

function portableName(originalName: string, type: string): string {
  let stem = originalName.normalize('NFC');
  if (stem.toLowerCase().endsWith(`.${type}`)) stem = stem.slice(0, -type.length - 1);
  stem = stem.replace(/[<>:"/\\|?*]|\p{Cc}|\p{Cf}/gu, '_').replace(/^[. ]+|[. ]+$/gu, '');
  if (!stem) stem = 'evidence';
  const device = stem.normalize('NFKC').split('.')[0].trim();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]|CONIN\$|CONOUT\$|CLOCK\$)$/iu.test(device)) stem = `_${stem}`;
  const budget = 180 - Buffer.byteLength(`.${type}`);
  let bounded = '';
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(stem)) {
    if (Buffer.byteLength(bounded + segment) > budget) break;
    bounded += segment;
  }
  return `${bounded.replace(/[. ]+$/gu, '') || 'evidence'}.${type}`;
}

export async function exportAnnualPortfolio(
  snapshot: PortfolioSnapshot,
  paths: ReturnType<typeof storageLayout>,
  createdAt: string,
  templates: FormsSystem,
  system: PortfolioSystem,
  signal: AbortSignal,
  report: (progress: PortfolioProgress) => void,
  fail: (code: OperationError['code'], message: string) => never,
): Promise<PortfolioExportOutcome> {
  let progress: PortfolioProgress = { phase: 'choosing', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0 };
  const phase = (next: PortfolioProgress['phase']) => { progress = { ...progress, phase: next }; report(progress); };
  phase('choosing');
  const selected = await system.chooseDestination(`CCP-${snapshot.package.year}-portfolio.zip`);
  if (!selected || signal.aborted) return { cancelled: true };
  if (!isAbsolute(selected)) fail('VALIDATION', 'Choose an absolute portfolio destination outside SWCC storage.');
  const storageRoot = await realpath(dirname(paths.dataset));
  const directory = await realpath(dirname(selected));
  const destination = join(directory, basename(selected));
  const location = relative(storageRoot, directory);
  if (!location || (!location.startsWith(`..${sep}`) && location !== '..' && !isAbsolute(location)))
    fail('VALIDATION', 'Choose a portfolio destination outside SWCC storage, so an export cannot overwrite records or evidence.');
  try {
    if ((await lstat(destination)).isSymbolicLink()) fail('VALIDATION', 'Choose a regular portfolio file, not a symbolic link.');
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const staging = join(paths.runtime, `portfolio-${randomUUID()}`);
  const partial = join(directory, `.swcc-portfolio-${randomUUID()}.partial`);
  try {
    signal.throwIfAborted();
    if ((await lstat(paths.evidence)).isSymbolicLink()) fail('EVIDENCE', 'Repair the symbolic-linked managed evidence directory before exporting.');
    const evidence: { attachment: EvidenceAttachment; path: string; sourcePath: string }[] = [];
    for (const { attachment, managedPath } of snapshot.evidenceFiles) {
      if (!SUPPORTED_EVIDENCE_EXTENSIONS.some(type => type === attachment.type) || !/^E[1-9]\d*$/u.test(attachment.ref))
        fail('EVIDENCE', 'Repair invalid managed evidence type or reference metadata before exporting.');
      const safePath = new RegExp(`^${snapshot.package.year}/${attachment.ref}-[\\da-f-]{36}\\.${attachment.type}$`, 'i');
      if (!safePath.test(managedPath) || attachment.integrity !== 'readable' || attachment.byteCount < 0
        || attachment.byteCount > MAX_EVIDENCE_BYTES || !/^[\da-f]{64}$/i.test(attachment.sha256))
        fail('EVIDENCE', `${attachment.ref} cannot be included. Replace or remove this missing, corrupt, or invalid evidence entry; no bytes were omitted.`);
      try {
        const parent = await lstat(join(paths.evidence, String(snapshot.package.year)));
        const file = await lstat(join(paths.evidence, managedPath));
        if (!parent.isDirectory() || parent.isSymbolicLink() || !file.isFile() || file.isSymbolicLink()
          || file.size !== attachment.byteCount) throw new Error('Missing, changed, or unsafe managed evidence.');
      } catch (error) {
        fail('EVIDENCE', `${attachment.ref} cannot be included: ${error instanceof Error ? error.message : String(error)}. Replace or remove this entry; no bytes were omitted.`);
      }
      const safeName = portableName(attachment.originalName, attachment.type);
      evidence.push({ attachment, path: `evidence/${attachment.ref}/${safeName}`, sourcePath: join(paths.evidence, managedPath) });
    }
    phase('generating');
    const forms = await generateAnnualForms(snapshot, templates, fail);
    signal.throwIfAborted();
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const formsName = `CCP-${snapshot.package.year}-forms.pdf`;
    const index = [
      `CCP ${snapshot.package.year} — annual portfolio evidence`,
      'Not a restorable full-app backup. Original filenames are JSON-quoted to preserve their metadata.',
      ...evidence.map(file => {
        const activity = snapshot.package.activities.find(activity => activity.id === file.attachment.activityId)!;
        return `${activity.ref} | ${file.attachment.ref} | Original filename: ${JSON.stringify(file.attachment.originalName)} | Archive path: ${file.path}`;
      }),
      '',
    ].join('\n');
    await writeFile(join(staging, formsName), forms.bytes, { flag: 'wx', mode: 0o600 });
    await writeFile(join(staging, 'evidence-index.txt'), index, { flag: 'wx', mode: 0o600 });
    const sources = [
      { path: formsName, sourcePath: join(staging, formsName), byteCount: forms.bytes.byteLength },
      { path: 'evidence-index.txt', sourcePath: join(staging, 'evidence-index.txt'), byteCount: Buffer.byteLength(index) },
      ...evidence.map(file => ({ path: file.path, sourcePath: file.sourcePath,
        byteCount: file.attachment.byteCount, sha256: file.attachment.sha256 })),
    ];
    progress = { ...progress, filesTotal: sources.length, bytesTotal: sources.reduce((total, file) => total + file.byteCount, 0) };
    phase('archiving');
    await writeArchive(partial, sources, files => ({
      kind: 'portfolio', archiveVersion: 1, appId: 'org.swcc.desktop',
      packageId: snapshot.package.id, year: snapshot.package.year, sourceSetId: snapshot.package.sourceSetId,
      createdAt, contentRevision: snapshot.package.contentRevision, dataRevision: snapshot.dataRevision, files,
      attachments: evidence.map(file => {
        const entry = file.attachment;
        return { id: entry.id, packageId: entry.packageId, activityId: entry.activityId,
          ref: entry.ref, originalName: entry.originalName, type: entry.type, importedAt: entry.importedAt,
          ...files.find(inventory => inventory.path === file.path)!,
          activityRef: snapshot.package.activities.find(activity => activity.id === entry.activityId)!.ref };
      }),
    } satisfies PortfolioManifest), (bytes, completed) => {
      progress = { ...progress, bytesCompleted: progress.bytesCompleted + bytes,
        filesCompleted: progress.filesCompleted + Number(completed) };
      report(progress);
    }, signal, system.openOutput);
    signal.throwIfAborted();
    phase('publishing');
    const file = await open(partial, 'r+');
    try { await file.sync(); }
    finally { await file.close(); }
    await rm(staging, { recursive: true });
    await rename(partial, destination);
    return { cancelled: false, fileName: basename(destination), pageCount: forms.pageCount, attachmentCount: evidence.length };
  } catch (error) {
    if (signal.aborted && progress.phase !== 'publishing') return { cancelled: true };
    if (error instanceof ArchiveSourceFailure && error.path.startsWith('evidence/'))
      fail('EVIDENCE', `${error.message}. No bytes were omitted; replace or remove this evidence entry before retrying.`);
    throw error;
  } finally {
    await rm(partial, { force: true });
    await rm(staging, { recursive: true, force: true });
  }
}
