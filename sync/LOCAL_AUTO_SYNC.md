# Local automatic Google Sheets sync

Target: `127.0.0.1 / weavonpq_weaving_sep22_preview`. The worker refuses other local database names. The original `weavonpq_weaving_local` and cPanel database are not targets of this task.

The Windows task is named **Weaving ERP - Local Google Sheets Sync**. It runs every ten minutes while the installing Windows user is signed in. The PC must be awake, and Windows and XAMPP MySQL must be running, and Google Sheets must be reachable. It runs hidden, needs no stored Windows password, and persists across restarts. Missed starts run when available. Task Scheduler and a MySQL advisory lock prevent overlapping workers.

Installation, after a successful manual cycle:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync/install_local_schedule.ps1 -StartNow
```

Inspect the task:

```powershell
Get-ScheduledTask -TaskName 'Weaving ERP - Local Google Sheets Sync'
Get-ScheduledTaskInfo -TaskName 'Weaving ERP - Local Google Sheets Sync'
Get-Content local_data/sync_preview/status.json
```

Scheduler logs are in `local_data/sync_preview/scheduler_logs/`, grouped by day. Each cycle has its own source snapshots, plan and import reports. The latest six cycle directories are retained. Pre-write SQL backups are stored separately in `local_data/sync_preview/backups`; the latest six backups are retained independently, so unchanged polling cycles do not remove the last backup. A failed cycle does not mean the schedule is disabled. Inspect the error and report; ambiguous identities block applying that snapshot. The scheduled worker will retry at a later interval. Do not confuse a registered task with a successful data refresh.

Pause future starts:

```powershell
Disable-ScheduledTask -TaskName 'Weaving ERP - Local Google Sheets Sync'
```

Resume future starts:

```powershell
Enable-ScheduledTask -TaskName 'Weaving ERP - Local Google Sheets Sync'
```

Disabling the task does not interrupt a currently running transaction. Let a running cycle finish. A `pending.json` file records an interrupted live cycle; the next worker invocation resumes its exact snapshot and checkpoints rather than fetching a different snapshot. Do not delete it to bypass an error.

The private worker configuration is `local_data/sync_package/local.env.sync`. Keep credentials private. Set `SYNC_ENABLED=false` to refuse new applying runs. Read-only `--plan` and `--dry-run` remain available.

This schedule updates MySQL. To display those updates, a locally running ERP must use the same preview database. The shipped ERP `.env.example` is for configuring an application; it does not itself start an ERP server.

For the hosted database and cPanel cron, use `ERP_SYNC_DEPLOYMENT.md`. Installing this Windows task does not install or enable a cPanel job.

Verification on September30: scheduled write cycle completed with zero rejections; all 19,243 planned ledger operations matched; all 22 retained-row table comparisons passed. A subsequent timer-triggered cycle exited 0 with no inserts or edits. See `local_data/sync_preview/verification/` and `schedule-verification.json` for evidence.
