import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { ApplicationOperations, Goal, YearPackage } from '../shared/application.js';
import { ANNUAL_STANDARDS, dateWarning } from '../shared/application.js';
import { evaluateAssessmentReadiness } from '../shared/assessment.js';
import { DraftSession } from './draft-session.js';
import './assessment.css';

function PageHeading({ title, description }: { title: string; description: string }) {
  return <div className="page-heading"><h1>{title}</h1><p>{description}</p></div>;
}

export function DateField({ pkg, session, label, field }: {
  pkg: YearPackage;
  session: DraftSession;
  label: string;
  field: 'assessmentDate' | 'planDate';
}) {
  const warning = dateWarning(pkg[field], pkg.year);
  return <label className="field date-field">
    <span>{label}</span>
    <input type="date" aria-label={label} value={pkg[field]} onChange={event => session.edit({ [field]: event.target.value })} />
    {warning && <small className="warning">{warning}</small>}
  </label>;
}

export function Dialog({ title, children, onClose, className = 'goal-dialog' }: {
  title: string; children: ReactNode; onClose: () => void; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} className={className} aria-label={title}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === ref.current) onClose(); }}>
    <div className="goal-dialog-header"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button></div>
    {children}
  </dialog>;
}

function GoalEditor({ goal, session, onDelete }: { goal: Goal; session: DraftSession; onDelete: (goal: Goal) => void }) {
  return <article className="goal-editor" aria-label={`Learning goal ${goal.ref}`}>
    <div className="goal-editor-top"><span className="goal-reference">{goal.ref}</span>
      <button type="button" className="icon-button" aria-label={`Delete goal ${goal.ref}`} onClick={() => onDelete(goal)}><Trash2 size={16} /></button>
    </div>
    <label className="field"><span>Goal title</span><input aria-label={`Goal title ${goal.ref}`} value={goal.title}
      onChange={event => session.editGoal(goal.id, { title: event.target.value })} /></label>
    {!goal.title.trim() && <small className="goal-validation">A learning-goal title is required before this edit can be saved.</small>}
    <label className="field"><span>Description <small>Optional</small></span><textarea aria-label={`Goal description ${goal.ref}`} rows={2} value={goal.description}
      onChange={event => session.editGoal(goal.id, { description: event.target.value })} /></label>
  </article>;
}

export function GoalCreateDialog({ source, session, onClose, activityId }: {
  source: 'assessment' | 'plan';
  session: DraftSession;
  onClose: () => void;
  activityId?: string;
}) {
  const state = useSyncSession(session);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [validationError, setValidationError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const pending = state.pendingGoalCreation !== null;
  const titleText = source === 'plan' ? 'Create a shared learning goal' : 'Add a learning goal';
  const actionText = source === 'plan' ? 'Create goal' : 'Add goal';
  useEffect(() => {
    if (submitted && !state.pendingGoalCreation && state.status === 'Saved') onClose();
  }, [onClose, state.pendingGoalCreation, state.status, submitted]);
  function close() {
    if (pending) {
      setValidationError('This goal is waiting to be saved. Retry saving before closing.');
      return;
    }
    onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) { setValidationError('Name the goal before adding it.'); return; }
    setValidationError('');
    setSubmitted(true);
    try { await session.createGoal(title, description, activityId); }
    catch (error) { setValidationError(error instanceof Error ? error.message : String(error)); }
  }
  async function retry() {
    setValidationError('');
    try { await session.flush(); }
    catch (error) { setValidationError(error instanceof Error ? error.message : String(error)); }
  }
  return <Dialog title={titleText} onClose={close}>
    <p className="goal-dialog-copy">{source === 'plan'
      ? 'This goal appears in both your annual self-assessment and development plan.'
      : 'The same goal will appear in your development plan. Goals do not have individual standards.'}</p>
    <form onSubmit={event => void submit(event)}>
      <label className="field"><span>Goal title</span><input autoFocus aria-label="Goal title" value={pending ? state.pendingGoalCreation?.title ?? title : title}
        disabled={pending} onChange={event => setTitle(event.target.value)} /></label>
      <label className="field"><span>Description <small>(optional)</small></span><textarea aria-label="Description (optional)" rows={3}
        value={pending ? state.pendingGoalCreation?.description ?? description : description}
        disabled={pending} onChange={event => setDescription(event.target.value)} /></label>
      {validationError && <p className="goal-validation" role="alert">{validationError}</p>}
      {state.status === 'Not saved' && pending && <div className="goal-retry">
        <p>{state.error || 'The goal has not been saved. Keep this window open and retry.'}</p>
        <button type="button" className="secondary" onClick={() => void retry()}>Retry save</button>
      </div>}
      <div className="goal-dialog-actions">
        <button type="button" className="secondary" disabled={pending} onClick={close}>Cancel</button>
        <button type="submit" disabled={pending}>{actionText}</button>
      </div>
    </form>
  </Dialog>;
}

export function GoalDeleteDialog({ goal, session, operations, onClose }: {
  goal: Goal;
  session: DraftSession;
  operations: ApplicationOperations;
  onClose: () => void;
}) {
  const draftState = useSyncSession(session);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await session.flush();
      const current = session.getSnapshot().record;
      if (!current) throw new Error('Open a year package before deleting a learning goal.');
      const result = await operations.deleteGoal({
        packageId: current.id, goalId: goal.id, expectedRevision: current.contentRevision, confirmed: true,
      });
      if (!result.ok) throw new Error(result.error.message);
      session.open(result.value);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setBusy(false); }
  }
  async function retrySave() {
    setError(null);
    try { await session.flush(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }
  return <Dialog title={`Delete ${goal.ref}?`} onClose={() => { if (!busy) onClose(); }}>
    <p>This removes {goal.ref} and its activity links from the shared goal set. Activities, evidence notes and links, managed files, and reflections stay; activities with no remaining links stay as supplementary learning. The reference will not be reused.</p>
    {error && <p className="goal-validation" role="alert">{error}</p>}
    {draftState.status === 'Not saved' && <div className="goal-retry">
      <p>{draftState.error || 'Some edits remain unsaved.'}</p>
      <button type="button" className="secondary" disabled={busy} onClick={() => void retrySave()}>Retry save</button>
    </div>}
    <div className="goal-dialog-actions">
      <button type="button" className="secondary" disabled={busy} onClick={onClose}>Keep goal</button>
      <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>Delete goal</button>
    </div>
  </Dialog>;
}

function useSyncSession(session: DraftSession) {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}

function ReadinessPanel({ pkg }: { pkg: YearPackage }) {
  const readiness = evaluateAssessmentReadiness(pkg);
  return <section className={`readiness-panel ${readiness.ready ? 'ready' : ''}`} aria-labelledby="assessment-readiness-title">
    <div className="readiness-heading"><h2 id="assessment-readiness-title">Step 2 · Self-assessment</h2>
      <span className={`readiness-status ${readiness.ready ? 'ready' : ''}`} role="status" aria-label="Step 2 readiness">
        {readiness.ready ? 'Ready' : 'In progress'}
      </span>
    </div>
    <p>{readiness.ready ? 'All Step 2 readiness items are present.' : 'Use this checklist while you work. Drafts remain saveable.'}</p>
    {!readiness.ready && <ul aria-label="Step 2 missing items" className="readiness-missing">
      {readiness.missing.map(item => <li key={item}>{item}</li>)}
    </ul>}
    <small>Readiness is calculated separately from manual step completion.</small>
  </section>;
}

export function AssessmentScreen({ pkg, session, operations }: {
  pkg: YearPackage;
  session: DraftSession;
  operations: ApplicationOperations;
}) {
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Goal | null>(null);
  return <>
    <PageHeading title="Reflect on your practice." description={`Your ${pkg.year} annual self-assessment. Incomplete writing and selections can be saved as a draft.`} />
    <div className="assessment-layout">
      <section className="surface assessment-writing">
        <DateField pkg={pkg} session={session} field="assessmentDate" label="Assessment date" />
        <label className="field narrative"><span>Strengths</span><small>What are you doing well in your practice?</small>
          <textarea aria-label="Strengths" rows={5} value={pkg.strengths} onChange={event => session.edit({ strengths: event.target.value })} /></label>
        <label className="field narrative"><span>Peer feedback <small>Optional</small></span><small>What would others say? You can record “Not applicable.”</small>
          <textarea aria-label="Peer feedback" rows={4} value={pkg.peerFeedback} onChange={event => session.edit({ peerFeedback: event.target.value })} /></label>
        <label className="field narrative"><span>Learning needs and interests</span><small>Where would further learning benefit your practice?</small>
          <textarea aria-label="Learning needs and interests" rows={5} value={pkg.learningNeeds} onChange={event => session.edit({ learningNeeds: event.target.value })} /></label>
        <fieldset className="standard-choices">
          <legend>Relevant annual standards</legend>
          <p>These choices belong to this year’s self-assessment, not to individual goals.</p>
          {ANNUAL_STANDARDS.map(standard => <label key={standard.id}>
            <input type="checkbox" checked={pkg.annualStandards.includes(standard.id)}
              onChange={event => session.edit({ annualStandards: event.target.checked
                ? [...pkg.annualStandards, standard.id]
                : pkg.annualStandards.filter(id => id !== standard.id) })} />
            <span>{standard.label}</span>
          </label>)}
        </fieldset>
      </section>
      <aside className="assessment-side">
        <section className="goals-section">
          <div className="section-heading"><h2>Learning goals</h2><button type="button" className="text-button" onClick={() => setCreating(true)}><Plus size={15} />Add goal</button></div>
          <p className="quiet">One shared set of goals for the self-assessment and development plan.</p>
          {pkg.goals.map(goal => <GoalEditor key={goal.id} goal={goal} session={session} onDelete={setDeleting} />)}
          {!pkg.goals.length && <p className="empty">Add a learning goal here or from the development plan.</p>}
        </section>
        <ReadinessPanel pkg={pkg} />
      </aside>
    </div>
    {creating && <GoalCreateDialog source="assessment" session={session} onClose={() => setCreating(false)} />}
    {deleting && <GoalDeleteDialog goal={deleting} session={session} operations={operations} onClose={() => setDeleting(null)} />}
  </>;
}
