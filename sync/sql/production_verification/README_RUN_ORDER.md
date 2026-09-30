# Production verification SQL run order

Select `weavonpq_weaving` in phpMyAdmin before every import/query.

## Before migration

1. `00A_apply_required_v3_audit_schema_patch.sql` — modifies only the audit-governance table; run once.
2. `00_pre_migration_schema_and_empty_check.sql` — read-only; all required objects/columns must pass and migration tables must be empty.
3. Stop the ERP and keep it stopped.
4. `00B_capture_users_sessions_baseline.sql` — creates a verification-only fingerprint of protected users/sessions/user_privileges.

## Before running post-migration formula SQL

Open `05_post_import_formula_and_lookup_checks.sql`, `08_final_gate_summary.sql`, and the combined `RUN_ALL_POST_MIGRATION_VERIFICATION.sql`. Replace both `UNRESOLVED` unit values with exactly the approved importer values: `meters` or `yards`. Do not use aliases such as `metre`, `mtr`, or `yds` in the runtime environment.

## After first migration

1. `RUN_ALL_POST_MIGRATION_VERIFICATION.sql` — combined read-only checks 01–08.
2. `08A_compare_users_sessions_to_baseline.sql` — all three rows must be PASS before restarting ERP.
3. `09_create_first_run_idempotency_snapshot.sql` — fingerprints all imported parent/child tables.

Export all result grids before continuing.

## After the identical second migration

1. `10_compare_after_second_identical_import.sql` — every imported table must be PASS.
2. Run `RUN_ALL_POST_MIGRATION_VERIFICATION.sql` again — all mandatory failure counts must remain zero.

## Optional cleanup

Run `11_cleanup_optional_verification_snapshot.sql` only after all evidence has been exported and accepted.

## Interpretation

- A result grid that is expected to be empty must contain zero rows.
- A `failure_count` or `orphan_count` must be `0`.
- A result column must be `PASS` where provided.
- SQL checks validate target integrity and formulas. They do not prove source completeness without the approved `source-manifest.json` and each profile's `reconciliation.json`.

## CLI report gates not provable by SQL alone

For every dry/live profile run, submit `status.json`, `summary.json`, `validation.json`, `lookup_misses.csv`, `rejected_rows.csv`, `reconciliation.json`, and `fk_dependency_report.json`. Required/business-critical lookup misses and source-index formula misses must be zero. SQL checks cannot prove source-file completeness without the approved `source-manifest.json`.
