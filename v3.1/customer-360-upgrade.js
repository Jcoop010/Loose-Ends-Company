/* Loose Ends V4 — Customer 360 + recovery history. */
(function(){
  'use strict';
  function esc(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
  function money(n){return '$'+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:0})}
  function date(v){return v?new Date(v).toLocaleString():'—'}
  function client(){return window.LE&&window.LE.supabase||window.LESupabase||null}
  async function wid(c){var r=await c.auth.getUser(),u=r.data&&r.data.user;if(!u)return null;var m=await c.from('workspace_members').select('workspace_id').eq('user_id',u.id).limit(1).maybeSingle();return m.data&&m.data.workspace_id||null}
  async function open(customerId){
    var c=client();if(!c)return;
    var workspaceId=await wid(c);if(!workspaceId)return;
    var results=await Promise.all([
      c.from('customers').select('*').eq('id',customerId).eq('workspace_id',workspaceId).maybeSingle(),
      c.from('opportunities').select('*').eq('customer_id',customerId).eq('workspace_id',workspaceId).order('updated_at',{ascending:false}).limit(50),
      c.from('loose_ends').select('*').eq('customer_id',customerId).eq('workspace_id',workspaceId).order('created_at',{ascending:false}).limit(50),
      c.from('documents').select('*').eq('customer_id',customerId).eq('workspace_id',workspaceId).order('created_at',{ascending:false}).limit(50),
      c.from('appointments').select('*').eq('customer_id',customerId).eq('workspace_id',workspaceId).order('starts_at',{ascending:false}).limit(50),
      c.from('tasks').select('*').eq('customer_id',customerId).eq('workspace_id',workspaceId).order('created_at',{ascending:false}).limit(50),
      c.from('recovery_events').select('*').eq('customer_id',customerId).eq('workspace_id',workspaceId).order('created_at',{ascending:false}).limit(100)
    ]);
    var customer=results[0].data;if(!customer)return;
    var opps=results[1].data||[],loose=results[2].data||[],docs=results[3].data||[],appts=results[4].data||[],tasks=results[5].data||[],events=results[6].data||[];
    var openValue=opps.filter(function(x){return !['recovered','closed','won'].includes(String(x.status||'').toLowerCase())}).reduce(function(a,x){return a+Number(x.amount||0)},0)+loose.filter(function(x){return ['open','in_progress'].includes(String(x.status||'').toLowerCase())}).reduce(function(a,x){return a+Number(x.amount||0)},0);
    var recovered=events.filter(function(x){return ['collected','recover','recovered','payment_collected'].includes(String(x.source||'').toLowerCase())}).reduce(function(a,x){return a+Number(x.amount||0)},0);
    var name=[customer.first_name,customer.last_name].filter(Boolean).join(' ')||'Customer';
    var timeline=[];
    events.forEach(function(x){timeline.push({d:x.created_at||x.occurred_at||null,t:'Recovery',s:x.source||'recovery event',n:x.note||'',a:x.amount})});
    loose.forEach(function(x){timeline.push({d:x.created_at,t:'Loose End',s:x.reason||x.source_entity||'Revenue opportunity',n:x.status||'',a:x.amount})});
    appts.forEach(function(x){timeline.push({d:x.starts_at,t:'Appointment',s:x.status||'scheduled',n:x.title||'',a:0})});
    docs.forEach(function(x){timeline.push({d:x.created_at,t:'Document',s:x.document_type||'document',n:x.document_number||'',a:x.amount})});
    timeline.sort(function(a,b){return new Date(b.d||0)-new Date(a.d||0)});
    var box=document.getElementById('v4modal');if(!box)return;
    box.className='v4-modal';
    box.innerHTML='<div class="v4-modal-card"><div class="v4-section-head"><div><div class="v4-eyebrow">CUSTOMER 360</div><div class="v4-title">'+esc(name)+'</div><div class="v4-sub">'+esc(customer.phone||customer.email||'Customer record')+'</div></div><button class="v4-icon" onclick="if(window.V4&&V4.close)V4.close();else this.closest(\'.v4-modal\').remove()">×</button></div>'+
      '<div class="v4-kpis"><div class="v4-card v4-kpi"><div class="v4-kpi-value">'+money(openValue)+'</div><div class="v4-kpi-note">Open revenue context</div></div><div class="v4-card v4-kpi"><div class="v4-kpi-value">'+money(recovered)+'</div><div class="v4-kpi-note">Revenue recovered</div></div><div class="v4-card v4-kpi"><div class="v4-kpi-value">'+events.length+'</div><div class="v4-kpi-note">Recovery events</div></div></div>'+
      '<div class="v4-section-title">Recovery history</div><div class="v4-docs">'+(timeline.length?timeline.slice(0,30).map(function(x){return '<div class="v4-doc"><div><strong>'+esc(x.t)+' · '+esc(x.s)+'</strong><small>'+esc(date(x.d))+(x.n?' · '+esc(x.n):'')+'</small></div><b>'+((Number(x.a)||0)?money(x.a):'')+'</b></div>'}).join(''):'<div class="v4-empty">No activity recorded yet.</div>')+'</div>'+
      '<div class="v4-section-title" style="margin-top:18px">Customer context</div><div class="v4-docs"><div class="v4-doc"><strong>Open opportunities</strong><span>'+opps.filter(function(x){return !['closed','won','recovered'].includes(String(x.status||'').toLowerCase())}).length+'</span></div><div class="v4-doc"><strong>Loose Ends</strong><span>'+loose.filter(function(x){return x.status!=='dismissed'}).length+'</span></div><div class="v4-doc"><strong>Appointments</strong><span>'+appts.length+'</span></div><div class="v4-doc"><strong>Open tasks</strong><span>'+tasks.filter(function(x){return x.status==='open'}).length+'</span></div><div class="v4-doc"><strong>Documents</strong><span>'+docs.length+'</span></div></div></div>';
  }
  function attach(){
    var table=[].slice.call(document.querySelectorAll('.v4-table')).find(function(t){return /Customer/i.test((t.querySelector('thead')||{}).innerText||'')});
    if(!table)return;
    var list=window.LELiveData&&window.LELiveData.customers||[];
    table.querySelectorAll('tbody tr').forEach(function(row,i){var c=list[i];if(!c)return;row.dataset.customerId=c.id;row.style.cursor='pointer';row.onclick=function(){open(c.id)}});
  }
  window.LECustomer360={open:open,attach:attach};
  var observer=new MutationObserver(function(){try{attach()}catch(e){}});
  observer.observe(document.body,{childList:true,subtree:true});
  setTimeout(attach,800);
})();