# Bounded storage for scheduled Sheets sync

Do not upload `local_data/sync_preview`, local SQL dumps, local credentials or
Windows `node_modules` to cPanel. Install the ERP/sync source and the separate
private baseline bundle outside `public_html`. The hosted database must match
the baseline before first initialization; ordinary updates never reinitialize it.

## Default runtime settings

| Private sync environment setting | Default | Meaning |
| --- | ---: | --- |
| `SYNC_KEEP_CYCLES` | 2 | Latest source/working cycles retained |
| `SYNC_KEEP_BACKUPS` | 2 | Latest complete pre-write SQL gzip backups retained independently |
| `SYNC_MAX_DATA_MB` | 4096 | Budget for all files beneath `SYNC_DATA_DIR` |
| `SYNC_RUN_RESERVE_MB` | 1024 | Additional budget/free-space headroom required before starting |
| `SYNC_MIN_FREE_MB` | 2048 | Filesystem free space reserved during processing |
| `SYNC_LOG_MAX_MB` | 5 | Maximum size of each managed log segment |
| `SYNC_LOG_KEEP` | 3 | Rotated segments in addition to the current segment |

MB settings use MiB (1,048,576 bytes). The default runtime budget is 4 GiB.
Current/pending cycles, their recovery backups and durable verification evidence
take priority over retention counts. If protected data cannot fit, the worker
fails visibly instead of deleting recovery evidence. The newest two complete
backups remain protected even when polls report no changes.

These are template defaults, not a claim about an installed account's allowance or current settings. A measured, explicitly approved constrained deployment may retain one active cycle/two backups. Do not impose that tuning on other hosts or reduce retention as a side effect of a source update. See [the cPanel operations runbook](CPANEL_OPERATIONS.md).

Cleanup runs under the MySQL advisory lock before work and in finalization,
including source conflicts, validation failures and explicit dry runs. It removes
only recognized cycle directories, expired backup files and old scheduler logs;
it refuses symbolic links/junctions. Interrupted partial dumps are never accepted
as complete backups. Unknown files count toward the budget but are not deleted.

Status can name a newly failed cycle. With low retention, the previous successful source snapshot may then be retired. Put permanent source/plan/preimage/backup-restore/verification custody outside the actively pruned directory; current/pending protection is not an indefinite archive of every successful run.

The public `scripts/sync/run.js` launches `worker.js` under a separate supervisor.
The supervisor samples folder usage and filesystem free space every second even
while the worker performs synchronous processing. Exceeding either threshold
stops that worker and its process tree. Committed logical rows stay committed;
in-flight transactions roll back when their connection closes. A live cycle's
`pending.json`, immutable plan and source files remain for exact replay.
Do not call `worker.js` directly.

These are sampled application limits, not an operating-system disk quota: a
short burst can exceed the threshold between samples. Filesystem free space also
does not necessarily reflect a shared-hosting account quota. Check cPanel Disk
Usage separately, including MySQL, mail, application files and hosting backups.
Do not enable cron if those existing allocations plus the runtime budget and
headroom exceed the account allowance. Reduce retention/budget only after a
measured full dry run and apply fit; do not lower the recovery reserve blindly.

## Commands and logs

Use Node 18.15 or newer (the ERP deployment guide recommends Node 22+).
Run `check_cpanel.js` before activation. Its output includes database allocation,
sync bytes, filesystem free space and a reminder that account quota is unverified.

One-time maintenance, using the same environment and lock as the worker:

```sh
node sync/scripts/sync/run.js --env=/home/ACCOUNT/private_sync.env --maintenance
```

For the local workspace add `--local` and use its private local environment file.
Maintenance can run with `SYNC_ENABLED=false` and never changes business rows.

For a protected existing cPanel installation, cron should invoke its reviewed private wrapper (every ten minutes):

```sh
/bin/bash /home/ACCOUNT/private_sync/run-hosted-sync.sh
```

The wrapper adds protected-manifest/account-quota/flock checks before the supervised Node worker. Adapt only the approved private installation paths; a raw Node cron entry omits those checks. Do not append `>> private_sync_cron.log`: the worker owns rotated logs at
`SYNC_DATA_DIR/logs/sync.log`. Keep cron email/error notifications enabled for
startup errors that occur before the worker owns the database lock. Cycle worker
logs rotate too. The Windows launcher also delegates logging to Node.

Wrapper integrity/quota failures occur before its `SYNC_START` event. A successful exit can also mean overlap was skipped. Correlate wrapper events with a newly completed/unchanged cycle, the actual data directory and any independent coverage proof.

Account-quota reports can remain cached after an approved cleanup. Check exact reclaimed paths/bytes and the account report before deleting more. An own-account vendor cache refresh changes reporting, not quota limits; do not lower reserves or run server-wide quota rebuilds. A cleanup script may retire files and then fail its later quota check, so inspect its durable cleanup report before retrying.

Inspect `status.json`, `storage-report.json` (sampled peak), `cleanup-report.json`,
`last-pruned.json` and `conflict-review.json`. Old reports may describe earlier
runs; use their timestamps/cycle IDs. Conflicts block writes without bypassing
cleanup. A ten-minute schedule is polling, not a ten-minute completion guarantee.

## Deployment boundary

The storage regression suite is `node tests/sync_storage.test.js` (under `sync/`
in the combined ERP repository). It checks repeated failures, protected pending
data/backups, capacity rejection, log rotation, link refusal and supervised
termination. Local measurements do not certify cPanel CPU, memory, quota or
cron execution. Perform one hosted plan, full dry run and successful manual
cycle before enabling cron. Source updates are one-way Sheets to MySQL;
ambiguous identity changes still require explicit review.

## Source date formatting

Use ISO `yyyy-mm-dd` or explicit month names (for example `2-Oct-2026`) in source date columns. Public CSV text such as `10/2/2026` is ambiguous; this importer uses its documented DMY convention. Changing a source date representation can therefore reveal an identity correction requiring exact review. The storage fix does not guess a new locale or silently reinterpret historical dates.
