# Yarn identity and partial sync

Yarn corrections reuse the existing tracked row. Match the full Dispo number, yarn count, warp/weft designation and yarn lot; retain every prefix and leading zero. NHTML, YTML, SWML and SCML are distinct prefixes. Issue direction is derived from Warp/Weft columns, including negative quantities. Receipts have a separate identity because their source has no direction column. Date and challan distinguish separate events. Revised quantities replace old values rather than accumulating them. Ambiguous corrections never create a guessed replacement.

The worker adds nullable `sheets_sync_events.yarn_identity` metadata under its advisory lock. It backfills from exact source fingerprints or legacy signatures that cover all identity fields. Those signatures exclude only Last Received Date for receipts or Delivery Place for issues. Historical snapshots may be supplied with:

```sh
node sync/scripts/sync/run.js --env=/PRIVATE/.env.sync --upgrade-yarn-identities=/PRIVATE/previous-certified-directory
```

Use paths matching the installed layout; add `--local` only for the supported Windows preview database. This command changes tracking metadata only. Do not reinitialize a populated ledger. Yarn updates and refreshes require the original provenance binding, including during database-backed dry runs.

## Skipping unresolved Dispos

The default `SYNC_CONFLICT_POLICY=block` stops before business writes on any unresolved conflict. After authorizing partial sync, set `SYNC_CONFLICT_POLICY=skip-dispos` in the private environment. The worker holds the affected full Dispos and their yarn-lot dependencies, while selecting unrelated verified changes. Shared lot totals can require holding other Dispos as well. If a removed key has no proven replacement, new inserts in that profile are held too; this avoids importing its possible replacement as a duplicate. Schema problems and conflicts without a bounded Dispo still stop the cycle.

For persistent record exclusions, set `SYNC_EXCLUSIONS_FILE` to a private JSON array. Each entry has `profile`, `sourceUid`, `digest`, `dispo`, and optionally `lot` and `reason`. Bind these fields to the existing ledger and verified original record, not a proposed replacement. The worker rejects stale or missing preimages. Excluded records remain unchanged in both business tables and the sync ledger. The exclusion file contains business identifiers and must not be committed.

Every planned cycle writes its skip details into `plan.json` and `SYNC_DATA_DIR/excluded-records-report.json`. A successful partial cycle does not mean skipped records were resolved. Review these reports and remove exclusions only after resolving the source identity. Re-enable the existing ten-minute scheduler after local validation; this setting does not install or alter cron itself. Failed downloads do not apply partial snapshots.

The source transaction still includes the ledger and yarn identity metadata. Existing business duplicates are not deleted or automatically consolidated. Backup, preserved-row, storage and overlap safeguards remain enabled.

## Verification

`npm test` includes planner, yarn identity, scoped exclusions, dry-run gate, HTTP and storage tests. `npm run check` validates key source files. From the sync directory, `npm run test:sync-yarn:mysql` uses connection-scoped temporary tables in the existing isolated local test database. It verifies replacement in the original row, replay without duplicates, transaction rollback and refusal to insert when an update binding is missing. It does not exercise a hosted database.
