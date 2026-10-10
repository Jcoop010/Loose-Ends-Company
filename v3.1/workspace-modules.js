/* Live Tasks + Documents modules for the existing workspace runtime. */
(function(){
  'use strict';
  var S=window.LESupabase;
  if(!S)return;
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function money(v){return '$'+Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});}
  function state(){return window.LE&&window.LE.getState?window.LE.getState():null;}
  function toast(msg){var e=document.getElementById('toast');if(e){e.textContent=msg;e.className='toast show';setTimeout(function(){e.className='toast';},2400);}}
  function addNav(){
    var nav=document.querySelector('.sidebar nav');if(!nav)return;
    var rev=nav.querySelector('[data-view="recovery"]');
    [['tasks','✓','Tasks'],['documents','▤','Documents']].forEach(function(item){
      if(nav.querySelector('[data-view="'+item[0]+'"]'))return;
      var b=document.createElement('button');b.type='button';b.className='nav-item';b.setAttribute('data-view',item[0]);b.innerHTML='<span>'+item[1]+'</span>'+item[2];
      if(rev)nav.insertBefore(b,rev);else nav.appendChild(b);
    });
  }
  function styles(){
    if(document.getElementById('le-work-modules-css'))return;
    var s=document.createElement('style');s.id='le-work-modules-css';s.textContent='.le-module-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}.le-module-form{display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:9px;align-items:end;margin:14px 0}.le-module-form label{display:block;font-size:11px;color:#9eabb7;font-weight:800}.le-module-form input,.le-module-form select{width:100%;margin-top:6px;background:#0b1822;border:1px solid #2a3b4a;color:#f8fafc;border-radius:9px;padding:11px;box-sizing:border-box}.le-module-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0;border-bottom:1px solid rgba(255,255,255,.07)}.le-module-row:last-child{border-bottom:0}.le-module-row strong{display:block}.le-module-row small{display:block;color:#9eabb7;margin-top:4px}.le-module-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.le-module-empty{padding:24px;text-align:center;color:#9eabb7}.le-module-status{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#ff984d}@media(max-width:700px){.le-module-form{grid-template-columns:1fr}.le-module-row{align-items:flex-start;flex-direction:column}}';document.head.appendChild(s);
  }
  function head(title,sub){return '<div class="page"><div class="page-head"><div><div class="eyebrow">WORKSPACE</div><div class="title">'+title+'</div><div class="subtitle">'+sub+'</div></div><div class="date">LIVE DATA</div></div>';}
  function renderTasks(){
    var st=state(),content=document.getElementById('content');if(!content||!st)return;
    var list=(st.tasks||[]).slice().sort(function(a,b){return String(a.due_at||'9999').localeCompare(String(b.due_at||'9999'));});
    content.innerHTML=head('Tasks','Keep next steps, owners, and due dates visible.')+
      '<div class="card section-card"><div class="section-head"><div><div class="section-title">Create a task</div><div class="section-sub">Tasks save to this signed-in business workspace.</div></div><span class="le-module-status">'+list.filter(function(t){return t.status==='open';}).length+' open</span></div>'+
      '<form id="le-task-form" class="le-module-form"><label>Task<input name="title" maxlength="200" required placeholder="e.g. Follow up on proposal"></label><label>Due date<input name="due" type="date"></label><label>Priority<select name="priority"><option value="1">Low</option><option value="2" selected>Normal</option><option value="3">High</option></select></label><button class="primary" type="submit">Add task</button></form></div>'+
      '<div class="card section-card"><div class="section-head"><div><div class="section-title">Task list</div><div class="section-sub">Mark work done when it is actually complete.</div></div></div>'+
      (list.length?list.map(function(t){return '<div class="le-module-row"><div><strong>'+esc(t.title)+'</strong><small>'+esc(t.due_at?'Due '+new Date(t.due_at).toLocaleDateString():'No due date')+' · Priority '+esc(t.priority||1)+'</small></div><div class="le-module-actions"><span class="le-module-status">'+esc(t.status||'open')+'</span>'+(t.status==='open'?'<button type="button" class="action" data-task-done="'+esc(t.id)+'">Mark done</button>':'<button type="button" class="action secondary" data-task-reopen="'+esc(t.id)+'">Reopen</button>')+'</div></div>';}).join(''):'<div class="le-module-empty">No tasks yet. Add the first next step above.</div>')+'</div></div>';
    var form=document.getElementById('le-task-form');form.onsubmit=async function(e){e.preventDefault();var ws=st.workspaceId;if(!ws){toast('Sign in to save tasks');return;}var fd=new FormData(form),due=String(fd.get('due')||''),title=String(fd.get('title')||'').trim();if(!title)return;var result=await S.from('tasks').insert({workspace_id:ws,title:title,status:'open',priority:Number(fd.get('priority')||2),due_at:due?new Date(due+'T17:00:00').toISOString():null}).select().single();if(result.error){toast('Task could not be saved: '+result.error.message);return;}form.reset();await window.LE.refresh();renderTasks();toast('Task saved');};
    content.querySelectorAll('[data-task-done],[data-task-reopen]').forEach(function(b){b.onclick=async function(){var id=b.getAttribute('data-task-done')||b.getAttribute('data-task-reopen'),status=b.hasAttribute('data-task-done')?'done':'open';var r=await S.from('tasks').update({status:status,updated_at:new Date().toISOString()}).eq('id',id).eq('workspace_id',st.workspaceId);if(r.error){toast('Could not update task: '+r.error.message);return;}await window.LE.refresh();renderTasks();toast(status==='done'?'Task completed':'Task reopened');};});
  }
  function renderDocuments(){
    var st=state(),content=document.getElementById('content');if(!content||!st)return;
    var list=(st.documents||[]).slice().sort(function(a,b){return String(b.created_at||'').localeCompare(String(a.created_at||''));});
    content.innerHTML=head('Documents','Track quotes, orders, invoices, and payment status.')+
      '<div class="card section-card"><div class="section-head"><div><div class="section-title">Create a document record</div><div class="section-sub">This creates a tracker record; it does not send an invoice or collect a payment.</div></div></div>'+
      '<form id="le-doc-form" class="le-module-form"><label>Document name / number<input name="number" maxlength="100" placeholder="Optional reference"></label><label>Type<select name="type"><option value="quote">Quote</option><option value="order">Order</option><option value="invoice">Invoice</option><option value="payment">Payment record</option><option value="purchase_order">Purchase order</option></select></label><label>Total ($)<input name="total" type="number" min="0" step="0.01" value="0" required></label><button class="primary" type="submit">Add record</button><label>Due date<input name="due" type="date"></label></form></div>'+
      '<div class="card section-card"><div class="section-head"><div><div class="section-title">Documents & balances</div><div class="section-sub">'+list.length+' records in this workspace</div></div></div>'+
      (list.length?list.map(function(d){return '<div class="le-module-row"><div><strong>'+esc(d.document_number||d.document_type||'Document')+'</strong><small>'+esc(String(d.document_type||'document').replace('_',' '))+' · '+esc(d.due_at?'Due '+new Date(d.due_at).toLocaleDateString():'No due date')+'</small></div><div class="le-module-actions"><strong>'+money(d.total)+'</strong><span class="le-module-status">'+esc(d.status||'draft')+'</span>'+(String(d.document_type)==='invoice'&&String(d.status)!=='paid'?'<button type="button" class="action" data-doc-paid="'+esc(d.id)+'">Mark paid</button>':'')+'</div></div>';}).join(''):'<div class="le-module-empty">No document records yet. Add a quote or invoice tracker above.</div>')+'</div></div>';
    var form=document.getElementById('le-doc-form');form.onsubmit=async function(e){e.preventDefault();var ws=st.workspaceId;if(!ws){toast('Sign in to save documents');return;}var fd=new FormData(form),due=String(fd.get('due')||''),type=String(fd.get('type')||'quote'),num=String(fd.get('number')||'').trim()||('LE-'+type.toUpperCase()+'-'+Date.now().toString().slice(-6));var result=await S.from('documents').insert({workspace_id:ws,document_type:type,document_number:num,status:'draft',total:Math.max(0,Number(fd.get('total')||0)),due_at:due?new Date(due+'T17:00:00').toISOString():null}).select().single();if(result.error){toast('Document could not be saved: '+result.error.message);return;}form.reset();await window.LE.refresh();renderDocuments();toast('Document record saved');};
    content.querySelectorAll('[data-doc-paid]').forEach(function(b){b.onclick=async function(){var r=await S.from('documents').update({status:'paid',updated_at:new Date().toISOString()}).eq('id',b.getAttribute('data-doc-paid')).eq('workspace_id',st.workspaceId);if(r.error){toast('Could not update invoice: '+r.error.message);return;}await window.LE.refresh();renderDocuments();toast('Invoice marked paid');};});
  }
  function boot(){
    styles();addNav();
    if(!window.LE||!window.LE.setView)return;
    var original=window.LE.setView;
    if(original.__leModulesWrapped)return;
    var wrapped=function(v){if(v==='tasks'){if(storedView()!==v)storeView(v);renderTasks();document.querySelectorAll('.nav-item').forEach(function(n){n.classList.toggle('active',n.dataset.view===v);});return;}if(v==='documents'){if(storedView()!==v)storeView(v);renderDocuments();document.querySelectorAll('.nav-item').forEach(function(n){n.classList.toggle('active',n.dataset.view===v);});return;}return original(v);};
    wrapped.__leModulesWrapped=true;window.LE.setView=wrapped;window.setView=wrapped;
    var s=state();if(s&&(s.view==='tasks'||s.view==='documents'))wrapped(s.view);
  }
  function storedView(){var s=state();return s&&s.view;}
  function storeView(v){try{var s=state();if(s)s.view=v;localStorage.setItem('loose_ends_v31_state',JSON.stringify({view:v,query:s&&s.query||''}));}catch(e){}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();