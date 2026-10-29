# Project continuity

Read MEMORY.md at session start and update it after meaningful changes and before handoff. Never commit credentials, database exports, Sheet snapshots, private tracking bundles or runtime state. Preserve original/2023 data; do not run production database operations from a local workspace.

Use docs/CPANEL_DEPLOYMENT.md for the supported layout. Run relevant checks with npm run check and npm test. Use isolated local databases for integration tests. Preserve existing ERP modules when updating shared code.

## Critical cPanel preservation instruction

Read `docs/CRITICAL_CPANEL_BASELINE.md` and `docs/CPANEL_OPERATIONS.md` before any change, especially security remediation. Preserve the database/history tools, right-aligned two-row header, protection gates and regression coverage. Do not alter cron or overwrite cPanel as a side effect of repository work. Legacy policies still require their private 42 holds/14 exclusions; explicitly qualified v2/v3 policies have different bindings documented in `docs/MANUAL_TRANSFER_POLICY.md`. Staging retentions are not correction approval. Intentional policy/behavior changes need owner authorization. Updating GitHub alone does not authorize production deployment. Never publish record-bound private operational journals or job artifacts as handoff documentation.
