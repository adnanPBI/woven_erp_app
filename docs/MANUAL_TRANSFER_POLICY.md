# Qualified manual transfer policy

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

**Automatic synchronization remains off until a separate explicit owner restart instruction.** The deployed scheduler environment stays disabled. A supervised manual launch does not authorize cron restoration or future automatic cycles.

Legacy policies retain their original guards until an explicitly qualified migration; the new mode is not a general protection bypass or approval for unrelated historical changes.
