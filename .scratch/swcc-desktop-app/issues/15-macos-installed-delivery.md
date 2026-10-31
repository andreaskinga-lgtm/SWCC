# 15: Deliver and exercise macOS Intel and Apple Silicon installers

**What to build:** The worker can install and run the complete application on macOS 14+ with either Intel or Apple Silicon, understand unsigned first launch, and upgrade without losing local records or evidence.

**Blocked by:** 10: Export a self-contained annual portfolio with original evidence; 13: Restore the whole dataset with interruption-safe recovery.

**Status:** ready-for-agent

- [ ] Produce separate native macOS x64 and arm64 DMGs with unsigned initial delivery, pinned build tooling, local production assets/source PDFs/fonts/PDF worker, and compatible native SQLite components for each architecture.
- [ ] Exercise actual installed behavior on macOS 14+ for each CPU target. A successful build, development run, or testing only one architecture is not evidence for the other.
- [ ] On each exercised target, disconnected editing/restart, shared records, review tracking, evidence PDF/image previews, forms/portfolio export, full backup, validated restore, and recovery work without a development server or tools.
- [ ] Verify native file dialogs, explicit browser/external-document actions and failure reporting, autosave-aware close, and one-instance behavior. External resources remain explicitly online while recordkeeping stays offline.
- [ ] Check the approved C compositions, typography/fallbacks, keyboard focus, and usable narrow-window reflow across all destinations. Ship no prototype-only controls, samples, or simulated operations.
- [ ] Install a later build over populated storage for both exercised architectures and confirm records/evidence, stable references, dates, review/completion, and declarations survive. Report migration errors without empty-data fallback.
- [ ] Provide accurate Gatekeeper override/unsigned first-launch guidance and warn about managed-device restrictions. Initial signing/notarization and automatic updates remain out of scope.
- [ ] Record separate artifact identities, hardware/OS environments, actual installed outcomes, and limitations for Intel and Apple Silicon. Clearly identify any unavailable target and leave its installed acceptance unverified rather than treating build success as a pass.
