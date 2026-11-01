import { Download, FolderOpen, HardDrive } from 'lucide-react';
import type { AppState } from '../shared/application.js';
import type { BackupProgress } from '../shared/backup.js';
import type { DatasetSummary, RestorePreview, RestoreProgress } from '../shared/restore.js';
import { Dialog } from './assessment-screen.js';
import { ProgressFailure, type ProgressMonitor } from './operation-progress.js';
import './backup.css';

const phaseLabels: Record<BackupProgress['phase'], string> = {
  idle: '', choosing: 'Choose where to save your full backup.',
  waiting: 'Waiting for evidence imports and other active changes to finish.',
  snapshot: 'Taking a consistent snapshot of all years.',
  archiving: 'Writing and verifying the database and original evidence bytes.',
  publishing: 'Publishing the complete archive and recording backup status.',
};

const restoreLabels: Record<RestoreProgress['phase'], string> = {
  idle: '', choosing: 'Choose a full backup to inspect.', reading: 'Reading the manifest and checking the ZIP inventory.',
  extracting: 'Extracting and verifying bytes in private staging, outside your live dataset.',
  validating: 'Checking database integrity, record ownership and managed evidence.',
  preview: 'Backup validated for preview. No records have been restored.',
  cleanup: 'Staged inspection files could not be removed. Check folder permissions and retry cleanup.',
  protecting: 'Creating and independently validating a protective full backup of the current dataset.',
  moving: 'Replacing the closed database and evidence together. Do not force quit.',
  reopening: 'Opening the replacement dataset.',
  verifying: 'Verifying restored database, sources, references, relationships and original evidence.',
  recovering: 'Recovering your prior usable dataset. Replacement has not succeeded.',
};

export function BackupScreen({ state, busy, running, progress, backup, cancel, inspect, inspecting, replacing, restoreProgress, cancelInspection, backupMonitor, restoreMonitor }: {
  state: AppState; busy: boolean; running: boolean; progress: BackupProgress;
  backup: () => void; cancel: () => void;
  inspect: () => void; inspecting: boolean; replacing: boolean; restoreProgress: RestoreProgress; cancelInspection: () => void;
  backupMonitor: ProgressMonitor; restoreMonitor: ProgressMonitor;
}) {
  const unbacked = state.lastBackupRevision === null || state.dataRevision > state.lastBackupRevision;
  return <>
    <div className="page-heading"><h1>Keep a copy beyond this device.</h1>
      <p>A full-app backup protects every year, its records, review progress, and evidence.</p></div>
    <div className="backup-layout" aria-busy={running || inspecting}>
      <section className="backup-main surface">
        <div className="backup-illustration" aria-hidden="true"><HardDrive size={46} /><span /><FolderOpen size={38} /></div>
        <h2>Your whole portfolio, together.</h2>
        <p>Choose a location outside SWCC’s storage, such as an external drive. There is no automatic cloud sync.
          Keep the backup somewhere safe: it contains your records and original evidence and is not encrypted.</p>
        <p className="backup-summary">{state.years.length} year {state.years.length === 1 ? 'package' : 'packages'} · All records and managed evidence</p>
        <button type="button" disabled={busy} onClick={backup}><Download size={18} aria-hidden="true" />Create full backup</button>
        {running && <section className="backup-progress" role="status" aria-label="Backup progress">
          <p>{phaseLabels[progress.phase] || 'Preparing full backup.'}</p>
          <p>Editing and deletion are temporarily paused to keep this copy consistent.</p>
          {progress.bytesTotal > 0 && <>
            <progress aria-label="Full backup bytes written" max={progress.bytesTotal} value={progress.bytesCompleted} />
            <p>{progress.filesCompleted} of {progress.filesTotal} files checked · {Math.round(progress.bytesCompleted / 1024)} of {Math.round(progress.bytesTotal / 1024)} KiB read</p>
          </>}
          <button className="secondary" type="button" disabled={progress.phase === 'publishing'} onClick={cancel}>Cancel backup</button>
        </section>}
        <ProgressFailure monitor={backupMonitor} label="backup" />
        <h3>Local storage</h3><p className="storage-path">{state.storageDirectory}</p>
        <p className="backup-note">SWCC publishes only a complete ZIP. Missing or changed evidence stops the backup; no files are silently omitted.</p>
      </section>
      <aside>
        <section className="backup-state">
          <h2>Backup status</h2>
          <div role="status" aria-label="Backup status">
            <p>{state.lastBackupAt ? <>Last successful full backup: <time dateTime={state.lastBackupAt}>{new Date(state.lastBackupAt).toLocaleString()}</time></>
              : 'No successful full backup recorded.'}</p>
            <p className="backup-indicator">{unbacked ? 'Changes not backed up' : 'No changes since the last full backup.'}</p>
          </div>
          <p>Annual portfolio exports are not restorable full-app backups. Remember to create another full backup after making changes.</p>
        </section>
        <section className="restore-entry">
          <h2>Restore all years</h2>
          <p>Inspect a full backup and compare it with the entire current dataset. Restore replaces all years; it does not merge them.</p>
          <button className="secondary" type="button" disabled={busy} onClick={inspect}>Preview full backup</button>
          <p>Inspection does not change live records. Only explicit confirmation replaces them, after a verified protective full backup.</p>
          {restoreProgress.phase === 'cleanup' && <button className="secondary" type="button" disabled={busy} onClick={cancelInspection}>Retry staging cleanup</button>}
          {inspecting && <section className="backup-progress" role="status" aria-label={replacing ? 'Restore progress' : 'Inspection progress'}>
            <p>{restoreLabels[restoreProgress.phase] || 'Preparing backup inspection.'}</p>
            {restoreProgress.filesTotal > 0 && <>
              <progress aria-label={replacing ? 'Protective backup bytes checked' : 'Backup bytes inspected'} max={Math.max(1, restoreProgress.bytesTotal)} value={restoreProgress.bytesCompleted} />
              <p>{restoreProgress.filesCompleted} of {restoreProgress.filesTotal} files checked · {Math.round(restoreProgress.bytesCompleted / 1024)} KiB read</p>
            </>}
            {!replacing && <button className="secondary" type="button" onClick={cancelInspection}>Cancel inspection</button>}
          </section>}
          <ProgressFailure monitor={restoreMonitor} label="restore" />
        </section>
      </aside>
    </div>
  </>;
}

function Summary({ summary }: { summary: DatasetSummary }) {
  return <>
    <p>Years: {summary.years.length ? summary.years.join(', ') : 'None'}</p>
    <p>{summary.goals} goals · {summary.activities} activities · {summary.evidenceFiles} evidence files</p>
  </>;
}
export function RestorePreviewDialog({ preview, busy, replacing, progress, cancel, replace, monitor }: {
  preview: RestorePreview; busy: boolean; replacing: boolean; progress: RestoreProgress; cancel: () => void; replace: () => void;
  monitor: ProgressMonitor;
}) {
  return <Dialog title="Preview full-app restore" className="goal-dialog restore-dialog" onClose={() => { if (!busy) cancel(); }}>
    <p className="storage-path">{preview.fileName}</p>
    <div className="restore-compare">
      <section><h3>Validated full backup</h3>
        <p>Created: <time dateTime={preview.createdAt}>{new Date(preview.createdAt).toLocaleString()}</time></p>
        <Summary summary={preview.backup} />
      </section>
      <section><h3>Current dataset to be replaced</h3><Summary summary={preview.current} /></section>
    </div>
    <p className="warning">Restore replaces the entire dataset, not merge or resolve duplicate years.
      {!replacing && ' No records have been restored.'} Confirm only if you want the validated backup to replace every current year.
      SWCC first creates and verifies a protective full backup, then retains your prior data until replacement passes full validation.</p>
    {replacing && <section role="status" aria-label="Replacement progress" className="backup-progress">
      <p>{restoreLabels[progress.phase] || 'Preparing recoverable replacement.'}</p>
      <p>Editing, deletion and close are paused. Wait for validation or recovery; do not force quit.</p>
    </section>}
    <ProgressFailure monitor={monitor} label="restore" />
    <div className="goal-dialog-actions">
      <button className="secondary" type="button" disabled={busy} onClick={cancel}>Cancel, keep current data</button>
      <button type="button" disabled={busy} onClick={replace}>Replace all years</button>
    </div>
  </Dialog>;
}
