import type { EvidenceAttachment } from './application.js';
import type { ArchiveFile } from './backup.js';
import type { BackupProgress } from './backup.js';

export interface PortfolioProgress extends Omit<BackupProgress, 'phase'> {
  phase: BackupProgress['phase'] | 'generating';
}

export interface PortfolioAttachment extends Omit<EvidenceAttachment, 'integrity'>, ArchiveFile {
  activityRef: string;
}
export interface PortfolioManifest {
  kind: 'portfolio';
  archiveVersion: 1;
  appId: 'org.swcc.desktop';
  year: number;
  packageId: string;
  sourceSetId: string;
  createdAt: string;
  contentRevision: number;
  dataRevision: number;
  files: ArchiveFile[];
  attachments: PortfolioAttachment[];
}
export type PortfolioExportOutcome =
  | { cancelled: true }
  | { cancelled: false; fileName: string; pageCount: number; attachmentCount: number };
