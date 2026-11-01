import { useState } from 'react';
import type { YearPackage } from '../shared/application.js';
import { dateWarning } from '../shared/application.js';
import { ANNUAL_STEPS } from '../shared/workflow.js';
import type { AnnualStep, AnnualWorkflow } from '../shared/workflow.js';
import { Dialog } from './assessment-screen.js';
import { formsExportWarnings } from '../shared/forms.js';
import { useActionFeedback } from './action-feedback.js';

const labels = { review: 'Review', assessment: 'Self-assessment', plan: 'Development plan' };
export function AnnualWorkflowPanel({ pkg, workflow, busy, navigate, declare, exportForms, exportPortfolio }: {
  pkg: YearPackage; workflow: AnnualWorkflow; busy: boolean;
  navigate: (step: AnnualStep) => void; declare: () => void; exportForms: () => void;
  exportPortfolio: () => void;
}) {
  return <aside className="map-checklist" aria-label="Annual workflow">
    <h2>Close the annual loop</h2><p>Work freely. Complete deliberately.</p>
    <span className="package-status" role="status" aria-label="Annual package status">{workflow.status}</span>
    <ol className="annual-step-list">{ANNUAL_STEPS.map((step, index) => {
      const feedback = workflow.steps[step];
      return <li className="annual-step" key={step}>
        <div className="annual-step-heading"><span className="step-number">{index + 1}</span>
          <button className="text-button" disabled={busy} onClick={() => navigate(step)}>{labels[step]}</button></div>
        <span className={`readiness-status ${feedback.ready ? 'ready' : ''}`} role="status" aria-label={`Step ${index + 1} readiness`}>{feedback.status}</span>
        {feedback.missing.length ? <ul className="workflow-missing" aria-label={`Step ${index + 1} missing items`}>
          {feedback.missing.map(item => <li key={item}>{item}</li>)}
        </ul> : <p>All application readiness items are present.</p>}
        {feedback.completedAt && <small>{feedback.status === 'Completed' ? 'Manually confirmed' : 'Previous confirmation; relevant edits reopened this step'}:
          {' '}<time dateTime={feedback.completedAt}>{new Date(feedback.completedAt).toLocaleString()}</time></small>}
      </li>;
    })}</ol>
    <section className="declaration-card"><h3>External renewal declaration</h3>
      <p>{pkg.declarationDate ? `Submission date recorded: ${pkg.declarationDate}` : 'Record the actual date after submitting through the College’s renewal process.'}</p>
      {pkg.declarationRecordedAt && <small>Recorded in the app (UTC): <time dateTime={pkg.declarationRecordedAt}>{pkg.declarationRecordedAt}</time>. Separate from the external submission date; later edits preserve this record.</small>}
      <button className="text-button" disabled={busy} onClick={declare}>{pkg.declarationDate ? 'Edit recorded date' : 'Record submission date'}</button>
    </section>
    <div className="annual-export-controls" aria-label="Annual exports">
      <button type="button" className="secondary" disabled={busy} onClick={exportForms}>Export Forms PDF</button>
      <button type="button" className="secondary" disabled={busy} onClick={exportPortfolio}>Export Complete Portfolio ZIP</button>
    </div>
    <p className="workflow-source">Application readiness and manual completion only. Supplied ethics: Second Edition / September 2018; assessment tool: Third Edition / 2023 reference. Not verification of current College compliance.</p>
  </aside>;
}

export function FormsExportDialog({ pkg, workflow, busy, exportForms, close }: {
  pkg: YearPackage; workflow: AnnualWorkflow; busy: boolean;
  exportForms: (draft: boolean) => void; close: () => void;
}) {
  const missing = formsExportWarnings(pkg, workflow);
  return <Dialog title="Export annual forms" onClose={() => { if (!busy) close(); }}>
    <p>Export the review checklist, one annual self-assessment (SAT), and one annual development plan (PDP) in the supplied layouts.</p>
    <p>Long narratives use readable continuation pages in the same layouts, without repeating their content. Evidence files are referenced, not embedded. This is not a restorable full-app backup.</p>
    {missing.length > 0 && <section className="declaration-warning" aria-label="Draft export warning">
      <h3>This annual package is incomplete.</h3>
      <p>You can explicitly export a draft; missing fields stay blank. Application readiness and completion are not College compliance.</p>
      <ul>{missing.map(item => <li key={item}>{item}</li>)}</ul>
    </section>}
    {busy && <p role="status">Exporting Forms PDF… Finish or cancel the destination dialog; wait for the complete write.</p>}
    <div className="goal-dialog-actions">
      <button type="button" className="secondary" disabled={busy} onClick={close}>Cancel</button>
      <button type="button" disabled={busy} onClick={() => exportForms(missing.length > 0)}>
        {missing.length ? 'Export draft PDF' : 'Export PDF'}
      </button>
    </div>
    <p>For original evidence bytes, use the dashboard’s separate Complete Portfolio ZIP action.</p>
  </Dialog>;
}

export function DeclarationDialog({ pkg, incomplete, busy, save, close }: {
  pkg: YearPackage; incomplete: boolean; busy: boolean;
  save: (date: string, warned: boolean) => Promise<void>; close: () => void;
}) {
  const { showFeedback } = useActionFeedback();
  const [date, setDate] = useState(pkg.declarationDate ?? '');
  const warning = dateWarning(date, pkg.year);
  async function submit() {
    try { await save(date, incomplete); }
    catch (failure) {
      showFeedback({
        title: 'Could not record external submission date',
        message: failure instanceof Error ? failure.message : String(failure),
        kind: 'error',
      });
    }
  }
  return <Dialog title="Record external submission date" onClose={() => { if (!busy) close(); }}>
    <p>Enter the date you actually submitted through the College’s renewal process. SWCC does not submit or verify renewal declarations.</p>
    {incomplete && <p className="declaration-warning" role="alert">Your application steps are incomplete. You may still record an external submission that already happened; recording it does not complete any application step.</p>}
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label className="field"><span>Actual external submission date</span><input autoFocus type="date" required
        value={date} disabled={busy} onChange={event => setDate(event.target.value)} /></label>
      {warning && <p className="warning">{warning}</p>}
      {pkg.declarationRecordedAt && <p>Previously recorded in the app (UTC): {pkg.declarationRecordedAt}. This timestamp is separate from the actual submission date.</p>}
      <div className="goal-dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={close}>Cancel</button>
        <button type="submit" disabled={busy}>Record submission date</button></div>
    </form>
  </Dialog>;
}
