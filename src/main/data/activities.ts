import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Activity, ActivityFields, ApplicationOperations, CreateActivity, OperationError, UpdateActivity, YearPackage } from '../../shared/application.js';
import { activityDateError, validEvidenceLink } from '../../shared/plan.js';

export function getActivities(db: Database.Database, packageId: string): Activity[] {
  const rows = db.prepare(`SELECT id, package_id AS packageId, reference_number AS referenceNumber,
    title, description, status, completion_date AS completionDate, evidence_description AS evidenceDescription,
    evidence_links AS evidenceLinks, application_to_practice AS applicationToPractice,
    created_at AS createdAt, updated_at AS updatedAt FROM learning_activities
    WHERE package_id = ? ORDER BY reference_number`).all(packageId) as
    (Omit<Activity, 'ref' | 'goalIds' | 'evidenceLinks'> & { referenceNumber: number; evidenceLinks: string })[];
  return rows.map(({ referenceNumber, evidenceLinks, ...activity }) => ({
    ...activity, ref: `A${referenceNumber}`, evidenceLinks: JSON.parse(evidenceLinks) as string[],
    goalIds: (db.prepare(`SELECT goal_id AS id FROM activity_goal_links JOIN learning_goals ON goal_id = learning_goals.id
      WHERE activity_id = ? ORDER BY reference_number`).all(activity.id) as { id: string }[]).map(goal => goal.id),
  }));
}

export function activityOperations(
  db: Database.Database, getPackage: (id: string) => YearPackage, now: () => string, today: () => string,
  fail: (code: OperationError['code'], message: string) => never,
  identifier: (id: unknown) => void,
): Pick<ApplicationOperations, 'createActivity' | 'updateActivity'> {
  function write(input: CreateActivity | UpdateActivity, creating: boolean) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('VALIDATION', 'The activity request is invalid.');
    const fields: (keyof ActivityFields)[] = ['title', 'description', 'status', 'completionDate', 'evidenceDescription', 'evidenceLinks', 'applicationToPractice', 'goalIds'];
    if (Object.keys(input).some(key => ![...fields, 'packageId', 'expectedRevision', ...(creating ? [] : ['activityId'])].includes(key)))
      fail('VALIDATION', 'The activity contains unsupported fields.');
    identifier(input.packageId);
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('VALIDATION', 'The package revision is invalid.');
    const pkg = getPackage(input.packageId);
    if (pkg.contentRevision !== input.expectedRevision) fail('CONFLICT', 'This package changed. Preserve your unsaved edits and reopen the current year before reconciling them.');
    const activityId = creating ? randomUUID() : (input as UpdateActivity).activityId;
    if (!creating) identifier(activityId);
    const existing = pkg.activities.find(activity => activity.id === activityId);
    if (!creating && !existing) fail('NOT_FOUND', 'This activity no longer exists in this year.');
    const base: ActivityFields = existing ?? {
      title: '', description: '', status: 'Planned', completionDate: '', evidenceDescription: '',
      evidenceLinks: [], applicationToPractice: '', goalIds: [],
    };
    const activity = { ...base } as ActivityFields;
    for (const field of fields as (keyof ActivityFields)[]) {
      if (input[field] !== undefined) Object.assign(activity, { [field]: input[field] });
    }
    for (const field of ['title', 'description', 'completionDate', 'evidenceDescription', 'applicationToPractice'] as const) {
      if (typeof activity[field] !== 'string') fail('VALIDATION', 'Activity text fields must be text.');
    }
    if (!activity.title.trim()) fail('VALIDATION', 'An activity title is required before saving.');
    if (!['Planned', 'In Progress', 'Completed'].includes(activity.status)) fail('VALIDATION', 'Choose Planned, In Progress, or Completed.');
    const dateError = activityDateError(activity, today());
    if (dateError) fail('VALIDATION', dateError);
    if (!Array.isArray(activity.evidenceLinks) || activity.evidenceLinks.some(link => typeof link !== 'string' || !validEvidenceLink(link)))
      fail('VALIDATION', 'Use valid HTTP or HTTPS evidence links, one per line, without spaces or embedded credentials.');
    if (!Array.isArray(activity.goalIds) || new Set(activity.goalIds).size !== activity.goalIds.length
      || activity.goalIds.some(id => !pkg.goals.some(goal => goal.id === id)))
      fail('VALIDATION', 'Link each goal at most once, using goals from this year only.');
    const same = fields.every(field => field === 'goalIds'
      ? activity.goalIds.length === base.goalIds.length && activity.goalIds.every(id => base.goalIds.includes(id))
      : Array.isArray(activity[field])
      ? JSON.stringify(activity[field]) === JSON.stringify(base[field as keyof ActivityFields])
      : activity[field as keyof ActivityFields] === base[field as keyof ActivityFields]);
    if (!creating && same) return pkg;
    const timestamp = now();
    if (creating) {
      const counter = db.prepare("SELECT next_number AS next FROM reference_counters WHERE package_id = ? AND kind = 'A'").get(pkg.id) as { next: number } | undefined;
      if (!counter) fail('STORAGE', 'The activity reference counter is missing. Preserve this dataset for recovery.');
      db.prepare("UPDATE reference_counters SET next_number = next_number + 1 WHERE package_id = ? AND kind = 'A'").run(pkg.id);
      db.prepare(`INSERT INTO learning_activities(id, package_id, reference_number, title, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)`)
        .run(activityId, pkg.id, counter.next, activity.title, timestamp, timestamp);
    }
    db.prepare(`UPDATE learning_activities SET title = ?, description = ?, status = ?, completion_date = ?,
      evidence_description = ?, evidence_links = ?, application_to_practice = ?, updated_at = ? WHERE id = ? AND package_id = ?`)
      .run(activity.title, activity.description, activity.status, activity.completionDate, activity.evidenceDescription,
        JSON.stringify(activity.evidenceLinks), activity.applicationToPractice, timestamp, activityId, pkg.id);
    db.prepare('DELETE FROM activity_goal_links WHERE activity_id = ?').run(activityId);
    for (const goalId of activity.goalIds) db.prepare('INSERT INTO activity_goal_links(activity_id, goal_id, package_id) VALUES(?, ?, ?)').run(activityId, goalId, pkg.id);
    db.prepare(`UPDATE year_packages SET content_revision = content_revision + 1, plan_revision = plan_revision + 1, updated_at = ? WHERE id = ?`).run(timestamp, pkg.id);
    db.prepare('UPDATE app_metadata SET data_revision = data_revision + 1 WHERE id = 1').run();
    return getPackage(pkg.id);
  }
  return {
    createActivity: async input => ({ ok: true, value: db.transaction(() => write(input, true)).immediate() }),
    updateActivity: async input => ({ ok: true, value: db.transaction(() => write(input, false)).immediate() }),
  };
}
