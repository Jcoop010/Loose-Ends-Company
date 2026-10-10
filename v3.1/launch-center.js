/* Loose Ends Customer Launch Center — onboarding, imports, integrations, recovery setup. */
(function(){
  'use strict';
  var S=window.LESupabase, KEY='loose_ends_launch_center_v1';

  function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
  function toast(m){var e=document.getElementById('toast');if(e){e.textContent=m;e.className='toast show';setTimeout(function(){e.className='toast'},2200)}}
  function css(){
    if(document.getElementById('le-launch-center-css'))return;
    var s=document.createElement('style');s.id='le-launch-center-css';s.textContent=
      '.le-launch-wrap{margin:0 0 18px;border:1px solid rgba(86,217,177,.25);border-radius:18px;background:linear-gradient(135deg,#0b1722,#102b2b);color:#fff;padding:18px;box-shadow:0 18px 50px rgba(0,0,0,.14)}'+
      '.le-launch-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.le-launch-kicker{font-size:10px;letter-spacing:.14em;font-weight:900;color:#9db2c6}.le-launch-title{font-size:21px;font-weight:900;margin:4px 0}.le-launch-sub{font-size:12px;color:#b8c8d4;line-height:1.5;max-width:650px}.le-launch-close{border:0;background:rgba(255,255,255,.08);color:#fff;border-radius:9px;padding:8px 11px;font-weight:800}.le-launch-steps{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:16px 0}.le-launch-step{padding:11px;border:1px solid rgba(255,255,255,.1);border-radius:11px;background:rgba(255,255,255,.045)}.le-launch-step b{display:block;font-size:11px}.le-launch-step small{display:block;color:#9db2c6;margin-top:3px;font-size:10px}.le-launch-step.done{border-color:rgba(86,217,177,.55);background:rgba(86,217,177,.09)}.le-launch-actions{display:flex;gap:8px;flex-wrap:wrap}.le-launch-actions button{border:0;border-radius:10px;padding:10px 13px;font-weight:900;cursor:pointer}.le-launch-primary{background:#56d9b1;color:#062019}.le-launch-secondary{background:rgba(255,255,255,.09);color:#fff}.le-launch-modal{position:fixed;inset:0;background:rgba(4,8,15,.78);z-index:10200;display:flex;align-items:center;justify-content:center;padding:18px}.le-launch-card{width:min(720px,100%);max-height:90vh;overflow:auto;background:#fff;color:#101828;border-radius:20px;padding:24px}.le-launch-card h2{margin:0 0 6px}.le-launch-card p{color:#667085;font-size:13px;line-height:1.5}.le-launch-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.le-launch-field label{display:block;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#667085}.le-launch-field input,.le-launch-field select{width:100%;box-sizing:border-box;margin-top:5px;padding:11px;border:1px solid #d0d5dd;border-radius:10px}.le-launch-card button{border:0;border-radius:10px;padding:11px 14px;font-weight:900;cursor:pointer}.le-launch-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.le-launch-note{padding:12px;border-radius:10px;background:#f2f4f7;color:#475467;font-size:12px}.le-launch-integration{display:flex;align-items:center;justify-content:space-between;padding:13px;border:1px solid #eaecf0;border-radius:12px;margin-top:9px}.le-launch-integration small{display:block;color:#667085;margin-top:3px}@media(max-width:700px){.le-launch-steps{grid-template-columns:1fr 1fr}.le-launch-grid{grid-template-columns:1fr}.le-launch-head{flex-direction:column}}';
    document.head.appendChild(s);
  }
  async function user(){if(!S)return null;var r=await S.auth.getUser();return r.data&&r.data.user||null}
  async function workspace(){var u=await user();if(!u)return null;var r=await S.from('workspace_members').select('workspace_id,role,workspaces(*)').eq('user_id',u.id).limit(1).maybeSingle();return r.data&&r.data.workspaces||null}
  async function settings(w){if(!S||!w)return null;var r=await S.from('workspace_settings').select('*').eq('workspace_id',w.id).maybeSingle();return r.data||null}
  async function counts(w){if(!S||!w)return {customers:0,opps:0,followups:0};var a=await Promise.all([S.from('customers').select('id',{count:'exact',head:true}).eq('workspace_id',w.id),S.from('opportunities').select('id',{count:'exact',head:true}).eq('workspace_id',w.id),S.from('follow_ups').select('id',{count:'exact',head:true}).eq('workspace_id',w.id)]);return {customers:a[0].count||0,opps:a[1].count||0,followups:a[2].count||0}}
  async function saveProfile(w){
    var name=(document.getElementById('le-on-name').value||w.name||'My Business').trim();
    var type=document.getElementById('le-on-type').value||'Other Small Business';
    var tz=document.getElementById('le-on-tz').value||'America/New_York';
    var wr=await S.from('workspaces').update({name:name,updated_at:new Date().toISOString()}).eq('id',w.id);
    if(wr.error){toast(wr.error.message);return false}
    var sr=await S.from('workspace_settings').upsert({workspace_id:w.id,business_type:type,timezone:tz,onboarding_completed:false},{onConflict:'workspace_id'});
    if(sr.error){toast(sr.error.message);return false}
    toast('Business profile saved');return true;
  }
  async function finish(w){
    var r=await S.from('workspace_settings').upsert({workspace_id:w.id,onboarding_completed:true,onboarding_completed_at:new Date().toISOString()},{onConflict:'workspace_id'});
    if(r.error){toast(r.error.message);return false}
    localStorage.setItem(KEY+':'+w.id,'done');toast('Workspace is ready');close();location.reload();return true;
  }
  function close(){var m=document.getElementById('le-launch-modal');if(m)m.remove()}
  async function open(w,force){
    if(!w)return;css();close();
    var m=document.createElement('div');m.id='le-launch-modal';m.className='le-launch-modal';
    m.innerHTML='<div class="le-launch-card"><div style="font-size:10px;font-weight:900;letter-spacing:.14em;color:#667085">LOOSE ENDS · CUSTOMER LAUNCH</div><h2>Get your revenue recovery system live.</h2><p>We will set up the business profile, bring in your existing customer/opportunity data, enable the recovery engine, and prepare automations. You can finish the remaining integrations later.</p>'+
      '<div class="le-launch-grid"><div class="le-launch-field"><label>Business name</label><input id="le-on-name" value="'+esc(w.name||'')+'" placeholder="Your Business"></div><div class="le-launch-field"><label>Business type</label><select id="le-on-type"><option>Home services / trades</option><option>Automotive</option><option>Professional services</option><option>Retail / e-commerce</option><option>Health & wellness</option><option>Beauty & personal care</option><option>Hospitality / food</option><option>Real estate / property</option><option>Other Small Business</option></select></div><div class="le-launch-field"><label>Timezone</label><select id="le-on-tz"><option>America/New_York</option><option>America/Chicago</option><option>America/Denver</option><option>America/Los_Angeles</option></select></div><div class="le-launch-field"><label>Data source</label><select id="le-on-source"><option value="csv">CSV export</option><option value="quickbooks">QuickBooks</option><option value="both">CSV + QuickBooks</option><option value="manual">Start manually</option></select></div></div>'+
      '<div class="le-launch-integration"><div><b>Revenue Recovery Engine</b><small>Scoring, next-best-action, audit and recovery attribution.</small></div><span>READY</span></div>'+
      '<div class="le-launch-integration"><div><b>Workflow Automation</b><small>Follow-ups, tasks, appointment and overdue-work recipes.</small></div><span>READY</span></div>'+
      '<div class="le-launch-integration"><div><b>QuickBooks</b><small>Existing sync bridge can pull financial/recovery signals after connection.</small></div><button id="le-on-qb">Open integration</button></div>'+
      '<div class="le-launch-note" style="margin-top:12px">Privacy: business data stays isolated to the signed-in workspace. Loose Ends does not invent recovered revenue; modeled opportunity and verified recovery remain separate.</div>'+
      '<div class="le-launch-modal-actions"><button id="le-on-cancel">Not now</button><button id="le-on-save" style="background:#101828;color:#fff">Save profile</button><button id="le-on-finish" style="background:#56d9b1;color:#062019">Finish setup</button></div></div>';
    document.body.appendChild(m);
    var set=await settings(w);if(set){document.getElementById('le-on-type').value=set.business_type||'Other Small Business';document.getElementById('le-on-tz').value=set.timezone||'America/New_York'}
    document.getElementById('le-on-cancel').onclick=close;
    document.getElementById('le-on-save').onclick=async function(){await saveProfile(w)};
    document.getElementById('le-on-finish').onclick=async function(){if(await saveProfile(w))await finish(w)};
    document.getElementById('le-on-qb').onclick=function(){close();if(window.LEQuickBooks&&window.LEQuickBooks.sync)toast('QuickBooks sync requires its connection to be authorized first.');else toast('QuickBooks bridge is not loaded yet.')};
    if(!force)m.addEventListener('click',function(e){if(e.target===m)close()});
  }
  function panel(){
    var page=document.querySelector('#content .page');if(!page||document.getElementById('le-launch-panel'))return;css();
    workspace().then(async function(w){if(!w)return;var c=await counts(w),s=await settings(w);var done=!!(s&&s.onboarding_completed);var box=document.createElement('section');box.id='le-launch-panel';box.className='le-launch-wrap';box.innerHTML='<div class="le-launch-head"><div><div class="le-launch-kicker">CUSTOMER LAUNCH CENTER</div><div class="le-launch-title">'+(done?'Workspace operations center':'Finish setting up your workspace')+'</div><div class="le-launch-sub">'+(done?'Your workspace is connected. Use this center to import data, audit revenue, and manage automations.':'Connect the business once, then let Loose Ends turn existing business activity into a prioritized recovery queue.')+'</div></div><button class="le-launch-close" id="le-launch-open">'+(done?'Manage setup':'Start setup')+'</button></div><div class="le-launch-steps">'+
      '<div class="le-launch-step '+(done?'done':'')+'"><b>1 · Profile</b><small>'+esc(w.name||'Business')+'</small></div><div class="le-launch-step '+(c.customers?'done':'')+'"><b>2 · Data</b><small>'+c.customers+' customers · '+c.opps+' opportunities</small></div><div class="le-launch-step '+(c.followups?'done':'')+'"><b>3 · Follow-ups</b><small>'+c.followups+' recovery actions</small></div><div class="le-launch-step"><b>4 · Automations</b><small>Workflow recipes ready</small></div><div class="le-launch-step"><b>5 · Measure</b><small>Recovered revenue attribution</small></div></div><div class="le-launch-actions">'+
      '<button class="le-launch-primary" id="le-launch-import">Import business data</button><button class="le-launch-secondary" id="le-launch-audit">Run revenue audit</button><button class="le-launch-secondary" id="le-launch-workflows">Open automations</button><button class="le-launch-secondary" id="le-launch-settings">Business settings</button></div>';
    page.insertBefore(box,page.firstChild);document.getElementById('le-launch-open').onclick=function(){open(w,true)};document.getElementById('le-launch-import').onclick=function(){if(window.LELiveProduct&&window.LELiveProduct.importCsv)window.LELiveProduct.importCsv();else toast('Import is not loaded yet.')};document.getElementById('le-launch-audit').onclick=function(){if(window.LERevenueEngine&&window.LERevenueEngine.audit)window.LERevenueEngine.audit();else toast('Revenue audit is not loaded yet.')};document.getElementById('le-launch-workflows').onclick=function(){if(window.LEWorkflows){if(window.LE&&LE.setView)LE.setView('workflows');else toast('Open Automations from the navigation.')}else toast('Workflow engine is not loaded yet.')};document.getElementById('le-launch-settings').onclick=function(){if(window.LE&&LE.setView)LE.setView('settings')};
    });
  }
  async function boot(){
    var w=await workspace();if(!w)return;
    var s=await settings(w);
    if(!s||!s.onboarding_completed){setTimeout(function(){open(w,false)},700)}
    var v=(window.LE&&window.LE.state&&window.LE.state.view)||'overview';
    if(v==='overview'||v==='loose'||v==='recovery')setTimeout(panel,1200);
    if(window.LE&&LE.setView&&!LE.setView.__launchWrapped){var old=LE.setView;var wrap=function(view){old(view);setTimeout(function(){if(view==='overview'||view==='loose'||view==='recovery')panel()},200)};wrap.__launchWrapped=true;LE.setView=wrap}
  }
  window.LELaunchCenter={open:open,refresh:panel,finish:finish};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();