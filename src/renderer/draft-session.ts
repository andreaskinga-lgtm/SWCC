import type { ApplicationOperations, Draft, YearPackage } from '../shared/application.js';

export interface DraftState {
  record: YearPackage | null;
  status: 'Saved' | 'Saving' | 'Not saved';
  error: string | null;
}
export class DraftSession {
  private current: DraftState = { record: null, status: 'Saved', error: null };
  private version = 0;
  private savedVersion = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<void> | undefined;
  private listeners = new Set<() => void>();
  constructor(private operations: ApplicationOperations) {}
  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(state: DraftState) { this.current = state; this.listeners.forEach(listener => listener()); }
  open(record: YearPackage | null) {
    if (this.version !== this.savedVersion || this.saving) throw new Error('Save pending edits before opening another package.');
    this.update({ record, status: 'Saved', error: null });
  }
  edit(patch: Partial<Draft>) {
    if (!this.current.record) return;
    this.version++;
    this.update({ record: { ...this.current.record, ...patch }, status: 'Saving', error: null });
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
    while (this.savedVersion !== this.version && this.current.record) {
      const version = this.version;
      const record = this.current.record;
      this.update({ ...this.current, status: 'Saving', error: null });
      let result;
      try {
        result = await this.operations.saveDraft({
          packageId: record.id, expectedRevision: record.contentRevision,
          draft: { assessmentDate: record.assessmentDate, planDate: record.planDate, strengths: record.strengths, peerFeedback: record.peerFeedback, learningNeeds: record.learningNeeds },
        });
      } catch {
        result = { ok: false as const, error: { message: 'The desktop connection failed. Keep your edits here and retry saving.' } };
      }
      if (!result.ok) {
        this.update({ ...this.current, status: 'Not saved', error: result.error.message });
        throw new Error(result.error.message);
      }
      this.savedVersion = version;
      // New keystrokes remain visible while the revision advances underneath.
      const latest = this.current.record!;
      this.update({
        record: version === this.version ? result.value : { ...latest, contentRevision: result.value.contentRevision, assessmentRevision: result.value.assessmentRevision, planRevision: result.value.planRevision, updatedAt: result.value.updatedAt },
        status: version === this.version ? 'Saved' : 'Saving', error: null,
      });
    }
  }
}
