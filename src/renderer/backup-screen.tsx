import { Download, FolderOpen, HardDrive } from 'lucide-react';
import type { AppState } from '../shared/application.js';
import type { BackupProgress } from '../shared/backup.js';
import './backup.css';

const phaseLabels: Record<BackupProgress['phase'], string> = {
  idle: '', choosing: 'Choose where to save your full backup.',
  waiting: 'Waiting for evidence imports and other active changes to finish.',
  snapshot: 'Taking a consistent snapshot of all years.',
  archiving: 'Writing and verifying the database and original evidence bytes.',
  publishing: 'Publishing the complete archive and recording backup status.',
};

export function BackupScreen({ state, busy, running, progress, backup, cancel }: {
  state: AppState; busy: boolean; running: boolean; progress: BackupProgress;
  backup: () => void; cancel: () => void;
}) {
  const unbacked = state.lastBackupRevision === null || state.dataRevision > state.lastBackupRevision;
  return <>
    <div className="page-heading"><h1>Keep a copy beyond this device.</h1>
      <p>A full-app backup protects every year, its records, review progress, and evidence.</p></div>
    <div className="backup-layout" aria-busy={running}>
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
          <p>Restore will preview a full backup before replacing the entire dataset. It will not merge years.</p>
          <button className="secondary" type="button" disabled>Restore all years</button>
          <p>Restore is not available yet. This build creates full backups but cannot import them. Keep your existing dataset when updating SWCC.</p>
        </section>
      </aside>
    </div>
  </>;
}
