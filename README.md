# Woven ERP and Google Sheets sync

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
