# Weaving ERP Import Mapper v3.2.3 — Local Google Sheets Migration Rehearsal

This repository is a Windows/XAMPP-safe rehearsal build of the existing `import_mapper_cli`. It is designed for your current database state: **2023 rows remain in MySQL while 2024–2026 business rows have been removed**. The package reads the nine current Google Sheet sources, filters them to 2024-01-01 through 2026-12-31, runs the existing v3.2.3 normalization/mapping/provenance gates, performs a full dry run, and only then permits a live write into an isolated XAMPP database named `weavonpq_weaving_local`.

For the September 22, 2026 local run, see [LOCAL_MIGRATION_NOTES.md](LOCAL_MIGRATION_NOTES.md) for exact source tabs, the cutoff, snapshot access, and retained-row protection.

## What this package changes

The original mapping contract, table mappings, import order, schema definitions, transaction-per-logical-row behavior, lookup logic, and v3.2.3 source certification remain in place. The local package adds:

- Google Sheets read-only downloader for all nine source profiles.
- A configurable 2024–2026 date window before the CSVs enter the migration pipeline.
- Robust prefixed-date parsing for Folding values such as `Outside-8-Sep-2026`, `Reject-22-Mar-2024`, and `Outside-2-3-Feb-2025`.
- Local XAMPP SQL-dump import helper that targets `weavonpq_weaving_local`, not the cPanel database name.
- Automatic normalization, certification, pending-manifest generation, and local rehearsal approval.
- Full v3.2.3 dry-run acceptance gating before live writes.
- A browser dashboard with **row-level migration progress**, current importer, source row, inserts, updates, rejects, rollbacks, recent row events, and console output.
- A before/after verification gate proving that the retained 2023 counts did not change and that 2024–2026 rows were loaded.

## Local architecture

```text
9 Google Sheet tabs
       |
       | service-account read-only API
       v
local_data/google_raw/<run>/raw/*.csv
       |
       v
v3.2.3 normalize + certify + approved manifest
       |
       v
FULL DRY RUN against XAMPP lookups
       |
       | must PASS
       v
LOCAL LIVE migration (transaction per logical source row)
       |
       v
weavonpq_weaving_local
       |
       v
post-migration preservation + quality verification
```

The `import_mapper_vis` repository is **not required for this local rehearsal**. This ZIP is a complete CLI-side test harness. VIS can remain your mapping UI on cPanel.

## Requirements

Install the following on Windows:

- XAMPP with MySQL/MariaDB running.
- Node.js 18 or newer. Node.js 20/22 is suitable.
- Your phpMyAdmin `.sql` export representing the current cPanel database state after the 2024–2026 wipe.
- A Google Cloud service account that has Viewer access to the nine source spreadsheets. The Google Sheets API must be enabled in that Google Cloud project.

## Step 1 — extract and install

Extract this ZIP to a normal local path, for example:

```text
C:\weaving\import_mapper_cli_local
```

Run:

```text
01_INSTALL_LOCAL.bat
```

This installs only the Node dependencies and runs the package self-test. It does not touch MySQL.

## Step 2 — import your cPanel SQL export into isolated XAMPP MySQL

Copy the phpMyAdmin export to:

```text
local_input\weavonpq_weaving.sql
```

Start MySQL from XAMPP, then run:

```text
02_IMPORT_MYSQL_DUMP.bat
```

The helper creates a new database and refuses to overwrite an existing database:

```text
weavonpq_weaving_local
```

It does not intentionally target `weavonpq_weaving`. Local helpers require a loopback host and the exact database `weavonpq_weaving_local`.

If your XAMPP root user has a password, edit `.env` and set `DB_PASSWORD`. If XAMPP is installed outside `C:\xampp`, edit `XAMPP_MYSQL_EXE` in `.env`.

## Step 3 — configure Google read-only access

Place the service account key at:

```text
local_secrets\google-service-account.json
```

Open that JSON only to find its `client_email`, then share each of the nine Google spreadsheets with that email as **Viewer**.

Do not put the service-account JSON into GitHub or send it with logs.

## Step 4 — launch the migration dashboard

Run:

```text
03_START_DASHBOARD.bat
```

The browser opens:

```text
http://127.0.0.1:3210
```

In the first panel paste the nine spreadsheet IDs and confirm/edit the tab names. Save the sheet settings.

The package is preconfigured for these traced source tabs:

| Profile | Expected tab | Local CSV |
| --- | --- | --- |
| PO | `po database` | `po database.csv` |
| Dispo | `rnd database` | `Dispo create form.csv` |
| Yarn Receive | `yarn received database2` | `Greige yarn receive.csv` |
| Yarn Issue | `Yarn issue database2` | `Greige yarn issue.csv` |
| Warping | `database Warping` | `Warping database.csv` |
| Sizing | `database sizing` | `sizing database.csv` |
| Loom | `Copy of database loom prod` | `Loom production database.csv` |
| Folding | `folding database` | `Folding production database.csv` |
| Greige Delivery | `greige deliverydatabase` | `Greige delivery database.csv` |

If one of your current Google tabs has a different exact name, edit that row in the dashboard before Fetch.

## Step 5 — execute the rehearsal in this order

Use the dashboard buttons from left to right:

1. **Import phpMyAdmin SQL into local DB** — optional if you already ran the batch file.
2. **Test XAMPP database** — confirms the expected ERP tables exist in `weavonpq_weaving_local`.
3. **Fetch + filter Google 2024–2026** — downloads the nine tabs and keeps source records whose configured business date is within the requested window. Excluded/undated rows are audited under `local_data/google_raw/.../audit/`.
4. **Normalize + certify sources** — runs the existing v3.2.3 normalizer, generates certified CSVs, creates the normalization attestation, creates a source manifest, and performs a local rehearsal approval only if all manifest blockers are zero.
5. **Run full dry migration** — performs the complete all-profile dry run against local MySQL for lookup/relationship validation. It writes no business data. The v3.2.3 full-dry-run acceptance file must PASS.
6. **Run local LIVE migration** — enabled only after the accepted dry run exists. It requires typing `LOCAL-LIVE-MIGRATION`. Before the first write, the runner confirms the nine primary 2024–2026 target ranges are empty, archives/removes only stale provenance bindings whose target row was already deleted by your wipe, then captures the retained 2023 baseline. Every logical source row is processed transactionally by the existing runtime.
7. **Verify 2023 preserved + 2024–2026 loaded** — compares the post-run database with the captured baseline and checks the live run summary/provenance.

## What “row by row” means in the dashboard

The v3.2.3 runtime has been instrumented locally with:

```text
IMPORT_PROGRESS_EVERY=1
IMPORT_PROGRESS_JSONL=true
```

For every logical source row the runtime emits an event containing the profile, source row, profile-row counter, outcome, key context, cumulative insert/update/reject/rollback counters, and any row error. The dashboard tails this feed while the importer runs.

The database operation itself was already row-transactional: for live mode a connection is acquired, a transaction begins, the logical row and its related target tables are processed, then that logical unit is committed or rolled back. The visual feed now exposes that operation in real time.

## How the retained 2023 data is protected

The Google downloader writes only rows within:

```text
2024-01-01 .. 2026-09-22
```

The live importer therefore receives no ordinary 2023 source rows from the new Google snapshot. Before local live execution, `scripts/local/preflight_local_db.js` requires the primary 2024–2026 target ranges to be empty. `scripts/local/reconcile_stale_provenance.js` then backs up and removes only provenance bindings whose target record no longer exists (a common side-effect when business rows were manually wiped). Finally, `scripts/local/capture_baseline.js` stores 2023 counts from the nine primary target tables. `scripts/local/protect_retained_rows.js` also fingerprints all retained business rows, blocks their updates/deletes with database triggers, and restricts new primary rows to the configured date window. After the run, `scripts/local/verify_local_migration.js` checks those fingerprints as well as the 2023 counts.

Primary preservation checks cover:

```text
PO_form_data
Dispo_form_data
yarn_receive_form
yarn_issue_form
warping_form
sizing_form
loom_production_form
folding_production_form
greige_delivery_form
```

The verification also requires the live import to have status `completed`, zero validation errors, zero rejected rows, zero required lookup misses, and non-zero 2024–2026 rows in each primary target table.

## Important note about PO and Dispo date filtering

Production profiles have different business dates. The Google source config therefore filters each profile by the same primary date concept used for the preservation check: PO uses `PO Issue Date`, Dispo uses `PO Received Date`, Yarn Receive uses `Received Date`, Yarn Issue uses `Issue Date`, and the production profiles use their own Warping/Sizing/Weaving/Folding/Delivery date. This prevents the local 2024–2026 backfill from selecting a 2023 primary record merely because one of its secondary dates falls in 2024. You can inspect these settings in `config/local_google_sheets.json`.

## Command-line equivalents

You can perform the same workflow without the browser:

```text
04_CLI_FETCH_AND_PREPARE.bat
05_CLI_FULL_DRY_RUN.bat
06_CLI_LOCAL_LIVE_RUN.bat
```

Or use npm scripts:

```text
npm run local:db-test
npm run local:fetch
npm run local:prepare
npm run local:dry-run
npm run local:live
npm run local:verify
npm run local:dashboard
```

## Output locations

```text
local_data/google_raw/       raw filtered Google snapshots and exclusion audits
local_data/prepared/         certified CSVs, normalization audit, source manifests
local_data/runs/             dry/live migration reports, status.json, row_progress.jsonl
local_data/baseline/         2023 pre-live baseline
local_data/verification/     post-live verification reports
```

## Applying the tested design to cPanel later

Do not upload this local `.env` to production. After the local live migration and verification are PASS, use the same validated CLI code and Google source definitions on cPanel, restore the production DB environment variables, take a fresh production backup, run a new production dry run against the current Google snapshot, and only then authorize production writes. The local `_local` safety guard is intentionally stricter than the production deployment process.

The next production stage can then add the 10-minute scheduler after the one-time 2024–2026 backfill is verified.
