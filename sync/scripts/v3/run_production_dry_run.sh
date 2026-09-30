#!/usr/bin/env bash
set -euo pipefail

NODE_HEAP_MB="${V323_NODE_HEAP_MB:-256}"
CHUNK_ROWS="${V323_CHUNK_ROWS:-500}"
CHUNKS_PER_INVOCATION="${V323_PHASE7_CHUNKS_PER_INVOCATION:-15}"
CHUNK_PAUSE_SECONDS="${V323_CHUNK_PAUSE_SECONDS:-1}"
RESUME_RUN_ID="${V323_RESUME_RUN_ID:-}"
ROOT="$(pwd)"
EVIDENCE_DIR="${EVIDENCE:-/home/weavonpq/v323_preflight_evidence}"
STATE_FILE="${PHASE7_RESUME_STATE_FILE:-$EVIDENCE_DIR/phase7_resumable_active.json}"
CONTRACT="${MAPPING_CONTRACT_FILE:-mappings/mapping-contract-v2.json}"
MANIFEST="${SOURCE_MANIFEST_FILE:-$ROOT/source-manifest.json}"
OUTPUT_ROOT="${CLI_CONTRACT_OUTPUT_ROOT:-$ROOT/output/mapping_contract_v2}"
CSV_DIR_ACTIVE="${CSV_DIR:-$ROOT/csv_files}"
SCHEMA="$ROOT/schema/weavonpq_weaving.schema.json"
ATTESTATION="${NORMALIZATION_ATTESTATION_FILE:-}"
PROFILES=(pre-costing-bootstrap po dispo yarn-receive yarn-issue warping sizing loom folding greige-delivery)

if [[ $# -gt 0 ]]; then echo "This production acceptance script takes no positional arguments." >&2; exit 2; fi
[[ "$NODE_HEAP_MB" == "256" ]] || { echo "V323_NODE_HEAP_MB must be 256 for this cPanel resumable release; got $NODE_HEAP_MB" >&2; exit 2; }
[[ "$CHUNK_ROWS" == "500" ]] || { echo "V323_CHUNK_ROWS must be 500 exactly; got $CHUNK_ROWS" >&2; exit 2; }
[[ "$CHUNKS_PER_INVOCATION" =~ ^[0-9]+$ ]] && (( CHUNKS_PER_INVOCATION>=1 && CHUNKS_PER_INVOCATION<=20 )) || { echo "V323_PHASE7_CHUNKS_PER_INVOCATION must be 1..20; got $CHUNKS_PER_INVOCATION" >&2; exit 2; }
[[ "${ALLOW_PRODUCTION_DB:-false}" == "false" && "${BACKUP_CONFIRMED:-false}" == "false" ]] || { echo "Dry-run gate requires ALLOW_PRODUCTION_DB=false and BACKUP_CONFIRMED=false" >&2; exit 2; }
[[ -z "${PRODUCTION_APPROVAL_TOKEN:-}" && -z "${APPROVED_DRY_RUN_ID:-}" ]] || { echo "Dry-run gate requires production token and approved dry-run ID to be unset." >&2; exit 2; }
mkdir -p "$EVIDENCE_DIR"

profile_source_rows() {
  node - "$1" "$MANIFEST" "$CONTRACT" <<'NODE'
const fs=require('fs');const [profileId,manifestPath,contractPath]=process.argv.slice(2);const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));const contract=JSON.parse(fs.readFileSync(contractPath,'utf8'));const profile=(contract.profiles||[]).find(x=>x.id===profileId);if(!profile)throw new Error(`Profile not found: ${profileId}`);const entry=(manifest.files||[]).find(x=>x.filename===profile.source_file);const rows=Number(entry?.nonempty_rows);if(!entry||!Number.isFinite(rows)||rows<0)throw new Error(`Approved manifest row count missing for ${profileId}`);process.stdout.write(String(rows));
NODE
}
profile_dir_for() { local ordinal="$1" profile="$2"; printf '%s/profiles/%02d_%s' "$RUN_DIR" "$ordinal" "$profile"; }
is_heavy(){ case "$1" in loom|folding|greige-delivery) return 0;; *) return 1;; esac; }

# Approved manifest validation is intentionally repeated on every independent invocation.
node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/validate_source_manifest.js --approved

if [[ ! -f "$STATE_FILE" ]]; then
  if [[ -n "$RESUME_RUN_ID" ]]; then RUN_ID="$RESUME_RUN_ID"; ADOPT=true; else RUN_ID="prod_full_dry_$(date -u +%Y%m%dT%H%M%SZ)"; ADOPT=false; fi
  node scripts/v3/phase7_resume_state_v323.js \
    --action=init --state="$STATE_FILE" --run-id="$RUN_ID" --adopt="$ADOPT" \
    --contract="$CONTRACT" --manifest="$MANIFEST" --schema="$SCHEMA" --csv-dir="$CSV_DIR_ACTIVE" --attestation="$ATTESTATION" --output-root="$OUTPUT_ROOT" \
    --chunk-size="$CHUNK_ROWS" --node-heap-mb="$NODE_HEAP_MB" --batch-chunks="$CHUNKS_PER_INVOCATION"
else
  if [[ -n "$RESUME_RUN_ID" ]]; then
    EXISTING_ID="$(node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(j.runId)' "$STATE_FILE")"
    [[ "$EXISTING_ID" == "$RESUME_RUN_ID" ]] || { echo "Active state run ID $EXISTING_ID does not match V323_RESUME_RUN_ID=$RESUME_RUN_ID" >&2; exit 2; }
  fi
fi
node scripts/v3/phase7_resume_state_v323.js \
  --action=validate --state="$STATE_FILE" --contract="$CONTRACT" --manifest="$MANIFEST" --schema="$SCHEMA" --csv-dir="$CSV_DIR_ACTIVE" --attestation="$ATTESTATION" --output-root="$OUTPUT_ROOT" \
  --chunk-size="$CHUNK_ROWS" --node-heap-mb="$NODE_HEAP_MB" --batch-chunks="$CHUNKS_PER_INVOCATION" >/dev/null
RUN_ID="$(node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(j.runId)' "$STATE_FILE")"
RUN_DIR="$OUTPUT_ROOT/$RUN_ID"
MANIFEST_SHA="$(sha256sum "$MANIFEST" | awk '{print $1}')"
mkdir -p "$RUN_DIR/profiles"

printf 'Phase-7 resumable cPanel execution. Run ID: %s\n' "$RUN_ID"
printf 'This invocation processes at most %s heavy chunks, then exits checkpoint code 75.\n' "$CHUNKS_PER_INVOCATION"
printf 'Do NOT wrap repeated invocations in one shell loop; launch each invocation separately.\n'

# Light profiles are independently validated and reused after a resource interruption.
for idx in 0 1 2 3 4 5 6; do
  profile="${PROFILES[$idx]}"; ordinal=$((idx+1)); profile_dir="$(profile_dir_for "$ordinal" "$profile")"; mkdir -p "$profile_dir"
  if node scripts/v3/verify_phase7_checkpoint_v323.js --kind=profile --profile="$profile" --dir="$profile_dir" --contract="$CONTRACT" --manifest="$MANIFEST" >/dev/null 2>&1; then
    echo "  checkpoint reuse: $profile PASS"
    continue
  fi
  if [[ -n "$(find "$profile_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    archive="$RUN_DIR/interrupted_attempts/${profile}_$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$(dirname "$archive")"; mv "$profile_dir" "$archive"; mkdir -p "$profile_dir"
  fi
  echo "Running light profile $ordinal/10: $profile"
  log="$profile_dir/terminal.log"
  set +e
  MALLOC_ARENA_MAX=2 node --max-old-space-size="$NODE_HEAP_MB" import.js --dry-run --contract="$CONTRACT" --run-id="${RUN_ID}__${profile}" --output-dir="$profile_dir" --only="$profile" 2>&1 | tee "$log"
  child_exit=${PIPESTATUS[0]}
  set -e
  [[ "$child_exit" -eq 0 ]] || { echo "STOP: profile $profile failed exit=$child_exit" >&2; exit "$child_exit"; }
  node scripts/v3/verify_phase7_checkpoint_v323.js --kind=profile --profile="$profile" --dir="$profile_dir" --contract="$CONTRACT" --manifest="$MANIFEST" >/dev/null
  echo "  checkpoint saved: $profile PASS"
done

processed_this_invocation=0
for idx in 7 8 9; do
  profile="${PROFILES[$idx]}"; ordinal=$((idx+1)); profile_dir="$(profile_dir_for "$ordinal" "$profile")"; source_rows="$(profile_source_rows "$profile")"; chunk_count=$(( (source_rows + CHUNK_ROWS - 1) / CHUNK_ROWS )); chunks_dir="$profile_dir/chunks"; mkdir -p "$chunks_dir"
  # If a full-profile aggregate already exists and verifies, continue.
  if node scripts/v3/verify_phase7_checkpoint_v323.js --kind=profile --profile="$profile" --dir="$profile_dir" --contract="$CONTRACT" --manifest="$MANIFEST" >/dev/null 2>&1; then
    echo "  checkpoint reuse: $profile FULL PROFILE PASS"
    continue
  fi
  echo "Heavy profile $ordinal/10: $profile ($source_rows rows / $chunk_count chunks)"
  offset=0; chunk=1
  while (( offset < source_rows )); do
    remaining=$((source_rows-offset)); limit=$CHUNK_ROWS; (( remaining < limit )) && limit=$remaining
    chunk_dir="$chunks_dir/$(printf '%04d_offset_%09d' "$chunk" "$offset")"
    if node scripts/v3/verify_phase7_checkpoint_v323.js --kind=chunk --profile="$profile" --dir="$chunk_dir" --offset="$offset" --limit="$limit" --source-rows="$source_rows" --contract="$CONTRACT" --manifest="$MANIFEST" >/dev/null 2>&1; then
      offset=$((offset+limit)); chunk=$((chunk+1)); continue
    fi
    if (( processed_this_invocation >= CHUNKS_PER_INVOCATION )); then
      node scripts/v3/phase7_resume_state_v323.js --action=checkpoint --state="$STATE_FILE" --profile="$profile" --next-chunk="$chunk" --completed="$processed_this_invocation" --reason=batch-limit \
        --contract="$CONTRACT" --manifest="$MANIFEST" --schema="$SCHEMA" --csv-dir="$CSV_DIR_ACTIVE" --attestation="$ATTESTATION" --output-root="$OUTPUT_ROOT" --chunk-size="$CHUNK_ROWS" --node-heap-mb="$NODE_HEAP_MB" --batch-chunks="$CHUNKS_PER_INVOCATION" >/dev/null
      echo "PHASE7_CHECKPOINT_PENDING"
      echo "RUN_ID=$RUN_ID"
      echo "NEXT_PROFILE=$profile"
      echo "NEXT_CHUNK=$chunk/$chunk_count"
      echo "NEXT_OFFSET=$offset"
      echo "CHUNKS_COMPLETED_THIS_INVOCATION=$processed_this_invocation"
      echo "Re-run the SAME Phase-7 command as a NEW terminal invocation. Exit 75 means checkpoint pending, not acceptance failure."
      exit 75
    fi
    if [[ -d "$chunk_dir" ]]; then archive="$profile_dir/interrupted_chunks/$(basename "$chunk_dir")_$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$(dirname "$archive")"; mv "$chunk_dir" "$archive"; fi
    mkdir -p "$chunk_dir"; log="$chunk_dir/terminal.log"; child_run_id="${RUN_ID}__${profile}__chunk_$(printf '%04d' "$chunk")"
    echo "  running $profile chunk $chunk/$chunk_count (offset=$offset rows=$limit)"
    set +e
    MALLOC_ARENA_MAX=2 node --max-old-space-size="$NODE_HEAP_MB" import.js --dry-run --contract="$CONTRACT" --run-id="$child_run_id" --output-dir="$chunk_dir" --only="$profile" --offset="$offset" --limit="$limit" --scope-source-index --chunk-wrapper --prevalidated-manifest-sha256="$MANIFEST_SHA" >"$log" 2>&1
    child_exit=$?
    set -e
    if [[ "$child_exit" -ne 0 ]]; then echo "STOP: chunk failed profile=$profile chunk=$chunk/$chunk_count exit=$child_exit" >&2; tail -n 120 "$log" >&2 || true; exit "$child_exit"; fi
    node scripts/v3/verify_phase7_checkpoint_v323.js --kind=chunk --profile="$profile" --dir="$chunk_dir" --offset="$offset" --limit="$limit" --source-rows="$source_rows" --contract="$CONTRACT" --manifest="$MANIFEST" >/dev/null
    processed_this_invocation=$((processed_this_invocation+1)); echo "  PASS $profile chunk $chunk/$chunk_count"; sync >/dev/null 2>&1 || true; sleep "$CHUNK_PAUSE_SECONDS"
    offset=$((offset+limit)); chunk=$((chunk+1))
  done
  node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/aggregate_dry_profile_chunks_v323.js --profile="$profile" --profile-dir="$profile_dir" --run-id="$RUN_ID" --source-rows="$source_rows" --chunk-size="$CHUNK_ROWS" --contract="$CONTRACT" --manifest="$MANIFEST" --csv-dir="$CSV_DIR_ACTIVE" >"$profile_dir/aggregate_terminal.json"
  node scripts/v3/verify_phase7_checkpoint_v323.js --kind=profile --profile="$profile" --dir="$profile_dir" --contract="$CONTRACT" --manifest="$MANIFEST" >/dev/null
  echo "  $profile FULL PROFILE PASS ($source_rows/$source_rows)"
done

# All ten profile checkpoints are complete. Finalization is short-lived and strict.
node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/finalize_full_dry_run_checkpointed_v323.js --run-id="$RUN_ID" --node-heap-mb="$NODE_HEAP_MB" --chunk-size="$CHUNK_ROWS" --output-root="$OUTPUT_ROOT" --contract="$CONTRACT" --manifest="$MANIFEST" --schema="$SCHEMA" --csv-dir="$CSV_DIR_ACTIVE"
node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/verify_full_dry_run.js --run-id="$RUN_ID" --output-root="$OUTPUT_ROOT" --contract="$CONTRACT" --manifest="$MANIFEST" --schema="$SCHEMA" --csv-dir="$CSV_DIR_ACTIVE"
node scripts/v3/phase7_resume_state_v323.js --action=complete --state="$STATE_FILE" --contract="$CONTRACT" --manifest="$MANIFEST" --schema="$SCHEMA" --csv-dir="$CSV_DIR_ACTIVE" --attestation="$ATTESTATION" --output-root="$OUTPUT_ROOT" --chunk-size="$CHUNK_ROWS" --node-heap-mb="$NODE_HEAP_MB" --batch-chunks="$CHUNKS_PER_INVOCATION" >/dev/null
printf '\nFULL DRY RUN ACCEPTED\nAPPROVED_DRY_RUN_ID=%s\n' "$RUN_ID"
