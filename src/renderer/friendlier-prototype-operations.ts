// PROTOTYPE: fictional records, held only in memory. Reload to wipe all edits.
import { localDate, SOURCE_SET_ID } from '../shared/application.js';
import type { AppState, DesktopOperations, Result, YearPackage } from '../shared/application.js';
import { evaluatePlanReadiness } from '../shared/plan.js';
import { REVIEW_SECTIONS, reviewReadiness } from '../shared/review.js';
import type { ReviewState } from '../shared/review.js';
import { evaluateWorkflow } from '../shared/workflow.js';
import type { AnnualStep } from '../shared/workflow.js';

function samplePackage(year: number): YearPackage {
  const id = `prototype-${year}`;
  const now = new Date().toISOString();
  const today = localDate();
  return {
    id, year, sourceSetId: SOURCE_SET_ID, contentRevision: 1,
    assessmentRevision: 1, planRevision: 1, reviewRevision: 1,
    createdAt: now, updatedAt: now, assessmentDate: today, planDate: today,
    strengths: 'I make time for thoughtful supervision and keep clear, purposeful records.',
    peerFeedback: '', learningNeeds: 'Bring learning from supervision into everyday practice.',
    annualStandards: ['principle-ii', 'principle-iv'],
    stepCompletions: {
      review: { completedRevision: 1, completedAt: now },
      assessment: { completedRevision: null, completedAt: null },
      plan: { completedRevision: null, completedAt: null },
    },
    declarationDate: null, declarationRecordedAt: null,
    goals: [
      { id: `${id}-g1`, packageId: id, ref: 'G1', title: 'Make supervision more useful',
        description: 'Turn reflective conversations into practical next steps.', createdAt: now, updatedAt: now },
      { id: `${id}-g2`, packageId: id, ref: 'G2', title: 'Strengthen everyday documentation',
        description: 'Write concise records that make decisions easier to follow.', createdAt: now, updatedAt: now },
      { id: `${id}-g3`, packageId: id, ref: 'G3', title: 'Build a steadier reflection habit',
        description: 'Make a little room each week to notice what I am learning.', createdAt: now, updatedAt: now },
    ],
    activities: [
      { id: `${id}-a1`, packageId: id, ref: 'A1', title: 'Reflective supervision workshop',
        description: 'A practical workshop on preparing for supervision.', status: 'Completed',
        completionDate: today, evidenceDescription: 'Workshop attendance and my learning notes.',
        evidenceLinks: [], applicationToPractice: 'I now bring one focused question to each supervision meeting.',
        goalIds: [`${id}-g1`, `${id}-g3`], createdAt: now, updatedAt: now },
      { id: `${id}-a2`, packageId: id, ref: 'A2', title: 'Documentation peer discussion',
        description: 'Compare approaches to clear, purposeful documentation.', status: 'In Progress',
        completionDate: '', evidenceDescription: '', evidenceLinks: [], applicationToPractice: '',
        goalIds: [`${id}-g2`], createdAt: now, updatedAt: now },
      { id: `${id}-a3`, packageId: id, ref: 'A3', title: 'Community practice reading',
        description: 'Supplementary reading and reflection.', status: 'Planned',
        completionDate: '', evidenceDescription: '', evidenceLinks: [], applicationToPractice: '',
        goalIds: [], createdAt: now, updatedAt: now },
    ],
  };
}

export function createPrototypeOperations() {
  const year = Number(localDate().slice(0, 4));
  const records = [samplePackage(year), samplePackage(year - 1)];
  let selectedId: string | null = records[0].id;
  const reviews = new Map<string, ReviewState>();
  const counters = new Map(records.map(pkg => [pkg.id, { goal: 3, activity: 3 }]));
  for (const pkg of records) {
    const progress = { visitedPages: [...new Set(REVIEW_SECTIONS.flatMap(section => [...section.pages])), 48],
      resourcesLaunchedAt: pkg.createdAt };
    reviews.set(pkg.id, { ...progress, packageId: pkg.id, page: 2, offset: 0, zoom: 1,
      documentId: 'ethics-2018', reviewRevision: 1, resourcesAvailable: true, readiness: reviewReadiness(progress) });
  }
  function appState(): AppState {
    return {
      years: records.map(pkg => ({ id: pkg.id, year: pkg.year, contentRevision: pkg.contentRevision,
        status: evaluateWorkflow(pkg, reviews.get(pkg.id)!).status })),
      selectedPackage: records.find(pkg => pkg.id === selectedId) ?? null,
      acknowledgedAt: records[0]?.createdAt ?? new Date().toISOString(), schemaVersion: 1,
      dataRevision: records.reduce((sum, pkg) => sum + pkg.contentRevision, 0),
      storageDirectory: 'Prototype memory only. Your portfolio is not connected.',
      lastBackupAt: null, lastBackupRevision: null,
    };
  }
  let snapshot = { state: structuredClone(appState()), records: structuredClone(records),
    reviews: structuredClone([...reviews.values()]) };
  const listeners = new Set<() => void>();
  function publish() {
    snapshot = { state: structuredClone(appState()), records: structuredClone(records),
      reviews: structuredClone([...reviews.values()]) };
    listeners.forEach(listener => listener());
  }
  const ok = <T,>(value: T): Result<T> => ({ ok: true, value: structuredClone(value) });
  const unavailable = async (): Promise<Result<never>> => ({
    ok: false, error: { code: 'INACTIVE',
      message: 'Files, exports, backups, and external links are disconnected in this prototype. Try editing a goal or activity instead.' },
  });
  function record(id: string) {
    const pkg = records.find(pkg => pkg.id === id);
    if (!pkg) throw new Error('This sample year no longer exists. Choose another year or reload the prototype.');
    return pkg;
  }
  function touch(pkg: YearPackage, steps: AnnualStep[]) {
    pkg.contentRevision++;
    pkg.updatedAt = new Date().toISOString();
    steps.forEach(step => { pkg[`${step}Revision`]++; });
    publish();
    return ok(pkg);
  }
  function changeReview(id: string, change: (review: ReviewState) => void, substantive = true) {
    const review = reviews.get(id);
    if (!review) throw new Error('The sample review is unavailable. Reload the prototype.');
    change(review);
    if (substantive) review.reviewRevision = ++record(id).reviewRevision;
    review.resourcesAvailable = review.visitedPages.includes(48);
    review.readiness = reviewReadiness(review);
    publish();
    return ok(review);
  }
  // Small fake save latency makes Saving -> Saved feedback possible to evaluate.
  const waitForSave = () => new Promise(resolve => setTimeout(resolve, 350));
  const operations: DesktopOperations = {
    getState: async () => ok(appState()),
    acknowledgeStorage: async () => ok(appState()),
    openYear: async id => { selectedId = id; const pkg = record(id); publish(); return ok(pkg); },
    createYear: async year => {
      const existing = records.find(pkg => pkg.year === year);
      if (existing) return { ok: false, error: { code: 'DUPLICATE_YEAR', message: 'This sample year already exists.',
        existingPackageId: existing.id } };
      const pkg = samplePackage(year);
      pkg.goals = []; pkg.activities = [];
      records.unshift(pkg); selectedId = pkg.id;
      counters.set(pkg.id, { goal: 0, activity: 0 });
      const progress = { visitedPages: [], resourcesLaunchedAt: null };
      reviews.set(pkg.id, { ...progress, packageId: pkg.id, page: 1, offset: 0, zoom: 1,
        documentId: 'ethics-2018', reviewRevision: 1, resourcesAvailable: false, readiness: reviewReadiness(progress) });
      pkg.stepCompletions.review = { completedAt: null, completedRevision: null };
      publish(); return ok(pkg);
    },
    deleteYear: async input => {
      records.splice(records.indexOf(record(input.packageId)), 1);
      reviews.delete(input.packageId);
      if (selectedId === input.packageId) selectedId = records[0]?.id ?? null;
      publish(); return ok(appState());
    },
    saveDraft: async input => {
      await waitForSave();
      const pkg = record(input.packageId); Object.assign(pkg, input.draft);
      return touch(pkg, ['assessment', 'plan']);
    },
    createGoal: async input => {
      await waitForSave();
      const pkg = record(input.packageId);
      const ref = `G${++counters.get(pkg.id)!.goal}`;
      const goal = { id: crypto.randomUUID(), packageId: pkg.id, ref, title: input.title,
        description: input.description ?? '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      pkg.goals.push(goal);
      if (input.activityId) pkg.activities.find(activity => activity.id === input.activityId)!.goalIds.push(goal.id);
      return touch(pkg, ['assessment', 'plan']);
    },
    updateGoal: async input => {
      await waitForSave();
      const pkg = record(input.packageId);
      const goal = pkg.goals.find(goal => goal.id === input.goalId)!;
      if (input.title !== undefined) goal.title = input.title;
      if (input.description !== undefined) goal.description = input.description;
      goal.updatedAt = new Date().toISOString();
      return touch(pkg, ['assessment', 'plan']);
    },
    deleteGoal: async input => {
      const pkg = record(input.packageId);
      pkg.goals = pkg.goals.filter(goal => goal.id !== input.goalId);
      pkg.activities.forEach(activity => { activity.goalIds = activity.goalIds.filter(id => id !== input.goalId); });
      return touch(pkg, ['assessment', 'plan']);
    },
    createActivity: async input => {
      await waitForSave();
      const pkg = record(input.packageId);
      pkg.activities.push({ id: crypto.randomUUID(), packageId: pkg.id, ref: `A${++counters.get(pkg.id)!.activity}`,
        title: input.title, description: input.description ?? '', status: input.status ?? 'Planned',
        completionDate: input.completionDate ?? '', evidenceDescription: input.evidenceDescription ?? '',
        evidenceLinks: input.evidenceLinks ?? [], applicationToPractice: input.applicationToPractice ?? '',
        goalIds: input.goalIds ?? [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      return touch(pkg, ['plan']);
    },
    updateActivity: async ({ packageId, activityId, title, description, status, completionDate,
      evidenceDescription, evidenceLinks, applicationToPractice, goalIds }) => {
      await waitForSave();
      const pkg = record(packageId);
      const fields = Object.fromEntries(Object.entries({ title, description, status, completionDate,
        evidenceDescription, evidenceLinks, applicationToPractice, goalIds }).filter(([, value]) => value !== undefined));
      Object.assign(pkg.activities.find(activity => activity.id === activityId)!, fields,
        { updatedAt: new Date().toISOString() });
      return touch(pkg, ['plan']);
    },
    deleteActivity: async input => {
      const pkg = record(input.packageId);
      pkg.activities = pkg.activities.filter(activity => activity.id !== input.activityId);
      return touch(pkg, ['plan']);
    },
    getPlanReadiness: async id => ok(evaluatePlanReadiness(record(id))),
    getWorkflow: async id => ok(evaluateWorkflow(record(id), reviews.get(id)!)),
    completeStep: async input => {
      const pkg = record(input.packageId);
      const step = evaluateWorkflow(pkg, reviews.get(pkg.id)!).steps[input.step];
      if (!step.ready) return { ok: false, error: { code: 'NOT_READY', message: 'Finish the missing items first.', missing: step.missing } };
      pkg.stepCompletions[input.step] = { completedRevision: step.relevantRevision, completedAt: new Date().toISOString() };
      return touch(pkg, []);
    },
    recordDeclaration: async input => {
      const pkg = record(input.packageId); pkg.declarationDate = input.date;
      pkg.declarationRecordedAt = new Date().toISOString();
      return touch(pkg, []);
    },
    getEvidence: async () => ok([]),
    getReview: async id => ok(reviews.get(id)!),
    saveReviewPosition: async input => {
      await waitForSave();
      return changeReview(input.packageId, review => Object.assign(review, input), false);
    },
    recordReviewVisits: async input => changeReview(input.packageId, review => {
      review.visitedPages = [...new Set([...review.visitedPages, ...input.pages])];
    }),
    resetReviewSection: async input => changeReview(input.packageId, review => {
      const pages: readonly number[] = REVIEW_SECTIONS.find(section => section.id === input.sectionId)!.pages;
      review.visitedPages = review.visitedPages.filter(page => !pages.includes(page));
    }),
    resetReviewResources: async id => changeReview(id, review => { review.resourcesLaunchedAt = null; }),
    launchReviewResources: unavailable,
    getReviewDocument: unavailable,
    getReaderActive: async () => ok(true),
    onReaderActiveChanged: () => () => {},
    onCloseRequested: () => () => {},
    completeClose: unavailable,
    getBackupProgress: async () => ok({ phase: 'idle', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0 }),
    getPortfolioProgress: async () => ok({ phase: 'idle', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0 }),
    getRestoreProgress: async () => ok({ phase: 'idle', filesCompleted: 0, filesTotal: 0, bytesCompleted: 0, bytesTotal: 0 }),
    createFullBackup: unavailable, cancelFullBackup: unavailable,
    inspectFullBackup: unavailable, cancelRestorePreview: unavailable, replaceFullDataset: unavailable,
    exportForms: unavailable, exportPortfolio: unavailable, cancelPortfolioExport: unavailable,
    openEvidenceLink: unavailable, importEvidence: unavailable, replaceEvidence: unavailable,
    removeEvidence: unavailable, previewEvidence: unavailable, openEvidence: unavailable,
  };
  return { operations, getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}
