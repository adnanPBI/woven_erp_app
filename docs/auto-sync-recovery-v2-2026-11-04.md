# Weaving ERP: Auto-Sync Recovery v2 (2026-11-04)

## Deployment and purpose
This release extends the existing 10-minute cron-based Google Sheets-to-MySQL
worker. It does not replace the importer or weaken exact source reviews,
protected history, the MySQL advisory lock, the cPanel flock, protected
manifest, current backup requirements or production SQL preimages.

Missed 10-minute intervals are not individually replayed. The next available
scheduled run fetches a complete Google Sheets snapshot and reconciles business
identities and fingerprints against MySQL, applying only approved differences.
Ambiguous identities remain blocked for review. No second writer is introduced.

## New safeguards
1. The private recovery checkpoint at SYNC_DATA_DIR/recovery-v2.json advances
   only after a zero-change certified plan or a conflict-free, guarded SQL
   apply with completed post-apply business verification. A plan-only or
   dry-run invocation never advances the checkpoint.
2. The initial checkpoint can use prior worker status only when its frozen
   cycle, manifest and plan exist. A prior SQL apply also requires matching
   business-verification.json. Otherwise checkpoint stays unknown.
3. A gap of over two intervals or a prior failure triggers catch-up reporting,
   including estimated missed intervals and last verified success.
4. Source fetching gets at most two bounded additional attempts for transient
   network, HTTP 429 or HTTP 5xx errors (4s then 12s backoff). No automatic
   retry for permissions, missing sheets, identity drift or SQL failures.
5. After SQL interruption, the existing pending.json locks the exact source,
   plan and backup for guarded resume. Blind upserts/replays remain forbidden.
6. Cron quota/integrity preflight failures are separately classified.
7. The authenticated Sync History window displays last verified success,
   current recovery phase, missed intervals, retry count and failure category
   without exposing credentials, business records or source file paths.

## Operational verification
From the production host, under the existing account:

    cd /home/weavonpq/sheets_live_sync_20261011
    sha256sum -c protection.sha256
    ./run-hosted-sync.sh --check
    crontab -l
    node scripts/sync/recovery_status.js --env=/home/weavonpq/sheets_live_sync_20261011/.env.sync
    tail -n 20 scheduler.log

The recovery checkpoint is evidence of a completed cycle only. Continue to
verify sheets_sync_events, erp_sync_row_changes and actual business row values
for production acceptance.

## Failure handling
- running: a worker is processing and the checkpoint has not advanced yet.
- verified: frozen source/plan verification succeeded.
- failed: a failure is logged with its classified category.
- pendingFrozenPlan: a frozen transaction may require authorized recovery.
- lastRecovery.hadBacklog: a missed interval or interruption was reconciled.

## Rollback, confidentiality and limits
Back up exact deployed files and the integrity manifest before deployment.
Install and pin the new release under the existing scheduler lock; use a single
targeted rollback if verification fails. Never commit .env.sync, private
exact-skip/rebind approvals, source manifests, snapshots, dumps or SQL audits
to the public GitHub repo.

A latest-state snapshot cannot reconstruct intermediate Sheets edits that
were made and removed during an outage. That requires a separate append-only
source revision journal. Offline browser submissions require a separate
client-side authenticated queue; this release does not capture offline edits
from disconnected browsers.
