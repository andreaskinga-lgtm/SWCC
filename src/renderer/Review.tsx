import { useEffect, useRef, useSyncExternalStore } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import type { DesktopOperations } from '../shared/application.js';
import { PdfReader } from './PdfReader.js';
import { ReviewSession } from './review-session.js';
import type { StepFeedback } from '../shared/workflow.js';
import { useActionFeedback } from './action-feedback.js';

export function Review({ packageId, year, operations, session, feedback, complete, busy }: {
  packageId: string; year: number; operations: DesktopOperations; session: ReviewSession;
  feedback: StepFeedback; complete: () => void; busy: boolean;
}) {
  const { showFeedback } = useActionFeedback();
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const state = snapshot.record?.packageId === packageId ? snapshot.record : null;
  const reportedError = useRef<string | null>(null);
  useEffect(() => {
    if (!snapshot.error) {
      reportedError.current = null;
      return;
    }
    if (snapshot.status !== 'Saved' || reportedError.current === snapshot.error) return;
    reportedError.current = snapshot.error;
    showFeedback({
      title: 'Review action could not be completed',
      message: snapshot.error,
      kind: 'error',
    });
  }, [showFeedback, snapshot.error, snapshot.status]);
  return <>
    <div className="page-heading"><h1>Standards review</h1><p>{year} · Code of Ethics and Standards of Practice, Second Edition (September 2018).</p></div>
    {snapshot.error && snapshot.status === 'Not saved' && <section className="error-panel" role="alert"><p>{snapshot.error}</p>
      {snapshot.status === 'Not saved' && <><p>Your pending review changes are retained. Navigation and close wait for a successful retry.</p>
        <button disabled={busy} onClick={() => void (state ? session.retry() : session.open(packageId)).catch(() => {})}>Retry review save</button></>}
    </section>}
    {!state && <p role="status">Opening this year’s review…</p>}
    {state && <div className="review-layout"><aside className="review-sections">
      <h2>Section checklist</h2><p className="quiet">Sections are checked when all their pages are viewed. Confirm completion below.</p>
      <div className="review-list">{state.readiness.sections.map(section => <div className="review-row" key={section.id}>
        <button type="button" className={section.pages.some(page => page === state.page) ? 'reading' : ''}
          aria-label={`${section.label} — ${section.checked ? 'reviewed' : 'not reviewed'}`}
          onClick={() => session.move(section.pages[0], 0, state.zoom)}>
          {section.checked ? <CheckCircle2 size={18} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}
          <span>{section.label}<small>Page{section.pages.length > 1 ? 's' : ''} {section.pages[0]}{section.pages.length > 1 ? `–${section.pages.at(-1)}` : ''}</small></span>
        </button>
        {section.pages.some(page => state.visitedPages.includes(page)) && <button className="reset-section" aria-label={`Reset ${section.label}`}
          disabled={snapshot.status === 'Saving'} onClick={() => session.resetSection(section.id)}>Reset</button>}
      </div>)}</div>
      <section className="resources-row"><h3>Other required resources</h3>
        {state.resourcesAvailable ? <>
          <p>Opens the College website in your browser. Internet access is required.</p>
          <button className="secondary" disabled={snapshot.status === 'Saving'} onClick={() => session.launchResources()}>Open resources</button>
        </> : <p>View page 48 to unlock these resources.</p>}
        {state.resourcesLaunchedAt && <><p className="resources-checked">✓ Default-browser launch recorded: <time dateTime={state.resourcesLaunchedAt}>{new Date(state.resourcesLaunchedAt).toLocaleString()}</time></p>
          <button className="text-button" disabled={snapshot.status === 'Saving'} onClick={() => session.resetResources()}>Reset resources action</button></>}
      </section>
      <section className="review-readiness" aria-label="Step 1 application readiness"><h3>Step 1 · <span role="status" aria-label="Step 1 readiness">{feedback.status}</span></h3>
        {!state.readiness.ready && <ul>{state.readiness.missing.map(item => <li key={item}>{item}</li>)}</ul>}
        {feedback.status === 'Completed' && <p>Rereading does not reopen this step.</p>}
        <button type="button" className="secondary" disabled={busy} aria-label="Complete Step 1" onClick={complete}>
          {feedback.status === 'Completed' ? 'Confirm Step 1 again' : 'Complete Step 1'}
        </button>
      </section>
    </aside><PdfReader key={packageId} operations={operations} position={state} onPosition={(page, offset, zoom) => session.move(page, offset, zoom)} onVisit={page => session.visit(page)} /></div>}
  </>;
}
