export interface DatasetSummary {
  years: number[];
  goals: number;
  activities: number;
  evidenceFiles: number;
}
export interface RestorePreview {
  id: string;
  fileName: string;
  createdAt: string;
  backup: DatasetSummary;
  current: DatasetSummary;
}
export type RestoreInspectionOutcome =
  | { cancelled: true }
  | { cancelled: false; preview: RestorePreview };
export interface RestoreProgress {
  phase: 'idle' | 'choosing' | 'reading' | 'extracting' | 'validating' | 'preview' | 'cleanup'
    | 'protecting' | 'moving' | 'reopening' | 'verifying' | 'recovering';
  filesCompleted: number;
  filesTotal: number;
  bytesCompleted: number;
  bytesTotal: number;
}
export interface ReplaceFullDataset {
  previewId: string;
  confirmed: true;
}
export interface RestoreOutcome {
  state: import('./application.js').AppState;
  protectiveBackup: string;
  cleanupWarning?: string;
}
