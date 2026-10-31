export const completionMigration = `
  ALTER TABLE year_packages ADD COLUMN declaration_date TEXT;
  ALTER TABLE year_packages ADD COLUMN declaration_recorded_at TEXT;
  CREATE TABLE step_completions (
    package_id TEXT NOT NULL REFERENCES year_packages(id) ON DELETE CASCADE,
    step TEXT NOT NULL CHECK(step IN ('review', 'assessment', 'plan')),
    completed_revision INTEGER NOT NULL CHECK(completed_revision >= 0),
    completed_at TEXT NOT NULL,
    PRIMARY KEY(package_id, step)
  );
`;
