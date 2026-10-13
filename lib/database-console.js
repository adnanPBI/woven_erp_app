'use strict';
// Only explicitly listed business tables can be read. Accounts, sessions,
// import internals and credentials are never exposed through this router.
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const TABLES = [
  'pre_costing_data','warp_details','weft_details','PO_form_data','dispo_form_data',
  'dispo_plan_form','warp_broken_pattern','warp_broken_section','warp_yarn_details',
  'weft_yarn_details','yarn_receive_form','yarn_received_details','yarn_requirements_details',
  'yarn_issue_form','yarn_issue_details','dyed_yarn_receive','dyed_yarn_breakdown',
  'dyed_yarn_issue','dyed_yarn_issue_breakdown','warping_form','warping_breakdown',
  'sizing_form','sizing_breakdown','loom_production_form','loom_production_breakdown',
  'floor_position','folding_production_form','folding_production_breakdown',
  'greige_delivery_form','greige_delivery_breakdown','finish_receive_form',
  'finish_receive_breakdown','finish_delivery_form','finish_delivery_breakdown',
  'order_closing_reports','production_timeline','order_summary_stats'
];
// These fields have no quantity, ledger identity, financial or aggregate effect.
// Business quantity corrections must use the validated source/form workflow.
const TEXT_EDITS = {
  PO_form_data: ['special_note'], warping_form: ['remarks'], sizing_form: ['remarks'],
  loom_production_form: ['remarks'], greige_delivery_form: ['special_note']
};
const WINDOWS = { '1h': 3600000, '3h':10800000, '7h':25200000, '24h':86400000, '3d':259200000 };
const quote = name => '`' + name.replace(/`/g,'``') + '`';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g,'');
const label = name => name.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
function positive(value) { if (!/^\d+$/.test(String(value)) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) fail(400,'Invalid user.'); return Number(value); }
function fingerprint(row) { return hash(Object.keys(row).sort().map(k=>[k,row[k]])); }
function keyFor(schema, row) { return Object.fromEntries(schema.pk.map(k=>[k,row[k]])); }
function validateKey(schema, key) {
  if (!key || Array.isArray(key) || !schema.pk.length || Object.keys(key).sort().join('|') !== [...schema.pk].sort().join('|')) fail(400,'A complete unique row key is required.');
  for (const v of Object.values(key)) if (!['string','number'].includes(typeof v) || String(v).length > 255) fail(400,'Invalid row key.');
  return schema.pk.map(k=>key[k]);
}
function parseHistory(text, now = Date.now()) {
  const runs = []; let run;
  for (const line of text.split(/\r?\n/)) {
    const start = /^SYNC_START (\S+)$/.exec(line);
    if (start && Number.isFinite(Date.parse(start[1]))) {
      run = { id:hash(start[1]), startedAt:start[1], endedAt:null, status:'unconfirmed', added:null, updated:null, refreshed:null };
      runs.push(run); continue;
    }
    if (!run) continue;
    const success = /^SYNC_SUCCESS (\S+)$/.exec(line);
    if (success && Number.isFinite(Date.parse(success[1]))) { run.endedAt=success[1];run.status='success';continue; }
    if (/^SYNC_FAILURE\b|FATAL ERROR|heap out of memory|^Error:/.test(line)) run.status='failed';
    if (line.startsWith('{')) { try {
      const value=JSON.parse(line);
      if ((value.readOnly === false || value.status === 'completed') && Number.isInteger(value.added) && Number.isInteger(value.updated)) {
        run.added=value.added;run.updated=value.updated;run.refreshed=Number.isInteger(value.refreshed)?value.refreshed:null;
        run.workerReported=true;
      }
    } catch (_) { /* Partial log lines are not evidence of completion. */ } }
  }
  for (let i=0;i<runs.length;i++) {
    const r=runs[i];r.gapMinutes=i?Math.round((Date.parse(r.startedAt)-Date.parse(runs[i-1].startedAt))/6000)/10:null;
    if (r.status==='unconfirmed' && i===runs.length-1 && now-Date.parse(r.startedAt)<12*60000) r.status='running';
    if (r.status==='success' && r.added===0 && r.updated===0 && !r.refreshed) r.status='unchanged';
  }
  return runs;
}
async function readBounded(file, limit) {
  const stat=await fs.stat(file);if (!stat.isFile() || stat.size>limit) throw Error('Evidence file is too large.');
  return fs.readFile(file,'utf8');
}
function createRouter({express,pool,syncRoot,owners=[],historyClearEnabled=false,expectedDatabase='weavonpq_weaving_main'}) {
  const router=express.Router();
  const ownerNames=new Set(owners);
  const wrap=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res,next)).catch(next);
  let schemaCache;
  async function schemas() {
    if (schemaCache && Date.now()-schemaCache.at<60000) return schemaCache.value;
    const [[identity]]=await pool.query('SELECT DATABASE() name');
    if(identity.name!==expectedDatabase) fail(503,'Database identity check failed.');
    const [cols]=await pool.query('SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,DATA_TYPE,COLUMN_KEY,CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION');
    const value={};
    for(const name of TABLES){ const columns=cols.filter(c=>c.TABLE_NAME===name);if(!columns.length)continue;
      value[name]={name,label:label(name),columns,pk:columns.filter(c=>c.COLUMN_KEY==='PRI').map(c=>c.COLUMN_NAME),editable:(TEXT_EDITS[name]||[]).filter(k=>columns.some(c=>c.COLUMN_NAME===k))};
    }
    schemaCache={at:Date.now(),value};return value;
  }
  async function schema(name) { const s=(await schemas())[name];if(!s || !TABLES.includes(name))fail(404,'Business table not available.');return s; }
  async function audit(c,user,action,table,key,detail) {
    await c.query('INSERT INTO erp_console_audit (actor_id,action,table_name,row_key,details_json) VALUES (?,?,?,?,?)',[user.id,action,table||null,key?JSON.stringify(key):null,JSON.stringify(detail)]);
  }
  router.use(wrap(async(req,res,next)=>{
    res.set('Cache-Control','no-store');
    const id=req.session?.user?.id;if(!id)fail(401,'Please sign in.');
    // Read the current database role on every request; revoked roles take effect immediately.
    const [[user]]=await pool.query('SELECT id,username,role FROM users WHERE id=?',[id]);
    if(!user)fail(401,'Account no longer available.');
    req.consoleUser={...user,manager:user.role==='admin'||ownerNames.has(user.username)};
    if(!req.consoleUser.manager){ const [[access]]=await pool.query('SELECT can_view FROM erp_console_access WHERE user_id=?',[id]);if(!access?.can_view)fail(403,'Ask Admin or Owner for Database & Sync History access.'); }
    if(!req.session.consoleCsrf)req.session.consoleCsrf=crypto.randomBytes(32).toString('hex');
    if(!['GET','HEAD'].includes(req.method)){
      const token=req.get('X-Console-CSRF');
      if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||!crypto.timingSafeEqual(Buffer.from(token),Buffer.from(req.session.consoleCsrf)))fail(403,'Refresh this window before making changes.');
      if(!req.is('application/json'))fail(415,'JSON request required.');
      if(req.get('Sec-Fetch-Site')==='cross-site')fail(403,'Cross-site changes are not allowed.');
    }
    next();
  }));
  const manager=req=>{if(!req.consoleUser.manager)fail(403,'Admin or Owner access required.');};
  router.get('/info',wrap(async(req,res)=>res.json({database:expectedDatabase,manager:req.consoleUser.manager,role:ownerNames.has(req.consoleUser.username)?'Owner':req.consoleUser.role,csrf:req.session.consoleCsrf,historyClearEnabled,tables:Object.values(await schemas()).map(s=>({name:s.name,label:s.label,editable:s.editable,hasUniqueKey:!!s.pk.length})),editingScope:'Locks govern edits in this database viewer. Existing ERP form permissions and Google Sheets synchronization continue separately. Quantity, identity, computed and historical records use the original source/form correction workflow.'})));
  router.get('/access',wrap(async(req,res)=>{manager(req);const [users]=await pool.query('SELECT u.id,u.username,u.role,COALESCE(a.can_view,0) can_view FROM users u LEFT JOIN erp_console_access a ON a.user_id=u.id ORDER BY u.username');res.json({users:users.map(u=>({...u,manager:u.role==='admin'||ownerNames.has(u.username)}))});}));
  router.post('/access',wrap(async(req,res)=>{manager(req);const userId=positive(req.body.userId);if(typeof req.body.canView!=='boolean')fail(400,'Choose access on or off.');
    const c=await pool.getConnection();try{await c.beginTransaction();const [[user]]=await c.query('SELECT id,username,role FROM users WHERE id=? FOR UPDATE',[userId]);if(!user)fail(404,'User not found.');if(user.role==='admin'||ownerNames.has(user.username))fail(400,'Admin and Owner retain management access.');
      await c.query('INSERT INTO erp_console_access (user_id,can_view,granted_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE can_view=VALUES(can_view),granted_by=VALUES(granted_by)',[userId,req.body.canView?1:0,req.consoleUser.id]);
      if(!req.body.canView)await c.query('DELETE FROM erp_console_row_grants WHERE user_id=?',[userId]);
      await audit(c,req.consoleUser,'access',null,null,{userId,canView:req.body.canView});await c.commit();res.json({ok:true});
    }catch(e){await c.rollback();throw e;}finally{c.release();}
  }));
  async function protection() {
    try{
      const status=JSON.parse(await readBounded(path.join(syncRoot,'sync_data/status.json'),65536));
      if(!['completed','unchanged'].includes(status.status)||!Number.isFinite(Date.parse(status.at))||Date.now()-Date.parse(status.at)>30*60000)fail(423,'Editing is locked until fresh sync protection evidence is available.');
      const cycle=path.resolve(status.cycle||'');const cycles=path.resolve(syncRoot,'sync_data/cycles')+path.sep;if(!cycle.startsWith(cycles))fail(423,'Invalid protection evidence.');
      const plan=JSON.parse(await readBounded(path.join(cycle,'plan.json'),32*1024*1024));
      const policy=JSON.parse(await readBounded(path.join(syncRoot,'protection-policy.json'),1024*1024));
      if(plan.ok!==true||!Array.isArray(plan.exclusions?.dispos)||policy.heldCases?.length!==42||policy.originalExclusions?.length!==14)fail(423,'Protection evidence is incomplete.');
      return new Set([...plan.exclusions.dispos,...policy.heldCases.map(c=>c.dispo),...(policy.seedDispos||[])].map(normalize));
    }catch(e){if(e.status)throw e;fail(423,'Editing is locked because protection evidence cannot be verified.');}
  }
  function eligibility(s,row,held) {
    if(!s.pk.length)return 'This table has no unique row key; use its ERP form.';
    if(!s.editable.length)return 'Use the original source/form to correct quantities, identities or calculated values.';
    const dispos=Object.entries(row).filter(([k])=>/^(dispo_number|dispo_no)$/.test(k)).map(([,v])=>normalize(v)).filter(Boolean);
    if(!dispos.length || dispos.some(d=>!/^[-a-z0-9_]+(?:\/[-a-z0-9_]+){2,}$/.test(d)||held.has(d)))return 'This row is protected by reconciliation holds or lacks a verified Dispo.';
    const dates=s.columns.filter(c=>c.DATA_TYPE==='date').map(c=>row[c.COLUMN_NAME]).filter(Boolean).map(String);
    if(!dates.length || dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||d<'2024-01-01'))return 'Historical rows or rows without a verified business date remain locked.';
    return null;
  }
  // Cast dates to text for stable keys and optimistic concurrency fingerprints.
  const select=s=>s.columns.map(c=>['date','datetime','timestamp','time'].includes(c.DATA_TYPE)?`CAST(${quote(c.COLUMN_NAME)} AS CHAR) AS ${quote(c.COLUMN_NAME)}`:quote(c.COLUMN_NAME)).join(',');
  const where=s=>s.pk.map(k=>`${quote(k)} <=> ?`).join(' AND ');
  router.get('/rows/:table',wrap(async(req,res)=>{
    const s=await schema(req.params.table);const offset=Number(req.query.offset||0);if(!Number.isInteger(offset)||offset<0||offset>1000000)fail(400,'Invalid page.');
    const q=String(req.query.q||'').trim();if(q.length>100)fail(400,'Search is too long.');
    const search=s.columns.filter(c=>['varchar','char','text'].includes(c.DATA_TYPE)).slice(0,25);
    const args=[];let filter='';if(q){if(!search.length)fail(400,'This table has no searchable text columns.');filter=' WHERE '+search.map(c=>`LOCATE(?,${quote(c.COLUMN_NAME)})>0`).join(' OR ');search.forEach(()=>args.push(q));}
    const order=s.pk.length?s.pk:s.columns.slice(0,1).map(c=>c.COLUMN_NAME);
    const [rows]=await pool.query(`SELECT ${select(s)} FROM ${quote(s.name)}${filter} ORDER BY ${order.map(quote).join(',')} LIMIT 51 OFFSET ?`,[...args,offset]);
    let held,protectionError;try{held=await protection();}catch(e){protectionError=e.message;}
    const [grants]=await pool.query('SELECT row_hash,user_id FROM erp_console_row_grants WHERE table_name=? AND user_id=?',[s.name,req.consoleUser.id]);const mine=new Set(grants.map(g=>g.row_hash));
    res.json({columns:s.columns.map(c=>c.COLUMN_NAME),editable:s.editable,offset,hasMore:rows.length>50,rows:rows.slice(0,50).map(row=>{const key=keyFor(s,row);const reason=protectionError||eligibility(s,row,held);return{values:row,key,fingerprint:fingerprint(row),canEdit:!reason&&mine.has(hash(key)),lockReason:reason||'Locked until Admin or Owner grants this row to you.',eligible:!reason};})});
  }));
  router.post('/row-access/:table',wrap(async(req,res)=>{
    manager(req);const s=await schema(req.params.table),values=validateKey(s,req.body.key);const lock=req.body.lock===true;
    const userId=lock?null:positive(req.body.userId);const c=await pool.getConnection();
    try{await c.beginTransaction();const [rows]=await c.query(`SELECT ${select(s)} FROM ${quote(s.name)} WHERE ${where(s)} FOR UPDATE`,values);if(rows.length!==1)fail(404,'Row not found.');
      if(!lock){const held=await protection();const reason=eligibility(s,rows[0],held);if(reason)fail(423,reason);
        const [[u]]=await c.query('SELECT u.username,u.role,COALESCE(a.can_view,0) can_view FROM users u LEFT JOIN erp_console_access a ON a.user_id=u.id WHERE u.id=?',[userId]);if(!u || !(u.can_view||u.role==='admin'||ownerNames.has(u.username)))fail(400,'Grant viewing access first.');}
      const rowHash=hash(keyFor(s,rows[0]));
      if(lock)await c.query('DELETE FROM erp_console_row_grants WHERE table_name=? AND row_hash=?',[s.name,rowHash]);
      else await c.query('INSERT INTO erp_console_row_grants (table_name,row_hash,user_id,granted_by) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE granted_by=VALUES(granted_by)',[s.name,rowHash,userId,req.consoleUser.id]);
      await audit(c,req.consoleUser,lock?'lock-row':'grant-row',s.name,req.body.key,{userId});await c.commit();res.json({ok:true});
    }catch(e){await c.rollback();throw e;}finally{c.release();}
  }));
  router.post('/edit/:table',wrap(async(req,res)=>{
    const s=await schema(req.params.table),values=validateKey(s,req.body.key);const edits=req.body.changes;
    if(!edits||Array.isArray(edits)||!Object.keys(edits).length||Object.keys(edits).some(k=>!s.editable.includes(k)))fail(400,'Only the displayed note fields can be edited here.');
    for(const [k,v]of Object.entries(edits)){if(typeof v!=='string'||Buffer.byteLength(v,'utf8')>10000)fail(400,'Notes must be text no longer than 10,000 bytes.');}
    const c=await pool.getConnection();let locked=false,transaction=false;
    try{
      const [[lock]]=await c.query('SELECT GET_LOCK(?,0) acquired',['weaving_sheets_sync_'+expectedDatabase]);if(lock.acquired!==1)fail(423,'Sync is running. Try again after it finishes.');locked=true;
      await c.beginTransaction();transaction=true;
      const [[user]]=await c.query('SELECT username,role FROM users WHERE id=? FOR UPDATE',[req.consoleUser.id]);if(!user)fail(403,'Access revoked.');
      if(user.role!=='admin'&&!ownerNames.has(user.username)){const [[access]]=await c.query('SELECT can_view FROM erp_console_access WHERE user_id=? FOR UPDATE',[req.consoleUser.id]);if(!access?.can_view)fail(403,'Access revoked.');}
      const [rows]=await c.query(`SELECT ${select(s)} FROM ${quote(s.name)} WHERE ${where(s)} FOR UPDATE`,values);if(rows.length!==1)fail(404,'Row not found.');
      const row=rows[0],reason=eligibility(s,row,await protection());if(reason)fail(423,reason);
      const [[grant]]=await c.query('SELECT user_id FROM erp_console_row_grants WHERE table_name=? AND row_hash=? AND user_id=? FOR UPDATE',[s.name,hash(keyFor(s,row)),req.consoleUser.id]);if(!grant)fail(403,'This row is locked. Ask Admin or Owner for edit access.');
      if(req.body.fingerprint!==fingerprint(row))fail(409,'This row changed after you opened it. Refresh before editing.');
      await c.query(`UPDATE ${quote(s.name)} SET ${Object.keys(edits).map(k=>quote(k)+'=?').join(',')} WHERE ${where(s)}`,[...Object.values(edits),...values]);
      const [after]=await c.query(`SELECT ${select(s)} FROM ${quote(s.name)} WHERE ${where(s)}`,values);
      await audit(c,req.consoleUser,'edit-row',s.name,req.body.key,{before:Object.fromEntries(Object.keys(edits).map(k=>[k,row[k]])),after:Object.fromEntries(Object.keys(edits).map(k=>[k,after[0][k]])),fingerprintBefore:fingerprint(row),fingerprintAfter:fingerprint(after[0])});
      await c.commit();transaction=false;res.json({ok:true});
    }catch(e){if(transaction)await c.rollback();throw e;}finally{try{if(locked)await c.query('SELECT RELEASE_LOCK(?)',['weaving_sheets_sync_'+expectedDatabase]);}finally{c.release();}}
  }));
  async function historyData(userId) {
    const logs=[];for(const name of ['scheduler.log.2','scheduler.log.1','scheduler.log']){try{logs.push(await readBounded(path.join(syncRoot,name),6*1024*1024));}catch(e){if(e.code!=='ENOENT')throw e;}}
    const now=Date.now();const all=parseHistory(logs.join('\n'),now);
    const [clears]=await pool.query('SELECT CAST(from_at AS CHAR) from_at,CAST(to_at AS CHAR) to_at FROM erp_console_history_clears WHERE user_id=?',[userId]);
    const visible=all.filter(r=>!clears.some(c=>Date.parse(r.startedAt)>=Date.parse(c.from_at+'Z')&&Date.parse(r.startedAt)<=Date.parse(c.to_at+'Z')));
    const [[meta]]=await pool.query('SELECT UNIX_TIMESTAMP(enabled_at) enabled_epoch FROM erp_sync_history_meta WHERE id=1');
    const captureStartedAt=meta?new Date(Number(meta.enabled_epoch)*1000).toISOString():null;
    const [counts]=await pool.query('SELECT run_id,MIN(UNIX_TIMESTAMP(created_at)) first_epoch,MAX(UNIX_TIMESTAMP(created_at)) last_epoch,action,SUM(affected_rows) count FROM erp_sync_row_changes WHERE created_at>=FROM_UNIXTIME(?) GROUP BY run_id,action',[all.length?Date.parse(all[0].startedAt)/1000:now/1000]);
    for(let i=0;i<all.length;i++){
      const r=all[i];r.until=all[i+1]?.startedAt||new Date(now).toISOString();r.detailsAvailable=!!captureStartedAt&&Date.parse(r.startedAt)>=Date.parse(captureStartedAt);
      if(r.detailsAvailable){r.rowCounts={added:0,updated:0,deleted:0};for(const c of counts)if(Number(c.first_epoch)*1000>=Date.parse(r.startedAt)&&Number(c.last_epoch)*1000<Date.parse(r.until))r.rowCounts[c.action]+=Number(c.count);}
    }
    let lastStatus=null;try{const s=JSON.parse(await readBounded(path.join(syncRoot,'sync_data/status.json'),65536));lastStatus={status:s.status,at:s.at,added:s.added,updated:s.updated};}catch(_){}
    return {runs:visible.slice(-500).reverse(),captureStartedAt,totalAvailable:all.length,clearedForYou:all.length-visible.length,lastStatus,intervalMinutes:10,timezone:'Asia/Dhaka',latestStart:all.at(-1)?.startedAt||null,stale:!all.length||now-Date.parse(all.at(-1).startedAt)>20*60000,retention:'Available retained scheduler logs; missing completion markers remain unconfirmed. Clearing this view does not remove source logs, audit records or business data.'};
  }
  router.get('/history',wrap(async(req,res)=>res.json(await historyData(req.consoleUser.id))));
  router.get('/history/changes',wrap(async(req,res)=>{
    const history=await historyData(req.consoleUser.id),run=history.runs.find(r=>r.id===req.query.run);
    if(!run)fail(404,'Run not available in your displayed history.');if(!run.detailsAvailable)fail(404,'Row details were not captured for this older run.');
    const offset=Number(req.query.offset||0);if(!Number.isInteger(offset)||offset<0||offset>1000000)fail(400,'Invalid page.');
    const [rows]=await pool.query('SELECT id,UNIX_TIMESTAMP(created_at) at_epoch,run_id,profile,table_name,action,row_key,identity_scope,affected_rows,changed_columns,before_json,after_json,dispo,source_file,source_row,source_action,note FROM erp_sync_row_changes WHERE created_at>=FROM_UNIXTIME(?) AND created_at<FROM_UNIXTIME(?) ORDER BY id LIMIT 51 OFFSET ?',[Date.parse(run.startedAt)/1000,Date.parse(run.until)/1000,offset]);
    const decode=v=>typeof v==='string'?JSON.parse(v):v;
    res.json({hasMore:rows.length>50,rows:rows.slice(0,50).map(r=>({id:r.id,at:new Date(Number(r.at_epoch)*1000).toISOString(),runId:r.run_id,profile:r.profile,table:r.table_name,action:r.action,key:decode(r.row_key),identityScope:r.identity_scope,affectedRows:r.affected_rows,changedColumns:decode(r.changed_columns),before:decode(r.before_json),after:decode(r.after_json),dispo:r.dispo,sourceFile:r.source_file,sourceRow:r.source_row,sourceAction:r.source_action,note:r.note}))});
  }));
  router.post('/history/clear',wrap(async(req,res)=>{
    manager(req);if(!historyClearEnabled)fail(409,'History clearing awaits the owner’s choice of deletion behavior.');
    const period=WINDOWS[req.body.period];if(!period)fail(400,'Choose one of the five displayed periods.');if(req.body.confirm!=='CLEAR_HISTORY_ONLY')fail(400,'Confirm clearing history only.');
    const to=new Date(),from=new Date(to.getTime()-period);const c=await pool.getConnection();try{await c.beginTransaction();
      await c.query('INSERT INTO erp_console_history_clears (user_id,from_at,to_at) VALUES (?,?,?)',[req.consoleUser.id,from.toISOString().slice(0,19).replace('T',' '),to.toISOString().slice(0,19).replace('T',' ')]);
      await audit(c,req.consoleUser,'clear-history-view',null,null,{from:from.toISOString(),to:to.toISOString(),period:req.body.period});await c.commit();res.json({ok:true});
    }catch(e){await c.rollback();throw e;}finally{c.release();}
  }));
  router.get('/audit',wrap(async(req,res)=>{manager(req);const [rows]=await pool.query('SELECT a.id,a.actor_id,u.username,a.action,a.table_name,a.row_key,a.details_json,UNIX_TIMESTAMP(a.created_at) created_epoch FROM erp_console_audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100');res.json({rows:rows.map(r=>({...r,createdAt:new Date(Number(r.created_epoch)*1000).toISOString()}))});}));
  router.use((err,req,res,next)=>{if(res.headersSent)return next(err);if(!err.status)console.error('Database console error:',err.code||err.name);res.status(err.status||503).json({error:err.status?err.message:'Database tools are temporarily unavailable. Please try again.'});});
  return router;
}
module.exports={createRouter,parseHistory,fingerprint,validateKey,TABLES,TEXT_EDITS,WINDOWS};
