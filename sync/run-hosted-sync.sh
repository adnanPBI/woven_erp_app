#!/bin/bash
set -euo pipefail
umask 077
# Hosting-specific installation paths. Adapt a reviewed PRIVATE copy for a new
# account; changing Git does not install this wrapper or update protected pins.
ROOT=/home/weavonpq/sheets_live_sync_20261011
export PATH=/home/weavonpq/nodevenv/public_html/main/24/bin:/usr/local/cpanel/bin:/usr/bin:/bin
export NODE_OPTIONS=--max-old-space-size=768
exec 9>"$ROOT/scheduler.lock"
# Keep the descriptor open for the whole worker. An overlapping interval exits
# successfully without starting work; exit 0 alone is not a completed cycle.
/usr/bin/flock -n 9 || exit 0
cd "$ROOT"
LOG="$ROOT/scheduler.log"
recovery_preflight_failure() {
  kind="$1"
  # Preserve cron stderr visibility without creating a fake scheduler cycle.
  printf 'SYNC_PREFLIGHT_FAILURE %s category=%s\n' "$(date -u +%FT%TZ)" "$kind" >&2
  # Metadata is optional and must never bypass protected source/config checks.
  if [ "$kind" = hosting-capacity ] && [ -f "$ROOT/.env.sync" ] && [ -f "$ROOT/scripts/sync/recovery_status.js" ]; then
    node scripts/sync/recovery_status.js --env="$ROOT/.env.sync" --preflight-failed=hosting-capacity >/dev/null 2>&1 || true
  fi
  exit 1
}
if ! sha256sum -c protection.sha256 >/dev/null; then
  printf 'SYNC_PREFLIGHT_FAILURE %s category=integrity\n' "$(date -u +%FT%TZ)" >&2
  exit 1
fi
# A previously verified source checkpoint cannot override an independently
# confirmed physical duplicate. The pinned critical hold blocks both --check
# and live cron starts until an exact owner-reviewed correction is audited.
if [ -f "$ROOT/auto_sync_data/critical-incident-hold.json" ]; then
  printf 'SYNC_PREFLIGHT_FAILURE %s category=source-identity-incident-hold\n' "$(date -u +%FT%TZ)" >&2
  exit 1
fi
# Never rebuild this manifest to accept unknown changes. Update only authorized
# source/config fingerprints while preserving the remaining policy/data pins.
# The hosting quota is separate from the filesystem reserve checked by the worker.
if ! quota_json=$(/usr/bin/uapi --output=json Quota get_quota_info); then
  recovery_preflight_failure hosting-capacity
fi
if ! printf '%s' "$quota_json" | node -e 'let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const r=JSON.parse(s).result,q=r.data;if(r.status!==1||String(q.under_quota_overall)!=="1"||Number(q.megabytes_remain)<=3072)throw Error("Hosting account has insufficient sync reserve");}catch(e){console.error(e.message);process.exitCode=1;}});'; then
  recovery_preflight_failure hosting-capacity
fi
if [ "${1:-}" = "--check" ]; then
  printf 'Scheduler preflight passed.\n'
  exit 0
fi
LOG="$ROOT/scheduler.log"
# Integrity/quota failures happen BEFORE SYNC_START and may reach cron stderr
# only. Keep hosting notifications enabled and inspect worker status as well.
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 5242880 ]; then
  [ ! -f "$LOG.1" ] || mv "$LOG.1" "$LOG.2"
  mv "$LOG" "$LOG.1"
fi
# Node owns start/final events: shared hosting may end this shell before the
# detached worker finishes. Do not duplicate or infer terminal events here.
if node scripts/sync/run.js --env="$ROOT/.env.sync" --scheduler-events >> "$LOG" 2>&1; then
  exit 0
else
  code=$?
  # Preserve the worker exit code and make post-start failure visible in the
  # same event stream as starts/successes. This matches the deployed wrapper.
  tail -n 20 "$LOG" >&2
  exit "$code"
fi
