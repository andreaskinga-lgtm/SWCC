export interface DatasetSummary {
  years: number[];
  goals: number;
  activities: number;
  evidenceFiles: number;
}
export interface RestorePreview {
  fileName: string;
  createdAt: string;
  backup: DatasetSummary;
  current: DatasetSummary;
}
export type RestoreInspectionOutcome =
  | { cancelled: true }
  | { cancelled: false; preview: RestorePreview };
export interface RestoreProgress {
  phase: 'idle' | 'choosing' | 'reading' | 'extracting' | 'validating' | 'preview' | 'cleanup';
  filesCompleted: number;
  filesTotal: number;
  bytesCompleted: number;
  bytesTotal: number;
}
