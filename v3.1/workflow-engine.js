/* Loose Ends Workflow Engine — horizontal automation layer. */
(function(){
  'use strict';
  var KEY='loose_ends_workflows_v1';
  var recipes=[
    {name:'Recover stale opportunities',description:'Create a follow-up when an open opportunity has gone untouched.',trigger_type:'record_updated',trigger_config:{entity_type:'opportunities'},conditions:[{field:'status',operator:'equals',value:'open'}],actions:[{type:'create_follow_up',channel:'task',message:'Review and follow up on this opportunity.',delay_hours:0}],mode:'approval'},
    {name:'Welcome new customers',description:'Create an onboarding task whenever a customer is created.',trigger_type:'record_created',trigger_config:{entity_type:'customers'},conditions:[],actions:[{type:'create_task',title:'Welcome new customer',priority:2,delay_hours:0}],mode:'automatic'},
    {name:'Appointment follow-up',description:'Create a next-step task after an appointment is completed.',trigger_type:'record_updated',trigger_config:{entity_type:'appointments'},conditions:[{field:'status',operator:'equals',value:'completed'}],actions:[{type:'create_task',title:'Follow up after completed appointment',priority:1,delay_hours:24}],mode:'automatic'},
    {name:'Overdue invoice alert',description:'Flag an overdue invoice for the owner to review.',trigger_type:'record_updated',trigger_config:{entity_type:'documents'},conditions:[{field:'document_type',operator:'equals',value:'invoice'},{field:'status',operator:'equals',value:'overdue'}],actions:[{type:'create_task',title:'Review overdue invoice',priority:3,delay_hours:0}],mode:'approval'}
  ];
  var state={workflows:[],pendingRuns:[]};
  var runnerBusy=false;
  function esc(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c];});}
  function toast(m){var e=document.getElementById('toast');if(e){e.textContent=m;e.className='toast show';setTimeout(function(){e.className='toast';},2200);}}
  function loadLocal(){try{var x=JSON.parse(localStorage.getItem(KEY)||'null');if(x&&Array.isArray(x.workflows))state.workflows=x.workflows;}catch(e){}}
  function saveLocal(){try{localStorage.setItem(KEY,JSON.stringify({workflows:state.workflows}));}catch(e){}}
  function client(){return window.LESupabase||null;}
  async function workspaceId(){var c=client();if(!c)return null;var u=await c.auth.getUser();var uid=u.data&&u.data.user&&u.data.user.id;if(!uid)return null;var m=await c.from('workspace_members').select('workspace_id').eq('user_id',uid).limit(1).maybeSingle();return m.data&&m.data.workspace_id||null;}
  async function runner(body){
    var c=client(); if(!c||!c.auth)return null;
    var session=await c.auth.getSession(); var token=session.data&&session.data.session&&session.data.session.access_token; if(!token)return null;
    var base=(window.__LOOSE_ENDS_SUPABASE_URL__||'').replace(/\/$/,''); if(!base)return null;
    var res=await fetch(base+'/functions/v1/workflow-runner',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(body||{})});
    var json=await res.json().catch(function(){return {};});
    if(!res.ok)throw new Error(json.error||'Workflow runner failed');
    return json;
  }
  async function refreshRuns(){
    var c=client(),w=await workspaceId(); if(!c||!w){state.pendingRuns=[];return;}
    var r=await c.from('workflow_runs').select('id,workflow_id,status,context,created_at,started_at').eq('workspace_id',w).eq('status','waiting_approval').order('created_at',{ascending:false}).limit(25);
    if(!r.error)state.pendingRuns=r.data||[];
  }
  async function pump(){
    if(runnerBusy)return;
    var c=client(); if(!c)return;
    var u=await c.auth.getUser(); if(!u.data||!u.data.user)return;
    runnerBusy=true;
    try{await runner({});await refreshRuns();render();}catch(e){}finally{runnerBusy=false;}
  }
  async function load(){
    loadLocal();var c=client(),w=await workspaceId();
    if(c&&w){var r=await c.from('workflows').select('*').eq('workspace_id',w).order('created_at',{ascending:false});if(!r.error&&r.data)state.workflows=r.data;}
    await refreshRuns();render();pump();
  }
  async function persist(wf){
    var c=client(),w=await workspaceId();
    if(c&&w){var payload=Object.assign({},wf,{workspace_id:w});var r=await c.from('workflows').insert(payload).select().single();if(r.error){toast('Could not save workflow');return;}wf=r.data;}
    state.workflows.unshift(wf);saveLocal();render();toast('Workflow created');
  }
  async function approveRun(id){
    try{toast('Running approved automation…');var result=await runner({approve_run_id:id});if(result&&result.status==='completed')toast('Automation completed');else toast('Automation updated');await refreshRuns();render();}catch(e){toast(e.message||'Could not approve automation');}
  }
  function render(){
    var page=document.querySelector('#content .page');if(!page)return;
    var box=document.getElementById('workflowCenter');if(box)box.remove();
    box=document.createElement('section');box.id='workflowCenter';box.className='workflow-center';
    var pending=state.pendingRuns.length;
    box.innerHTML='<div class="wf-head"><div><div class="eyebrow">AUTOMATION ENGINE</div><h2>Workflows</h2><p>Build repeatable business processes once. Loose Ends watches records, evaluates rules, runs safe actions, and keeps an audit trail.</p></div><button id="wfCreate" class="primary">Create workflow</button></div>'+
      (pending?'<div class="card section-card wf-approval"><div class="section-head"><div><div class="section-title">Needs approval <span class="wf-count">'+pending+'</span></div><div class="section-sub">These automations were intentionally configured to wait before taking action.</div></div></div>'+state.pendingRuns.map(function(run){var wf=state.workflows.find(function(x){return x.id===run.workflow_id;});var name=wf?wf.name:'Workflow';var rec=run.context&&run.context.record||{};var subject=rec.name||rec.title||rec.email||rec.id||'record';return '<div class="wf-row"><div><strong>'+esc(name)+'</strong><small>'+esc(subject)+' · '+esc(new Date(run.created_at).toLocaleString())+'</small></div><span class="wf-pill">Approval</span><button class="action primary" data-approve="'+esc(run.id)+'">Approve & run</button></div>';}).join('')+'</div>':'')+
      '<div class="wf-grid"><div class="card section-card"><div class="section-head"><div><div class="section-title">Active automations</div><div class="section-sub">Shared across CRM, work, scheduling, billing, and recovery.</div></div></div>'+(state.workflows.length?state.workflows.map(workflowRow).join(''):'<div class="wf-empty">No workflows yet. Start with a proven recipe below.</div>')+'</div><div class="card section-card"><div class="section-head"><div><div class="section-title">Recipe library</div><div class="section-sub">Start safe, then customize.</div></div></div>'+recipes.map(function(r,i){return '<div class="wf-recipe"><div><strong>'+esc(r.name)+'</strong><small>'+esc(r.description)+'</small></div><button class="action" data-recipe="'+i+'">Use recipe</button></div>';}).join('')+'</div></div>';
    page.appendChild(box);
    document.getElementById('wfCreate').onclick=function(){openEditor();};
    box.querySelectorAll('[data-recipe]').forEach(function(b){b.onclick=function(){openEditor(recipes[Number(b.dataset.recipe)]);};});
    box.querySelectorAll('[data-approve]').forEach(function(b){b.onclick=function(){approveRun(b.dataset.approve);};});
    box.querySelectorAll('[data-toggle]').forEach(function(b){b.onclick=async function(){var wf=state.workflows[Number(b.dataset.toggle)];wf.enabled=wf.enabled===false;var c=client();if(c&&wf.id)await c.from('workflows').update({enabled:wf.enabled,updated_at:new Date().toISOString()}).eq('id',wf.id);saveLocal();render();};});
  }
  function workflowRow(w,i){return '<div class="wf-row"><div><strong>'+esc(w.name)+'</strong><small>'+esc(w.description||'')+'</small></div><span class="wf-pill">'+esc(w.mode||'manual')+'</span><span class="wf-status '+(w.enabled===false?'off':'')+'">'+(w.enabled===false?'Off':'Active')+'</span><button class="action" data-toggle="'+i+'">'+(w.enabled===false?'Enable':'Disable')+'</button></div>';}
  function openEditor(seed){
    var d=document.getElementById('drawer');if(!d)return;var w=seed||{name:'',description:'',enabled:true,mode:'approval',trigger_type:'manual',trigger_config:{},actions:[]};d.classList.remove('hidden');var dr=d.querySelector('.drawer');
    dr.innerHTML='<div class="drawer-head"><div><div class="eyebrow">WORKFLOW</div><h2>'+esc(w.name||'New workflow')+'</h2></div><button class="icon-btn" id="wfClose">×</button></div><div class="drawer-body"><label>Name<input id="wfName" class="input" value="'+esc(w.name)+'"></label><label>Description<textarea id="wfDesc" class="input">'+esc(w.description||'')+'</textarea></label><label>Trigger<select id="wfTrigger" class="input"><option value="manual">Manual</option><option value="record_created">Record created</option><option value="record_updated">Record updated</option><option value="record_due">Record due</option><option value="schedule">Schedule</option></select></label><label>Mode<select id="wfMode" class="input"><option value="automatic">Automatic</option><option value="approval">Approval required</option><option value="manual">Manual</option></select></label><label>Entity<input id="wfEntity" class="input" placeholder="customers, opportunities, appointments, documents" value="'+esc((w.trigger_config||{}).entity_type||'')+'"></label><label>Action<select id="wfAction" class="input"><option value="create_task">Create task</option><option value="create_follow_up">Create follow-up</option><option value="update_opportunity">Update opportunity</option></select></label><label>Action title/message<input id="wfActionText" class="input" value="'+esc(((w.actions||[])[0]||{}).title||((w.actions||[])[0]||{}).message||'Review and take the next best action')+'"></label><button id="wfSave" class="primary">Save workflow</button></div>';
    document.getElementById('wfTrigger').value=w.trigger_type||'manual';document.getElementById('wfMode').value=w.mode||'approval';document.getElementById('wfClose').onclick=function(){d.classList.add('hidden');};
    document.getElementById('wfSave').onclick=function(){var action=document.getElementById('wfAction').value,text=document.getElementById('wfActionText').value||'Review and take the next best action';var a={type:action};if(action==='create_task')a.title=text;else a.message=text;persist({name:document.getElementById('wfName').value.trim()||'Untitled workflow',description:document.getElementById('wfDesc').value.trim(),enabled:true,mode:document.getElementById('wfMode').value,trigger_type:document.getElementById('wfTrigger').value,trigger_config:{entity_type:document.getElementById('wfEntity').value.trim()},conditions:[],actions:[a]});d.classList.add('hidden');};
  }
  function show(){var content=document.getElementById('content');if(!content)return;content.innerHTML='<div class="page"><div class="page-head"><div><div class="eyebrow">AUTOMATION</div><div class="title">Workflow Center</div><div class="subtitle">Automate the work between lead, customer, appointment, job, invoice, payment, and recovery.</div></div><div class="date">Automation engine</div></div></div>';setTimeout(render,0);document.querySelectorAll('.nav-item').forEach(function(n){n.classList.toggle('active',n.dataset.view==='workflows');});}
  function addNav(){var nav=document.querySelector('nav');if(!nav||nav.querySelector('[data-view="workflows"]'))return;var b=document.createElement('button');b.type='button';b.className='nav-item';b.dataset.view='workflows';b.innerHTML='<span>⚡</span>Automations';b.onclick=function(){show();load();};nav.appendChild(b);}
  function init(){addNav();loadLocal();var old=window.LE&&LE.setView;if(old&&!old.__wfWrapped){var wrap=function(v){if(v==='workflows'){show();load();return;}old(v);};wrap.__wfWrapped=true;window.LE.setView=wrap;}setInterval(function(){pump();},30000);}
  window.LEWorkflows={load:load,create:persist,recipes:recipes,approve:approveRun,pump:pump};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();