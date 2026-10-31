import { useEffect, useState, useSyncExternalStore } from 'react';
import type {
  Activity, ActivityStatus, ApplicationOperations, EvidenceAttachment, EvidencePreview, Goal, YearPackage,
} from '../shared/application.js';
import { dateWarning } from '../shared/application.js';
import { activityDateError, evaluatePlanReadiness, validEvidenceLink } from '../shared/plan.js';
import { currentCompletion } from '../shared/workflow.js';
import type { DraftSession } from './draft-session.js';
import { DateField, Dialog, GoalCreateDialog, GoalDeleteDialog } from './assessment-screen.js';
import { EvidencePreviewDialog } from './EvidencePreview.js';
import './plan.css';

export function PlanReadinessPanel({ pkg, readableEvidenceActivityIds = new Set<string>(), complete, busy }: {
  pkg: YearPackage; readableEvidenceActivityIds?: ReadonlySet<string>; complete: () => void; busy: boolean;
}) {
  const readiness = evaluatePlanReadiness(pkg, undefined, readableEvidenceActivityIds);
  const completed = currentCompletion(pkg, 'plan');
  return <section className={`readiness-panel ${readiness.ready ? 'ready' : ''}`} aria-labelledby="plan-readiness-title">
    <div className="readiness-heading"><h2 id="plan-readiness-title">Step 3 · Development plan</h2>
      <span className={`readiness-status ${readiness.ready ? 'ready' : ''}`} role="status" aria-label="Step 3 readiness">{completed ? 'Completed' : readiness.ready ? 'Ready' : 'In progress'}</span></div>
    {readiness.ready ? <p>All application readiness checks are satisfied. Manual completion is separate.</p>
      : <ul className="readiness-missing" aria-label="Step 3 missing items">{readiness.missing.map(item => <li key={item}>{item}</li>)}</ul>}
    <small>Supplementary activities do not block readiness. Files are optional when notes or a valid link qualify; missing or corrupt files do not count.</small>
    {completed && <p>You manually confirmed this step. Meaningful goal, plan or activity edits reopen it.</p>}
    <button type="button" className="secondary" disabled={busy} aria-label="Complete Step 3" onClick={complete}>
      {completed ? 'Confirm Step 3 again' : 'Complete Step 3'}
    </button>
    <small>Application readiness is not College compliance. Completion saves and checks your latest edits.</small>
  </section>;
}

function ActivityCreateDialog({ pkg, session, onClose, onCreated }: {
  pkg: YearPackage; session: DraftSession; onClose: () => void; onCreated: (id: string) => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [goalIds, setGoalIds] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const pending = Boolean(state.pendingActivityCreation);
  useEffect(() => {
    if (submitted && !state.pendingActivityCreation && state.status === 'Saved') {
      const activity = state.record?.activities.at(-1);
      if (activity) onCreated(activity.id);
    }
  }, [submitted, state, onCreated]);
  function close() {
    if (pending) { setError('This activity is waiting to be saved. Retry before closing.'); return; }
    onClose();
  }
  async function save() {
    setError('');
    if (!title.trim()) { setError('Enter an activity title before saving.'); return; }
    setSubmitted(true);
    try { await session.createActivity(title, description, goalIds); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }
  return <Dialog title="Record an activity" onClose={close}>
    <p>Record it once. Link several goals, or leave it supplementary. Add evidence and reflection on the same record afterward.</p>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="field"><span>Activity title</span><input autoFocus aria-label="Activity title" value={title} disabled={pending} onChange={event => setTitle(event.target.value)} /></label>
      <label className="field"><span>Description (optional)</span><textarea aria-label="Activity description" value={description} disabled={pending} onChange={event => setDescription(event.target.value)} /></label>
      <fieldset className="goal-link-editor"><legend>Linked goals (optional)</legend>
        {pkg.goals.map(goal => <label key={goal.id}><input type="checkbox" disabled={pending} checked={goalIds.includes(goal.id)}
          onChange={event => setGoalIds(event.target.checked ? [...goalIds, goal.id] : goalIds.filter(id => id !== goal.id))} /><span>{goal.ref} {goal.title}</span></label>)}
        {!pkg.goals.length && <p>No goals yet. Create and link one in the activity editor.</p>}
      </fieldset>
      {error && <p role="alert" className="goal-validation">{error}</p>}
      {pending && state.status === 'Not saved' && <button type="button" onClick={() => void session.flush().catch(failure => setError(String(failure)))}>Retry save</button>}
      <div className="goal-dialog-actions"><button type="button" className="secondary" disabled={pending} onClick={close}>Cancel</button>
        <button type="submit" disabled={pending}>Save activity</button></div>
    </form>
  </Dialog>;
}

function ActivityEditor({ activity, pkg, session, operations, addGoal, evidence, evidenceError, evidenceLoaded, refreshEvidence, onDeleted, reportError }: {
  activity: Activity; pkg: YearPackage; session: DraftSession; operations: ApplicationOperations; addGoal: () => void;
  evidence: EvidenceAttachment[]; evidenceError: string; evidenceLoaded: boolean; refreshEvidence: () => Promise<EvidenceAttachment[]>;
  onDeleted: (activityId: string | null) => void; reportError: (message: string) => void;
}) {
  const [linksText, setLinksText] = useState(activity.evidenceLinks.join('\n'));
  const [openError, setOpenError] = useState('');
  const [evidenceOpenError, setEvidenceOpenError] = useState<{ id: string; message: string } | null>(null);
  const [fileActionError, setFileActionError] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  const [preview, setPreview] = useState<EvidencePreview | null>(null);
  const [removing, setRemoving] = useState<EvidenceAttachment | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [deletingActivity, setDeletingActivity] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const error = activityDateError(activity);
  const warning = dateWarning(activity.completionDate, pkg.year);
  const attached = evidence.filter(entry => entry.activityId === activity.id);
  async function openLink(url: string) {
    setOpenError('');
    try {
      await session.flush();
      const result = await operations.openEvidenceLink({ packageId: pkg.id, activityId: activity.id, url });
      if (!result.ok) throw new Error(result.error.message);
    } catch (failure) { setOpenError(failure instanceof Error ? failure.message : String(failure)); }
  }
  async function chooseEvidence(evidenceId?: string) {
    setFileActionError('');
    setFileBusy(true);
    try {
      await session.flush();
      const current = session.getSnapshot().record;
      if (!current) throw new Error('Open a year before importing evidence.');
      const request = { packageId: pkg.id, activityId: activity.id, expectedRevision: current.contentRevision };
      const result = evidenceId
        ? await operations.replaceEvidence({ ...request, evidenceId })
        : await operations.importEvidence(request);
      if (!result.ok) throw new Error(result.error.message);
      if (result.value.cancelled) return;
      session.open(result.value.package);
      await refreshEvidence();
    } catch (failure) {
      setFileActionError(failure instanceof Error ? failure.message : String(failure));
    } finally { setFileBusy(false); }
  }
  async function removeEvidence() {
    if (!removing) return;
    setRemoveError('');
    setFileBusy(true);
    try {
      await session.flush();
      const current = session.getSnapshot().record;
      if (!current) throw new Error('Open a year before removing evidence.');
      const result = await operations.removeEvidence({
        packageId: pkg.id, activityId: activity.id, evidenceId: removing.id, expectedRevision: current.contentRevision,
      });
      if (!result.ok && result.error.committed) {
        const refreshed = await operations.openYear(pkg.id);
        if (!refreshed.ok) throw new Error(`${result.error.message} Local records could not be refreshed: ${refreshed.error.message}`);
        session.open(refreshed.value);
        setRemoving(null);
        await refreshEvidence();
        reportError(result.error.message);
        return;
      }
      if (!result.ok) throw new Error(result.error.message);
      session.open(result.value);
      setRemoving(null);
      await refreshEvidence();
    } catch (failure) {
      setRemoveError(failure instanceof Error ? failure.message : String(failure));
    } finally { setFileBusy(false); }
  }
  async function deleteActivity() {
    if (!deletingActivity) return;
    setDeleteError('');
    setDeleteBusy(true);
    try {
      await session.flush();
      const current = session.getSnapshot().record;
      if (!current) throw new Error('Open a year before deleting an activity.');
      const result = await operations.deleteActivity({
        packageId: current.id, activityId: activity.id, expectedRevision: current.contentRevision, confirmed: true,
      });
      if (!result.ok) {
        if (result.error.committed) {
          const refreshed = await operations.openYear(pkg.id);
          if (refreshed.ok) {
            session.open(refreshed.value);
            onDeleted(refreshed.value.activities[0]?.id ?? null);
            await refreshEvidence().catch(() => {});
          }
          reportError(result.error.message);
          setDeletingActivity(false);
          return;
        }
        throw new Error(result.error.message);
      }
      session.open(result.value);
      onDeleted(result.value.activities[0]?.id ?? null);
      setDeletingActivity(false);
      await refreshEvidence();
    } catch (failure) {
      setDeleteError(failure instanceof Error ? failure.message : String(failure));
    } finally { setDeleteBusy(false); }
  }
  async function showPreview(entry: EvidenceAttachment) {
    setFileActionError('');
    setFileBusy(true);
    try {
      await session.flush();
      const result = await operations.previewEvidence({ packageId: pkg.id, activityId: activity.id, evidenceId: entry.id });
      if (!result.ok) throw new Error(result.error.message);
      setPreview(result.value);
    } catch (failure) {
      setFileActionError(failure instanceof Error ? failure.message : String(failure));
    } finally { setFileBusy(false); }
  }
  async function openDocument(entry: EvidenceAttachment) {
    setEvidenceOpenError(null);
    setFileBusy(true);
    try {
      await session.flush();
      const result = await operations.openEvidence({ packageId: pkg.id, activityId: activity.id, evidenceId: entry.id });
      if (!result.ok) throw new Error(result.error.message);
    } catch (failure) {
      setEvidenceOpenError({
        id: entry.id,
        message: failure instanceof Error ? failure.message : String(failure),
      });
    } finally { setFileBusy(false); }
  }
  async function recheckEvidence() {
    setFileActionError('');
    try { await refreshEvidence(); }
    catch (failure) { setFileActionError(failure instanceof Error ? failure.message : String(failure)); }
  }
  return <article className="activity-editor" aria-label={`Activity editor ${activity.ref}`}>
    <div className="activity-editor-header"><span className="goal-reference">{activity.ref}</span><small>One record · all linked goals</small>
      <button type="button" className="text-button delete-record" disabled={fileBusy} aria-label={`Delete activity ${activity.ref}`}
        onClick={() => { setDeleteError(''); setDeletingActivity(true); }}>Delete</button>
    </div>
    <label className="field activity-title"><span>Activity title</span><input value={activity.title}
      onChange={event => session.editActivity(activity.id, { title: event.target.value })} /></label>
    {!activity.title.trim() && <p className="goal-validation">An activity title is required before saving.</p>}
    <label className="field"><span>Description <small>Optional</small></span><textarea aria-label="Activity description" rows={3} value={activity.description}
      onChange={event => session.editActivity(activity.id, { description: event.target.value })} /></label>
    <div className="activity-dates">
      <label className="field"><span>Activity status</span><select aria-label="Activity status" value={activity.status}
        onChange={event => session.editActivity(activity.id, { status: event.target.value as ActivityStatus })}>
        {(['Planned', 'In Progress', 'Completed'] as const).map(status => <option key={status}>{status}</option>)}
      </select></label>
      <label className="field"><span>Completion date</span><input type="date" aria-label="Completion date" value={activity.completionDate}
        onChange={event => session.editActivity(activity.id, { completionDate: event.target.value })} />
        {warning && <small className="warning">{warning}</small>}</label>
    </div>
    {error && <p className="goal-validation">{error}</p>}
    <p className="quiet">Planned and In Progress drafts need no invented date. Completed can still have pending evidence or reflection.</p>
    <fieldset className="goal-link-editor"><legend>Linked learning goals</legend>
      {pkg.goals.map(goal => <label key={goal.id}><input type="checkbox" checked={activity.goalIds.includes(goal.id)}
        onChange={event => session.editActivity(activity.id, { goalIds: event.target.checked ? [...activity.goalIds, goal.id] : activity.goalIds.filter(id => id !== goal.id) })} />
        <span><b>{goal.ref}</b> {goal.title}</span></label>)}
      <button type="button" className="text-button" onClick={addGoal}>Create and link a goal</button>
      {!activity.goalIds.length && <p>No linked goal · supplementary learning. This activity does not block Step 3.</p>}
    </fieldset>
    <label className="field narrative"><span>Evidence notes</span><small>A description or a valid link can qualify without a file.</small>
      <textarea aria-label="Evidence notes" rows={4} value={activity.evidenceDescription}
        onChange={event => session.editActivity(activity.id, { evidenceDescription: event.target.value })} /></label>
    <label className="field"><span>Evidence links</span><small>HTTP/HTTPS, one per line. Stored offline; never fetched automatically.</small>
      <textarea aria-label="Evidence links" rows={3} value={linksText} onChange={event => {
        setLinksText(event.target.value);
        session.editActivity(activity.id, { evidenceLinks: event.target.value.split('\n').map(link => link.trim()).filter(Boolean) });
      }} /></label>
    <ul className="evidence-link-actions">{activity.evidenceLinks.map((url, index) => <li key={`${index}-${url}`}>
      <span>{url}</span>{validEvidenceLink(url) ? <button type="button" className="text-button" onClick={() => void openLink(url)} aria-label={`Open evidence link ${index + 1}`}>Open in browser</button>
        : <small className="goal-validation">Enter a valid HTTP or HTTPS link.</small>}
    </li>)}</ul>
    <small className="quiet">Opening a link needs internet to view its website. A successful launch does not verify loading or reading.</small>
    {openError && <p role="alert" className="goal-validation">{openError}</p>}
    <section className="managed-evidence" aria-labelledby={`managed-evidence-title-${activity.id}`}>
      <div className="managed-evidence-heading"><div><h3 id={`managed-evidence-title-${activity.id}`}>Attached evidence files</h3>
        <p>Optional files are copied into SWCC storage. Supported types are PDF, images, and common office/text documents; maximum 50 MiB each.</p></div>
        <button type="button" disabled={fileBusy} onClick={() => void chooseEvidence()}>Import evidence file</button>
      </div>
      <button type="button" className="text-button evidence-recheck" disabled={fileBusy} onClick={() => void recheckEvidence()}>Check file integrity</button>
      {evidenceError && <div role="alert" className="goal-validation">Evidence integrity could not be checked: {evidenceError}</div>}
      {fileActionError && <p role="alert" className="goal-validation">{fileActionError}</p>}
      {!evidenceLoaded && !evidenceError && <p role="status" className="quiet">Checking attached evidence…</p>}
      {evidenceLoaded && !attached.length && <p className="quiet">No file evidence is attached to this activity yet.</p>}
      {attached.map(entry => {
        const previewable = entry.type === 'pdf' || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(entry.type);
        const integrityMessage = entry.integrity === 'missing' ? `${entry.ref} is missing; replace it or remove it.`
          : entry.integrity === 'corrupt' ? `${entry.ref} failed its SHA-256 integrity check; replace it or remove it.`
            : entry.integrity === 'unreadable' ? `${entry.ref} cannot be read; replace it or remove it.` : '';
        return <article className={`managed-evidence-entry ${entry.integrity}`} aria-label={`Evidence ${entry.ref}`} key={entry.id}>
          <div className="managed-evidence-meta"><span className="goal-reference">{entry.ref}</span><strong>{entry.originalName}</strong>
            <small>{entry.type.toUpperCase()} · {entry.byteCount.toLocaleString()} bytes · {entry.integrity === 'readable' ? 'Readable' : 'Needs repair'}</small></div>
          {integrityMessage && <p className="evidence-integrity-error" role="alert">{integrityMessage}</p>}
          {entry.integrity === 'readable' && <div className="managed-evidence-actions">
            {previewable ? <button type="button" disabled={fileBusy} onClick={() => void showPreview(entry)}>Preview {entry.ref}</button>
              : <button type="button" disabled={fileBusy} onClick={() => void openDocument(entry)}>Open {entry.ref} in installed app</button>}
          </div>}
          {evidenceOpenError?.id === entry.id && <p role="alert" className="evidence-integrity-error">{evidenceOpenError.message}</p>}
          <div className="managed-evidence-actions">
            <button type="button" className="secondary" disabled={fileBusy} onClick={() => void chooseEvidence(entry.id)}>Replace {entry.ref}</button>
            <button type="button" className="text-button" disabled={fileBusy} onClick={() => { setRemoving(entry); setRemoveError(''); }}>Remove {entry.ref}</button>
          </div>
        </article>;
      })}
    </section>
    <label className="field narrative"><span>Application to practice</span><textarea aria-label="Application to practice" rows={5} value={activity.applicationToPractice}
      onChange={event => session.editActivity(activity.id, { applicationToPractice: event.target.value })} /></label>
    {preview && <EvidencePreviewDialog preview={preview} onClose={() => setPreview(null)} />}
    {deletingActivity && <Dialog title={`Delete activity ${activity.ref}?`} onClose={() => { if (!deleteBusy) setDeletingActivity(false); }}>
      <p className="goal-dialog-copy">This deletes {activity.ref}, its goal links, evidence notes and links, evidence records and managed files, and its application-to-practice reflection. Linked goals, other activities, and their evidence stay.</p>
      {deleteError && <p role="alert" className="goal-validation">{deleteError}</p>}
      {session.getSnapshot().status === 'Not saved' && <div className="goal-retry">
        <p>{session.getSnapshot().error || 'Some edits remain unsaved.'}</p>
        <button type="button" className="secondary" disabled={deleteBusy} onClick={() => void session.flush().catch(failure => setDeleteError(failure instanceof Error ? failure.message : String(failure)))}>Retry save</button>
      </div>}
      <div className="goal-dialog-actions"><button type="button" className="secondary" disabled={deleteBusy} onClick={() => setDeletingActivity(false)}>Keep activity</button>
        <button type="button" className="danger" disabled={deleteBusy} onClick={() => void deleteActivity()}>Delete {activity.ref}</button></div>
    </Dialog>}
    {removing && <Dialog title={`Remove evidence ${removing.ref}?`} onClose={() => { if (!fileBusy) setRemoving(null); }}>
      <p className="goal-dialog-copy">This removes {removing.ref} from {activity.ref} and deletes its managed copy. The reference will not be reused.</p>
      {removeError && <p role="alert" className="goal-validation">{removeError}</p>}
      <div className="goal-dialog-actions"><button type="button" className="secondary" disabled={fileBusy} onClick={() => setRemoving(null)}>Cancel</button>
        <button type="button" disabled={fileBusy} onClick={() => void removeEvidence()}>Remove evidence</button></div>
    </Dialog>}
  </article>;
}

export function PlanScreen({ pkg, session, operations, selectedId, select, recordRequested, clearRecordRequest, evidence, evidenceError, evidenceLoaded, refreshEvidence, reportError, complete, busy }: {
  pkg: YearPackage; session: DraftSession; operations: ApplicationOperations; selectedId: string | null;
  select: (id: string | null) => void; recordRequested: boolean; clearRecordRequest: () => void;
  evidence: EvidenceAttachment[]; evidenceError: string; evidenceLoaded: boolean; refreshEvidence: () => Promise<EvidenceAttachment[]>;
  complete: () => void; busy: boolean;
  reportError: (message: string) => void;
}) {
  const [creating, setCreating] = useState(recordRequested);
  const [creatingGoal, setCreatingGoal] = useState<{ activityId?: string } | null>(null);
  const [deletingGoal, setDeletingGoal] = useState<Goal | null>(null);
  const activity = pkg.activities.find(item => item.id === selectedId) ?? pkg.activities[0];
  async function selectActivity(id: string) {
    try { await session.flush(); select(id); }
    catch { /* The retained editor and global retry panel expose the failed edit. */ }
  }
  function closeCreate() { setCreating(false); clearRecordRequest(); }
  function created(id: string) { select(id); closeCreate(); }
  return <>
    <div className="page-heading map-heading"><div><h1>Give your learning a place.</h1><p>Activities support zero, one, or several goals. Evidence and reflections belong to each activity.</p></div>
      <button type="button" onClick={() => setCreating(true)}>Add activity</button></div>
    <section className="goal-connection-strip" aria-labelledby="plan-goals-title">
      <div className="section-heading"><h2 id="plan-goals-title">Goal connections</h2><button type="button" className="text-button" onClick={() => setCreatingGoal({})}>Add goal</button></div>
      <div className="plan-goal-list">{pkg.goals.map(goal => <article key={goal.id} className="plan-goal" aria-label={`${goal.ref} ${goal.title}`}>
        <span className="goal-reference">{goal.ref}</span><div><h3>{goal.title}</h3>{goal.description && <p>{goal.description}</p>}
          <div className="goal-activity-refs">{pkg.activities.filter(item => item.goalIds.includes(goal.id)).map(item => <button type="button" key={item.id}
            className={activity?.id === item.id ? 'chosen' : 'secondary'} aria-label={`Edit ${item.ref} from ${goal.ref}`} onClick={() => void selectActivity(item.id)}>{item.ref}</button>)}</div></div>
        <button type="button" className="text-button" aria-label={`Delete goal ${goal.ref}`} onClick={() => setDeletingGoal(goal)}>Remove</button>
      </article>)}</div>
      {!pkg.goals.length && <p className="empty">Add a goal here or in self-assessment. Both views share the same goal.</p>}
      <p className="quiet">Select an A reference to edit its single shared record. Unlinked activities stay in the index below.</p>
    </section>
    <div className="map-plan-body"><aside><h2>Activity records</h2><div className="activity-index">
      {pkg.activities.map(item => <button type="button" key={item.id} aria-label={`Select activity ${item.ref}`} aria-pressed={activity?.id === item.id}
        className={activity?.id === item.id ? 'selected' : ''} onClick={() => void selectActivity(item.id)}>
        <span className="goal-reference">{item.ref}</span><strong>{item.title}</strong><small>{item.status}</small>
        <small>{item.goalIds.length ? pkg.goals.filter(goal => item.goalIds.includes(goal.id)).map(goal => goal.ref).join(', ') : 'No linked goal · supplementary'}</small>
      </button>)}</div>
      <DateField pkg={pkg} session={session} field="planDate" label="Plan date" />
      <p className="quiet">Plan date is independent of assessment date.</p><PlanReadinessPanel pkg={pkg}
        readableEvidenceActivityIds={new Set(evidence.filter(entry => entry.integrity === 'readable').map(entry => entry.activityId))}
        complete={complete} busy={busy} /></aside>
      {activity ? <ActivityEditor key={activity.id} activity={activity} pkg={pkg} session={session} operations={operations}
        addGoal={() => setCreatingGoal({ activityId: activity.id })} evidence={evidence} evidenceError={evidenceError}
        evidenceLoaded={evidenceLoaded} refreshEvidence={refreshEvidence} onDeleted={select} reportError={reportError} />
        : <section className="surface empty-editor"><h2>Make room for learning.</h2><p>Record an activity, then connect goals or keep it supplementary.</p></section>}
    </div>
    {creating && <ActivityCreateDialog pkg={pkg} session={session} onClose={closeCreate} onCreated={created} />}
    {creatingGoal && <GoalCreateDialog source="plan" session={session} activityId={creatingGoal.activityId} onClose={() => setCreatingGoal(null)} />}
    {deletingGoal && <GoalDeleteDialog goal={deletingGoal} session={session} operations={operations} onClose={() => setDeletingGoal(null)} />}
  </>;
}
