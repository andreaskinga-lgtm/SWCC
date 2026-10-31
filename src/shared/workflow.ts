import type { YearPackage } from './application.js';
import { evaluateAssessmentReadiness } from './assessment.js';
import { evaluatePlanReadiness } from './plan.js';
import { reviewReadiness } from './review.js';
import type { ReviewProgress } from './review.js';

export const ANNUAL_STEPS = ['review', 'assessment', 'plan'] as const;
export type AnnualStep = typeof ANNUAL_STEPS[number];
export type PackageStatus = 'Draft' | 'In Progress' | 'Complete';
export interface StepCompletion {
  completedRevision: number | null;
  completedAt: string | null;
}
export interface StepFeedback extends StepCompletion {
  ready: boolean;
  missing: string[];
  relevantRevision: number;
  status: 'Draft' | 'In Progress' | 'Ready' | 'Completed';
}
export interface AnnualWorkflow {
  packageId: string;
  status: PackageStatus;
  steps: Record<AnnualStep, StepFeedback>;
}
export interface CompleteStep {
  packageId: string;
  step: AnnualStep;
  /** The step's relevant revision, not the package content revision. */
  expectedRevision: number;
}
export interface RecordDeclaration {
  packageId: string;
  date: string;
  expectedRevision: number;
  confirmIncomplete?: true;
}
export function relevantRevision(pkg: YearPackage, step: AnnualStep): number {
  return pkg[`${step}Revision`];
}
export function currentCompletion(pkg: YearPackage, step: AnnualStep): boolean {
  const completion = pkg.stepCompletions[step];
  return completion.completedAt !== null && completion.completedRevision === relevantRevision(pkg, step);
}
export function packageStatus(pkg: YearPackage, review: ReviewProgress): PackageStatus {
  if (pkg.declarationDate && ANNUAL_STEPS.every(step => currentCompletion(pkg, step))) return 'Complete';
  return pkg.contentRevision > 0 || pkg.reviewRevision > 0 || review.visitedPages.length > 0
    || review.resourcesLaunchedAt || pkg.declarationDate || ANNUAL_STEPS.some(step => pkg.stepCompletions[step].completedAt)
    ? 'In Progress' : 'Draft';
}
export function evaluateWorkflow(
  pkg: YearPackage,
  review: ReviewProgress,
  today?: string,
  readableEvidenceActivityIds: ReadonlySet<string> = new Set(),
): AnnualWorkflow {
  const checks = {
    review: reviewReadiness(review),
    assessment: evaluateAssessmentReadiness(pkg),
    plan: evaluatePlanReadiness(pkg, today, readableEvidenceActivityIds),
  };
  const progress = {
    review: review.visitedPages.length > 0 || Boolean(review.resourcesLaunchedAt) || pkg.reviewRevision > 0,
    assessment: pkg.assessmentRevision > 0,
    plan: pkg.planRevision > 0,
  };
  const feedback = (step: AnnualStep): StepFeedback => ({
    ...checks[step], ...pkg.stepCompletions[step], relevantRevision: relevantRevision(pkg, step),
    status: currentCompletion(pkg, step) ? 'Completed' : checks[step].ready ? 'Ready' : progress[step] ? 'In Progress' : 'Draft',
  });
  return { packageId: pkg.id, status: packageStatus(pkg, review),
    steps: { review: feedback('review'), assessment: feedback('assessment'), plan: feedback('plan') } };
}
