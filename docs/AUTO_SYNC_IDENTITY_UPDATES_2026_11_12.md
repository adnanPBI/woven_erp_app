# Exact identity preservation and observation-only UID continuity

This source publication follows the reviewed November 10-12 runtime repairs. Existing recurring cron, file/MySQL writer locks, source certification, full dry-run acceptance, SQL backup, transactional before-images/audit, mapped verification and historical safeguards remain mandatory. Publishing this repository changes none of those production settings.

## Exact bindings and audit

`sync/lib/sync_exact_identity_bindings.js` loads only a private SHA-256-pinned version1 configuration. `SYNC_EXACT_IDENTITY_BINDINGS_FILE` and `SYNC_EXACT_IDENTITY_BINDINGS_SHA256` must both be present or both absent. No configuration grants no transition. Files must be regular, non-symlink, at most512KiB, with at most64 records and at most20 optional PO aliases.

Every rekey binds profile, original source UID, old/new fingerprints, group, previous/new Dispo, exact consumed review key and immutable target selectors. Allowed tables are explicit: Dispo, Folding, Warping, Sizing and the reviewed Delivery child path. Selectors retain original numeric IDs or the qualified unique PO/order composite. Required mapped dates/parent relationships, exact original child census and empty destination checks remain enforced. Partial, stale, ambiguous or occupied bindings fail closed. Once committed, normal later edits use ordinary matching rather than an expired initial grant.

`sync_exact_identity_row_history.js` delegates ordinary audit paths to the existing row-history module. An exact qualified composite-key correction reads by the original numeric ID, verifies old/new Dispo and immutable key/parent fields, and records both old/new images and the new row key inside the same business transaction. It never discards the original history.

## Canonical references and costing

An exact `refresh-canonical-reference` review may refresh an unchanged PO source once. Consumed approval fingerprints prevent repeated refresh. Optional private `poReferenceAliases` bind the approved UID/group/review to a full source master and matching PO; slash normalization alone never grants an alias or invents a master.

`sync_exact_costing_reference.js` permits only an independently qualified synthetic-to-real costing transition on an UPDATE. The pinned `SYNC_EXACT_COSTING_REFERENCES_FILE`/`SYNC_EXACT_COSTING_REFERENCES_SHA256` record binds exact source fingerprints, PO, original master, complete referencing peers and an unoccupied destination. The old master remains retained. Absent configuration does not permit a missing-parent insert; it is not a generic upsert exception. Keep the records and SQL preimages private.

## Read-only conflict diagnostics

The planner preserves a known original UID/Dispo/digest for a uniquely unmatched event and a known current row/Dispo/digest for a uniquely unmatched source. Ambiguous groups do not receive invented identities.

The authenticated history JSON uses `lib/sync-conflict-diagnostics.js` to count distinct causes by profile/reason/UID or group. Richer evidence can enrich a durable summary only for the same cycle and exact profile, UID, group and reason. Missing fields stay unavailable; historical files and run outcomes are not rewritten. Optional missing evidence does not disable ordinary history or weaken RBAC.

Public integration uses explicit optional app-environment paths `SYNC_DIAGNOSTICS_ARCHIVE_ROOT`, `SYNC_DIAGNOSTICS_REVIEW_FILE` and `SYNC_DIAGNOSTICS_VERIFICATION_FILE`. Defaults are private files under the configured sync root, and the current data directory is obtained through the existing environment resolver. Private release-specific locations are not embedded in this publication. A current hosted app must be independently compared before deployment; publication does not establish complete app/frontend parity.

## Observation pilot and remaining boundary

The [Yarn movement guide](MOVEMENT_IDENTITY_OBSERVATION_PILOT.md) describes the additive, bounded observer. Immutable Movement UID backfill and business enforcement remain unavailable in the running pilot. Source row positions are not movement identity; UUIDs do not approve business changes. All production movement UUID bindings remain provisional.

## Dated validation

The November 12 owner-authorized repair qualified sixteen distinct identities, preserved their original IDs, event dates/quantities and provenance, and passed a full restored-database QA apply/verification and actual zero-write replay. The original autonomous ten-minute worker then completed all ten profiles with4973 planned operations and9944 mapped targets verified. The cycle audit recorded336 physical inserts,648 updates and zero deletions; the sixteen repaired identities themselves account for34 updates,zero inserts and zero deletions. Independent SQL and actual identical-source production replay passed with zero additional business writes. Final November12 17:52 BDT acceptance reported zero conflicts/failures and no pending SQL. These are historical evidence-bound outcomes, not current live health or proof of every historical field.

Folding child Loom/Folding totals/date/balance are cumulative reference fields. Original event grade quantities and dates were preserved; the four derived fields were independently recalculated from certified full historical source using Decimal arithmetic and the existing approved yards units. Missing Loom history was not invented; negative/null cumulative balances were not clamped.

Verified source/plan/replay and SQL backups were archived privately with per-member hashes and gzip CRC before releasing acceptance locks. A stale cPanel filesystem-quota cache was refreshed through its own-account function; the original3GiB floor, QA retention, five intentional source exclusions and cron interval remained unchanged. There is limited hosting growth headroom. Repository tests use synthetic fixtures; private receipts, selected UIDs/IDs, source snapshots, operational journals, approval rules, integrity pins and SQL dumps are excluded.

Run `npm run check` and `npm test` (including `test:sync-identity`) before publication. Relevant regression suites include exact ID/census/audit refusal, config capacity/hash, consumed reference review, costing preimages, diagnostic attribution, UUID duplication/lineage qualification and enforcement-disabled hook behavior. This commit does not authorize deployment, repeat a completed business repair or enable UID writes.
