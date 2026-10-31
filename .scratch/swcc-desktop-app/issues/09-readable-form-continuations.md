# 09: Carry long annual narratives onto readable continuation pages

**What to build:** The worker can export complete annual forms with long narratives, many goals and activities, and long URLs without clipping, unreadable shrinking, or restarting the same narrative on continuation pages.

**Blocked by:** 08: Export annual forms in the supplied source layouts.

**Status:** claimed

Claimed October 31, 2026 after ticket 08 integration; implementation branch `ticket/09`.

- [ ] Extend the same Export Forms PDF operation to wrap/paginate all annual SAT/PDP fields at body text of at least 10 pt, using measured source-layout geometry and the bundled font.
- [ ] Continuations preserve the original source layout and contain only remaining narrative content. Identify the annual logical document/continuation unobtrusively; repeat stable references only when needed to identify a split record.
- [ ] SAT strengths, peer feedback, learning needs, and each goal narrative occur once across the logical SAT. Annual standard selections appear on its first page.
- [ ] PDP contains each goal once and each activity/evidence/reflection narrative once across its logical pages. Shared activities retain every linked goal reference; supplementary activities remain labelled No linked goal.
- [ ] Preserve column-to-record correspondence when narratives spill at different lengths. Reference labels are navigation metadata, not permission to repeat previously emitted content.
- [ ] Wrap long unbroken words and HTTP/HTTPS URLs without clipping. Preserve paragraph breaks, accented characters, and ordinary punctuation; never silently drop unsupported or overflowing text.
- [ ] Empty-goal drafts still emit both logical forms, and incomplete packages still export after a warning. Continuations are flattened before merging so repeated field names cannot collide.
- [ ] Public-operation checks compare extracted full narratives and reference counts across a stress dataset with long paragraphs, uneven column lengths, many goals/activities, shared/unlinked activities, URLs, and accents. Render finished PDFs to inspect readable size, no clipping, original-layout fidelity, and no duplicate narrative or interactive fields.
- [ ] Verify the user-facing export handles progress, cancellation, and write/generation failures accurately while retaining draft edits. This ticket completes the long-content forms-export gate rather than creating a second export format.
