import { afterEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { openApplication } from '../src/main/data/application.js';
import type { Result } from '../src/shared/application.js';
import { hasSubstantiveAssessmentContent } from '../src/shared/assessment.js';
import type { AnnualStandardId } from '../src/shared/application.js';
import { DraftSession } from '../src/renderer/draft-session.js';

const blankAssessment = {
  strengths: '',
  peerFeedback: '',
  learningNeeds: '',
  annualStandards: [] as AnnualStandardId[],
};

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function storage() {
  const root = resolve('.work', `assessment-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

test('a new assessment stays in write state with only valid dates, goals, and revisions', () => {
  const currentPackage = {
    ...blankAssessment,
    assessmentDate: '2026-10-30',
    planDate: '2026-10-29',
    assessmentRevision: 4,
    contentRevision: 8,
    goals: [{ id: 'goal-1', title: 'Reflect on practice' }],
  };

  expect(hasSubstantiveAssessmentContent(currentPackage)).toBe(false);
});

const qualifyingEdits: Array<[string, Partial<typeof blankAssessment>]> = [
  ['strengths', { strengths: 'I build trust through follow-up.' }],
  ['peer feedback', { peerFeedback: 'Peers value my collaboration.' }],
  ['learning needs', { learningNeeds: 'I want to deepen reflective practice.' }],
  ['annual standard', { annualStandards: ['code-of-ethics'] }],
];

test.each(qualifyingEdits)('%s alone selects the update action', (_name, patch) => {
  expect(hasSubstantiveAssessmentContent({ ...blankAssessment, ...patch })).toBe(true);
});

test('whitespace-only narrative text leaves the write action selected', () => {
  expect(hasSubstantiveAssessmentContent({
    ...blankAssessment,
    strengths: ' \n\t ',
    peerFeedback: '\t ',
    learningNeeds: '\n ',
  })).toBe(false);
});

test('clearing current narratives and standards restores the write action despite newer revisions', () => {
  const editedPackage = {
    ...blankAssessment,
    strengths: 'I build trust through follow-up.',
    peerFeedback: 'Not applicable',
    learningNeeds: 'I want reflective supervision.',
    annualStandards: ['principle-ii'] as AnnualStandardId[],
    contentRevision: 7,
  };
  expect(hasSubstantiveAssessmentContent(editedPackage)).toBe(true);

  const clearedPackage = {
    ...editedPackage,
    strengths: '',
    peerFeedback: ' \n ',
    learningNeeds: '',
    annualStandards: [],
    contentRevision: 8,
  };
  expect(hasSubstantiveAssessmentContent(clearedPackage)).toBe(false);
});

test('visible pending assessment content selects update before autosave completes', async () => {
  const app = openApplication(storage(), { today: () => '2026-10-31' });
  const session = new DraftSession(app.operations);
  try {
    session.open(value(await app.operations.createYear(2026)));
    session.edit({ peerFeedback: 'Peers value my collaboration.' });

    const visibleDraft = session.getSnapshot();
    expect(visibleDraft.status).toBe('Saving');
    expect(visibleDraft.record?.peerFeedback).toBe('Peers value my collaboration.');
    expect(visibleDraft.record && hasSubstantiveAssessmentContent(visibleDraft.record)).toBe(true);
  } finally {
    await session.flush().catch(() => {});
    app.close();
  }
});
