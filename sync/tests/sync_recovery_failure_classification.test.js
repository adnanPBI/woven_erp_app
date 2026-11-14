'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {categorize}=require('../lib/sync_recovery_v2');
test('historical peer date-drift classified as identity',()=>{
 assert.equal(categorize(new Error('Historical peer receipt retention: source peer changed or disappeared'),'planning'),'source-identity');
});
test('unbound Dispo parent classified as planning conflict',()=>{
 assert.equal(categorize(new Error('SYNC_UPDATE_TARGET_MISSING: source update has no verified existing business parent'),'dry-run'),'planning-conflict');
});
test('fetch errors retain download type',()=>{
 assert.equal(categorize(new Error('Deadline-or-abort'),'fetching'),'source-download');
});
