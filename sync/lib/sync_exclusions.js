'use strict';
const {parseIdentity} = require('./yarn_sync_identity');
const {normalizeYarnLotIdentity} = require('./source_index');
const {candidateKey,verifyIndependentInsert,classifyUnresolvedInsert}=require('./sync_lineage');
const scopedReasons = new Set(['yarn_identity_backfill_required','ambiguous_yarn_edit_or_removal','duplicate_or_ambiguous_yarn_event','yarn_correction_destination_not_unique','ambiguous_edit_key_change_or_deletion']);
class SyncExclusions {
  constructor(entries = [], policy = 'block', lineageContext = null) {
    if (!Array.isArray(entries) || !['block','skip-dispos'].includes(policy)) throw Error('Invalid sync exclusion policy');
    this.entries=entries;this.policy=policy;this.dispos=new Set();this.lots=new Set();
    this.edges=new Map();this.insertHolds=new Set();this.skippedConflicts=[];this.seen=new Set();this.skippedOperations={};
    this.lineageContext=lineageContext;this.verifiedInserts=new Set();
    this.lineageHolds=new Map();this.lineageReasonCounts=new Map();
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
    const relevant=(partial.conflicts||[]).filter(c=>scopedReasons.has(c.reason));
    const wantedUid=new Set([...entries.map(e=>e.sourceUid),...relevant.map(c=>c.sourceUid).filter(Boolean)]);
    const wantedGroup=new Set(relevant.map(c=>c.group).filter(Boolean));
    const wantedRow=new Set(relevant.map(c=>c.rowNumber).filter(Boolean));
    const uidIndex=new Map(),groupIndex=new Map(),rowIndex=new Map();
    const previousAnchorRows=new Set(),currentAnchorRows=new Set(),previousEntries=new Map();
    const currentGroups=new Set();
    const add=(map,key,row)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(row);};
    for(const [isPrevious,rows]of [[true,previous.records],[false,current.records]]){
      for(const row of rows){
        const y=parseIdentity(row.yarnIdentity);if(y)this.edge(row.dispo,y.lot);
        if(!isPrevious)currentGroups.add(row.group);
        if(isPrevious&&wantedUid.has(row.uid)&&!previousEntries.has(row.uid))previousEntries.set(row.uid,row);
        let anchor=false;
        if(wantedUid.has(row.uid)){add(uidIndex,row.uid,row);anchor=true;}
        if(wantedGroup.has(row.group)){add(groupIndex,row.group,row);anchor=true;}
        if(wantedRow.has(row.rowNumber)){add(rowIndex,row.rowNumber,row);anchor=true;}
        if(anchor)(isPrevious?previousAnchorRows:currentAnchorRows).add(row);
      }
    }
    for(const e of entries){
      const row=previousEntries.get(e.sourceUid);
      if(!row||row.digest!==e.digest||row.dispo!==e.dispo)throw Error('Excluded record preimage changed: '+profile+'/'+e.sourceUid);
      this.seen.add(e.sourceUid);this.dispos.add(e.dispo);this.edge(e.dispo,e.lot);
      if(!currentGroups.has(row.group))this.insertHolds.add(profile);
    }
    for(const conflict of relevant){
      const anchors=[...new Set([
        ...(uidIndex.get(conflict.sourceUid)||[]),
        ...(groupIndex.get(conflict.group)||[]),
        ...(rowIndex.get(conflict.rowNumber)||[])
      ])];
      const explicit=entries.some(e=>anchors.some(r=>r.uid===e.sourceUid));
      if(this.policy!=='skip-dispos'&&!explicit)continue;
      if(!anchors.length||anchors.some(r=>!r.dispo))continue;
      for(const row of anchors)this.dispos.add(row.dispo);
      if(anchors.some(r=>previousAnchorRows.has(r))&&!anchors.some(r=>currentAnchorRows.has(r)))this.insertHolds.add(profile);
      this.skippedConflicts.push(conflict);
    }
    // A missing historical event can have been renamed, even if an insert's
    // Dispo existed in the old ledger. The generated source UID is not
    // immutable evidence of a new business event.
    if(this.insertHolds.has(profile)){
      const existingGroups=new Set(current.records.map(r=>r.group));
      const missingOld=previous.records.filter(r=>!existingGroups.has(r.group));
      const missingSet=new Set(missingOld);
      const byUid=new Map(),byGroup=new Map();
      for(const row of previous.records){
        if(row.uid)byUid.set(row.uid,row);
        if(!byGroup.has(row.group))byGroup.set(row.group,[]);
        byGroup.get(row.group).push(row);
      }
      for(const conflict of partial.conflicts||[]){
        if(!scopedReasons.has(conflict.reason))continue;
        const related=[
          ...(conflict.sourceUid&&byUid.has(conflict.sourceUid)?[byUid.get(conflict.sourceUid)]:[]),
          ...(byGroup.get(conflict.group)||[])
        ];
        for(const row of related)if(!missingSet.has(row)){
          missingSet.add(row);missingOld.push(row);
        }
      }
      for(const row of partial.operations[profile]||[]){
        if(row.action!=='insert')continue;
        if(!row.dispo)throw Error('Cannot bound an insert while a source key is excluded: '+profile);
        const key=candidateKey(profile,row);
        const proof=this.lineageContext?.proofs?.get(key);
        const allowed=verifyIndependentInsert(proof,profile,row,this.lineageContext);
        if(allowed){
          this.verifiedInserts.add(key);
          continue;
        }
        const reason=classifyUnresolvedInsert(profile,row,missingOld,null).risk;
        this.lineageHolds.set(key,reason);
        this.lineageReasonCounts.set(reason,(this.lineageReasonCounts.get(reason)||0)+1);
        // Preserve dependency closure for unresolved records, not for proven
        // independent inserts. Never release a held Dispo or yarn lot.
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
        const hold=this.dispos.has(r.dispo)||this.dispos.has(r.previousDispo)||(y&&this.lots.has(normalizeYarnLotIdentity(y.lot)))||(r.action==='insert'&&this.insertHolds.has(profile)&&!this.verifiedInserts.has(candidateKey(profile,r)));
        if(hold)skippedOperations[profile]=(skippedOperations[profile]||0)+1;
        else if(r.action==='insert')plan.added++;else if(r.action==='update')plan.updated++;else if(r.action==='refresh')plan.refreshed++;
        return !hold;
      });
    }
    for(const [profile,count]of Object.entries(skippedOperations))this.skippedOperations[profile]=Math.max(this.skippedOperations[profile]||0,count);
    plan.exclusions={policy:this.policy,explicitRecords:this.entries.length,dispos:[...this.dispos].sort(),yarnLots:[...this.lots].sort(),insertHoldProfiles:[...this.insertHolds],lineageUnverifiedInserts:this.lineageHolds.size,
      verifiedIndependentInserts:this.verifiedInserts.size,
      lineageReasons:Object.fromEntries([...this.lineageReasonCounts].sort(([a],[b])=>a.localeCompare(b))),
      skippedConflicts:this.skippedConflicts,skippedOperations:{...this.skippedOperations}};
    return plan;
  }
}
module.exports={SyncExclusions};
