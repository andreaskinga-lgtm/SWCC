import type { Activity, ActivityFields, ApplicationOperations, CreateGoal, Draft, Goal, Result, YearPackage } from '../shared/application.js';
import { activityDateError } from '../shared/plan.js';

type PendingGoal = Pick<CreateGoal, 'title' | 'description' | 'activityId'>;
type PendingActivity = Pick<ActivityFields, 'title' | 'description' | 'goalIds'>;

export interface DraftState {
  record: YearPackage | null;
  status: 'Saved' | 'Saving' | 'Not saved';
  error: string | null;
  failureEvent: { sequence: number; message: string } | null;
  pendingGoalCreation: PendingGoal | null;
  pendingActivityCreation: PendingActivity | null;
}
type GoalEdit = { goal: Goal; version: number };
type ActivityEdit = { activity: Activity; version: number };

function sameStandards(left: Draft['annualStandards'], right: Draft['annualStandards']) {
  return left.length === right.length && left.every(id => right.includes(id));
}

export class DraftSession {
  private current: DraftState = {
    record: null, status: 'Saved', error: null, failureEvent: null, pendingGoalCreation: null, pendingActivityCreation: null,
  };
  private version = 0;
  private savedVersion = 0;
  private draftVersion = 0;
  private savedDraftVersion = 0;
  private failureSequence = 0;
  private failureReported = false;
  private explicitRetry = false;
  private goalEdits = new Map<string, GoalEdit>();
  private pendingGoalCreation: PendingGoal | null = null;
  private activityEdits = new Map<string, ActivityEdit>();
  private pendingActivityCreation: PendingActivity | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<void> | undefined;
  private listeners = new Set<() => void>();
  constructor(private operations: ApplicationOperations) {}
  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(state: DraftState) { this.current = state; this.listeners.forEach(listener => listener()); }
  open(record: YearPackage | null) {
    if (this.version !== this.savedVersion || this.saving) throw new Error('Save pending edits before opening another package.');
    this.version = 0;
    this.savedVersion = 0;
    this.draftVersion = 0;
    this.savedDraftVersion = 0;
    this.goalEdits.clear();
    this.pendingGoalCreation = null;
    this.activityEdits.clear();
    this.pendingActivityCreation = null;
    this.failureReported = false;
    this.explicitRetry = false;
    this.update({
      record, status: 'Saved', error: null, failureEvent: this.current.failureEvent,
      pendingGoalCreation: null, pendingActivityCreation: null,
    });
  }
  edit(patch: Partial<Draft>) {
    const record = this.current.record;
    if (!record) return;
    const changed = Object.entries(patch).some(([key, value]) => {
      if (key === 'annualStandards') return !sameStandards(record.annualStandards, value as Draft['annualStandards']);
      return record[key as keyof Draft] !== value;
    });
    if (!changed) return;
    this.version++;
    this.draftVersion++;
    this.update({
      ...this.current, record: { ...record, ...patch }, status: 'Saving', error: null,
    });
    this.scheduleSave();
  }
  editGoal(goalId: string, patch: Partial<Pick<Goal, 'title' | 'description'>>) {
    const record = this.current.record;
    const existing = record?.goals.find(goal => goal.id === goalId);
    if (!record || !existing) return;
    const goal = { ...existing, ...patch };
    if (goal.title === existing.title && goal.description === existing.description) return;
    this.version++;
    this.goalEdits.set(goalId, { goal, version: this.version });
    this.update({
      ...this.current,
      record: { ...record, goals: record.goals.map(item => item.id === goalId ? goal : item) },
      status: 'Saving', error: null,
    });
    this.scheduleSave();
  }
  editActivity(activityId: string, patch: Partial<ActivityFields>) {
    const record = this.current.record;
    const existing = record?.activities.find(activity => activity.id === activityId);
    if (!record || !existing) return;
    const activity = { ...existing, ...patch };
    if (Object.keys(patch).every(key => JSON.stringify(activity[key as keyof ActivityFields]) === JSON.stringify(existing[key as keyof ActivityFields]))) return;
    this.version++;
    this.activityEdits.set(activityId, { activity, version: this.version });
    this.update({
      ...this.current, record: { ...record, activities: record.activities.map(item => item.id === activityId ? activity : item) },
      status: 'Saving', error: null,
    });
    this.scheduleSave();
  }
  async createActivity(title: string, description: string, goalIds: string[]) {
    if (!this.current.record) throw new Error('Open a year before recording an activity.');
    if (!title.trim()) throw new Error('Enter an activity title before saving.');
    if (this.pendingActivityCreation) throw new Error('Retry the activity already waiting to be saved.');
    this.version++;
    this.pendingActivityCreation = { title, description, goalIds };
    this.update({ ...this.current, pendingActivityCreation: this.pendingActivityCreation, status: 'Saving', error: null });
    await this.flush();
  }
  async createGoal(title: string, description: string, activityId?: string) {
    if (!this.current.record) throw new Error('Open a year package before adding a learning goal.');
    if (!title.trim()) throw new Error('Enter a learning-goal title before saving.');
    if (this.pendingGoalCreation) throw new Error('A learning goal is already waiting to be saved. Retry that save first.');
    this.version++;
    this.pendingGoalCreation = { title, description, ...(activityId ? { activityId } : {}) };
    this.update({ ...this.current, pendingGoalCreation: this.pendingGoalCreation, status: 'Saving', error: null });
    await this.flush();
  }
  private scheduleSave() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 400);
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.saving) return this.saving;
    this.saving = this.savePending().finally(() => { this.saving = undefined; });
    return this.saving;
  }
  retry(): Promise<void> {
    clearTimeout(this.timer);
    const saving = this.saving;
    if (!saving) {
      this.explicitRetry = true;
      return this.flush();
    }
    return saving.catch(() => {}).then(() => {
      this.explicitRetry = true;
      return this.flush();
    });
  }
  async withSavedRecord(work: (record: YearPackage) => Promise<void>): Promise<void> {
    await this.flush();
    const record = this.current.record;
    if (!record) throw new Error('Open a year before changing saved records.');
    this.saving = (async () => {
      try { await work(record); }
      finally { await this.savePending(); }
    })().finally(() => { this.saving = undefined; });
    return this.saving;
  }
  private async savedResult(
    work: () => Promise<Result<YearPackage>>,
    connectionError = 'The desktop connection failed. Keep your edits here and retry saving.',
  ): Promise<YearPackage> {
    let result;
    try { result = await work(); }
    catch { result = { ok: false as const, error: { code: 'IPC' as const, message: connectionError } }; }
    if (!result.ok) {
      const reportable = result.error.code !== 'VALIDATION';
      const report = reportable && (!this.failureReported || this.explicitRetry);
      if (reportable) this.failureReported = true;
      this.explicitRetry = false;
      this.update({
        ...this.current,
        status: 'Not saved',
        error: result.error.message,
        failureEvent: report ? { sequence: ++this.failureSequence, message: result.error.message } : this.current.failureEvent,
      });
      throw new Error(result.error.message);
    }
    return result.value;
  }
  private async savePending() {
    while (this.current.record && (
      this.savedDraftVersion !== this.draftVersion || this.goalEdits.size > 0 || this.pendingGoalCreation
      || this.activityEdits.size > 0 || this.pendingActivityCreation
    )) {
      if (this.savedDraftVersion !== this.draftVersion) {
        const draftVersion = this.draftVersion;
        const record = this.current.record;
        this.update({ ...this.current, status: 'Saving', error: null });
        const saved = await this.savedResult(() => this.operations.saveDraft({
          packageId: record.id, expectedRevision: record.contentRevision,
          draft: {
            assessmentDate: record.assessmentDate, planDate: record.planDate, strengths: record.strengths,
            peerFeedback: record.peerFeedback, learningNeeds: record.learningNeeds, annualStandards: record.annualStandards,
          },
        }));
        if (this.draftVersion === draftVersion) this.savedDraftVersion = draftVersion;
        this.applySaved(saved);
        continue;
      }

      if (this.goalEdits.size > 0) {
        const [goalId, edit] = this.goalEdits.entries().next().value as [string, GoalEdit];
        const record = this.current.record;
        this.update({ ...this.current, status: 'Saving', error: null });
        const saved = await this.savedResult(() => this.operations.updateGoal({
          packageId: record.id, goalId, expectedRevision: record.contentRevision,
          title: edit.goal.title, description: edit.goal.description,
        }));
        if (this.goalEdits.get(goalId)?.version === edit.version) this.goalEdits.delete(goalId);
        this.applySaved(saved);
        continue;
      }

      if (this.activityEdits.size > 0) {
        const [activityId, edit] = this.activityEdits.entries().next().value as [string, ActivityEdit];
        const validationError = activityDateError(edit.activity);
        if (validationError) throw new Error(validationError);
        const record = this.current.record;
        this.update({ ...this.current, status: 'Saving', error: null });
        const { title, description, status, completionDate, evidenceDescription, evidenceLinks, applicationToPractice, goalIds } = edit.activity;
        const saved = await this.savedResult(() => this.operations.updateActivity({
          packageId: record.id, expectedRevision: record.contentRevision, activityId,
          title, description, status, completionDate, evidenceDescription, evidenceLinks, applicationToPractice, goalIds,
        }));
        if (this.activityEdits.get(activityId)?.version === edit.version) this.activityEdits.delete(activityId);
        this.applySaved(saved);
        continue;
      }

      if (this.pendingActivityCreation) {
        const request = this.pendingActivityCreation;
        const record = this.current.record;
        const saved = await this.savedResult(() => this.operations.createActivity({
          ...request, packageId: record.id, expectedRevision: record.contentRevision,
        }), 'The desktop connection failed. Keep this activity here and retry saving.');
        this.pendingActivityCreation = null;
        this.update({ ...this.current, pendingActivityCreation: null });
        this.applySaved(saved);
        continue;
      }

      if (this.pendingGoalCreation) {
        const request = this.pendingGoalCreation;
        const record = this.current.record;
        this.update({ ...this.current, status: 'Saving', error: null });
        const saved = await this.savedResult(() => this.operations.createGoal({
          packageId: record.id, expectedRevision: record.contentRevision,
          title: request.title, description: request.description,
          ...(request.activityId ? { activityId: request.activityId } : {}),
        }));
        this.pendingGoalCreation = null;
        this.update({ ...this.current, pendingGoalCreation: null });
        this.applySaved(saved);
      }
    }
    this.savedVersion = this.version;
    this.failureReported = false;
    this.explicitRetry = false;
    this.update({ ...this.current, status: 'Saved', error: null });
  }
  acceptSaved(saved: YearPackage) {
    const current = this.current.record;
    if (!current || current.id !== saved.id) return;
    const goals = saved.goals.map(goal => this.goalEdits.has(goal.id)
      ? current.goals.find(item => item.id === goal.id) ?? goal
      : goal);
    const draft = this.savedDraftVersion === this.draftVersion ? {} : {
      assessmentDate: current.assessmentDate,
      planDate: current.planDate,
      strengths: current.strengths,
      peerFeedback: current.peerFeedback,
      learningNeeds: current.learningNeeds,
      annualStandards: current.annualStandards,
    };
    const activities = saved.activities.map(activity => this.activityEdits.has(activity.id)
      ? current.activities.find(item => item.id === activity.id) ?? activity
      : activity);
    this.update({ ...this.current, record: { ...saved, ...draft, goals, activities } });
  }
  private applySaved(saved: YearPackage) { this.acceptSaved(saved); }
}
