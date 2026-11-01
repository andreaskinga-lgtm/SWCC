# 13: Restore the whole dataset with interruption-safe recovery

**What to build:** After inspecting a valid backup, the worker can explicitly replace the entire dataset, including on a fresh installation, while protective backup and startup recovery keep failed or interrupted replacement from destroying usable prior records.

**Blocked by:** 12: Inspect and validate a backup without changing live records.

**Status:** resolved

Claimed October 31, 2026 after ticket 12 integration; implementation branch `ticket/13`. Complete the recovery functionality in development mode; installer/deployment work is deferred by user.

- [ ] Enable replacement only after successful staged validation and explicit confirmation of the previewed whole-dataset replacement. Support cancellation before confirmation with no live-data change; introduce no merge behavior.
- [ ] Flush/protect pending edits and prevent conflicting mutations/deletions during the restore transaction. Show progress and explain any failure rather than reporting a successful empty application.
- [ ] After confirmation and before changing live data, create and verify a recoverable full backup of the current dataset. Failure of this protective backup aborts replacement and leaves the current dataset usable.
- [ ] Close database connections and replace the whole database/evidence directory using staged directory moves and a durable recovery journal outside the replaceable directory.
- [ ] Retain the prior directory/protective backup until the replacement opens and passes database, ownership/relationship, source-set, and evidence-integrity validation. Do not delete the only recoverable prior copy prematurely.
- [ ] On move, reopen, validation, or migration failure, recover the prior usable dataset and explain what was restored. Never silently initialize an empty database as a recovery fallback.
- [ ] On restart after interruption, process the recovery journal before ordinary dataset opening and recover a consistent usable prior dataset when replacement was not safely verified.
- [ ] Successful restore reproduces all years, G/A/E IDs/references/allocation, links, original filenames/hashes, date-only values, review state, relevant/manual completion revisions, declarations, and relevant metadata. Refresh views and backup status honestly.
- [ ] Restore works in a fresh installation, not only over a populated one. Portable stored paths and date values remain independent of original device or timezone; actual Windows/macOS transfer is verified in the final portability ticket.
- [ ] Public-operation checks use real directories, databases, evidence, and protective archives. Inject protective-backup failure and failures/interruption at staged-move, reopen, validation, and startup-recovery boundaries; restart the application/process to verify recovery rather than only catching an in-process error.
- [ ] Renderer checks verify replacement confirmation/cancellation, busy behavior, preserved unsaved edits on failed flush, accurate success/error outcomes, and C's backup/restore composition. Remove only verified operation-owned staging remnants when safe.

## Comments

### 2026-10-31 — recoverable replacement integrated

Implemented on `ticket/13` with final commit `f52b2e7` and journal-safety fix `5f5f918`, merged with `d0681ad90f94a0595d34766a8f2ad214a41fa991`. Explicit validated replacement, verified protective backup, database closure, staged directory moves, durable recovery journal, prior-data recovery, startup interruption handling, and refreshed C restore UI are implemented.

Canonical checks passed 176 public-operation tests, typecheck, lint, build, and the full serialized production Electron suite: 53/53 checks, including 11 restore checks. Canonical and implementer trees were clean. Earlier filesystem timeout/trailing-space anomalies passed three isolated repeats and final full reruns; the host stall cause remains unconfirmed, with no reproducible functional failure remaining. Validation log: `.work/ticket13-integration-validation.log`.

Verification used macOS arm64 development/production-test execution only. No new installers were built; deployment and cross-platform acceptance are deferred by user. Integration review is the remaining current-run gate.
