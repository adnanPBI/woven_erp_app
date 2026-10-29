# cPanel migration and recurring-sync maintenance

This is the maintenance entry point for an **existing, initialized** installation. Read the [preservation requirements](CRITICAL_CPANEL_BASELINE.md), [policy specification](MANUAL_TRANSFER_POLICY.md) and [source change map](CPANEL_CHANGELOG_2026-10.md) together. Installation instructions are in [CPANEL_DEPLOYMENT.md](CPANEL_DEPLOYMENT.md).

Repository work does not deploy cPanel, change a scheduler or authorize business corrections. Keep existing ERP screens, permissions, sessions, Passenger settings, database/history tools and original business records intact. A successful old migration is evidence for its frozen source snapshot, not for later edits in Sheets.

## 1. Separate the four locations

| Location | Contents | Update rule |
| --- | --- | --- |
| ERP application root | Passenger entry point, API, UI, private app environment | Update only explicitly selected app files; a sync change need not restart Passenger |
| Private sync root | The repository's `sync/` contents, dependencies, wrapper, private policy and checksum manifest | Deploy reviewed sync files here, outside `public_html`; preserve private host configuration |
| Active `SYNC_DATA_DIR` | Scheduled snapshots, certified cycles, status, pending recovery, rotating logs and pre-write backups | Subject to bounded retention; never use as permanent custody for a completed migration |
| Private durable job archive | Restore proof, frozen source/plan/preimages, approvals, historical baselines, completion and replay proof | Separate from active retention; never publish its records or blindly reuse it for another database/snapshot |

The installation can have multiple historical data directories. Inspect the actual private environment used by the **installed cron command**. A dashboard or MCP readiness report using a fixed older directory can truthfully describe an old cycle while missing a newer manual job. Compare database, data directory, cycle, manifest, plan and timestamps before calling evidence current.

Examples below use operator-supplied paths:

```sh
SYNC_ROOT=/home/ACCOUNT/private_sync
ENV_FILE="$SYNC_ROOT/.env.sync"
NODE_BIN=/ABSOLUTE/HOST/NODE/bin/node
```

These assignments do not discover a host or grant write authority. Do not print a full environment or use shell tracing around credentials. Invoke the worker through `scripts/sync/run.js`, not `worker.js` directly.

## 2. Understand policy versions before touching a guard

| Hosted policy | Allowed behavior | Required private evidence |
| --- | --- | --- |
| Legacy policy | Existing dependency-wide protected Dispos/lots remain protected | Original 42 held cases, 14 exclusions, seeds and exclusion-bound plan |
| Version 2, `manual-exact-skips` | One qualified frozen manual window; no automatic restart | Empty broad hold/exclusion sets; exact exception SHA; database/server/source/cycle/window binding; retained or absent target state |
| Version 3, `scheduled-exact-skips` | Separately authorized recurring runs | Explicit automatic grant, ten-minute policy, pinned immutable reviewed base and a new immutable qualification for each source cycle |

The legacy counts remain in code deliberately. Do not remove them globally because another installation migrated to v2/v3. The new modes do not delete business rows or approve arbitrary historical corrections. Eight original findings overlap six current source records; changing these counts is a policy change, not an error-recovery technique.

Three objects have different roles:

1. `protection-policy.json`: hosted authority and permitted mode.
2. Private reviewed exception/base: exact source anchors, original ledger/physical evidence and receipt contributions.
3. `scheduled-exact-skips.json` inside a cycle: the rebound full source digests/UIDs/rows, source manifest, cutoff and dependency totals used by that cycle.

Keep each checksum meaningful. The exception alone is not restart authority. `SYNC_ENABLED=true` alone is not a qualified policy. A file named `approval.json` is not evidence of owner approval.

## 3. Code path and invariants

```text
cron -> private run-hosted-sync.sh
     -> flock + protected-file hashes + cPanel account reserve
     -> run.js storage supervisor
     -> worker.js database advisory lock and heartbeat
     -> fetch/normalize/certify immutable source snapshot
     -> exact skip qualification + retained/absent-state verification
     -> reviewed history + bounded planner + dependency refreshes
     -> hosted protection guard
     -> full database-backed dry capture
     -> pre-write SQL backup + pending evidence
     -> per-row guarded apply + atomic row history
     -> independent mapped-value/costing/skip verification
     -> final completion + pending removal + bounded cleanup
```

An unchanged plan can return before a new dry/apply/backup because there are no business operations. It is not evidence that every held or skipped source row was imported. Verify source coverage separately.

Important implementation details:

- **Lock ownership:** MySQL advisory locks belong to a connection. The ten-second heartbeat uses the owning connection during long source preparation. A heartbeat on another pool connection would not protect that lock. A failed heartbeat terminates the supervised writer.
- **Overlap:** the wrapper's file lock and worker's database lock prevent overlapping work. A skipped overlapping launch can exit zero; require a matching cycle/result before treating it as a successful transfer.
- **Date bounds:** selected operations need valid ISO business dates inside the inclusive plan window. Production retains its original earliest recovery floor but accepts a later explicitly qualified start. Do not restore the old equality check that rejected a narrower window.
- **Source identity:** export UIDs/row positions can change. Recurring qualification matches reviewed business signatures and exact duplicate multiplicities, then freezes full current digests and rows. Never pick a convenient duplicate or use a row number as independent identity evidence.
- **Receipt cumulative date:** only a privately qualified receipt anchor can exclude `Last Received Date` through the existing exact `matchHash`. Quantity, actual receipt date, Dispo, count, lot, challan and every other fingerprinted field still match. Issues do not receive this allowance.
- **Stock dependencies:** for each qualified lot, use `complete source receipt total - skipped contribution + verified retained contribution`. Absence can make the retained contribution zero. Do not assume the disposable rehearsal's retained rows exist in production.
- **Same proof in every phase:** the worker forwards its cycle exception file/hash to the mapper environment. `SourceIndex` checks and applies the adjusted totals after loading the complete receipt source during dry capture, apply and verification.
- **History:** business mutations and `erp_sync_row_changes` records share the same transaction. A rollback removes both. Tables without primary keys record submitted values or complete matching row sets; they do not acquire invented unique row identities.
- **Recurring cutoff:** leave `SYNC_END_DATE` unset in recurring mode so new cycles use the current Asia/Dhaka date. Explicit pending/resume uses its already frozen qualification and original cutoff across midnight.

## 4. Requalify an existing manual catch-up

This procedure describes the controlled workflow; it is not permission to replay an old migration or run an old job-bound controller. The original one-off orchestration/specification contained private database/source/preimage bindings. Its generic mapper, policy, history and storage implementations are versioned here; operational selections remain private.

1. Inspect actual database/server identity, runtime revision, grants, schema, active processes, cron, pending marker, source freshness and account quota. An inaccessible local SSH agent is not proof that the key is invalid. Unlock encrypted keys locally; never request or log their passphrase. Retain strict host-key verification.
2. Preserve the current database, installed source, private configuration, protected manifest and cron bytes. Stream a consistent SQL dump with the host's dump binary, verify gzip/checksum and restore into a **new isolated database**. Check all table counts and relevant content/fingerprints, including views/DDL context. Do not rewrite INSERT payloads to make a restore pass.
3. Capture and certify a fresh source snapshot in a controlled private preparation job. Inventory the complete source before narrowing the business write window. Never synthesize a new ledger from current Sheets to bypass reconciliation.
4. Requalify each original exception against that exact source and target: profile, UID, digest, group, row, business date, duplicate counts and retained/absent ledger/physical state. Verify required receipt totals. Different targets may have different retained contributions.
5. Capture an independent historical/master/detail baseline. If a mapped operation will revise existing historical rows, review exact selectors, source dates, before/after values and actual column types. Compare database-canonical values; decimal/string formatting and cross-server SQL JSON hashes can differ without a business-value difference. A review bound to a disposable database is not a production review.
6. Require a complete conflict-free database-backed dry run and freeze its plan, business preimages, source manifest, normalization attestation, private policy/reviews/exception hashes and source revision. Record the exact permitted historical revisions separately.
7. Apply through the storage supervisor and verified mapper with an explicit one-job specification and fresh backup. The frozen reviewed preimages must reach `SheetsSyncRuntime(..., {businessPreimages})`; do not silently recapture changed existing rows to make an old approval appear valid. Keep the database lock/heartbeat and normal production/date/provenance/transaction gates.
8. Run verify-only mapping (`{verifyOnly:true}`), costing-master verification and exact skipped-state checks. Independently compare the eligible source multiset with ledger groups/digests, inspect mapped targets, and compare all original historical fingerprints allowing only the explicitly qualified replacements.
9. Preserve a same-snapshot zero-change replay. Label its temporary `planned` status separately from the completed live run; keep live/verify/replay IDs and their durable evidence. Do not replace completed apply counts with the replay's zero counts.

The public worker supports explicit `--resume-host-cycle=...` inside its configured data directory. Prepared local fixtures are not a production shortcut. `--refresh-window` can intentionally recompute the bounded eligible window; it is not the default cron behavior or permission for an unbounded rewrite.

## 5. Configure recurring mode after explicit restart authorization

Keep the environment paused while staging. In addition to existing credentials, baseline and reviewed-history configuration, recurring mode needs:

```dotenv
SYNC_ENABLED=false
SYNC_VERIFIED_WRITES=true
SYNC_START_DATE=2026-09-22
SYNC_CONFLICT_POLICY=block
SYNC_AUTOMATIC_RESTART_AUTHORIZED=true
SYNC_SCHEDULED_SKIPS_BASE_FILE=/home/ACCOUNT/private/reviewed-skips-base.json
SYNC_SCHEDULED_SKIPS_BASE_SHA256=QUALIFIED_BASE_FILE_SHA256
SYNC_DATA_DIR=/home/ACCOUNT/private_active_sync
SYNC_INTERVAL_MINUTES=10
```

Remove persisted `SYNC_END_DATE`, `SYNC_MANUAL_SKIPS_FILE` and `SYNC_MANUAL_SKIPS_SHA256` for **fresh recurring** configuration. The worker derives those exception bindings per cycle. Do not edit the original frozen manual environment or evidence in place. A manual v2 policy must be deliberately migrated to an authorized v3 policy; enabling a switch alone leaves it snapshot-bound.

On the host, use the actual private sync root:

```sh
cd "$SYNC_ROOT"
"$NODE_BIN" scripts/sync/check_cpanel.js --env="$ENV_FILE"
"$NODE_BIN" scripts/sync/run.js --env="$ENV_FILE" --plan
"$NODE_BIN" scripts/sync/run.js --env="$ENV_FILE" --dry-run
```

These capture separate fresh cycles unless an explicitly qualified resume is supplied. Inspect the **latest** full dry run, plan, conflicts and mapped preimages. A later source change can invalidate an earlier success.

Only after the owner-authorized rollout has passed the required checks:

- Set the installed private `SYNC_ENABLED` switch to true, updating only its authorized checksum entry.
- Validate the installed wrapper, selected source/config hashes and account reserve.
- Install exactly one reviewed cron entry; preserve all unrelated cron entries and a preimage of the old crontab.

```cron
*/10 * * * * /bin/bash /home/ACCOUNT/private_sync/run-hosted-sync.sh
```

Use the **protected wrapper**, not a raw Node command that bypasses wrapper integrity/account-quota checks. `SYNC_INTERVAL_MINUTES` documents intent; crontab actually schedules it. Keep cron stderr/email notifications. Early integrity/quota failures occur before `SYNC_START`; an absent new log marker does not prove cron never invoked the command.

An immediate execution of the same wrapper tests that command, but is not proof that cron itself fired. Observe a later scheduled invocation. Check its actual cycle completion or safe no-change result, pending state, and source/ledger/mapped verification. A newly discovered ambiguity must block the cycle; do not widen the six-record exception just to obtain `SYNC_SUCCESS`.

Enabling hosted cron does not enable a Windows/local task. Preserve the requested scheduler boundary and avoid two different environments writing the same target.

## 6. Future source/configuration deployment

1. Read this runbook, identify the authorized scope and pin the intended Git commit. Review the final diff rather than assuming that a new `main` is already hosted.
2. Run `npm run check` and `npm test`. The Linux CI wrapper fixtures use fake quota/worker commands and do not touch cPanel or MySQL. Optional MySQL integration tests belong on explicitly isolated test databases.
3. Inspect the host again. Do not deploy over an active/pending writer. Coordinate the wrapper file lock and database advisory lock; do not terminate an unknown transaction to make room.
4. Back up exact installed file/config/cron preimages. Verify the expected old hashes before replacing only the selected files. `sync/` in Git maps to the private sync root; do not accidentally overlay the ERP application root.
5. Preserve every unrelated `protection.sha256` entry, including private policy, baseline and review bindings. Update only the specifically authorized source/config fingerprints. Comments also change file hashes. Never generate a manifest from whatever happens to be installed to make checks pass.
6. Stage paused, run hosted checks and a fresh full dry qualification, inspect exact target/preimage changes and storage, then perform the separately authorized activation/deployment step. Preserve app hashes when the app is outside the change scope.
7. Verify actual final files, database identity, cron, active/pending state, completion evidence and rollback artifacts. A process launch, API registration or CI success is not proof of hosted reconciliation.

If a remote-command broker reports a storage/network error, the command may already have executed. Inspect durable job markers, status, lock ownership and file hashes before retrying a mutation. A successful clone creation, deployment or activation must not be repeated because its transport response was lost.

For rollback, restore only qualified source/config preimages under the same locks and pins. After any committed business writes, a code rollback does not undo data. Preserve the pending source/plan/history and reconcile exact committed rows; never restore an old full SQL dump over newer live records as a shortcut.

## 7. Capacity and retention

Read [SYNC_STORAGE.md](SYNC_STORAGE.md). There are three separate limits:

| Check | What it measures | What it does not prove |
| --- | --- | --- |
| Runtime budget | Bytes under `SYNC_DATA_DIR`, plus run reserve | Total account allocation |
| Filesystem reserve | Free blocks on the containing filesystem | The account may use those blocks |
| cPanel account quota | Account disk/inode availability, including other allocations | The current source plan is safe |

The installed wrapper requires more than 3,072 MiB remaining and an under-quota result. Do not lower that guard merely because a run is blocked. Full source/certification working cycles can occupy hundreds of MiB even with zero business writes.

Retention runs at startup and finalization, including failed/dry cycles. Pending/current/status cycles and accepted recovery backups win over count/byte settings. A failed **new** status can make the previous success eligible for retirement. Preserve durable last-good source/plan/preimage/verification evidence outside active retention.

Default examples retain two cycles/two backups. A constrained installation may explicitly approve one active cycle/two backups after measurements and metadata archiving; this is not a universal default. Retention changes and deletion of old generated snapshots are an operational scope decision, not an incidental result of editing docs.

For approved cleanup, use the normal maintenance entry point under its advisory lock:

```sh
"$NODE_BIN" scripts/sync/run.js --env="$ENV_FILE" --maintenance
```

It can retire recognized generated cycles/backups according to configuration. Inspect `cleanup-report.json`/`last-pruned.json`, archive the required audit metadata first, and retain all pending evidence. Do not point cleanup at the durable job archive, ERP root, database data directory or a backup merely because it is large.

After deletion, cPanel can temporarily report a cached old quota. Verify the actual removed paths/bytes and the live account report before deleting anything else. Where installed and permitted, the vendor's **own-account** `Cpanel::Quota::reset_cache` can invalidate only that account's cached report; preserve a cache preimage and verify its path/user. This does not change limits or authorize a server-wide quota rebuild. Do not run root-wide `fixquotas` or CloudLinux-wide cache commands as an application fix. If a script cleaned files and then failed its quota check, do not rerun the deletion phase blindly.

## 8. Conflict and recovery decisions

| Symptom | Required distinction / action |
| --- | --- |
| Manifest/policy/hash mismatch | Investigate drift; restore/requalify reviewed bindings, not blanket checksum regeneration |
| Reviewed skip fingerprint/multiplicity changed | Compare exact old/current source; only the explicitly allowed receipt cumulative-date signature is exempted |
| New yarn edit/removal ambiguity | Preserve the existing row; qualify identity with real source/ledger/provenance/business evidence; do not add an automatic seventh skip |
| Old source group absent | Prove full-source absence, original business date and exact ledger preimage; an authorized `retain-missing` review preserves history and excludes no current source row |
| An absent group reappears | Normal matching resumes; the existing review must not hide the reappearing source edit |
| Dry failed / no pending | That attempt made no new business writes; earlier completed runs remain committed |
| Live failed / pending exists | Some logical rows may already be committed; keep the exact source/plan/backup, inspect history and resume through the supervisor |
| `completed` with missing independent proof | Verify source/ledger/mapped/retained state; do not infer complete catch-up from worker status |
| Quota failure after wrapper invocation | No writer may have started; check early stderr, quota cache and cleanup evidence separately from worker status |

An out-of-window historical retention does not approve a within-window identity change. Retentions do not choose quantities, rename a Dispo or mirror a source deletion into MySQL. Do not reset the ledger, relink an ambiguous event or delete business rows to silence a conflict.

## 9. SQL evidence and reporting

Use [the read-only SQL reference](../sync/sql/verify_business_sync_readonly.sql) with the real private live run ID and window. It counts all schema objects, isolates committed business writes by run/table/profile, checks date columns and tests existence of keyed audit targets. It does not fetch Sheets or independently prove source parity.

Keep these metrics separate:

- **Source profile operations:** inserts, updates and derived refreshes. One source row may create parent/child/master rows; a refresh may produce no physical change.
- **Physical audit writes:** `added`/`updated`/`deleted` and `affected_rows` in `erp_sync_row_changes` for an exact run. Audit deletion of replaced details is not automatically a deleted source order.
- **Current table counts:** include historical and later authorized data. Not a count of what one run imported.
- **Mapped targets verified:** independent checked targets, not a unique document count.
- **Source coverage:** eligible source multiset matched against ledger groups/digests after the exact approved exception; report skips and latest available source dates separately.

Database audit timestamps can differ from UTC/Dhaka. Query `NOW()`, `UTC_TIMESTAMP()` and session/system time zones, and use the live run ID rather than guessing a time filter.

Report: "This frozen-window migration committed writes and passed verification; this later dry run made no additional business writes." Do not shorten that to "no business writes" when earlier committed migration data exists. Likewise, keep "cron enabled", "invoked", "completed", "unchanged", "conflict-blocked" and "coverage verified" distinct.

## 10. Handoff for another maintainer

Keep the private journal outside Git with: request/authorization scope; current database/server and installed revision; active env/data/policy mode; cron and local-task boundary; current cycle/live/dry/verify IDs; source/plan/preimage/backup hashes; accepted/rejected outcomes; exact review scope; pending/lock state; quota/retention; durable proof locations and safe resume steps.

Public handoff should contain architecture, generic procedures, source commits, tests and historical aggregate outcomes only. Never publish credentials, service-account keys, private case/UID/Dispo lists, source CSVs, SQL exports, approval selections or runtime evidence bundles.
