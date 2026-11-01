import Database from 'better-sqlite3';

const db = new Database(process.argv[2]);
if (process.argv[3] === 'lock') {
  db.exec('BEGIN IMMEDIATE');
  process.stdout.write('locked\n');
  setTimeout(() => { db.exec('COMMIT'); db.close(); }, 1800);
} else if (process.argv[3] === 'review-position-fail' || process.argv[3] === 'review-position-repair') {
  db.exec(process.argv[3] === 'review-position-fail'
    ? `CREATE TRIGGER simulate_review_position_failure BEFORE UPDATE ON review_states BEGIN SELECT RAISE(FAIL, 'disk full'); END`
    : 'DROP TRIGGER simulate_review_position_failure');
  db.close();
} else if (process.argv[3] === 'review-fail' || process.argv[3] === 'review-repair') {
  db.exec(process.argv[3] === 'review-fail'
    ? `CREATE TRIGGER simulate_review_failure BEFORE INSERT ON review_visits BEGIN SELECT RAISE(FAIL, 'disk full'); END`
    : 'DROP TRIGGER simulate_review_failure');
  db.close();
} else if (process.argv[3] === 'activity-delete-fail' || process.argv[3] === 'activity-delete-repair') {
  db.exec(process.argv[3] === 'activity-delete-fail'
    ? `CREATE TRIGGER simulate_activity_delete_failure BEFORE DELETE ON learning_activities BEGIN SELECT RAISE(FAIL, 'delete blocked'); END`
    : 'DROP TRIGGER simulate_activity_delete_failure');
  db.close();
} else {
  db.exec(process.argv[3] === 'true'
    ? `CREATE TRIGGER simulate_disk_failure BEFORE UPDATE ON year_packages BEGIN SELECT RAISE(FAIL, 'disk full'); END`
    : 'DROP TRIGGER simulate_disk_failure');
  db.close();
}
