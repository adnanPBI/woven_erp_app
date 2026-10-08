# Project memory

Updated: 2026-10-04. This public journal excludes credentials and private datasets.

## Architecture

Express/MySQL ERP served below `/main`; `app.js` starts `server.js` under Passenger. Public assets are explicit and diagnostics require an administrator. Existing business authorization remains in individual handlers.

The separate `sync/` package reads nine Google Sheets tabs, filters business dates, normalizes/certifies sources, plans against a MySQL ledger, performs a full dry run, backs up and applies records transactionally. Business and ledger writes commit together. Hosted target: `weavonpq_weaving_main`.

## Completed work

- Integrated the supplied current ERP screens/API and asynchronous dropdowns while preserving repository-only modules.
- Business-date dropdown ordering, no-store requests, DB_PORT and environment loading that preserves injected values.
- Full sync source, mappings/schema/rules, tests, templates and cPanel instructions.
- Stable tracked identities, exact reviewed corrections, unique duplicate-key matching, downstream refresh and aggregate replacement.
- Source removals preserve business history; original retained data, including 2023, remains protected.
- Credentials, databases, source snapshots, private tracking bundles and runtime state excluded from GitHub.

## Verification

Local Windows/XAMPP tests covered insert/edit visibility under Bun, replay/no-op, atomic rollback, a scheduled write cycle and retained fingerprints. The September 29 cycle applied 2,042 inserts, 820 edits and 16,381 refreshes with zero rejections. September 30 checks verified all 19,243 planned ledger operations and unchanged original rows across 22 tables. A subsequent automatic poll exited successfully with no changes. Private evidence remains in the original workspace.

This publication adds focused HTTP boundary tests and planner/dry-run gate checks. Production/cPanel has not been accessed or deployment-tested.

Publication checks passed on September 30: npm run check, npm test (HTTP boundaries, sync planner and full dry-run gate), and the full repository ERP started under Node.js against the isolated test database. Authenticated dropdowns showed inserted and edited records, dates sorted correctly, cache controls applied and anonymous requests failed. A source scan found no private local credential matches or private-key/token patterns. Existing deprecated dependencies were not comprehensively upgraded or security-audited in this deployment change.

## Deployment and limits

Follow `docs/CPANEL_DEPLOYMENT.md`. Upload the private baseline separately. Initialization expects the original September 22 SQL import; hosted changes since import need reconciliation. Do not overwrite newer records to force baseline checks to pass.

No deletion mirroring or guessed identity merges. Future ambiguous key edits can require review. Large catch-ups can exceed ten minutes; overlapping starts skip. Historical RBAC/security guides remain as history; current source and deployment guide govern configuration.

## Maintenance

Read this file at session start. Update after meaningful milestones and before handoff, recording tests actually run, failures, risks and safe resume instructions. Never publish credentials or complete business datasets.

## October 3 storage correction

Found and corrected a retention defect: failed cycles skipped cleanup and accumulated complete snapshots. The public run.js entry point now supervises worker.js, measures runtime/free-space usage, and stops its process tree on budget exhaustion. Locked cleanup runs before and after all outcomes, preserving current/pending recovery data. Defaults retain two cycles and two complete backups with a 4 GiB runtime budget; logs rotate. See docs/SYNC_STORAGE.md. This is a sampled application guard, not verification of a hosting-account quota.

Storage tests cover repeated failure cleanup, protected recovery/backups, link refusal, capacity rejection, log rotation, supervised descendant termination and overlap/finalization. Application check/test passes. Exact reviewed splits can now retain the same natural key while binding a specific destination fingerprint; replay remains a no-op. No generic identity guessing or deletion mirroring was added.

Local corrections and both saved/fresh snapshot applies passed validation, ledger verification, no-op replay and original-row preservation checks across 22 tables. Eight subsequent automatic apply cycles and two no-op polls were observed, including mapped edits; temporary download failures recovered. An interrupted planning cycle was retried on October4. The user confirmed the remaining issue merge on October4. A backed-up transaction preserved the destination total, neutralized the superseded issue and detail quantities, and retained history. Exact receipt-reference corrections and merged parent/detail totals passed local assertions. The resumed backlog completed after a successful full dry run:313 inserts,130 edits and3476 refreshes, with all3919 ledger operations verified. Same-snapshot replay found zero changes; original fingerprints passed all22tables again. Completion evidence remains in the private workspace. Private details remain in the original workspace.

October4 verification: failed-cycle cleanup reduced runtime usage from approximately1.79GB to1.28GB, with sampled peak1.81GB below the4GiB default. Original-row fingerprints passed all22tables again. Local scheduling was restored enabled/Ready after merge verification. No pending live run remains; future identity conflicts still require review. Deployment archives were rebuilt from this checkout; the existing published GitHub main and cPanel have not been changed. Hosting account quota, credentials and a hosted manual cycle remain unverified.

## October 8 yarn matching and authorized partial sync

Implemented full-prefix Dispo/count/warp-weft/lot identity matching, replacement quantities, exact-evidence legacy metadata hydration, and missing-provenance refusal. Prefixes and leading zeros remain distinct. Added opt-in skip-dispos policy and private fingerprint-bound record exclusions. Held records keep their ledger/business rows; shared lot dependencies and uncertain replacement inserts are held as well. Schema and unbounded conflicts still fail closed. See docs/SYNC_YARN.md. Private exclusions, source snapshots, credentials and runtime reports are excluded from Git.

User authorized skipping all unresolved affected Dispos and continuing independent changes on the existing ten-minute local schedule. Fresh local plan passed and full database-backed dry run completed with zero rejected rows. Backed-up local apply completed: 145 inserts, 20 edits and 479 dependent refreshes, with all 644 ledger operations verified. Same-snapshot replay returned zero inserts/edits. Original-row fingerprints passed all 22 protected tables. The 14 explicitly excluded ledger identities remain unchanged; source plans selected no yarn writes in this cycle because the dependency holds are broad. Other independent modules continued. The Windows task is enabled/Ready at PT10M with IgnoreNew overlap handling. Evidence stays in the private workspace. New planner/exclusion tests, MySQL temporary-table identity/update/replay/rollback tests, npm run check and npm test passed. Hosting remains untouched. Existing unpublished storage supervision fixes are included in this publication.
