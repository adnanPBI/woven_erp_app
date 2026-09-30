# Project memory

Updated: 2026-09-30. This public journal excludes credentials and private datasets.

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
