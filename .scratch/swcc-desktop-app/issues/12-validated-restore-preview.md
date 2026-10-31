# 12: Inspect and validate a backup without changing live records

**What to build:** The worker can choose a full backup, see what it contains and what a restore would replace, and cancel safely. Malformed or incompatible archives are rejected before any live-data replacement.

**Blocked by:** 11: Back up all years and show trustworthy backup status.

**Status:** resolved

Claimed October 31, 2026 after ticket 11 integration; implementation branch `ticket/12`, concurrent with independent form continuations.

- [ ] Use the distinct restore entry and an OS archive dialog. Identify archive type from its manifest/contents, not its extension alone; reject annual portfolio archives as non-restorable.
- [ ] Validate full-backup manifest structure, supported archive/schema versions, app/source-set compatibility, inventories, counts, sizes, hashes, and referenced managed evidence before offering replacement.
- [ ] Reject malformed manifests, unsupported/future schemas, incompatible sources, missing files, duplicate archive entries, symlinks, absolute paths, parent traversal, and invalid database integrity or record ownership/relationships.
- [ ] Extract only validated manifest entries into scoped staging outside the live replaceable dataset. Enforce actual per-evidence-file size at 50 MiB during extraction, not merely declared sizes, and never materialize unsafe archive paths.
- [ ] Verify the staged SQLite database and managed attachment bytes as one dataset, including unique years/links, stable references, valid statuses/dates, and foreign-key integrity. Validation errors identify a useful cause without silently accepting an empty/repaired substitute.
- [ ] C's preview shows backup creation date, years, record/file counts, and the current dataset to be replaced. Explain whole-dataset replacement, not merge or duplicate-year resolution.
- [ ] Archive inspection, failed validation, and cancellation leave the live dataset, evidence, pending edits, completion/declarations, and backup status unchanged. Clean up only the operation's scoped staging artifacts.
- [ ] Provide progress and actionable errors without presenting preview success as completed restoration. Replacement remains unavailable until the recoverable-restore ticket supplies its safe transaction.
- [ ] Public-operation/renderer checks use a genuine full backup and modified hostile/corrupt fixtures: portfolio type, malformed/future/source-incompatible manifest, traversal/absolute paths, duplicate entries, symlinks, undeclared/missing evidence, incorrect hashes/sizes, actual oversized extraction, and database relationship/integrity failure. Assert current data remains usable and unchanged.

## Comments

### 2026-10-31 — validated inspection integrated

Implemented at `baa80a47b9f62d03ff8ccb2cbb353adff6a78c0e`, merged with `8d7a33deed7901a3373b5b915214b78d1d0507b6`. Strict full-backup archive/schema/source/inventory validation, bounded staging, genuine database/evidence checks, replacement preview, cancellation, and C restore UI are implemented. Inspection does not replace live records; replacement remains disabled pending ticket 13.

Canonical tree matched the tested implementation and passed 138 operation tests (including 51 restore checks), typecheck, lint, and build. The implementer passed 13 real restore/backup/forms desktop checks; graphical checks were not duplicated during concurrent ticket 10 work. Archive version 1/schema 7 are supported with documented inspection ceilings. Windows acceptance remains unverified, and new installer work is deferred by user.
