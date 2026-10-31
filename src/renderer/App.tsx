import { useEffect, useState, useSyncExternalStore } from 'react';
import { BookOpen, ClipboardList, Home, Layers, HardDrive, Sprout, Network } from 'lucide-react';
import type { AppState, DesktopOperations, OperationError, Result } from '../shared/application.js';
import { dateWarning, localDate } from '../shared/application.js';
import { DraftSession } from './draft-session.js';
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
  const pkg = draft.record;
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
  const dateField = (key: 'assessmentDate' | 'planDate', label: string) => pkg && <label className="field">
    <span>{label}</span><input type="date" value={pkg[key]} onChange={event => session.edit({ [key]: event.target.value })} />
    {dateWarning(pkg[key], pkg.year) && <small className="warning">{dateWarning(pkg[key], pkg.year)}</small>}
  </label>;
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
            <button disabled={busy} onClick={() => open(row.id)}>Open {row.year}</button></li>)}</ul>
        </section></>}
      {screen === 'overview' && pkg && <><div className="page-heading"><h1>Connect learning to practice.</h1><p>Your {pkg.year} portfolio begins with reflection.</p></div>
        <div className="map-overview"><section className="relationship-board surface"><div className="relationship-columns">
          <div className="goal-panel"><h2>Learning goals</h2><p>Goals will connect your assessment and development plan. Goal entry is not available in this foundation build.</p><button className="secondary" onClick={() => navigate('assessment')}>Write your self-assessment</button></div>
          <div><h2>Activities & experiences</h2><p>No sample records. Activity entry and relationships arrive in a later build.</p><button className="secondary" onClick={() => navigate('plan')}>View development plan</button></div>
        </div><p className="board-footer">Evidence and reflection will stay with each activity, never with its links.</p></section>
          <aside className="map-checklist"><h2>Close the annual loop</h2><p>Work freely. Complete deliberately.</p>
            <ul>{destinations.slice(1, 4).map(item => <li key={item.screen}><button className="text-button" onClick={() => navigate(item.screen)}>{item.name}</button><small>Draft · completion unavailable</small></li>)}</ul>
            <p>External declaration and annual export are not available yet. This build does not report annual completion.</p>
          </aside></div></>}
      {screen === 'assessment' && pkg && <><div className="page-heading"><h1>Reflect on your practice.</h1><p>Annual self-assessment · {pkg.year}. Incomplete writing is saved as a draft.</p></div>
        <div className="assessment-layout"><section className="surface assessment-writing">
          {dateField('assessmentDate', 'Assessment date')}
          {(['strengths', 'peerFeedback', 'learningNeeds'] as const).map((key, index) => <label className="field" key={key}>
            <span>{['Strengths', 'Peer feedback (optional)', 'Learning needs and interests'][index]}</span>
            <textarea rows={6} value={pkg[key]} onChange={event => session.edit({ [key]: event.target.value })} />
          </label>)}
        </section><aside className="goal-panel"><h2>Your development plan date</h2>{dateField('planDate', 'Plan date')}<p>The plan date is independent of the assessment date.</p>
          <p>Annual standards, shared goals, readiness and manual completion will be added in later builds. Blank narrative fields do not block draft saving.</p></aside></div></>}
      {screen === 'plan' && pkg && <><div className="page-heading"><h1>Develop your learning plan.</h1><p>Annual development plan · {pkg.year}</p></div>
        <section className="goal-panel"><h2>Goal connections</h2><p>Goal and activity entry is not available in this build.</p></section>
        <section className="surface">{dateField('planDate', 'Plan date')}<p>This date is saved independently. Activities, evidence and reflection arrive in a later build.</p></section></>}
      {screen === 'review' && pkg && <Review packageId={pkg.id} year={pkg.year} operations={operations} session={reviewSession} />}
      {screen === 'backup' && <><div className="page-heading"><h1>Protect your portfolio.</h1><p>Full-app backup and restore are distinct from annual exports.</p></div>
        <section className="surface"><h2>Local storage</h2><p className="storage-path">{state?.storageDirectory}</p>
          <p>Full backup and restore are not available in this foundation build. Until available, quit SWCC after Saved and preserve a copy of the entire dataset folder, including database and evidence. Never copy a database while SWCC is running.</p>
          <p>Last successful full-app backup: {state?.lastBackupAt ?? 'None recorded'}</p><p>{state && state.dataRevision > (state.lastBackupRevision ?? -1) ? 'Local changes have not been backed up by SWCC.' : 'No changes since the last full backup.'}</p>
        </section></>}
      {state && <footer className="source-note"><strong>Supplied baseline, not regulatory verification.</strong><p>The ethics document is Second Edition, amended September 2018. The assessment tool references Third Edition / 2023. The same fixed source set applies to every year; SWCC does not verify current-year College compliance.</p></footer>}
    </main></div>
  </div>;
}
