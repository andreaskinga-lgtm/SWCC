# 06: Track actual offline standards review by year

**What to build:** The worker can read the complete supplied ethics PDF offline, resume each year's reading, and see checklist sections checked only after their mapped pages actually appear in the active reader. The external resources action is tracked honestly and can be reset.

**Blocked by:** 01: Open an offline desktop app and retain year drafts.

**Status:** ready-for-agent

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
