'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const {inventory, planEdits, applyReviewedReassignments} = require('../lib/sheets_sync_plan');
const {hydrateIdentities, yarnKey} = require('../lib/yarn_sync_identity');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yarn-identity-'));
  const profile = {id: 'yarn-issue', source_file: 'issue.csv', header_row: 0};
  const headers = ['Yarn Count','Yarn Lot','Issue Date','Dispo No','S/R/Challan No','Warp','Weft','Delivery Place','__MIG_SOURCE_UID'];
  const base = ['30','001','2026-10-01','NHTML/NDSD/GD/26/00123','C1','100','','Factory','original'];
  const edit = (row, changes) => row.map((value, i) => changes[headers[i]] ?? value);
  async function inv(rows) {
    fs.writeFileSync(path.join(dir, profile.source_file), [headers, ...rows].map(r => r.join(',')).join('\n') + '\n');
    return inventory(dir, [profile]);
  }
  const plan = async (a, b) => planEdits(await inv(a), await inv(b));
  try {
    const weft = edit(base, {Warp:'', Weft:'50', __MIG_SOURCE_UID:'weft'});
    let result = await plan([base,weft], [edit(weft,{Weft:'-10'}), edit(base,{Warp:'125'})]);
    assert(result.ok); assert.equal(result.updated,2); assert.equal(result.added,0);
    assert.equal(result.operations[profile.id].find(r=>r.rowNumber===2).uid,'weft');
    const current = await inv([edit(weft,{Weft:'-10'}), edit(base,{Warp:'125'})]);
    const stored = {[profile.id]: {headersHash:current[profile.id].headersHash, records:result.operations[profile.id].map(r=>({...r,yarnIdentity:JSON.stringify(r.yarnIdentity)}))}};
    result = planEdits(stored, current); assert(result.ok); assert.equal(result.added+result.updated,0);
    for (const field of ['Yarn Count','Yarn Lot']) {
      result = await plan([base], [edit(base,{[field]:'002',Warp:'80'})]);
      assert(result.ok); assert.equal(result.updated,1); assert.equal(result.added,0);
      assert.equal(result.operations[profile.id][0].uid,'original');
    }
    result = await plan([base], [weft]); assert(result.ok); assert.equal(result.updated,1);
    result = await plan([base], [edit(base,{Warp:'0'})]); assert(result.ok); assert.equal(result.updated,1);
    result = await plan([base], [edit(base,{'Issue Date':'2026-10-02',Warp:'85'})]); assert(result.ok); assert.equal(result.updated,1);
    result = await plan([base], [base,edit(base,{'S/R/Challan No':'C2',Warp:'25'})]);
    assert(result.ok); assert.equal(result.added,1,'Distinct challan is a new event');
    result = await plan([base], [base,edit(base,{Warp:'125'})]);
    assert(!result.ok,'Old and revised totals present together must not create another row');
    result = await plan([], [base,base]); assert(!result.ok,'Duplicate source rows must not be inserted');
    result = await plan([base], [base,base]); assert(!result.ok,'Additional duplicate occurrence must not be inserted');
    for (const prefix of ['YTML','SWML','SCML','NHTML2']) {
      const other = edit(base,{'Dispo No':`${prefix}/NDSD/GD/26/00123`});
      result = await plan([base], [base,other]); assert(result.ok); assert.equal(result.added,1);
      result = await plan([base], [other]); assert(!result.ok,'Prefix reassignment needs explicit review');
    }
    result = await plan([base], [edit(base,{'Dispo No':'NHTML/NDSD/GD/26/123'})]); assert(!result.ok,'Leading zeros remain significant');
    result = await plan([base], [edit(base,{'Dispo No':' nhtml/ndsd/gd/26/00123 ',Warp:'80'})]); assert(result.ok); assert.equal(result.updated,1);
    const before = await inv([base]), after = await inv([edit(base,{Warp:'85'})]);
    const legacy = structuredClone(before); delete legacy[profile.id].records[0].yarnIdentity;
    result = planEdits(legacy,after); assert(!result.ok); assert(result.conflicts.some(c=>c.reason==='yarn_identity_backfill_required'));
    assert.equal(hydrateIdentities(legacy[profile.id],after[profile.id]).length,0,'Changed snapshot cannot backfill old identity');
    assert.equal(hydrateIdentities(legacy[profile.id],before[profile.id]).length,1);
    const signatureLegacy=structuredClone(before);delete signatureLegacy[profile.id].records[0].yarnIdentity;
    const deliveryChanged=await inv([edit(base,{'Delivery Place':'Other factory'})]);
    assert.equal(hydrateIdentities(signatureLegacy[profile.id],deliveryChanged[profile.id]).length,1,'Exact invariant signature proves identity after non-identity edit');
    assert.equal(signatureLegacy[profile.id].records[0].yarnIdentity.dispo,base[3].toLowerCase());
    const ambiguousLegacy=structuredClone(before);delete ambiguousLegacy[profile.id].records[0].yarnIdentity;
    const conflicting=structuredClone(deliveryChanged[profile.id]);conflicting.records.push({...conflicting.records[0],yarnIdentity:{...conflicting.records[0].yarnIdentity,dispo:'other'}});
    assert.equal(hydrateIdentities(ambiguousLegacy[profile.id],conflicting).length,0,'Conflicting signature evidence must not hydrate');
    result = planEdits(legacy,after); assert(result.ok); assert.equal(result.updated,1);
    const blank = edit(base,{'Yarn Lot':''});
    result = await plan([blank],[edit(blank,{Warp:'85'})]); assert(!result.ok,'Incomplete identity cannot guess a quantity correction');
    const noChallan = edit(base,{'S/R/Challan No':''});
    result = await plan([noChallan],[edit(noChallan,{Warp:'85'})]); assert(result.ok);assert.equal(result.updated,1);
    result = await plan([noChallan],[noChallan,edit(noChallan,{Warp:'85'})]); assert(!result.ok);
    const another = edit(base,{'Yarn Lot':'002',__MIG_SOURCE_UID:'second'});
    result = await plan([base,another],[another,edit(base,{'Yarn Lot':'002',Warp:'85'})]);
    assert(!result.ok,'Correction cannot create a duplicate destination event');
    const split = await inv([edit(base,{Warp:'60'}),edit(base,{Warp:'40'})]);
    const a=before[profile.id].records[0],b=split[profile.id].records[0];
    const reviewed=applyReviewedReassignments(profile.id,structuredClone(before[profile.id]),split[profile.id],[{profile:profile.id,sourceUid:a.uid,oldGroup:a.group,oldDigest:a.digest,newGroup:b.group,newDigest:b.digest}]);
    result=planEdits({[profile.id]:reviewed},split); assert(result.ok); assert.equal(result.updated,1); assert.equal(result.added,1);
    assert.notEqual(yarnKey(a.yarnIdentity),yarnKey({...a.yarnIdentity,lot:'1'}),'Lot leading zeros remain significant');
    const receipt={id:'yarn-receive',source_file:'issue.csv',header_row:0};
    const receiveHeaders=['Yarn Count','Yarn brand','Yarn Lot','Received Date','Received GD NO','Challan No','Receipt Qty (Kgs)','Floor Return in kg','__MIG_SOURCE_UID'];
    const receive=['30','Brand','001','2026-10-01','SCML/26/123','C1','100','0','receipt-original'];
    const receiveInv=async rows=>{
      fs.writeFileSync(path.join(dir,receipt.source_file),[receiveHeaders,...rows].map(r=>r.join(',')).join('\n')+'\n');
      return inventory(dir,[receipt]);
    };
    const receiveBefore=await receiveInv([receive]), received=[...receive];received[6]='75';received[7]='10';
    result=planEdits(receiveBefore,await receiveInv([received]));assert(result.ok);assert.equal(result.updated,1);assert.equal(result.added,0);
    assert.equal(result.operations[receipt.id][0].uid,'receipt-original');
    received[4]='SWML/26/123';result=planEdits(receiveBefore,await receiveInv([received]));assert(!result.ok);
    console.log('Yarn identity regressions passed: quantities, direction, full prefixes, count/lot corrections, event separation, duplicate rejection, legacy upgrade, reviewed splits and replay.');
  } finally {
    fs.unlinkSync(path.join(dir, profile.source_file)); fs.rmdirSync(dir);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
