# 03: Record shared and supplementary learning activities

**What to build:** The worker can record one learning activity, connect it to zero, one, or several goals, and keep its evidence notes/links and application-to-practice reflection on that single record. The relationship-first dashboard and development plan make shared and supplementary learning visible without duplication.

**Blocked by:** 02: Maintain annual self-assessment and shared learning goals.

**Status:** claimed

- [ ] Implement C's dashboard with goals beside activities, each activity shown once with all linked G references, a leading Record an activity action, and a separate annual-workflow area rather than a metrics-card grid.
- [ ] Implement C's development-plan goal-connection strip, activity index, and one selected activity editor. Selecting an A reference edits the same record from any linked goal; unlinked activities remain visible.
- [ ] Activities have stable IDs/A references, required titles, optional descriptions, Planned/In Progress/Completed states, optional completion dates, evidence description/links, and application-to-practice text.
- [ ] Link activities to zero, one, or multiple goals in the same package. Enforce unique link pairs and reject cross-package references. Evidence/reflection belong to the activity, never to each link.
- [ ] Inline goal creation during activity entry immediately adds the shared goal to SAT and PDP, links it as requested, and creates no duplicate object or reused G reference.
- [ ] Planned/In Progress drafts save without an invented completion date. Completed requires an actual valid nonfuture date, but evidence and reflection may remain pending and editable afterward.
- [ ] Plan date is independently editable; valid out-of-year dates warn rather than reject. Date-only activity values survive restart and timezone changes.
- [ ] Evidence notes or valid HTTP/HTTPS links can satisfy the evidence requirement without a file. Store/validate links without network requests; open only on explicit action through a protocol-validated main-process browser operation, reporting launch failures.
- [ ] One domain implementation exposes Step 3 blockers: valid plan date, at least one goal, completed supporting work for every goal, and every linked activity Completed with a valid date, qualifying evidence, and nonblank reflection. An additional unfinished linked activity blocks readiness even when its goal has other completed work.
- [ ] Unlinked activities remain editable and do not block Step 3. Do not introduce hours, quotas, target dates, goal statuses, or goal copying.
- [ ] Plan/activity/status/date/link/evidence/reflection edits advance only Step 3's relevant revision; inline goal creation advances Steps 2 and 3. Reuse autosave and failed-edit protection.
- [ ] Public-operation and renderer checks cover one activity supporting two goals with one evidence/reflection record, inline creation, supplementary work, valid/invalid completion transitions, out-of-year dates, readiness blockers, and C's keyboard-accessible narrow-window relationship layout.

## Comments

### 2026-10-31 — Ticket 03 implementation and verification

Implemented on `ticket/03` in its isolated worktree. Merged `integration/swcc-desktop-app` before implementation and again before final checks; latest integration was already contained. Status intentionally remains **claimed** for the parent merger's integration checks.

Delivered C's relationship-first dashboard, goal-connection activity references/index/single editor, stable shared/supplementary activities, atomic inline goal creation/linking, evidence notes and offline HTTP/HTTPS links, independently editable plan date, valid nonfuture completion transitions, one shared Step 3 readiness implementation, and retained serialized autosave/flush/failure protection (including activity selection). SQLite migration 5 adds activity records and composite same-package foreign keys with unique link pairs; historical migration fixtures preserve their assertions and now include the integrated version-4 layout.

Actual final outcomes after merging latest integration:

- `npm test`: **25 passed**, real SQLite under Electron runtime; six focused activity tests.
- `npm run typecheck`, `npm run lint`, `npm run build`: **passed**.
- `npx playwright test`: **18 passed**, real production `file://` Electron renderer offline; three activity cases plus all existing assessment, draft and review checks. Activity checks cover shared and inline-created goals, supplementary work, evidence/reflection, valid/invalid transitions, outside-year dates, restart with a changed timezone, 620px/520px keyboard reflow, selection/navigation/close protection, failed creation retry without duplicate references, and browser launch failures.

Caveats: build reports the existing bundle-size advisory. OS browser calls are controlled only at the `shell.openExternal` boundary in automated checks; no claim that a website loaded. No new installer, Windows/Intel macOS or cross-platform transfer was exercised. Managed attachment files, deletion of activities/years, manual step completion/declaration and exports remain later tickets, not simulated here. No unresolved ticket-03 criteria or blockers identified.
