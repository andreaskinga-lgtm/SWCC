import { useSyncExternalStore } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import type { DesktopOperations } from '../shared/application.js';
import { PdfReader } from './PdfReader.js';
import { ReviewSession } from './review-session.js';
import type { StepFeedback } from '../shared/workflow.js';

export function Review({ packageId, year, operations, session, feedback, complete, busy }: {
  packageId: string; year: number; operations: DesktopOperations; session: ReviewSession;
  feedback: StepFeedback; complete: () => void; busy: boolean;
}) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const state = snapshot.record?.packageId === packageId ? snapshot.record : null;
  return <>
    <div className="page-heading"><h1>Review the standards.</h1><p>{year} · Supplied Second Edition, amended September 7, 2018. Resume, browse, or revisit any section.</p></div>
    {snapshot.error && <section className="error-panel" role="alert"><p>{snapshot.error}</p>
      {snapshot.status === 'Not saved' && <><p>Your pending review changes are retained. Navigation and close wait for a successful retry.</p>
        <button onClick={() => void (state ? session.flush() : session.open(packageId)).catch(() => {})}>Retry review save</button></>}
    </section>}
    {!state && <p role="status">Opening this year’s review…</p>}
    {state && <div className="review-layout"><aside className="review-sections">
      <h2>Section checklist</h2><p className="quiet">Every mapped page must appear in the active reader. Checks are automatic; step completion needs your manual confirmation.</p>
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
          <p>The College website needs internet access. Launching it proves neither loading nor reading.</p>
          <button className="secondary" disabled={snapshot.status === 'Saving'} onClick={() => session.launchResources()}>Open resources</button>
        </> : <p>Available after physical page 48 actually appears in the active reader. Skipped sections stay unchecked.</p>}
        {state.resourcesLaunchedAt && <><p className="resources-checked">✓ Default-browser launch recorded: <time dateTime={state.resourcesLaunchedAt}>{new Date(state.resourcesLaunchedAt).toLocaleString()}</time></p>
          <button className="text-button" disabled={snapshot.status === 'Saving'} onClick={() => session.resetResources()}>Reset resources action</button></>}
      </section>
      <section className="review-readiness" aria-label="Step 1 application readiness"><h3>Step 1 · <span role="status" aria-label="Step 1 readiness">{feedback.status}</span></h3>
        {state.readiness.ready ? <p>{feedback.status === 'Completed' ? 'You manually confirmed this step. Ordinary rereading does not reopen it.' : 'Ready for your manual confirmation; not marked Completed.'}</p>
          : <ul>{state.readiness.missing.map(item => <li key={item}>{item}</li>)}</ul>}
        <button type="button" className="secondary" disabled={busy} aria-label="Complete Step 1" onClick={complete}>
          {feedback.status === 'Completed' ? 'Confirm Step 1 again' : 'Complete Step 1'}
        </button>
        <p>Application readiness is not College compliance.</p>
      </section>
    </aside><PdfReader key={packageId} operations={operations} position={state} onPosition={(page, offset, zoom) => session.move(page, offset, zoom)} onVisit={page => session.visit(page)} /></div>}
  </>;
}
