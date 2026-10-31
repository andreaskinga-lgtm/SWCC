export const assessmentMigration = `
  CREATE TABLE annual_standards (
    package_id TEXT NOT NULL REFERENCES year_packages(id) ON DELETE CASCADE,
    standard_id TEXT NOT NULL CHECK(standard_id IN (
      'code-of-ethics',
      'meaning-of-client',
      'social-work-scope',
      'social-service-work-scope',
      'principle-i',
      'principle-ii',
      'principle-iii',
      'principle-iv',
      'principle-v',
      'principle-vi',
      'principle-vii',
      'principle-viii'
    )),
    PRIMARY KEY(package_id, standard_id)
  );
`;
