# SWCC desktop

Ticket 01 foundation: a real offline Electron app with durable annual assessment drafts. The production shell follows the approved C / Learning map reference at commit `5477044`; prototype samples and simulated operations are not shipped.

## Run and check

Use npm and a compatible Node release (22.12+, or 24+). Dependencies are pinned in `package-lock.json`.

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
    evidence/               # future managed evidence, not original source paths
  runtime/                  # regenerable Chromium cache/session/logs
  restore-staging/          # reserved for future validated restore staging
  recovery.json            # reserved for future replacement recovery journal
```

The storage location is visible in the app. A persisted, non-blocking acknowledgement explains OS-user-local storage and explicit backups. There is no account or network storage. One active instance per storage root protects the normal OS-user dataset.

**Backup and restore are not implemented yet.** Their destination says so and offers no simulated success. Until full backup is implemented, wait for **Saved**, quit normally, and preserve a copy of the **entire dataset directory**, including evidence and any SQLite sidecars. Never copy only an open database file. Annual exports will not be full-app backups. Keep the existing dataset when installing a replacement app.

Startup refuses corrupt, empty, missing-from-an-existing-dataset, future-schema, or relationship-invalid databases. Migration/read/write/IPC errors are surfaced; SWCC never resets records as a recovery shortcut.

## Extension pointers and contracts

| Module / seam | Current responsibility |
| --- | --- |
| `src/shared/application.ts` | Small typed operations/results, annual draft/record types, date-only validation, fixed source identity |
| `src/main/data/application.ts` | Public operations used by both IPC and real SQLite integration tests |
| `src/main/data/migrations.ts` | Ordered transactional migrations; SQLite `user_version` is schema version |
| `src/main/data/storage.ts` | Stable dataset/evidence/runtime/staging/journal paths |
| `src/main/index.ts`, `preload.cts` | Single instance, restricted typed IPC, isolated/sandboxed renderer, navigation/new-window constraints, protected close |
| `src/renderer/draft-session.ts` | Retained draft, serialized autosave, shared flush contract |
| `src/renderer/App.tsx` | C shell, years, assessment writing, independent plan date, honest later-feature destinations |

Future export/backup implementations belong in **main-process modules**, not renderer/file-system bridges. Introduce only their narrowly typed public operations when implemented. Review, standards, goals, activities, evidence import, readiness/completion, declaration, exports, and archives are intentionally not implemented in ticket 01.

Public operations return `Result<T>`, not success-shaped failures. `createYear` returns a stable package and persists selection. A duplicate returns `DUPLICATE_YEAR` with `existingPackageId` for actionable opening. `openYear` persists selection without advancing content/data revisions. `saveDraft` accepts a **complete `Draft`** plus package ID and expected content revision; unknown draft fields, malformed dates, and stale revisions are rejected without overwriting the saved record.

Dates are `YYYY-MM-DD` strings, never converted through local instants. Blank dates remain saveable drafts; nonblank malformed dates fail. Assessment and plan dates initialize separately to today's local date. Out-of-year dates warn but persist. Operational timestamps are UTC ISO instants.

Meaningful draft changes advance package `contentRevision` and app `dataRevision` once, with independent `assessmentRevision` / `planRevision`. No-op saves and year navigation do not advance them. Later completion commands should compare their relevant revisions; adding goals must affect both assessment and plan revisions. Add fields/tables through a new migration, never edit the shipped migration in place.

Each package owns `reference_counters` for `G`, `A`, and `E`, initialized at 1. When those records are introduced, allocate and advance the counter **in the same immediate transaction** as insertion. Never derive references from record counts or decrement/recycle them after deletion. Keep record foreign keys and same-package relationship ownership enforced. No premature reference-allocation operation is exposed.

### Flush / failure / close contract

`DraftSession.edit()` retains text immediately. Autosave debounces 400 ms and serializes writes. Keystrokes during a save remain visible; returned revisions advance underneath them, and the newest draft is saved next.

**Every renderer action that consumes or leaves edited records must first `await session.flush()`**: navigation now, and completion/export/backup callers later. Resolution means all edits present during the flush have committed. Rejection means the draft remains visible, status is **Not saved**, and the consuming action must not continue. Never swallow a rejected flush and report Saved/success. Retrying saves the retained draft; revision conflicts must not silently overwrite newer saved data.

Normal window close, app Quit, Windows session-end query, and macOS shutdown notification request that same renderer flush. Main permits termination only after a successful renderer acknowledgement. Failed flush keeps the window open with actionable status and Retry save. A retry after a failed close saves without silently closing; the worker can then close deliberately.

OS Force Quit, power loss, renderer process failure, or an OS overriding a shutdown delay cannot be guaranteed to flush in-memory edits. Do not imply otherwise. Saved SQLite records remain durable; preserve/copy visible unsaved text before forced recovery.

## Fixed read-only source set

All years store source identity `swcc-supplied-2018-2026-v1`. Packaged resources contain byte-identical originals:

| Packaged path | Original |
| --- | --- |
| `sources/ethics-2018.pdf` | `Code-of-Ethics-and-Standards-of-Practice-September-7-2018 (1).pdf` |
| `sources/step-one.pdf` | `Step One SWCC.pdf` |
| `sources/assessment-2026.pdf` | `OCSWSSW-CCP-Assess-Tool-2026-English.pdf` |

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

Repeat packaged checks after building/installing:

```sh
SWCC_PACKAGED_EXECUTABLE="/absolute/path/SWCC.app/Contents/MacOS/SWCC" npx playwright test
```
