# Triage Labels

The five canonical triage roles map to these local ticket status strings.

| Canonical role | Tracker status | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate this issue |
| `needs-info` | `needs-info` | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an AFK agent |
| `ready-for-human` | `ready-for-human` | Requires human implementation |
| `wontfix` | `wontfix` | Will not be actioned |

When a skill mentions a role, use its corresponding status string in the ticket's `Status:` line.

## Completion state

| Tracker status | Meaning |
| --- | --- |
| `resolved` | Task completed |

`resolved` is an additional lifecycle state, not a sixth canonical triage role. Use it when a task is complete; preserve the ticket and its history.

Edit the tracker status column to match your vocabulary.
