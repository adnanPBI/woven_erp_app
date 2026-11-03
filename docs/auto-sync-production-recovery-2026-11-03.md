# Production auto-sync recovery and source release — 2026-11-03

This document links the reviewed source-level changes in GitHub to the
production Weaving ERP Google Sheets to MySQL recovery. It intentionally
contains no private source snapshots, SQL dumps, credentials, owner tokens,
business-row identities or retained-skip evidence.

## Observed production results

- The October 29 authorized manual transfer covered September 22 through
  October 29. Later incremental source comparisons used certified October 29
  and November 3 snapshots.
- A guarded receipt correction was applied with preimage checks, transactional
  audit evidence, and no row deletions. The private correction receipt must
  not be replayed from GitHub.
- The November 3 production plan had zero unresolved conflicts and zero deletes:
  468 proposed inserts, 259 updates and 4,690 dependent refreshes.
  Its importer dry run and live execution succeeded.
- SQL readbacks and post-apply verification passed. A subsequent unattended
  scheduled run completed with one new source row, 24 source updates and 96
  dependent refreshes, again without conflicts or deletes.
- Later zero-change scheduled runs completed. These outcomes concern their
  captured source snapshots and are not a guarantee of all future source edits.
- Five explicit source exclusions remain intentionally pinned, reviewed,
  and protected. Historical records are preserved rather than silently deleted.

## Source-level change

The production importer includes explicit sync-only SQL guards in
sync/lib/mapping_contract_runtime.js: mutation checks, verified target
preimages, key-preserving child reconciliation, prohibition of sync deletes,
single-row update requirements, SQL query fencing and fail-closed rejection.
Legacy manual migration behavior remains distinct from sync execution.

Sync History and Database have separate client-side window assets that
preserve backend RBAC, same-origin credentials, CSRF and existing APIs.

## Private operational state: never commit

- .env.sync, secrets, credential files, exact skip/rebind decisions, reviewed
  authorization tokens, protection SHA manifests, source CSV snapshots.
- MySQL dumps, production row audits, receipt correction evidence, manual
  review records, scheduler logs, source manifests and generated output.
- Candidate/repair scratch source files or runtime backups.

GitHub source alone does not activate production synchronization. The hosted
worker still requires its separately verified environment, owner-mode
authorization, local quota, exact review policy and integrity manifest.
Do not replace the live hosted data or private config with a bulk git pull.

## Evidence boundary

This repository stores code and frontend source. Actual production SQL
transactions, independent readback receipts, approved review files and
historical backup archives remain in authorized private storage. A GitHub
commit is not itself a new SQL deployment. Verify scheduler health and
conflict status again whenever assessing a later date.
