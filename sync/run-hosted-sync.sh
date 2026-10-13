#!/bin/bash
set -euo pipefail
umask 077
ROOT=/home/weavonpq/sheets_live_sync_20261011
export PATH=/home/weavonpq/nodevenv/public_html/main/24/bin:/usr/local/cpanel/bin:/usr/bin:/bin
export NODE_OPTIONS=--max-old-space-size=768
exec 9>"$ROOT/scheduler.lock"
/usr/bin/flock -n 9 || exit 0
cd "$ROOT"
sha256sum -c protection.sha256 >/dev/null
# The hosting quota is separate from the filesystem reserve checked by the worker.
quota_json=$(/usr/bin/uapi --output=json Quota get_quota_info)
printf '%s' "$quota_json" | node -e 'let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const r=JSON.parse(s).result,q=r.data;if(r.status!==1||String(q.under_quota_overall)!=="1"||Number(q.megabytes_remain)<=3072)throw Error("Hosting account has insufficient sync reserve");}catch(e){console.error(e.message);process.exitCode=1;}});'
if [ "${1:-}" = "--check" ]; then
  printf 'Scheduler preflight passed.\n'
  exit 0
fi
LOG="$ROOT/scheduler.log"
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 5242880 ]; then
  [ ! -f "$LOG.1" ] || mv "$LOG.1" "$LOG.2"
  mv "$LOG" "$LOG.1"
fi
printf '\nSYNC_START %s\n' "$(date -u +%FT%TZ)" >> "$LOG"
if node scripts/sync/run.js --env="$ROOT/.env.sync" >> "$LOG" 2>&1; then
  printf 'SYNC_SUCCESS %s\n' "$(date -u +%FT%TZ)" >> "$LOG"
else
  code=$?
  tail -n 20 "$LOG" >&2
  exit "$code"
fi
