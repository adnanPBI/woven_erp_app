# cPanel deployment

The ERP and cron worker share `weavonpq_weaving_main`. Replace ACCOUNT and runtime paths below with your hosting values. No credentials or database dumps are published here.

## 1. Back up and install

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

From the clone:

```sh
node sync/scripts/sync/check_cpanel.js --env=/home/ACCOUNT/private_sync.env
node sync/scripts/sync/run.js --env=/home/ACCOUNT/private_sync.env --initialize
node sync/scripts/sync/run.js --env=/home/ACCOUNT/private_sync.env --plan
node sync/scripts/sync/run.js --env=/home/ACCOUNT/private_sync.env --dry-run
```

Initialization is **once only** for an uninitialized ledger. It checks the business tables against the imported SQL baseline before creating tracking tables. If ERP data changed after import, initialization stops: reconcile those changes; never erase or overwrite newer data to force a match. If already initialized, skip initialization. Earlier prototype installations need `--upgrade-matching` once for the expanded receipt/issue signatures.

The DB account needs business/tracking table access and permission to create/alter tracking tables. The worker needs mysqldump (or SYNC_MYSQLDUMP pointing to it) and private writable disk space for snapshots and backups.

## 5. Apply one verified cycle

Once plan and full dry run pass, set SYNC_ENABLED=true and run:

```sh
node sync/scripts/sync/run.js --env=/home/ACCOUNT/private_sync.env
```

Confirm `private_sync_data/status.json` says completed or unchanged. Check cycle reports and ERP dropdowns. A database connection or registered cron entry alone is not proof that data refreshed.

## 6. Schedule every ten minutes

In cPanel Cron Jobs, set minute `*/10` and all other fields to `*`. Use the actual absolute Node executable path:

```sh
/ABSOLUTE/PATH/TO/node /home/ACCOUNT/woven_erp_app/sync/scripts/sync/run.js --env=/home/ACCOUNT/private_sync.env >> /home/ACCOUNT/private_sync_cron.log 2>&1
```

SYNC_INTERVAL_MINUTES documents the intended interval; it does not install cron. A MySQL advisory lock prevents overlap. Large catch-ups can exceed ten minutes and overlapping starts skip. Verify a scheduled completion and a later unchanged poll.

Source removals retain ERP history. Ambiguous identities stop for review; exact reviewed fingerprints handle confirmed corrections. Sheet edits replace mapped fields of tracked records, so coordinate manual ERP edits to those fields.

Disable the cron entry or set SYNC_ENABLED=false to pause future writes; let an active transaction finish. If pending.json exists, the next run resumes that exact snapshot. Do not delete pending evidence to bypass an error. The latest six backups are retained independently from the latest six source cycles; use hosting backups for longer retention.

## Updating

Back up, pull the new commit, install dependencies if lockfiles changed and restart the app through cPanel. Keep credentials and sync state outside the clone. Do not reinitialize after ordinary code updates. Check the next cron result and ERP login/dropdowns.

Official references: [Node application setup](https://docs.cpanel.net/knowledge-base/web-services/how-to-install-a-node.js-application/), [Cron Jobs](https://docs.cpanel.net/cpanel/advanced/cron-jobs/), [Git deployment](https://docs.cpanel.net/knowledge-base/web-services/guide-to-git-deployment/).
