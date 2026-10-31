import Database from 'better-sqlite3';

const db = new Database(process.argv[2]);
if (process.argv[3] === 'lock') {
  db.exec('BEGIN IMMEDIATE');
  process.stdout.write('locked\n');
  setTimeout(() => { db.exec('COMMIT'); db.close(); }, 1800);
} else {
  db.exec(process.argv[3] === 'true'
    ? `CREATE TRIGGER simulate_disk_failure BEFORE UPDATE ON year_packages BEGIN SELECT RAISE(FAIL, 'disk full'); END`
    : 'DROP TRIGGER simulate_disk_failure');
  db.close();
}
