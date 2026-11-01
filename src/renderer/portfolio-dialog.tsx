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
    <p>Keep or share one year: complete Forms PDF with readable continuation pages, an evidence index, a portfolio manifest, and every original evidence file.</p>
    <p>Shared and supplementary activities are retained once. This is not a restorable full-app backup and is not encrypted; choose who can access this copy.</p>
    <p>Default name: CCP-{pkg.year}-portfolio.zip. Evidence uses stable E references and portable filenames; original names stay in the index and manifest.</p>
    {missing.length > 0 && <section className="declaration-warning" aria-label="Draft export warning">
      <h3>This annual package is incomplete.</h3>
      <p>You can explicitly export a draft; missing fields stay blank. Application readiness and completion are not College compliance.</p>
      <ul>{missing.map(item => <li key={item}>{item}</li>)}</ul>
    </section>}
    <ProgressFailure monitor={monitor} label="portfolio" />
    {running && <section className="backup-progress" role="status" aria-label="Portfolio export progress">
      <p>{phaseLabels[progress.phase]}</p>
      <p>Editing and deletion are temporarily paused to keep records and evidence consistent. Only a completely written archive is published.</p>
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
    <p>Missing or corrupt managed evidence stops this export. Replace or remove a broken entry in Development plan, then retry; no files are silently omitted.</p>
  </Dialog>;
}
