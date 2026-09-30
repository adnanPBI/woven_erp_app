'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const packageRoot = path.resolve(root, '..');
for (const file of [
  path.join(root, 'import.js'),
  path.join(root, 'scripts/validate_contract_v2.js'),
  path.join(packageRoot, 'import_mapper_vis/visual-map-server.js'),
]) {
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes('override: false'), `${path.basename(file)} must preserve explicit shell/cPanel environment values`);
  assert.ok(!text.includes('override: true'), `${path.basename(file)} still overwrites protected environment values`);
}
const runtime = fs.readFileSync(path.join(root, 'lib/mapping_contract_runtime.js'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'scripts/v3/run_production_profile.sh'), 'utf8');
assert.ok(runtime.includes("ctx.args['allow-production-db']"));
assert.ok(runner.includes('--allow-production-db'));
console.log('protected_env_v322.test.js: PASS');
