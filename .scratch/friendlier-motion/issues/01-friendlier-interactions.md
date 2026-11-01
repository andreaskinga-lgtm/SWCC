# Prototype friendlier SWCC interactions

Type: prototype
Status: resolved

## Question

Can brief, action-led animation make SWCC feel friendlier while retaining its current appearance and navigation?

Keep the olive palette, existing typography, portfolio navigation, year picker, annual workflow, and editing flow. Compare alternatives only in the overview's goal-and-activity board.

## Primary source

Throwaway branch: `prototype/swcc-friendlier-motion`

Run `npm run prototype`. Open `http://127.0.0.1:5174/?prototype=friendlier&variant=A`.

The existing app route hosts three variants:

- `A`: the current two-column board, gentler press feedback, settling dialogs, quiet save confirmation, and slightly softer goal corners.
- `B`: expandable goal rows revealing their supporting activities.
- `C`: a goal picker and a focused pane of supporting activities.

The floating controls change `variant=A|B|C`, compare the current design, and disable motion. Arrow keys cycle variants except while editing or in a dialog. Goal tabs also support up/down, Home, and End. Details renders the full sample state, which is also printed to the browser console on changes.

Prototype code lives beside the renderer in `src/renderer/friendlier-prototype*` and `src/renderer/prototype-switcher.tsx`. `scripts/prototype.mjs` runs the isolated browser preview.

## Answer

**Recommendation: A.** Warmth can come from acknowledging an action rather than redesigning the application. Retain the current structure; use a small press response, a 220 ms dialog settle, and a 360 ms save confirmation. A single small sprout movement accompanies successful confirmation. No looping motion, confetti, wholesale palette change, or staggered card-grid entrance.

B and C provide genuinely different relationship interactions without replacing the surrounding app. They are alternatives for evaluation, not approved changes to the production flow.

The user approved the refined A design: "Okay, A looks good now." No design has been promoted to production. The implementation handoff is recorded in `../spec.md` and `02-implement-approved-a-motion.md`. Implement the approved interactions with production-quality behavior and remove all prototype hooks from the implementation branch; retain this branch as the primary source.

## Boundaries

All editable records are fictional and in memory. Reload wipes edits. The Electron bridge is never used. Files, backups, exports, and external launches are disconnected with explicit explanatory feedback. No real portfolio is read or changed.

The prototype entry point and its assets are excluded from production builds. Both OS reduced-motion preferences and the manual motion toggle disable movement. Existing uncommitted work is preserved separately from the prototype commit.

## Comments

Browser checks exercised all variants, URL cycling and reload, current-design comparison, assessment editing, goal and activity creation, completion feedback, full-state inspection, reload reset, mobile layouts, and reduced motion. Build, typecheck, and lint passed. Desktop and mobile screenshots are retained as session artifacts.

### Selected A refinements

User feedback: "I like A, but I want a couple more animations".

- Hovering or keyboard-focusing an activity reference below a goal highlights the matching activity card with the same treatment as hovering that card.
- The selection background slides between the first four sidebar options over 240 ms. The bottom two retain their existing static selection treatment; movement does not span that gap.
- Page changes use a brief horizontal fade/slide coordinated with navigation. Navigation does not wait for the animation to finish; existing save/validation gates remain intact.
- Selecting another activity slides the old form out and the new form in over 260 ms. Selecting the same record or typing in it does not replay the transition. Activity selection still waits for unsaved edits to flush.
- Native view-transition snapshots animate content without cloning live forms or introducing duplicate interactive controls. Browsers without this API receive an incoming-content animation instead.
- Both reduced-motion preferences and the manual motion toggle disable movement; static linked highlighting remains available.

Approval: the refined A interaction direction is settled. B and C are not selected.

Refinement checks confirmed matching hover/focus treatment, top-four marker movement, static bottom destinations, actual page/form transitions, pending-edit preservation, same-record non-replay, responsive marker alignment, reduced motion, and comparison cleanup. Additional checks confirmed that the latest activity selection wins even when it returns to the originally selected record, expected transition cancellation does not produce rejected-promise errors, and unsupported-browser fallbacks honor motion-off. Typecheck and lint passed after the final cancellation fix.
