# 11: Back up all years and show trustworthy backup status

**What to build:** The worker can create a portable full-app backup covering the complete dataset and see the last successful backup plus subsequent unbacked changes without recurring interruptions.

**Blocked by:** 07: Confirm step completion and record renewal declarations.

**Status:** ready-for-agent

- [ ] Implement C's backup/restore destination with the full-backup explanation/action, quiet last-successful-backup date and unbacked-changes indicator, and a distinct restore entry. Do not imply an annual portfolio is restorable.
- [ ] Preserve the approved full-backup archive naming contract and include all years, assessments, standards, goals, activities/links, evidence metadata/files, review visits/resume positions/resources action, relevant revisions/manual completions, declarations, and relevant app metadata.
- [ ] Use a manifest explicitly identifying a full backup, archive/schema versions, app/source-set identity, creation time, snapshot data revision, inventory, byte counts, and SHA-256 values. Paths are portable and confined to the managed dataset.
- [ ] Obtain a consistent database snapshot using SQLite's backup mechanism, including WAL-resident state. Do not merely copy the live database file.
- [ ] Flush pending edits and prevent conflicting mutations/deletions while collecting the database snapshot and original managed attachment bytes. Show progress/busy state without discarding edits or freezing the UI without explanation.
- [ ] Missing/corrupt evidence, failed flush, snapshot/archive errors, cancellation, and insufficient storage stop visibly; no bytes are silently omitted and no failed backup is reported as successful.
- [ ] Write to a temporary destination and publish only a complete archive. Only successful publication updates the backup timestamp/revision.
- [ ] Updating backup operational metadata does not itself make the dataset immediately appear unbacked. Subsequent user-data changes do; failed/cancelled backup leaves successful-backup metadata unchanged.
- [ ] Bundled source PDFs and regenerable preview caches need not be archived, but compatible source-set identities must be preserved for later restore.
- [ ] Public-operation checks use real multiple-year datasets, SQLite/WAL state, evidence files, and ZIP inspection. Verify inventory/hashes, revisions/completion/declarations, attempted concurrent edits/deletion, failed writes/flushes, and accurate status before/after later changes. This operation has no forms-export prerequisite.
