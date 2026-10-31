import { useEffect, useState, useSyncExternalStore } from 'react';
import { BookOpen, ClipboardList, Home, Layers, HardDrive, Sprout, Network } from 'lucide-react';
import type { AppState, DesktopOperations, EvidenceAttachment, OperationError, Result } from '../shared/application.js';
import { localDate } from '../shared/application.js';
import { DraftSession } from './draft-session.js';
import { AssessmentScreen, Dialog } from './assessment-screen.js';
import { PlanScreen } from './plan-screen.js';
import { evaluateAssessmentReadiness } from '../shared/assessment.js';
import { evaluatePlanReadiness } from '../shared/plan.js';
import { ReviewSession } from './review-session.js';
import { Review } from './Review.js';

type Screen = 'years' | 'overview' | 'assessment' | 'plan' | 'review' | 'backup';
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
const destinations = [
  { screen: 'overview', name: 'Year overview', icon: Home },
  { screen: 'review', name: 'Review', icon: BookOpen },
  { screen: 'assessment', name: 'Self-assessment', icon: ClipboardList },
  { screen: 'plan', name: 'Development plan', icon: Network },
  { screen: 'years', name: 'All years', icon: Layers },
  { screen: 'backup', name: 'Backup and restore', icon: HardDrive },
] as const;

export function App({ operations }: { operations: DesktopOperations }) {
  const [session] = useState(() => new DraftSession(operations));
  const [reviewSession] = useState(() => new ReviewSession(operations));
  const draft = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const review = useSyncExternalStore(reviewSession.subscribe, reviewSession.getSnapshot);
  const [state, setState] = useState<AppState | null>(null);
  const [screen, setScreen] = useState<Screen>('years');
  const [year, setYear] = useState(localDate().slice(0, 4));
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<OperationError | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [recordRequested, setRecordRequested] = useState(false);
  const [deletingYear, setDeletingYear] = useState<{ id: string; year: number } | null>(null);
  const [yearDeleteError, setYearDeleteError] = useState<string | null>(null);
  const [evidenceByPackage, setEvidenceByPackage] = useState<Record<string, EvidenceAttachment[]>>({});
  const [evidenceErrors, setEvidenceErrors] = useState<Record<string, string>>({});
  const pkg = draft.record;
  const packageEvidence = pkg ? evidenceByPackage[pkg.id] ?? [] : [];
  const readableEvidenceActivityIds = new Set(packageEvidence
    .filter(entry => entry.integrity === 'readable').map(entry => entry.activityId));
  useEffect(() => {
    void operations.getState().then(result => {
      if (!result.ok) { setError(result.error.message); return; }
      setState(result.value);
      session.open(result.value.selectedPackage);
      if (result.value.selectedPackage) setScreen('overview');
    }).catch(() => setError('Cannot connect to local records. Preserve your storage folder and restart SWCC.'));
    return operations.onCloseRequested(() => {
      void Promise.all([session.flush(), reviewSession.flush()]).then(() => operations.completeClose()).then(result => {
        if (!result.ok) setError(result.error.message);
      }).catch(() => { /* The session displays the retained edit and retry action. */ });
    });
  }, [operations, session, reviewSession]);
  useEffect(() => {
    if (!pkg) return;
    let active = true;
    void operations.getEvidence(pkg.id).then(result => {
      if (!active) return;
      if (!result.ok) {
        setEvidenceErrors(previous => ({ ...previous, [pkg.id]: result.error.message }));
        return;
      }
      setEvidenceByPackage(previous => ({ ...previous, [pkg.id]: result.value }));
      setEvidenceErrors(previous => ({ ...previous, [pkg.id]: '' }));
    }).catch(failure => {
      if (active) setEvidenceErrors(previous => ({
        ...previous, [pkg.id]: failure instanceof Error ? failure.message : String(failure),
      }));
    });
    return () => { active = false; };
  }, [operations, pkg?.id]);
  async function refreshEvidence(packageId: string) {
    const result = await operations.getEvidence(packageId);
    if (!result.ok) {
      setEvidenceErrors(previous => ({ ...previous, [packageId]: result.error.message }));
      throw new Error(result.error.message);
    }
    setEvidenceByPackage(previous => ({ ...previous, [packageId]: result.value }));
    setEvidenceErrors(previous => ({ ...previous, [packageId]: '' }));
    return result.value;
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await Promise.all([session.flush(), reviewSession.flush()]); await work(); }
    catch (failure) { if (!session.getSnapshot().error && !reviewSession.getSnapshot().error) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  }
  function navigate(next: Screen) {
    void run(async () => {
      if (!pkg && !['years', 'backup'].includes(next)) { setScreen('years'); return; }
      if (next === 'years' || next === 'backup') setState(unwrap(await operations.getState()));
      setDuplicate(null);
      setScreen(next);
    });
  }
  function open(id: string) {
    void run(async () => {
      session.open(unwrap(await operations.openYear(id)));
      setSelectedActivityId(null);
      setRecordRequested(false);
      setState(unwrap(await operations.getState()));
      setDuplicate(null);
      setScreen('overview');
    });
  }
  async function create() {
    await run(async () => {
      const result = await operations.createYear(Number(year));
      if (!result.ok) { setDuplicate(result.error.code === 'DUPLICATE_YEAR' ? result.error : null); setError(result.error.message); return; }
      session.open(result.value);
      setState(unwrap(await operations.getState()));
      setDuplicate(null);
      setScreen('overview');
    });
  }
  async function deleteYear() {
    if (!deletingYear || busy) return;
    setBusy(true);
    setYearDeleteError(null);
    try {
      await Promise.all([session.flush(), reviewSession.flush()]);
      const current = unwrap(await operations.getState());
      const target = current.years.find(item => item.id === deletingYear.id);
      if (!target) throw new Error('This year package no longer exists. Refresh the year list before retrying.');
      const result = await operations.deleteYear({
        packageId: target.id, expectedRevision: target.contentRevision, confirmed: true,
      });
      if (!result.ok) {
        if (result.error.committed) {
          const refreshed = await operations.getState();
          if (refreshed.ok) {
            setState(refreshed.value);
            session.open(refreshed.value.selectedPackage);
            setSelectedActivityId(null);
            setRecordRequested(false);
            if (refreshed.value.selectedPackage) await reviewSession.open(refreshed.value.selectedPackage.id);
            setScreen(refreshed.value.selectedPackage ? 'overview' : 'years');
            setDeletingYear(null);
            setError(result.error.message);
            return;
          }
        }
        throw new Error(result.error.message);
      }
      setState(result.value);
      session.open(result.value.selectedPackage);
      setSelectedActivityId(null);
      setRecordRequested(false);
      if (result.value.selectedPackage) await reviewSession.open(result.value.selectedPackage.id);
      setDeletingYear(null);
      setScreen(result.value.selectedPackage ? 'overview' : 'years');
    } catch (failure) {
      setYearDeleteError(failure instanceof Error ? failure.message : String(failure));
    } finally { setBusy(false); }
  }
  function activityEntry(id: string | null) {
    void run(async () => {
      setSelectedActivityId(id);
      setRecordRequested(!id);
      setScreen('plan');
    });
  }
  return <div className="map-layout">
    <aside className="map-rail" aria-label="Portfolio navigation">
      <div className="map-mark"><Sprout size={29} aria-hidden="true" /><span className="sr-only">SWCC</span></div>
      <nav>{destinations.map(({ screen: destination, name, icon: Icon }) => <button type="button" key={destination} aria-label={name}
        aria-current={screen === destination ? 'page' : undefined} disabled={busy} onClick={() => navigate(destination)}>
        <Icon size={22} aria-hidden="true" /><span>{name}</span>
      </button>)}</nav>
    </aside>
    <div className="map-workspace"><header className="map-top">
      <div className="map-wordmark">SWCC <span>My learning portfolio</span></div>
      <label className="year-picker"><span>Year package</span><select value={pkg?.id ?? ''} disabled={busy || !state?.years.length} onChange={event => open(event.target.value)}>
        {!pkg && <option value="">Choose a year</option>}
        {state?.years.map(row => <option key={row.id} value={row.id}>{row.year}</option>)}
      </select></label>
      <span className={`save-status ${draft.status === 'Not saved' || review.status === 'Not saved' ? 'warning' : ''}`} role="status" aria-label="Save status">{state ? [draft.status, review.status].includes('Not saved') ? 'Not saved' : [draft.status, review.status].includes('Saving') ? 'Saving' : 'Saved' : error ? 'Unavailable' : 'Opening records'}</span>
    </header>
    <main id="main-content">
      {state && !state.acknowledgedAt && <section className="storage-note" aria-labelledby="local-storage-title">
        <h2 id="local-storage-title">Your records stay on this device.</h2>
        <p>SWCC stores records and evidence under your OS user account. No account or cloud sync. Protect your portfolio with explicit backups; an annual export is not a full backup.</p>
        <p className="storage-path">{state.storageDirectory}</p>
        <button type="button" onClick={() => void run(async () => setState(unwrap(await operations.acknowledgeStorage())))} disabled={busy}>I understand</button>
      </section>}
      {(error || draft.error) && <section className="error-panel" role="alert">
        <p>{draft.error || error}</p>
        {draft.error && <><p>Your unsaved edits remain visible. Navigation and close are blocked until saving succeeds. Copy your text elsewhere if recovery is needed.</p>
          <button onClick={() => void run(async () => {})} disabled={busy}>Retry save</button></>}
        {duplicate?.existingPackageId && <button onClick={() => open(duplicate.existingPackageId!)} disabled={busy}>Open existing package</button>}
      </section>}
      {!state && !error && <p role="status">Opening local records…</p>}
      {screen === 'years' && <><div className="page-heading"><h1>Your year packages</h1><p>One portfolio per calendar year. Earlier years stay open for editing.</p></div>
        <section className="surface">
          <form className="create-year" onSubmit={event => { event.preventDefault(); void create(); }}>
            <label className="field"><span>New package year</span><input type="number" min="1" max="9999" step="1" required value={year} onChange={event => setYear(event.target.value)} /></label>
            <button type="submit" disabled={busy || !state}>Create year package</button>
          </form>
          {state?.years.length === 0 && <p className="empty">Start with this year, or create a past year to backfill your records.</p>}
          <ul className="year-list">{state?.years.map(row => <li key={row.id}><div><strong>{row.year}</strong><span>Draft · application completion not yet recorded</span></div>
            <div className="year-actions"><button disabled={busy} onClick={() => open(row.id)}>Open {row.year}</button>
              <button type="button" className="text-button year-delete" disabled={busy}
                aria-label={`Delete year ${row.year}`} onClick={() => { setYearDeleteError(null); setDeletingYear(row); }}>Delete</button></div></li>)}</ul>
        </section></>}
      {screen === 'overview' && pkg && <><div className="page-heading map-heading"><div><h1>Connect learning to practice.</h1><p>Your {pkg.year} goals and the experiences that move them forward.</p></div>
        <button type="button" onClick={() => activityEntry(null)}>Record an activity</button></div>
        <div className="map-overview"><section className="relationship-board surface"><div className="relationship-columns">
          <div><h2>Learning goals</h2><div className="goal-nodes">
            {pkg.goals.map(goal => <article className="goal-node" key={goal.id}><span className="goal-reference">{goal.ref}</span><h3>{goal.title}</h3>
              {goal.description && <p>{goal.description}</p>}
              <div className="goal-activity-refs">{pkg.activities.filter(activity => activity.goalIds.includes(goal.id)).map(activity =>
                <button type="button" key={activity.id} aria-label={`Open ${activity.ref} from ${goal.ref}`} onClick={() => activityEntry(activity.id)}>{activity.ref}</button>)}</div>
              {!pkg.activities.some(activity => activity.goalIds.includes(goal.id)) && <small>No supporting activity yet</small>}
            </article>)}
            {!pkg.goals.length && <p>No goals yet. Add one from self-assessment or development plan.</p>}
            </div>
            <button className="secondary" onClick={() => navigate('assessment')}>Write your self-assessment</button>
          </div>
          <div><h2>Activities & experiences</h2><div className="activity-nodes">{pkg.activities.map(activity => <button type="button" key={activity.id}
            className="activity-node" aria-label={`Open activity ${activity.ref}: ${activity.title}`} onClick={() => activityEntry(activity.id)}>
            <div><span className="goal-reference">{activity.ref}</span><span className="activity-state">{activity.status}</span></div><h3>{activity.title}</h3>
            <span className="goal-link-chips">{activity.goalIds.length ? pkg.goals.filter(goal => activity.goalIds.includes(goal.id)).map(goal => <span key={goal.id}>{goal.ref}</span>)
              : <small>No linked goal · supplementary</small>}</span>
            {activity.goalIds.length > 1 && <small>One shared record supports these goals</small>}
          </button>)}
          {!pkg.activities.length && <p>Record an activity and connect it to a goal, or keep it supplementary.</p>}</div>
          <button className="secondary" onClick={() => navigate('plan')}>View development plan</button></div>
        </div><p className="board-footer">Evidence and reflection will stay with each activity, never with its links.</p></section>
          <aside className="map-checklist"><h2>Close the annual loop</h2><p>Work freely. Complete deliberately.</p>
            <ul>{destinations.slice(1, 4).map(item => {
              const readiness = item.screen === 'assessment' ? evaluateAssessmentReadiness(pkg) : item.screen === 'plan'
                ? evaluatePlanReadiness(pkg, undefined, readableEvidenceActivityIds) : null;
              return <li key={item.screen}><button className="text-button" onClick={() => navigate(item.screen)}>{item.name}</button>
                <small>{readiness?.ready ? 'Ready' : 'In progress'} · manual completion not yet available</small>
                {readiness && !readiness.ready && <ul>{readiness.missing.map(missing => <li key={missing}><small>{missing}</small></li>)}</ul>}
              </li>;
            })}</ul>
            <p>External declaration and annual export are not available yet. This build does not report annual completion.</p>
          </aside></div></>}
      {screen === 'assessment' && pkg && <AssessmentScreen pkg={pkg} session={session} operations={operations} />}
      {screen === 'plan' && pkg && <PlanScreen key={pkg.id} pkg={pkg} session={session} operations={operations}
        selectedId={selectedActivityId} select={setSelectedActivityId} recordRequested={recordRequested} clearRecordRequest={() => setRecordRequested(false)}
        evidence={packageEvidence} evidenceError={evidenceErrors[pkg.id] ?? ''}
        evidenceLoaded={Object.hasOwn(evidenceByPackage, pkg.id)} refreshEvidence={() => refreshEvidence(pkg.id)} reportError={setError} />}
      {screen === 'review' && pkg && <Review packageId={pkg.id} year={pkg.year} operations={operations} session={reviewSession} />}
      {screen === 'backup' && <><div className="page-heading"><h1>Protect your portfolio.</h1><p>Full-app backup and restore are distinct from annual exports.</p></div>
        <section className="surface"><h2>Local storage</h2><p className="storage-path">{state?.storageDirectory}</p>
          <p>Full backup and restore are not available in this foundation build. Until available, quit SWCC after Saved and preserve a copy of the entire dataset folder, including database and evidence. Never copy a database while SWCC is running.</p>
          <p>Last successful full-app backup: {state?.lastBackupAt ?? 'None recorded'}</p><p>{state && state.dataRevision > (state.lastBackupRevision ?? -1) ? 'Local changes have not been backed up by SWCC.' : 'No changes since the last full backup.'}</p>
        </section></>}
      {deletingYear && <Dialog title={`Delete year ${deletingYear.year}?`} onClose={() => {
        if (!busy) { setDeletingYear(null); setYearDeleteError(null); }
      }}>
        <p className="goal-dialog-copy">The supplied guide advises retaining this portfolio for at least 10 years. SWCC keeps year packages indefinitely unless you explicitly delete them. Deleting {deletingYear.year} removes only that year’s records and managed evidence files; it cannot be undone. Retain any copy you may need before continuing.</p>
        {yearDeleteError && <p role="alert" className="goal-validation">{yearDeleteError}</p>}
        <div className="goal-dialog-actions"><button type="button" className="secondary" disabled={busy}
          onClick={() => { setDeletingYear(null); setYearDeleteError(null); }}>Keep year</button>
          <button type="button" className="danger" disabled={busy} onClick={() => void deleteYear()}>Delete {deletingYear.year} year package</button></div>
      </Dialog>}
      {state && <footer className="source-note"><strong>Supplied baseline, not regulatory verification.</strong><p>The ethics document is Second Edition, amended September 2018. The assessment tool references Third Edition / 2023. The same fixed source set applies to every year; SWCC does not verify current-year College compliance.</p></footer>}
    </main></div>
  </div>;
}
