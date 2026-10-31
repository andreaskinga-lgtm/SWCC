# 05: Delete records without losing unrelated learning evidence

**What to build:** The worker can remove obsolete goals, activities, or year packages with predictable retention consequences, while unrelated records and stable references remain intact.

**Blocked by:** 04: Retain, inspect, and repair managed evidence files.

**Status:** claimed

- [ ] Deleting a goal removes only that goal and its activity links. Its activities, evidence notes/links, reflections, and managed files survive, including activities linked to another goal or now supplementary.
- [ ] Activity deletion requires explicit confirmation explaining that its links and evidence records/files will be removed. Cancelling changes nothing; shared goals and other activities' evidence are unaffected.
- [ ] Year deletion requires explicit confirmation explaining portfolio-retention implications, including the supplied guide's at-least-ten-year context. Retain all years indefinitely unless explicitly deleted; add no scheduled retention cleanup.
- [ ] A confirmed year deletion removes only that package's records and managed files, respecting ownership and foreign-key integrity. Move the UI to an existing year or the empty year list without inventing a replacement dataset.
- [ ] Deleted G/A/E references are never reused or renumbered; creating replacement records and restarting preserve monotonic allocation.
- [ ] Goal deletion advances Steps 2 and 3's relevant revisions; activity/evidence deletion advances Step 3. Deleting one package does not change another package's progress or declaration.
- [ ] Flush pending edits and surface database/file failures before claiming successful deletion. Interrupted or failed file removal must leave an explicitly reported, recoverable state rather than silent unrelated data loss.
- [ ] Public-operation and ordinary UI checks cover a goal shared by multiple activities, a two-goal activity becoming supplementary, confirmation cancellation, attachment cleanup boundaries, failed deletion, year isolation, and subsequent stable reference allocation. Controls use C's visual system and keyboard-accessible confirmations.
