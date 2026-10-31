# SWCC Desktop Application: Implementation Specification

Status: approved after a design interview on October 31, 2026; visual design C (Learning map) approved the same day.

This is the handoff for the implementation session. Build the functional application described here using the approved C (Learning map) design specified in section 3.

## 1. Product contract

Help one social worker maintain an annual Continuing Competence Program (CCP) portfolio: review the supplied standards, complete a self-assessment, record learning goals and activities, retain evidence, and export the College-style paperwork.

| Area | Approved decision |
| --- | --- |
| Users | Personal application for one worker; records belong to their local OS user account |
| Platforms | Windows 11 x64; macOS 14+ on Intel and Apple Silicon |
| Delivery | Native installers; unsigned initial installers are acceptable with accurate first-launch instructions |
| Runtime | Offline, local-only Electron application; no account, hosting, server-side storage, or cloud synchronization |
| Stack | Electron, React, TypeScript, SQLite, locally managed attachment files |
| Years | One package per calendar year; past years can be created and edited; newest year first |
| Workflow | Guided navigation with unlocked steps; readiness checks followed by explicit manual step completion |
| Visual design | C (Learning map): compact olive navigation rail, goal/activity relationship board, and a separate annual workflow checklist |
| Forms | One logical SAT and one logical PDP per year; original layouts with continuation pages |
| Exclusions | ChromeOS, Linux, Windows ARM, older-OS guarantees, goal copying, hours tracking, target dates, separate goal statuses, automatic updates, additional regulatory modules, and collaboration |

Use the supplied documents as the baseline, **not** an automatically updated regulatory requirements service. The user explicitly chose this baseline after the edition discrepancy below was identified.

### Source documents

Read these local files before implementing their corresponding feature. Preserve the originals; bundle required PDFs as read-only application resources.

| Local file | Role / implementation trigger |
| --- | --- |
| `Meyering App.md` | Original concept; consult when implementing package navigation and easy-entry workflows |
| `Code-of-Ethics-and-Standards-of-Practice-September-7-2018 (1).pdf` | Built-in reader document and page-to-checklist mapping |
| `Step One SWCC.pdf` | One-page checklist export background; consult before measuring checkmark positions |
| `OCSWSSW-CCP-Assess-Tool-2026-English.pdf` | SAT/PDP export templates and form field definitions |

The ethics PDF is the Second Edition, amended through September 7, 2018. The assessment-tool PDF references the 2023 Third Edition. Official 2026 requirements also include materials absent from this source set. This application intentionally does not add the newer Code, those readings, or SAPP. Preserve document edition information and describe progress as **application readiness/completion**, not a guarantee of current-year College compliance. Apply the supplied resource set consistently to created years without labelling it verified for each year's regulatory requirements.

The supplied guide describes portfolio retention of at least ten years and an external annual renewal declaration. It does not establish an app-specific pass score or mandatory goal/hour quota. The readiness rules in section 4 are the user's chosen application rules.

## 2. Implementation sequence

1. **Establish the desktop shell and data layer.** Completion: a packaged application opens without a development server, creates/opens local storage, and persists a year and its draft records across restart.
2. **Implement annual records and relationships.** Completion: assessment, goal, activity, evidence, deletion, and autosave behavior satisfy sections 3 and 4; one activity can support multiple goals without duplicate records.
3. **Implement review tracking and completion.** Completion: the supplied PDF works offline, actual viewport visits drive the correct checklist items, and manual completion/invalidation satisfy sections 4 and 5.
4. **Implement exports.** Completion: the original templates contain the complete annual data, including long content and shared/unlinked activities, with the no-duplication guarantees in section 7.
5. **Implement backup and recovery.** Completion: a full backup restores into a fresh installation, and malformed archives or interrupted replacement preserve the existing dataset.
6. **Package and exercise target builds.** Completion: unsigned installers and first-launch instructions exist for all three CPU/OS targets; the acceptance cases in section 10 have recorded outcomes.

Each step must reach its completion criterion before it is treated as delivered. An installer build alone is not evidence that the installed application works.

## 3. Functional navigation and editing

Provide a single-window recordkeeping interface with these destinations:

| Destination | Required functions |
| --- | --- |
| Year list | Create a year, reject duplicate years with an actionable message, open/edit earlier years, show status, sort newest first |
| Year dashboard | Show checklist/readiness/completion for each step, external declaration state, and routes into editing/export |
| Review | Embedded PDF reader, section checklist, remembered position, section reset, end-of-document resources action |
| Self-assessment | Edit date, strengths, optional peer feedback, learning needs/interests, annual relevant standards, and learning goals |
| Development plan | Edit plan date, goals, activities, goal links, completion states/dates, evidence, and application-to-practice reflections |
| Backup/restore | Full-app backup, import preview, replacement confirmation, backup date/unbacked-changes indicator |

Goals entered in the assessment immediately appear in the plan. A goal created while entering an activity immediately appears in the assessment. These are views of the same goal records.

Autosave draft text and valid changes. Show Saving, Saved, and actionable error states. Keep failed edits visible; prevent navigation/close from silently discarding unsaved changes. Flush pending edits before completion, export, backup, and shutdown. Drafts may lack readiness fields; a field being required for step completion does not make it required for saving an otherwise valid draft.

Give a brief first-run explanation that data lives on this device and needs explicit backups. Make backup/restore discoverable and show the last successful full backup and whether subsequent data changes remain unbacked. Use quiet status, not recurring modal reminders or a forced setup wizard.

Use labelled controls and ordinary keyboard navigation; functionality must not depend on drag-and-drop, color, or hover alone.

### Approved visual design: C (Learning map)

The user selected **option C, Learning map**, on October 31, 2026. This is the required visual direction, not an optional inspiration or a pending selection. Do not substitute variants A/B or combine their layouts without further user approval.

**Primary visual source:** variant C at `/prototype/swcc?variant=C` on the local throwaway branch `prototype/swcc-desktop-ui`, commit `5477044`. Inspect `VariantC` and the C-specific screen layouts in `.scratch/swcc-desktop-app/prototype/src/App.tsx`, together with `.scratch/swcc-desktop-app/prototype/src/styles.css`, before implementing the renderer. Preserve this snapshot as the design reference outside the production implementation.

Preserve C's visual system:

- A compact olive utility rail on the left, with navigation for the year overview, review, self-assessment, development plan, all years, and backup/restore. A white workspace header contains the SWCC identity, year picker, and quiet save status.
- Left-aligned content, generous workspace spacing, rounded white relationship boards, leaf-tinted goal panels, restrained activity panels, and stable reference chips. Relationships, rather than metrics or decorative card grids, are the dashboard's defining element.
- Trebuchet MS typography with Segoe UI and sans-serif fallbacks. Fonts and assets must work locally; do not introduce a CDN dependency.
- Palette: olive accent `#526332`, linen background `#f2f4eb`, white surfaces `#ffffff`, ink `#303b25`, muted text `#647151`, and leaf-tinted panels `#dfe8ca`. Preserve readable contrast and visible keyboard focus.

| Destination | Required C screen composition |
| --- | --- |
| Year list | Newest-first year rows with status and create/open actions, within the shared C shell |
| Year dashboard | A primary relationship board with goals on the left and activities on the right; each activity appears once and shows its linked goal references. An adjacent annual workflow checklist shows step readiness/manual completion, external declaration entry, and export access. Lead with Record an activity. |
| Review | Section checklist beside the supplied PDF reader, with page/zoom controls and the resources action; use C's shell and visual system |
| Self-assessment | Narrative fields and annual standard choices in the main writing area, with shared goals and step readiness alongside |
| Development plan | A goal-connection strip above an activity index and one selected activity editor. Selecting an activity reference opens its single shared record, including goal links, evidence, and application-to-practice reflection. Preserve inline goal creation and visible supplementary activities. |
| Backup/restore | Full-backup explanation/action with quiet backup status and a separate restore entry; preview the whole-dataset replacement before confirmation |

Match C's hierarchy, palette, typography, spacing, and control treatment across destinations. Adapt the layout for narrower windows by reflowing the rail and columns, as in C's prototype; retain ordinary keyboard access and readable controls.

The prototype establishes the design, **not production behavior or implementation quality**. Build production components against all functional contracts in this handoff. Replace in-memory samples and simulated file/export/backup actions with the specified real operations; omit prototype banners, the variant switcher, state inspector, and reset controls. This design approval does not change readiness rules, persistence, archive contracts, or the original exported PDF layouts.

## 4. Domain model and workflow state

### Persisted records

Use stable internal IDs. Keep public goal/activity/file references stable within their year, including after deletion and restore.

| Record | Required data |
| --- | --- |
| Year package | ID, unique calendar year, source-set ID, assessment date, strengths, optional peer feedback, learning needs/interests, annual standard selections, plan date, declaration date/recorded timestamp, content revision, created/updated timestamps |
| Goal | ID, package ID, stable `G` reference number, title, optional description, created/updated timestamps |
| Activity | ID, package ID, stable `A` reference number, title, optional description, status, optional completion date, evidence description, evidence links, application-to-practice text, created/updated timestamps |
| Activity-goal link | Activity ID and goal ID; unique relationship; both records belong to the same package |
| Attachment | ID, package/activity IDs, stable `E` reference number, original filename, managed relative path, type, byte count, SHA-256, import timestamp |
| Review state | Package/document IDs, visited physical page numbers, last page/position/zoom, other-resources browser-launch timestamp |
| Step completion | Package ID, step key, current relevant revision, completed revision, last manual completion timestamp |
| App metadata | Schema version, data revision, first-run acknowledgement, last successful backup timestamp/revision |

**Standards belong exclusively to the annual self-assessment. Goals have no standard IDs or goal-standard join table.** The annual SAT has twelve standard choices: Code of Ethics, Meaning of Client, both scopes of practice, and Principles I-VIII.

Relationships:

- A package contains its assessment, goals, activities, review state, and step completions.
- Activities link to zero, one, or multiple goals within that package.
- Evidence descriptions/links and attachments belong to activities, not their goal links.
- Allocated `G1`, `A1`, and `E1` references are not reassigned or renumbered when another record is deleted.
- Goal titles and activity titles are required for creating valid records. Other completeness requirements are evaluated as readiness.

Enforce unique years, unique link pairs, valid statuses/dates, ownership, and referential integrity. Enable SQLite foreign-key enforcement. Date-only values use `YYYY-MM-DD`; operational timestamps use UTC instants. Preserve date-only values across timezones.

### Activity lifecycle and dates

Activities have **Planned**, **In Progress**, and **Completed** states. Completed requires an actual completion date that is not in the future. Evidence and reflection may still be pending, making the plan not ready. Incomplete activity entry remains saveable as a draft without inventing a completion date.

Assessment Date and Plan Date are separate editable date-only fields, initially today's date and correctable when backfilling. A date outside the package year produces a warning rather than rejection. Completed activity dates still obey the no-future-date rule.

### Readiness

Evaluate each step independently; navigation and step completion do not impose a forced Step 1 -> Step 2 -> Step 3 sequence.

| Step | Ready when |
| --- | --- |
| 1. Review | All twelve mapped sections are checked and the other-resources action has successfully launched the default browser |
| 2. Self-assessment | Valid assessment date; nonblank strengths and learning needs/interests; at least one annual standard selection; at least one valid learning goal |
| 3. Development plan | Valid plan date; at least one goal; each goal has at least one completed linked activity; every linked activity is Completed with a valid date, evidence, and nonblank application-to-practice reflection |

For readiness, evidence means at least one nonblank evidence description, valid evidence link, or readable attached evidence file. A file is optional. Peer feedback is optional and may be recorded as not applicable. Unlinked activities are supplementary and do not block Step 3 readiness.

Expose the missing items as a readable checklist, not only a percentage. Keep these readiness decisions in one domain implementation shared by the UI, completion command, and export warnings.

### Manual completion and invalidation

Distinguish Draft/In Progress, Ready, and **Completed**. Ready is computed; Completed requires the user to invoke **Complete Step** and pass the current readiness checks.

Record the relevant revision and timestamp on manual completion. Meaningful edits invalidate the affected completion until it is manually confirmed again:

| Change | Affected completion |
| --- | --- |
| Review reset or other-resources state reset | Step 1 |
| Assessment text/date/annual standards | Step 2 |
| Goal creation, title/description edit, or deletion | Steps 2 and 3 |
| Plan date, activity content/status/date/links/evidence/reflection | Step 3 |
| Reader navigation/zoom without changed review checkmarks; ordinary navigation | No completion invalidation |

An already completed step remains completed during rereading unless its checklist is reset. Track relevant content revisions rather than treating every window or navigation preference as a content edit.

Deleting a goal removes its links and preserves its activities and evidence. Deleting an activity removes its own links and evidence records/files after explicit confirmation. Confirm year deletion and explain the portfolio retention implications. Keep years indefinitely unless the user explicitly deletes them; implement no scheduled retention cleanup.

### Declaration and package completion

The user records submission through the College's external renewal process. Store the actual external submission date independently from when that date was entered in the app.

Allow recording this date with incomplete app steps, but display a warning. A package is **Complete** only when all three steps are manually completed at their current revisions and a declaration date is recorded.

Later edits preserve the declaration record. If tracking revisions at declaration entry, describe subsequent changes as changes since the declaration was **recorded in the app**, not a reconstruction of the external submission history. The app does not submit or verify renewal declarations.

## 5. PDF reading and automatic checklist

Bundle the complete supplied 48-page ethics PDF. Implement offline PDF rendering with PDF.js and locally bundled worker/assets. Provide ordinary page/section navigation, zoom, and remembered position per yearly package.

Use **physical PDF page numbers**, where the cover is page 1:

| Checklist item | Pages |
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

A section checks automatically when every mapped page has actually been displayed in the active reader viewport. A page being fetched, rendered offscreen, represented by a thumbnail, or skipped by a page-number jump does not count.

Use a viewport visibility rule that excludes an incidental sliver: a rendered page counts when its visible height reaches at least half of the smaller of the page height and reader viewport height. Count only while the reader/window is visible and active. Use no dwell timer. This is navigation tracking, not proof of comprehension.

Persist visited pages and resume location. Reopening the application or switching years must not mix review progress. A section reset removes its mapped pages from that year's visited set and reopens Step 1; viewing them again can automatically recheck it.

After physical page **48** is displayed, expose an end-of-document **Other required resources** action:

`https://www.ocswssw.org/registrants/continuing-competence-program/`

This URL is the embedded checklist-row link in assessment-tool physical page 6. Use this plain URL rather than the separate page-5 link with a stale 2025 text fragment.

Launch it in the default browser. Check the thirteenth item only after the OS browser-launch call succeeds; report launch failure and leave it unchecked. A successful launch is not verification that the remote page loaded or was read. Explain that this action requires internet access to view the website; the rest of the application remains offline. Provide a reset for this item's recorded state.

Pages outside the twelve mappings do not create extra checklist categories. Reaching page 48 does not mark skipped mapped sections reviewed.

## 6. Evidence and managed files

Allow evidence text, HTTP/HTTPS links, and optional files. Link opening is an explicit default-browser action; links remain stored/usable in forms without a network fetch.

Initial supported file extensions:

`pdf`, `png`, `jpg`, `jpeg`, `webp`, `gif`, `bmp`, `doc`, `docx`, `xls`, `xlsx`, `ppt`, `pptx`, `rtf`, `txt`, `csv`.

Enforce **50 MiB (52,428,800 bytes) per file**. Explain unsupported type, oversized file, unreadable input, and insufficient storage errors. No total yearly size cap is specified. Import files, not directories.

Copy imported bytes into application-managed storage; original source paths are not durable evidence storage. Assign unique managed filenames/paths, retain original names as metadata, and calculate hashes. Selecting identically named files must not overwrite an existing attachment.

Preview PDFs and supported images internally. Open other supported documents only through an explicit user action in their installed desktop application. Report missing file associations/open failures. Provide no Office conversion service.

Treat missing/corrupt managed files as explicit integrity errors. Allow the user to replace or remove a broken evidence entry; operations requiring unavailable bytes must not report successful completion or silently omit those files.

## 7. Annual form and portfolio export

### Logical documents and no duplication

Produce a single checklist, **one logical SAT**, and **one logical PDP** for a year. SAT/PDP may span continuation pages. Each narrative appears once within its logical form. Goals appearing once in both SAT and PDP is intentional because both forms require them.

| Form field | Annual projection |
| --- | --- |
| SAT strengths, peer feedback, learning needs | Shared yearly assessment text, once |
| SAT relevant standards | Annual assessment selections; independent of goals |
| SAT learning goal | Each `G` reference, title, and optional description, once |
| PDP learning goal | Each `G` reference, title, and optional description, once |
| PDP activities | Each `A` reference, title/description, status/date, and linked `G` references, once |
| PDP evidence | Each `A` reference's evidence description, links, and `E` attachment references/names |
| PDP application to practice | Each `A` reference's reflection, once |

Unlinked activities appear in the PDP with **No linked goal** rather than being duplicated into separate goal forms. Activity IDs match evidence/reflections across columns. Repeated reference IDs and continuation labels are navigation metadata, not repeated narratives.

### Source templates and fields

Use `Step One SWCC.pdf` physical page 1 for the checklist. It is image-based and has no AcroForm fields; overlay an `X` at each checked row. Measure row coordinates from this actual PDF and compare rendered output against it.

In `OCSWSSW-CCP-Assess-Tool-2026-English.pdf`:

| Template page | Fields |
| --- | --- |
| SAT, physical page 8 | `Text35`: strengths; `Text36`: peer feedback; `Text37`: needs/interests; `Text38`: goals; `Date44_af_date`: assessment date |
| SAT standards | `Check Box 14` through `Check Box 25`, in the twelve-choice order from section 4 |
| PDP, physical page 11 | `Text39`: goals; `Text40`: activities; `Text41`: evidence; `Text42`: application to practice; `Date43_af_date`: plan date |

Implement generation with pdf-lib or an equivalent local PDF library. For each source-template page, fill an isolated template copy, update appearances, flatten, then copy the selected physical page into the final PDF. Flatten before merging repeated template pages so AcroForm names cannot collide.

Preserve original backgrounds/labels. Measure field rectangles, font metrics, padding, and line heights to wrap and paginate text. Bundle a licensed font locally for accented characters and normal punctuation. Use readable body text, at least 10 pt; fit content by pagination rather than automatic font shrinking.

Continuation pages use the same source layout with only remaining narrative content. Identify the annual document/page continuation unobtrusively. Repeat reference labels when needed to identify a split record; do not restart that record's narrative. Render annual standards on the first SAT page. Long unbroken words/URLs must wrap without clipping.

Always emit the logical SAT and PDP, even for a draft with no goals. Leave missing fields blank rather than fabricate content. The checklist reflects its current item states, independently of whether Step 1 was manually completed.

Flatten finished form fields and exclude interactive scripting from generated documents. The output must render consistently in ordinary PDF viewers.

### Export choices

**Export Forms PDF** includes the checklist, annual SAT, and annual PDP/continuations. It references evidence but does not contain every attachment.

**Export Complete Portfolio ZIP** contains:

```text
CCP-<year>-portfolio.zip
  CCP-<year>-forms.pdf
  evidence-index.txt
  manifest.json
  evidence/
    E1/<safe-original-filename>
    E2/<safe-original-filename>
```

The index identifies activity references, evidence references, original filenames, and archive paths without repeating reflection narratives. Preserve original attachment bytes. Sanitize archive names for both Windows and macOS, maintain unique paths, and retain the original filename in the index.

The manifest identifies this as a **portfolio**, records year/export time/source-set identity, and lists attachment sizes/hashes. A portfolio export is not a restorable full-app backup.

Flush drafts and read a consistent snapshot before export. If readiness/manual completion is incomplete, show the missing items and allow the user to continue with a draft export. Never hard-block merely because a package is incomplete. Actual generation/file-write errors still fail explicitly; report success only after the output is completely written.

## 8. Full-app backup, restore, and recovery

Full backup is a separate operation covering **all years**, records, relationships, review progress, manual completion/declaration states, relevant app metadata, and managed attachments.

Use a portable ZIP distinguished from portfolio exports, for example:

```text
SWCC-<timestamp>.swcc-backup.zip
  manifest.json
  database.sqlite
  evidence/<managed-attachment-files>
```

The manifest identifies a **full backup** and records archive/schema version, app/source-set identity, creation time, snapshot data revision, file inventory, sizes, and hashes. Bundled source PDFs and regenerable preview caches need not be duplicated, but their identities must be compatible on restore.

Create a consistent SQLite snapshot using its backup mechanism; copying only the live database file can omit WAL data. Prevent conflicting mutations/deletions while collecting the snapshot and attachment bytes. Display operation progress/busy state without losing pending edits.

Write to a temporary destination and publish the final archive only after completion. Update successful-backup status only then. Backup operational metadata must not immediately make the dataset look unbacked; later user-data revisions should.

### Restore transaction

1. Read the archive without modifying live data. Reject a portfolio ZIP, malformed manifest, unsupported/future schema, incompatible source set, invalid paths, duplicate entries, symlinks, missing files, size/hash mismatches, and invalid database integrity/relationships.
2. Extract only validated manifest entries into a scoped staging location. Enforce per-file evidence limits during extraction, not only from declared metadata. Never extract arbitrary absolute or parent-traversal paths.
3. Show backup date, years, record/file counts, and the current dataset that will be replaced. Support cancellation with no live-data changes.
4. After explicit confirmation, create and verify a recoverable full backup of the current dataset. If that fails, stop before replacement.
5. Close the database and replace the whole data directory using staged directory moves and a recovery journal. Keep the prior directory/recovery backup until the replacement has opened and passed validation.
6. On failure/interruption, recover the prior usable dataset and explain the recovery. Never substitute an empty database and report success.

Restore replaces the entire dataset; implement no merging or duplicate-year conflict resolver. Test restoration between the Windows and Mac formats, including filenames and date-only values.

## 9. Desktop architecture and packaging

Use npm with a lockfile, a React/Vite renderer, and Electron main/preload processes. A suitable initial library set is better-sqlite3 for SQLite, PDF.js for reading, pdf-lib/fontkit for form generation, and maintained ZIP tooling for streamed archives. Pin compatible dependency versions during implementation rather than hard-coding today's versions in this specification.

Keep the module boundaries small:

| Boundary | Responsibilities |
| --- | --- |
| Shared domain/types | Record contracts, validation, readiness, completion invalidation |
| Main data/files | SQLite migrations/transactions, managed evidence storage, integrity checks |
| Main export/backup | Template projection, PDF pagination, archive creation, staged restore |
| Main IPC/preload | Typed operations and OS dialogs/browser/document opening |
| Renderer features | Year navigation, review, assessment, plan, backup UI |

Store SQLite and evidence together under the Electron OS-user data directory; keep caches and restore journal/staging outside the replaceable data directory. Retain data across installer upgrades. Keep one active instance per OS user to avoid competing file/restore operations.

The renderer receives typed, narrowly scoped operations, not unrestricted filesystem or shell access. Enable context isolation, disable Node integration in renderer content, constrain navigation/new windows, and bundle production assets, fonts, and PDF workers. Run the installed app without a development server, CDN, or network dependency. PDF content and imported evidence are data, not executable application content.

Use OS file dialogs for attachments, exports, and backup/restore. Validate external URL protocols and resolve attachment-open requests from managed IDs in the main process. Surface validation, disk, migration, and IPC failures; preserve recoverable data and unsaved edits.

Use electron-builder or equivalent packaging to produce a Windows per-user installer and macOS DMGs for x64 and arm64. Keep builds unsigned initially, as approved. Document Gatekeeper override steps and possible Windows SmartScreen/Smart App Control restrictions accurately; unsigned builds are not guaranteed to open on every managed device.

Updates are manually delivered replacement installers. Verify an update preserves the existing database/evidence. Signing/notarization can be configured later with separately supplied certificates, but is not an initial delivery prerequisite.

## 10. Acceptance criteria

Implement focused domain/integration tests and renderer/end-to-end checks with the chosen project's normal tooling. Record actual target-platform smoke outcomes separately from compilation.

| Case | Passing result |
| --- | --- |
| Approved design fidelity | The production renderer follows C (Learning map) across all destinations, including its relationship-first dashboard, goal-connection plan editor, shared shell, palette, and typography; narrow-window reflow remains usable and prototype-only controls/data are absent |
| Annual persistence | Create current/past years, reject a duplicate, edit drafts, restart, and retain all records; years sort newest first |
| Independent standards | Annual standard selections persist/export; goals have no standard relationship; Step 2 requires at least one annual selection |
| Shared activity | One activity links to two goals, retains one evidence/reflection record, and exports one narrative with both references |
| Inline goal creation | Creating/linking a goal during activity entry updates the assessment and plan without duplicate objects |
| Unlinked activity | Remains editable/exported once; does not block plan readiness |
| Reader tracking | Offscreen rendering, thumbnails, and page jumps do not mark skipped sections; actual mapped visits do; progress is year-specific and survives restart |
| Reader end/reset | Page 48 exposes the resources action without marking skipped sections; browser launch failure leaves it unchecked; section reset invalidates Step 1 |
| Readiness vs completion | Ready steps are not Complete until manually confirmed; incomplete actions explain blockers; relevant edits reopen exactly the affected steps |
| Activity/date rules | Planned linked work blocks Step 3; Completed needs an actual nonfuture date; out-of-year dates warn and survive restart/timezone changes |
| Declaration | Can record a past declaration with incomplete steps; later edits preserve it; package completion depends on all current manual step completions |
| Evidence | Notes/links can satisfy evidence without files; files are copied locally; identical filenames do not overwrite; 50 MiB boundary and unsupported types produce clear results |
| Attachment failures | Missing files, failed preview/OS open, and storage exhaustion are explicit; failed imports do not create apparently successful evidence |
| Original-form fidelity | Checklist marks align with the one-page source; SAT/PDP use physical pages 8/11 and correct fields/checks; final PDF has flattened forms |
| Overflow/no duplication | Long paragraphs, multiple goals/activities, long URLs, and accented text export fully; continuation pages neither clip nor duplicate narratives |
| Export completeness | One logical annual SAT/PDP; shared/unlinked activities appear correctly; draft export is allowed after warning; ZIP contains indexed original evidence bytes |
| Archive distinction | Portfolio cannot be mistaken for full backup; successful full backup contains all years and review/completion state |
| Restore safety | Fresh-install restore reproduces relationships/files/dates; corrupted, traversal, future-schema, or incompatible archives leave current data intact |
| Interrupted restore | Inject failure at replacement boundaries; recovery retains a usable previous dataset and reports what happened |
| Autosave failure | Failed writes keep unsaved edits visible and prevent silent loss or falsely reported Saved/Complete/export success |
| Installed offline operation | Each target installer launches without development tools; reader, editing, previews, PDF/ZIP export, and backup/restore work disconnected |
| Upgrade persistence | Installing a later build retains all existing records/evidence and reports migration failures without resetting data |

The implementation handoff must include runnable source, dependency lockfile, schema/migrations, build commands, focused automated checks, generated installer artifacts where target build environments are available, and a short unsigned-install/backup guide. Explicitly identify any platform whose installed behavior has not been exercised. Visual design C (Learning map) is approved; implementation must satisfy the design-fidelity criterion as well as the functional criteria.
