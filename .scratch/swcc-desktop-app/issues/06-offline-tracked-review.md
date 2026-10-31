# 06: Track actual offline standards review by year

**What to build:** The worker can read the complete supplied ethics PDF offline, resume each year's reading, and see checklist sections checked only after their mapped pages actually appear in the active reader. The external resources action is tracked honestly and can be reset.

**Blocked by:** 01: Open an offline desktop app and retain year drafts.

**Status:** resolved

- [ ] Render the complete supplied 48-page PDF with locally bundled PDF.js worker/assets. Provide C's section checklist beside the reader, page/section navigation, zoom, and persisted page/position/zoom per package/document.
- [ ] Use physical pages, cover as page 1: Code of Ethics 2; Meaning of Client 4; Social Work scope 7; Social Service Work scope 8; Principles I 9-10, II 11-15, III 16-18, IV 19-26, V 27-31, VI 32-33, VII 34-37, VIII 38-40.
- [ ] A rendered page qualifies only while the reader/window is visible and active and its visible height is at least half the smaller of its page height and reader viewport height. Use no dwell timer.
- [ ] Fetching, thumbnails, offscreen rendering, incidental slivers, hidden/inactive readers, and skipped pages never count. Check a section only when every mapped page qualifies; unmapped pages create no checklist categories.
- [ ] Persist visited pages and reader location across restart and year switching without mixing progress. Resetting a section removes its mapped visits and advances Step 1's relevant revision; subsequent qualifying visits can recheck it.
- [ ] Actually displaying physical page 48 exposes Other required resources without marking skipped sections. Open https://www.ocswssw.org/registrants/continuing-competence-program/ only on explicit action in the default browser.
- [ ] Check the thirteenth item only after the main-process OS browser-launch call succeeds. Failure is actionable and leaves it unchecked. Explain that the website needs internet and launch success proves neither page loading nor reading.
- [ ] Persist the successful resources-action timestamp and provide an explicit reset that reopens Step 1 through its relevant revision. Rereading already checked pages, changing zoom/location, and ordinary navigation do not invalidate completed review.
- [ ] Expose Step 1 missing items through the shared domain interface, not a renderer-only duplicate. Record automatic checklist progress separately from manual completion.
- [ ] Public-operation checks cover persisted mapping/reset/resources state and OS failures. Real renderer/end-to-end checks demonstrate the exact visibility boundary, all-pages-per-section rule, jumps, inactive/hidden windows, year isolation, restart, and keyboard-accessible narrow-window C layout; do not simulate claims that a page was viewed.

## Comments

### 2026-10-31 — integration verified; implementation stopped

- Merged only `ticket/06` (`c5b99e0a5e66ecf69c823ae50164d3e8ab78ccdd`) into `integration/swcc-desktop-app` at `/Users/andreasking/source/SWCC`, using no-ff merge commit `9ee16ae42a6d0fde66bca389e3f244505afe4dfb`. Its first parent is the ticket02-resolved integration `7646602626874abba0c6cdbae3dd4d549965977e`; both tickets are now integrated.
- Resolved seven conflicts: `README.md`, `src/main/data/application.ts`, `src/main/data/migrations.ts`, `src/main/index.ts`, `src/renderer/App.tsx`, `src/shared/application.ts`, and `tests/operations.test.ts`. Preload combined automatically. Assessment/annual-standard/shared-goal operations, validation, readiness, types, preload, UI and draft autosave remain alongside review operations and the combined navigation/close flush.
- Migration order is foundation 1 → annual standards 2 → goals 3 → review 4. An explicit transactional path also upgrades the parallel ticket06 review-only schema 2, preserving visits, position/zoom, browser-launch timestamp, relevant revisions and records while adding the missing assessment/goals tables. Five focused integration checks cover all four old layouts and rejection of an ambiguous version-2 layout; fresh-database behavior is exercised throughout the existing suite.
- Restored the merged dependency lockfile with `npm ci --no-audit --no-fund` after typecheck reported missing PDF.js. Electron's SQLite ABI was rebuilt by the existing postinstall command.
- All integration checks passed: `npm test` (**18** real SQLite tests), `npm run typecheck`, `npm run lint`, `npm run build`, and `npx playwright test` (**15** real production-file Electron tests: **5 foundation + 3 assessment/goals + 7 review**).
- Additional merged-build verification passed: `npm run package:dir`, followed by `SWCC_PACKAGED_EXECUTABLE="$PWD/release/mac-arm64/SWCC.app/Contents/MacOS/SWCC" npx playwright test` (**all 15 passed**). Tests assert `app.isPackaged`, `file://` rendering, isolated storage and disabled Chromium networking. All three packaged source PDFs matched their originals by SHA-256.
- Actual host: **macOS 26.6.2 (25G83), arm64**. This verifies the newly packaged unsigned `.app`, not a newly mounted/installed merged DMG, quarantined Gatekeeper launch, macOS 14, Intel macOS or Windows 11. Cross-platform transfer, installer upgrades and OS-initiated shutdown have not been exercised by this integration. Browser outcomes are injected only at `shell.openExternal`; no website-load/read claim is made. Non-fatal build size/default-icon warnings remain; no integration blocker was found.
- **STOP: no later implementation or ticket-status changes.** The first future frontier, only when work is explicitly resumed, is [03: shared/supplementary activities](03-shared-supplementary-activities.md), now unblocked by ticket02. Review/manual completion continues at [07](07-manual-completion-declaration.md) only after its remaining ticket05 dependency; Ready is not Completed.
