export const MAX_BACKUP_MANIFEST_BYTES = 4 * 1024 * 1024;
export const MAX_BACKUP_DATABASE_BYTES = 512 * 1024 * 1024;
export const MAX_BACKUP_FILES = 50_000;

export interface ArchiveFile {
  path: string;
  byteCount: number;
  sha256: string;
}
export interface FullBackupManifest {
  kind: 'full-backup';
  archiveVersion: 1;
  schemaVersion: number;
  appId: 'org.swcc.desktop';
  sourceSetId: string;
  createdAt: string;
  dataRevision: number;
  files: ArchiveFile[];
}
export interface BackupProgress {
  phase: 'idle' | 'choosing' | 'waiting' | 'snapshot' | 'archiving' | 'publishing';
  filesCompleted: number;
  filesTotal: number;
  bytesCompleted: number;
  bytesTotal: number;
}
export type FullBackupOutcome =
  | { cancelled: true }
  | { cancelled: false; fileName: string; createdAt: string; dataRevision: number };
