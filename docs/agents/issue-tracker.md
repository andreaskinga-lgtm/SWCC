# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`, except the approved app implementation spec, which remains at `IMPLEMENTATION_SPEC.md`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`.
- New feature specs: `.scratch/<feature-slug>/spec.md`.
- Implementation issues: one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a combined tickets file.
- Record triage state as a `Status:` line near the top of each issue file. Use the role strings in `triage-labels.md`.
- On task completion, set `Status: resolved`. Exclude resolved tickets from open-issue triage.
- Append comments and conversation history under a `## Comments` heading.

## When a skill says "publish to the issue tracker"

Create the appropriate spec or individual issue file under `.scratch/<feature-slug>/`, creating the directory if needed.

## When a skill says "fetch the relevant ticket"

Read the referenced file. When given only an issue number, resolve it within the relevant feature directory; if ambiguous, ask for the feature or path.

## Wayfinding operations

Used by `/wayfinder`. The map is a file with one child file per ticket.

- Map: `.scratch/<effort>/map.md`, holding Notes / Decisions-so-far / Fog.
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records `research`, `prototype`, `grilling`, or `task`; a `Status:` line records the ticket state.
- Blocking: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every listed file has `Status: resolved`.
- Frontier: scan `.scratch/<effort>/issues/` for open, unblocked, unclaimed tickets; first by number wins.
- Claim: set `Status: claimed` and save before any work. This is a wayfinding lifecycle state, not a triage role.
- Resolve: append the answer under `## Answer`, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far.
