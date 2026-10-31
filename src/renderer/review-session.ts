import type { ApplicationOperations, Result } from '../shared/application.js';
import type { ReviewPosition, ReviewSectionId, ReviewState } from '../shared/review.js';

interface Snapshot {
  record: ReviewState | null;
  status: 'Saved' | 'Saving' | 'Not saved';
  error: string | null;
}
export class ReviewSession {
  private current: Snapshot = { record: null, status: 'Saved', error: null };
  private listeners = new Set<() => void>();
  private jobs: (() => Promise<Result<ReviewState>>)[] = [];
  private saving: Promise<void> | undefined;
  private position: ReviewPosition | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pendingVisits = new Set<number>();
  private opening = 0;
  constructor(private operations: ApplicationOperations) {}
  getSnapshot = () => this.current;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<Snapshot>) {
    this.current = { ...this.current, ...patch };
    this.listeners.forEach(listener => listener());
  }
  async open(packageId: string) {
    await this.flush();
    const opening = ++this.opening;
    this.update({ record: null, status: 'Saving', error: null });
    const result = await this.operations.getReview(packageId);
    if (opening !== this.opening) return;
    if (!result.ok) { this.update({ status: 'Not saved', error: result.error.message }); return; }
    this.pendingVisits.clear();
    this.update({ record: result.value, status: 'Saved', error: null });
  }
  move(page: number, offset: number, zoom: number) {
    const record = this.current.record;
    if (!record || record.page === page && record.offset === offset && record.zoom === zoom) return;
    this.position = { packageId: record.packageId, page, offset, zoom };
    this.update({ record: { ...record, page, offset, zoom }, status: this.current.error ? 'Not saved' : 'Saving' });
    clearTimeout(this.timer);
    if (!this.current.error) this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 150);
  }
  visit(page: number) {
    const record = this.current.record;
    if (!record || record.visitedPages.includes(page) || this.pendingVisits.has(page)) return;
    this.pendingVisits.add(page);
    this.enqueue(async () => {
      const result = await this.operations.recordReviewVisits({ packageId: record.packageId, pages: [page] });
      if (result.ok || result.error.code === 'INACTIVE') this.pendingVisits.delete(page);
      return result;
    });
  }
  resetSection(sectionId: ReviewSectionId) {
    const id = this.current.record?.packageId;
    if (id) this.enqueue(() => this.operations.resetReviewSection({ packageId: id, sectionId }));
  }
  launchResources() {
    const id = this.current.record?.packageId;
    if (id) this.enqueue(() => this.operations.launchReviewResources(id));
  }
  resetResources() {
    const id = this.current.record?.packageId;
    if (id) this.enqueue(() => this.operations.resetReviewResources(id));
  }
  private enqueue(job: () => Promise<Result<ReviewState>>) {
    this.jobs.push(job);
    this.update({ status: 'Saving', error: null });
    void this.flush().catch(() => {});
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.saving) return this.saving;
    this.saving = this.savePending().finally(() => { this.saving = undefined; });
    return this.saving;
  }
  private async savePending() {
    while (this.jobs.length || this.position) {
      if (this.position) {
        const position = this.position;
        this.position = undefined;
        this.jobs.push(() => this.operations.saveReviewPosition(position));
      }
      const job = this.jobs[0];
      this.update({ status: 'Saving', error: null });
      let result: Result<ReviewState>;
      try { result = await job(); }
      catch { result = { ok: false, error: { code: 'IPC', message: 'Review could not reach local storage. Keep this reader open and retry.' } }; }
      if (!result.ok && result.error.code === 'INACTIVE') { this.jobs.shift(); continue; }
      if (!result.ok) {
        // Browser failure is an unsuccessful action, not an unsaved draft.
        if (result.error.code === 'BROWSER' || result.error.code === 'VALIDATION') this.jobs.shift();
        this.update({ status: result.error.code === 'BROWSER' || result.error.code === 'VALIDATION' ? 'Saved' : 'Not saved', error: result.error.message });
        throw new Error(result.error.message);
      }
      this.jobs.shift();
      const latest = this.current.record;
      this.update({ record: latest ? { ...result.value, page: latest.page, offset: latest.offset, zoom: latest.zoom } : result.value });
    }
    this.update({ status: 'Saved', error: null });
  }
}
