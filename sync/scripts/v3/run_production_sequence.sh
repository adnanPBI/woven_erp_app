#!/usr/bin/env bash
set -euo pipefail

TOKEN="${1:-${PRODUCTION_APPROVAL_TOKEN:-}}"
DRY_RUN_ID="${2:-${APPROVED_DRY_RUN_ID:-}}"
if [[ -z "$TOKEN" || "$TOKEN" == CHANGE_* || -z "$DRY_RUN_ID" ]]; then
  echo "Usage: bash scripts/v3/run_production_sequence.sh <approval-token> <accepted-full-dry-run-id>" >&2
  exit 2
fi
node scripts/v3/verify_full_dry_run.js --run-id="$DRY_RUN_ID"
profiles=(pre-costing-bootstrap po dispo yarn-receive yarn-issue warping sizing loom folding greige-delivery)
for profile in "${profiles[@]}"; do
  echo "============================================================"
  echo "Starting production profile: $profile"
  echo "============================================================"
  bash scripts/v3/run_production_profile.sh "$profile" "$TOKEN" "$DRY_RUN_ID"
  echo "Completed production profile: $profile"
done
echo "All production profiles completed without a CLI failure. Run the post-migration SQL verification before declaring success."
