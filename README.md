# SWCC desktop

The offline Electron app includes durable annual assessment drafts, independent annual standards, shared learning goals and activities, managed evidence files with integrity checks and repair, activity notes/links and reflections, per-year standards review, explicit annual step completion and external declaration records, annual Forms PDF export with readable continuations, complete annual portfolio ZIP, full-app backup and recoverable whole-dataset restore. The production shell follows approved C / Learning map reference at commit `5477044`; prototype samples and simulated operations are not shipped.

## Run and check

Use npm and a compatible Node release (22.12+, or 24+). Dependencies are pinned in `package-lock.json`.

Current delivery is **development-first**: run and walk through the functional app before deployment. Installer builds, installed-target acceptance and cross-platform transfer checks remain deferred; they are not required to run the app in development.

```sh
npm ci
npm run dev           # Vite renderer + Electron; restart for main/preload changes
npm run typecheck
npm run lint
npm test             # public application operations, real SQLite
npm run test:desktop # production file:// renderer in real Electron, no Vite server
npm run build
npm start            # production assets; build first
npm run package:dir
npm run package:mac  # unsigned arm64 DMG on macOS
```

`postinstall` rebuilds better-sqlite3 for the locked Electron version. `npm test` runs Vitest under Electron's Node runtime, using the **same SQLite native ABI as the application**. Do not alternate Node/Electron native rebuilds. Desktop tests launch actual windows; a usable graphical macOS/Windows session is required. Test datasets and failure fixtures are isolated in ignored `.work/`, not system temporary directories.

For isolated manual checks, `npm run dev -- --user-data-dir="/absolute/path"` or `npm start -- --user-data-dir="/absolute/path"` chooses a separate storage root. This is a launch option, never an operation exposed to renderer content.

## Storage and upgrades

Normal storage is **always** `<Electron appData>/SWCC`, independent of npm package names, app version, architecture, or executable location:

- macOS: `~/Library/Application Support/SWCC`
- Windows: `%APPDATA%\SWCC`

Keep the `SWCC` directory name and `org.swcc.desktop` application identity stable across replacement installers.

```text
SWCC/
  dataset/                  # replaceable dataset, all years
    database.sqlite         # WAL + FULL synchronous writes
    database.sqlite-wal     # may exist while running
    database.sqlite-shm
    evidence/               # managed evidence copies, organized by year
  runtime/                  # regenerable Chromium cache/session/logs
  restore-staging/          # operation-owned, validated backup inspection
  restore-recovery/         # operation-scoped protective full backups
    restore-<id>/
      protective.swcc-backup.zip # retained prior dataset, not encrypted
      prior-manifest.json
      incoming-manifest.json
      prior/                # retained until replacement is fully verified
      protective-dataset/   # verified fallback during recovery
  recovery.json            # durable journal, processed before ordinary DB open
```

The storage location is visible in the app. A persisted, non-blocking acknowledgement explains OS-user-local storage and explicit backups. There is no account or network storage. One active instance per storage root protects the normal OS-user dataset.

Open **Backup and restore → Create full backup**, then choose a location outside SWCC storage, preferably on another device or external drive. Keep the complete `.swcc-backup.zip` file safe: it contains all years and original evidence and is **not encrypted**. There is no automatic cloud sync. The quiet status shows the last successful full backup and subsequent recorded data changes.

The separate **Restore all years → Preview full backup** action opens an OS archive chooser, validates the archive, and compares its creation date, years and record/file counts with the current dataset. **Cancel, keep current data** leaves live data untouched. **Replace all years** explicitly confirms replacement, never merging. SWCC first creates and independently validates a protective full backup of current data, then closes SQLite, moves whole directories and fully validates the opened replacement. Failure recovers prior usable records and explains the exact error. Startup processes an interrupted recovery journal before opening ordinary records. Keep the protective archive path reported in the outcome; it remains under local storage and is not a substitute for an external backup. Annual forms and portfolio exports are not restorable full-app backups. Never manually copy only an open SQLite database file.

Startup refuses corrupt, empty, missing-from-an-existing-dataset, future-schema, or relationship-invalid databases. Migration/read/write/IPC errors are surfaced; SWCC never resets records as a recovery shortcut.

## Extension pointers and contracts

| Module / seam | Current responsibility |
| --- | --- |
| `src/shared/application.ts` | Typed operations/results, assessment/goal/activity/evidence records, annual standard choices, date-only validation, fixed source identity |
| `src/shared/assessment.ts` | Step 2 readiness rules and missing-item descriptions |
| `src/shared/plan.ts` | Single Step 3 readiness implementation, completion-date and HTTP/HTTPS evidence-link validation |
| `src/shared/workflow.ts` | Independent step feedback, relevant-revision/current-completion rules and annual package status |
| `src/main/data/application.ts` | Public SQLite operations used by IPC and integration tests |
| `src/main/data/activities.ts` | Activity persistence, stable A references, same-year unique links, Step 3 revisions |
| `src/main/data/evidence.ts` | Main-owned file chooser/open actions, managed copies, stable E references, SHA-256 integrity and repair |
| `src/main/data/backup.ts` | Full-dataset SQLite backup, confined evidence inventory, main-owned save dialog, complete-file publication and successful status |
| `src/main/archive.ts` | Maintained `yazl` streaming ZIP writer; hashes the exact archived bytes, propagates read/write failures and cancellation |
| `src/main/export/destination.ts` | Shared forms/portfolio/backup destination confinement, protecting app storage and rejecting symbolic-linked output |
| `src/shared/backup.ts` | Versioned full-backup manifest, typed outcome and honest operation progress |
| `src/shared/restore.ts`, `src/main/data/restore.ts` | Typed inspection/preview, maintained `yauzl` ZIP reader, bounded confined extraction and strict read-only dataset validation |
| `src/main/data/restore-recovery.ts` | Verified protective full backup, durable scoped journal, whole-directory replacement and restart-safe recovery before database opening |
| `src/main/data/migrations.ts` | Ordered transactional migrations; SQLite `user_version` is schema version |
| `src/main/data/storage.ts` | Stable dataset/evidence/runtime/staging/journal paths |
| `src/main/index.ts`, `preload.cts` | Single instance, restricted typed IPC, isolated/sandboxed renderer, navigation/new-window constraints, protected close |
| `src/renderer/draft-session.ts` | Retained draft, goal and activity edits/creation, serialized autosave, shared flush/failure contract |
| `src/renderer/operation-progress.tsx` | Shared progress monitoring with explicit failed IPC feedback and retry without restarting the operation |
| `src/renderer/assessment-screen.tsx` | C-style assessment writing, annual standards, shared goal editors and Step 2 readiness |
| `src/renderer/plan-screen.tsx` | C goal-connection strip, activity index, one selected shared editor and Step 3 readiness |
| `src/renderer/EvidencePreview.tsx`, `pdfjs-worker.ts` | Local PDF.js previews and safe raster-image previews from verified bytes |
| `src/shared/review.ts` | Fixed physical-page mappings and shared Step 1 readiness/missing items |
| `src/main/data/review.ts` | Durable per-year review operations and the fixed resources browser action |
| `src/renderer/Review.tsx`, `PdfReader.tsx`, `review-session.ts` | C checklist, real local PDF.js worker/viewport tracking, serialized review writes and flush |
| `src/renderer/App.tsx` | C shell, years, navigation, local storage acknowledgement, honest later-feature destinations |
| `src/renderer/annual-workflow.tsx` | C's adjacent annual checklist, declaration entry/warnings and explicit forms draft export |
| `src/shared/forms.ts`, `src/main/export/forms.ts` | Draft-export warnings, measured source-template projection, local font appearances, flattening and complete PDF publication |
| `src/shared/portfolio.ts`, `src/main/export/portfolio.ts`, `src/renderer/portfolio-dialog.tsx` | Distinct annual portfolio ZIP, original evidence inventory/hashes, portable names, draft warnings and cancellable progress |
| `src/renderer/backup-screen.tsx` | C's full-backup action, quiet status, inspection/cancel, explicit whole-dataset confirmation and replacement/recovery progress |

Export/backup implementations belong in **main-process modules**, not renderer/file-system bridges. The dashboard has separate **Export Forms PDF** and **Export Complete Portfolio ZIP** actions, invoking narrowly typed `exportForms` and `exportPortfolio` operations. Record deletion, managed evidence and repair, readiness, manual completion, external declaration recording, full-app backup and recoverable replacement are implemented. Ready never means manually Completed.

Public operations return `Result<T>`, not success-shaped failures. `createYear` returns a stable package and persists selection. A duplicate returns `DUPLICATE_YEAR` with `existingPackageId` for actionable opening. `openYear` persists selection without advancing content/data revisions. `saveDraft` accepts a **complete `Draft`** plus package ID and expected content revision; unknown draft fields, malformed dates, and stale revisions are rejected without overwriting the saved record.

Dates are `YYYY-MM-DD` strings, never converted through local instants. Blank dates remain saveable drafts; nonblank malformed dates fail. Assessment and plan dates initialize separately to today's local date. Out-of-year dates warn but persist. Operational timestamps are UTC ISO instants.

Meaningful draft changes advance package `contentRevision` and app `dataRevision` once, with independent `assessmentRevision` / `planRevision`. No-op saves and year navigation do not advance them. Completion commands compare their relevant revisions; adding goals affects both assessment and plan revisions. Add fields/tables through a new migration, never edit the shipped migration in place.

The integrated schema is version 7: foundation (1), annual standards (2), goals (3), review (4), activities and unique same-package links (5), managed evidence metadata (6), and manual completions/declaration fields (7). Existing datasets upgrade transactionally without changing their records or revisions or inferring completion from readiness. The parallel ticket 06 review-only version-2 layout is explicitly recognized and gains the missing standards/goals/activity/evidence/completion tables while preserving review visits, position, launch timestamps and revisions. Ambiguous version-2 layouts fail rather than silently losing progress or inventing a replacement dataset.

Each package owns `reference_counters` for `G`, `A`, and `E`, initialized at 1. Allocate and advance the counter **in the same immediate transaction** as insertion. Never derive references from record counts or decrement/recycle them after deletion. Keep record foreign keys and same-package relationship ownership enforced. No premature reference-allocation operation is exposed.

### Flush / failure / close contract

`DraftSession.edit()` retains text immediately. Autosave debounces 400 ms and serializes writes. Keystrokes during a save remain visible; returned revisions advance underneath them, and the newest draft is saved next.

**Every renderer action that consumes or leaves edited records must first flush both `DraftSession` and `ReviewSession`**: navigation/activity selection, goal/activity/evidence operations, completion, declaration entry, exports, and full backup. The shell supplies the same both-session flush to assessment and plan consumers. Resolution means all edits present during the flush have committed. Rejection means pending changes remain visible, status is **Not saved**, and the consuming action must not continue. Never swallow a rejected flush and report Saved/success. Retrying saves the retained changes; revision conflicts must not silently overwrite newer saved data.

Evidence import/replacement leaves text editing enabled while the OS chooser and managed copy run. `DraftSession.withSavedRecord()` serializes that operation with autosave and navigation. The returned saved package is adopted only for the same package ID, beneath retained draft/goal/activity edits; those edits then save against the returned revision. Invalid or failed edits remain visible and retryable rather than being discarded by reopening the package.

Normal window close, app Quit, Windows session-end query, and macOS shutdown notification request that same renderer flush. Main permits termination only after a successful renderer acknowledgement. Failed flush keeps the window open with actionable status and Retry save. A retry after a failed close saves without silently closing; the worker can then close deliberately.

OS Force Quit, power loss, renderer process failure, or an OS overriding a shutdown delay cannot be guaranteed to flush in-memory edits. Do not imply otherwise. Saved SQLite records remain durable; preserve/copy visible unsaved text before forced recovery.

## Full-app backup contract

`createFullBackup()` is the same narrowly typed operation used by preload, renderer and real-SQLite integration tests. Only main chooses a path via the OS save dialog; renderer content cannot supply filesystem paths. The renderer flushes **both** editing sessions before invoking it. `getBackupProgress()` reports choosing/waiting/snapshot/archiving/publishing phases and actual file/byte progress; `cancelFullBackup()` cancels collection, but not an already-started publication. Cancellation of an OS dialog uses its ordinary Cancel action.

Main reserves the backup operation immediately, rejects new mutations and forms exports with actionable `BUSY` results, and drains already-admitted asynchronous imports/browser-state writes and forms exports before collecting the snapshot. The gate covers record/review/completion/declaration writes, selection, acknowledgement and all evidence imports/replacements/removals/deletions. Reads remain available. Protected close waits for an in-flight forms export and refuses termination during backup; after backup cancellation/completion the worker closes deliberately rather than triggering an unexpected deferred quit.

The archive uses this portable contract:

```text
SWCC-<UTC-timestamp-without-colons>.swcc-backup.zip
  manifest.json
  database.sqlite
  evidence/<year>/E<reference>-<unique-id>.<type>
```

`manifest.json` has `kind: "full-backup"` (never `"portfolio"`), `archiveVersion: 1`, the snapshot's schema version, `appId: "org.swcc.desktop"`, `sourceSetId`, UTC `createdAt`, snapshot `dataRevision`, and `files` entries with portable `path`, `byteCount` and lowercase SHA-256. The inventory covers the database and every referenced evidence file; the manifest does not inventory itself. Original filenames, relationships, stable reference counters, all years/drafts/standards/review state/manual completions/declarations and relevant app metadata are preserved in the database. Bundled read-only source PDFs and regenerable caches are excluded.

SQLite's **backup API**, not a live-file copy, creates the standalone database including WAL-resident records. Snapshot integrity/relationships/source identities are checked. Inventory comes from that snapshot, and original evidence is streamed unchanged while checking saved byte counts/hashes. Missing, changed, unreadable, symbolic-link or unsafe-path evidence fails visibly, with no silent omission.

The ZIP is streamed into a private partial file beside the destination, flushed to disk, then published by a same-directory rename only after the whole archive succeeds. Failed/cancelled output is removed and an existing archive remains untouched until complete publication. Only publication followed by a successful metadata write advances `lastBackupAt` / `lastBackupRevision`; that update does **not** advance `dataRevision`. Subsequent user-data changes do. The snapshot contains metadata as it existed before this publication. No schema migration was needed: backup metadata already exists in the shipped foundation schema.

Focused tests use the public operation with real multi-year SQLite/WAL records, managed bytes, independent ZIP inspection and reopening the archived database through normal operations. Controlled substitutes are limited to actual OS dialogs, time and failing/paused filesystem output. Real Electron renderer checks exercise keyboard backup, both-session flush protection, busy/close/cancel behavior, status across restart and narrow-window reflow.

## Validated restore preview contract

`inspectFullBackup()`, `getRestoreProgress()` and `cancelRestorePreview()` are the same narrow typed operations used by the production renderer/preload and integration tests. Only main chooses an archive path. The renderer flushes both editing sessions before inspection; a failed flush retains edits and blocks inspection. Preview cancellation does not flush or discard edits. Inspection reserves the operation, exposes choosing/reading/extracting/validating progress and rejects new conflicting mutations; live reads remain available.

Detection uses ZIP contents and the manifest, never the filename extension. This build accepts archive version 1 and the shipped schema 7 only, with exact application/source-set identity and strict manifest fields. Older/future schemas require a compatible build, not a silent migration or repaired substitute. The database is opened read-only in private `restore-staging/inspection-<id>/`, outside `dataset/`. Its schema, SQLite integrity, foreign keys, stored types, unique ownership, dates/statuses, completion/declaration/backup revisions and stable reference counters must be valid. Every managed evidence record must match exactly one inventoried, streamed, hash-verified file.

Absolute/parent-traversal/backslash paths, duplicate entries/properties, symlinks/special files, encrypted ZIPs and missing/undeclared files fail visibly. Actual inflated evidence bytes are stopped at 52,428,800 bytes (50 MiB), regardless of declared sizes. Defensive inspection ceilings are 4 MiB for the manifest, 512 MiB for the standalone database and 50,000 inventoried files. The full-backup writer uses those same shared limits, checks the actual serialized inventory before archiving and again before publication, and refuses unsupported output without replacing an existing backup or recording success. Larger datasets require a compatible backup/inspection implementation; their records and evidence remain editable. These are archive compatibility bounds, not a yearly evidence quota.

Inspection never modifies live records, evidence or successful-backup metadata. Failure/cancellation removes only the operation-owned staging directory, leaving other staging artifacts alone. Cleanup errors remain failures with a retry action rather than claiming cancellation succeeded. Normal close cancels an open preview after the shared successful flush; close during inspection is blocked until it finishes or is cancelled. Use the native dialog’s Cancel action while choosing. Forced termination may leave its private staging artifacts, but cannot replace the live dataset.

The C comparison is a **preview**, not completed restoration. Only **Replace all years** explicitly confirms that preview.

## Recoverable whole-dataset replacement

`replaceFullDataset({ previewId, confirmed: true })` is the same narrow typed operation used by preload, renderer and real-SQLite checks. It accepts no archive or filesystem path. Only the successfully validated current preview can be confirmed. Both editing sessions flush again before confirmation; failed saves retain visible edits and block replacement. Main immediately reserves replacement, drains admitted asynchronous mutations/exports and refuses a stale preview if those writes changed current data. Conflicting writes, deletion, exports, backups, new inspection and normal close remain blocked through verification or recovery. Cancellation is available before confirmation, not during moves.

The protective archive uses the actual full-backup writer and SQLite backup API, then the actual strict archive inspector verifies its ZIP, standalone database and original evidence. Its private location is outside `dataset/`. A failed protective backup or changed staged bytes aborts before moving live data. The safety copy does not advance successful external-backup metadata or data revisions.

Extracted files, directories and journal writes are flushed before moves. A durable, versioned `recovery.json` names only confined operation-owned copies outside the replaceable directory. Invalid or symbolic-link journals, including dangling links, refuse ordinary dataset initialization. SQLite is closed before the entire current `dataset/` becomes `prior/` and the validated staging directory becomes `dataset/`. Main reopens normal records and runs the shared full schema/database/source-set, ownership/reference/revision/date/completion and actual evidence size/hash validation. All records, IDs, counters (including deleted-reference gaps), original filenames, date-only strings, relevant/manual completions, declarations and snapshot metadata are preserved.

Until full validation is durably recorded, failure or restart restores the prior directory, or its independently verified protective snapshot if that directory is unusable. Recovery itself is journaled and retryable across another interruption. If recovery cannot complete, SWCC refuses ordinary database initialization, preserves the journal/copies and explicitly reports records unavailable—not an empty success. A durably verified replacement is revalidated on restart before finishing the commit. Only after the outcome is durable are redundant operation-owned directories removed; cleanup failures identify retained copies without undoing verified usable records. The protective ZIP remains.

Success refreshes the selected year, editing/review sessions, evidence and workflow views. Backup status reflects the **restored snapshot's recorded metadata**, not a fictitious new backup of incoming data. Create a new full backup outside this device after restoring. Force quit cannot flush unsaved renderer text; recovery tests verify already saved data, not preservation of uncommitted in-memory edits.

`tests/restore.test.ts` uses actual public operations, multi-year SQLite/WAL, original evidence and independently read protective ZIPs. `tests/restore-process.mjs` runs those production operations in fresh Electron-Node processes; SIGKILL at journal/move/reopen/validation boundaries and during recovery is followed by actual restarted-process readback. `tests/desktop/restore.spec.ts` uses real offline Electron main/preload/renderer actions for confirmation, cancellation, protective-write progress/failure, busy/close protection, both-session failed flushes, retry and startup recovery. Pauses/errors are injected only at internal transaction or filesystem/OS boundaries, never through a competing renderer interface.

Ticket 13 development verification, October 31, 2026, available macOS / arm64 host: merged the latest integration including complete portfolio ticket 10 (`3a9a96f`), preserving both typed operations and archive/restore gates. **176 public-operation tests**, typecheck, lint and production-asset build passed. **33 targeted real offline Electron checks** passed across restore, backup, forms, portfolio, drafts and completion, including **11 restore renderer checks**. Restarts use actual killed/new processes, not in-process exception recovery alone. Fresh/populated replacement readback preserves all records, original evidence, G/A/E counter gaps, dates, review/manual completion revisions and declarations; protective archives are independently inspected. No dependency manifests changed. No installers, installed-target or Windows/Intel/cross-platform-transfer checks were run; deployment remains deferred. The existing Vite large-chunk advisory remains.

The final journal-link safety fix (`5f5f918`) was reverified with all **176 operations**, typecheck, lint, build and a complete passing **33-check desktop run**. One earlier run recorded a roughly six-minute filesystem-backed stall and two timeout failures; those exact cases passed three isolated repeats and the subsequent full operation run. An existing busy-write desktop check once observed an extra trailing space; it likewise passed three isolated repeats and the complete final desktop run. No assertions, timeouts or unrelated production behavior were relaxed. The stall's underlying host/I/O cause was not established; no reproducible functional failure remains.

## Shared and supplementary activities

The dashboard leads with **Record an activity**, shows goals beside activities, and displays each activity once with all linked G references. Development plan uses a goal-connection strip, an activity index (including supplementary work), and one selected record editor. A references in either goal's row open the same record. Selecting another activity flushes edits first; failed edits remain visible.

`createActivity` and `updateActivity` accept an expected package content revision. Titles are required; description, completion date, evidence and reflection can be incomplete drafts. `goalIds` can be empty or contain several unique IDs from that package. Evidence notes, HTTP/HTTPS links and application-to-practice reflection live on the activity, not its links. `createGoal` accepts an optional same-package `activityId` to create and link a new shared goal atomically, with one increment to Steps 2 and 3. Deleting a goal removes its links but preserves activities/evidence; references are not reused.

Planned and In Progress activities need no completion date. Completed needs a valid, actual nonfuture date, but evidence/reflection may remain pending and editable. Plan date is independently editable. Valid out-of-year dates warn rather than reject, and date-only strings survive timezone changes without conversion.

`evaluatePlanReadiness` is the single domain implementation, also exposed by `getPlanReadiness` for subsequent completion/export callers. It requires a valid plan date, a goal, completed supporting work for every goal, and every linked activity Completed with a valid date, qualifying evidence and nonblank reflection. One additional unfinished linked activity blocks readiness even when a goal has other completed work. Supplementary activities do not block it. Main-process SHA-256 and readability checks supply verified file-backed activity IDs; notes and valid HTTP/HTTPS links remain alternatives, and broken files alone never qualify.

Evidence links are validated and stored without fetching them. **Open in browser** flushes edits and invokes the protocol-validated main-process `openEvidenceLink` operation for a saved link on a managed activity ID. Failures are reported without removing the link. Internet is needed to view the website; OS launch success is not proof that it loaded or was read.

Activity content/status/date/link/evidence/reflection edits and managed evidence import/replacement/removal advance only Step 3's relevant revision. Preview and open actions do not invalidate completion. Plan-date edits do the same; inline goal creation advances Steps 2 and 3. No-op activity updates, including reordered goal IDs, do not invalidate readiness-related revisions.

## Managed evidence files

The renderer requests import or replacement for a package/activity/evidence ID; only main opens the OS file chooser and chooses the source path. Supported extensions are PDF, PNG, JPG/JPEG, WEBP, GIF, BMP, DOC/DOCX, XLS/XLSX, PPT/PPTX, RTF, TXT, and CSV. Each actual input is limited to 52,428,800 bytes (exactly 50 MiB); there is no yearly quota. Original names remain metadata while managed paths use unique, year-local E references.

Imports are streamed into a private partial file, hashed, flushed, and published with attachment metadata in a SQLite transaction. Failed/cancelled imports do not allocate E references or present success. The app reports unreadable inputs, unsupported types, size limits, managed-folder permission failures, and insufficient disk space. Integrity checks compare actual byte count and SHA-256. Missing, unreadable, or changed files are visible and can be replaced without changing their E reference or removed without reusing it.

Replacement uses the existing durable deletion stage for the previous bytes. A failed metadata commit restores those bytes. If old-byte cleanup fails **after** the replacement commits, the new evidence stays usable under its original E reference; the operation reports `committed: true` and the retained recovery path, and the renderer adopts the committed revision. Check permissions and restart SWCC to retry the journaled cleanup, rather than repeating the replacement. The existing schema is unchanged.

PDFs and raster images are previewed internally from verified bytes with the locally bundled PDF.js worker/assets; PDF scripting and annotation layers are not enabled. DOC/DOCX, XLS/XLSX, PPT/PPTX, RTF, TXT, and CSV open only on explicit action through main-process `shell.openPath` resolved from the managed evidence ID. The renderer receives no filesystem path or general shell/filesystem bridge. OS association errors are shown to the worker.

## Offline standards review

Review renders the original **48-page** ethics PDF using PDF.js and a local dedicated worker. CMaps, standard fonts and WASM assets are bundled in `dist/renderer/pdf-assets/` and served locally in development. No CDN, embedded remote viewer, thumbnail claims, or browser PDF plugin is used. The reader receives only the fixed document's bytes through trusted IPC, never filesystem access or a caller-chosen path.

The shared `reviewReadiness()` is the sole Step 1 section/missing-item implementation. Mappings use physical PDF pages (cover = 1): 2, 4, 7, 8, 9–10, 11–15, 16–18, 19–26, 27–31, 32–33, 34–37, and 38–40. Every mapped page must qualify; other pages do not add categories.

A page qualifies only **after its actual canvas render finishes**, in a visible/focused OS window and visible/active document, with visible height at least half the smaller of the page height and reader `clientHeight`. Window clipping is included. Fetching the whole document, offscreen renders, incidental slivers and page jumps do not count. No dwell timer or comprehension claim is made.

`getReview`, `recordReviewVisits`, `saveReviewPosition`, `resetReviewSection`, `launchReviewResources`, and `resetReviewResources` persist state per package and the fixed `ethics-2018` document. Reader position is the physical page, scroll offset divided by rendered page height, and zoom (75–200%). Pending writes are serialized and participate in navigation/close flush; storage failures retain the pending visits/position and expose Retry review save.

`reviewRevision` advances only when a reset actually removes mapped visits or a recorded resources launch. Rereading, new automatic checks, page/position/zoom changes and year navigation do not invalidate Step 1. Review writes do not advance assessment/plan/content revisions; durable review changes advance app `dataRevision` for future backup tracking. Ready is not Completed; review has an explicit Complete Step 1 action.

Only actually displaying physical page 48 exposes Other required resources. Explicit action invokes main-process `shell.openExternal` with the fixed plain College URL, and checks the item only after OS launch succeeds and the timestamp commits. Browser failures report the OS error and leave an unchecked item unchecked. Internet is needed to view the website; launch success proves neither loading nor reading. An explicit reset clears the timestamp.

Failed reader-activation queries show **Retry review tracking** without hiding the PDF or claiming a visit. Failed backup/portfolio/restore progress queries show an operation-specific monitoring retry; the operation may still be running, and retry does not launch another archive operation.

## Annual completion and declarations

`getWorkflow(packageId)` returns independent readiness/missing-item lists and Draft/In Progress, Ready or Completed feedback, using the existing review/assessment/plan domain rules. `completeStep({ packageId, step, expectedRevision })` expects that **step's relevant revision**, checks fresh readiness (including managed evidence integrity) in an immediate transaction, and records its revision/UTC timestamp only on success. Incomplete, stale and failed writes leave the previous confirmation unchanged. Repeating a current confirmation is idempotent. The renderer flushes both editing sessions first; incoming operation results preserve edits typed while the operation is running.

Current manual completion requires matching relevant/completed revisions. Assessment text/date/standards affect Step 2; goal creation/edit/deletion affects Steps 2 and 3; plan/activity/status/date/link/evidence/reflection changes affect Step 3; review/resources resets affect Step 1. Rereading, navigation, zoom, previews/opens and unchanged saves preserve confirmations. Changes remain isolated to their year. Activity completion and computed readiness never complete an annual step.

`recordDeclaration({ packageId, date, expectedRevision, confirmIncomplete? })` stores the date-only **actual external submission date** and a separate app-entry UTC timestamp. It expects the package content revision. If any manual completion is not current, it requires acknowledgement of the incomplete-steps warning (`confirmIncomplete: true`); historical declarations are allowed. Entry or correction advances content/data revisions but no step's relevant revision. An unchanged date preserves the entry timestamp. Later edits or reopening steps preserve both declaration fields; no external submission history is reconstructed and SWCC neither submits nor verifies declarations.

A year is Complete only with all three current manual confirmations and a declaration date. Dashboard and year-list status refresh after actions and survive restart. C's independent annual checklist, declaration and forms export controls sit beside the relationship board, with labelled keyboard actions, readable blockers and the source-edition/application-readiness caveat. Forms export remains available for incomplete years after explicit draft acknowledgement.

## Annual Forms PDF — original layouts and readable continuations

Choose **Export Forms PDF** beside the annual workflow, review the missing readiness/manual-completion/declaration items, then explicitly choose **Export draft PDF** when incomplete. Empty drafts still emit the checklist, one SAT and one PDP; missing fields remain blank. An OS save dialog chooses the destination. Cancellation is not success; generation and storage errors remain visible and retryable.

The renderer flushes both draft and review sessions before opening export and again before generation. A failed flush retains edits and prevents consuming stale records. Main captures the package, review, evidence metadata/integrity and warning state **synchronously in one SQLite read transaction, before any asynchronous work**. Later edits, resets or evidence deletions do not mix revisions into that forms snapshot. Forms only reference evidence metadata; they do not collect attachment bytes. The full-backup gate rejects new forms exports while collecting a backup and drains an already-admitted export before snapshotting. Main prevents overlapping Forms PDF requests and waits for an active forms write before approving normal close.

`pdf-lib` and `@pdf-lib/fontkit` use the dedicated three-page `resources/templates/annual-forms.pdf` for both Forms PDF and Complete Portfolio ZIP exports. It contains only checklist physical page 1, SAT assessment-tool page 8, and PDP page 11, in that order, with their original layouts and required editable fields preserved. Unused assessment pages and field scripting are excluded. The original checklist and full assessment-tool PDFs are no longer stored or packaged; the standalone template is the maintained export resource. The checklist's thirteen checkbox centers were measured on the actual 612 × 792 pt image background; generated X glyphs are centered using local font glyph bounds, independent of Step 1 confirmation. Annual standards use the twelve SAT checkboxes independently of review progress and goals. SAT/PDP dates remain separate date-only strings.

Each selected page is filled in an isolated template document, its appearances updated, and the form flattened **before** page copying/merging. Output has no interactive form widgets or scripting. Each annual narrative and goal occurs once within its logical form. SAT/PDP contain authored goal/activity titles and descriptions, evidence notes/links/original filenames, and reflections, without generated G/A/E labels, statuses, activity dates, goal-link annotations or record-association headings. Reference-like user text is retained unchanged. Shared and supplementary activities each appear once. Stable references and relationships remain in the application and technical portfolio index/manifest. Missing or corrupt evidence raises an explicit repair error before PDF publication, not a printed repair annotation.

Noto Sans Regular is bundled under `resources/fonts/`, unmodified, with its SIL Open Font License and pinned upstream revision. No font fetch occurs at runtime. Actual field rectangles, 1–2 pt padding, font metrics and 10 pt body text drive line wrapping, including long unbroken words/URLs. Unsupported glyphs fail explicitly rather than disappear.

The same Forms PDF operation paginates all SAT/PDP narratives at **10 pt**, without shrinking or a narrative-length cutoff. Each continuation is another isolated, filled and flattened copy of the same source page. A quiet footer identifies year, SAT/PDP and logical page/continuation number. Dates and selected annual standards appear on the first page only; continuation checkboxes are blank. Missing or already-emitted narratives remain blank.

Every SAT/PDP field wraps and paginates independently. Entries use modest paragraph spacing rather than inserted blank lines or drawn separators; meaningful formatting within authored text is retained. Missing evidence/reflections and whitespace-only optional content create no placeholders or alignment slots. Split narratives continue directly without repeating titles or adding object labels. Exhausted fields remain blank while longer fields finish on subsequent copies of the original form.

Wrapping uses bundled-font widths and grapheme boundaries, including unbroken words and HTTP/HTTPS URLs. Paragraph/newline breaks, composed and decomposed accents, and supported punctuation are retained; CRLF/CR become line breaks and tabs become four spaces. Unsupported glyphs fail explicitly without changing saved text or publishing output. A grapheme that cannot physically fit the field at 10 pt still produces an actionable `OVERFLOW`, never clipping. For original evidence bytes, use the separate Complete Portfolio ZIP action.

The chosen Forms PDF destination is checked before generation: it must be outside SWCC storage, including resolved symbolic-linked directories, and must not be a symbolic-linked output file. The entire PDF is generated before writing a unique private partial file beside that validated destination. The file is completely written, flushed and closed before rename publishes it. Errors preserve any previous complete destination, and success is reported only after publication. A forms export is **not** a restorable full-app backup.

`tests/forms-export.test.ts` exercises public operations with real SQLite, managed evidence and actual templates. It checks complete extracted column narratives (ignoring extraction whitespace), generated-decoration absence, reference-like authored text/URLs/filenames, independent unequal-length field flow, missing-content spacing, synchronous snapshot consistency, explicit integrity/generation/write failures, raster checklist/standard alignment, and text inside measured fields at ≥10 pt. Every stress SAT/PDP page is rendered and pixel-compared with its source outside the measured fields/footer and inside fields outside narrative ink; this verifies intact backgrounds, no added separators or marks in gaps/exhausted fields, and no repeated SAT selections on continuations. Portfolio tests compare direct and ZIP-contained PDF text/placement and retain index/manifest/attachment-byte assertions. To retain generated inspection examples locally:

```sh
SWCC_EXPORT_INSPECT=1 npm test -- tests/forms-export.test.ts
# .work/forms-inspection/{annual.pdf,checklist.png,sat.png,pdp.png}
# .work/forms-continuation-inspection/{sat-stress.pdf,pdp-stress.pdf,sat-*.png,pdp-*.png}
```

`tests/desktop/forms.spec.ts` exercises the production offline Electron renderer, keyboard draft confirmation, destination cancellation, busy/error feedback, and failed-save retention followed by exporting the latest text. OS chooser responses and injected disk errors are controlled system-boundary fixtures; generated PDFs and renderer actions are real.

Ticket 09 verification on October 31, 2026, macOS 26.6.2 / arm64: all **87 public-operation tests**, typecheck, lint and build passed. **18 targeted real Electron desktop checks** (forms, backup, drafts and completion) passed against production offline `file://` assets, including a new long-content export with shared goals, both-session flush consumption, an explicit unsupported-glyph failure with retained edits, correction and successful complete PDF retry. SAT stress emitted 8 logical SAT pages; PDP stress emitted 20 logical PDP pages. All 28 stress form pages passed raster fidelity / bounds / readable-size checks; first, split-transition and final renders were visually inspected alongside the retained ticket 08 examples. No dependencies or backup/restore contracts changed. This is available-host desktop verification, not installer, Windows/Intel macOS/macOS 14 acceptance. Vite retains its existing large-chunk advisory; npm reports existing locked dependency advisories.

Ticket 08 verification on October 31, 2026, macOS 26.6.2 / arm64: `npm ci`, all 75 public-operation tests, typecheck, lint, build, and 13 targeted desktop forms/completion/draft checks passed. The actual checklist/SAT/PDP sources and generated raster layouts were visually inspected. `package:dir` also passed, and all four forms renderer checks passed offline against the resulting unsigned app bundle with its bundled PDFs/font, including normal-close protection during export. This was an app-bundle smoke, not a DMG installation or Windows/macOS Intel acceptance; those targets were not exercised for this slice. Vite retains its existing large-chunk advisory.

Tickets 08/11 integration verification on October 31, 2026, macOS / arm64: merged npm lock refreshed with npm, `npm ci`, all **86 public-operation tests**, typecheck, lint, build, and the **full 37-test real Electron desktop suite** passed (one GUI worker, production offline renderer). Combined coverage checks that backup rejects new forms exports, drains an admitted real PDF export before snapshotting, and does not treat forms output as a backup or advance its successful-backup status. Forms close protection, both-session flush failures, backup progress/errors/cancellation, and unavailable restore passed unchanged. Integrated installers and Windows/macOS Intel behavior were not exercised; the existing Vite large-chunk advisory remains.

## Fixed read-only source set

All years retain source identity `swcc-supplied-2018-2026-v1` for existing dataset and backup compatibility. Packaged PDF resources are:

| Packaged path | Repository resource |
| --- | --- |
| `sources/ethics-2018.pdf` | `resources/sources/Code-of-Ethics-and-Standards-of-Practice-September-7-2018.pdf` |
| `templates/annual-forms.pdf` | `resources/templates/annual-forms.pdf` |

The ethics PDF remains unchanged for the in-app review reader. The export-only template preserves the selected checklist and assessment layouts without retaining the full originals.

Treat these as data, never executable content or editable dataset files. The supplied ethics document is **Second Edition / September 2018**; the assessment tool references **Third Edition / 2023**. This fixed baseline is not a guarantee of current-year College regulatory compliance.

## Unsigned installation and recorded smoke

macOS: open the DMG and copy SWCC to Applications. Launch only a trusted build. If Gatekeeper blocks an unsigned app, use **System Settings → Privacy & Security → Open Anyway** when offered, then confirm. Managed policy may prohibit that override. Do not disable Gatekeeper globally.

Windows: the planned NSIS installer is per-user. SmartScreen may offer **More info → Run anyway** for trusted unsigned builds, but Smart App Control or managed policy can block installation/launch without that option. Windows installed behavior has **not** been exercised here.

Initial foundation verification on **macOS 26.6.2 / arm64**, October 31, 2026:

- `npm test`: 9 public-operation checks passed with real SQLite (durability, revisions, duplicate years, acknowledgement, failure/retry, corruption/future schema, missing/empty dataset, migration/ownership recovery, and complete long narratives).
- `npm run typecheck`, `npm run lint`, and `npm run build`: passed.
- Development command: isolated Vite/Electron launch, HTTP readiness, and a real draft autosave passed; the helper was stopped afterward.
- Real production Electron launch: 5 desktop checks passed (keyboard/duplicate/restart/date-only timezone change, failure-protected navigation/close, immediate close flush, typing during a real busy SQLite write, and single instance).
- `npm run package:mac`: unsigned `release/SWCC-0.1.0-arm64.dmg` produced. DMG was mounted read-only, the app copied to an isolated install directory, and the same 5 checks passed against the **packaged arm64 executable** with Chromium networking disabled, `app.isPackaged === true`, and a `file://` renderer. No development server was listening on port 5173.
- Original/bundled source SHA-256 hashes matched for all three PDFs.

This is initial **ticket 01** packaged/offline verification, not later full-feature target acceptance. macOS 14, Intel macOS, Windows 11, Gatekeeper's quarantined-download flow, cross-version installer upgrades, and OS-initiated machine shutdown have not been exercised. No platform restriction blocked the available macOS arm64 smoke.

Ticket 06 review verification on the same macOS arm64 host, October 31, 2026:

- Typecheck, lint and production build passed; 11 real-SQLite public-operation checks and all 12 real Electron desktop checks (5 foundation + 7 review) passed.
- The review checks exercise an actual local dedicated PDF.js worker and rendered PDF pixels, both exact half-smaller-height boundaries, partial/multi-page sections, jumps, hidden/inactive/offscreen exclusion, per-year restart/position/zoom, keyboard reflow, and failure-protected review navigation/close.
- `npm run package:dir` produced an unsigned arm64 `.app`; all 7 review checks passed against `release/mac-arm64/SWCC.app/Contents/MacOS/SWCC` offline, using packaged read-only PDF resources and local worker/assets, without a development server.
- Browser success/failure is injected **only at the OS `shell.openExternal` boundary** in automated checks. The real main-process action persists the actual successful launch result; these checks do not claim that an external website loaded or was read.
- This is an available-host packaged application smoke, not a newly mounted DMG installation or Windows/Intel/macOS 14 certification. Manual step completion remains ticket 07.

Tickets 02 + 06 integration verification on **macOS 26.6.2 (25G83) / arm64**, October 31, 2026:

- No-ff ticket06 merge: `9ee16ae42a6d0fde66bca389e3f244505afe4dfb`, preserving the already merged assessment/goal contracts.
- `npm test`: **18** real SQLite checks passed, including foundation/assessment/goal/review behavior, four existing schema upgrade layouts and explicit ambiguous-schema rejection.
- `npm run typecheck`, `npm run lint`, `npm run build` and `npm run package:dir`: passed.
- `npx playwright test`: **15** passed (5 foundation, 3 assessment/goals, 7 review). The same **15** passed against the newly packaged `release/mac-arm64/SWCC.app/Contents/MacOS/SWCC` offline. All three bundled PDF hashes matched the originals.
- This integration did not produce/exercise a newly installed DMG or certify Windows 11, Intel macOS, macOS 14, quarantined-download Gatekeeper behavior, cross-platform transfer, installer upgrades or OS-initiated shutdown. Browser tests exercise the OS-call boundary, not successful website loading/reading.
- Tickets 02 and 06 were resolved at that checkpoint; implementation stopped before later tickets.

Ticket 03 verification on the same macOS arm64 host, October 31, 2026:

- `npm test`: **25** real SQLite public-operation checks passed, including six focused activity cases and five supported historical schema layouts.
- `npm run typecheck`, `npm run lint` and `npm run build`: passed. Build retains the existing large-bundle advisory.
- `npx playwright test`: **18** real Electron checks passed offline against production `file://` assets, including three activity checks for shared/inline/supplementary work, completion/date rules, 620px/520px keyboard reflow, timezone restart, protected failed edits/creation, activity-selection flush, and explicit browser failure reporting.
- This did not build or exercise a new installer, Windows/Intel macOS, or cross-platform transfer. Browser launch behavior is checked with a controlled substitute only at the OS action boundary, not by claiming an external website loaded. Managed-file evidence and manual completion remain later-ticket work.

Repeat packaged checks after building/installing:

```sh
SWCC_PACKAGED_EXECUTABLE="/absolute/path/SWCC.app/Contents/MacOS/SWCC" npx playwright test
```

Ticket 07 verification on the same macOS arm64 host, October 31, 2026:

- `npm test`: **68** real-SQLite public-operation checks passed, including **28** focused completion/declaration cases, the full invalidation table, evidence/deletion changes, repeated confirmation, historical entry, rollback and version-6 migration.
- `npm run typecheck`, `npm run lint` and `npm run build`: passed. The existing large-bundle advisory remains.
- `npm run test:desktop`: **29** real Electron checks passed offline using production `file://` assets, including **4** completion cases. These cover any-order keyboard confirmation, C's adjacent dashboard composition, readable blockers/warnings, declaration date/timezone restart, all actual mapped PDF displays and completed rereading, year isolation and status, and failed draft/review flushes.
- `npm run package:dir`: unsigned arm64 `.app` produced; all **4** completion renderer checks also passed against `release/mac-arm64/SWCC.app/Contents/MacOS/SWCC` offline. This is packaged-app smoke, not a newly installed DMG certification.
- These checks do not certify Windows/Intel macOS/macOS 14, installer upgrades or OS-initiated shutdown. OS browser launch is substituted only at `shell.openExternal`; no website loading/reading or regulatory verification is claimed.

Ticket 11 verification on the same macOS arm64 host, October 31, 2026:

- `npm test`: **78** real-SQLite public-operation checks passed, including **10** full-backup cases covering multiple years/WAL, complete inventory/hashes, original evidence, completion/declaration records, read-back through normal operations, admitted imports, conflicting changes/deletions, unsafe paths, disk/snapshot/publication failures, cancellation and later unbacked revisions.
- `npm run typecheck`, `npm run lint` and `npm run build`: passed; the existing large-bundle advisory remains.
- `npm run test:desktop -- tests/desktop/backup.spec.ts tests/desktop/drafts.spec.ts tests/desktop/completion.spec.ts`: **13** production `file://`, offline Electron checks passed, including **4** backup renderer cases. OS save dialogs are controlled at Electron's dialog boundary; archive generation, SQLite and managed bytes are real.
- Restore remains ticket 12. Windows/Intel macOS/macOS 14 installed backup behavior, installer upgrades, actual removable-drive exhaustion and power-loss durability have not been exercised by this ticket.

## Complete annual portfolio ZIP

From the year overview, choose **Export Complete Portfolio ZIP**, separately from Forms PDF and full-app backup. Review the same readable readiness/manual-completion/declaration warnings, then explicitly choose **Export draft ZIP** if incomplete. Drafts are permitted; missing fields remain blank. Main owns the OS destination dialog and suggests:

```text
CCP-<year>-portfolio.zip
  CCP-<year>-forms.pdf
  evidence-index.txt
  manifest.json
  evidence/E1/<safe-original-filename>
  evidence/E2/<safe-original-filename>
```

This copy contains the complete checklist/SAT/PDP and their readable continuations, plus every annual attachment's original bytes once, including shared and supplementary activity evidence. The index connects A/E references, original filenames and archive paths without repeating reflections. Original names remain metadata; control/format characters in PDF filename labels are represented by printable Unicode escapes, not interpreted as narrative formatting.

The manifest has `kind: "portfolio"`, `archiveVersion: 1`, application/source identity, year, package/content/data revisions and UTC `createdAt`. `files` inventories forms, index and evidence with actual byte counts and SHA-256 of the exact archived bytes; `attachments` additionally retains stable IDs, A/E references, original names, types and import timestamps. The manifest does not inventory itself. A portfolio is **not a restorable full-app backup**, does not advance backup status, and is not encrypted.

Evidence is grouped by stable E reference, so duplicate original names cannot collide. Portable NFC filenames remove forbidden characters, controls, leading/trailing dots/spaces and reserved Windows device names (including superscript forms), and are bounded to 180 UTF-8 bytes without splitting graphemes. Supported extensions are retained. Original filename metadata is not changed.

`exportPortfolio({ packageId, confirmDraft? })` is the public preload/application operation. The renderer flushes both draft and review sessions before opening the warning and again before generation. Main reserves collection immediately, drains admitted asynchronous evidence/review writes and Forms PDF exports, then captures one synchronous annual SQLite read transaction. The existing archive gate rejects conflicting new mutations, deletions, forms exports and full backups while records and original evidence are collected. Reads remain available; failed flushes retain visible edits and prevent stale export.

`getPortfolioProgress()` exposes waiting/choosing/snapshot/generating/archiving/publishing phases and actual file/byte counts. `cancelPortfolioExport()` cancels collection, not an already-started publication; use the OS dialog's ordinary Cancel while choosing a destination. Protected close refuses to quit during export and exposes the reason in the active dialog; cancellation/completion never triggers an unexpected deferred quit.

The existing streamed ZIP writer checks actual sizes and saved hashes. Missing, changed, unreadable, symbolic-linked or unsafe managed evidence fails explicitly, even for a supplementary activity. A private partial archive is completely written and flushed beside the destination, then renamed only after success. Failure/cancellation removes partial/staged output and leaves an existing complete destination unchanged. Destinations inside SWCC storage are rejected to protect the dataset.

`tests/portfolio-export.test.ts` inspects real ZIPs through the public operation with real SQLite, templates, long readable PDF narratives, shared/supplementary evidence, byte/hash inventories and awkward/duplicate/reserved/accented names. It covers missing/corrupt/late-changed/symbolic-linked evidence, PDF/disk failures, cancellation, admitted imports/forms and concurrent mutation/deletion attempts. `tests/desktop/portfolio.spec.ts` exercises the real production offline Electron UI, keyboard warnings/export, failed draft and actual reader flushes, retained edits, busy/close/cancel controls, narrow-window reflow and actual filesystem output failure/retry. Substitutes are limited to OS dialogs and paused/failing filesystem boundaries; there is no test-only application interface.

Ticket 10 verification on October 31, 2026, macOS 26.6.2 / arm64: after merging integration `5e9cfa8` (including ticket 12 preview), all **153 public-operation tests** (15 portfolio checks), typecheck, lint and build passed. All **26 targeted real Electron checks** passed against production offline `file://` assets: portfolio, forms, full backup, restore preview, drafts and completion. A generated real portfolio was also rejected by the existing restore-inspection operation with live records unchanged. No new dependencies or schema migrations were introduced by ticket 10; the merged manifest promotes the existing ZIP reader for ticket 12. This does not certify installers, Windows, Intel macOS, macOS 14, cross-platform extraction, removable-drive exhaustion or power-loss durability. The existing Vite large-chunk advisory and locked dependency advisories remain.
