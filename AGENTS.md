# Project continuity

Read MEMORY.md at session start and update it after meaningful changes and before handoff. Never commit credentials, database exports, Sheet snapshots, private tracking bundles or runtime state. Preserve original/2023 data; do not run production database operations from a local workspace.

Use docs/CPANEL_DEPLOYMENT.md for the supported layout. Run relevant checks with npm run check and npm test. Use isolated local databases for integration tests. Preserve existing ERP modules when updating shared code.
