import { localDate, validDate } from './application.js';
import type { ActivityFields, YearPackage } from './application.js';

export function activityDateError(activity: Pick<ActivityFields, 'status' | 'completionDate'>, today = localDate()): string | null {
  if (activity.completionDate && !validDate(activity.completionDate)) return 'Use a valid completion date in YYYY-MM-DD format.';
  if (activity.status === 'Completed') {
    if (!validDate(activity.completionDate)) return 'Completed activities require an actual completion date.';
    if (activity.completionDate > today) return 'The completion date cannot be in the future.';
  }
  return null;
}
export function validEvidenceLink(value: string): boolean {
  try {
    if (value !== value.trim() || !/^https?:\/\//i.test(value) || /[\s\\]/.test(value)) return false;
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export interface PlanReadiness {
  ready: boolean;
  missing: string[];
}

export function evaluatePlanReadiness(
  pkg: Pick<YearPackage, 'planDate' | 'goals' | 'activities'>,
  today = localDate(),
  readableEvidenceActivityIds: ReadonlySet<string> = new Set(),
): PlanReadiness {
  const missing: string[] = [];
  if (!validDate(pkg.planDate)) missing.push('Enter a valid plan date.');
  if (!pkg.goals.some(goal => goal.title.trim())) missing.push('Add at least one learning goal.');
  for (const goal of pkg.goals) {
    if (!pkg.activities.some(activity => activity.goalIds.includes(goal.id) && activity.status === 'Completed' && !activityDateError(activity, today)))
      missing.push(`${goal.ref} needs completed supporting work.`);
  }
  for (const activity of pkg.activities.filter(activity => activity.goalIds.length > 0)) {
    if (activity.status !== 'Completed') missing.push(`${activity.ref} must be Completed.`);
    const dateError = activityDateError(activity, today);
    if (dateError) missing.push(`${activity.ref}: ${dateError}`);
    if (!activity.evidenceDescription.trim() && !activity.evidenceLinks.some(validEvidenceLink) && !readableEvidenceActivityIds.has(activity.id))
      missing.push(`${activity.ref} needs evidence notes, a valid link, or a readable evidence file.`);
    if (!activity.applicationToPractice.trim()) missing.push(`${activity.ref} needs an application-to-practice reflection.`);
  }
  return { ready: missing.length === 0, missing };
}
