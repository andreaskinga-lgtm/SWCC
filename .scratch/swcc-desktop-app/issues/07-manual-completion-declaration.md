# 07: Confirm step completion and record renewal declarations

**What to build:** The worker can see exactly what remains, explicitly complete any ready step in any order, and record an external renewal declaration without the application overstating completion or erasing declaration history after later edits.

**Blocked by:** 05: Delete records without losing unrelated learning evidence; 06: Track actual offline standards review by year.

**Status:** ready-for-agent

- [ ] C's dashboard annual-workflow panel shows independent readable readiness/missing-item lists, manual completion controls, declaration entry, and export access beside the relationship board. All destinations and completion actions remain unlocked.
- [ ] Use the existing domain readiness rules for all three steps. Distinguish Draft/In Progress, Ready, and Completed; no visit, autosave, computed readiness, or activity completion automatically completes an annual step.
- [ ] Complete Step flushes pending edits, checks current readiness, and records its relevant revision and manual timestamp only on success. Incomplete readiness or failed writes leave completion unchanged and explain the blockers.
- [ ] A completion is current only when its recorded revision matches the step's relevant revision, even if edited content remains ready.
- [ ] Review-section/resources resets reopen only Step 1; assessment text/date/annual standards reopen only Step 2; goal creation/edit/deletion reopens Steps 2 and 3; plan/activity/status/date/link/evidence/reflection edits reopen only Step 3.
- [ ] Already completed review remains completed during ordinary rereading. Navigation, zoom, attachment previews/opens, and unchanged saves do not reset completion. A change in one package never reopens another.
- [ ] Record the actual external submission date separately from its app-entry UTC timestamp. Allow historical declaration entry with incomplete steps after a warning; do not submit or verify declarations.
- [ ] Later record edits or step reopening preserve the declaration date/timestamp. Any change-since-declaration wording refers to when it was recorded in the app, not reconstructed external history.
- [ ] A year package is Complete only with all three current manual completions and a declaration date. Year-list/dashboard status updates immediately and survives restart.
- [ ] Retain source-edition information and application-readiness wording near workflow feedback; never imply verification of current College compliance or impose an extra goal/hour quota.
- [ ] Domain/public-operation checks cover the full invalidation table, deletion/evidence changes, repeat completion, incomplete declarations, and failure during flush. Renderer checks cover any-order completion, labelled keyboard actions, explicit warnings, year isolation, and C's annual-workflow composition.
