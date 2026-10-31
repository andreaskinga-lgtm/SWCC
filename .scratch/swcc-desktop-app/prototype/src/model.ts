// In-memory sample records, not the production domain implementation.
export type Step = 'review' | 'assessment' | 'plan';
export type Screen = 'overview' | Step | 'years' | 'backup';
export type Variant = 'A' | 'B' | 'C';
export type ActivityStatus = 'Planned' | 'In Progress' | 'Completed';
export interface Goal { ref: string; title: string; description: string }
export interface Evidence { ref: string; name: string; bytes: number; file?: File }
export interface Activity {
  ref: string;
  title: string;
  description: string;
  goals: string[];
  status: ActivityStatus;
  date: string;
  evidence: string;
  link: string;
  files: Evidence[];
  reflection: string;
}
export interface YearPackage {
  year: number;
  assessmentDate: string;
  planDate: string;
  strengths: string;
  feedback: string;
  needs: string;
  standards: number[];
  goals: Goal[];
  activities: Activity[];
  visited: number[];
  page: number;
  resources: boolean;
  completed: Record<Step, boolean>;
  declaration: string;
  declarationRecorded: string;
  nextGoal: number;
  nextActivity: number;
  nextEvidence: number;
}
export const sections = [
  { name: 'Code of Ethics', pages: [2] },
  { name: 'Meaning of Client', pages: [4] },
  { name: 'Scope of Practice for Social Work', pages: [7] },
  { name: 'Scope of Practice for Social Service Work', pages: [8] },
  { name: 'Principle I: Relationship with Clients', pages: [9, 10] },
  { name: 'Principle II: Competence and Integrity', pages: [11, 12, 13, 14, 15] },
  { name: 'Principle III: Responsibility to Clients', pages: [16, 17, 18] },
  { name: 'Principle IV: The Social Work and Social Service Work Record', pages: [19, 20, 21, 22, 23, 24, 25, 26] },
  { name: 'Principle V: Confidentiality', pages: [27, 28, 29, 30, 31] },
  { name: 'Principle VI: Fees', pages: [32, 33] },
  { name: 'Principle VII: Advertising', pages: [34, 35, 36, 37] },
  { name: 'Principle VIII: Sexual Misconduct', pages: [38, 39, 40] },
];
export const stepNames: Record<Step, string> = {
  review: 'Review the standards',
  assessment: 'Self-assessment',
  plan: 'Development plan',
};
export const variantNames: Record<Variant, string> = {
  A: 'Practice desk', B: 'Annual folio', C: 'Learning map',
};
export function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validLink(value: string) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}
export function blockers(pkg: YearPackage, step: Step): string[] {
  const missing: string[] = [];
  if (step === 'review') {
    sections.forEach(section => {
      if (!section.pages.every(page => pkg.visited.includes(page))) missing.push(`Review ${section.name}`);
    });
    if (!pkg.resources) missing.push('Open other required resources');
  }
  if (step === 'assessment') {
    if (!validDate(pkg.assessmentDate)) missing.push('Enter an assessment date');
    if (!pkg.strengths.trim()) missing.push('Describe your strengths');
    if (!pkg.needs.trim()) missing.push('Describe your learning needs and interests');
    if (!pkg.standards.length) missing.push('Select at least one annual standard');
    if (!pkg.goals.length) missing.push('Add a learning goal');
  }
  if (step === 'plan') {
    if (!validDate(pkg.planDate)) missing.push('Enter a plan date');
    if (!pkg.goals.length) missing.push('Add a learning goal');
    pkg.goals.forEach(goal => {
      if (!pkg.activities.some(activity => activity.goals.includes(goal.ref) && activity.status === 'Completed')) {
        missing.push(`${goal.ref}: complete a supporting activity`);
      }
    });
    pkg.activities.filter(activity => activity.goals.length).forEach(activity => {
      if (activity.status !== 'Completed') missing.push(`${activity.ref}: complete the activity`);
      else if (!validDate(activity.date) || activity.date > today()) missing.push(`${activity.ref}: enter a nonfuture completion date`);
      if (!activity.evidence.trim() && !validLink(activity.link) && !activity.files.some(file => file.file)) {
        missing.push(`${activity.ref}: add evidence (notes, a link, or a file)`);
      }
      if (!activity.reflection.trim()) missing.push(`${activity.ref}: describe application to practice`);
    });
  }
  return missing;
}
export function stepState(pkg: YearPackage, step: Step) {
  return pkg.completed[step] ? 'Completed' : blockers(pkg, step).length ? 'In progress' : 'Ready';
}
export function packageState(pkg: YearPackage) {
  return Object.values(pkg.completed).every(Boolean) && pkg.declaration ? 'Complete' : 'In progress';
}
export function emptyPackage(year: number): YearPackage {
  return {
    year, assessmentDate: today(), planDate: today(), strengths: '', feedback: '', needs: '',
    standards: [], goals: [], activities: [], visited: [], page: 1, resources: false,
    completed: { review: false, assessment: false, plan: false }, declaration: '',
    declarationRecorded: '', nextGoal: 1, nextActivity: 1, nextEvidence: 1,
  };
}
export function samplePackages(): YearPackage[] {
  const current = emptyPackage(2026);
  Object.assign(current, {
    assessmentDate: '2026-01-19', planDate: '2026-01-26',
    strengths: 'I build trusting relationships by making room for clients to tell their own stories. I bring a strengths-based approach to intake and collaborate closely with community partners.',
    feedback: 'My peer consultation group noted my calm approach to difficult conversations and encouraged me to make my clinical reasoning more visible in case notes.',
    needs: 'I want to strengthen my trauma-informed practice and make my documentation clearer, more purposeful, and responsive to clients.',
    standards: [4, 5, 7, 8],
    goals: [
      { ref: 'G1', title: 'Deepen trauma-informed practice', description: 'Use approaches that support safety, choice, and collaboration in client conversations.' },
      { ref: 'G2', title: 'Write clearer clinical records', description: 'Connect assessment, decisions, and next steps in concise, respectful case notes.' },
    ],
    activities: [
      {
        ref: 'A1', title: 'Trauma-informed care workshop', description: 'A practice-focused workshop with case discussion and reflective exercises.',
        goals: ['G1', 'G2'], status: 'Completed', date: '2026-09-18',
        evidence: 'Completed the workshop and retained my participation certificate and learning notes.',
        link: '', files: [],
        reflection: 'I now ask permission before exploring difficult experiences and document the client’s preferences alongside my assessment. This makes both conversations and records more collaborative.',
      },
      {
        ref: 'A2', title: 'Peer consultation on case notes', description: 'Bring anonymized examples to peer consultation and discuss clearer documentation.',
        goals: ['G2'], status: 'In Progress', date: '', evidence: 'Notes from our September peer consultation.', link: '', files: [], reflection: '',
      },
      {
        ref: 'A3', title: 'Reading: The Reflective Practitioner', description: 'Supplementary reading on reflection and professional judgement.',
        goals: [], status: 'Planned', date: '', evidence: '', link: '', files: [], reflection: '',
      },
    ],
    visited: [2, 4, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    page: 21, nextGoal: 3, nextActivity: 4,
  });
  const previous = emptyPackage(2025);
  Object.assign(previous, {
    assessmentDate: '2025-02-03', planDate: '2025-02-10',
    strengths: 'Collaborative work with clients and community partners.',
    needs: 'Strengthen reflective practice through peer consultation.',
    standards: [5], goals: [{ ref: 'G1', title: 'Strengthen reflective practice', description: '' }],
    activities: [{
      ref: 'A1', title: 'Monthly peer consultation', description: '', goals: ['G1'], status: 'Completed',
      date: '2025-11-03', evidence: 'Attendance and reflection notes.', link: '', files: [],
      reflection: 'I incorporate more perspectives into case formulation.',
    }],
    visited: Array.from({ length: 48 }, (_, index) => index + 1), resources: true,
    completed: { review: true, assessment: true, plan: true }, declaration: '2025-11-14',
    declarationRecorded: '2025-11-15T15:00:00Z', nextGoal: 2, nextActivity: 2,
  });
  return [current, previous, emptyPackage(2024)];
}
