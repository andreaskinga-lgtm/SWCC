import type { Result } from './application.js';

export const REVIEW_DOCUMENT_ID = 'ethics-2018';
export const REVIEW_RESOURCES_URL = 'https://www.ocswssw.org/registrants/continuing-competence-program/';
export const REVIEW_SECTIONS = [
  { id: 'ethics', label: 'Code of Ethics', pages: [2] },
  { id: 'client', label: 'Meaning of Client', pages: [4] },
  { id: 'social-work', label: 'Scope of Practice for Social Work', pages: [7] },
  { id: 'social-service-work', label: 'Scope of Practice for Social Service Work', pages: [8] },
  { id: 'principle-i', label: 'Principle I: Relationship with Clients', pages: [9, 10] },
  { id: 'principle-ii', label: 'Principle II: Competence and Integrity', pages: [11, 12, 13, 14, 15] },
  { id: 'principle-iii', label: 'Principle III: Responsibility to Clients', pages: [16, 17, 18] },
  { id: 'principle-iv', label: 'Principle IV: The Social Work and Social Service Work Record', pages: [19, 20, 21, 22, 23, 24, 25, 26] },
  { id: 'principle-v', label: 'Principle V: Confidentiality', pages: [27, 28, 29, 30, 31] },
  { id: 'principle-vi', label: 'Principle VI: Fees', pages: [32, 33] },
  { id: 'principle-vii', label: 'Principle VII: Advertising', pages: [34, 35, 36, 37] },
  { id: 'principle-viii', label: 'Principle VIII: Sexual Misconduct', pages: [38, 39, 40] },
] as const;
export type ReviewSectionId = typeof REVIEW_SECTIONS[number]['id'];
export interface ReviewProgress {
  visitedPages: number[];
  resourcesLaunchedAt: string | null;
}
export function reviewReadiness(state: ReviewProgress) {
  const sections = REVIEW_SECTIONS.map(section => ({
    ...section, checked: section.pages.every(page => state.visitedPages.includes(page)),
  }));
  const missing = sections.filter(section => !section.checked).map(section => `Review ${section.label}.`);
  if (!state.resourcesLaunchedAt) missing.push('Launch Other required resources in the default browser.');
  return { ready: missing.length === 0, missing, sections };
}
export interface ReviewPosition {
  packageId: string;
  page: number;
  /** Scroll offset as a fraction of the rendered page height. */
  offset: number;
  zoom: number;
}
export interface ReviewState extends ReviewProgress, ReviewPosition {
  documentId: typeof REVIEW_DOCUMENT_ID;
  reviewRevision: number;
  resourcesAvailable: boolean;
  readiness: ReturnType<typeof reviewReadiness>;
}
export interface ReviewOperations {
  getReview(packageId: string): Promise<Result<ReviewState>>;
  saveReviewPosition(position: ReviewPosition): Promise<Result<ReviewState>>;
  recordReviewVisits(input: { packageId: string; pages: number[] }): Promise<Result<ReviewState>>;
  resetReviewSection(input: { packageId: string; sectionId: ReviewSectionId }): Promise<Result<ReviewState>>;
  launchReviewResources(packageId: string): Promise<Result<ReviewState>>;
  resetReviewResources(packageId: string): Promise<Result<ReviewState>>;
  getReviewDocument(): Promise<Result<Uint8Array>>;
}
