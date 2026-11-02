import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type {
  Activity, ActivityStatus, ApplicationOperations, EvidenceAttachment, EvidencePreview, Goal, YearPackage,
} from '../shared/application.js';
import { dateWarning, validDate } from '../shared/application.js';
import { activityDateError, evaluatePlanReadiness, validEvidenceLink } from '../shared/plan.js';
import { currentCompletion } from '../shared/workflow.js';
import type { DraftSession } from './draft-session.js';
import { DateField, Dialog, GoalCreateDialog, GoalDeleteDialog } from './assessment-screen.js';
import { EvidencePreviewDialog } from './EvidencePreview.js';
import { useActionFeedback } from './action-feedback.js';
import { isRecordRevealAnimationEnd } from './record-reveal.js';
import './plan.css';

export function PlanReadinessPanel({ pkg, readableEvidenceActivityIds = new Set<string>(), complete, busy }: {
  pkg: YearPackage; readableEvidenceActivityIds?: ReadonlySet<string>; complete: () => void; busy: boolean;
}) {
  const readiness = evaluatePlanReadiness(pkg, undefined, readableEvidenceActivityIds);
  const completed = currentCompletion(pkg, 'plan');
  return <section className={`readiness-panel ${readiness.ready ? 'ready' : ''}`} aria-labelledby="plan-readiness-title">
    <div className="readiness-heading"><h2 id="plan-readiness-title">Step 3 · Development plan</h2>
      <span className={`readiness-status ${readiness.ready ? 'ready' : ''}`} role="status" aria-label="Step 3 readiness">{completed ? 'Completed' : readiness.ready ? 'Ready' : 'In progress'}</span></div>
    {!readiness.ready && <ul className="readiness-missing" aria-label="Step 3 missing items">{readiness.missing.map(item => <li key={item}>{item}</li>)}</ul>}
    {completed && <p>Changes to goals, the plan, or activities can reopen this step.</p>}
    <button type="button" className="secondary" disabled={busy} aria-label="Complete Step 3" onClick={complete}>
      {completed ? 'Confirm Step 3 again' : 'Complete Step 3'}
    </button>
  </section>;
}

function ActivityCreateDialog({ pkg, session, onClose, onCreated, flushEdits }: {
  pkg: YearPackage; session: DraftSession; onClose: () => void; onCreated: (id: string) => void;
  flushEdits: () => Promise<void>;
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
    try {
      await flushEdits();
      setSubmitted(true);
      await session.createActivity(title, description, goalIds);
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }
  return <Dialog title="Record an activity" onClose={close}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="field"><span>Activity title</span><input autoFocus spellCheck aria-label="Activity title" value={title} disabled={pending} onChange={event => setTitle(event.target.value)} /></label>
      <label className="field"><span>Description (optional)</span><textarea aria-label="Activity description" value={description} disabled={pending} onChange={event => setDescription(event.target.value)} /></label>
      <fieldset className="goal-link-editor"><legend>Linked goals (optional)</legend>
        {pkg.goals.map(goal => <label key={goal.id}><input type="checkbox" disabled={pending} checked={goalIds.includes(goal.id)}
          onChange={event => setGoalIds(event.target.checked ? [...goalIds, goal.id] : goalIds.filter(id => id !== goal.id))} /><span>{goal.ref} {goal.title}</span></label>)}
        {!pkg.goals.length && <p>No goals yet. Create and link one in the activity editor.</p>}
      </fieldset>
      {error && <p role="alert" className="goal-validation">{error}</p>}
      {pending && state.status === 'Not saved' && <button type="button" onClick={() => void session.retry().catch(failure => setError(String(failure)))}>Retry save</button>}
      <div className="goal-dialog-actions"><button type="button" className="secondary" disabled={pending} onClick={close}>Cancel</button>
        <button type="submit" disabled={pending}>Save activity</button></div>
    </form>
  </Dialog>;
}

function ActivityEditor({ activity, pkg, session, operations, addGoal, evidence, evidenceError, evidenceLoaded, refreshEvidence, onDeleted, reportError, flushEdits }: {
  activity: Activity; pkg: YearPackage; session: DraftSession; operations: ApplicationOperations; addGoal: () => void;
  evidence: EvidenceAttachment[]; evidenceError: string; evidenceLoaded: boolean; refreshEvidence: () => Promise<EvidenceAttachment[]>;
  onDeleted: (activityId: string | null) => void; reportError: (message: string) => void;
  flushEdits: () => Promise<void>;
}) {
  const { showFeedback } = useActionFeedback();
  const [linksText, setLinksText] = useState(activity.evidenceLinks.join('\n'));
  const [fileBusy, setFileBusy] = useState(false);
  const [preview, setPreview] = useState<EvidencePreview | null>(null);
  const [removing, setRemoving] = useState<EvidenceAttachment | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [deletingActivity, setDeletingActivity] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const completionDateInput = useRef<HTMLInputElement>(null);
  const openCompletionPicker = useRef(false);
  const [calendarMonth, setCalendarMonth] = useState(() => monthForDate(activity.completionDate));
  const [fallbackCalendarOpen, setFallbackCalendarOpen] = useState(false);
  const [nativePickerUnavailable, setNativePickerUnavailable] = useState(false);
  const error = activityDateError(activity);
  const saveState = session.getSnapshot();
  const warning = dateWarning(activity.completionDate, pkg.year);
  const attached = evidence.filter(entry => entry.activityId === activity.id);
  useLayoutEffect(() => {
    const input = completionDateInput.current;
    if (input && typeof input.showPicker !== 'function') setNativePickerUnavailable(true);
    if (!openCompletionPicker.current || activity.status !== 'Completed') return;
    openCompletionPicker.current = false;
    if (!input) return;
    input.focus();
    try {
      if (typeof input.showPicker !== 'function') throw new Error('The native date picker is unavailable.');
      input.showPicker();
    } catch {
      setNativePickerUnavailable(true);
      setCalendarMonth(monthForDate(activity.completionDate));
      setFallbackCalendarOpen(true);
    }
  }, [activity.id, activity.completionDate, activity.status]);
  function reportActionFailure(title: string, failure: unknown, action?: { label: string; onClick: () => void }) {
    const snapshot = session.getSnapshot();
    if (snapshot.error || snapshot.record?.activities.some(item => activityDateError(item))) return;
    showFeedback({
      title,
      message: failure instanceof Error ? failure.message : String(failure),
      kind: 'error',
      ...(action ? { action } : {}),
    });
  }
  async function openLink(url: string) {
    try {
      await flushEdits();
      const result = await operations.openEvidenceLink({ packageId: pkg.id, activityId: activity.id, url });
      if (!result.ok) throw new Error(result.error.message);
    } catch (failure) {
      reportActionFailure('Could not open evidence link', failure, {
        label: 'Try opening link again', onClick: () => void openLink(url),
      });
    }
  }
  async function chooseEvidence(evidenceId?: string) {
    setFileBusy(true);
    try {
      await flushEdits();
      await session.withSavedRecord(async current => {
        if (current.id !== pkg.id) throw new Error('The selected year changed. Select the activity again before importing evidence.');
        const request = { packageId: current.id, activityId: activity.id, expectedRevision: current.contentRevision };
        const result = evidenceId
          ? await operations.replaceEvidence({ ...request, evidenceId })
          : await operations.importEvidence(request);
        if (!result.ok) {
          if (result.error.committed) {
            const refreshed = await operations.openYear(current.id);
            if (!refreshed.ok) throw new Error(`${result.error.message} Local records could not be refreshed: ${refreshed.error.message}`);
            session.acceptSaved(refreshed.value);
            await refreshEvidence();
          }
          throw new Error(result.error.message);
        }
        if (result.value.cancelled) return;
        session.acceptSaved(result.value.package);
        await refreshEvidence();
      });
    } catch (failure) {
      reportActionFailure(evidenceId ? 'Could not replace evidence file' : 'Could not import evidence file', failure, {
        label: evidenceId ? 'Choose another file' : 'Choose an evidence file',
        onClick: () => void chooseEvidence(evidenceId),
      });
    } finally { setFileBusy(false); }
  }
  async function removeEvidence() {
    if (!removing) return;
    setRemoveError('');
    setFileBusy(true);
    try {
      await flushEdits();
      const current = session.getSnapshot().record;
      if (!current) throw new Error('Open a year before removing evidence.');
      const result = await operations.removeEvidence({
        packageId: pkg.id, activityId: activity.id, evidenceId: removing.id, expectedRevision: current.contentRevision,
      });
      if (!result.ok && result.error.committed) {
        const refreshed = await operations.openYear(pkg.id);
        if (!refreshed.ok) throw new Error(`${result.error.message} Local records could not be refreshed: ${refreshed.error.message}`);
        session.acceptSaved(refreshed.value);
        setRemoving(null);
        await refreshEvidence();
        reportError(result.error.message);
        return;
      }
      if (!result.ok) throw new Error(result.error.message);
      session.acceptSaved(result.value);
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
      await flushEdits();
      const current = session.getSnapshot().record;
      if (!current) throw new Error('Open a year before deleting an activity.');
      const result = await operations.deleteActivity({
        packageId: current.id, activityId: activity.id, expectedRevision: current.contentRevision, confirmed: true,
      });
      if (!result.ok) {
        if (result.error.committed) {
          const refreshed = await operations.openYear(pkg.id);
          if (refreshed.ok) {
            session.acceptSaved(refreshed.value);
            onDeleted(refreshed.value.activities[0]?.id ?? null);
            await refreshEvidence().catch(() => {});
          }
          reportError(result.error.message);
          setDeletingActivity(false);
          return;
        }
        throw new Error(result.error.message);
      }
      session.acceptSaved(result.value);
      onDeleted(result.value.activities[0]?.id ?? null);
      setDeletingActivity(false);
      await refreshEvidence();
    } catch (failure) {
      setDeleteError(failure instanceof Error ? failure.message : String(failure));
    } finally { setDeleteBusy(false); }
  }
  async function showPreview(entry: EvidenceAttachment) {
    setFileBusy(true);
    try {
      await flushEdits();
      const result = await operations.previewEvidence({ packageId: pkg.id, activityId: activity.id, evidenceId: entry.id });
      if (!result.ok) throw new Error(result.error.message);
      setPreview(result.value);
    } catch (failure) {
      reportActionFailure(`Could not preview ${entry.ref}`, failure, {
        label: `Retry preview ${entry.ref}`, onClick: () => void showPreview(entry),
      });
    } finally { setFileBusy(false); }
  }
  async function openDocument(entry: EvidenceAttachment) {
    setFileBusy(true);
    try {
      await flushEdits();
      const result = await operations.openEvidence({ packageId: pkg.id, activityId: activity.id, evidenceId: entry.id });
      if (!result.ok) throw new Error(result.error.message);
    } catch (failure) {
      reportActionFailure(`Could not open ${entry.ref}`, failure, {
        label: `Try opening ${entry.ref} again`, onClick: () => void openDocument(entry),
      });
    } finally { setFileBusy(false); }
  }
  async function recheckEvidence() {
    try { await flushEdits(); await refreshEvidence(); }
    catch (failure) {
      reportActionFailure('Could not check evidence integrity', failure, {
        label: 'Check file integrity again', onClick: () => void recheckEvidence(),
      });
    }
  }
  return <article className="activity-editor" aria-label={`Activity editor ${activity.ref}`}>
    <div className="activity-editor-header"><span className="goal-reference">{activity.ref}</span>
      <button type="button" className="text-button delete-record" disabled={fileBusy} aria-label={`Delete activity ${activity.ref}`}
        onClick={() => { setDeleteError(''); setDeletingActivity(true); }}>Delete</button>
    </div>
    <label className="field activity-title"><span>Activity title</span><input spellCheck value={activity.title}
      onChange={event => session.editActivity(activity.id, { title: event.target.value })} /></label>
    {!activity.title.trim() && <p className="goal-validation">An activity title is required before saving.</p>}
    <label className="field"><span>Description <small>Optional</small></span><textarea aria-label="Activity description" rows={3} value={activity.description}
      onChange={event => session.editActivity(activity.id, { description: event.target.value })} /></label>
    <div className="activity-dates">
      <label className="field"><span>Activity status</span><select aria-label="Activity status" value={activity.status}
      onChange={event => {
        const status = event.target.value as ActivityStatus;
        if (status === 'Completed' && activity.status !== 'Completed') openCompletionPicker.current = true;
        if (status !== 'Completed') setFallbackCalendarOpen(false);
        session.editActivity(activity.id, { status });
      }}>
      {(['Planned', 'In Progress', 'Completed'] as const).map(status => <option key={status}>{status}</option>)}
    </select></label>
    {activity.status === 'Completed' && <div className="field completion-date-field">
      <label htmlFor={`completion-date-${activity.id}`}><span>Completion date</span></label>
      <input ref={completionDateInput} id={`completion-date-${activity.id}`} type="date" aria-label="Completion date" value={activity.completionDate}
        onKeyDown={event => { if (event.key === 'Escape') setFallbackCalendarOpen(false); }}
        onChange={event => {
          setFallbackCalendarOpen(false);
          session.editActivity(activity.id, { completionDate: event.target.value });
        }} />
      {warning && <small className="warning">{warning}</small>}
      {nativePickerUnavailable && <button type="button" className="secondary completion-calendar-toggle"
        aria-label={fallbackCalendarOpen ? 'Close calendar' : 'Open calendar'}
        aria-expanded={fallbackCalendarOpen} aria-controls={fallbackCalendarOpen ? `completion-calendar-${activity.id}` : undefined}
        onClick={() => setFallbackCalendarOpen(open => !open)}>
        {fallbackCalendarOpen ? 'Close calendar' : 'Choose date'}</button>}
      {fallbackCalendarOpen && <CompletionCalendar id={`completion-calendar-${activity.id}`} value={activity.completionDate} month={calendarMonth}
      onMonthChange={setCalendarMonth} onSelect={value => {
        setFallbackCalendarOpen(false);
        session.editActivity(activity.id, { completionDate: value });
      }} onClose={() => setFallbackCalendarOpen(false)} />}
    </div>}
    </div>
    {error && <>
      <p className="goal-validation" role="status">{error}</p>
      {saveState.status === 'Not saved' && !saveState.error && <button type="button" className="secondary"
        onClick={() => void session.retry().catch(() => {})}>Retry save</button>}
    </>}
    <fieldset className="goal-link-editor"><legend>Linked learning goals</legend>
      {pkg.goals.map(goal => <label key={goal.id}><input type="checkbox" checked={activity.goalIds.includes(goal.id)}
        onChange={event => session.editActivity(activity.id, { goalIds: event.target.checked ? [...activity.goalIds, goal.id] : activity.goalIds.filter(id => id !== goal.id) })} />
        <span><b>{goal.ref}</b> {goal.title}</span></label>)}
      <button type="button" className="text-button" onClick={addGoal}>Create and link a goal</button>
      {!activity.goalIds.length && <p>No linked goal · supplementary learning. This activity does not block Step 3.</p>}
    </fieldset>
    <label className="field narrative"><span>Evidence notes</span><small>Notes or a valid link can satisfy the evidence requirement without a file.</small>
      <textarea aria-label="Evidence notes" rows={4} value={activity.evidenceDescription}
        onChange={event => session.editActivity(activity.id, { evidenceDescription: event.target.value })} /></label>
    <label className="field"><span>Evidence links</span><small>One HTTP or HTTPS URL per line. Links open in your browser.</small>
      <textarea aria-label="Evidence links" rows={3} value={linksText} onChange={event => {
        setLinksText(event.target.value);
        session.editActivity(activity.id, { evidenceLinks: event.target.value.split('\n').map(link => link.trim()).filter(Boolean) });
      }} /></label>
    <ul className="evidence-link-actions">{activity.evidenceLinks.map((url, index) => <li key={`${index}-${url}`}>
      <span>{url}</span>{validEvidenceLink(url) ? <button type="button" className="text-button" onClick={() => void openLink(url)} aria-label={`Open evidence link ${index + 1}`}>Open in browser</button>
        : <small className="goal-validation">Enter a valid HTTP or HTTPS link.</small>}
    </li>)}</ul>
    <section className="managed-evidence" aria-labelledby={`managed-evidence-title-${activity.id}`}>
      <div className="managed-evidence-heading"><div><h3 id={`managed-evidence-title-${activity.id}`}>Attached evidence files</h3>
        <p>PDF, images, and office or text documents, up to 50 MiB each. Files are copied into SWCC storage.</p></div>
        <button type="button" disabled={fileBusy} onClick={() => void chooseEvidence()}>Import evidence file</button>
      </div>
      <button type="button" className="text-button evidence-recheck" disabled={fileBusy} onClick={() => void recheckEvidence()}>Check file integrity</button>
      {evidenceError && <div role="alert" className="goal-validation">Evidence integrity could not be checked: {evidenceError}</div>}
      {!evidenceLoaded && !evidenceError && <p role="status" className="quiet">Checking attached evidence…</p>}
      {evidenceLoaded && !attached.length && <p className="quiet">No files attached.</p>}
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
      <p className="goal-dialog-copy">This permanently deletes {activity.ref}, its evidence files, notes, links, and reflection. Linked goals and other activities are kept.</p>
      {deleteError && <p role="alert" className="goal-validation">{deleteError}</p>}
      {session.getSnapshot().status === 'Not saved' && <div className="goal-retry">
        <p>{session.getSnapshot().error || 'Some edits remain unsaved.'}</p>
        <button type="button" className="secondary" disabled={deleteBusy} onClick={() => void session.retry().catch(failure => setDeleteError(failure instanceof Error ? failure.message : String(failure)))}>Retry save</button>
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

function monthForDate(value: string) {
  const date = validDate(value) ? new Date(`${value}T00:00:00`) : new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function CompletionCalendar({ id, value, month, onMonthChange, onSelect, onClose }: {
  id: string; value: string; month: Date; onMonthChange: (month: Date) => void; onSelect: (date: string) => void; onClose: () => void;
}) {
  const year = month.getFullYear();
  const monthNumber = month.getMonth();
  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const leadingDays = new Date(year, monthNumber, 1).getDay();
  const daysInMonth = new Date(year, monthNumber + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: leadingDays }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7) cells.push(null);
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return <div id={id} className="completion-calendar" role="group" aria-label="Choose a completion date"
    onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
    <div className="completion-calendar-heading">
      <button type="button" className="secondary" aria-label="Close calendar" onClick={onClose}>Close</button>
      <button type="button" className="secondary" aria-label="Previous month"
        onClick={() => onMonthChange(new Date(year, monthNumber - 1, 1))}>‹</button>
      <strong aria-live="polite">{monthLabel}</strong>
      <button type="button" className="secondary" aria-label="Next month"
        onClick={() => onMonthChange(new Date(year, monthNumber + 1, 1))}>›</button>
    </div>
    <div className="completion-calendar-grid" role="grid" aria-label={monthLabel}>
      <div className="completion-calendar-week" role="row">
        {weekdays.map(day => <span role="columnheader" key={day} aria-label={day}>{day.slice(0, 2)}</span>)}
      </div>
      {Array.from({ length: cells.length / 7 }, (_, week) => <div className="completion-calendar-week" role="row" key={week}>
        {cells.slice(week * 7, week * 7 + 7).map((day, weekday) => {
          if (!day) return <span aria-hidden="true" key={`empty-${week}-${weekday}`} />;
          const date = `${year}-${String(monthNumber + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          return <button type="button" role="gridcell" aria-label={new Date(year, monthNumber, day)
            .toLocaleDateString(undefined, { dateStyle: 'full' })} aria-pressed={value === date} key={date}
            onClick={() => onSelect(date)}>{day}</button>;
        })}
      </div>)}
    </div>
  </div>;
}

export function PlanScreen({ pkg, session, operations, selectedId, select, onSelectActivity, recordRequested, clearRecordRequest, evidence, evidenceError, evidenceLoaded, refreshEvidence, reportError, complete, busy, flushEdits, motionDisabled }: {
  pkg: YearPackage; session: DraftSession; operations: ApplicationOperations; selectedId: string | null;
  select: (id: string | null) => void; onSelectActivity: (id: string) => void;
  recordRequested: boolean; clearRecordRequest: () => void;
  evidence: EvidenceAttachment[]; evidenceError: string; evidenceLoaded: boolean; refreshEvidence: () => Promise<EvidenceAttachment[]>;
  complete: () => void; busy: boolean;
  reportError: (message: string) => void;
  flushEdits: () => Promise<void>;
  motionDisabled: boolean;
}) {
  const [creating, setCreating] = useState(recordRequested);
  const [creatingGoal, setCreatingGoal] = useState<{ activityId?: string } | null>(null);
  const [deletingGoal, setDeletingGoal] = useState<Goal | null>(null);
  const [revealingActivityId, setRevealingActivityId] = useState<string | null>(null);
  const [revealingGoalId, setRevealingGoalId] = useState<string | null>(null);
  useEffect(() => {
    if (!motionDisabled) return;
    setRevealingActivityId(null);
    setRevealingGoalId(null);
  }, [motionDisabled]);
  const activity = pkg.activities.find(item => item.id === selectedId) ?? pkg.activities[0];
  function closeCreate() { setCreating(false); clearRecordRequest(); }
  function created(id: string) {
    if (!motionDisabled) setRevealingActivityId(id);
    select(id);
    closeCreate();
  }
  return <>
    <div className="page-heading map-heading"><h1>Development plan</h1>
      <button type="button" onClick={() => setCreating(true)}>Add activity</button></div>
    <section className="goal-connection-strip" aria-labelledby="plan-goals-title">
      <div className="section-heading"><h2 id="plan-goals-title">Goal connections</h2><button type="button" className="text-button" onClick={() => setCreatingGoal({})}>Add goal</button></div>
      <div className="plan-goal-list">{pkg.goals.map(goal => <article key={goal.id}
        className={`plan-goal${revealingGoalId === goal.id ? ' record-reveal' : ''}`} aria-label={`${goal.ref} ${goal.title}`}
        onAnimationEnd={event => {
          if (isRecordRevealAnimationEnd(event)) setRevealingGoalId(null);
        }}>
        <span className="goal-reference">{goal.ref}</span><div><h3>{goal.title}</h3>{goal.description && <p>{goal.description}</p>}
          <div className="goal-activity-refs">{pkg.activities.filter(item => item.goalIds.includes(goal.id)).map(item => <button type="button" key={item.id}
            className={activity?.id === item.id ? 'chosen' : 'secondary'} aria-label={`Edit ${item.ref} from ${goal.ref}`} onClick={() => onSelectActivity(item.id)}>{item.ref}</button>)}</div></div>
        <button type="button" className="text-button" aria-label={`Delete goal ${goal.ref}`} onClick={() => setDeletingGoal(goal)}>Remove</button>
      </article>)}</div>
      {!pkg.goals.length && <p className="empty">No learning goals yet.</p>}
      {pkg.activities.some(item => item.goalIds.length > 0) && <p className="quiet">Select an activity reference to edit it.</p>}
    </section>
    <div className="map-plan-body"><aside><h2>Activity records</h2><div className="activity-index">
      {pkg.activities.map(item => <button type="button" key={item.id} aria-label={`Select activity ${item.ref}`} aria-pressed={activity?.id === item.id}
        className={`${activity?.id === item.id ? 'selected' : ''}${revealingActivityId === item.id ? ' record-reveal' : ''}`}
        onAnimationEnd={event => {
          if (isRecordRevealAnimationEnd(event)) setRevealingActivityId(null);
        }} onClick={() => onSelectActivity(item.id)}>
        <span className="goal-reference">{item.ref}</span><strong>{item.title}</strong><small>{item.status}</small>
        <small>{item.goalIds.length ? pkg.goals.filter(goal => item.goalIds.includes(goal.id)).map(goal => goal.ref).join(', ') : 'No linked goal · supplementary'}</small>
      </button>)}</div>
      <DateField pkg={pkg} session={session} field="planDate" label="Plan date" />
      <PlanReadinessPanel pkg={pkg}
        readableEvidenceActivityIds={new Set(evidence.filter(entry => entry.integrity === 'readable').map(entry => entry.activityId))}
        complete={complete} busy={busy} /></aside>
      {activity ? <ActivityEditor key={activity.id} activity={activity} pkg={pkg} session={session} operations={operations}
        addGoal={() => setCreatingGoal({ activityId: activity.id })} evidence={evidence} evidenceError={evidenceError}
        evidenceLoaded={evidenceLoaded} refreshEvidence={refreshEvidence} onDeleted={select} reportError={reportError} flushEdits={flushEdits} />
        : <section className="surface empty-editor"><h2>No activities yet</h2><p>Select Add activity to record learning and attach evidence.</p></section>}
    </div>
    {creating && <ActivityCreateDialog pkg={pkg} session={session} flushEdits={flushEdits} onClose={closeCreate} onCreated={created} />}
    {creatingGoal && <GoalCreateDialog source="plan" session={session} flushEdits={flushEdits}
      activityId={creatingGoal.activityId} onClose={() => setCreatingGoal(null)}
      onCreated={id => { if (!motionDisabled) setRevealingGoalId(id); }} />}
    {deletingGoal && <GoalDeleteDialog goal={deletingGoal} session={session} operations={operations} flushEdits={flushEdits} onClose={() => setDeletingGoal(null)} />}
  </>;
}
