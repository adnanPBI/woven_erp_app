# cPanel source changes and migration verification

This is a source/maintenance record, not a live status endpoint. The procedures for future changes are in [CPANEL_OPERATIONS.md](CPANEL_OPERATIONS.md). Private job selections, record identities, credentials and proof bundles are intentionally not published.

## Published changes

| Source change | Implementation | Why it matters |
| --- | --- | --- |
| Qualified manual mode, PR #4 | `sync/lib/hosted_protection_guard.js`, `sync/lib/sync_manual_conflict_skips.js`, `sync/scripts/sync/worker.js` | Introduces explicit v2 frozen exception mode with zero active broad holds/exclusions after owner qualification; retains legacy 42/14 enforcement for legacy policies |
| Exact state preservation | `sync_manual_conflict_skips.js`, `sync_business_evidence.js` | Binds database/host, manifest, cycle, dates, source/ledger fingerprints and retained or absent physical state; no policy-driven business deletion |
| Receipt dependency correction | `sync/lib/source_index.js` and exact-skip module | Prevents untransferred skipped quantities from entering issue balances; recalculates complete-source minus skipped plus verified retained contributions |
| Advisory-lock heartbeat | `worker.js` | Keeps the owning MySQL session alive through long preparation; a lost heartbeat stops the supervised writer |
| Distinct weaving returns | `yarn_sync_identity.js`, `yarn_sync_match.js`, `weaving_return_identity.test.js` | Recognizes supplied explicit return references without inventing challans; keeps distinct returns separate and unknown duplicates blocked |
| Narrower qualified date window, PR #5 | `sync/lib/sheets_sync_runtime.repair.js`, `sync_date_scope.test.js` | Accepts later starts while retaining the earliest production floor and checking every operation's business date |
| Authorized recurring mode, PR #6 | `sync/lib/sync_scheduled_skips.js`, hosted guard, worker, `sync_scheduled_skips.test.js` | Requires a distinct v3 automatic grant and immutable reviewed base; rebinds exact source occurrences per snapshot and preserves a frozen cutoff on resume |
| Physical absence checks | `sync_manual_conflict_skips.js` | Stops if a skipped target appears outside the ledger; an absent old ledger UID alone is insufficient evidence |
| Cumulative receipt date, PR #7 | Scheduled qualifier and actual CSV regression tests | Allows only an explicitly qualified `Last Received Date` signature difference, retaining quantities/identity/other fields and duplicate counts, then binds full new digests |
| Committed row history | `sync/lib/sync_row_history.js` | Captures source/profile/table/key/before/after in the business transaction; rollback removes both; no-primary-key scopes remain explicit |
| Storage/overlap supervision | `sync/scripts/sync/run.js`, `sync/lib/sync_storage.js`, wrapper | Keeps pending/current evidence, rotates logs, checks budget/free space, enforces file/database locks and stops supervised workers on capacity failure |
| Wrapper failure event | `sync/run-hosted-sync.sh` | Repository wrapper now records the deployed `SYNC_FAILURE` event while preserving the worker exit code and stderr tail |
| Operator documentation and comments | This change, the operations guide, SQL reference and inline comments | Explains private/public boundaries, one-off qualification, exact-mode transition, deployment pins, quota caching, retention and failure interpretation |

The older dated Stage 3 remediation note and October 25 rollout remain historical evidence. Their old blocker counts/schedules do not override a later explicitly qualified v2/v3 policy. Their preservation, backup, evidence and no-reinitialization principles still apply.

## Historical October 29 verification outcome

The completed September 22–October 29 **frozen snapshot** qualification recorded:

| Metric | Recorded result | Interpretation |
| --- | ---: | --- |
| Insert / update / refresh profile operations | 13,982 / 38 / 142 | Source/profile actions, not physical documents or table rows |
| Eligible source records matched | 14,162 | Zero unmatched after the six exact skips |
| Mapped targets verified | 28,802 | Independently checked mapper targets |
| Physical business row inserts / updates | 28,349 / 72 | Committed audit writes across 18 business tables; zero recorded deletions for this run |
| Historical originals checked | 945,533 across 36 tables | Exactly 30 separately qualified replacements; other originals preserved |
| Same-snapshot replay | Zero proposed changes | Idempotence evidence for that snapshot, not for future Sheets edits |

Eight original overlapping conflict findings represented six current skipped records. The conflicts were bypassed, not resolved. The actual target qualification found their prior counterparts absent; it preserved that absence instead of assuming a disposable database's retained records existed in production. No missing Loom source records were invented.

The subsequently authorized recurring path completed a separate enabled-wrapper apply/verify, then a later scheduled invocation stopped safely on a **new** yarn-identity ambiguity. A completed catch-up and an enabled cron do not mean every future source edit is already reconciled. Consult live private evidence for current status; do not extend the original exception to new conflicts.

These aggregates are a dated outcome, not a portable approval. A different database, schema, snapshot, review set or historical before-image needs fresh qualification. The reusable source is versioned; one-job orchestration and record-bound evidence remain private.

## Operations handled without changing business records

- Paused source/config staging, installed-file before/after hashes and preservation of unrelated ERP files.
- Fresh consistent backup, checksum/gzip validation and restore/count verification in an isolated cPanel database.
- Exact provenance-based legacy identity metadata qualification and fingerprint-bound source-missing historical retentions; no broad current-source exclusions.
- Explicit cron authorization, rolling end-date configuration, one ten-minute entry and observation of the actual wrapper/scheduled results.
- Separating durable migration evidence from active retention; specifically approved retirement of inactive generated preparation cycles while preserving audit metadata, databases and accepted backups.
- Diagnosing a stale own-account quota report after cleanup and refreshing only that account's vendor cache; quota limits and the wrapper reserve were not reduced.
- Read-only SQL verification of committed history and keyed target existence; keeping source/profile counts separate from physical writes.

These are procedures to requalify, not scripts to replay with old bindings. Transport errors can occur after a successful remote mutation; durable markers must be checked before repeating provisioning, restore, deployment, activation or cleanup.

## Checks for future changes

Run `npm run check` and `npm test`. Linux CI runs isolated wrapper fixtures for successful preflight, worker success/failure exit codes, quota rejection and checksum drift. Windows skips the Linux wrapper fixtures; shell syntax can be checked using a suitable Bash, and CI provides the Linux execution result. No fixture calls cPanel, edits cron or connects to a business database.

The manual/recurring suites cover manifest/database/window/hash drift, exact multiplicity, reordered UIDs, real CSV qualification, date rollover/recovery, cumulative-date allowance, quantity-edit rejection, receipt totals and retained/absent state. Existing planner, history, identity, normalization, lineage and storage tests remain required. Passing these tests is not permission to deploy or proof of a newly synchronized live database.
