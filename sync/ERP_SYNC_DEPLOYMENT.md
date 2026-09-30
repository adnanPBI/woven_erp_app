# ERP and scheduled Google Sheets sync

The ERP and the sync worker are separate processes sharing the same MySQL database. Target on cPanel: `weavonpq_weaving_main`. The ERP does not need to restart after each sync; dropdown searches query MySQL when opened.

Local verification: the Windows ten-minute task completed a fresh September29 live cycle with 2042 inserts, 820 edits, 16381 refreshes and zero rejections. September30 verification matched all 19243 planned ledger operations and all original retained rows across 22 tables. A later timer-triggered cycle exited 0 with no changes. Local target is weavonpq_weaving_sep22_preview; this does not install cPanel cron. The hosted baseline still targets the original September22 SQL import.

## Changes made for the attached ERP

- `weaving-erp app/server.js` loads its own optional `.env` without replacing cPanel-injected variables, validates required settings and honors `DB_PORT`.
- PO and Dispo dropdowns sort by business date before import timestamp. A bulk import timestamp no longer places July Dispos ahead of September Dispos.
- The dropdown API and browser requests disable caching, so reopened searches read committed changes.
- Bun dependencies were installed and a lockfile created. The ERP was tested using Bun; use the hosting account's supported Node.js runtime for the cron worker.

## Local evidence

On September 29, the full database-backed dry run of the saved September 24 snapshot passed with zero rejected rows (`sync_dry_2026-09-29T07-03-46-153Z`). Actual receipt update and simulated failure tests also passed: business and ledger writes rolled back together. These complement the Dispo and HTTP tests below.

`local_data/erp_integration/report.json` records a successful integration test using real normalized Dispo source rows and the actual sync planner, transactional runtime, and MySQL in the isolated `weavonpq_erp_sync_test` database. A new Dispo was inserted, a buyer edit updated an existing Dispo, replay did not duplicate records, the same snapshot became a no-op, and retained pre-2024 Dispos remained unchanged.

`local_data/erp_integration/api-report.json` records authenticated HTTP tests against the full ERP running on Bun: both inserted and edited records appeared in the dropdown, latest records were ordered by business date, cache headers were correct, and anonymous API requests remained unauthorized. The temporary ERP process was stopped after testing. The test database contains synthetic test records; do not export it to production.

These tests do not establish that cPanel cron has been installed, that every ERP module has been tested, or that edits to ambiguous identifiers can be guessed safely.

## cPanel installation

1. Back up `weavonpq_weaving_main`. Install the private CLI folder outside `public_html`, for example `/home/ACCOUNT/import_mapper_cli`. Keep its `lib`, `scripts`, `config`, `schema`, `rules`, `mappings`, `import.js`, `package.json`, and `package-lock.json` together.
2. Include `baseline.meta.json`, `baseline.events.jsonl.gz`, and `baseline.match-signatures.jsonl.gz` and `reviewed-reassignments.json` from `local_data/sync_package`. Set `SYNC_REVIEWED_REASSIGNMENTS=/home/ACCOUNT/import_mapper_cli/reviewed-reassignments.json`. This baseline identifies the September 22 imported records; do not initialize from a new fetch or treat old data as new inserts.
3. In that folder run `npm ci --omit=dev`. Create a private `.env.sync` from `config/cpanel-sync.env.example`, set the real server-side credentials, exact target name, `SYNC_DATA_DIR=/home/ACCOUNT/import_mapper_cli/sync_data`, and `SYNC_BASELINE_FILE=/home/ACCOUNT/import_mapper_cli/baseline.meta.json`. Keep `SYNC_ENABLED=false` initially.
4. Set up read-only Google access: use `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` for a service account with Viewer access to the nine configured tabs. Alternatively, `SYNC_GOOGLE_MODE=public-csv` uses the configured public CSV exports if they remain publicly accessible. Do not copy local database credentials or keys to cPanel.
5. Run the read-only connection check, then initialize the sync ledger:

```sh
node scripts/sync/check_cpanel.js --env=/home/ACCOUNT/import_mapper_cli/.env.sync
node scripts/sync/run.js --env=/home/ACCOUNT/import_mapper_cli/.env.sync --initialize
node scripts/sync/run.js --env=/home/ACCOUNT/import_mapper_cli/.env.sync --plan
node scripts/sync/run.js --env=/home/ACCOUNT/import_mapper_cli/.env.sync --dry-run
```

Initialization verifies the business tables against the final export's baseline and creates only sync tracking tables. If production business data has changed since the import, initialization stops; reconcile and deliberately rebase before enabling sync. It must not overwrite newer ERP data to force a match.

If sync tracking tables were initialized with the earlier prototype, run `node scripts/sync/run.js --env=/home/ACCOUNT/import_mapper_cli/.env.sync --upgrade-matching` once to add matching signatures. This touches only sync metadata. Receipt groups sharing natural keys match uniquely when only Last Received Date changes; Yarn Issue groups also support Delivery Place-only edits. All other fields must match exactly. An optional `SYNC_REVIEWED_REASSIGNMENTS` JSON file supports explicitly reviewed identity corrections with old/new fingerprints and the original source UID. Stale or ambiguous review evidence is rejected; the review file includes reviewed receipt/issue/delivery corrections and six retained source removals or former master keys. Removed source rows retain their ERP records; they are not guessed to be a different pre-existing record. A former master key is retained for historical links while its corrected master is imported under the current key. Reviews for records first introduced by local incremental sync are skipped on a baseline-only installation when that source UID has never been imported.

6. Review `sync_data/status.json` and the cycle's `plan.json`. Set `SYNC_ENABLED=true`, then run one manual cycle with `node scripts/sync/run.js --env=/home/ACCOUNT/import_mapper_cli/.env.sync`. Check that it completed and inspect the ERP dropdowns.
7. In cPanel **Cron Jobs**, use minute `*/10`, hour/day/month/weekday `*`. Command (replace the Node path and ACCOUNT with the actual hosting values):

```sh
/ABSOLUTE/PATH/TO/node /home/ACCOUNT/import_mapper_cli/scripts/sync/run.js --env=/home/ACCOUNT/import_mapper_cli/.env.sync >> /home/ACCOUNT/import_mapper_cli/sync-cron.log 2>&1
```

Cron owns the interval; `SYNC_INTERVAL_MINUTES=10` documents the intended schedule but does not install it. A database advisory lock skips overlapping cycles. A job taking longer than ten minutes does not create parallel imports. Preserve cron failure notifications and review the status report; rotate the outer cron log using your hosting facilities.

8. Deploy the changed ERP `server.js` and `public/js/erp-async-search-dropdown.js` to their matching application paths, retaining all other ERP files. Ensure the application's `DB_NAME` is also `weavonpq_weaving_main`; keep its existing `SESSION_SECRET` and credentials. Restart the ERP once for these code/configuration changes and hard-refresh the browser.

## Sync semantics and limits

- Each cycle reads the nine configured tabs, filters business dates from 2024 onward through the current Asia/Dhaka date, and normalizes/certifies the snapshot. Undated rows remain excluded with audits.
- Stable tracked identities prevent changing CSV file hashes from duplicating unchanged events. Existing-record edits reuse the original source binding. Aggregated Loom/Folding quantities are replaced from the normalized total rather than added to the old total.
- A source row and its sync checkpoint commit in the same transaction. Interrupted attempts can resume. Before applying a changed cycle, the worker creates a backup; retries retain earlier backups and create another uniquely named backup. The latest six backups are retained separately from the latest six source cycles, so unchanged polls do not discard the most recent pre-write backup.
- Upstream Dispo changes are carried between separately planned profiles so affected downstream records can refresh derived fields.
- Existing retained masters are reused without changing 2023 records. Source deletions do not delete ERP data. Ambiguous edits, deletions and changes to identity fields are blocked for review rather than guessed; immutable IDs added at the source would be needed to make those cases fully automatic.
- Sheets are authoritative for the mapped fields of tracked imported records. ERP edits to those same fields may be overwritten by a later Sheet edit; agree on ownership before enabling the job.
- Scheduling and fresh Google access must be tested on cPanel. This workspace has not accessed or changed the production database or installed your hosting cron job.

Official reference: [cPanel Cron Jobs](https://docs.cpanel.net/cpanel/advanced/cron-jobs/).

## Windows local schedule

The local Windows setup is documented in LOCAL_AUTO_SYNC.md. It targets only weavonpq_weaving_sep22_preview and does not install cPanel cron. The updated matching baseline contains 105,002 receipt and issue signatures; installations using an earlier package must run --upgrade-matching before syncing.
