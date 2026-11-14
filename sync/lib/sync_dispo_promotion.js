'use strict';
const {pathToFileURL}=require('url');
const normalized=value=>String(value??'').trim().toLowerCase();
function violation(message){throw new Error('SYNC_DISPO_PROMOTION_REFUSED: '+message);}
async function qualify(plan,connection,pending){
 const adapter=process.env.SYNC_LEGACY_DISPO_PROMOTION_ADAPTER;
 if(!adapter)return new Map();
 const implementation=await import(pathToFileURL(adapter).href);
 const grants=await implementation.qualify(plan,connection,pending);
 if(!(grants instanceof Map))violation('Private adapter must return verified grants');
 return grants;
}
async function assertTarget(ctx,table,data){
 const op=ctx.syncOperation||{};
 if(table!=='dispo_form_data'||op.action!=='update'||!op.promotionAuthorized||
    op.promotionApprovedDispo!==normalized(data.dispo_number)||
    op.previousDispo!==op.dispo||op.dispo!==normalized(data.dispo_number)||
    ctx.currentPlanOnlyDispo)
  violation('Unapproved source update attempted to insert a full Dispo parent');
 const handle=ctx.conn||ctx.pool;
 if(!handle)violation('Missing production database connection for Dispo promotion');
 const lock=ctx.dryRun?'':' FOR UPDATE';
 const [planRows]=await handle.query(
  'SELECT dispo_no FROM dispo_plan_form WHERE LOWER(TRIM(dispo_no))=? LIMIT 3'+lock,[op.dispo]);
 if(planRows.length!==1||normalized(planRows[0].dispo_no)!==op.dispo)
  violation('Plan-only parent has been removed or duplicated during sync');
 const [full]=await handle.query('SELECT dispo_number FROM dispo_form_data WHERE LOWER(TRIM(dispo_number))=? LIMIT 2'+lock,[op.dispo]);
 if(full.length)violation('Full parent appeared during sync qualification');
 for(const table of ['warp_yarn_details','weft_yarn_details','warp_broken_section','warp_broken_pattern']){
  const [kids]=await handle.query('SELECT dispo_number FROM `'+table+'` WHERE LOWER(TRIM(dispo_number))=? LIMIT 1'+lock,[op.dispo]);
  if(kids.length)violation('Unexpected existing Dispo child during exact promotion');
 }
 return true;
}
module.exports={qualify,assertTarget};
