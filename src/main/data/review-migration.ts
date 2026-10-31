export const reviewMigration = `
  ALTER TABLE year_packages ADD COLUMN review_revision INTEGER NOT NULL DEFAULT 0 CHECK(review_revision >= 0);
  CREATE TABLE review_states (
    package_id TEXT NOT NULL REFERENCES year_packages(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL CHECK(document_id = 'ethics-2018'),
    page INTEGER NOT NULL DEFAULT 1 CHECK(page BETWEEN 1 AND 48),
    offset REAL NOT NULL DEFAULT 0 CHECK(offset >= 0 AND offset <= 1),
    zoom INTEGER NOT NULL DEFAULT 100 CHECK(zoom BETWEEN 75 AND 200 AND zoom % 25 = 0),
    resources_launched_at TEXT,
    PRIMARY KEY(package_id, document_id)
  );
  CREATE TABLE review_visits (
    package_id TEXT NOT NULL REFERENCES year_packages(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL CHECK(document_id = 'ethics-2018'),
    page INTEGER NOT NULL CHECK(page BETWEEN 1 AND 48),
    PRIMARY KEY(package_id, document_id, page)
  );
`;
