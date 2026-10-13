# Project continuity

Read MEMORY.md at session start and update it after meaningful changes and before handoff. Never commit credentials, database exports, Sheet snapshots, private tracking bundles or runtime state. Preserve original/2023 data; do not run production database operations from a local workspace.

Use docs/CPANEL_DEPLOYMENT.md for the supported layout. Run relevant checks with npm run check and npm test. Use isolated local databases for integration tests. Preserve existing ERP modules when updating shared code.

## Critical cPanel preservation instruction

Read `docs/CRITICAL_CPANEL_BASELINE.md` before any change, especially security remediation. The owner requires the October 11–13 deployed sync protections, database/history tools and right-aligned two-row header to remain intact. Preserve behavior and regression coverage; do not revert/redesign features, remove protection gates, alter cron or overwrite cPanel as a side effect of repository work. The private 42 holds/14 exclusions remain mandatory; 26 staging retentions are not approval. Intentional changes to protected behavior need explicit owner authorization. Updating GitHub alone does not authorize another production deployment.
