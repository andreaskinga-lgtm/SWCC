export const SOURCE_SET_ID = 'swcc-supplied-2018-2026-v1';
export const SOURCE_DOCUMENTS = [
  { id: 'ethics-2018', file: 'ethics-2018.pdf', title: 'Code of Ethics and Standards of Practice — Second Edition, amended September 2018' },
  { id: 'step-one', file: 'step-one.pdf', title: 'Step One review checklist' },
  { id: 'assessment-2026', file: 'assessment-2026.pdf', title: '2026 assessment tool — references Third Edition / 2023' },
] as const;

export interface Draft {
  assessmentDate: string;
  planDate: string;
  strengths: string;
  peerFeedback: string;
  learningNeeds: string;
}
export interface YearPackage extends Draft {
  id: string;
  year: number;
  sourceSetId: string;
  contentRevision: number;
  assessmentRevision: number;
  planRevision: number;
  createdAt: string;
  updatedAt: string;
}
export interface YearSummary {
  id: string;
  year: number;
  contentRevision: number;
}
export interface AppState {
  years: YearSummary[];
  selectedPackage: YearPackage | null;
  acknowledgedAt: string | null;
  schemaVersion: number;
  dataRevision: number;
  storageDirectory: string;
  lastBackupAt: string | null;
  lastBackupRevision: number | null;
}
export interface OperationError {
  code: 'VALIDATION' | 'DUPLICATE_YEAR' | 'NOT_FOUND' | 'CONFLICT' | 'STORAGE' | 'IPC';
  message: string;
  existingPackageId?: string;
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: OperationError };
export interface SaveDraft {
  packageId: string;
  expectedRevision: number;
  draft: Draft;
}
export interface ApplicationOperations {
  getState(): Promise<Result<AppState>>;
  createYear(year: number): Promise<Result<YearPackage>>;
  openYear(packageId: string): Promise<Result<YearPackage>>;
  saveDraft(input: SaveDraft): Promise<Result<YearPackage>>;
  acknowledgeStorage(): Promise<Result<AppState>>;
}
export interface DesktopOperations extends ApplicationOperations {
  onCloseRequested(handler: () => void): () => void;
  completeClose(): Promise<Result<void>>;
}

export function localDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
export function dateWarning(value: string, year: number): string | null {
  return validDate(value) && Number(value.slice(0, 4)) !== year
    ? `This date is outside ${year}. You can keep it for backfilled work.` : null;
}
