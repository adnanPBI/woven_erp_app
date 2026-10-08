# Stage 3 read-only remediation status (2026-10-08)

**Decision: BLOCKED for production deployment and sync writes.** This note records operator evidence only; it is not approval to deploy, run production initialization, enable cron, or change business rows. The MCP v0.3.0 connector reported write_tools_enabled=false.

## GitHub / hosted source drift

- GitHub main at inspection: c050cc99f4e92eda11123531cf402f62297233b6.
- Stage 3 compared four allowlisted files: main.js matched; package.json and server.js did not match; app.js was absent on the hosted ERP. This does not represent a whole-tree diff.
- GitHub app.js is a small Passenger startup shim requiring server.js. Hosted Passenger startup configuration must be examined before deciding whether it is needed.
- Latest available hosted ERP stderr contains a 2026-10-01 ReferenceError for sanitizeDropdownSearchText. GitHub server.js defines/uses cleanDropdownSearchText. This is evidence of a source mismatch and historic bug, not proof it remains active.
- Preserve an independent read-only snapshot of hosted code and compare complete source privately. Do not blindly overwrite hosted customizations or expose configuration/secrets in diff logs.

## Private baseline custody

- An authorized Windows workspace contains all four original baseline artifacts: baseline.meta.json, baseline.events.jsonl.gz, baseline.match-signatures.jsonl.gz, and reviewed-reassignments.json.
- Its 4-member private ZIP was independently CRC-checked; the ZIP SHA-256 matched the pre-existing local package manifest, the embedded gzip streams decompressed successfully and each extracted artifact matched the archived member.
- The baseline reported format version 2. This does not prove the production MySQL instance matches the original September 22 imported database.
- Stage 3's fixed cPanel paths did not find the private sync environment, baseline, data directory, or recovery evidence.
- Keep all private artifacts outside public_html and outside GitHub. Use the original tracking baseline; do not synthesize new events from current Sheets to bypass reconciliation.

## Backup and retained records

- A historical LOCAL SQL backup passed its recorded SHA-256 checksum, but this is not a current hosted MySQL backup; neither cPanel restore nor application restore has been tested.
- On 2026-10-08, the explicitly limited LOCAL preview database weavonpq_weaving_sep22_preview passed read-only retained fingerprint verification for all 22 protected tables with zero changed fingerprints. This does not prove current hosted parity.
- Historical import-mapper dry run was marked completed with 441,549 rows and zero rejected, but profile-level lookup misses exist. They must be classified and reconciled, rather than equated to a clean cross-table integrity pass.

## Remaining gates in strict order

1. Record deployed Passenger configuration and privately diff full hosted package.json/server.js against the pinned repository; resolve the dropdown-helper bug in staging without losing host-specific behavior.
2. Independently back up current hosted code, current MySQL and private config, and verify both checksum and a complete restore into an isolated staging environment. Verify hosted account quota; do not count filesystem free space as quota.
3. Stage the original private baseline in a private location, verify its custody and digests, and prove its applicability to the September 22 import and any changes after that date.
4. On a separate staging MySQL database, compare nine source master-table counts, ledger/provenance and all protected original row fingerprints. Investigate missing lookups, orphan parent/child identities, held Dispos, yarn receipt/issue dependencies and incomplete older relationships.
5. Confirm private exact-review assignments and exclusions; run current source validation, sync plan and full database-backed dry run in staging only. Preserve held records, originals and 2023 history. Check replay/no-op, source removals, rejected/conflict records and disk usage.
6. Produce signed-off restore evidence, reconciliation report, quota evidence, staging smoke tests, rollback plan and explicit production change-window approval before any production action.

**Safety:** keep SYNC_ENABLED=false and production cron disabled for this remediation. No September 22 SQL reimport over populated tables, no guessed Dispo reassignment, no sync initialization on an existing ledger, and no source deletions mirroring to business records.

## Offline helper

A separately packaged read-only static preflight helper and unit tests accompany this remediation. They inspect allowlisted file hashes and baseline/backup formats but deliberately cannot approve production deployment: current hosted backup restorability, MySQL reconciliation and quota require staging evidence.
