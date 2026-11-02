# Latest source prefix on an existing movement

## Verified deployment on November 2, 2026

PR #23 is merged as `300a03b32dba13411e32b1c0faede61609768365`.
PR CI 41301836232 and main CI 41301952474 passed. The selected seven
runtime modules were deployed at **03:19:29.937Z**, with their exact checksums
verified and the owner's recurring prefix grant enabled. Other private
environment settings, the exception policy and the ten-minute cron were
preserved. Eight regression tests passed on hosting.

A real temporary-table MySQL fixture also invoked the actual staged mapper,
business preimage guard, child reconciler and audit writer. It proved an
in-place composite-key prefix edit with the same numeric ID and quantity,
complete audit before/after values, atomic rollback of business and audit
changes, committed replay, and refusal of an ambiguous numeric ID. These
fixture writes used temporary tables only; they are not production business
transfers. Deployment itself made zero production business writes.

The reported current receipt conflicts were separately identified as source
dates reverting from October 30 to October 31 with an unchanged SW prefix.
Those require their own exact source/ledger/physical review and normal backed-up
apply. A Google source-read timeout can independently stop acquisition before
planning. Publishing or enabling the prefix rule does not certify those later
catch-ups or a successful fresh scheduled interval; record their actual proof
separately after completion.

## Qualification and future changes

Exact reviews are one-off authorizations. Their full profile/source UID and
before/after group/digest tuple is fingerprinted as an `appliedReviewKeys`
entry. The planner carries consumption evidence into any subsequent normal
operation; the verified runtime saves it with the business/ledger transaction
and retains it through later edits. This prevents a valid later date correction
from reactivating an obsolete reference review. A new review targeting an older
group still has a different fingerprint, and ordinary matching and duplicate
guards continue to run. Retain-missing and superseded-revision actions keep
their specialized validation. Legacy prefix ancestry is accepted only when it
cannot be mistaken for a newly requested correction from the current group.

For an existing stale review without this metadata, do not simply remove it.
Qualify the completed, manifest-bound and fully mapped-verified plan: its
operation must have consumed that review's exact destination digest and must
match the current UID/group/digest. Under the normal locks, preserve the old
identity metadata and record only that exact applied-review fingerprint. Keep
the private proof and before/after metadata; this repair changes no business
rows, skipped records or new-review permissions. A subsequent source ambiguity
still requires normal review.

The bounded planner can retain a set of every source group while materializing
only the selected business-date records. This avoids retaining large historical
payloads that cannot be written by the current window. It still detects missing
old groups and never filters the ledger by an assumed date. Legacy dependency
exclusions and exact skipped profiles keep their full inventories. Default
unbounded inventory callers are unchanged. Compare selected full records,
duplicate ordinals, group presence and plans before deploying a memory change;
a lower heap limit alone is not a repair for excessive retained objects.

For an explicitly reviewed full-window refresh, the worker also requires a
bounded manual qualification. Create a **job-private** environment that points
`SYNC_MANUAL_SKIPS_FILE` and its exact SHA256 to the selected frozen cycle's
existing qualified exception file, alongside the durable review path. The
ordinary source, immutable base, retained-row and hosted-policy checks still
run. Use that private environment with `--refresh-window` and
`--resume-host-cycle`; validate before backup and apply. Keep generated cycle
bindings out of the recurring base environment. A source-reference correction
can change cumulative totals even when its own grade/receipt amount is unchanged;
qualify those derived dependencies and verify their new mapped values. Never
describe all derived quantities as preserved merely because the source amount
and numeric row IDs were retained.

An operator can correct a Dispo factory prefix, for example `SW/.../00123`
to `YT/.../00123`. After explicit owner authorization, set the private
`SYNC_ACCEPT_DISPO_PREFIX_EDITS=true` alongside `SYNC_VERIFIED_WRITES=true`.
The template stays disabled. Deploy the planner, worker, verified runtime,
write safety helper, row-history writer, mapper and new `sync_prefix_edits.js` together; pin their
exact bytes and the selectively edited environment in the private manifest.
Use the scheduler file lock and database lock, and refuse deployment with a
pending apply. Preserve all other environment values and private reviews.

The current source snapshot supplies the new full Dispo; row position and
an export-generated UID do not establish which database row it edits. The
rule supports yarn receipts, yarn issues, warping, sizing and greige deliveries,
whose parents have numeric provenance bindings. It does not rename Dispo or
PO master primary keys, move their other references, or merge historical
records. Those structural corrections retain their separate review path.

Qualification requires a unique old/new pair with identical business fields
after replacing only the recognized first prefix (`NH`, `YT`, `SW`, `SC`). All
remaining slash components and leading zeros remain significant. Dates,
challans, quantities, yarn specifications, factory fields and notes must match.
Only audit/display fields (`Created By`, `Last Modified Date`, `Search Column`,
`Stock Column`, `Count ID`) and generated `__MIG_` metadata are excluded from
this additional signature. A legacy issue column named `Received Start Date`
can contain a Dispo string; that string is normalized only when its complete
body matches the primary Dispo. This signature never replaces the ordinary
full source digest, group, yarn identity or ledger UID.

For previously synchronized rows, the signature is seeded in the existing
`yarn_identity` JSON only when the current full digest **and** group equal the
ledger. This metadata-only upgrade is limited to the selected business window;
it does not change business rows or require a schema migration. A changed
legacy row without a stored signature must reproduce the complete old digest
by reversing its prefix in the source and derived search value. Otherwise it
remains a conflict for review. Matching amounts alone are insufficient.

The automatic rule refuses duplicate candidates, a destination group already
occupied in the ledger, or an old group still present in the full source.
Coexisting prefixed records remain separate. For a partial edit within a
shared challan/group, explicit review can still be required. Other identity
corrections keep their existing safeguards; enabling this rule grants no
date/number/quantity correction policy and adds no new skipped records.

The plan records `prefixChange` evidence with the old/new full Dispo, previous
digest and business signature. The verified runtime checks the explicit flag,
profile, edit shape and frozen source signature again. Normal source-bound
full dry run, backup, transactional preimage checks, row audit and mapped-value
verification remain mandatory. Provenance selects the existing parent ID. A
single child under that parent is updated through its globally unique numeric
ID, even when its composite primary key includes `dispo_number`. An occupied
destination, multiple children, ambiguous ID, referenced-key mutation or
changed preimage fails safely. Parent, child and ledger commit in the same
source-row transaction; no business-row deletion or replacement is introduced.

`sync/tests/sync_prefix_edits.test.js` exercises reordered unequal amounts,
successive prefixes, legacy full inverse proof, unsafe-field changes,
coexisting/duplicate/occupied cases, metadata persistence, stable child IDs,
business preimages, composite-key audit before/after values and committed replay.
The transaction retains consumed private-review group ancestry after a prefix
edit so that an obsolete review cannot block the next cycle. Run the complete `npm test` and
`npm run check` and CI before publication/deployment. A passing synthetic
test or dry run is not a receipt of production business writes.

After deployment, verify a fresh actual scheduled cycle in Sync history:
finished time, result, reason and committed row counts. A prefix policy cannot
make a date conflict disappear. Inspect `status.json` for the current cycle
before interpreting `conflict-review.json`, which may describe an older failed
cycle. Archive the cycle's qualified plan and before/after evidence outside
rotating retention. To revoke the grant, set the flag false under the normal
locks only after any pending apply is resolved; do not delete ledger metadata
or reverse already committed business corrections.
