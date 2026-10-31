export const SOURCE_SET_ID = 'swcc-supplied-2018-2026-v1';
export const SOURCE_DOCUMENTS = [
  { id: 'ethics-2018', file: 'ethics-2018.pdf', title: 'Code of Ethics and Standards of Practice — Second Edition, amended September 2018' },
  { id: 'step-one', file: 'step-one.pdf', title: 'Step One review checklist' },
  { id: 'assessment-2026', file: 'assessment-2026.pdf', title: '2026 assessment tool — references Third Edition / 2023' },
] as const;

export const ANNUAL_STANDARDS = [
  { id: 'code-of-ethics', label: 'Code of Ethics' },
  { id: 'meaning-of-client', label: 'Meaning of Client' },
  { id: 'social-work-scope', label: 'Scope of Practice for Social Work' },
  { id: 'social-service-work-scope', label: 'Scope of Practice for Social Service Work' },
  { id: 'principle-i', label: 'Principle I: Relationship with Clients' },
  { id: 'principle-ii', label: 'Principle II: Competence and Integrity' },
  { id: 'principle-iii', label: 'Principle III: Responsibility to Clients' },
  { id: 'principle-iv', label: 'Principle IV: The Social Work and Social Service Work Record' },
  { id: 'principle-v', label: 'Principle V: Confidentiality' },
  { id: 'principle-vi', label: 'Principle VI: Fees' },
  { id: 'principle-vii', label: 'Principle VII: Advertising' },
  { id: 'principle-viii', label: 'Principle VIII: Sexual Misconduct' },
] as const;
export type AnnualStandardId = (typeof ANNUAL_STANDARDS)[number]['id'];

export interface Draft {
  assessmentDate: string;
  planDate: string;
  strengths: string;
  peerFeedback: string;
  learningNeeds: string;
  annualStandards: AnnualStandardId[];
}
export interface YearSummary {
  id: string;
  year: number;
  contentRevision: number;
  status: import('./workflow.js').PackageStatus;
}
export interface Goal {
  id: string;
  packageId: string;
  ref: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}
export type ActivityStatus = 'Planned' | 'In Progress' | 'Completed';
export interface ActivityFields {
  title: string;
  description: string;
  status: ActivityStatus;
  completionDate: string;
  evidenceDescription: string;
  evidenceLinks: string[];
  applicationToPractice: string;
  goalIds: string[];
}
export interface Activity extends ActivityFields {
  id: string;
  packageId: string;
  ref: string;
  createdAt: string;
  updatedAt: string;
}
export type EvidenceIntegrity = 'readable' | 'missing' | 'corrupt' | 'unreadable';
export interface EvidenceAttachment {
  id: string;
  packageId: string;
  activityId: string;
  ref: string;
  originalName: string;
  type: string;
  byteCount: number;
  sha256: string;
  importedAt: string;
  integrity: EvidenceIntegrity;
}
export type EvidenceImportOutcome =
  | { cancelled: true }
  | { cancelled: false; package: YearPackage; attachment: EvidenceAttachment };
export interface EvidenceRequest {
  packageId: string;
  activityId: string;
  expectedRevision: number;
}
export interface ReplaceEvidenceRequest extends EvidenceRequest {
  evidenceId: string;
}
export interface EvidenceActionRequest {
  packageId: string;
  activityId: string;
  evidenceId: string;
}
export interface RemoveEvidenceRequest extends EvidenceActionRequest {
  expectedRevision: number;
}
export interface EvidencePreview {
  ref: string;
  originalName: string;
  type: string;
  data: Uint8Array;
}
export interface CreateActivity extends Partial<ActivityFields> {
  packageId: string;
  expectedRevision: number;
  title: string;
}
export interface UpdateActivity extends Partial<ActivityFields> {
  packageId: string;
  expectedRevision: number;
  activityId: string;
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
  code: 'VALIDATION' | 'DUPLICATE_YEAR' | 'NOT_FOUND' | 'CONFLICT' | 'STORAGE' | 'IPC' | 'BROWSER' | 'INACTIVE' | 'CONFIRMATION_REQUIRED'
    | 'UNSUPPORTED_FILE' | 'FILE_TOO_LARGE' | 'UNREADABLE' | 'EVIDENCE' | 'OPEN' | 'NOT_READY';
  message: string;
  existingPackageId?: string;
  committed?: boolean;
  recoveryPath?: string;
  missing?: string[];
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: OperationError };
export interface SaveDraft {
  packageId: string;
  expectedRevision: number;
  draft: Draft;
}
export interface CreateGoal {
  packageId: string;
  expectedRevision: number;
  title: string;
  description?: string;
  activityId?: string;
}
export interface UpdateGoal {
  packageId: string;
  goalId: string;
  expectedRevision: number;
  title?: string;
  description?: string;
}
export interface DeleteGoal {
  packageId: string;
  goalId: string;
  expectedRevision: number;
  confirmed: true;
}
export interface DeleteActivity {
  packageId: string;
  activityId: string;
  expectedRevision: number;
  confirmed: true;
}
export interface DeleteYear {
  packageId: string;
  expectedRevision: number;
  confirmed: true;
}
export interface YearPackage extends Draft {
  id: string;
  year: number;
  sourceSetId: string;
  contentRevision: number;
  assessmentRevision: number;
  planRevision: number;
  reviewRevision: number;
  stepCompletions: Record<import('./workflow.js').AnnualStep, import('./workflow.js').StepCompletion>;
  declarationDate: string | null;
  declarationRecordedAt: string | null;
  createdAt: string;
  updatedAt: string;
  goals: Goal[];
  activities: Activity[];
}
export interface ApplicationOperations extends ReviewOperations {
  getWorkflow(packageId: string): Promise<Result<import('./workflow.js').AnnualWorkflow>>;
  completeStep(input: import('./workflow.js').CompleteStep): Promise<Result<YearPackage>>;
  recordDeclaration(input: import('./workflow.js').RecordDeclaration): Promise<Result<YearPackage>>;
  getState(): Promise<Result<AppState>>;
  createYear(year: number): Promise<Result<YearPackage>>;
  openYear(packageId: string): Promise<Result<YearPackage>>;
  saveDraft(input: SaveDraft): Promise<Result<YearPackage>>;
  createGoal(input: CreateGoal): Promise<Result<YearPackage>>;
  updateGoal(input: UpdateGoal): Promise<Result<YearPackage>>;
  deleteGoal(input: DeleteGoal): Promise<Result<YearPackage>>;
  createActivity(input: CreateActivity): Promise<Result<YearPackage>>;
  updateActivity(input: UpdateActivity): Promise<Result<YearPackage>>;
  deleteActivity(input: DeleteActivity): Promise<Result<YearPackage>>;
  deleteYear(input: DeleteYear): Promise<Result<AppState>>;
  getPlanReadiness(packageId: string): Promise<Result<import('./plan.js').PlanReadiness>>;
  openEvidenceLink(input: { packageId: string; activityId: string; url: string }): Promise<Result<void>>;
  getEvidence(packageId: string): Promise<Result<EvidenceAttachment[]>>;
  importEvidence(input: EvidenceRequest): Promise<Result<EvidenceImportOutcome>>;
  replaceEvidence(input: ReplaceEvidenceRequest): Promise<Result<EvidenceImportOutcome>>;
  removeEvidence(input: RemoveEvidenceRequest): Promise<Result<YearPackage>>;
  previewEvidence(input: EvidenceActionRequest): Promise<Result<EvidencePreview>>;
  openEvidence(input: EvidenceActionRequest): Promise<Result<void>>;
  acknowledgeStorage(): Promise<Result<AppState>>;
}
export interface DesktopOperations extends ApplicationOperations {
  getReaderActive(): Promise<Result<boolean>>;
  onReaderActiveChanged(handler: (active: boolean) => void): () => void;
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
import type { ReviewOperations } from './review.js';
