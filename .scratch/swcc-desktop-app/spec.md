# SWCC offline desktop application

Status: ready-for-agent

## Problem Statement

A social worker needs to maintain an annual Continuing Competence Program (CCP) portfolio, but the supplied workflow is spread across a standards document, a review checklist, a Self-Assessment Tool (SAT), and a Professional Development Plan (PDP). Entering information directly into PDF charts makes it difficult to maintain goals, connect one learning activity to several goals, retain evidence, resume work, and produce complete annual paperwork without repeating narratives.

The worker needs private, durable records on their own device, including editable past years and evidence that remains available after original files move. They also need explicit backups, safe recovery, and readable exports in the supplied College-style layouts. The application must distinguish its own readiness and completion rules from regulatory compliance: the approved source set contains an edition discrepancy and is not a complete or automatically updated statement of current College requirements.

## Solution

Build a single-user, offline Electron desktop application for Windows 11 x64 and macOS 14+ on Intel and Apple Silicon. Organize the worker's records into one year package per calendar year, with a dashboard and unlocked destinations for review, self-assessment, development planning, export, and backup/restore.

Use the approved **C (Learning map)** desktop design: a compact olive navigation rail, a relationship-first goal/activity dashboard, and a separate annual workflow checklist. Follow the visual requirements in section 3 of [IMPLEMENTATION_SPEC.md](../../IMPLEMENTATION_SPEC.md).

Use an embedded reader to track actual visits to mapped sections of the supplied standards PDF. Keep annual assessment text and standard selections together, share goal records between SAT and PDP editing, and let activities support zero, one, or multiple goals without duplicating evidence or application-to-practice reflections. Autosave drafts, explain readiness blockers, and require explicit manual completion of each step.

Generate a checklist, one logical annual SAT, and one logical annual PDP using the original source layouts and readable continuation pages. Offer a forms PDF, a complete annual portfolio ZIP with original evidence files, and a separate restorable full-app backup. Preserve local records through restart, installer upgrades, and failed or interrupted restore operations.

## User Stories

1. As a social worker, I want my CCP portfolio to stay on my device under my OS user account, so that I can keep my records private without creating an online account.
2. As a social worker, I want the installed application to work without internet or a development server, so that I can maintain my portfolio wherever I work.
3. As a social worker, I want a brief first-run explanation of local storage and explicit backups, so that I understand how to protect my records.
4. As a social worker, I want to create one year package for a calendar year, so that my annual records stay organized.
5. As a social worker, I want an actionable message when I try to create a duplicate year, so that I can open the existing package instead.
6. As a social worker, I want to create and edit past years, so that I can backfill and correct earlier portfolios.
7. As a social worker, I want year packages sorted newest first with visible status, so that I can quickly find current work and unfinished years.
8. As a social worker, I want a year dashboard with routes into each step and export, so that I can understand and navigate the whole package.
9. As a social worker, I want all steps unlocked, so that I can work in the order that suits me.
10. As a social worker, I want missing readiness items shown as readable checklists, so that I know what remains to be done.
11. As a social worker, I want Ready and Completed to mean different things, so that completion reflects my explicit confirmation rather than an automatic inference.
12. As a social worker, I want meaningful edits to reopen only affected completed steps, so that completion remains accurate without unrelated work being reset.
13. As a social worker, I want ordinary navigation and rereading to preserve completion, so that checking my records does not undo them.
14. As a social worker, I want draft text and valid changes autosaved, so that I can work incrementally without completing every required field.
15. As a social worker, I want Saving, Saved, and actionable error states, so that I know whether my edits are durable.
16. As a social worker, I want failed edits to remain visible and protected from silent navigation or close loss, so that storage failures do not erase my work.
17. As a social worker, I want pending edits saved before completion, export, backup, or shutdown, so that those operations use my latest work.
18. As a social worker, I want labelled controls and ordinary keyboard navigation, so that I can use the application without relying on drag-and-drop, color, or hover.
19. As a social worker, I want to read the complete supplied ethics and standards PDF inside the application, so that review remains available offline.
20. As a social worker, I want page navigation, section navigation, zoom, and a remembered reading position, so that I can resume review conveniently.
21. As a social worker, I want a review section checked only after all of its mapped pages have actually appeared in my active reader viewport, so that skipped or offscreen pages are not counted.
22. As a social worker, I want review progress and reading position kept separately for each year, so that work in one package does not affect another.
23. As a social worker, I want to reset a reviewed section and review it again, so that I can deliberately reopen that part of my checklist.
24. As a social worker, I want reaching the document's final page to expose the other-resources action without checking skipped sections, so that the checklist accurately reflects my navigation.
25. As a social worker, I want the resources website opened in my default browser and launch failures explained, so that I can take the external action without a false completion result.
26. As a social worker, I want the application to explain that the resources website needs internet and that launching it does not prove it was read, so that I understand the limits of tracking.
27. As a social worker, I want to reset the recorded other-resources action, so that I can intentionally reopen Step 1.
28. As a social worker, I want to edit assessment date, strengths, learning needs/interests, and optional peer feedback, so that my SAT reflects my annual self-assessment.
29. As a social worker, I want annual relevant standards selected independently of goals, so that the SAT records my assessment rather than inventing goal-standard relationships.
30. As a social worker, I want peer feedback to be optional and recordable as not applicable, so that a lack of feedback does not prevent assessment completion.
31. As a social worker, I want to create learning goals with titles and optional descriptions, so that I can describe what I intend to learn.
32. As a social worker, I want goals entered in the assessment to appear immediately in the development plan, so that I do not re-enter the same goal.
33. As a social worker, I want to create a goal while entering an activity and see it immediately in the assessment, so that planning stays fluid and consistent.
34. As a social worker, I want stable goal, activity, and evidence references, so that records remain identifiable after deletion, export, and restore.
35. As a social worker, I want a separate editable plan date, so that my PDP date does not overwrite my assessment date.
36. As a social worker, I want new assessment and plan dates initialized to today and correctable for backfilling, so that ordinary entry is quick and historical entry remains possible.
37. As a social worker, I want out-of-year dates to produce a warning rather than rejection, so that I can accurately record work that does not fit neatly into the package year.
38. As a social worker, I want date-only values preserved across timezones and platforms, so that my recorded dates do not shift.
39. As a social worker, I want activities with titles and optional descriptions, so that I can record classes, groups, websites, books, and other learning experiences.
40. As a social worker, I want an activity linked to zero, one, or several goals, so that shared learning and supplementary activities do not need duplicate records.
41. As a social worker, I want Planned, In Progress, and Completed activity states, so that I can retain unfinished work alongside completed learning.
42. As a social worker, I want completed activities to require an actual nonfuture completion date, so that completion records remain valid.
43. As a social worker, I want incomplete activity entry to remain saveable without an invented completion date, so that draft work is not lost.
44. As a social worker, I want evidence and reflection to remain editable after an activity is marked Completed, so that activity completion is not confused with plan readiness.
45. As a social worker, I want each goal to have completed supporting work and every linked activity to have valid evidence and reflection before Step 3 is ready, so that my development plan is substantively complete.
46. As a social worker, I want unlinked activities preserved and exported without blocking Step 3, so that supplementary learning remains useful.
47. As a social worker, I want evidence descriptions or HTTP/HTTPS links to satisfy evidence requirements without a file, so that books and other non-file evidence can be recorded.
48. As a social worker, I want optional evidence files copied into managed local storage, so that moving the original does not break my portfolio.
49. As a social worker, I want identically named evidence files kept separately with their original names recorded, so that importing one file never overwrites another.
50. As a social worker, I want unsupported files, files over 50 MiB, unreadable inputs, and insufficient storage explained, so that I can correct a failed import.
51. As a social worker, I want PDF and image previews inside the application, so that I can inspect common evidence without leaving my workflow.
52. As a social worker, I want other supported documents opened only by an explicit action in their installed desktop application, so that opening evidence is predictable.
53. As a social worker, I want missing associations and document-open failures reported, so that unsuccessful actions are not presented as successful.
54. As a social worker, I want evidence links stored without a network fetch and opened only when I choose, so that recordkeeping remains offline.
55. As a social worker, I want missing or corrupt managed evidence identified and replaceable or removable, so that I can repair my portfolio rather than unknowingly export incomplete evidence.
56. As a social worker, I want deleting a goal to preserve its activities and evidence while removing its links, so that removing one goal does not erase learning records.
57. As a social worker, I want explicit confirmation before deleting an activity and its evidence, so that I understand the consequences.
58. As a social worker, I want year deletion confirmed with a retention explanation, so that I do not accidentally discard a portfolio I may need to retain.
59. As a social worker, I want years kept indefinitely unless I delete them, so that the application does not silently remove historical records.
60. As a social worker, I want to record the actual date of an external renewal declaration separately from when I enter it in the application, so that my record is accurate.
61. As a social worker, I want to record a declaration even when application steps are incomplete, with a warning, so that the application does not rewrite my external submission history.
62. As a social worker, I want later edits to preserve the declaration record, so that correcting my portfolio does not erase that information.
63. As a social worker, I want a year package shown as Complete only when all current step completions and a declaration date exist, so that the dashboard does not overstate completion.
64. As a social worker, I want source edition information and application-readiness wording visible, so that I do not mistake this tool for verification of current College compliance.
65. As a social worker, I want a forms PDF containing the review checklist, one annual SAT, and one annual PDP, so that I can export familiar College-style paperwork.
66. As a social worker, I want the checklist to reflect current checkmarks even if Step 1 is not manually completed, so that draft exports accurately represent my progress.
67. As a social worker, I want annual assessment narratives and standard selections exported once in the SAT, so that the form stays coherent and avoids repeated text.
68. As a social worker, I want each goal included once in both logical forms, so that SAT and PDP each contain the goals they require.
69. As a social worker, I want shared activities, evidence, and reflections exported once in the PDP with all linked goal references, so that one experience is not presented as several.
70. As a social worker, I want supplementary activities labelled No linked goal, so that they remain visible without inventing a relationship.
71. As a social worker, I want long narratives, URLs, accented text, and punctuation carried onto readable continuation pages without clipping or duplication, so that my full account survives export.
72. As a social worker, I want missing draft fields left blank and draft exports allowed after a warning, so that I can review or retain partial work without fabricated content.
73. As a social worker, I want flattened PDFs that display consistently in ordinary viewers, so that recipients do not need the application or interactive form behavior.
74. As a social worker, I want a complete annual portfolio ZIP with a forms PDF, evidence index, manifest, and original attachment bytes, so that I can retain or share a self-contained annual package.
75. As a social worker, I want evidence archive names safe and unique on Windows and macOS while retaining original names in the index, so that files remain identifiable and portable.
76. As a social worker, I want export success reported only after the entire output is written, so that I can trust the resulting file.
77. As a social worker, I want a separate full-app backup of all years, relationships, progress, completion, declarations, and evidence, so that I can recover the whole application dataset.
78. As a social worker, I want the last successful full backup date and an unbacked-changes indicator visible without recurring modal reminders, so that I can make informed backup decisions.
79. As a social worker, I want backup and restore progress shown while conflicting mutations are prevented and pending edits are preserved, so that long operations are understandable and safe.
80. As a social worker, I want a restore preview showing backup date, years, counts, and the dataset to be replaced, so that I can make an informed decision.
81. As a social worker, I want to cancel restore before replacement without changing live data, so that inspecting a backup is safe.
82. As a social worker, I want portfolio archives distinguished from restorable full backups, so that I cannot accidentally replace my dataset with an annual export.
83. As a social worker, I want malformed, incompatible, or tampered backups rejected before replacement, so that importing an archive cannot damage my current records.
84. As a social worker, I want a verified recoverable backup of my current dataset before restore, so that replacement is reversible.
85. As a social worker, I want a failed or interrupted restore to recover my prior usable dataset and explain the outcome, so that recovery never silently substitutes an empty application.
86. As a social worker, I want backups restorable into a fresh installation and between Windows and macOS, so that I can move devices without losing records, dates, or files.
87. As a social worker, I want installer upgrades to preserve my database and evidence, so that receiving a new build does not erase my portfolio.
88. As a social worker, I want accurate unsigned-installer and first-launch guidance for my platform, so that I understand OS warnings and managed-device restrictions.
89. As a maintainer, I want typed, narrowly scoped desktop operations and isolated renderer content, so that user documents do not gain unrestricted filesystem or shell access.
90. As a maintainer, I want runnable source, locked dependencies, migrations, build commands, automated checks, and recorded installed-platform outcomes, so that delivery is reproducible and untested targets are not misrepresented.

## Implementation Decisions

### Product and delivery

- This is a personal application for one social worker. Records belong to the local OS user; there are no application accounts, hosting, server-side storage, or cloud synchronization.
- Target Windows 11 x64 and macOS 14+ x64/arm64. Deliver native installers: a Windows per-user installer and macOS DMGs. Initial unsigned delivery is approved, but installed behavior must be exercised separately from compilation.
- Use Electron, React, TypeScript, SQLite, and locally managed evidence files. Use npm with a lockfile, a Vite renderer, and Electron main/preload processes. Select and pin compatible dependencies during implementation; suitable choices are better-sqlite3, PDF.js, pdf-lib/fontkit, maintained streamed ZIP tooling, and electron-builder or equivalents.
- Treat the supplied resource set as a fixed, identified baseline for every created year. Preserve and bundle required source PDFs as read-only resources. Do not describe the baseline as verified for each year's regulatory requirements.
- Preserve the distinction between the supplied Second Edition ethics document, amended through September 7, 2018, and the assessment tool's reference to the 2023 Third Edition. Application progress is not a guarantee of current-year College compliance.
- Implement the approved C (Learning map) layout, typography, palette, and screen composition. Functional entry screens should make records easy to maintain rather than reproduce PDF chart layouts; exported forms still use the original source layouts.

### Approved visual design: C (Learning map)

- The user approved option C on October 31, 2026. It is the required design; variants A/B and hybrid layouts are not selected.
- Primary source: variant C at `/prototype/swcc?variant=C`, local throwaway branch `prototype/swcc-desktop-ui`, commit `5477044`. Inspect `VariantC`, the C-specific screen compositions, and the styles in `.scratch/swcc-desktop-app/prototype/src/` before renderer implementation. The full binding visual contract is in section 3 of [IMPLEMENTATION_SPEC.md](../../IMPLEMENTATION_SPEC.md).
- Keep C's compact olive utility rail, white header with year picker/save status, left-aligned workspace, rounded white boards, leaf-tinted goal panels, and stable reference chips. The dashboard leads with Record an activity and places goals/activities beside the annual workflow, declaration, and export controls.
- In the development plan, preserve the goal-connection strip above an activity index and a single selected activity editor. Shared activities appear once, with all goal links, evidence, and reflection on that record. Keep the C compositions for review, self-assessment, year list, and backup/restore.
- Use Trebuchet MS with Segoe UI/sans-serif fallbacks and the C palette: `#526332` accent, `#f2f4eb` background, `#ffffff` surfaces, `#303b25` ink, `#647151` muted text, and `#dfe8ca` goal panels. Match C's spacing/control hierarchy and preserve its narrower-window reflow, contrast, and keyboard access.
- Treat the snapshot as a visual reference, not production code. Implement real persistence, OS/file actions, exports, and recovery under the existing contracts. Do not ship sample records, simulated operations, prototype banners, variant controls, state inspector, or reset tools. This approval changes no domain/readiness or PDF export requirements.

### Modules and application interface

- Keep a small set of deep modules: shared domain/types; main data/files; main export/backup; main IPC/preload; and renderer features. The domain module owns record contracts, validation, readiness, and completion invalidation; callers must not duplicate these decisions.
- The data/files module owns SQLite migrations, transactions, managed evidence, and integrity checks. The export/backup module owns annual projections, PDF pagination, archive generation, and staged restore.
- The main/preload interface exposes typed, narrowly scoped operations for records, persistence, review state, completion, evidence, export, backup/restore, and explicit OS actions. It must not expose unrestricted filesystem or shell access.
- Use context isolation, disable Node integration in renderer content, constrain navigation and new windows, and treat PDF content and imported evidence as data rather than executable application content.
- Bundle production assets, fonts, PDF worker/assets, and any required rendering resources locally. Installed operation must not depend on a development server, CDN, or network request.
- Store SQLite and evidence together under Electron's OS-user data directory. Keep caches, restore staging, and the recovery journal outside the replaceable data directory. Retain the dataset across replacement installers.
- Allow one active application instance per OS user to prevent competing database, file, and restore operations.
- Use OS dialogs for evidence import, export destinations, and backup/restore. Validate external URL protocols in main and resolve attachment-open requests from managed IDs rather than renderer-supplied arbitrary paths.
- Surface validation, disk, migration, and IPC failures explicitly. Preserve recoverable data and unsaved edits; do not turn failures into empty datasets, discarded drafts, or success-shaped results.

### Navigation and editing

- Provide a single window with year list, year dashboard, review, self-assessment, development plan, and backup/restore destinations. Dashboard content includes each step's readiness/completion, declaration state, and editing/export routes.
- Enforce one package per calendar year, allow earlier years to be created and edited, and sort newest first. Duplicate-year rejection must explain how to proceed.
- Navigation is guided but unlocked. Neither editing nor step completion imposes a forced Step 1, Step 2, Step 3 order.
- Autosave draft text and otherwise valid changes. Readiness-required fields are not necessarily required to save a draft. Required record titles and valid domain transitions remain enforced.
- Display Saving, Saved, and actionable failures. Retain failed edits visibly and prevent navigation or close from silently discarding them. Flush pending edits before manual completion, export, backup, and shutdown; a failed flush must not produce a falsely successful operation.
- Explain local-only storage and the need for explicit backups once at first run. Make backup/restore discoverable and show quiet backup status without recurring modals or a forced setup wizard.
- Use labelled controls and ordinary keyboard navigation. No essential operation may depend only on drag-and-drop, color, or hover.

### Persisted records and invariants

| Record | Persisted contract |
| --- | --- |
| Year package | Stable ID; unique calendar year; source-set ID; assessment date; strengths; optional peer feedback; learning needs/interests; annual standard selections; plan date; external declaration date and app-recorded timestamp; content revision; created/updated timestamps |
| Goal | Stable ID and package ownership; stable public `G` reference; required title; optional description; created/updated timestamps |
| Activity | Stable ID and package ownership; stable public `A` reference; required title; optional description; status and optional completion date; evidence description/links; application-to-practice reflection; created/updated timestamps |
| Activity-goal link | Unique activity/goal pair, with both records owned by the same package |
| Attachment | Stable ID and package/activity ownership; stable public `E` reference; original filename; managed relative path; type; byte count; SHA-256; import timestamp |
| Review state | Package/document identity; visited physical pages; last page/position/zoom; successful other-resources browser-launch timestamp |
| Step completion | Package and step identity; current relevant revision; completed revision; last manual completion timestamp |
| App metadata | Schema version; data revision; first-run acknowledgement; last successful backup timestamp/revision |

- Assessment and plan are two views of shared annual records, not duplicate goal datasets. Creating a goal in either entry flow updates both views immediately.
- Annual relevant standards belong exclusively to self-assessment. Goals have neither standard IDs nor a goal-standard join table. The twelve choices are Code of Ethics, Meaning of Client, both scopes of practice, and Principles I-VIII.
- Activities link to zero, one, or multiple goals in their own package. Evidence and reflections belong to the activity, never to each activity-goal link.
- Allocate stable `G1`, `A1`, and `E1` references within a year; never recycle or renumber allocated references after deletion or restore.
- Enable SQLite foreign-key enforcement and enforce unique years, unique relationship pairs, valid statuses/dates, ownership, and referential integrity.
- Date-only values use `YYYY-MM-DD` and must not shift with timezone conversion. Operational timestamps use UTC instants.
- Assessment Date and Plan Date are separate, initially today's local date, and editable for backfilling. A valid date outside the package year produces a warning, not rejection.
- Activities are Planned, In Progress, or Completed. Completed requires an actual nonfuture completion date. Planned or In Progress drafts remain saveable without a fabricated date; evidence and reflection can remain pending after activity completion.

### Readiness, manual completion, and declaration

| Step | Readiness rule |
| --- | --- |
| Step 1: Review | All twelve mapped sections checked and the other-resources action successfully launched in the default browser |
| Step 2: Self-assessment | Valid assessment date; nonblank strengths and learning needs/interests; at least one annual standard selection; at least one valid goal |
| Step 3: Development plan | Valid plan date; at least one goal; each goal has at least one completed linked activity; every linked activity is Completed with a valid date, evidence, and nonblank application-to-practice reflection |

- For Step 3, evidence is at least one nonblank evidence description, valid evidence link, or readable attached evidence file. Files are optional. Unlinked activities do not block readiness. Peer feedback is optional and may be recorded as not applicable.
- Readiness is computed independently for each step, with readable missing-item checklists. Use one domain implementation for renderer feedback, completion commands, and export warnings.
- Distinguish Draft/In Progress, Ready, and Completed. Complete Step explicitly flushes pending edits, evaluates current readiness, and records the relevant revision and manual completion timestamp only on success.
- A completion is current only while its completed revision matches its relevant content revision. Meaningful changes require renewed manual confirmation, even when readiness is still satisfied.

| Change | Completion invalidated |
| --- | --- |
| Review section reset or other-resources state reset | Step 1 |
| Assessment text/date/annual standards | Step 2 |
| Goal creation, title/description edit, or deletion | Steps 2 and 3 |
| Plan date or activity content/status/date/links/evidence/reflection | Step 3 |
| Reader navigation/zoom without changed checkmarks, rereading completed sections, or ordinary navigation | None |

- Deleting a goal removes its links but preserves its activities and evidence. Deleting an activity removes its links and evidence records/files after explicit confirmation.
- Confirm year deletion and explain portfolio-retention implications. Keep years indefinitely unless explicitly deleted; no scheduled cleanup is permitted.
- Record the actual external renewal submission date independently from the timestamp at which it was entered in the application. Allow declaration recording with incomplete application steps, but warn.
- A package is Complete only when all three steps are manually completed at current relevant revisions and a declaration date is recorded. Later edits preserve the declaration.
- The application neither submits nor verifies renewal declarations. If a declaration-entry revision is retained, describe later edits as changes since the declaration was recorded in the application, not as reconstructed external submission history.

### Offline review tracking

- Render the complete supplied 48-page ethics PDF with PDF.js and local worker/assets. Use physical PDF page numbers, with the cover as page 1.

| Checklist section | Physical pages |
| --- | --- |
| Code of Ethics | 2 |
| Meaning of Client | 4 |
| Scope of Practice for Social Work | 7 |
| Scope of Practice for Social Service Work | 8 |
| Principle I: Relationship with Clients | 9-10 |
| Principle II: Competence and Integrity | 11-15 |
| Principle III: Responsibility to Clients | 16-18 |
| Principle IV: The Social Work and Social Service Work Record | 19-26 |
| Principle V: Confidentiality | 27-31 |
| Principle VI: Fees | 32-33 |
| Principle VII: Advertising | 34-37 |
| Principle VIII: Sexual Misconduct | 38-40 |

- A rendered page counts as visited only while the reader/window is visible and active, when its visible height reaches at least half of the smaller of the page height and the reader viewport height. Use no dwell timer.
- Fetching, offscreen rendering, thumbnails, incidental slivers, and pages skipped by navigation do not count. This is navigation tracking, not proof of comprehension.
- Check a section only after every mapped page is visited. Persist visited pages and resume position per package/document; switching years or restarting must not mix progress.
- A section reset removes that section's mapped pages from the visited set and reopens Step 1. Subsequent qualifying visits may automatically check it again.
- After physical page 48 has actually been displayed, expose Other required resources. Reaching it must not mark skipped sections. Unmapped pages do not create extra checklist categories.
- Use the plain CCP resources URL from the assessment tool's physical-page-6 checklist row, not its separate stale page-5 fragment link.
- Check the thirteenth item only after the OS browser-launch call succeeds. On failure, show an actionable error and leave it unchecked. Explain that the website needs internet and that launch success does not verify loading or reading. Support resetting the recorded action.

### Evidence and managed files

- Support evidence text, HTTP/HTTPS links, and optional files. Do not fetch links during entry, validation, or form use; browser opening is an explicit action.
- Initially support `pdf`, `png`, `jpg`, `jpeg`, `webp`, `gif`, `bmp`, `doc`, `docx`, `xls`, `xlsx`, `ppt`, `pptx`, `rtf`, `txt`, and `csv`. Import files, not directories.
- Enforce 50 MiB, exactly 52,428,800 bytes, per file. There is no specified total yearly size cap. Explain unsupported type, oversized input, unreadable input, and insufficient storage.
- Copy imported bytes into managed storage with unique filenames/paths, retain original names as metadata, and calculate SHA-256. Do not rely on original source paths for durable evidence or overwrite attachments with identical original names.
- Preview PDFs and supported images internally. Open other supported documents only by explicit action in the installed desktop application; report missing associations and open failures. Provide no Office conversion.
- Missing or corrupt managed evidence is an explicit integrity error. Offer replacement or removal. An operation requiring unavailable bytes must fail rather than silently omit evidence or claim completion.

### Annual PDF generation

- Produce one checklist, one logical SAT, and one logical PDP per year. Continuation pages extend those logical forms; do not generate a separate form per goal.
- Within the SAT, annual strengths, peer feedback, learning needs, and each goal narrative appear once. Annual standard selections are independent of goals.
- Within the PDP, each goal appears once; each activity narrative, evidence narrative, and reflection appears once with stable references. Shared activities list all linked goal references; unlinked activities say No linked goal.
- Goals appearing once in the SAT and once in the PDP is intentional. Repeated references and continuation labels are navigation metadata, not repeated narratives.
- Use the supplied one-page image-based checklist background, which has no AcroForm fields. Overlay an `X` for each current checked row; measure actual row coordinates and compare rendered output with the source.

| Original template | Physical page and form fields |
| --- | --- |
| SAT | Page 8: `Text35` strengths; `Text36` peer feedback; `Text37` needs/interests; `Text38` goals; `Date44_af_date` assessment date |
| SAT annual standards | `Check Box 14` through `Check Box 25`, in the twelve-choice order defined above |
| PDP | Page 11: `Text39` goals; `Text40` activities; `Text41` evidence; `Text42` application to practice; `Date43_af_date` plan date |

- Fill an isolated source-template copy for each output template page, update appearances, flatten, and then copy the selected physical page into the final document. Flatten before merging repeated template pages to prevent AcroForm-name collisions.
- Preserve original backgrounds and labels. Measure field rectangles, font metrics, padding, and line heights. Bundle a licensed local font supporting accented characters and normal punctuation.
- Use readable body text of at least 10 pt. Wrap and paginate instead of shrinking text to fit; long unbroken words and URLs must not clip.
- Continuations use the same source layout and only remaining narrative content. Identify the annual document/continuation unobtrusively and repeat references where needed to identify a split record without restarting its narrative.
- Render annual standard selections on the first SAT page. Always emit the logical SAT and PDP, even for a draft with no goals; leave missing content blank.
- The checklist follows current checkmarks independently of manual Step 1 completion. Finished PDF fields are flattened and interactive scripting is excluded.

### Export operations

- Export Forms PDF contains the checklist, SAT, PDP, and continuations. It references evidence but does not embed every attachment.
- Export Complete Portfolio ZIP contains the forms PDF, a text evidence index, a portfolio manifest, and original attachment bytes in stable evidence-reference directories.
- The evidence index identifies activity/evidence references, original filenames, and archive paths without repeating reflection narratives. Sanitize archive filenames for Windows and macOS, keep paths unique, and retain original names in the index.
- A portfolio manifest identifies the archive as a portfolio and records year, export time, source-set identity, attachment sizes, and hashes. Portfolio export is not a restorable full-app backup.
- Flush drafts and read a consistent snapshot before exporting. If readiness or manual completion is incomplete, show missing items and allow the user to continue with a draft export; incompleteness alone must not hard-block export.
- Actual generation, required-evidence, or file-write failures are errors. Report success only after the complete output is written.

### Full-app backup and restore

- Full backup covers all years, records, relationships, review progress, manual completion/declaration states, relevant metadata, and managed attachments.
- Use a portable ZIP with a manifest explicitly identifying a full backup, archive/schema version, app/source-set identity, creation time, snapshot data revision, inventory, sizes, and hashes.
- Bundled source PDFs and regenerable preview caches need not be copied, but source identities must be compatible on restore.
- Use SQLite's backup mechanism for a consistent database snapshot; copying only the live database can miss WAL data. Prevent conflicting mutations/deletions while collecting the snapshot and attachment bytes, and show progress/busy state without losing pending edits.
- Write to a temporary destination and publish the final archive only after successful completion. Only then update last-successful-backup timestamp/revision. Backup operational metadata must not immediately make the dataset appear unbacked; subsequent user-data revisions should.
- Restore replaces the whole dataset, never merges it. Before any live-data change, reject portfolios, malformed manifests, unsupported/future schemas, incompatible source sets, invalid paths, duplicate entries, symlinks, missing files, size/hash mismatches, and invalid database integrity or relationships.
- Extract only validated manifest entries into scoped staging. Reject absolute and parent-traversal paths, and enforce actual per-file evidence limits during extraction rather than trusting declared sizes.
- Show backup date, years, record/file counts, and the current dataset to be replaced. Cancellation before confirmation leaves live data unchanged.
- After explicit replacement confirmation, create and verify a recoverable full backup of the current dataset. If that fails, stop before replacement.
- Close the database, use staged directory moves and a recovery journal for whole-directory replacement, and retain the prior directory/recovery backup until the new dataset opens and passes validation.
- Failed or interrupted replacement must recover the prior usable dataset and explain the outcome. Never substitute an empty database and report success.
- Restore must preserve stable references, relationships, filenames, hashes, and date-only values across fresh installations and Windows/macOS transfers.

### Implementation order and delivery gates

1. Establish the desktop shell and data/files module. A packaged app must open without a development server and persist a year and draft records across restart.
2. Implement annual records and relationships. Assessment, goals, activities, evidence, deletion, and autosave must satisfy the contracts, including one activity supporting multiple goals.
3. Implement review tracking and completion. Offline rendering, actual viewport visits, manual completion, and precise invalidation must work.
4. Implement export. Original layouts must contain complete annual data, including long content and shared/unlinked activities, without repeated narratives.
5. Implement backup/recovery. A full backup must restore into a fresh installation; malformed archives and interrupted replacement must preserve an existing usable dataset.
6. Package and exercise target builds. Provide the three target installer artifacts where build environments are available, accurate unsigned-launch instructions, and recorded acceptance outcomes.

Each gate must meet its completion criterion before being treated as delivered. A successful installer build is not evidence that the installed application works.

## Testing Decisions

- **Confirmed testing seam:** use the application's public typed operations exposed through preload as the primary integration seam. Exercise the same record, completion, evidence, export, and backup/restore interface used by renderer callers, with real SQLite, managed files, source PDFs, and PDF/ZIP generation.
- Do not add competing test-only application interfaces or abstractions for hypothetical alternatives. Use narrow controlled substitutes only for dependencies that genuinely vary in tests, such as OS browser/document actions, time-dependent cases, storage failures, and restore interruption. Keep such seams internal where possible.
- Add focused tests through the domain module's interface for validation, readiness, and relevant-revision invalidation. These are supplementary to the main application seam, not a duplicate implementation of business rules.
- Use renderer/end-to-end checks at the user-facing application interface for actual PDF viewport visibility, keyboard operation, autosave status, protected unsaved edits, navigation, and independent year state. Test installed builds for platform integration and disconnected operation.
- Good tests assert observable records, readiness/checklists, completion state, preserved edits, files, rendered/exported content, and recovery outcomes. Do not assert private helper structure, SQL call counts, library internals, or mock choreography.
- **Prior art:** the repository currently contains approved requirements, source documents, and agent conventions, but no application modules, dependency manifest, test runner, or existing automated tests. Use the approved acceptance cases as behavioral precedents, not as claims of an existing test suite. Establish focused domain/integration and renderer/end-to-end tooling during implementation.
- Test the domain, data/files, review workflow, completion, export/backup, and main/preload modules through their observable interfaces; validate renderer behavior through ordinary UI actions rather than synthetic claims that a page was viewed.

| Acceptance area | Required observable result |
| --- | --- |
| Approved design fidelity | All destinations follow C (Learning map), including the relationship-first dashboard, goal-connection plan editor, shared shell, palette, typography, and usable narrow-window reflow; no prototype-only controls or sample data ship |
| Annual persistence | Create current/past years, reject duplicates actionably, edit drafts, restart, retain records, and sort newest first |
| Independent standards | Annual selections persist/export and affect Step 2; goal records have no standard relationship |
| Shared and inline-created goals | One activity supports two goals with one evidence/reflection record; inline creation updates both assessment and plan without duplicate goals |
| Unlinked activities | Supplementary activities remain editable/exported once and do not block Step 3 |
| Reader visits | Offscreen rendering, thumbnails, jumps, incidental slivers, and hidden/inactive readers do not mark pages; qualifying viewport visits do, including the exact visibility threshold |
| Reader persistence/end/reset | Progress remains year-specific across restart; actual page 48 exposes resources without checking skipped sections; browser launch failure stays unchecked; resets reopen Step 1 |
| Readiness and manual completion | Ready is not Completed; incomplete completion reports blockers; meaningful edits invalidate exactly affected steps while ordinary navigation and rereading preserve completion |
| Activity/date rules | Planned linked work blocks Step 3; Completed requires a nonfuture date; evidence/reflection can remain pending; out-of-year dates warn and retain date-only values across restart/timezones |
| Declaration | Recording a past declaration with incomplete steps warns; later edits preserve it; package Complete requires all current manual completions and a declaration date |
| Evidence import | Notes/links can satisfy evidence without files; imported bytes survive source-file moves; duplicate original names remain distinct; exactly 50 MiB is permitted and larger files/unsupported types fail clearly |
| Evidence failures/deletion | Unreadable inputs, missing/corrupt managed files, unavailable associations, failed opens, and storage exhaustion are explicit; failed imports do not appear successful; goal deletion preserves activity evidence and confirmed activity deletion removes its own evidence |
| Source-form fidelity | Checklist marks align with the actual one-page source; SAT/PDP use physical pages 8/11 and correct fields/checks; finished output is flattened |
| Pagination and no duplication | Long paragraphs, many goals/activities, long words/URLs, accents, and punctuation render fully at readable size; continuations neither clip nor restart narratives; shared/unlinked activities appear once |
| Draft and complete exports | One logical SAT/PDP always exists, including empty-goal drafts; incomplete work warns but may export; the ZIP index identifies all original evidence bytes with correct sizes/hashes and safe unique paths |
| Archive distinction/backup state | Portfolio import is rejected as a backup; full backup includes all years and progress/completion; failed backup leaves success metadata unchanged; a successful backup does not immediately appear unbacked |
| Snapshot consistency | Pending edits are flushed and database/WAL state plus attachment inventory describe one consistent snapshot under attempted concurrent mutation/deletion |
| Restore validation/cancellation | Fresh-install restore reproduces relationships, references, files, and dates; cancellation and malformed, traversal, duplicate-entry, symlink, oversized, missing-file, hash-invalid, future-schema, source-incompatible, or database-invalid archives leave current data intact |
| Restore replacement/recovery | Failure of the protective backup prevents replacement; injected failures at staged-move/reopen/validation phases and restart recovery retain a usable prior dataset and explain what happened |
| Autosave failure | Failed writes retain visible unsaved edits, prevent silent loss, and never falsely report Saved, Completed, or successful export/backup |
| Installed offline operation | Each exercised target installer launches without development tools; disconnected reader, editing, previews, PDF/ZIP export, backup, and restore work; external website actions remain explicitly online |
| Cross-platform/upgrade behavior | Windows/macOS restore retains filenames and date-only values; later installers retain existing records/evidence; migration failures do not reset the dataset; one-instance behavior prevents competing operations |

- Compare generated PDFs both by extracted observable content/reference counts and rendered source-layout fidelity. Use the actual bundled templates and inspect finished documents for clipping, missing content, duplicate narratives, and unflattened fields; do not treat file existence as sufficient.
- Inspect ZIP manifests, indexes, inventory, and extracted original bytes. Use real temporary datasets and evidence files for backup/restore, and exercise startup recovery after interruption rather than only catching an in-process error.
- Record actual installed-platform smoke results separately from automated checks and compilation. Clearly mark targets whose installed behavior has not been exercised; platform availability must not be disguised as passing acceptance.

## Out of Scope

- ChromeOS, Linux, Windows ARM, and guarantees for operating systems older than the stated targets.
- Accounts, hosting, cloud synchronization, collaboration, server-side storage, or extra regulatory modules.
- Automatically updated regulatory requirements, substitution of the newer Code, additional official 2026 readings, SAPP, or any guarantee of current-year College compliance.
- App submission or verification of external renewal declarations, and reconstruction of external declaration history.
- Goal copying, goal-specific standards, separate goal statuses, hours tracking, target dates, mandatory goal/hour quotas beyond the approved application readiness rules, and an app-specific pass score.
- Forced step ordering, automatic step completion, proof of comprehension, dwell-time tracking, recurring backup reminder modals, or a forced setup wizard.
- Per-goal duplicate SAT/PDP forms, font shrinking to hide overflow, fabricated draft content, and silent omission of unavailable required evidence bytes.
- Directory imports, Office conversion, a total yearly attachment size quota, automatic retention cleanup, and restore merging or duplicate-year conflict resolution.
- Automatic updates and initial signing/notarization as delivery prerequisites. Certificates may be supplied separately later; unsigned launch is not guaranteed on every managed device.
- Further selection among prototype variants or replacement with A/B; C (Learning map) is approved for implementation.

## Further Notes

- The authoritative implementation handoff is [IMPLEMENTATION_SPEC.md](../../IMPLEMENTATION_SPEC.md), approved after the October 31, 2026 design interview and amended with the same-day approval of visual design C (Learning map). This tracker spec is its synthesis, not a replacement; preserve the root document. The testing-seam proposal above was explicitly confirmed during this spec session.
- At synthesis time, the repository has no root domain glossary or ADRs and no implemented application or tests. Use the approved terms year package, SAT, PDP, goal, activity, evidence, readiness, manual completion, and declaration; no existing ADR conflict was found.
- Local tracker publication follows [issue-tracker conventions](../../docs/agents/issue-tracker.md), with the canonical `ready-for-agent` status from [triage labels](../../docs/agents/triage-labels.md). No additional triage is required.
- Read the originals before implementing the corresponding feature: [original concept](../../Meyering%20App.md) for navigation/easy entry; [ethics and standards PDF](../../Code-of-Ethics-and-Standards-of-Practice-September-7-2018%20%281%29.pdf) for the reader; [Step One checklist](../../Step%20One%20SWCC.pdf) for measured checkmarks; and [2026 assessment tool](../../OCSWSSW-CCP-Assess-Tool-2026-English.pdf) for SAT/PDP fields and layouts. This synthesis carries forward the approved document measurements/contracts; implementation must inspect the actual PDFs rather than assume those measurements have been validated by this spec-writing session.
- The resources action uses `https://www.ocswssw.org/registrants/continuing-competence-program/`.
- The supplied guide describes at least ten years of portfolio retention and an external annual renewal declaration. The application retains years indefinitely unless explicitly deleted and uses the approved application readiness rules, not an inferred regulatory quota.
- Preserve the approved annual portfolio archive contract:

```text
CCP-<year>-portfolio.zip
  CCP-<year>-forms.pdf
  evidence-index.txt
  manifest.json
  evidence/
    E1/<safe-original-filename>
    E2/<safe-original-filename>
```

- Use the distinct full-app backup contract, with its full-backup manifest and complete managed evidence inventory:

```text
SWCC-<timestamp>.swcc-backup.zip
  manifest.json
  database.sqlite
  evidence/<managed-attachment-files>
```

- Delivery includes runnable source, dependency lockfile, schema/migrations, build commands, focused automated checks, generated installer artifacts where target build environments are available, and a short unsigned-install/backup guide. The guide must accurately describe Gatekeeper overrides and possible Windows SmartScreen/Smart App Control restrictions. Updates are manually delivered replacement installers, and any unexercised target platform must be identified explicitly.

## Comments

### 2026-10-31: Desktop UI prototype

**Question:** Which desktop information hierarchy makes annual reflection, review, and shared goal/activity records easiest to maintain?

**Primary source:** Local throwaway branch `prototype/swcc-desktop-ui`, commit `5477044`. Source lives in `.scratch/swcc-desktop-app/prototype/`, with the npm/Vite task runner at the repository root on that branch. The supplied PDFs are copied into the prototype; the originals are unchanged.

Run `npm run prototype`. Open `http://127.0.0.1:5173/prototype/swcc?variant=A`; use the floating arrows or keyboard left/right arrows to compare `A`, `B`, and `C`. Input editing does not intercept those keys. The state inspector shows all annual sample records; switching designs retains edits, while reloading discards them.

| Variant | Design question |
| --- | --- |
| A: Practice desk | Does steady sidebar navigation and an explicit annual workflow make it easiest to resume work? |
| B: Annual folio | Does a writing-first open folio give self-assessment the right priority? |
| C: Learning map | Does leading with goal/activity relationships make shared learning clearer? |

Coverage includes year packages, dashboard, the actual supplied PDF reader, self-assessment, shared goals, activity/evidence/reflection editing, manual completion, declaration entry, annual export preview, and sample backup/restore confirmation. These are browser UI prototypes, not an Electron delivery. Records and selected evidence files are in memory only; export and backup/restore demonstrations write no files. Source-template links open unfilled originals, not generated forms.

**Initial verdict:** Three structurally distinct candidates were captured for comparison; selection was pending at capture time. This verdict is superseded by the approval below.

### 2026-10-31: Design C approved

The user selected option C: "I like option C. Lets amend the spec to make sure that it uses that design".

**Answer:** Use **C (Learning map)** for the production desktop application. The relationship-first layout is now the binding visual direction, including C's navigation shell, goal/activity dashboard, plan editor, typography, and palette. The prototype remains preserved on `prototype/swcc-desktop-ui` at `5477044`; view the chosen design at `http://127.0.0.1:5173/prototype/swcc?variant=C`.

Both this feature spec and the authoritative `IMPLEMENTATION_SPEC.md` now require C and include a design-fidelity acceptance criterion. The prior visual-selection milestone is complete. Functional implementation is still required, so the feature remains `ready-for-agent`; this approval does not promote throwaway code or simulation behavior into production.

### 2026-10-31: Development-first delivery scope

The user requested: "Once you've completed the base functionality, don't worry about making the installers - I want to fully walk through the application in dev mode before I actually try to deploy it in anything other than a dev environment".

For this implementation run, finish the functional tickets through 13, review/fix the integration branch, and provide the working development application and run instructions. Do not build new installers or claim installed-target/cross-platform-transfer acceptance. Tickets 14-16 remain deferred and unresolved for a later deployment phase; the target-platform contracts in `IMPLEMENTATION_SPEC.md` are not removed or treated as passed.
