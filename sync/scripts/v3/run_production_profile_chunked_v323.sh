#!/usr/bin/env bash
set -euo pipefail

NODE_HEAP_MB="${V323_NODE_HEAP_MB:-256}"
CHUNK_ROWS="${V323_CHUNK_ROWS:-500}"
PROFILE="${1:-}"
TOKEN="${2:-${PRODUCTION_APPROVAL_TOKEN:-}}"
DRY_RUN_ID="${3:-${APPROVED_DRY_RUN_ID:-}}"
CONTRACT="${MAPPING_CONTRACT_FILE:-mappings/mapping-contract-v2.json}"
MANIFEST="${SOURCE_MANIFEST_FILE:-$(pwd)/source-manifest.json}"
OUTPUT_ROOT="${CLI_CONTRACT_OUTPUT_ROOT:-$(pwd)/output/mapping_contract_v2}"
CSV_DIR_ACTIVE="${CSV_DIR:-$(pwd)/csv_files}"

case "$PROFILE" in
  loom|folding|greige-delivery) ;;
  *) echo "Chunked live wrapper only supports loom, folding, greige-delivery; got: $PROFILE" >&2; exit 2 ;;
esac
if [[ "$CHUNK_ROWS" != "500" ]]; then echo "Resource-bound live execution requires V323_CHUNK_ROWS=500 exactly." >&2; exit 2; fi
if [[ -z "$TOKEN" || "$TOKEN" == CHANGE_* ]]; then echo "A real production approval token is required." >&2; exit 3; fi
if [[ -z "$DRY_RUN_ID" ]]; then echo "An accepted full dry-run ID is required." >&2; exit 4; fi
if [[ "${BACKUP_CONFIRMED:-false}" != "true" ]]; then echo "Set BACKUP_CONFIRMED=true only after downloading a fresh database backup." >&2; exit 5; fi
if [[ "${ALLOW_PRODUCTION_DB:-false}" != "true" ]]; then echo "Set ALLOW_PRODUCTION_DB=true in the protected CLI environment." >&2; exit 6; fi

# Expensive integrity gates are run once before the bounded children and once
# after all children. Each child binds to the exact SHA-256 of these preflight
# artifacts so it cannot silently switch source/approval evidence mid-profile.
node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/validate_source_manifest.js --approved
node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/verify_full_dry_run.js --run-id="$DRY_RUN_ID"
node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/verify_live_chunk_safety_v323.js \
  --profile="$PROFILE" \
  --dry-run-id="$DRY_RUN_ID" \
  --output-root="$OUTPUT_ROOT" \
  --contract="$CONTRACT" \
  --manifest="$MANIFEST" \
  --csv-dir="$CSV_DIR_ACTIVE" \
  --chunk-size="$CHUNK_ROWS"

MANIFEST_SHA="$(sha256sum "$MANIFEST" | awk '{print $1}')"
ACCEPTANCE_FILE="$OUTPUT_ROOT/$DRY_RUN_ID/full_dry_run_acceptance.json"
test -s "$ACCEPTANCE_FILE" || { echo "Accepted dry-run evidence file missing: $ACCEPTANCE_FILE" >&2; exit 7; }
ACCEPTANCE_SHA="$(sha256sum "$ACCEPTANCE_FILE" | awk '{print $1}')"
SOURCE_ROWS="$(node - "$PROFILE" "$MANIFEST" "$CONTRACT" <<'NODE'
const fs=require('fs');
const [profileId, manifestPath, contractPath]=process.argv.slice(2);
const m=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const c=JSON.parse(fs.readFileSync(contractPath,'utf8'));
const p=(c.profiles||[]).find(x=>x.id===profileId);
if(!p) throw new Error(`Profile not found: ${profileId}`);
const e=(m.files||[]).find(x=>x.filename===p.source_file);
const n=Number(e?.nonempty_rows);
if(!Number.isFinite(n)||n<0) throw new Error(`Invalid manifest row count for ${p.source_file}`);
process.stdout.write(String(n));
NODE
)"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LIVE_ROOT="$OUTPUT_ROOT/live_chunked_${PROFILE}_${STAMP}"
mkdir -p "$LIVE_ROOT/chunks"
chmod 700 "$LIVE_ROOT" "$LIVE_ROOT/chunks" 2>/dev/null || true
printf '%s\n' "$DRY_RUN_ID" > "$LIVE_ROOT/approved_dry_run_id.txt"
printf '%s\n' "$MANIFEST_SHA" > "$LIVE_ROOT/approved_manifest_sha256.txt"
printf '%s\n' "$ACCEPTANCE_SHA" > "$LIVE_ROOT/prevalidated_dry_run_acceptance_sha256.txt"
chmod 600 "$LIVE_ROOT"/*.txt 2>/dev/null || true

CHUNK_COUNT=$(( (SOURCE_ROWS + CHUNK_ROWS - 1) / CHUNK_ROWS ))
echo "LIVE resource-bounded profile: $PROFILE"
echo "Source rows: $SOURCE_ROWS; chunk size: $CHUNK_ROWS; chunks: $CHUNK_COUNT"

offset=0
chunk=1
while (( offset < SOURCE_ROWS )); do
  remaining=$(( SOURCE_ROWS - offset ))
  limit=$CHUNK_ROWS
  (( remaining < limit )) && limit=$remaining
  chunk_dir="$LIVE_ROOT/chunks/$(printf '%04d_offset_%09d' "$chunk" "$offset")"
  mkdir -p "$chunk_dir"
  chmod 700 "$chunk_dir" 2>/dev/null || true
  run_id="live_${PROFILE}_${STAMP}__chunk_$(printf '%04d' "$chunk")"
  log="$chunk_dir/terminal.log"

  set +e
  node --max-old-space-size="$NODE_HEAP_MB" import.js \
    --live --yes --backup-confirmed --allow-production-db \
    --production-approval="$TOKEN" \
    --approved-dry-run="$DRY_RUN_ID" \
    --contract="$CONTRACT" \
    --only="$PROFILE" \
    --offset="$offset" \
    --limit="$limit" \
    --scope-source-index \
    --chunk-wrapper \
    --prevalidated-manifest-sha256="$MANIFEST_SHA" \
    --prevalidated-dry-run-acceptance-sha256="$ACCEPTANCE_SHA" \
    --run-id="$run_id" \
    --output-dir="$chunk_dir" \
    >"$log" 2>&1
  child_exit=$?
  set -e
  if [[ "$child_exit" -ne 0 ]]; then
    echo "STOP: live chunk failed: profile=$PROFILE chunk=$chunk/$CHUNK_COUNT offset=$offset rows=$limit exit=$child_exit" >&2
    tail -n 120 "$log" >&2 || true
    exit "$child_exit"
  fi
  if (( chunk == 1 || chunk % 10 == 0 || chunk == CHUNK_COUNT )); then
    echo "  $PROFILE chunk $chunk/$CHUNK_COUNT PASS (offset=$offset, rows=$limit)"
  fi
  offset=$(( offset + limit ))
  chunk=$(( chunk + 1 ))
done

node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/aggregate_live_profile_chunks_v323.js \
  --profile="$PROFILE" \
  --live-root="$LIVE_ROOT" \
  --source-rows="$SOURCE_ROWS" \
  --chunk-size="$CHUNK_ROWS" \
  --manifest-sha256="$MANIFEST_SHA" \
  --approved-dry-run-id="$DRY_RUN_ID" \
  > "$LIVE_ROOT/live_chunk_aggregate_terminal.json"

# Final source/approval revalidation closes the bounded execution window.
node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/validate_source_manifest.js --approved
node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/verify_full_dry_run.js --run-id="$DRY_RUN_ID" >/dev/null

echo "Completed live resource-bounded profile: $PROFILE"
echo "Evidence: $LIVE_ROOT/live_chunk_index.json"
