# 09: Carry long annual narratives onto readable continuation pages

**What to build:** The worker can export complete annual forms with long narratives, many goals and activities, and long URLs without clipping, unreadable shrinking, or restarting the same narrative on continuation pages.

**Blocked by:** 08: Export annual forms in the supplied source layouts.

**Status:** resolved

Claimed October 31, 2026 after ticket 08 integration; implementation branch `ticket/09`.

- [x] Extend the same Export Forms PDF operation to wrap/paginate all annual SAT/PDP fields at body text of at least 10 pt, using measured source-layout geometry and the bundled font.
- [x] Continuations preserve the original source layout and contain only remaining narrative content. Identify the annual logical document/continuation unobtrusively; repeat stable references only when needed to identify a split record.
- [x] SAT strengths, peer feedback, learning needs, and each goal narrative occur once across the logical SAT. Annual standard selections appear on its first page.
- [x] PDP contains each goal once and each activity/evidence/reflection narrative once across its logical pages. Shared activities retain every linked goal reference; supplementary activities remain labelled No linked goal.
- [x] Preserve column-to-record correspondence when narratives spill at different lengths. Reference labels are navigation metadata, not permission to repeat previously emitted content.
- [x] Wrap long unbroken words and HTTP/HTTPS URLs without clipping. Preserve paragraph breaks, accented characters, and ordinary punctuation; never silently drop unsupported or overflowing text.
- [x] Empty-goal drafts still emit both logical forms, and incomplete packages still export after a warning. Continuations are flattened before merging so repeated field names cannot collide.
- [x] Public-operation checks compare extracted full narratives and reference counts across a stress dataset with long paragraphs, uneven column lengths, many goals/activities, shared/unlinked activities, URLs, and accents. Render finished PDFs to inspect readable size, no clipping, original-layout fidelity, and no duplicate narrative or interactive fields.
- [x] Verify the user-facing export handles progress, cancellation, and write/generation failures accurately while retaining draft edits. This ticket completes the long-content forms-export gate rather than creating a second export format.

## Comments

Completed October 31, 2026 in isolated branch `ticket/09`, based on integrated tip `5e35a18` (forms08 and backup11). The existing public `exportForms` seam remains unchanged; only its projection/layout generator and explanatory dialog text changed. SAT/goal cursors consume each narrative once. PDP activity/evidence/reflection columns reserve common rows until the whole A record is exhausted, repeating only unfinished-column references.

TDD evidence: the first real-PDF SAT stress test failed with the former overflow error, then passed with continuations. The uneven PDP test subsequently failed at A2's mismatched column start, then passed with synchronized record pagination. The real desktop test rejected the obsolete short-content message, then passed with accurate continuation wording and retained-edit glyph-error/retry handling.

Verification: `npm test` **87 passed**; `npm run typecheck`, `npm run lint`, `npm run build` passed. Targeted production/offline real Electron forms/backup/drafts/completion suite **18 passed**. Stress tests compare entire extracted narratives (excluding only explicit reference metadata and PDF extraction whitespace), paragraph spacing, bounds/font size, record starts, flattened/no-script output, and original-source raster pixels on **8 SAT + 20 PDP** pages. First, continuation transition and final renders were visually inspected.

Retained inspection artifacts: `.work/forms-continuation-inspection/{sat-stress.pdf,pdp-stress.pdf,sat-source.png,pdp-source.png,sat-1.png…sat-8.png,pdp-1.png…pdp-20.png}` in the ticket09 worktree; short-content/checklist artifacts remain in `.work/forms-inspection/`. Regenerate with `SWCC_EXPORT_INSPECT=1 npm test -- tests/forms-export.test.ts`. README records the module/testing/layout/flush contracts.

No ticket10 portfolio or restore/backup implementation was added. No new dependency manifests, schema, IPC, snapshot/busy gate, destination/publication/cancellation or close/flush changes. Unsupported glyphs remain explicit failures, not omissions. Available-host checks were macOS 26.6.2 / arm64, not installer or Windows/Intel/macOS14 acceptance; existing Vite chunk and locked npm dependency advisories remain.

Integration confirmed at `32e1cc4cdc5a10452150e514b482256f56c17f96`, incorporating implementation `740aecbd05e7af7a3e81035fd2545c2a5e90f627`. Canonical checks passed 87 operation tests, typecheck, lint, and build; canonical tree matched the tested implementation tree. The full canonical desktop rerun was deferred while the independent restore-preview implementer was active to avoid competing window focus.
