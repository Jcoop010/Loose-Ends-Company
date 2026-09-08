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
  var state={workflows:[]};
  function esc(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c];});}
  function toast(m){var e=document.getElementById('toast');if(e){e.textContent=m;e.className='toast show';setTimeout(function(){e.className='toast';},2200);}}
  function loadLocal(){try{var x=JSON.parse(localStorage.getItem(KEY)||'null');if(x&&Array.isArray(x.workflows))state=x;}catch(e){}}
  function saveLocal(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}}
  function client(){return window.LESupabase||null;}
  async function workspaceId(){var c=client();if(!c)return null;var u=await c.auth.getUser();var uid=u.data&&u.data.user&&u.data.user.id;if(!uid)return null;var m=await c.from('workspace_members').select('workspace_id').eq('user_id',uid).limit(1).maybeSingle();return m.data&&m.data.workspace_id||null;}
  async function load(){
    loadLocal();var c=client(),w=await workspaceId();
    if(c&&w){var r=await c.from('workflows').select('*').eq('workspace_id',w).order('created_at',{ascending:false});if(!r.error&&r.data)state.workflows=r.data;}
    render();
  }
  async function persist(wf){
    var c=client(),w=await workspaceId();
    if(c&&w){var payload=Object.assign({},wf,{workspace_id:w});var r=await c.from('workflows').insert(payload).select().single();if(r.error){toast('Could not save workflow');return;}wf=r.data;}
    state.workflows.unshift(wf);saveLocal();render();toast('Workflow created');
  }
  function render(){
    var page=document.querySelector('#content .page');if(!page)return;
    var box=document.getElementById('workflowCenter');if(box)box.remove();
    box=document.createElement('section');box.id='workflowCenter';box.className='workflow-center';
    box.innerHTML='<div class="wf-head"><div><div class="eyebrow">AUTOMATION ENGINE</div><h2>Workflows</h2><p>Build repeatable business processes once. Loose Ends can watch records, evaluate rules, create next actions, and keep an audit trail.</p></div><button id="wfCreate" class="primary">Create workflow</button></div>'+
      '<div class="wf-grid"><div class="card section-card"><div class="section-head"><div><div class="section-title">Active automations</div><div class="section-sub">Shared across CRM, work, scheduling, billing, and recovery.</div></div></div>'+(state.workflows.length?state.workflows.map(workflowRow).join(''):'<div class="wf-empty">No workflows yet. Start with a proven recipe below.</div>')+'</div><div class="card section-card"><div class="section-head"><div><div class="section-title">Recipe library</div><div class="section-sub">Start safe, then customize.</div></div></div>'+recipes.map(function(r,i){return '<div class="wf-recipe"><div><strong>'+esc(r.name)+'</strong><small>'+esc(r.description)+'</small></div><button class="action" data-recipe="'+i+'">Use recipe</button></div>';}).join('')+'</div></div>';
    page.appendChild(box);
    document.getElementById('wfCreate').onclick=function(){openEditor();};
    box.querySelectorAll('[data-recipe]').forEach(function(b){b.onclick=function(){openEditor(recipes[Number(b.dataset.recipe)]);};});
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
  function init(){addNav();loadLocal();var old=window.LE&&LE.setView;if(old&&!old.__wfWrapped){var wrap=function(v){if(v==='workflows'){show();load();return;}old(v);};wrap.__wfWrapped=true;window.LE.setView=wrap;}}
  window.LEWorkflows={load:load,create:persist,recipes:recipes};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();