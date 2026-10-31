import type Database from 'better-sqlite3';
import { reviewMigration } from './review-migration.js';

export const SCHEMA_VERSION = 2;
const migrations = [
  `
  CREATE TABLE year_packages (
    id TEXT PRIMARY KEY,
    year INTEGER NOT NULL UNIQUE CHECK(year BETWEEN 1 AND 9999),
    source_set_id TEXT NOT NULL,
    assessment_date TEXT NOT NULL,
    plan_date TEXT NOT NULL,
    strengths TEXT NOT NULL DEFAULT '',
    peer_feedback TEXT NOT NULL DEFAULT '',
    learning_needs TEXT NOT NULL DEFAULT '',
    content_revision INTEGER NOT NULL DEFAULT 0 CHECK(content_revision >= 0),
    assessment_revision INTEGER NOT NULL DEFAULT 0 CHECK(assessment_revision >= 0),
    plan_revision INTEGER NOT NULL DEFAULT 0 CHECK(plan_revision >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE app_metadata (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    selected_package_id TEXT REFERENCES year_packages(id) ON DELETE SET NULL,
    data_revision INTEGER NOT NULL DEFAULT 0 CHECK(data_revision >= 0),
    acknowledged_at TEXT,
    last_backup_at TEXT,
    last_backup_revision INTEGER
  );
  INSERT INTO app_metadata(id) VALUES(1);
  CREATE TABLE reference_counters (
    package_id TEXT NOT NULL REFERENCES year_packages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('G', 'A', 'E')),
    next_number INTEGER NOT NULL DEFAULT 1 CHECK(next_number > 0),
    PRIMARY KEY(package_id, kind)
  );
  `,
  reviewMigration,
];

export function migrate(db: Database.Database) {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > SCHEMA_VERSION) throw new Error(`Dataset schema ${version} is newer than supported schema ${SCHEMA_VERSION}. Install a compatible SWCC build. Existing records were not replaced.`);
  db.transaction(() => {
    for (let index = version; index < migrations.length; index++) {
      db.exec(migrations[index]);
      db.pragma(`user_version = ${index + 1}`);
    }
  })();
}
