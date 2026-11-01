# Latest source prefix on an existing movement

An operator can correct a Dispo factory prefix, for example `SW/.../00123`
to `YT/.../00123`. After explicit owner authorization, set the private
`SYNC_ACCEPT_DISPO_PREFIX_EDITS=true` alongside `SYNC_VERIFIED_WRITES=true`.
The template stays disabled. Deploy the planner, worker, verified runtime,
write safety helper, mapper and new `sync_prefix_edits.js` together; pin their
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
business preimages and committed replay. Run the complete `npm test` and
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
