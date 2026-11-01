# Implement approved A motion and interaction feedback

Type: task
Status: resolved

## Specification

Implement [the approved A design](../spec.md) against the current integration UI. The user has approved the direction; do not reopen the design or substitute B/C.

Primary source: branch `prototype/swcc-friendlier-motion`, commit `d1d7d8532929f28861216d4fe7879754ad522ccd`. Approval history: [prototype issue 01](01-friendlier-interactions.md).

## Required outcome

- Preserve the current appearance, wording, layout, navigation, and real data workflow.
- Implement A's baseline micro-feedback plus stable-ID linked activity hover/focus, the first-four sidebar selection glide, coordinated page transitions, and local activity-form swaps.
- Use the exact visual tokens, offsets, durations, scopes, bottom-destination exceptions, same-selection rules, fallbacks, and reduced-motion rules in the specification.
- Keep existing save/validation gates. The latest eligible selection must win even when it returns to the originally visible record; cancel stale animation work without unhandled expected-skip errors.
- Build production-quality behavior using the existing renderer lifecycles. Do not ship the prototype switcher, fake operations, debug state, or prototype-only architecture.
- Exercise the existing production Electron/Playwright seam and complete the required typecheck, lint, build, and relevant desktop checks.

## Handoff constraints

The archive excludes unrelated dirty work. Preserve the current integration worktree; do not replace the application shell/editor with their archival versions or reintroduce old headings and spacing. No schema change, new dependency, remote asset, or new testing platform is required.

## Comments

User approval: "Okay, A looks good now. Record these decisions /to-spec with as exact instructions as you can so that I can pass these changes to a luna implimenter".

The spec is intentionally detailed enough for implementation without another design interview. The production implementation is still pending; keep this ticket `ready-for-agent` until claimed through the project's workflow, and mark it `resolved` only after the requested production behavior is implemented and verified.
