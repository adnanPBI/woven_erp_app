'use strict';
const {parseIdentity} = require('./yarn_sync_identity');
const {normalizeYarnLotIdentity} = require('./source_index');
const scopedReasons = new Set(['yarn_identity_backfill_required','ambiguous_yarn_edit_or_removal','duplicate_or_ambiguous_yarn_event','yarn_correction_destination_not_unique','ambiguous_edit_key_change_or_deletion']);
class SyncExclusions {
  constructor(entries = [], policy = 'block') {
    if (!Array.isArray(entries) || !['block','skip-dispos'].includes(policy)) throw Error('Invalid sync exclusion policy');
    this.entries=entries;this.policy=policy;this.dispos=new Set();this.lots=new Set();
    this.edges=new Map();this.insertHolds=new Set();this.skippedConflicts=[];this.seen=new Set();this.skippedOperations={};
    for(const e of entries)if(!e.profile||!e.sourceUid||!e.digest||!e.dispo)throw Error('Incomplete fingerprint-bound exclusion');
  }
  edge(dispo,lot) {
    lot=normalizeYarnLotIdentity(lot);
    if(!dispo||!lot)return;
    const a='d:'+dispo,b='l:'+lot;
    for(const [from,to]of [[a,b],[b,a]]){if(!this.edges.has(from))this.edges.set(from,new Set());this.edges.get(from).add(to);}
  }
  inspect(profile,previous,current,partial) {
    const entries=this.entries.filter(e=>e.profile===profile);
    for(const e of entries){
      const row=previous.records.find(r=>r.uid===e.sourceUid);
      if(!row||row.digest!==e.digest||row.dispo!==e.dispo)throw Error('Excluded record preimage changed: '+profile+'/'+e.sourceUid);
      this.seen.add(e.sourceUid);this.dispos.add(e.dispo);this.edge(e.dispo,e.lot);
      if(!current.records.some(r=>r.group===row.group))this.insertHolds.add(profile);
    }
    for(const row of [...previous.records,...current.records]){
      const y=parseIdentity(row.yarnIdentity);if(y)this.edge(row.dispo,y.lot);
    }
    for(const conflict of partial.conflicts){
      if(!scopedReasons.has(conflict.reason))continue;
      const anchors=[...previous.records,...current.records].filter(r=>
        (conflict.sourceUid&&r.uid===conflict.sourceUid)||(conflict.group&&r.group===conflict.group)||
        (conflict.rowNumber&&r.rowNumber===conflict.rowNumber));
      const explicit=entries.some(e=>anchors.some(r=>r.uid===e.sourceUid));
      if(this.policy!=='skip-dispos'&&!explicit)continue;
      if(!anchors.length||anchors.some(r=>!r.dispo))continue; // Unbounded/schema conflicts still block.
      for(const row of anchors)this.dispos.add(row.dispo);
      if(previous.records.some(r=>anchors.includes(r))&&!current.records.some(r=>anchors.includes(r)))this.insertHolds.add(profile);
      this.skippedConflicts.push(conflict);
    }
    // A removed old key has no proven replacement. Hold new inserts in that
    // profile too, so a changed Dispo cannot slip through as a duplicate.
    if(this.insertHolds.has(profile))for(const row of partial.operations[profile]||[]){
      if(row.action==='insert'){
        if(!row.dispo)throw Error('Cannot bound an insert while a source key is excluded: '+profile);
        this.dispos.add(row.dispo);
      }
    }
  }
  seal() {
    if(this.seen.size!==new Set(this.entries.map(e=>e.sourceUid)).size)throw Error('Excluded source profile missing');
    const pending=[...this.dispos].map(d=>'d:'+d),visited=new Set(pending);
    for(let i=0;i<pending.length;i++)for(const next of this.edges.get(pending[i])||[]){if(!visited.has(next)){visited.add(next);pending.push(next);}}
    for(const key of visited){if(key.startsWith('d:'))this.dispos.add(key.slice(2));else this.lots.add(key.slice(2));}
  }
  filter(plan) {
    const key=c=>JSON.stringify(c),skippedKeys=new Set(this.skippedConflicts.map(key));
    plan.conflicts=plan.conflicts.filter(c=>!skippedKeys.has(key(c)));plan.ok=plan.conflicts.length===0;
    plan.added=0;plan.updated=0;plan.refreshed=0;const skippedOperations={};
    for(const [profile,rows]of Object.entries(plan.operations)){
      plan.operations[profile]=rows.filter(r=>{
        const y=parseIdentity(r.yarnIdentity);
        const hold=this.dispos.has(r.dispo)||this.dispos.has(r.previousDispo)||(y&&this.lots.has(normalizeYarnLotIdentity(y.lot)))||(r.action==='insert'&&this.insertHolds.has(profile));
        if(hold)skippedOperations[profile]=(skippedOperations[profile]||0)+1;
        else if(r.action==='insert')plan.added++;else if(r.action==='update')plan.updated++;else if(r.action==='refresh')plan.refreshed++;
        return !hold;
      });
    }
    for(const [profile,count]of Object.entries(skippedOperations))this.skippedOperations[profile]=Math.max(this.skippedOperations[profile]||0,count);
    plan.exclusions={policy:this.policy,explicitRecords:this.entries.length,dispos:[...this.dispos].sort(),yarnLots:[...this.lots].sort(),insertHoldProfiles:[...this.insertHolds],skippedConflicts:this.skippedConflicts,skippedOperations:{...this.skippedOperations}};
    return plan;
  }
}
module.exports={SyncExclusions};
