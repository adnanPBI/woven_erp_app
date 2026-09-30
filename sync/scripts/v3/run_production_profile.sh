#!/usr/bin/env bash
set -euo pipefail
NODE_HEAP_MB="${V323_NODE_HEAP_MB:-256}"

PROFILE="${1:-}"
TOKEN="${2:-${PRODUCTION_APPROVAL_TOKEN:-}}"
DRY_RUN_ID="${3:-${APPROVED_DRY_RUN_ID:-}}"
CONTRACT="${MAPPING_CONTRACT_FILE:-mappings/mapping-contract-v2.json}"

if [[ -z "$PROFILE" ]]; then
  echo "Usage: bash scripts/v3/run_production_profile.sh <profile> <approval-token> <accepted-full-dry-run-id>" >&2
  exit 2
fi
case "$PROFILE" in
  pre-costing-bootstrap|po|dispo|yarn-receive|yarn-issue|warping|sizing|loom|folding|greige-delivery) ;;
  *) echo "Invalid profile: $PROFILE" >&2; exit 2 ;;
esac
if [[ -z "$TOKEN" || "$TOKEN" == CHANGE_* ]]; then echo "A real production approval token is required." >&2; exit 3; fi
if [[ -z "$DRY_RUN_ID" ]]; then echo "An accepted full dry-run ID is required." >&2; exit 4; fi
if [[ "${BACKUP_CONFIRMED:-false}" != "true" ]]; then echo "Set BACKUP_CONFIRMED=true only after downloading a fresh database backup." >&2; exit 5; fi
if [[ "${ALLOW_PRODUCTION_DB:-false}" != "true" ]]; then echo "Set ALLOW_PRODUCTION_DB=true in the protected CLI environment." >&2; exit 6; fi

case "$PROFILE" in
  loom|folding|greige-delivery)
    exec bash scripts/v3/run_production_profile_chunked_v323.sh "$PROFILE" "$TOKEN" "$DRY_RUN_ID"
    ;;
esac

node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/validate_source_manifest.js --approved
node --max-old-space-size="$NODE_HEAP_MB" scripts/v3/verify_full_dry_run.js --run-id="$DRY_RUN_ID"
printf 'LIVE PRODUCTION IMPORT: %s (accepted dry run: %s)\n' "$PROFILE" "$DRY_RUN_ID"
exec node --max-old-space-size="$NODE_HEAP_MB" import.js \
  --live --yes --backup-confirmed --allow-production-db \
  --production-approval="$TOKEN" \
  --approved-dry-run="$DRY_RUN_ID" \
  --contract="$CONTRACT" \
  --only="$PROFILE"
