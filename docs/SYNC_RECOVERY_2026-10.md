# October sync fixes and hosted rollout

The October 25 fixes were verified against the local preview database. Publishing them does not deploy cPanel or establish that the hosted database and cron are healthy.

## Challan entries are audit records

Keep separate source entries when one challan has multiple amounts for the same full Dispo number and date, even with an identical NH/YT/SW/SC prefix/index. Do not sum the rows, deduplicate them by those references, or select only the last amount. This applies to receipts, issues and deliveries.

The published normalization policy is `preserve_separate_challan_entries`. Distinct supplied yarn amounts can produce separate inserts; subsequent edits reuse the corresponding source/provenance binding. If multiple entries change at once and their identities cannot be proved, qualification stops for review. Indistinguishable duplicate copies also stop for review instead of silently discarding or inserting them. An edit of one tracked entry is different from several simultaneously present entries.

The older latest-revision selector remains an explicit legacy recovery utility. It is not the publication default. Do not re-enable it to bypass a multi-entry conflict. Historical consolidations or neutralized rows need a separately qualified migration; this source update does not reverse past database transactions.

## Included fixes

- Source/ledger/business preimages, transactional audit, exact decimal rounding, nondeleting child reconciliation and independent mapped-value verification.
- Separate delivery payloads and yarn amounts under shared references; provenance IDs for resumed inserts and edits; correct clearing of the opposite issue direction.
- Dry qualification rejects overlapping absent targets and values too long for actual live database columns.
- Refreshes already matching the source re-read and verify their targets without repeating business writes. Shared-lot receipt changes refresh dependent issues across Dispos.
- Existing costing masters are preserved. Free-text PO document status is retained in notes rather than forced into an approval ENUM.
- Folding fingerprints ignore only the unmapped `Search Column` / `#REF!` helper. Real business fields remain fingerprinted.
- The fetched hosted database console, history capture, export retries, GC support, certified-cycle resume, quota/flock wrapper, and mandatory protection gates remain present.

## Existing cPanel installation

Follow [the protected hosted baseline](CRITICAL_CPANEL_BASELINE.md). Keep its existing private root, cron wrapper, schedule, private environment, protection policy, fingerprints, 42 holds and 14 exclusions. Local approvals, local absence of holds, and local database fixes do not approve hosted corrections.

1. Inspect the actual hosting status and pending cycle. Preserve its backup/source/plan evidence. Complete or explicitly reconcile a pending import using its matching code/policy before switching normalization rules; do not reset its ledger or replay the original migration.
2. Back up the hosted application, database and tracking metadata. Stage this source in the private sync root. Do not deploy local `node_modules`, credentials, runtime directories, source snapshots, review files or local metadata-transition scripts.
3. Review the private environment. The verified production path requires `SYNC_VERIFIED_WRITES=true` and `SYNC_START_DATE=2026-09-21`. The mandatory hosted protection policy uses `SYNC_CONFLICT_POLICY=skip-dispos`. Keep `SYNC_ENABLED=false` while staging a controlled rollout. Retain source-missing history only through the existing approved policy; this update does not grant new correction approvals.
4. Audit live column types against mapped source values. The preview needed `dispo_form_data.po_qty_yds` widened from VARCHAR(10) to VARCHAR(64), and `greige_delivery_form.yarn_type` and `warping_form.yarn_type` widened from VARCHAR(30) to VARCHAR(255). Inspect hosted definitions, defaults, collation, indexes and permissions before any targeted DDL. These local changes are not applied by Git.
5. Qualify the folding fingerprint transition from the hosted ledger's own matching certified historical source. Back up exact metadata preimages, preserve unmatched/held entries, and verify under the existing locks. The local transition is not a portable production migration. Review legacy consolidation/supersession evidence before enabling the separate-entry policy on an existing consolidated ledger. Never accept new hashes or regenerate a baseline just to remove a conflict.
6. Update only specifically reviewed source entries in the private `protection.sha256`; retain policy/data entries. Do not regenerate that manifest blindly. Preserve all existing approval and independent-review requirements.
7. On the hosting server run the existing readiness check, exclusion-bound plan and complete database-backed dry run using its private env file. Inspect all holds, mapped targets and storage/quota results. After a verified manual apply, confirm ledger and mapped values, original-row preservation, and same-snapshot replay before resuming the existing wrapper/cron. Observe an actual `SYNC_SUCCESS` and worker completion, not merely a running process or start marker.

`--refresh-window` remains a bounded local recovery option. It is not authorization to perform a hosted full-window rewrite. This publication neither modifies the deployed cron nor restarts Passenger.

## Verification

The follow-up adds two actual MySQL cases (21 total) for distinguishable equal-amount peers and an intervening unbound collision. The peer fixture deliberately mixes legacy table collations. Source identity and exact provenance/ledger evidence govern coexistence; an unknown duplicate remains a blocker.

`npm run check` and `npm test` cover the ERP boundaries, console and mandatory hosted protections plus the planner, yarn identities, exclusions, full dry-run gate and storage supervision. Additional recovery checks run with `npm run test:sync-recovery`.

The optional actual-importer MySQL fixture accepts `SYNC_TEST_ENV=/external/private/test.env`; run `node sync/tests/sync_repair_runtime.mysql.test.js` only on the approved local disposable-fixture server. It creates and removes a uniquely named fixture database, not business rows. Nineteen cases passed during publication, including separate same-direction yarn amounts, separate delivery entries, replay, concurrent edits, drift detection and unchanged-refresh verification. No hosted database or quota verification was performed for this publication.
