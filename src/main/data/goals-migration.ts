export const goalsMigration = `
  CREATE TABLE learning_goals (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL REFERENCES year_packages(id) ON DELETE CASCADE,
    reference_number INTEGER NOT NULL CHECK(reference_number > 0),
    title TEXT NOT NULL CHECK(length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(package_id, reference_number)
  );
`;
