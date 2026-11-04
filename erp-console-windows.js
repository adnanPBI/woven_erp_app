/* Weaving ERP: independent Sync History and Database workspace.
 * The existing server-side RBAC, CSRF, row locks, and API routes are preserved.
 * Neither window uses Bootstrap's blocking modal backdrop.
 */
(function () {
'use strict';
document.addEventListener('DOMContentLoaded', function () {
  const workspace = document.getElementById('erp-console-workspace');
  const taskbar = document.getElementById('erp-console-taskbar');
  const openDatabase = document.getElementById('openDatabaseBtn');
  const openHistory = document.getElementById('openSyncHistoryBtn');
  if (!workspace || !taskbar || !openDatabase || !openHistory) return;
  const els = {
    database: document.getElementById('erp-console-window-database'),
    history: document.getElementById('erp-console-window-history')
  };
  const tasks = {
    database: document.getElementById('erp-console-task-database'),
    history: document.getElementById('erp-console-task-history')
  };
  let topZ = 2;
  let foreground = null;
  const sessions = {};
  const state = {
    database: { created: false, minimized: false, maximized: true, zoom: 100 },
    history: { created: false, minimized: false, maximized: true, zoom: 100 }
  };
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const modeNames = { database: 'Database', history: 'Sync history' };

  function refreshTaskbar() {
    taskbar.hidden = !Object.values(state).some(s => s.created);
    for (const mode of Object.keys(els)) {
      const s = state[mode], task = tasks[mode];
      task.hidden = !s.created;
      task.classList.toggle('is-active', s.created && !s.minimized && mode === foreground);
      task.classList.toggle('is-minimized',s.minimized);
      task.setAttribute('aria-pressed',String(s.created && !s.minimized && mode === foreground));
      task.setAttribute('aria-label',s.minimized ? 'Restore '+modeNames[mode] : 'Switch to '+modeNames[mode]);
    }
  }
  function focusPanel(mode) {
    if (!state[mode].created || state[mode].minimized) return;
    foreground = mode;
    els[mode].style.zIndex = String(++topZ);
    refreshTaskbar();
  }
  function minimize(mode) {
    const s=state[mode];if(!s.created)return;
    s.minimized=true;els[mode].hidden=true;
    foreground=Object.keys(state).find(k=>k!==mode&&state[k].created&&!state[k].minimized)||null;
    if(foreground)focusPanel(foreground);else refreshTaskbar();
    openDatabase.focus && document.activeElement===els[mode] && openDatabase.focus();
  }
  function restore(mode) {
    const s=state[mode];if(!s.created)return;
    s.minimized=false;els[mode].hidden=false;
    focusPanel(mode);
    els[mode].focus({preventScroll:true});
  }
  function close(mode) {
    const s=state[mode];if(!s.created)return;
    s.created=false;s.minimized=false;els[mode].hidden=true;
    sessions[mode].clear();
    foreground=Object.keys(state).find(k=>k!==mode&&state[k].created&&!state[k].minimized)||null;
    if(foreground)focusPanel(foreground);else refreshTaskbar();
  }
  function resetAll() {
    for(const mode of Object.keys(state)){
      state[mode].created=false;state[mode].minimized=false;
      els[mode].hidden=true; tasks[mode].hidden=true;
      sessions[mode]?.clear();
    }
    foreground=null;refreshTaskbar();
    openDatabase.hidden=true;openHistory.hidden=true;
  }
  window.resetDatabaseToolsWindows=resetAll;

  function zoomPanel(mode,nextZoom) {
    const s=state[mode],val=clamp(Math.round(nextZoom/10)*10,70,150);
    s.zoom=val;
    const root=els[mode],scalable=root.querySelector('[data-console-scalable]');
    scalable.style.zoom=val+'%';
    root.querySelector('[data-console-zoom]').textContent=val+'%';
    for(const button of root.querySelectorAll('[data-console-action]')){
      const act=button.dataset.consoleAction;
      if(act==='zoom-out')button.disabled=val===70;
      if(act==='zoom-in')button.disabled=val===150;
    }
    sessions[mode].refreshHorizontalSlider();
  }
  function toggleMaximize(mode) {
    const s=state[mode];s.maximized=!s.maximized;
    const root=els[mode],button=root.querySelector('[data-console-action="maximize"]');
    root.classList.toggle('is-maximized',s.maximized);
    button.title=s.maximized?'Restore window size':'Maximize window';
    button.setAttribute('aria-label',button.title+' '+modeNames[mode]);
    const glyph=button.querySelector('.erp-console-control-glyph');
    glyph.textContent=s.maximized?'▣':'□';
    sessions[mode].refreshHorizontalSlider();
    focusPanel(mode);
  }
  function enableDragging(mode) {
    const win=els[mode],title=win.querySelector('[data-console-drag-handle]');
    let dragging=null;
    title.addEventListener('pointerdown',e=>{
      if(e.button!==0 || state[mode].maximized || e.target.closest('button'))return;
      dragging={x:e.clientX,y:e.clientY,left:win.offsetLeft,top:win.offsetTop};
      focusPanel(mode);
      title.setPointerCapture(e.pointerId);
    });
    title.addEventListener('pointermove',e=>{
      if(!dragging)return;
      const maxX=Math.max(0,window.innerWidth-140),maxY=Math.max(0,window.innerHeight-100);
      win.style.left=clamp(dragging.left+e.clientX-dragging.x,0,maxX)+'px';
      win.style.top=clamp(dragging.top+e.clientY-dragging.y,0,maxY)+'px';
    });
    const done=()=>{dragging=null};
    title.addEventListener('pointerup',done);
    title.addEventListener('pointercancel',done);
    title.addEventListener('dblclick',e=>{
      if(!e.target.closest('button'))toggleMaximize(mode);
    });
  }
  function createSession(mode) {
    const root=els[mode];
    const refs={
      databaseToolsBody:'[data-console-content]',
      databaseToolsMessage:'[data-console-message]',
      databaseToolsIdentity:'[data-console-identity]',
      databaseColumnSlider:'[data-console-column-slider]',
      databaseHorizontalScroll:'[data-console-horizontal-scroll]',
      databaseToolsTitle:'[id="erp-console-title-'+mode+'"]'
    };
    const $=id=>root.querySelector(refs[id]||'[id="'+CSS.escape(id)+'"]');
    let info,page=0,currentRow,currentTable,loadVersion=0,scrollTarget,scrollObserver;
    let loaded=false,loading=null,generation=0,historyVersion=0;
    const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
    const date=value=>value?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'medium',timeZone:'Asia/Dhaka'}).format(new Date(value)):'—';
    async function api(route,body) {
        const response=await fetch('/main/api/database-console'+route,{credentials:'same-origin',cache:'no-store',method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Console-CSRF':info?.csrf||''},body:body===undefined?undefined:JSON.stringify(body)});
        const data=await response.json().catch(()=>({}));if(response.status===401){window.resetDatabaseToolsWindows?.();throw Error('Your ERP session expired. Sign in again.');}if(!response.ok)throw Error(data.error||'Unable to complete the request.');return data;
    }
    const showError=e=>{$('databaseToolsMessage').textContent=e.message;$('databaseToolsMessage').className='alert alert-danger';};
    async function action(fn) { $('databaseToolsMessage').textContent='';$('databaseToolsMessage').className='';try{await fn();}catch(e){showError(e);} }
    const slider=$('databaseColumnSlider');
    slider.addEventListener('input',()=>{if(scrollTarget)scrollTarget.scrollLeft=Number(slider.value);});
    function floatingScroll(target){
        scrollObserver?.disconnect();scrollTarget=target;
        const refresh=()=>{if(!target.isConnected)return;const max=Math.max(0,target.scrollWidth-target.clientWidth);slider.max=String(max);slider.value=String(target.scrollLeft);$('databaseHorizontalScroll').hidden=max<1;};
        target.addEventListener('scroll',refresh,{passive:true});scrollObserver=new ResizeObserver(refresh);scrollObserver.observe(target);if(target.firstElementChild)scrollObserver.observe(target.firstElementChild);requestAnimationFrame(refresh);
    }
    function button(text,fn,kind='outline-primary'){const b=el('button',text,'btn btn-'+kind+' btn-sm');b.type='button';b.addEventListener('click',()=>action(fn));return b;}
    function grid(headers,rows) {const scroll=el('div',undefined,'table-responsive console-grid');const table=el('table',undefined,'table table-sm table-hover align-middle');const head=el('thead'),tr=el('tr');headers.forEach(h=>tr.append(el('th',h)));head.append(tr);table.append(head);const body=el('tbody');for(const cells of rows){const row=el('tr');for(const value of cells){const td=el('td');if(value instanceof Node)td.append(value);else{td.textContent=value===null?'NULL':String(value??'');td.style.maxWidth='320px';td.style.overflowWrap='anywhere';}row.append(td);}body.append(row);}table.append(body);scroll.append(table);return scroll;}
    async function database(){
        const body=$('databaseToolsBody');body.replaceChildren();
        body.append(el('p','Browse business records without cPanel. Rows start locked. Admin or Owner can grant viewing access and editing of eligible notes.','mb-2'));
        body.append(el('p',info.editingScope,'small text-muted'));
        const controls=el('div',undefined,'d-flex flex-wrap gap-2 mb-3');const select=el('select',undefined,'form-select w-auto');select.id='consoleTable';select.setAttribute('aria-label','Business table');
        info.tables.forEach(t=>{const option=el('option',t.label);option.value=t.name;select.append(option);});
        const search=el('input',undefined,'form-control w-auto');search.id='consoleSearch';search.placeholder='Search text / Dispo';search.maxLength=100;search.setAttribute('aria-label','Search records');
        controls.append(select,search,button('Search / refresh',async()=>{page=0;await rows();}));
        if(info.manager)controls.append(button('Manage access',access),button('Edit & access audit',audit));
        select.addEventListener('change',()=>action(async()=>{page=0;await rows();}));search.addEventListener('keydown',e=>{if(e.key==='Enter')action(async()=>{page=0;await rows();});});
        body.append(controls);const results=el('div');results.id='consoleRows';const details=el('div');details.id='consoleDetails';body.append(results,details);page=0;await rows();
    }
    async function rows(){
        const version=++loadVersion;currentTable=$('consoleTable').value;const name=currentTable;
        const target=$('consoleRows');target.textContent='Loading records…';$('consoleDetails').replaceChildren();
        const data=await api('/rows/'+encodeURIComponent(name)+'?offset='+page*50+'&q='+encodeURIComponent($('consoleSearch').value));if(version!==loadVersion)return;
        target.replaceChildren();const nav=el('div',undefined,'d-flex gap-2 align-items-center mb-2');const prev=button('Previous',async()=>{page--;await rows();});prev.disabled=page===0;const next=button('Next',async()=>{page++;await rows();});next.disabled=!data.hasMore;nav.append(prev,el('span',data.rows.length?`Rows ${page*50+1}–${page*50+data.rows.length}`:'No matching rows'),next);target.append(nav);
        const columns=data.columns;
        const table=grid(['Row access',...columns],data.rows.map(r=>[button(r.canEdit?'Open • editing granted':'Open • locked',()=>detail(name,r,data.editable)),...columns.map(k=>r.values[k])]));
        table.classList.add('console-record-grid');target.append(table);floatingScroll(table);
        target.append(el('p',`All ${columns.length} MySQL columns are shown. Use the fixed Columns slider below to move horizontally. Search checks the first 25 text columns.`,'small text-muted'));
    }
    async function detail(table,row,editable){
        currentRow=row;const target=$('consoleDetails');target.replaceChildren();target.append(el('hr'),el('h5','Row details'),el('p',row.canEdit?'Editing granted for note fields.':row.lockReason,'small'));
        const record=grid(['Column','Value'],Object.entries(row.values));record.style.maxHeight='350px';record.style.overflow='auto';target.append(record);
        if(info.manager && Object.keys(row.key).length){
            const users=await api('/access');if(currentRow!==row)return;
            const controls=el('div',undefined,'d-flex flex-wrap gap-2 my-3');const select=el('select',undefined,'form-select w-auto');select.setAttribute('aria-label','Person to grant row editing');
            users.users.filter(u=>u.can_view||u.manager).forEach(u=>{const o=el('option',u.username+(u.manager?' (manager)':''));o.value=u.id;select.append(o);});
            const grant=button('Grant note editing',async()=>{await api('/row-access/'+encodeURIComponent(table),{key:row.key,userId:Number(select.value)});await rows();});grant.disabled=!row.eligible;
            controls.append(select,grant,button('Lock row for everyone',async()=>{await api('/row-access/'+encodeURIComponent(table),{key:row.key,lock:true});await rows();},'secondary'));target.append(controls);
        }
        if(row.canEdit){
            const fields={};for(const key of editable){const label=el('label',key,'form-label mt-2');const input=el('textarea',undefined,'form-control');input.rows=3;input.value=row.values[key]??'';input.maxLength=10000;input.id='consoleEdit_'+key;label.htmlFor=input.id;target.append(label,input);fields[key]=input;}
            target.append(el('p','A later Google Sheets edit may replace a mapped note. Your edit and its previous value are recorded.','small text-muted mt-2'),button('Review & save notes',async()=>{
                const changes=Object.fromEntries(Object.entries(fields).filter(([k,n])=>n.value!==(row.values[k]??'')).map(([k,n])=>[k,n.value]));
                if(!Object.keys(changes).length)throw Error('No changes to save.');
                const preview=Object.entries(changes).map(([k,v])=>k+'\nBefore: '+(row.values[k]??'NULL')+'\nAfter: '+v).join('\n\n');
                if(!window.confirm('Save these note changes?\n\n'+preview))return;
                await api('/edit/'+encodeURIComponent(table),{key:row.key,fingerprint:row.fingerprint,changes});await rows();
            },'primary'));
        }
    }
    async function access(){
        const data=await api('/access'),target=$('consoleDetails');target.replaceChildren(el('h5','Database & history access'));
        target.append(grid(['User','Role','Access'],data.users.map(u=>[u.username,u.manager?'Admin / Owner':u.role,u.manager?'Management access':button(u.can_view?'Revoke access':'Grant view access',async()=>{await api('/access',{userId:u.id,canView:!u.can_view});await access();},u.can_view?'outline-danger':'outline-primary')])));
        target.append(el('p','Viewing access does not allow editing. Open an eligible row to grant note editing; locking a row revokes all its grants.','small'));
    }
    async function audit(){
        const data=await api('/audit');$('consoleDetails').replaceChildren(el('h5','Recent edit & access audit'),grid(['Time (Bangladesh)','User','Action','Table','Details'],data.rows.map(r=>[date(r.createdAt),r.username||String(r.actor_id),r.action,r.table_name,typeof r.details_json==='string'?r.details_json:JSON.stringify(r.details_json)])));
    }
    async function history(){
        const viewToken=++historyVersion;const data=await api('/history');if(viewToken!==historyVersion)return;const body=$('databaseToolsBody');body.replaceChildren();
        body.append(el('p','Google Sheets → '+info.database+' • Scheduled every 10 minutes • Times shown in Bangladesh time.'));
        if(data.stale)body.append(el('div','No recent start is visible. Check synchronization before relying on fresh data.','alert alert-warning'));
        const controls=el('div',undefined,'d-flex flex-wrap gap-2 mb-3');controls.append(button('Refresh history',history));
        if(info.manager){const select=el('select',undefined,'form-select w-auto');select.setAttribute('aria-label','History time range');[['1h','Last hour'],['3h','Last 3 hours'],['7h','Last 7 hours'],['24h','Last 24 hours'],['3d','Last 3 days']].forEach(([v,t])=>{const o=el('option',t);o.value=v;select.append(o);});
            const clear=button('Clear my displayed history',async()=>{if(!confirm('Clear this time range from your history view? Database records, source logs and the audit trail will remain.'))return;await api('/history/clear',{period:select.value,confirm:'CLEAR_HISTORY_ONLY'});await history();},'outline-danger');clear.disabled=!info.historyClearEnabled;controls.append(select,clear);
        }
        body.append(controls,el('p',data.retention,'small text-muted'));
        if(data.recovery&&data.recovery.version===2){
          const r=data.recovery;
          const section=el('section',undefined,'mb-3 p-3 rounded border');
          section.style.background='rgba(93,208,197,.07)';
          section.style.borderColor='rgba(93,208,197,.38)';
          section.append(el('h5','Auto-Sync Recovery v2'));
          const last=r.lastVerifiedAt?date(r.lastVerifiedAt):'Awaiting first v2 verified cycle';
          const state=r.currentState==='failed'?'Failed; will retry at next eligible cron':
            r.currentState==='running'?'Running: '+(r.currentPhase||'working'):
            r.currentState==='verified'?'Last cycle verified':
            'No active recovery worker';
          section.append(el('p','Last verified: '+last+' | Recovery: '+state,'mb-2'));
          const parts=['Missed intervals: '+(r.missedIntervals===null?'Not determined':r.missedIntervals),
            'Transient fetch retries: '+r.fetchRetries,
            'Consecutive failures: '+r.consecutiveFailures];
          section.append(el('p',parts.join(' | '),'small mb-1'));
          if(r.catchUpNeeded)section.append(el('p','Catch-up is required or in progress. The worker will compare the latest source against MySQL; it will not replay duplicate inserts.','small'));
          if(r.lastFailureCategory)section.append(el('p','Last failure category: '+r.lastFailureCategory,'small'));
          if(r.lastRecoveryHadBacklog&&r.lastRecoveryAt)
            section.append(el('p','Last catch-up verified: '+date(r.lastRecoveryAt),'small'));
          body.append(section);
        }
        const labels={success:'Completed',unchanged:'Completed • no changes',failed:'Failed',skipped:'Skipped • sync already active',running:'Running / awaiting completion',unconfirmed:'Completion not confirmed'};
        body.append(el('p',data.captureStartedAt?'Detailed database-row capture began '+date(data.captureStartedAt)+'. Earlier row-level details are unavailable. Child-detail replacement deletes are labeled separately.':'Detailed database-row capture is not available yet.','small text-muted'));
        const table=grid(['Started','Finished','Result','Reason / details','Source rows new','Source rows changed','MySQL rows added','MySQL rows updated','MySQL rows deleted','Row details','Gap (minutes)'],data.runs.map(r=>[date(r.startedAt),date(r.endedAt),labels[r.status]+(r.workerReported&&r.status==='unconfirmed'?' • worker reported results':''),r.failureReason||(r.status==='failed'?'Worker failed'+(r.exitCode?' (exit '+r.exitCode+')':'')+'. Review current sync evidence.':'—'),r.added??'—',r.updated??'—',r.rowCounts?.added??'—',r.rowCounts?.updated??'—',r.rowCounts?.deleted??'—',r.detailsAvailable?button('View changed rows',()=>changedRows(r,0)): 'Not captured',r.gapMinutes??'—']));body.append(table);floatingScroll(table);
        const details=el('div');details.id='syncChangedRows';body.append(details);
        if(!data.runs.length)body.append(el('p','No retained runs in this view.'));
    }
    async function changedRows(run,offset){
        const viewToken=historyVersion;const data=await api('/history/changes?run='+encodeURIComponent(run.id)+'&offset='+offset),target=$('syncChangedRows');
        if(viewToken!==historyVersion||!target)return;target.replaceChildren(el('hr'),el('h5','Database changes for '+date(run.startedAt)),el('p','Only committed changes are shown. A detail replacement can produce both Deleted and Added child rows.','small'));
        const nav=el('div',undefined,'d-flex gap-2 my-2'),prev=button('Previous changes',()=>changedRows(run,offset-50)),next=button('Next changes',()=>changedRows(run,offset+50));prev.disabled=offset===0;next.disabled=!data.hasMore;nav.append(prev,el('span',`History entries ${data.rows.length?offset+1:0}–${offset+data.rows.length}`),next);target.append(nav);
        const value=v=>el('pre',v===null?'—':JSON.stringify(v,null,2),'console-value');
        const table=grid(['Time','Action','MySQL table','Database row key','Dispo','Changed columns','Before','After','Source file','Source row','Source action','Rows affected','Evidence / reason'],data.rows.map(r=>[date(r.at),r.action,r.table,r.key?JSON.stringify(r.key):'—',r.dispo,r.changedColumns.join(', ')||'See before / after',value(r.before),value(r.after),r.sourceFile,r.sourceRow,r.sourceAction,r.affectedRows,r.note||r.identityScope]));
        target.append(table);floatingScroll(table);if(!data.rows.length)target.append(el('p','No committed database row changes were captured for this run.'));
        target.scrollIntoView({behavior:'smooth',block:'nearest'});
    }
    async function render() {
      if(loaded)return;
      if(loading)return loading;
      const token=++generation;
      loading=(async()=>{
        $('databaseToolsBody').replaceChildren(el('p','Loading secure console…','text-muted'));
        info=await api('/info');
        if(token!==generation)return;
        $('databaseToolsIdentity').textContent=info.database+' · '+info.role;
        if(mode==='database')await database();else await history();
        if(token===generation)loaded=true;
      })().finally(()=>{loading=null});
      return loading;
    }
    function clear() {
      loaded=false;loading=null;info=null;generation++;historyVersion++;loadVersion++;
      page=0;currentRow=null;currentTable=null;scrollTarget=null;
      scrollObserver?.disconnect();scrollObserver=null;
      $('databaseToolsBody').replaceChildren();
      $('databaseToolsMessage').replaceChildren();
      $('databaseHorizontalScroll').hidden=true;
      const scroll=root.querySelector('[data-console-scroll]');
      scroll.scrollTop=0;scroll.scrollLeft=0;
    }
    function refreshHorizontalSlider(){
      if(!scrollTarget||!scrollTarget.isConnected)return;
      requestAnimationFrame(()=>{
        if(!scrollTarget||!scrollTarget.isConnected)return;
        const slider=$('databaseColumnSlider');
        const max=Math.max(0,scrollTarget.scrollWidth-scrollTarget.clientWidth);
        slider.max=String(max);slider.value=String(scrollTarget.scrollLeft);
        $('databaseHorizontalScroll').hidden=max<1;
      });
    }
    return {render,clear,refreshHorizontalSlider};
  }

  for(const mode of Object.keys(els)) {
    const win=els[mode];
    if(!win || !tasks[mode])return;
    sessions[mode]=createSession(mode);
    enableDragging(mode);
    win.addEventListener('pointerdown',()=>focusPanel(mode));
    for(const button of win.querySelectorAll('[data-console-action]')){
      button.addEventListener('click',e=>{
        e.stopPropagation();
        const act=button.dataset.consoleAction;
        if(act==='minimize')minimize(mode);
        else if(act==='close')close(mode);
        else if(act==='maximize')toggleMaximize(mode);
        else if(act==='zoom-in')zoomPanel(mode,state[mode].zoom+10);
        else if(act==='zoom-out')zoomPanel(mode,state[mode].zoom-10);
        else if(act==='zoom-reset')zoomPanel(mode,100);
      });
    }
    tasks[mode].addEventListener('click',()=>{
      if(!state[mode].created)return;
      if(state[mode].minimized)restore(mode);
      else if(foreground===mode)minimize(mode);
      else focusPanel(mode);
    });
    zoomPanel(mode,100);
  }
  async function open(mode) {
    const s=state[mode],win=els[mode];
    s.created=true;s.minimized=false;win.hidden=false;
    focusPanel(mode);
    win.focus({preventScroll:true});
    try {await sessions[mode].render();}
    catch(e){
      const msg=win.querySelector('[data-console-message]');
      msg.textContent=e.message;msg.className='alert alert-danger';
    }
  }
  openDatabase.addEventListener('click',()=>open('database'));
  openHistory.addEventListener('click',()=>open('history'));

  // Preserve the original login-gated buttons; never grant access locally.
  window.initializeDatabaseTools=async()=>{
    resetAll();
    try{
      const response=await fetch('/main/api/database-console/info',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw Error('Console access is not available.');
      await response.json();
      openDatabase.hidden=false;openHistory.hidden=false;
    }catch(_){
      openDatabase.hidden=true;openHistory.hidden=true;
    }
  };
  window.addEventListener('keydown',e=>{
    if(!foreground || !state[foreground].created || state[foreground].minimized)return;
    if(e.ctrlKey&&e.key==='0'&&e.target.closest('.erp-console-window')){
      e.preventDefault();zoomPanel(foreground,100);
    }
  });
});
})();
