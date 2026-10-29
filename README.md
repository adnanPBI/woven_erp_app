# Woven ERP and Google Sheets sync

For future cPanel changes, start with the [existing-installation operations runbook](docs/CPANEL_OPERATIONS.md), [October source/change record](docs/CPANEL_CHANGELOG_2026-10.md) and [manual/recurring policy specification](docs/MANUAL_TRANSFER_POLICY.md). These describe the authorized v2/v3 paths in addition to the legacy guard. Historical rollout notes are dated evidence, not live scheduler status.

October 25: [verified sync fixes and the separate-entry challan rule](docs/SYNC_RECOVERY_2026-10.md). Existing cPanel installations require the documented schema/ledger review and a verified hosted cycle; pulling this repository is not a deployment or reconciliation approval.

> **CRITICAL — deployed cPanel baseline:** Read [the preservation note](docs/CRITICAL_CPANEL_BASELINE.md) before modifying or deploying this repository. The owner requires the database/history features, right-aligned two-row header and sync protections to remain intact during security fixes. Git publication does not authorize overwriting the live installation.

Node.js/MySQL weaving ERP, including the updated search dropdowns and a separate scheduled Google Sheets importer. The ERP is served under `/main`. The importer adds records and applies edits to tracked records from 2024 onward while preserving retained historical data.

**Start with [the cPanel deployment guide](docs/CPANEL_DEPLOYMENT.md).** Cloning this repository does not import a database, supply credentials or enable cron.

| Location | Purpose |
| --- | --- |
| `app.js`, `server.js` | Passenger startup and ERP API |
| `*_module/`, `main.html`, `public/` | ERP screens and dropdown client |
| `lib/http-boundaries.js` | Public-asset boundaries and API authentication |
| `sync/` | Importer, mappings, schema, normalization and scheduling |
| `sync/config/cpanel-sync.env.example` | Private cron configuration template |
| `docs/CPANEL_DEPLOYMENT.md` | Database baseline, app setup and ten-minute cron |
| `docs/CPANEL_OPERATIONS.md` | Existing-host qualification, deployment, recovery, quota and future maintenance |
| `docs/CPANEL_CHANGELOG_2026-10.md` | Implementation map, verification metrics and historical rollout boundaries |
| `sync/sql/verify_business_sync_readonly.sql` | Operator-parameterized, read-only all-table and exact-run audit checks |
| `MEMORY.md` | Architecture, changes and verification history |

Production target: `weavonpq_weaving_main`. Keep the clone, sync snapshots, backups, Google key and private tracking bundle outside `public_html`.

## Install and check

Use the hosting account's Node runtime (Node 22 or newer recommended):

```sh
npm ci --omit=dev
npm --prefix sync ci --omit=dev
npm run check
npm test
```

Set private environment values through cPanel or a `.env` copied from `.env.example`. Existing hosting-injected variables take precedence. Keep existing production credentials and the session secret private.

The tracking baseline contains business identifiers and is deliberately not published. Upload the separately supplied private baseline bundle for the September 22 SQL import. The SQL database dump is also private. A database changed since that import requires reconciliation before initializing the ledger.

## Verified behavior

Local MySQL tests verified inserts, edits, identity corrections, replay protection, transaction rollback, a complete scheduled cycle, a later automatic no-op and preservation of original fingerprints across 22 tables. The local ERP was tested with Bun; the hosted worker uses Node.js. Local checks do not establish hosted deployment success.

Source deletions do not delete ERP business records. Ambiguous identity changes stop for review; exact reviewed corrections reuse tracked identities. Scheduled sync never performs a truncated-table reload.
