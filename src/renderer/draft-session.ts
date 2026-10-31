import type { ApplicationOperations, Draft, Goal, YearPackage } from '../shared/application.js';

export interface DraftState {
  record: YearPackage | null;
  status: 'Saved' | 'Saving' | 'Not saved';
  error: string | null;
  pendingGoalCreation: { title: string; description: string } | null;
}
type GoalEdit = { goal: Goal; version: number };

function sameStandards(left: Draft['annualStandards'], right: Draft['annualStandards']) {
  return left.length === right.length && left.every(id => right.includes(id));
}

export class DraftSession {
  private current: DraftState = { record: null, status: 'Saved', error: null, pendingGoalCreation: null };
  private version = 0;
  private savedVersion = 0;
  private draftVersion = 0;
  private savedDraftVersion = 0;
  private goalEdits = new Map<string, GoalEdit>();
  private pendingGoalCreation: { title: string; description: string } | null = null;
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
    this.update({ record, status: 'Saved', error: null, pendingGoalCreation: null });
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
      record: { ...record, ...patch }, status: 'Saving', error: null,
      pendingGoalCreation: this.pendingGoalCreation,
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
      record: { ...record, goals: record.goals.map(item => item.id === goalId ? goal : item) },
      status: 'Saving', error: null, pendingGoalCreation: this.pendingGoalCreation,
    });
    this.scheduleSave();
  }
  async createGoal(title: string, description: string) {
    if (!this.current.record) throw new Error('Open a year package before adding a learning goal.');
    if (!title.trim()) throw new Error('Enter a learning-goal title before saving.');
    if (this.pendingGoalCreation) throw new Error('A learning goal is already waiting to be saved. Retry that save first.');
    this.version++;
    this.pendingGoalCreation = { title, description };
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
  private async savePending() {
    while (this.current.record && (
      this.savedDraftVersion !== this.draftVersion || this.goalEdits.size > 0 || this.pendingGoalCreation
    )) {
      if (this.savedDraftVersion !== this.draftVersion) {
        const draftVersion = this.draftVersion;
        const record = this.current.record;
        this.update({ ...this.current, status: 'Saving', error: null });
        let result;
        try {
          result = await this.operations.saveDraft({
            packageId: record.id, expectedRevision: record.contentRevision,
            draft: {
              assessmentDate: record.assessmentDate, planDate: record.planDate, strengths: record.strengths,
              peerFeedback: record.peerFeedback, learningNeeds: record.learningNeeds, annualStandards: record.annualStandards,
            },
          });
        } catch {
          result = { ok: false as const, error: { message: 'The desktop connection failed. Keep your edits here and retry saving.' } };
        }
        if (!result.ok) {
          this.update({ ...this.current, status: 'Not saved', error: result.error.message });
          throw new Error(result.error.message);
        }
        if (this.draftVersion === draftVersion) this.savedDraftVersion = draftVersion;
        this.applySaved(result.value);
        continue;
      }

      if (this.goalEdits.size > 0) {
        const [goalId, edit] = this.goalEdits.entries().next().value as [string, GoalEdit];
        const record = this.current.record;
        this.update({ ...this.current, status: 'Saving', error: null });
        let result;
        try {
          result = await this.operations.updateGoal({
            packageId: record.id, goalId, expectedRevision: record.contentRevision,
            title: edit.goal.title, description: edit.goal.description,
          });
        } catch {
          result = { ok: false as const, error: { message: 'The desktop connection failed. Keep your edits here and retry saving.' } };
        }
        if (!result.ok) {
          this.update({ ...this.current, status: 'Not saved', error: result.error.message });
          throw new Error(result.error.message);
        }
        if (this.goalEdits.get(goalId)?.version === edit.version) this.goalEdits.delete(goalId);
        this.applySaved(result.value);
        continue;
      }

      if (this.pendingGoalCreation) {
        const request = this.pendingGoalCreation;
        const record = this.current.record;
        this.update({ ...this.current, status: 'Saving', error: null });
        let result;
        try {
          result = await this.operations.createGoal({
            packageId: record.id, expectedRevision: record.contentRevision,
            title: request.title, description: request.description,
          });
        } catch {
          result = { ok: false as const, error: { message: 'The desktop connection failed. Keep your edits here and retry saving.' } };
        }
        if (!result.ok) {
          this.update({ ...this.current, status: 'Not saved', error: result.error.message });
          throw new Error(result.error.message);
        }
        this.pendingGoalCreation = null;
        this.update({ ...this.current, pendingGoalCreation: null });
        this.applySaved(result.value);
      }
    }
    this.savedVersion = this.version;
    this.update({ ...this.current, status: 'Saved', error: null });
  }
  private applySaved(saved: YearPackage) {
    const current = this.current.record;
    if (!current) return;
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
    this.update({ ...this.current, record: { ...saved, ...draft, goals } });
  }
}
