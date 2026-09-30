'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..', '..');
const runner = fs.readFileSync(path.join(root, 'scripts', 'v3', 'run_production_dry_run.sh'), 'utf8');
const aggregate = fs.readFileSync(path.join(root, 'scripts', 'v3', 'aggregate_dry_profile_chunks_v323.js'), 'utf8');
const finalize = fs.readFileSync(path.join(root, 'scripts', 'v3', 'finalize_full_dry_run_checkpointed_v323.js'), 'utf8');

assert(runner.includes('checkpointed resource-bounded full'));
assert(runner.includes('MALLOC_ARENA_MAX=2 node --max-old-space-size="$NODE_HEAP_MB" import.js'));
assert(runner.includes('>"$log" 2>&1'));
assert(runner.includes('aggregate_dry_profile_chunks_v323.js'));
assert(runner.includes('finalize_full_dry_run_checkpointed_v323.js'));
assert(!runner.includes('run_full_dry_run_segmented_v323.js'));
assert(runner.includes('V323_CHUNK_PAUSE_SECONDS'));
assert(aggregate.includes('aggregateChunkedProfile'));
assert(finalize.includes("orchestrationStrategy: 'checkpointed-shell-direct-children'"));
assert(finalize.includes("executionStrategy: 'segmented-per-profile-row-chunks'"));
assert(finalize.includes("const chunkProfiles = new Set(['loom','folding','greige-delivery'])"));
console.log(JSON.stringify({ok:true,test:'checkpointed_shell_chunk500_v323'}, null, 2));
