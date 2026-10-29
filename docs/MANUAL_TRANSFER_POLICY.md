# Qualified manual transfer policy

See [CPANEL_OPERATIONS.md](CPANEL_OPERATIONS.md) for the complete migration, scheduler, deployment, quota and recovery procedure, and [the source change record](CPANEL_CHANGELOG_2026-10.md) for implementation/verification history. This specification grants no live execution authority by itself.

The owner-authorized manual mode replaces the former fixed 42 holds and 14 overlapping exclusions with an empty active hold/exclusion set and one exact private exception. Removing restrictions never deletes business records.

The original eight conflict findings overlap: six current source records are skipped. They remain unresolved. The worker preserves the qualified existing state, including absence when an old event has never existed in the target. It does not choose a quantity, reassign an ambiguous identity or reset tracking to bypass a conflict.

## Required evidence

- Use `version: 2`, `mode: manual-exact-skips` in the private hosted policy, with `manualOnly: true` and `automaticRestartAuthorized: false`.
- Pin the private exception file by SHA256 and bind it to the exact database, server identity, frozen cycle, source manifest and inclusive business-date window.
- Qualify each skipped source UID, digest, group, row and date; verify retained ledger/physical rows and absent prior events. Rebind new snapshots explicitly rather than carrying old snapshot UIDs forward.
- Keep the original hold/exclusion registers archived. Neither the registers nor the operational exception file belongs in Git.
- Use `SYNC_CONFLICT_POLICY=block` with an empty broad-exclusion file. Unrelated source entries sharing a Dispo or lot remain eligible. Unknown conflicts still block.

## Receipt dependencies

For each affected lot, independently qualify the complete frozen source receipt total, skipped source contribution and retained database contribution. The effective dependency total is:

`source total - skipped contribution + qualified retained contribution`

The source total must still match the frozen evidence when mapping runs. Apply only the qualified lot adjustments. Never assume a target contains the disposable copy's old rows or that its adjustment is zero. Dry capture and live/post-verification use the same totals.

## Execution and verification

Require a full database-backed dry run, exact business preimages, historical-preservation review, verified restorable backup and the database advisory lock. Apply only an explicitly resumed certified cycle; retain normal provenance, duplicate, date-window, capacity, transaction, child-preservation, history and mapped-value checks. The advisory-lock connection has a heartbeat during long preparation and import phases.

After apply, independently verify source coverage, ledger and physical mapped targets, preserved history, skipped/absent events and a zero-change replay. A successful plan or worker exit alone is not complete reconciliation.

**A manual rollout stays paused until a separate explicit owner restart instruction.** Templates default to disabled. A supervised manual launch does not authorize cron restoration or future automatic cycles. An installation later authorized for recurring mode can enable its scheduler under the v3 requirements below; inspect its actual environment/cron rather than reading this manual-mode rule as live status.

Legacy policies retain their original guards until an explicitly qualified migration; the new mode is not a general protection bypass or approval for unrelated historical changes.

## Explicitly authorized recurring synchronization

After a verified manual transfer and a separate owner restart instruction, a version-3 `scheduled-exact-skips` policy can authorize ten-minute scheduling. It must explicitly grant automatic restart, pin the immutable reviewed manual exception by SHA256, keep zero broad holds/exclusions and retain the production database/start boundary. `SYNC_ENABLED` remains a separate scheduler switch; templates do not enable writes.

Each fresh certified snapshot must contain exactly the same six business fingerprints, groups, dates and duplicate multiplicities. Rebind their current source UIDs and rows without selecting additional records. Missing, changed or additional identical records require review. Preserve all retained ledger/physical preimages and verify qualified physical absences before and after apply. Recalculate each affected lot from its complete new source total minus the unchanged skipped contribution plus the qualified retained contribution. Legitimate new receipts stay eligible.

An explicitly qualified receipt anchor may use the existing exact signature excluding only the cumulative `Last Received Date`. Pin that signature and field name in the private base. Quantities, receipt date, identity and every other business field must still match, including exact duplicate multiplicity. Bind the resulting exception to each new snapshot's full digest; do not apply this allowance to another column or to issues.

Leave the end date unset so the worker uses the current Asia/Dhaka date. Persist an immutable cycle-specific qualification and reuse it, including its original cutoff, during recovery. Keep the normal full dry run, pre-apply backup, per-row transactions/history and mapped-value verification. Scheduler/file and database locks prevent overlapping writers; new unknown conflicts block the cycle. Archive completed migration evidence outside the active scheduler retention directory.
