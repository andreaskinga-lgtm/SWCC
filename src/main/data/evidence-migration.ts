export const evidenceMigration = `
  CREATE TABLE evidence_attachments (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL REFERENCES year_packages(id) ON DELETE CASCADE,
    activity_id TEXT NOT NULL,
    reference_number INTEGER NOT NULL CHECK(reference_number > 0),
    original_filename TEXT NOT NULL CHECK(length(original_filename) > 0),
    managed_path TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK(type IN (
      'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'doc', 'docx',
      'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'txt', 'csv'
    )),
    byte_count INTEGER NOT NULL CHECK(byte_count >= 0 AND byte_count <= 52428800),
    sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
    imported_at TEXT NOT NULL,
    UNIQUE(package_id, reference_number),
    UNIQUE(id, package_id, activity_id),
    FOREIGN KEY(activity_id, package_id) REFERENCES learning_activities(id, package_id) ON DELETE CASCADE
  );
  CREATE INDEX evidence_by_activity ON evidence_attachments(package_id, activity_id, reference_number);
`;
