# Project memory and maintenance journal

Updated: November 1, 2026. Business dates use Asia/Dhaka; timestamps ending in `Z` use UTC. This public journal contains reusable implementation details and aggregate outcomes. Private keys, source rows, exact exception selections, review fingerprints, backups and the operator's private running journal stay outside Git.

## Start here

Read this file at the start of a session. Record implemented changes, verification, remaining risks and safe resume instructions after meaningful work and before handoff. Preserve dated history; replace current status when newer evidence supersedes it. Repository history is evidence for the recorded snapshot, not a live database health endpoint.

The [October 25 journal](docs/history/PUBLIC_MEMORY_THROUGH_2026-10-25.md) is archived as superseded history. Its mandatory 42 holds/14 exclusions, Windows timer and incomplete hosted migration were true for the earlier rollout. The later qualified hosted migration and recurring policy replaced that operational state. Do not reactivate an old policy merely because legacy validation remains in the code.

Use these maintenance references together:

- [cPanel operations and recovery](docs/CPANEL_OPERATIONS.md): deployment, private configuration, evidence and failure handling.
- [Migration policy](docs/MANUAL_TRANSFER_POLICY.md): distinct legacy, manual and recurring policy modes.
- [Preservation requirements](docs/CRITICAL_CPANEL_BASELINE.md): original business rows, identities and backups.
- [Source change map](docs/CPANEL_CHANGELOG_2026-10.md): implementation locations and dated migration aggregates.
- [Installation](docs/CPANEL_DEPLOYMENT.md) and [storage](docs/SYNC_STORAGE.md): existing installation layout, resource guards and retention.
- [November 1 missing-day verification](docs/CPANEL_CATCHUP_VERIFICATION_2026-11-01.md): source capture cutoff, later catch-up and daily proof.

## Migration and scheduler state

The production database is `weavonpq_weaving_main`. The original September 22 through October 29, 2026 **inclusive** migration made actual business-table writes. The source snapshot was prepared on October 29 at **04:59:54.035Z / 10:59:54 Asia/Dhaka**. It cannot prove transfer of rows added to Sheets later that day.

| Original frozen migration metric | Verified result |
| --- | ---: |
| Eligible source-profile records matched | 14,162; zero unmatched |
| Insert / update / refresh profile operations | 13,982 / 38 / 142 |
| Mapped business targets verified | 28,802 |
| Actual physical business inserts / updates / deletes | 28,349 / 72 / 0 across 18 tables |
| Historical originals checked | 945,533 across 36 tables |
| Reviewed historical revisions | 30; other 945,503 originals preserved |
| Same-snapshot replay | Zero proposed changes |

Profile operations, mapped targets and physical row writes measure different things. One source record may map to a parent and several details or refresh dependent balances. Never present a profile count as the number of physical rows inserted.

The authorized hosted recurring mode uses **`*/10 * * * *`**, `SYNC_ENABLED=true`, a September 22 start and a rolling Dhaka end date. It compares eligible records in that whole window against the ledger; it does not restrict recovery to rows created since the last timer tick. Consequently, downtime does not discard later October 29, October 30 or October 31 source rows that remain available in the Sheets. Every fresh cycle still needs source qualification, a full dry run, a fresh verified backup, apply and mapped verification.

There are **zero active broad holds and zero original broad exclusions** under the qualified recurring policy. The eight overlapping original findings represented six exact source anchors. One later duplicate-source anchor was explicitly retired after its disappearance was qualified; the current policy has **five active exact skips plus that one retired anchor**. The original conflicts remain unresolved. The actual hosted qualification preserved the existing retained-or-absent database state; it did not assume that rows in a disposable test database existed in production. New source conflicts must not be added to this exception silently.

A completed historical migration and an enabled timer do not guarantee that the latest cycle completed. Read the active directory's status, pending recovery, conflict report, source timestamp and terminal scheduler marker. Preserve historical failures; a later successful catch-up does not rewrite them.

## November 1 verification journal

- **Frozen catch-up and independent proof COMPLETE:** the eight final frozen-snapshot identity conflicts were reconciled with exact full fingerprints and original physical/provenance bindings. The new manual catch-up committed 32 physical inserts and 10 normal updates, plus eight separately audited identity updates, zero deletes; its 16/9/338 insert/update/refresh profile operations verified 726 mapped targets. The selected source was held immutable for completion and independent checks while the owner confirmed identity edits were continuing. Later source identity changes may trigger new guarded conflicts; this is not a claim that a later automatic cycle completed. Latest daily proof at 2026-11-01T09:31:58.808Z matched 2026-10-29: 395/395, 2026-10-30: 357/357, 2026-10-31: 352/352, 2026-11-01: 17/17, zero unmatched; 2,236 whole-range business targets were independently checked read-only. The all-window check matched 15,455/15,455, zero missing. Current five active skips plus one retired anchor and zero broad holds/exclusions remain unchanged. See the dated verification document for the source cutoff and physical table counts. Earlier pending/zero-November-1 entries below describe their earlier snapshots and are superseded by this entry.
- **Post-cutoff check at 08:11Z:** the 05:10 scheduled cycle completed successfully at 05:18:46Z with 33 insert/10 update profile operations and 66 physical inserts/14 updates/zero deletes. Later source changes introduced eight new matching conflicts across PO/bootstrap, receipts, issues and deliveries. The earlier daily audit remains valid for its frozen snapshot; it must not be presented as current parity after those edits. Complete original fingerprints and physical/provenance targets were independently qualified for the newer corrections; their separate catch-up is still pending at this entry. No new skips or business-row deletion were introduced.
- **Explicit outside-amount mapper repair:** blank-history preservation previously tested only Warp/Weft, so it could silently retain an old outside issue despite an explicit new Out Side zero. The guard now requires all three amount cells blank. Regression cases cover zero, positive/negative numeric changes, genuinely blank historical parent/detail/balance preservation and missing/ambiguous provenance refusal. Publication is not evidence that this fix is deployed or that the pending later source corrections have committed; add the actual deployment/catch-up evidence after verification.
- A separately qualified morning manual catch-up completed 83 insert / 5 update / 759 refresh profile operations; its normal business audit recorded 166 physical inserts and 5 updates, plus one separately audited identity update, with zero deletes. It verified 1,697 mapped targets. An independent check then matched all 15,118 eligible profile records in that snapshot.
- After the bounded native HTTPS transport was deployed, the actual **04:10:24Z to 04:18:43Z** scheduled cycle completed 9 insert / 4 update / 310 refresh profile operations. Its physical audit recorded **22 inserts / 32 updates / zero deletes** and verified 650 mapped targets. Independent verification at 04:19Z matched **15,191 / 15,191** eligible profile records. This is dated source-ledger parity plus that cycle's mapped-target verification, not an assertion that every historical field was re-audited.
- The next scheduled cycle succeeded. A later fetch failed safely on a bounded transient request; subsequent certified source revealed two newer folding identity changes. Each was qualified using a unique complete inverse source fingerprint, the original ledger event and physical before-images. The same original parent/detail IDs, business dates and grade quantities must be preserved. An older already-applied review for one event is archived and superseded by its newly qualified current review; appending contradictory review chains would block later source changes.
- **Final missing-day audit PASSED at 2026-11-01T05:09:36.006Z:** all 969 eligible October 29–November 1 source-profile records matched, zero unmatched; a fresh read-only mapper pass verified 1,930 business targets, with zero audit writes and zero validation/reject/lookup errors. The full September 22–November 1 ledger check then matched 15,299/15,299. Catch-up completed 104 insert / 6 update / 738 refresh profile operations, with 210 physical inserts and 64 normal updates, plus four separately audited identity updates; zero deletes. Original IDs/date/grade/detail-quantity checks, policy, backup, pins, cron, quota and real history/HTTP/auth checks passed. No November 1 business-date source rows were available in this certified snapshot. That is zero available to transfer, not a claim about rows added later today. See the dated verification document for day/profile/table counts and cutoff limits.

## Current architecture and implemented repairs

### Application, private runtime and evidence

The existing Express/Passenger ERP application serves the UI, authenticated history and database tools. The private sync runtime lives outside `public_html`. Its private `.env.sync` selects the active `SYNC_DATA_DIR`, source credentials, policy and reviewed assignments. The checksum manifest binds deployed code and private configuration. Durable completed migration evidence is kept separately from rotating active snapshots.

The history API resolves the real active directory from the installed environment. It must not fall back to a stale successful directory when the current cycle is broken. The modal separates matching conflicts, broad dependency exclusions, exact reviewed skips, actual physical row changes and source-profile operations. Missing completion markers remain unconfirmed; clearing the view does not delete business rows, source logs or audit records. Detailed database-row audit coverage began October 12; earlier row-level details cannot be manufactured.

The Node supervisor owns scheduler start and terminal events, including capacity supervision and lock overlap, so a shared-hosting shell exiting early cannot falsely complete the run. Deploy the wrapper and supervisor together. Do not add duplicate shell success events or synthesize successful markers for interrupted cycles. One scheduler file lock plus the heartbeat-protected MySQL advisory lock serializes writers.

### Source acquisition

The hosted authenticated reader uses the existing private service account with read-only Google access, pinned workbook/numeric tab identities, explicit headers, preserved cell semantics, bounded pages, streaming certification and memory-aware per-profile planning. It does not edit the Sheets or change their sharing. OAuth secrets and response cell data must not appear in logs.

Google reads share a **1,250 ms start interval** (at most 48 starts/minute). HTTP 429 waits at least a full refill window plus jitter and honors longer `Retry-After` seconds or dates. Transient requests have a finite retry budget. Native HTTPS uses fresh IPv4 connections, verified TLS, identity encoding, a 32 MiB response cap and a **45 second deadline covering headers and the entire body**, with a bounded OAuth request too. Timeout/reset/truncated-response retries preserve the same range and read semantics. Permanent authorization, certificate and budget errors stop safely. The actual deployed client recovered from deadline failures before a later complete scheduled snapshot succeeded.

### Business identity, mapping and preservation

Multiple challan amounts sharing a full Dispo/date remain separate entries across receipts, issues and deliveries. Do not merge, sum or select a latest amount solely because references match. Edits use an established provenance/source binding. Explicit weaving-return references remain distinct; ambiguous or invented references are rejected.

Business dates are checked for every operation. The qualified recurring policy rebinds exact original exceptions to each fresh snapshot without weakening their quantity, identity, multiplicity or retained-state checks. Historical exclusion validation still examines complete evidence even when writes are date-bounded. Old legacy 42/14 enforcement remains appropriate only for its original policy mode.

The mapper captures preimages during full dry run, rejects unexpected target changes, records source/profile/table/key/before/after audit changes in the same transaction, updates the source ledger and verifies mapped business targets after apply. Audit and ledger updates roll back with their business writes. Trigger visibility and literal escaped database-grant checks remain enforced. Scope guards, primary/composite keys, provenance and historical preservation are never bypassed to obtain a green status.

Qualified exact identity corrections require a unique full inverse fingerprint, unchanged amounts/dates, current source/ledger before-images and an empty destination. Separately evidenced source date or numeric amount corrections use the reviewed normal mapper path; do not claim an intentionally revised amount was preserved unchanged. An amount or row position alone is never sufficient identity evidence. If a mapper cannot preserve an existing folding parent/detail identity automatically, a separately authorized narrowly bound alignment can retain its numeric IDs, backed by a fresh consistent backup and explicit transactional audit. This is a private record-bound operation, not a generic fuzzy matching feature. A later correction for the same event must archive its superseded applied review and bind the replacement to the **current** ledger fingerprint before another full dry run; no business rows are deleted by review-file maintenance.

### Capacity, recovery and deployment

Keep the existing **3,072 MiB startup reserve**, bounded worker memory, one active generated cycle and two accepted SQL backups. Pending/current cycles and independently retained migration/restore evidence are protected from normal cleanup. Backup acceptance requires a consistent dump, completed gzip stream and matching digest; partial files are not accepted backups. A resumed apply must use the originally certified frozen cutoff and exact pending mapping state, not silently fetch a different source midway through recovery.

Reviewed narrow schema changes preserve values, including the qualified longer composition fields. Do not globally widen columns or reinitialize populated tables. Application public JavaScript must remain readable by the web server (normally `0644`); private environments, keys and policies stay private. A public asset once returning 403 was corrected by mode only, with its bytes unchanged. Verify actual served HTTPS bytes and anonymous API denial as well as local hashes. Interactive visual QA was unavailable in that verification, so no visual browser pass is claimed.

## Publication and validation history

PRs #4–#8 introduced qualified manual/recurring policy modes, narrower bounded windows, exact skip preservation and cumulative receipt date handling. PR #9 added qualified exact reassignment support. The following repair publications added truthful active-directory history, Node-owned terminal events, safe complete CSV publication, source-tab identity/API acquisition, bounded memory, qualified duplicate retirement, narrow composition capacity, preserved resume retention, public asset maintenance and paced native HTTPS reads. PRs #10 and #12–#19 were merged after their checks; PR #11 was closed unmerged and must not be reopened unchanged.

The last deployed runtime release for this journal is **`80dcc24be0cfbcfdf1ad4c56869769995697b00f`**, PR #21, with main CI **41289016412 passed**. It fixes explicit outside-issue amount handling and adds the selected implementation module to the existing checksum coverage. The native HTTPS reader components remain the previously verified `9de15a1321a66d9733624afc8b59a425097e42a6` implementation. Private configuration, key, original exception scope and cron were preserved. This subsequent documentation publication changes no deployed code or schedule; private case selections and one-off controllers stay outside Git.

Meaningful automated checks cover HTTP/auth boundaries, history coverage, hosted policy modes, scheduler ownership, partial downloads, real stalled HTTP headers/body deadlines, exact Google IDs and formatting, pacing/retry budgets, storage/resume, identity/provenance, separate entries, exact skips, date scope and full dry-run gates. Use `npm run check` and `npm test` for implementation changes; documentation changes need whitespace/link checks and the repository CI. Real database/source proof remains necessary before claiming a production transfer.

## Safe next-session procedure

1. Read fresh installed status, active directory, current source timestamp, locks and pending state before running any writer. Do not repeat the completed October 29 migration or an already committed identity/DDL controller.
2. For a missing-day question, inventory the **whole requested date range** from a newly certified source; match group/digest multiplicities to the actual database ledger and independently verify the mapped physical rows. Database date counts alone cannot prove Sheets parity. No available source rows means nothing available to transfer, not evidence of invented or restored rows.
3. If blocked, preserve the failure report and qualify its exact current source/target cause. No blanket skip, source deletion, ledger reset, backup deletion or weakened quota/policy guard is an acceptable recovery shortcut.
4. Preserve selected-file before-images, run relevant tests/CI, deploy only reviewed files, refresh selective pins and check real HTTP/auth behavior. A GitHub commit is not proof of deployment or database writes.
5. Keep private durable run identifiers and safe resume instructions in the operator journal; publish only reusable procedures and verified aggregates here. Update the current outcome with a timestamp and its limits.
