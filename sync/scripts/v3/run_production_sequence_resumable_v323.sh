#!/usr/bin/env bash
set -euo pipefail
NODE_HEAP_MB="${V323_NODE_HEAP_MB:-256}"
CHUNK_ROWS="${V323_CHUNK_ROWS:-500}"
MAX_CHUNKS="${V323_LIVE_CHUNKS_PER_INVOCATION:-10}"
PAUSE_SECONDS="${V323_LIVE_CHUNK_PAUSE_SECONDS:-1}"
TOKEN="${1:-${PRODUCTION_APPROVAL_TOKEN:-}}"
DRY_RUN_ID="${2:-${APPROVED_DRY_RUN_ID:-}}"
SEQUENCE_ID="${3:-${V323_LIVE_SEQUENCE_ID:-}}"
CONTRACT="${MAPPING_CONTRACT_FILE:-mappings/mapping-contract-v2.json}"
MANIFEST="${SOURCE_MANIFEST_FILE:-$(pwd)/source-manifest.json}"
OUTPUT_ROOT="${CLI_CONTRACT_OUTPUT_ROOT:-$(pwd)/output/mapping_contract_v2}"
CSV_DIR_ACTIVE="${CSV_DIR:-$(pwd)/csv_files}"
EVIDENCE_DIR="${EVIDENCE:-/home/weavonpq/v323_preflight_evidence}"
profiles=(pre-costing-bootstrap po dispo yarn-receive yarn-issue warping sizing loom folding greige-delivery)
heavy_profiles=" dispo yarn-receive yarn-issue warping sizing loom folding greige-delivery "

if [[ -z "$TOKEN" || "$TOKEN" == CHANGE_* || -z "$DRY_RUN_ID" || -z "$SEQUENCE_ID" ]]; then echo "Usage: ... <approval-token> <accepted-dry-run-id> <sequence-id>" >&2; exit 2; fi
if [[ ! "$SEQUENCE_ID" =~ ^[A-Za-z0-9._-]{1,96}$ ]]; then echo "Invalid sequence id." >&2; exit 2; fi
if [[ "$CHUNK_ROWS" != "500" ]]; then echo "V323_CHUNK_ROWS must be 500." >&2; exit 2; fi
if ! [[ "$MAX_CHUNKS" =~ ^[0-9]+$ ]] || (( MAX_CHUNKS < 1 || MAX_CHUNKS > 20 )); then echo "V323_LIVE_CHUNKS_PER_INVOCATION must be 1..20." >&2; exit 2; fi
if [[ "${ALLOW_PRODUCTION_DB:-false}" != "true" || "${BACKUP_CONFIRMED:-false}" != "true" ]]; then echo "Live gates are not enabled in this shell." >&2; exit 3; fi
mkdir -p "$EVIDENCE_DIR" "$OUTPUT_ROOT/live_resumable"
export V323_LIVE_SEQUENCE_ID="$SEQUENCE_ID" PRODUCTION_APPROVAL_TOKEN="$TOKEN" APPROVED_DRY_RUN_ID="$DRY_RUN_ID"

node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/validate_source_manifest.js --approved >/dev/null
node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/verify_full_dry_run.js --run-id="$DRY_RUN_ID" >/dev/null
node scripts/v3/live_resume_state_v323.js --action=init --sequence-id="$SEQUENCE_ID" --dry-run-id="$DRY_RUN_ID" --token="$TOKEN" >/dev/null
LIVE_ROOT="$OUTPUT_ROOT/live_resumable/$SEQUENCE_ID"
MANIFEST_SHA="$(sha256sum "$MANIFEST" | awk '{print $1}')"
ACCEPTANCE_FILE="$OUTPUT_ROOT/$DRY_RUN_ID/full_dry_run_acceptance.json"
test -s "$ACCEPTANCE_FILE" || { echo "Accepted dry-run evidence missing: $ACCEPTANCE_FILE" >&2; exit 4; }
ACCEPTANCE_SHA="$(sha256sum "$ACCEPTANCE_FILE" | awk '{print $1}')"

source_rows_for(){ node - "$1" "$MANIFEST" "$CONTRACT" <<'NODE'
const fs=require('fs'); const [id,mf,cf]=process.argv.slice(2); const m=JSON.parse(fs.readFileSync(mf,'utf8')),c=JSON.parse(fs.readFileSync(cf,'utf8')); const p=(c.profiles||[]).find(x=>x.id===id); const e=(m.files||[]).find(x=>x.filename===p?.source_file); const n=Number(e?.nonempty_rows); if(!Number.isFinite(n))process.exit(2); process.stdout.write(String(n));
NODE
}
archive_partial(){ local d="$1"; if [[ -d "$d" ]]; then mkdir -p "$LIVE_ROOT/failed_attempts"; mv "$d" "$LIVE_ROOT/failed_attempts/$(basename "$d")_$(date -u +%Y%m%dT%H%M%SZ)_$$"; fi; }
profile_ok(){ local p="$1" d="$2" rows="$3"; node scripts/v3/verify_live_checkpoint_v323.js --mode=profile --profile="$p" --dir="$d" --manifest-sha256="$MANIFEST_SHA" --dry-run-id="$DRY_RUN_ID" --source-rows="$rows" >/dev/null 2>&1; }
chunk_ok(){ local p="$1" d="$2" rows="$3" off="$4" lim="$5"; node scripts/v3/verify_live_checkpoint_v323.js --mode=chunk --profile="$p" --dir="$d" --manifest-sha256="$MANIFEST_SHA" --dry-run-id="$DRY_RUN_ID" --source-rows="$rows" --offset="$off" --limit="$lim" >/dev/null 2>&1; }

for idx in "${!profiles[@]}"; do
  profile="${profiles[$idx]}"; num=$((idx+1)); rows="$(source_rows_for "$profile")"; profile_dir="$LIVE_ROOT/profiles/$(printf '%02d' "$num")_${profile}"; mkdir -p "$(dirname "$profile_dir")"
  if [[ "$heavy_profiles" == *" $profile "* ]]; then
    if [[ -s "$profile_dir/live_chunk_index.json" ]]; then
      if node scripts/v3/verify_live_heavy_index_v323.js --profile="$profile" --live-root="$profile_dir" --source-rows="$rows" --manifest-sha256="$MANIFEST_SHA" --dry-run-id="$DRY_RUN_ID" >/dev/null 2>&1; then
        echo "checkpoint reuse: $profile FULL PROFILE PASS"
        continue
      fi
      echo "STOP: existing heavy-profile aggregate failed integrity verification: $profile" >&2
      exit 22
    fi
    if [[ "$profile" == "dispo" ]]; then
      node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/verify_live_dispo_chunk_safety_v323.js --profile="$profile" --dry-run-id="$DRY_RUN_ID" --output-root="$OUTPUT_ROOT" --contract="$CONTRACT" --manifest="$MANIFEST" --csv-dir="$CSV_DIR_ACTIVE" --chunk-size="$CHUNK_ROWS" >/dev/null
    elif [[ "$profile" == "yarn-receive" || "$profile" == "yarn-issue" || "$profile" == "warping" || "$profile" == "sizing" ]]; then
      node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/verify_live_provenance_chunk_safety_v323.js --profile="$profile" --dry-run-id="$DRY_RUN_ID" --output-root="$OUTPUT_ROOT" --contract="$CONTRACT" --manifest="$MANIFEST" --csv-dir="$CSV_DIR_ACTIVE" --chunk-size="$CHUNK_ROWS" >/dev/null
    else
      node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/verify_live_chunk_safety_v323.js --profile="$profile" --dry-run-id="$DRY_RUN_ID" --output-root="$OUTPUT_ROOT" --contract="$CONTRACT" --manifest="$MANIFEST" --csv-dir="$CSV_DIR_ACTIVE" --chunk-size="$CHUNK_ROWS" >/dev/null
    fi
    mkdir -p "$profile_dir/chunks"
    chunk_count=$(( (rows + CHUNK_ROWS - 1) / CHUNK_ROWS )); completed=0
    SCAN_JSON="$(node scripts/v3/scan_live_profile_chunks_v323.js --profile="$profile" --live-root="$profile_dir" --source-rows="$rows" --chunk-size="$CHUNK_ROWS" --manifest-sha256="$MANIFEST_SHA" --dry-run-id="$DRY_RUN_ID")"
    read -r next_chunk next_offset partial_dir all_complete <<<"$(printf '%s' "$SCAN_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s); process.stdout.write(`${j.nextChunk} ${j.nextOffset} ${j.partialDir||"-"} ${j.allComplete?"true":"false"}`)})')"
    if [[ "$partial_dir" != "-" ]]; then archive_partial "$partial_dir"; fi
    if (( next_chunk > chunk_count )); then
      node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/aggregate_live_profile_chunks_v323.js --profile="$profile" --live-root="$profile_dir" --source-rows="$rows" --chunk-size="$CHUNK_ROWS" --manifest-sha256="$MANIFEST_SHA" --approved-dry-run-id="$DRY_RUN_ID" > "$profile_dir/live_chunk_aggregate_terminal.json"
      echo "$profile FULL PROFILE PASS ($rows/$rows)"
      node scripts/v3/live_resume_state_v323.js --action=checkpoint --sequence-id="$SEQUENCE_ID" --dry-run-id="$DRY_RUN_ID" --token="$TOKEN" --profile="$profile" --kind=profile-complete --message=heavy-profile-aggregated --inc-invocation=1 >/dev/null
      echo "LIVE_SEQUENCE_CHECKPOINT_PENDING"; echo "NEXT_PROFILE=$((num+1))/10"; exit 75
    fi
    echo "Heavy live profile $num/10: $profile ($rows rows / $chunk_count chunks); starting chunk $next_chunk"
    c=$next_chunk; off=$next_offset
    while (( c <= chunk_count && completed < MAX_CHUNKS )); do
      lim=$CHUNK_ROWS; rem=$((rows-off)); (( rem < lim )) && lim=$rem
      d="$profile_dir/chunks/$(printf '%04d_offset_%09d' "$c" "$off")"
      if [[ -d "$d" ]]; then archive_partial "$d"; fi
      mkdir -p "$d"; run_id="live_${SEQUENCE_ID}_${profile}_chunk_$(printf '%04d' "$c")"; log="$d/terminal.log"
      set +e
      scope_args=()
      # Preserve full immutable source-index semantics for the medium provenance-backed
      # profiles. Only the historically validated heavy profiles use Dispo-scoped indexes.
      if [[ "$profile" == "loom" || "$profile" == "folding" || "$profile" == "greige-delivery" ]]; then
        scope_args+=(--scope-source-index)
      fi
      node --max-old-space-size="$NODE_HEAP_MB" import.js --live --yes --backup-confirmed --allow-production-db --production-approval="$TOKEN" --approved-dry-run="$DRY_RUN_ID" --contract="$CONTRACT" --only="$profile" --offset="$off" --limit="$lim" "${scope_args[@]}" --chunk-wrapper --prevalidated-manifest-sha256="$MANIFEST_SHA" --prevalidated-dry-run-acceptance-sha256="$ACCEPTANCE_SHA" --run-id="$run_id" --output-dir="$d" >"$log" 2>&1
      e=$?; set -e
      if [[ $e -ne 0 ]]; then echo "STOP: live chunk failed profile=$profile chunk=$c exit=$e" >&2; tail -n 100 "$log" >&2 || true; exit $e; fi
      chunk_ok "$profile" "$d" "$rows" "$off" "$lim" || { echo "STOP: completed chunk evidence failed validation: $profile#$c" >&2; exit 20; }
      echo "  PASS $profile chunk $c/$chunk_count (offset=$off rows=$lim)"
      completed=$((completed+1)); off=$((off+lim)); c=$((c+1)); sleep "$PAUSE_SECONDS"
    done
    if (( c > chunk_count )); then
      node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/aggregate_live_profile_chunks_v323.js --profile="$profile" --live-root="$profile_dir" --source-rows="$rows" --chunk-size="$CHUNK_ROWS" --manifest-sha256="$MANIFEST_SHA" --approved-dry-run-id="$DRY_RUN_ID" > "$profile_dir/live_chunk_aggregate_terminal.json"
      echo "$profile FULL PROFILE PASS ($rows/$rows)"
      node scripts/v3/live_resume_state_v323.js --action=checkpoint --sequence-id="$SEQUENCE_ID" --dry-run-id="$DRY_RUN_ID" --token="$TOKEN" --profile="$profile" --kind=profile-complete --message=heavy-profile-aggregated --inc-invocation=1 >/dev/null
      echo "LIVE_SEQUENCE_CHECKPOINT_PENDING"; exit 75
    fi
    node scripts/v3/live_resume_state_v323.js --action=checkpoint --sequence-id="$SEQUENCE_ID" --dry-run-id="$DRY_RUN_ID" --token="$TOKEN" --profile="$profile" --kind=chunk-batch --next-chunk="$c" --message="completed-$completed-chunks" --inc-invocation=1 >/dev/null
    echo "LIVE_SEQUENCE_CHECKPOINT_PENDING"; echo "NEXT_PROFILE=$profile"; echo "NEXT_CHUNK=$c/$chunk_count"; echo "CHUNKS_COMPLETED_THIS_INVOCATION=$completed"; exit 75
  else
    if [[ -d "$profile_dir" ]] && profile_ok "$profile" "$profile_dir" "$rows"; then echo "checkpoint reuse: $profile PASS"; continue; fi
    [[ -d "$profile_dir" ]] && archive_partial "$profile_dir"
    mkdir -p "$profile_dir"
    echo "Running live profile $num/10: $profile ($rows rows)"
    set +e
    node --max-old-space-size="$NODE_HEAP_MB" import.js --live --yes --backup-confirmed --allow-production-db --production-approval="$TOKEN" --approved-dry-run="$DRY_RUN_ID" --contract="$CONTRACT" --only="$profile" --run-id="live_${SEQUENCE_ID}_${profile}" --output-dir="$profile_dir" >"$profile_dir/terminal.log" 2>&1
    e=$?; set -e
    if [[ $e -ne 0 ]]; then echo "STOP: live profile failed: $profile exit=$e" >&2; tail -n 100 "$profile_dir/terminal.log" >&2 || true; exit $e; fi
    profile_ok "$profile" "$profile_dir" "$rows" || { echo "STOP: live profile evidence failed validation: $profile" >&2; exit 21; }
    echo "PASS live profile $profile ($rows/$rows)"
    node scripts/v3/live_resume_state_v323.js --action=checkpoint --sequence-id="$SEQUENCE_ID" --dry-run-id="$DRY_RUN_ID" --token="$TOKEN" --profile="$profile" --kind=profile-complete --message=safe-profile-complete --inc-invocation=1 >/dev/null
    echo "LIVE_SEQUENCE_CHECKPOINT_PENDING"; echo "NEXT_PROFILE=$((num+1))/10"; exit 75
  fi
done

node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/validate_source_manifest.js --approved >/dev/null
node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/verify_full_dry_run.js --run-id="$DRY_RUN_ID" >/dev/null
FINAL_JSON="$(node scripts/v3/finalize_live_sequence_v323.js --sequence-id="$SEQUENCE_ID" --live-root="$LIVE_ROOT" --dry-run-id="$DRY_RUN_ID")"
echo "$FINAL_JSON"
ACCEPTANCE_PATH="$(printf '%s' "$FINAL_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s); if(!j.ok)process.exit(1); process.stdout.write(j.acceptancePath)})')"
node scripts/v3/live_resume_state_v323.js --action=complete --sequence-id="$SEQUENCE_ID" --dry-run-id="$DRY_RUN_ID" --token="$TOKEN" --acceptance-path="$ACCEPTANCE_PATH" >/dev/null
echo "LIVE SEQUENCE ACCEPTED"
echo "LIVE_SEQUENCE_ID=$SEQUENCE_ID"
echo "LIVE_SEQUENCE_ACCEPTANCE=$ACCEPTANCE_PATH"
exit 0
