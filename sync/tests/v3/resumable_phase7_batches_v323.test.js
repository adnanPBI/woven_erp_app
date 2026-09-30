'use strict';
const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');const cp=require('child_process');const crypto=require('crypto');
const root=path.resolve(__dirname,'..','..');
const run=fs.readFileSync(path.join(root,'scripts','v3','run_production_dry_run.sh'),'utf8');
assert(run.includes('V323_PHASE7_CHUNKS_PER_INVOCATION'));
assert(run.includes('PHASE7_CHECKPOINT_PENDING'));
assert(run.includes('exit 75'));
assert(run.includes('V323_RESUME_RUN_ID'));
assert(run.includes('verify_phase7_checkpoint_v323.js'));
assert(run.includes('phase7_resume_state_v323.js'));
assert(!run.includes('while true')); // prevents accidental self-loop under one cPanel entry process
cp.execFileSync('bash',['-n',path.join(root,'scripts','v3','run_production_dry_run.sh')]);
cp.execFileSync(process.execPath,['--check',path.join(root,'scripts','v3','phase7_resume_state_v323.js')]);
cp.execFileSync(process.execPath,['--check',path.join(root,'scripts','v3','verify_phase7_checkpoint_v323.js')]);
console.log('resumable Phase-7 batch architecture PASS');
