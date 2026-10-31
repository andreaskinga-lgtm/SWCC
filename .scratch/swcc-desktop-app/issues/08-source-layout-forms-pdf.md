# 08: Export annual forms in the supplied source layouts

**What to build:** The worker can export a readable, flattened forms PDF for a short-content annual package or an empty draft, containing the current review checklist, one annual SAT, and one annual PDP in the original College-style layouts.

**Blocked by:** 07: Confirm step completion and record renewal declarations.

**Status:** claimed

Claimed October 31, 2026 after ticket 07 integration; implementation branch `ticket/08`.

- [ ] Expose Export Forms PDF through the dashboard's C export controls and an OS destination dialog. Flush drafts and read a consistent annual snapshot before generation; a failed flush cannot export stale edits as success.
- [ ] Show readiness/manual-completion blockers for incomplete packages and allow an explicit draft export. Always emit the logical SAT/PDP even with no goals; missing fields stay blank rather than receiving fabricated content.
- [ ] Inspect the actual supplied PDFs. Use the one-page image-based checklist background, measure its thirteen row positions, and overlay X marks matching current item states independently of manual Step 1 completion.
- [ ] Use assessment-tool physical page 8 for SAT: Text35 strengths, Text36 peer feedback, Text37 needs/interests, Text38 goals, Date44_af_date assessment date, and Check Box 14 through Check Box 25 in the approved twelve-choice order.
- [ ] Use physical page 11 for PDP: Text39 goals, Text40 activities, Text41 evidence, Text42 application to practice, and Date43_af_date plan date. Preserve the original backgrounds and labels.
- [ ] Project annual assessment narratives/standards once in SAT and each goal once in each logical form. PDP contains each activity, evidence narrative, and reflection once; shared activities list all linked G references and supplementary ones say No linked goal.
- [ ] Stable A/E references connect PDP columns and attachment names without duplicating narratives. Forms reference evidence rather than embedding all attachment bytes.
- [ ] Bundle a licensed local font for accents and normal punctuation, measure actual field rectangles/font metrics/padding, and render body text at least 10 pt. No CDN fonts or automatic shrinking to hide overflow.
- [ ] Fill isolated source-template copies, update appearances, flatten before selecting/merging pages, and exclude interactive scripting. Finished forms display consistently in ordinary viewers without AcroForm-name collisions.
- [ ] Until continuation support lands, content that cannot fit produces an explicit actionable export error and no successful truncated output. This short-content slice is not the completed long-content export delivery gate.
- [ ] Write the complete output before reporting success; cancellation, generation errors, and destination/storage failures do not publish an apparently complete file.
- [ ] Public-operation checks use the real templates and generated PDF content/reference counts; rendered comparisons verify checklist alignment, field placement, independent dates/standards, accents, flattened output, shared/unlinked activities, and blank drafts. File existence alone is not sufficient.
