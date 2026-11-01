import { Download, FolderOpen, HardDrive } from 'lucide-react';
import type { AppState } from '../shared/application.js';
import type { BackupProgress } from '../shared/backup.js';
import type { DatasetSummary, RestorePreview, RestoreProgress } from '../shared/restore.js';
import { Dialog } from './assessment-screen.js';
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
};

export function BackupScreen({ state, busy, running, progress, backup, cancel, inspect, inspecting, restoreProgress, cancelInspection }: {
  state: AppState; busy: boolean; running: boolean; progress: BackupProgress;
  backup: () => void; cancel: () => void;
  inspect: () => void; inspecting: boolean; restoreProgress: RestoreProgress; cancelInspection: () => void;
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
          <p>Inspection does not change live records. Replacement is not available in this build. Keep your existing dataset when updating SWCC.</p>
          {restoreProgress.phase === 'cleanup' && <button className="secondary" type="button" disabled={busy} onClick={cancelInspection}>Retry staging cleanup</button>}
          {inspecting && <section className="backup-progress" role="status" aria-label="Inspection progress">
            <p>{restoreLabels[restoreProgress.phase] || 'Preparing backup inspection.'}</p>
            {restoreProgress.filesTotal > 0 && <>
              <progress aria-label="Backup bytes inspected" max={Math.max(1, restoreProgress.bytesTotal)} value={restoreProgress.bytesCompleted} />
              <p>{restoreProgress.filesCompleted} of {restoreProgress.filesTotal} files checked · {Math.round(restoreProgress.bytesCompleted / 1024)} KiB read</p>
            </>}
            <button className="secondary" type="button" onClick={cancelInspection}>Cancel inspection</button>
          </section>}
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
export function RestorePreviewDialog({ preview, busy, error, cancel }: { preview: RestorePreview; busy: boolean; error: string | null; cancel: () => void }) {
  return <Dialog title="Preview full-app restore" className="goal-dialog restore-dialog" onClose={() => { if (!busy) cancel(); }}>
    <p className="storage-path">{preview.fileName}</p>
    <div className="restore-compare">
      <section><h3>Validated full backup</h3>
        <p>Created: <time dateTime={preview.createdAt}>{new Date(preview.createdAt).toLocaleString()}</time></p>
        <Summary summary={preview.backup} />
      </section>
      <section><h3>Current dataset to be replaced</h3><Summary summary={preview.current} /></section>
    </div>
    <p className="warning">Restore would replace the entire dataset, not merge or resolve duplicate years.
      No records have been restored. Replacement is unavailable until recoverable restore is implemented.</p>
    {error && <p className="goal-validation" role="alert">{error}</p>}
    <div className="goal-dialog-actions">
      <button className="secondary" type="button" disabled={busy} onClick={cancel}>Cancel, keep current data</button>
      <button type="button" disabled>Replace all years</button>
    </div>
  </Dialog>;
}
