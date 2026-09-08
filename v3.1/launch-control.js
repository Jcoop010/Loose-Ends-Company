/* Loose Ends — live business control center
 * One operational surface for workspace health, core data coverage and automation state.
 * Never reports a provider as connected unless the live workspace has evidence of it.
 */
(function(){
  'use strict';
  var S=window.LESupabase;
  var workspace=null;
  var mounted=false;
  var TABLES=['customers','opportunities','appointments','tasks','documents','follow_ups','recovery_events','workflows','workflow_runs','workflow_events','audit_events'];
  function esc(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
  function money(n){return '$'+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:0})}
  function toast(m){var e=document.getElementById('toast');if(e){e.textContent=m;e.className='toast show';setTimeout(function(){e.className='toast'},2200)}}
  async function getWorkspace(){
    if(!S||!S.auth)return null;
    var u=(await S.auth.getUser()).data.user;if(!u)return null;
    var q=await S.from('workspace_members').select('workspace_id,role,workspaces(*)').eq('user_id',u.id).limit(1).maybeSingle();
    return q.data&&q.data.workspaces||null;
  }
  async function count(table,filter){
    var q=S.from(table).select('id',{count:'exact',head:true}).eq('workspace_id',workspace.id);
    if(filter)q=q.eq(filter.field,filter.value);
    var r=await q;
    return {ok:!r.error,count:r.count||0,error:r.error};
  }
  async function snapshot(){
    workspace=workspace||await getWorkspace();
    if(!workspace)return null;
    var results=await Promise.all(TABLES.map(function(t){return count(t).then(function(r){return [t,r]}).catch(function(e){return [t,{ok:false,count:0,error:e}]})}));
    var map={};results.forEach(function(x){map[x[0]]=x[1]});
    var failed=await count('workflow_runs',{field:'status',value:'failed'});
    var pending=await count('workflow_runs',{field:'status',value:'waiting_approval'});
    var enabled=await count('workflows',{field:'enabled',value:true});
    var qb=await count('quickbooks_connections');
    return {workspace:workspace,tables:map,failed:failed,pending:pending,enabled:enabled,quickbooks:qb,checked:new Date()};
  }
  function badge(ok,label){return '<span class="lc-badge '+(ok?'ok':'warn')+'">'+(ok?'READY':'ACTION')+' · '+label+'</span>'}
  function style(){
    if(document.getElementById('le-launch-control-style'))return;
    var s=document.createElement('style');s.id='le-launch-control-style';s.textContent='\
#leLaunchControl{margin:0 0 16px;background:#fff;border:1px solid #dce3ea;border-radius:18px;padding:18px;box-shadow:0 8px 24px rgba(16,24,40,.06)}\
#leLaunchControl .lc-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}\
#leLaunchControl .lc-title{font-size:17px;font-weight:850;color:#101828}\
#leLaunchControl .lc-sub{font-size:12px;color:#667085;margin-top:4px}\
#leLaunchControl .lc-actions{display:flex;gap:8px;flex-wrap:wrap}\
#leLaunchControl button{border:1px solid #d0d5dd;background:#fff;border-radius:9px;padding:8px 11px;font-weight:750;cursor:pointer}\
#leLaunchControl .lc-primary{background:#101828;color:#fff;border-color:#101828}\
#leLaunchControl .lc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:15px 0}\
#leLaunchControl .lc-stat{background:#f8fafc;border:1px solid #eaecf0;border-radius:12px;padding:11px}\
#leLaunchControl .lc-stat span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#667085}\
#leLaunchControl .lc-stat b{display:block;font-size:20px;margin-top:4px;color:#101828}\
#leLaunchControl .lc-health{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}\
#leLaunchControl .lc-health-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid #eaecf0;border-radius:10px}\
#leLaunchControl .lc-health-row strong{font-size:12px}\
#leLaunchControl .lc-health-row small{display:block;color:#667085;margin-top:2px}\
#leLaunchControl .lc-badge{font-size:9px;font-weight:850;letter-spacing:.04em;white-space:nowrap}\
#leLaunchControl .lc-badge.ok{color:#067647}.lc-badge.warn{color:#b54708}\
#leLaunchControl .lc-foot{font-size:10px;color:#98a2b3;margin-top:11px}\
@media(max-width:760px){#leLaunchControl .lc-top{flex-direction:column}#leLaunchControl .lc-grid{grid-template-columns:repeat(2,1fr)}#leLaunchControl .lc-health{grid-template-columns:1fr}}';document.head.appendChild(s);
  }
  function render(d){
    var root=document.getElementById('leLaunchControl');if(!root||!d)return;
    var t=d.tables||{};
    var coreOk=['customers','opportunities','appointments','tasks','documents','follow_ups'].every(function(k){return t[k]&&t[k].ok});
    var autoOk=t.workflows&&t.workflows.ok&&t.workflow_runs&&t.workflow_runs.ok&&t.workflow_events&&t.workflow_events.ok;
    var recoveryOk=t.opportunities&&t.opportunities.ok&&t.recovery_events&&t.recovery_events.ok;
    var moneyOpen=0;
    root.innerHTML='<div class="lc-top"><div><div class="lc-title">Business Control Center</div><div class="lc-sub">Live workspace health. This checks the operating system itself—not a demo state.</div></div><div class="lc-actions"><button onclick="LELaunchControl.refresh()">Refresh</button><button class="lc-primary" onclick="LELaunchControl.openAutomation()">Open Automations</button></div></div>'+\
      '<div class="lc-grid"><div class="lc-stat"><span>Customers</span><b>'+((t.customers&&t.customers.count)||0)+'</b></div><div class="lc-stat"><span>Open opportunities</span><b>'+((t.opportunities&&t.opportunities.count)||0)+'</b></div><div class="lc-stat"><span>Appointments</span><b>'+((t.appointments&&t.appointments.count)||0)+'</b></div><div class="lc-stat"><span>Active automations</span><b>'+((d.enabled&&d.enabled.count)||0)+'</b></div></div>'+\
      '<div class="lc-health">'+\
      '<div class="lc-health-row"><div><strong>Business data layer</strong><small>Customers, sales, scheduling, tasks, documents and follow-ups</small></div>'+badge(coreOk,'workspace data')+'</div>'+\
      '<div class="lc-health-row"><div><strong>Revenue recovery</strong><small>Opportunities and recovery event stream</small></div>'+badge(recoveryOk,'recovery')+'</div>'+\
      '<div class="lc-health-row"><div><strong>Automation engine</strong><small>Workflows, events and run history are reachable</small></div>'+badge(autoOk,'automation')+'</div>'+\
      '<div class="lc-health-row"><div><strong>Run queue</strong><small>'+((d.pending&&d.pending.count)||0)+' waiting approval · '+((d.failed&&d.failed.count)||0)+' failed runs</small></div>'+badge((!d.failed||d.failed.count===0),'queue health')+'</div>'+\
      '<div class="lc-health-row"><div><strong>QuickBooks</strong><small>Live connection records in this workspace</small></div>'+badge(!!(d.quickbooks&&d.quickbooks.count),'accounting connection')+'</div>'+\
      '<div class="lc-health-row"><div><strong>Audit trail</strong><small>'+((t.audit_events&&t.audit_events.count)||0)+' recorded operational events</small></div>'+badge(!!(t.audit_events&&t.audit_events.ok),'audit')+'</div>'+\
      '</div><div class="lc-foot">Checked '+d.checked.toLocaleTimeString()+' · A provider is never shown as connected without live workspace evidence.</div>';
  }
  async function refresh(){
    var root=document.getElementById('leLaunchControl');if(root)root.innerHTML='<div class="lc-sub">Checking live workspace…</div>';
    try{var d=await snapshot();if(d)render(d);else if(root)root.innerHTML='<div class="lc-sub">Sign in to a workspace to run live checks.</div>';}catch(e){if(root)root.innerHTML='<div class="lc-sub">Live checks unavailable. Try Refresh.</div>';console.warn(e)}
  }
  function mount(){
    if(mounted)return;
    var page=document.querySelector('#content .page');if(!page)return;
    style();var box=document.createElement('section');box.id='leLaunchControl';page.insertBefore(box,page.children[1]||null);mounted=true;refresh();
  }
  function openAutomation(){
    var b=document.querySelector('[data-view="automations"]');if(b)b.click();else if(window.LE&&LE.setView)LE.setView('automations');else toast('Open the Automations section from the navigation.');
  }
  window.LELaunchControl={refresh:refresh,openAutomation:openAutomation};
  function boot(){setTimeout(mount,900);setInterval(function(){if(document.querySelector('#content .page')&&!document.getElementById('leLaunchControl')){mounted=false;mount()}},1500)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
