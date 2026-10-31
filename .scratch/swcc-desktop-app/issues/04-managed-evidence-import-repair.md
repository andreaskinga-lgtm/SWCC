# 04: Retain, inspect, and repair managed evidence files

**What to build:** The worker can attach evidence to an activity, move or delete the original source file without breaking the portfolio, inspect supported files, and repair missing or corrupt managed evidence with clear failure messages.

**Blocked by:** 03: Record shared and supplementary learning activities.

**Status:** claimed

- [ ] Import files through an OS file dialog into managed storage, never depend on their original paths, and never accept directory imports.
- [ ] Support pdf, png, jpg, jpeg, webp, gif, bmp, doc, docx, xls, xlsx, ppt, pptx, rtf, txt, and csv. Permit exactly 50 MiB (52,428,800 bytes) per file and reject larger inputs; impose no total yearly quota.
- [ ] Preserve original names as metadata while using unique managed paths. Identically named imports remain separate and cannot overwrite each other.
- [ ] Persist stable attachment IDs/year-local E references, package/activity ownership, managed relative path, type, byte count, SHA-256, and import timestamp. Surviving references never renumber or recycle.
- [ ] Unsupported type, oversized/unreadable input, permission failure, and insufficient storage have actionable errors. Failed or cancelled imports do not create apparently successful evidence records or leave a partially published attachment.
- [ ] Preview PDFs and supported images internally with local assets and safe document handling. Open other supported documents only on explicit action in their installed desktop application; report missing associations and preview/open failures. Do not provide Office conversion.
- [ ] Resolve attachment-open requests from managed IDs in main, not arbitrary renderer paths. Imported documents cannot gain application navigation, Node, filesystem, or shell privileges.
- [ ] Detect missing or hash-corrupt managed files, show the affected evidence reference, and offer replacement/removal. Repair actions retain consistent ownership/metadata and do not renumber surviving records.
- [ ] Integrate readable attached evidence into the shared Step 3 evidence rule while retaining notes/links as valid alternatives. A missing/corrupt file cannot itself satisfy readiness; operations that require its bytes must fail explicitly rather than silently omit it.
- [ ] Evidence import/replacement/removal advances Step 3's relevant revision and data revision; previewing/opening does not invalidate manual completion.
- [ ] Public-operation and renderer checks use real files for source-file movement, duplicate names, exact size boundaries, broken hashes/missing bytes, repair/removal, cancelled/failed imports, storage exhaustion, and OS-open failures. Reuse the visible autosave/error protection.
