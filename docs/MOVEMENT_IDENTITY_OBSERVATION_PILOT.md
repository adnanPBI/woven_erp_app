# Yarn movement identity observation pilot

This pilot observes Yarn Receive and Yarn Issue using the existing hosted sync. It adds metadata after a terminal, certified worker cycle. The existing importer remains responsible for every business change.

The deployed scope is a fixed, qualified watchlist of 100 movements from each Yarn profile. This is a bounded pilot, not a claim that every historical source row has a movement UUID.

## Operating boundary

- Only `observe` mode is available. Both source UID backfill and UID business writes must be explicitly false in the pinned configuration.
- No source column is created or populated. All production movement bindings remain provisional.
- A UUID identifies a movement; it cannot authorize changed quantities, Dispos, lots, counts, dates or challans.
- Missing, duplicate, copied or ambiguous identities produce review findings. The observer cannot reassign business records or suppress worker failures.
- A source-only plan bridge does not authorize creating a full Dispo, PO or SQL plan record.
- The current cron interval, business writer locks, protection manifest, historical retention and exact reviewed exclusions remain in force.

## Components

`sync/lib/sync_movement_identity.js` defines deterministic provisional UUIDs, exact quantity arithmetic, component identities and approval-bound revision/lineage qualification. Its fingerprint facade excludes the UID metadata column. The legacy production importer has not been migrated to consume that column; do not add it to source tabs as part of observation.

`sync/lib/sync_movement_shadow.js` qualifies source fingerprints against the ledger, original provenance and physical parent/child records. Source row position is never an identity. The watchlist stays fixed so a missing movement cannot silently disappear from pilot coverage.

`sync/lib/sync_movement_registry.js` writes only three additive metadata tables: `sync_movement_identity`, `sync_movement_revision` and `sync_movement_lineage`. It preserves physical bindings, rejects collisions and makes an unchanged observation a metadata no-op. Observed revisions are audit observations, not authenticated business approvals.

`sync/scripts/sync/movement_pilot_hook.js` starts an isolated, bounded observer after the worker releases its database connection. It uses a pinned configuration and never changes the worker's result. The observer has its own MySQL advisory lock. Failure evidence is separate from business sync status; a certified failed source can be inspected only when explicitly configured.

## Acceptance and continuity

Retain the original source/SQL backup, full restored QA database, immutable QA apply evidence, independent physical-record checks and actual identical-source replay results. Archive accepted production inputs before releasing the acceptance lock because normal runtime retention can prune cycle directories quickly.

The pilot's independent registry check compares all 22 mapped business-table measurements before and after observation, verifies original SQL/provenance bindings, and runs an actual identical-metadata replay. The separate business acceptance path requires normal autonomous cron success, independent SQL readbacks and an actual identical-source importer replay with zero additional business writes.

New failures must be investigated from their exact source and SQL evidence. Do not clear history, reset counters, regenerate identities blindly or reuse a grant for another movement. Keep the existing hosting reserve; retain QA and backups unless the owner explicitly authorizes cleanup.

## Future source UID migration

Live UID backfill and enforcement are deferred by the owner. Before enabling either, establish source write permission, a coordinated editing/sorting pause, protected-column behavior, coherent readback, crash-safe pending states, and tests for all affected formulas and column consumers. An API or script write must not depend on an edit trigger firing.

Any future split or merge needs an exact authenticated lineage decision and conserved quantities. For a split of 50 kg into 30 and 20 kg, the original UUID and SQL record remain attached to one active allocation; the historical 50 kg revision must not be counted as another active quantity.

## Repository publication and dated deployment

The observed hosted pilot passed acceptance on November 11, with November 12 observation again qualifying 200 movements and no held findings. These are dated production receipts retained privately; they do not certify a later live cycle. This publication adds the reusable source and synthetic tests; it does not deploy, bootstrap metadata tables, populate source UID cells or enable business enforcement.

The hook is disabled unless `SYNC_MOVEMENT_PILOT_MODE=observe`, `SYNC_MOVEMENT_PILOT_CONFIG` and its exact `SYNC_MOVEMENT_PILOT_CONFIG_SHA256` are configured privately. The version1 configuration requires `mode: observe`, `sourceUidBackfillEnabled: false`, `businessWritesEnabled: false`, an absolute private `evidenceDir`, a bounded `maxPerProfile`, dates, and a privately qualified fixed `legacyUids` watchlist. Do not check in that record-bound configuration. Metadata schema provisioning is an explicit reviewed operator action through the registry module; it never runs automatically on application startup.

The registered UUID is provisional until a separately authorized source write/readback migration verifies its binding. The legacy importer does not consume `__MOVEMENT_UID`; the identity helper's metadata-aware fingerprint facade is not a deployed migration of every existing fingerprint consumer. Split/merge helpers qualify plans only and cannot execute business mutations. A Yarn-only pilot does not resolve identity changes in other production modules.

Future enforcement should reduce ambiguity caused by editable business keys, but it cannot correct wrong quantities, formulas, missing history, source authorization failures, network outages or hosting capacity. Duplicate/copied UIDs remain conflicts. Establish source write access, safe edit/sort handling, cross-system crash recovery, existing form/report/formula compatibility, restored-database QA, independent SQL, autonomous cron and actual zero-write replay before expanding scope or enabling enforcement.
