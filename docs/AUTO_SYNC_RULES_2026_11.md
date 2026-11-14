# November 2026 auto-sync rule amendments

The recurring Recovery v2 worker now includes exact receipt-peer retention with cumulative-date evolution, explicit challan/split conflicts, same-PO Yarn Issue corrections, Folding diagnostics, rejection of unbound parent replacement, approval-scoped Dispo promotion, stable-ID children and transactional history. Existing scheduler locking, quota/integrity checks, complete dry runs, backups, independent mapped verification, original history and exact exclusions remain mandatory.

Receipt peer retention permits only Last Received Date to evolve under a privately pinned matchHash. Quantities and complete event identities stay fixed; source reappearance returns to ordinary matching. Ambiguous changes remain conflicts. Same-PO issue corrections require a full inverse source fingerprint, unchanged quantity/challan/count/lot/date, unique provenance parent/child, matching PO masters and an empty destination.

Folding missing-source evidence never authorizes deletion or reassignment. A source UPDATE cannot insert an unbound replacement parent. Independently authorized historical retention and genuinely additional production remain distinct events.

## Private promotion integration

The public five-item guard preserves the reviewed production state machine, including initial approval, partial replay and later ordinary edits/refreshes. Case selections and authentication implementations stay private. Configure all of SYNC_DISPO_PROMOTION_REQUEST_FILE, SYNC_DISPO_PROMOTION_REQUEST_SHA256, SYNC_DISPO_PROMOTION_RECEIPT_FILE and SYNC_DISPO_PROMOTION_APPROVER_MODULE. The request contains the exact five reviewed source UIDs/groups/old/new digests and database; its pinned status is PENDING_AUTH0_OWNER_APPROVAL_AND_REHEARSAL with writeAuthorized false. The private module exports SyncDispoFiveApproval with verifyReceipt(), independently authenticating and binding that exact request. No configuration issues no promotion grants; partial configuration fails closed. Normal missing-target checks still refuse unauthorized insertion.

Completed earlier release-specific recovery selection is not embedded publicly. If an operator must maintain that frozen legacy integration, SYNC_LEGACY_DISPO_PROMOTION_ADAPTER names an independently reviewed private ES module exporting qualify(plan, connection, pending), returning verified grants as a Map. Pin that adapter, its dependencies, approval material and private config in the hosted protection manifest. Absence grants no legacy transitions. These configuration interfaces are publication adaptations; do not overwrite the live installation from Git without an independently qualified deployment.

## Dated verification and limitations

November 8 recovery completed a 4,745-source-operation catch-up, exact approved promotions and independent protected-subject readbacks. Later autonomous identical-certified-source observation passed eight comparisons: nine file hashes, zero plan, unchanged row-change journal counters, ledger content checksum, protected-row fingerprint, unchanged exclusions and no extra observer writer. This establishes the observed audited sync path, not a forced importer replay, every-table equality, unrelated writer tracing, future source health or whole-history completeness. A separate older-data business review queue remains outside automatic approval.

Private receipts, selected business IDs, signed approvals, source snapshots, SQL dumps, active states and host integrity manifests are deliberately excluded. Run npm run check, npm test and npm run test:sync-rules. Synthetic fixtures require no cPanel credentials, approval service or production database. Repository publication does not deploy or replay production.
