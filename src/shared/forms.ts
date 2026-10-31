import type { YearPackage } from './application.js';
import { ANNUAL_STEPS } from './workflow.js';
import type { AnnualWorkflow } from './workflow.js';

export interface ExportForms {
  packageId: string;
  confirmDraft?: true;
}
export type FormsExportOutcome =
  | { cancelled: true }
  | { cancelled: false; fileName: string; pageCount: number };

export function formsExportWarnings(pkg: YearPackage, workflow: AnnualWorkflow): string[] {
  const missing = ANNUAL_STEPS.flatMap(step => [
    ...workflow.steps[step].missing,
    ...(workflow.steps[step].status !== 'Completed' ? [`Step ${ANNUAL_STEPS.indexOf(step) + 1} is not manually completed.`] : []),
  ]);
  if (!pkg.declarationDate) missing.push('External renewal submission date is not recorded.');
  return missing;
}
