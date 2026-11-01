import { ANNUAL_STANDARDS, validDate } from './application.js';
import type { YearPackage } from './application.js';

export interface AssessmentReadiness {
  ready: boolean;
  missing: string[];
}

export function hasSubstantiveAssessmentContent(record: Pick<
  YearPackage,
  'strengths' | 'peerFeedback' | 'learningNeeds' | 'annualStandards'
>): boolean {
  return record.strengths.trim().length > 0
    || record.peerFeedback.trim().length > 0
    || record.learningNeeds.trim().length > 0
    || record.annualStandards.length > 0;
}

export function evaluateAssessmentReadiness(record: Pick<
  YearPackage,
  'assessmentDate' | 'strengths' | 'learningNeeds' | 'annualStandards' | 'goals'
>): AssessmentReadiness {
  const missing: string[] = [];
  if (!validDate(record.assessmentDate)) missing.push('Enter a valid assessment date.');
  if (!record.strengths.trim()) missing.push('Add your strengths.');
  if (!record.learningNeeds.trim()) missing.push('Describe your learning needs and interests.');
  if (!record.annualStandards.some(id => ANNUAL_STANDARDS.some(standard => standard.id === id))) {
    missing.push('Choose at least one annual standard.');
  }
  if (!record.goals.some(goal => goal.title.trim())) missing.push('Add at least one learning goal.');
  return { ready: missing.length === 0, missing };
}
