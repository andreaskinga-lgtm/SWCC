# 01: Open an offline desktop app and retain year drafts

**What to build:** The worker can launch a packaged desktop application, understand where records live, create or reopen a current or past year package, and save an assessment draft that survives restart. Establish the production application through this usable path, preserving the approved C (Learning map) prototype as a visual reference rather than shipping its simulated behavior.

**Blocked by:** None (can start immediately).

**Status:** claimed

- [ ] Use Electron, React, TypeScript, a Vite renderer, SQLite, and npm with locked compatible dependencies. Provide reproducible development, production-build, type-check, lint, and focused test commands.
- [ ] A packaged application launches without a development server, development tools, CDN, or internet connection. Initial verification on an available target is distinguished from the later target-installer acceptance tickets.
- [ ] Provide a single application window following C's compact olive rail, white header with year picker and save status, left-aligned rounded surfaces, Trebuchet MS with local fallbacks, and approved palette. Year-list controls remain labelled, keyboard accessible, and usable in a narrow window.
- [ ] Create one package per calendar year, open/edit earlier years, sort newest first, and reject duplicates with an actionable way to open the existing package. Restart preserves the selected package and persisted draft records.
- [ ] Initialize separate assessment and plan dates to today's local date. Store date-only values as YYYY-MM-DD and operational timestamps as UTC instants; preserve dates across restart and timezone changes. Out-of-year dates warn rather than being rejected.
- [ ] Bundle the required original source PDFs read-only and associate each year with the fixed source-set identity. Explain the supplied Second Edition/2018 baseline and the assessment tool's Third Edition/2023 reference without claiming current-year regulatory compliance.
- [ ] Give a brief, persisted first-run acknowledgement of OS-user-local storage and explicit backups, without an account, forced wizard, or recurring reminder modal. Make backup/restore discoverable without presenting unfinished operations as working.
- [ ] Store the database and managed-evidence area together in OS-user application storage; keep caches, future restore staging, and recovery journals outside the replaceable dataset. One active application instance per OS user prevents competing operations.
- [ ] Establish the small domain, data/files, export/backup, main/preload, and renderer boundaries from the handoff. Enable foreign keys, transactional migrations, package ownership, schema/data revisions, and non-recycling year-local G/A/E reference allocation as records are introduced.
- [ ] Expose narrowly scoped typed preload operations. Enable context isolation, disable renderer Node integration, constrain navigation/new windows, and treat bundled documents as data; expose no arbitrary filesystem or shell operations.
- [ ] Autosave incomplete assessment text, display Saving/Saved/actionable failure, and keep failed edits visible. Navigation, close, and shutdown cannot silently lose pending edits; a failed flush cannot report Saved. Establish this same flush contract for later completion/export/backup callers.
- [ ] Integration checks use the public typed application operations with real SQLite and temporary managed storage. Renderer checks cover keyboard use, duplicate-year handling, autosave failure, and restart durability. Migration/storage/IPC failures preserve existing data and are reported rather than replaced with an empty dataset.
