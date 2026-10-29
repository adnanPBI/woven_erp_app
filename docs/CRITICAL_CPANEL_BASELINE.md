# CRITICAL: preserve the deployed cPanel baseline

**Owner instruction, 13 October 2026:** keep these deployed updates intact during forthcoming security remediation. Do not remove, revert, replace or redesign the features, relax their protections, or overwrite cPanel as part of repository cleanup. Security fixes must preserve their behavior and pass regression checks. Intentional changes to protected behavior require explicit owner authorization.

This note supersedes older historical statements that hosting was untouched. Publishing a Git commit does not authorize redeploying cPanel, reinitializing synchronization or repeating migration.

**Later authorized policy migrations:** the installation/scheduler and hold statements below record the October 11–13 baseline. For the later frozen manual and separately authorized recurring modes, read [the policy specification](MANUAL_TRANSFER_POLICY.md), [source change record](CPANEL_CHANGELOG_2026-10.md) and [current maintenance procedure](CPANEL_OPERATIONS.md). Legacy 42/14 guards remain mandatory for legacy policies; do not impose their old broad exclusions on an explicitly qualified v2/v3 mode or remove the legacy guard globally. These documents do not themselves change a live policy or schedule.

## Historical October 11–13 hosted installation

| Component | Verified location / setting |
| --- | --- |
| ERP | `https://weaving-erp.xyz/main` |
| App root | `/home/weavonpq/public_html/main` |
| Database | `weavonpq_weaving_main` |
| Private sync root | `/home/weavonpq/sheets_live_sync_20261011` |
| Node executable | `/home/weavonpq/nodevenv/public_html/main/24/bin/node` |
| Cron minutes | `5,15,25,35,45,55` every hour |
| Cron command | `/bin/bash /home/weavonpq/sheets_live_sync_20261011/run-hosted-sync.sh` |

Repository `sync/` maps to the separate private sync root, not an HTTP-accessible folder. Preserve private environment files, existing session secret, database grants, source access and host-generated Passenger settings. The checked-in wrapper records the exact hosting-specific paths intentionally.

## Features that must remain intact

1. **Header:** account controls on row one; Database, Sync History, User Privilege and Report Generator on row two, right-aligned on desktop and wrapping on narrow screens.
2. **Database viewer:** every MySQL column, paginated records, sticky headings and fixed footer Columns slider. Dispo Plan has 84 columns; Dispo Form Data has 127. Do not restore the former nine-column limit.
3. **Access:** existing Admin acts as owner/manager; no separate Owner login exists yet. Rows start locked. Explicitly granted users can edit eligible notes only. Preserve current-role checks, CSRF, stale-fingerprint rejection, transactional audit and protection checks. Viewer locks do not override existing ERP form permissions or source sync.
4. **Sync history:** source counts plus MySQL added/updated/deleted counts; details include table, row identity, Dispo, source record, changed fields and before/after values. Child-detail replacement deletes are not deleted source orders. Capture began **12 October 2026 at 15:52:27 Asia/Dhaka**. Never invent older details or mark worker-only reports as confirmed completion.
5. **History clearing:** hide the chosen 1/3/7/24-hour or 3-day window from the requesting manager's view only. Keep business records, source logs and audit entries.
6. **Atomic capture:** row-history writes share each importer mutation's connection and transaction. Rollback removes both. Tables without unique primary keys explicitly identify matching row sets or submitted values instead of inventing unique identities.
7. **Sync protections:** preserve tracked-row updates, idempotent replay, duplicate prevention, yarn identity matching, dependency exclusions, full database-backed dry-run gates, bounded storage, download retries, quota checks, scheduler flock and database advisory lock. Sheets remain read-only and source deletion mirroring remains disabled.

## Legacy reconciliation holds are not approvals

- **Legacy policies require 42 holds and 14 original exclusions.** Later owner-qualified v2/v3 modes replace broad restrictions with exact private bindings as specified above. All modes require their applicable private policy; keep record selections out of Git.
- **26 staging technical retentions are not production approval.** No correction approvals were invented.
- Held corrections require genuine source/history/form evidence, authorized human sign-off and an independent second review, followed by fingerprint validation and a full exclusion-bound, database-backed dry run before production synchronization.
- Preserve original/2023 records and private fingerprints. Never rerun migration or reset the ledger to make validation pass.
- Preserve existing private `protection.sha256` entries. An authorized source change needs review and its specific fingerprint updated under the existing locks. Never regenerate the manifest blindly to accept altered policy or data.

## Source and schema continuity

App changes: `main.html`, `main.js`, `server.js`, `lib/database-console.js`, `lib/database-console-config.json`.

Sync changes: `sync/lib/mapping_contract_runtime.js`, `sync/lib/sync_row_history.js`, `sync/lib/hosted_protection_guard.js`, `sync/scripts/sync/run.js`, `sync/scripts/sync/worker.js`, `sync/scripts/local/download_public_sources.js`, `sync/run-hosted-sync.sh`.

Metadata-only DDL is recorded in `sync/sql/erp_console_tools.sql` and `sync/sql/sync_row_history.sql`. **Those tables already exist on cPanel: do not rerun the DDL or reset capture timestamps.** New installations need controlled schema provisioning before enabling these features; no automatic startup migration runs. The console config contains only current non-secret defaults; preserve later authorized private owner configuration rather than blindly overwriting it.

Private backups remain in `/home/weavonpq/erp_database_console_20261012`, `/home/weavonpq/erp_database_console_v2_20261012` and `/home/weavonpq/erp_header_alignment_20261013`.

The v2 deployment verified unchanged checksums for 36 physical business tables; `order_summary_stats` is a read-only view. No business rows changed during that deployment. The subsequent right-alignment update changed one CSS declaration only.

## Verification and known limits

Run `npm run check` and `npm test`. Optional real database tests use `ERP_TEST_MYSQL_ENV`, pointing to an external private credential file for a local disposable server, and `npm run test:console:mysql`. They accept only localhost/127.0.0.1, create/drop their own uniquely named test database and never use the configured business database.

At this historical checkpoint, ten-minute scheduling was active, but successful completion every interval was not established: retained evidence included successful unchanged polls, source-download failures, missing final completion markers and roughly twenty-minute start gaps. Keep these distinctions in the UI and inspect the live installed environment/cron/cycle for current status. Row-level history does not itself approve historical corrections or prove every later source change was imported.

The owner will supply security findings separately. This publication does not claim those findings are fixed or that the entire application has been security-audited.
