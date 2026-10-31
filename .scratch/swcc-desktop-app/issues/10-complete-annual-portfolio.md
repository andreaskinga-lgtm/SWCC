# 10: Export a self-contained annual portfolio with original evidence

**What to build:** The worker can retain or share one annual portfolio ZIP containing complete readable forms and identifiable original evidence bytes, with a clear distinction from a restorable full-app backup.

**Blocked by:** 09: Carry long annual narratives onto readable continuation pages.

**Status:** ready-for-agent

- [ ] Offer Export Complete Portfolio ZIP separately from Forms PDF through C's dashboard export controls and an OS destination dialog. Preserve the approved year-based archive/form naming contract.
- [ ] Include the generated forms PDF, a text evidence index, a portfolio manifest, and every managed attachment's original bytes grouped by stable E reference.
- [ ] The index connects A/E references, original filenames, and safe archive paths without repeating application-to-practice narratives. Shared activity evidence is included once, not once per goal link.
- [ ] Sanitize archive names for Windows and macOS, including reserved/awkward filenames, and keep paths unique even for identical original names. Retain the original name in the index and preserve exact sizes/hashes.
- [ ] The manifest explicitly identifies an annual portfolio and records year, export time, fixed source-set identity, attachment inventory, sizes, and SHA-256 values. It is not a full-app backup or restore input.
- [ ] Flush drafts and collect one consistent snapshot of annual records and required evidence while preventing conflicting mutation/deletion. Show understandable progress/busy state and preserve pending edits.
- [ ] Incomplete readiness/manual completion warns and permits draft export; missing/corrupt required attachment bytes, PDF generation errors, or storage/write failures fail explicitly. Never silently omit evidence.
- [ ] Publish the final archive only after all output is completely written. A cancelled or failed operation cannot report success or leave a partial archive looking complete.
- [ ] Public-operation checks inspect real ZIP contents/manifests/indexes, extract original files, and compare their hashes/bytes. Cover long forms, shared/supplementary activities, duplicate/Windows-reserved/accented names, broken evidence, attempted concurrent edits/deletions, failed flush, and write failure.
