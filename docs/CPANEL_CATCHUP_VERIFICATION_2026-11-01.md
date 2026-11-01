# Missing-day catch-up verified on November 1, 2026

**October 29 is included in the completed production migration. The later catch-up also covers the currently available October 29–November 1 source records.** Database: `weavonpq_weaving_main`. Business dates use Asia/Dhaka. This is dated aggregate evidence, not a live status endpoint or a reusable authorization.

## Original snapshot versus later additions

The original September 22–October 29 **inclusive** migration used a source snapshot prepared **October 29 at 04:59:54.035Z / 10:59:54 Asia/Dhaka**. It committed **28,349 physical business inserts and 72 updates, zero deletes**, across 18 tables. All **14,162 eligible source-profile records** matched, and **28,802 mapped targets** were verified. Rows added or changed after the morning source capture needed a later cycle.

The resumed scheduler compares the full configured business window from September 22 through the current Dhaka date with its source ledger. Its ten-minute interval is a polling schedule, not a restriction to the most recent ten minutes. Existing source rows from paused days are therefore eligible for catch-up. This does not recover rows that are no longer present in the source, invent missing Loom production or resolve the original exact skipped conflicts.

## Fresh daily result

Verification completed **2026-11-01T05:09:36.006Z**, using the certified cycle that began **2026-11-01T04:50:49.013Z / 10:50:49 Asia/Dhaka**. The individual Sheets were read during that cycle, so this is a frozen multi-read snapshot rather than a transactional snapshot of all Google tabs at one instant.

| Business date | Eligible source-profile records | Matched in MySQL ledger | Unmatched | Exact skips on this date |
| --- | ---: | ---: | ---: | ---: |
| 2026-10-29 | 389 | 389 | 0 | 0 |
| 2026-10-30 | 338 | 338 | 0 | 0 |
| 2026-10-31 | 242 | 242 | 0 | 0 |
| 2026-11-01 | 0 | 0 | 0 | 0 |

All **969** eligible records in this date range matched their ledger group and full digest, including duplicate multiplicities. A separate verification-only mapper pass checked **1,930 business targets** for **969 source operations**, with read-only MySQL sessions and **zero business writes by the audit**. Rejects, validation errors and required/critical lookup misses were zero. The full September 22–November 1 source-ledger check at **2026-11-01T05:10:17.507Z** matched **15,299/15,299**, zero unmatched.

No November 1 business-date source rows were available in this certified snapshot. That is zero available to transfer, not a claim about rows added later today.

| Source profile | 2026-10-29 | 2026-10-30 | 2026-10-31 | 2026-11-01 |
| --- | ---: | ---: | ---: | ---: |
| dispo | 9 | 0 | 6 | 0 |
| folding | 139 | 154 | 135 | 0 |
| greige-delivery | 40 | 52 | 40 | 0 |
| loom | 0 | 0 | 0 | 0 |
| po | 7 | 0 | 7 | 0 |
| pre-costing-bootstrap | 7 | 0 | 7 | 0 |
| sizing | 18 | 16 | 0 | 0 |
| warping | 16 | 16 | 0 | 0 |
| yarn-issue | 103 | 73 | 36 | 0 |
| yarn-receive | 50 | 27 | 11 | 0 |

Counts are source-profile records, not distinct documents or physical row inserts. A single source row can participate in more than one profile and map to parent/detail/master targets. Loom had no available source rows in this window; none were invented.

## Catch-up writes and preserved records

The newly completed catch-up finished **2026-11-01T05:08:10.750Z**: **104 inserts / 6 updates / 738 refreshes** at source-profile level and **1,696 mapped targets verified**. The normal live run's committed physical audit recorded **210 inserts / 64 updates / 0 deletes**. Four separately audited Dispo-only parent/detail identity updates preceded that run, after a clean full dry run and fresh gzip/digest-verified SQL backup. Original IDs, dates, parent grade quantities and cumulative detail quantities were independently preserved. The original migration was not replayed.

Two later exact folding identity changes had safely blocked the next catch-up. Each unique current candidate reproduced the complete stored fingerprint when only its Dispo identity was reversed. The private review set retained unrelated reviews, archived one superseded already-applied review and installed the newly qualified pair. This did not delete business data or broaden the exception policy. Future corrections still need their own current source/ledger/physical proof and authorized business scope.

## Supporting database date counts

These are current physical business-table counts by native business date. They include rows that may predate this catch-up and can differ from source-profile counts because mappings have parent/detail and cumulative semantics. The source-ledger and mapped-value checks above provide the parity proof; these counts alone do not.

| Business table | 2026-10-29 | 2026-10-30 | 2026-10-31 | 2026-11-01 |
| --- | ---: | ---: | ---: | ---: |
| `pre_costing_data` | 7 | 0 | 2 | 0 |
| `PO_form_data` | 7 | 0 | 7 | 0 |
| `dispo_plan_form` | 9 | 0 | 6 | 0 |
| `dispo_form_data` | 9 | 0 | 6 | 0 |
| `yarn_receive_form` | 50 | 27 | 11 | 0 |
| `yarn_received_details` | 50 | 27 | 11 | 0 |
| `yarn_issue_form` | 103 | 73 | 36 | 0 |
| `yarn_issue_details` | 103 | 73 | 36 | 0 |
| `warping_form` | 16 | 16 | 0 | 0 |
| `warping_breakdown` | 16 | 16 | 0 | 0 |
| `sizing_form` | 18 | 16 | 0 | 0 |
| `sizing_breakdown` | 18 | 16 | 0 | 0 |
| `loom_production_form` | 0 | 0 | 0 | 0 |
| `loom_production_breakdown` | 0 | 0 | 0 | 0 |
| `folding_production_form` | 139 | 154 | 135 | 0 |
| `folding_production_breakdown` | 139 | 154 | 135 | 0 |
| `greige_delivery_form` | 40 | 52 | 40 | 0 |
| `greige_delivery_breakdown` | 40 | 52 | 40 | 0 |

## Recurring operation and verification limits

The installed hosted cron remains **`*/10 * * * *`**, enabled with a rolling Dhaka end date. The original exception scope remains **five active exact skips plus one retired source anchor**, zero broad holds and zero original broad exclusions. The skipped original findings remain unresolved; their retained-or-absent production state is verified. No requested-day records were silently added to the skip policy. Historical failed intervals remain visible.

The deployed runtime remains **`9de15a1321a66d9733624afc8b59a425097e42a6`**, whose main CI passed. This documentation publication does not redeploy code, replay writes, change private source credentials or alter the schedule. At the final check there was no pending apply; accepted backup gzip/digest, selected deployment pins, unchanged cron, quota reserve, real hosted history, served JavaScript bytes and anonymous-history HTTP 401 passed. Source changes after this frozen cycle require a subsequent successful scheduled run; an enabled timer alone is not proof that a future cycle succeeded.

Use the [operations guide](CPANEL_OPERATIONS.md) for future updates and the [read-only SQL reference](../sync/sql/verify_business_sync_readonly.sql) for exact-run/all-table checks. For October 29–November 1 counts, bind start `2026-10-29`, exclusive end `2026-11-02`, and the actual private live run ID. A database-only query cannot independently fetch or prove Google Sheets parity. Private run identifiers, rows and proof bundles remain outside Git.
