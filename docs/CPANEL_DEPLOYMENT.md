# cPanel deployment

For an existing installation, first read [CPANEL_OPERATIONS.md](CPANEL_OPERATIONS.md), [the policy specification](MANUAL_TRANSFER_POLICY.md) and [the protected hosted baseline](CRITICAL_CPANEL_BASELINE.md). Schema/ledger compatibility and the separate-entry challan policy require qualification; a Git pull alone does not migrate them. Preserve the deployed private wrapper, configuration and applicable policy. Legacy 42/14 enforcement and later explicitly authorized v2/v3 modes are distinct.

> **Existing live installation:** Inspect actual status, pending recovery, policy version and installed cron. Historical deployment notes are not live scheduler state. Do not replay initial-install instructions over populated tables, an initialized ledger, private state or existing console/history schema. Source publication does not authorize a production deployment or restart.

The ERP and cron worker share `weavonpq_weaving_main`. Replace ACCOUNT and runtime paths below with your hosting values. No credentials or database dumps are published here.

## 1. New installation: back up and install

Back up the hosted database and application. Preserve your existing private credentials, session secret, Google key and hosting-generated Passenger settings.

Clone using cPanel Git Version Control or Terminal **outside public_html**. Activate the account's Node environment first if your host requires it:

```sh
cd /home/ACCOUNT
git clone https://github.com/adnanPBI/woven_erp_app.git
cd woven_erp_app
npm ci --omit=dev
npm --prefix sync ci --omit=dev
npm run check
npm test
```

Use the hosting account's Node runtime, preferably Node 22 or newer, and the same executable for cron. Do not upload local node_modules or a Windows/local .htaccess containing credentials. No automatic deployment hook overwrites your hosted configuration.

## 2. Configure the ERP

In the host's Node interface (Application Manager, Web Apps or CloudLinux Setup Node.js App), set:

- Application root: the private `woven_erp_app` clone.
- Application URL: `/main` on your domain.
- Startup file: `app.js` (an existing `server.js` entry point also works).
- Environment: production.

Set variables from the root `.env.example` using cPanel or a private `.env`. Use the actual DB user/password, loopback host, port and `DB_NAME=weavonpq_weaving_main`. Preserve your existing SESSION_SECRET and session key. Set COOKIE_SECURE=true for HTTPS and CORS_ORIGIN to the actual HTTPS domain. TRUST_PROXY=loopback applies when Passenger's trusted proxy connects over loopback; otherwise use your provider's trusted proxy address.

Restart through cPanel, visit `/main`, log in with an existing ERP account and check PO/Dispo dropdowns. Keep the host-generated Passenger configuration; do not replace it with another account's paths. The repository .htaccess supplies access restrictions, not account-specific Passenger settings.

## 3. Upload the private baseline

The hosted database was already imported from the September 22 SQL gzip. **Do not import that dump again over populated tables.**

Extract the separately supplied `woven-erp-private-baseline.zip` into `/home/ACCOUNT/private_sync_baseline`. Keep these four files together:

```text
baseline.meta.json
baseline.events.jsonl.gz
baseline.match-signatures.jsonl.gz
reviewed-reassignments.json
```

These files identify previously imported events and retained historical masters. They contain business identifiers and are deliberately excluded from this public repository. They are not a database dump. Do not create a new baseline from current Sheets to bypass a mismatch.

## 4. Configure and validate sync

Copy `sync/config/cpanel-sync.env.example` to `/home/ACCOUNT/private_sync.env`. Set real hosting credentials and:

```dotenv
DB_NAME=weavonpq_weaving_main
SYNC_EXPECTED_DB=weavonpq_weaving_main
DB_HOST=127.0.0.1
SYNC_ENABLED=false
SYNC_EXISTING_ROW_POLICY=apply-edits
SYNC_DATA_DIR=/home/ACCOUNT/private_sync_data
SYNC_BASELINE_FILE=/home/ACCOUNT/private_sync_baseline/baseline.meta.json
SYNC_REVIEWED_REASSIGNMENTS=/home/ACCOUNT/private_sync_baseline/reviewed-reassignments.json
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=/home/ACCOUNT/private_keys/google-service-account.json
```

Grant the Google service account Viewer access to the nine configured tabs. Alternatively, use SYNC_GOOGLE_MODE=public-csv when their exports are public. The worker only reads Google Sheets. Restrict private configuration/key files to your hosting account.

After preparing the installation's applicable private policy, run the read-only readiness check from the clone. Its `schedulerEnabled=false` field means the checker did not activate a scheduler; inspect the installed environment and crontab for real state.

```sh
node sync/scripts/sync/check_cpanel.js --env=/home/ACCOUNT/private_sync.env
```

Only for a new, uninitialized ledger whose approved imported baseline has been verified:

```sh
node sync/scripts/sync/run.js --env=/home/ACCOUNT/private_sync.env --initialize
```

For an initialized installation, skip initialization. Use mode-appropriate source qualification: v2 manual mode needs its already certified, frozen source cycle; v3 recurring mode derives a new exact exception for each fresh snapshot. See [the existing-host runbook](CPANEL_OPERATIONS.md). Ordinary recurring checks are:

```sh
node sync/scripts/sync/run.js --env=/home/ACCOUNT/private_sync.env --plan
node sync/scripts/sync/run.js --env=/home/ACCOUNT/private_sync.env --dry-run
```

Initialization is **once only** for an uninitialized ledger. It checks the business tables against the imported SQL baseline before creating tracking tables. If ERP data changed after import, initialization stops: reconcile those changes; never erase or overwrite newer data to force a match. If already initialized, skip initialization. Earlier prototype installations need `--upgrade-matching` once for the expanded receipt/issue signatures.

The DB account needs business/tracking table access and permission to create/alter tracking tables. The worker needs mysqldump (or SYNC_MYSQLDUMP pointing to it) and private writable disk space for snapshots and backups.

## 5. Apply one verified cycle

For a qualified v2 manual catch-up, follow the frozen plan/preimage, historical review, fresh backup and supervisor procedure in [CPANEL_OPERATIONS.md](CPANEL_OPERATIONS.md). An old job's database/source bindings are not portable. Manual completion alone does not authorize cron activation.

For a separately authorized v3 recurring rollout, stage with `SYNC_ENABLED=false`, a pinned immutable reviewed base, no fixed `SYNC_END_DATE` and no persisted per-cycle `SYNC_MANUAL_SKIPS_*` values. After the fresh source plan/full dry pass and the restart is authorized, set the private switch to true and update only its approved protected-manifest entry. Test the same installed wrapper that cron will invoke:

```sh
/bin/bash /home/ACCOUNT/private_sync/run-hosted-sync.sh
```

Confirm `private_sync_data/status.json` says completed or unchanged. Check cycle reports and ERP dropdowns. A database connection or registered cron entry alone is not proof that data refreshed.

## 6. Schedule every ten minutes

In cPanel Cron Jobs, set minute `*/10` and all other fields to `*`. The reviewed private wrapper must activate the correct Node PATH, target the correct private sync root/environment and retain the checksum/account-quota/flock checks:

```sh
/bin/bash /home/ACCOUNT/private_sync/run-hosted-sync.sh
```

SYNC_INTERVAL_MINUTES documents the intended interval; it does not install cron. File and MySQL advisory locks prevent overlap. Large catch-ups can exceed ten minutes and overlapping starts skip. Exit zero can mean an interval was skipped; verify a newly completed/unchanged cycle and actual source/ledger/mapped evidence. Do not substitute a raw Node cron command that omits the installed wrapper's integrity/account-quota checks.

Source removals never mirror into business deletion. Ambiguous removals/identity changes still stop for review unless an applicable qualified history-retention policy handles that exact case. Fingerprint-bound `retain-missing` reviews preserve existing rows without excluding current source; reappearing groups resume normal matching. Sheet edits replace mapped fields of tracked records, so coordinate manual ERP edits to those fields.

Disable the cron entry or set SYNC_ENABLED=false to pause future writes; let an active transaction finish. If pending.json exists, the next run resumes that exact snapshot. Do not delete pending evidence to bypass an error. The latest two complete backups and two source cycles are retained independently by default, including after failed cycles; current/pending recovery evidence is protected. Logs rotate at 5 MiB with three archived segments. Do not append cron output to an unbounded file; managed logs are in private_sync_data/logs/sync.log. Keep cron startup/failure notifications enabled.

## Updating

Follow the staged deployment procedure in [CPANEL_OPERATIONS.md](CPANEL_OPERATIONS.md): inspect active/pending work, preserve exact old hashes/config/cron and restore evidence, install only selected reviewed files into the correct app or private sync root, and update only their authorized checksum pins. Comments change hashes too. Install dependencies only when required by reviewed lockfile changes. Restart Passenger only for an authorized app change; a sync update need not touch ERP files. Do not reinitialize, repeat a completed migration or regenerate policy/data pins. Verify the actual next cycle, coverage and relevant app smoke checks. A Git merge by itself changes none of the hosted files.

Official references: [Node application setup](https://docs.cpanel.net/knowledge-base/web-services/how-to-install-a-node.js-application/), [Cron Jobs](https://docs.cpanel.net/cpanel/advanced/cron-jobs/), [Git deployment](https://docs.cpanel.net/knowledge-base/web-services/guide-to-git-deployment/).

## Required storage check before cron

Do not upload local_data/sync_preview. Read [SYNC_STORAGE.md](SYNC_STORAGE.md). Defaults allocate a 4 GiB runtime budget with 1 GiB start headroom and a 2 GiB filesystem free reserve. Check the hosting account quota in cPanel Disk Usage separately. check_cpanel.js reports database allocation and filesystem space but cannot certify account quota. Confirm a hosted dry run and manual apply fit before enabling cron.

## Yarn corrections and partial sync

See [Yarn identity and partial sync](SYNC_YARN.md) for prefix-preserving yarn matching, legacy identity backfill, and the opt-in policy for skipping unresolved Dispos while syncing independent changes. Keep fingerprint-bound exclusion files outside the public web directory and out of Git.
