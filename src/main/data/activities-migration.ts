export const activitiesMigration = `
  CREATE TABLE learning_activities (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL REFERENCES year_packages(id) ON DELETE CASCADE,
    reference_number INTEGER NOT NULL CHECK(reference_number > 0),
    title TEXT NOT NULL CHECK(length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Planned' CHECK(status IN ('Planned', 'In Progress', 'Completed')),
    completion_date TEXT NOT NULL DEFAULT '',
    evidence_description TEXT NOT NULL DEFAULT '',
    evidence_links TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_links)),
    application_to_practice TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK(status != 'Completed' OR completion_date != ''),
    UNIQUE(package_id, reference_number),
    UNIQUE(id, package_id)
  );
  CREATE UNIQUE INDEX goal_package_ownership ON learning_goals(id, package_id);
  CREATE TABLE activity_goal_links (
    activity_id TEXT NOT NULL,
    goal_id TEXT NOT NULL,
    package_id TEXT NOT NULL,
    PRIMARY KEY(activity_id, goal_id),
    FOREIGN KEY(activity_id, package_id) REFERENCES learning_activities(id, package_id) ON DELETE CASCADE,
    FOREIGN KEY(goal_id, package_id) REFERENCES learning_goals(id, package_id) ON DELETE CASCADE
  );
`;
