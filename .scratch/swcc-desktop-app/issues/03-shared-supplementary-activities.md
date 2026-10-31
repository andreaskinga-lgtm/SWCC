# 03: Record shared and supplementary learning activities

**What to build:** The worker can record one learning activity, connect it to zero, one, or several goals, and keep its evidence notes/links and application-to-practice reflection on that single record. The relationship-first dashboard and development plan make shared and supplementary learning visible without duplication.

**Blocked by:** 02: Maintain annual self-assessment and shared learning goals.

**Status:** ready-for-agent

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
