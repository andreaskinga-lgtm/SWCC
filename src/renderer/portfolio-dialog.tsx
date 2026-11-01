import type { YearPackage } from '../shared/application.js';
import type { AnnualWorkflow } from '../shared/workflow.js';
import type { PortfolioProgress } from '../shared/portfolio.js';
import { formsExportWarnings } from '../shared/forms.js';
import { Dialog } from './assessment-screen.js';
import { ProgressFailure, type ProgressMonitor } from './operation-progress.js';

const phaseLabels: Record<PortfolioProgress['phase'], string> = {
  idle: 'Preparing annual portfolio.',
  choosing: 'Choose where to save your annual portfolio; use the destination dialog’s Cancel to stop.',
  waiting: 'Waiting for active evidence imports and other changes to finish.',
  snapshot: 'Capturing one consistent annual record.',
  generating: 'Generating complete forms with readable continuation pages.',
  archiving: 'Writing and verifying the forms, index, and original evidence bytes.',
  publishing: 'Publishing the complete portfolio ZIP.',
};

export function PortfolioExportDialog({ pkg, workflow, busy, running, progress, exportPortfolio, cancel, close, monitor }: {
  pkg: YearPackage; workflow: AnnualWorkflow; busy: boolean; running: boolean; progress: PortfolioProgress;
  exportPortfolio: (draft: boolean) => void; cancel: () => void; close: () => void;
  monitor: ProgressMonitor;
}) {
  const missing = formsExportWarnings(pkg, workflow);
  return <Dialog title="Export complete annual portfolio" onClose={() => { if (!busy) close(); }}>
    <p>Includes the {pkg.year} forms PDF, evidence index, manifest, and original evidence files.</p>
    <p>This is not a restorable full-app backup and is not encrypted. Share it only with people who should have access to your records.</p>
    {missing.length > 0 && <section className="declaration-warning" aria-label="Draft export warning">
      <h3>Incomplete annual package</h3>
      <p>Export a draft with missing fields left blank. This does not verify College compliance.</p>
      <ul>{missing.map(item => <li key={item}>{item}</li>)}</ul>
    </section>}
    <ProgressFailure monitor={monitor} label="portfolio" />
    {running && <section className="backup-progress" role="status" aria-label="Portfolio export progress">
      <p>{phaseLabels[progress.phase]}</p>
      <p>Editing and deletion are paused during export.</p>
      {progress.bytesTotal > 0 && <>
        <progress aria-label="Portfolio bytes written" max={progress.bytesTotal} value={progress.bytesCompleted} />
        <p>{progress.filesCompleted} of {progress.filesTotal} files verified · {Math.round(progress.bytesCompleted / 1024)} of {Math.round(progress.bytesTotal / 1024)} KiB read</p>
      </>}
      <button type="button" className="secondary" disabled={progress.phase === 'publishing'} onClick={cancel}>Cancel portfolio export</button>
    </section>}
    <div className="goal-dialog-actions">
      <button type="button" className="secondary" disabled={busy} onClick={close}>Cancel</button>
      <button type="button" disabled={busy} onClick={() => exportPortfolio(missing.length > 0)}>
        {missing.length ? 'Export draft ZIP' : 'Export ZIP'}
      </button>
    </div>
    <p>Replace or remove missing or corrupt evidence files in Development plan before exporting.</p>
  </Dialog>;
}
