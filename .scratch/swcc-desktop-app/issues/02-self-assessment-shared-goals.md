# 02: Maintain annual self-assessment and shared learning goals

**What to build:** The worker can write the annual SAT, select relevant standards independently of goals, and maintain learning goals that are immediately visible in both assessment and development-plan views without re-entry.

**Blocked by:** 01: Open an offline desktop app and retain year drafts.

**Status:** ready-for-agent

- [ ] Provide C's self-assessment composition: date, strengths, learning needs/interests, optional peer feedback, and annual standard choices in the writing area, with shared goals and readable readiness alongside.
- [ ] Persist all twelve annual standard choices: Code of Ethics, Meaning of Client, both scopes of practice, and Principles I-VIII. Standards belong only to the annual assessment; goals have no standard relationship.
- [ ] Peer feedback remains optional and can be recorded as not applicable. Incomplete narratives/selections remain saveable drafts; whitespace does not satisfy nonblank readiness fields.
- [ ] Create and edit goals with required titles, optional descriptions, stable internal IDs, and stable year-local G references. References survive restart and cannot be reassigned after later deletion.
- [ ] Assessment and plan show the same goal records immediately after creation or editing, including a plan-side goal entry action. No duplicate goal dataset or goal-specific standard selection is introduced.
- [ ] One domain implementation reports Step 2 missing items: valid assessment date, nonblank strengths and needs/interests, at least one annual standard, and at least one valid goal. Ready is visibly distinct from manual Completed; readiness never prevents saving an otherwise valid draft.
- [ ] Assessment date remains separate from plan date; valid backfilled/out-of-year dates warn without shifting or overwriting the other date.
- [ ] Assessment text/date/standards advance Step 2's relevant revision; goal creation/title/description changes advance Steps 2 and 3. Unchanged saves and ordinary navigation do not spuriously advance completion revisions.
- [ ] Use the existing autosave/failure protection and labelled keyboard controls. Preserve C's shared shell, writing hierarchy, and narrow-window reflow without shipping prototype sample records or developer controls.
- [ ] Public-operation and renderer checks verify independent year state, standards without goal links, immediate shared goals, date behavior, draft persistence, and exact relevant-revision changes. Manual completion commands are delivered separately.
