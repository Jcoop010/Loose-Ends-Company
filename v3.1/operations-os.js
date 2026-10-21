/* Connected operations for the existing Loose Ends production runtime.
 * All mutations are acknowledged by a transactional, authorized database RPC.
 * No customer data is stored in localStorage. No external orders or messages are sent.
 */
(function () {
  'use strict';
  if (location.pathname === '/demo' || location.pathname.indexOf('/demo/') === 0) return;
  var S = window.LESupabase, seq = 0, workspace = null, cache = {}, current = '', page = 0, term = '', loading = false;
  var views = ['overview','inventory','jobs','purchasing','finance','team','operations'];
  function state() { return window.LE && window.LE.getState ? window.LE.getState() : {}; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function money(v) { return '$' + Number(v || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function toast(v) { var e=document.getElementById('toast'); if(e){e.textContent=v;e.className='toast show';setTimeout(function(){e.className='toast';},5000);} }
  function go(v) { window.LE.setView(v); }
  function button(text, action, id) { return '<button type="button" class="action" data-ops-action="'+esc(action)+'" data-id="'+esc(id||'')+'">'+esc(text)+'</button>'; }
  function field(label,name,type,value,extra) { return '<label>'+esc(label)+'<input name="'+name+'" type="'+(type||'text')+'" value="'+esc(value||'')+'" '+(extra||'')+'></label>'; }
  function form(id,body,submit) { return '<form class="ops-form" id="'+id+'">'+body+'<button class="primary" type="submit">'+submit+'</button></form>'; }
  function section(title,body,sub) { return '<section class="card section-card"><h2>'+title+'</h2>'+(sub?'<p class="subtitle">'+sub+'</p>':'')+body+'</section>'; }
  function empty(text) { return '<p class="ops-empty">'+esc(text)+'</p>'; }
  function row(title,sub,actions) { return '<div class="ops-row"><div><strong>'+esc(title)+'</strong><small>'+esc(sub)+'</small></div><div class="ops-actions">'+(actions||'')+'</div></div>'; }
  function metric(label,value) { return '<div class="ops-metric"><span>'+label+'</span><strong>'+esc(value)+'</strong></div>'; }
  function pager(rows) { return '<div class="ops-actions">'+(page?button('Previous','previous'):'')+'<span>Page '+(page+1)+'</span>'+(rows.length===50?button('Next','next'):'')+'</div>'; }
  function customerOptions() { return '<option value="">No customer selected</option>'+(state().customers||[]).map(function(c){return '<option value="'+esc(c.id)+'">'+esc([c.first_name,c.last_name].filter(Boolean).join(' '))+'</option>';}).join(''); }
  function workers() { return '<option value="">Unassigned</option>'+(cache.team||[]).map(function(m){return '<option value="'+esc(m.user_id)+'">'+esc(m.user_id.slice(0,8)+' · '+m.role)+'</option>';}).join(''); }
  function shell(view,body) {
    var title={overview:'Executive Command Center',inventory:'Inventory',jobs:'Jobs & Estimates',purchasing:'Purchasing',finance:'Finance',team:'Team Operations',operations:'Autonomous Operations'}[view];
    return '<div class="page ops-page" id="ops-page" data-ops-view="'+view+'"><div class="page-head"><div><div class="eyebrow">LOOSE ENDS OS</div><h1>'+title+'</h1><p class="subtitle">Your Business. Running Smarter.</p></div>'+button('Refresh','refresh')+'</div><div id="ops-error" role="alert"></div>'+body+'</div>';
  }
  async function query(table,configure) {
    var q=S.from(table).select('*').eq('workspace_id',workspace);q=configure?configure(q):q.order('created_at',{ascending:false}).limit(50);
    var r=await q;if(r.error)throw r.error;return r.data||[];
  }
  async function load(view) {
    var ws=state().workspaceId, ticket=++seq;
    if(!ws){cache={};workspace=null;render(view,'Sign in to access your workspace.');return;}
    workspace=ws;loading=true;
    try {
      var jobs=[];
      if(view==='overview'||view==='finance') jobs.push(S.rpc('ops_summary',{p_workspace:ws}).then(function(r){if(r.error)throw r.error;return ['summary',r.data||{}];}));
      if(view==='inventory') jobs.push(query('inventory_items',function(q){q=q.eq('archived',false).order('sku');if(term)q=q.or('name.ilike.%'+term+'%,sku.ilike.%'+term+'%');return q.range(page*50,page*50+49);}).then(function(x){return ['items',x];}));
      if(view==='jobs'||view==='overview'||view==='team')jobs.push(query('ops_jobs',function(q){return q.order('created_at',{ascending:false}).range(page*50,page*50+49);}).then(function(x){return ['jobs',x];}));
      if(view==='jobs'||view==='team')jobs.push(query('workspace_members',function(q){return q.order('created_at').limit(100);}).then(function(x){return ['team',x];}));
      if(view==='purchasing'||view==='overview')jobs.push(query('ops_purchase_orders').then(function(x){return ['purchases',x];}));
      if(view==='operations'||view==='overview') {
        jobs.push(query('ops_queue').then(function(x){return ['queue',x];}));
        jobs.push(query('ops_policies',function(q){return q.limit(1);}).then(function(x){return ['policy',x[0]||{enabled:false,draft_limit:1000,industry:'general'}];}));
        jobs.push(query('ops_audit',function(q){return q.order('created_at',{ascending:false}).limit(20);}).then(function(x){return ['audit',x];}));
      }
      if(view==='finance')jobs.push(query('ops_expenses').then(function(x){return ['expenses',x];}));
      var results=await Promise.all(jobs);
      if(ticket!==seq||state().workspaceId!==ws||current!==view)return;
      results.forEach(function(x){cache[x[0]]=x[1];});render(view);
    } catch(e) {if(ticket===seq&&state().workspaceId===ws)render(view,e.message||'Operations could not load.');}
    finally {if(ticket===seq)loading=false;}
  }
  async function command(action,payload,key) {
    if(!workspace||workspace!==state().workspaceId)throw new Error('Workspace changed. Refresh and try again.');
    var ws=workspace;
    var r=await S.rpc('ops_command',{p_workspace:ws,p_action:action,p_payload:payload,p_key:key||crypto.randomUUID()});
    if(r.error)throw r.error;if(state().workspaceId!==ws)throw new Error('Workspace changed before confirmation.');
    return r.data;
  }
  function overview() {
    var m=cache.summary||{},queue=cache.queue||[],drafts=(cache.purchases||[]).filter(function(x){return x.status==='draft';});
    var next=[];
    if(m.low_stock) next.push(row('Review '+m.low_stock+' stock alert(s)','Available stock is at or below the reorder threshold. Review job needs and prepare purchasing drafts.',button('Open inventory','goto-inventory')));
    if(drafts.length)next.push(row(drafts.length+' purchase draft(s) need approval','Internal drafts have not been submitted to suppliers. Review costs before approval.',button('Review drafts','goto-purchasing')));
    if(m.urgent_tasks)next.push(row(m.urgent_tasks+' task(s) overdue','A task due date has passed. Review the responsible person and next step.',button('Review tasks','goto-tasks')));
    if(m.unpaid_invoices)next.push(row('Outstanding invoice records: '+money(m.unpaid_invoices),'Review balances and prepare follow-up. These are recorded invoice totals, not verified cash.',button('Review finance','goto-finance')));
    return '<div class="ops-health">'+metric("Today’s appointments",m.today_jobs||0)+metric('Open jobs',m.open_jobs||0)+metric('Open estimates',m.open_estimates||0)+metric('Outstanding invoices',money(m.unpaid_invoices))+metric('Overdue tasks',m.urgent_tasks||0)+metric('Stock alerts',m.low_stock||0)+'</div><div class="ops-columns">'+section('Next Best Actions',next.length?next.slice(0,4).join(''):empty('No urgent operations detected. Add customers, jobs and stock to start coordinating your business.'))+section('Autonomous Operations',row(cache.policy&&cache.policy.enabled?'Inventory drafts enabled':'Inventory drafts paused','Backend checks run every minute. Supplier orders and external messages remain disabled.',button('Manage policies','goto-operations'))+(queue.length?queue.slice(0,4).map(function(q){return row(q.status.replace('_',' '),q.error||(q.result&&q.result.outcome)||'Low-stock review pending');}).join(''):empty('No operations have run yet.')) )+'</div>'+section('Departments','<div class="ops-departments">'+[['customers','CRM'],['jobs','Jobs & Estimates'],['inventory','Inventory'],['purchasing','Purchasing'],['calendar','Scheduling'],['finance','Finance'],['loose','Revenue Intelligence'],['team','Team'],['operations','Operations'],['workflows','Workflows']].map(function(x){return button(x[1],'goto-'+x[0]);}).join('')+'</div>');
  }
  function inventory() {
    var items=cache.items||[];
    return section('Stock records',form('ops-search',field('Search name or SKU','search','search',term),'Search')+'<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Item / SKU</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Cost value</th><th>Actions</th></tr></thead><tbody>'+items.map(function(i){return '<tr><td><strong>'+esc(i.name)+'</strong><small>'+esc(i.sku+' · '+(i.location||'No location'))+'</small></td><td>'+i.quantity+'</td><td>'+i.reserved+'</td><td class="'+(i.quantity-i.reserved<=i.reorder_threshold?'ops-warning':'')+'">'+(i.quantity-i.reserved)+'</td><td>'+money(i.quantity*i.purchase_cost)+'</td><td><div class="ops-actions">'+button('Stock','stock',i.id)+button('Edit','edit-item',i.id)+button('History','history',i.id)+button('Reorder draft','reorder',i.id)+button('Archive','archive',i.id)+'</div></td></tr>';}).join('')+'</tbody></table></div>'+(items.length?'':empty('No inventory matches this page. Add your first item below.'))+pager(items))+
    section('Add inventory',inventoryForm())+section('CSV import',form('ops-csv','<label>Inventory CSV<input name="file" type="file" accept=".csv,text/csv" required></label>','Import records')+'<p class="subtitle">Required headers: name, sku. Optional: barcode, category, description, supplier, location, purchase_cost, selling_price, reorder_threshold, reorder_quantity. Metadata import only; receive opening stock separately. Each confirmed row is counted. Retrying the same file uses stable row receipts.</p><div id="ops-import-result" role="status"></div>');
  }
  function inventoryForm(i) {i=i||{};return form('ops-item',field('Name','name','text',i.name,'required maxlength="200"')+field('SKU','sku','text',i.sku,'required maxlength="100"')+['barcode','category','supplier','location'].map(function(k){return field(k.replace('_',' '),k,'text',i[k],'maxlength="200"');}).join('')+field('Description','description','text',i.description,'maxlength="2000"')+['purchase_cost','selling_price','reorder_threshold','reorder_quantity'].map(function(k){return field(k.replace(/_/g,' '),k,'number',i[k]==null?(k==='reorder_quantity'?1:0):i[k],'min="'+(k==='reorder_quantity'?'0.001':'0')+'" step="0.001" required');}).join('')+(i.id?'<input type="hidden" name="id" value="'+esc(i.id)+'">':''),'Save item');}
  function jobs() {
    var list=cache.jobs||[];
    return section('Work pipeline',list.map(function(j){var actions=button('Details','job-detail',j.id),next={draft:'quoted',quoted:'approved',approved:'in_progress',scheduled:'in_progress',in_progress:'completed'}[j.status];if(next)actions+=button(next==='quoted'?'Prepare quote':next==='approved'?'Record approval':next==='in_progress'?'Start job':'Complete & draft invoice','job-'+next,j.id);if(['draft','quoted','approved','scheduled','in_progress'].includes(j.status))actions+=button('Allocate stock','allocate',j.id)+button('Edit notes / checklist','job-edit',j.id)+button('Cancel','job-cancelled',j.id);if(['approved','scheduled'].includes(j.status))actions+=button('Schedule','schedule',j.id);return row(j.title,j.status+' · Labor '+money(j.labor_total)+' · '+(j.customer_id?'Customer linked':'No customer')+' · '+(j.assigned_to?'Assigned '+j.assigned_to.slice(0,8):'Unassigned'),actions);}).join('')+(list.length?'':empty('Create an estimate to begin the approval → job → materials → invoice lifecycle.'))+pager(list))+
    section('New estimate / work order',form('ops-job',field('Title','title','text','','required maxlength="200"')+'<label>Customer<select name="customer_id">'+customerOptions()+'</select></label><label>Assigned worker<select name="assigned_to">'+workers()+'</select></label>'+field('Labor estimate ($)','labor_total','number',0,'min="0" step="0.01" required')+'<label>Priority<select name="priority"><option>normal</option><option>low</option><option>high</option><option>urgent</option></select></label>'+field('Notes','notes','text','','maxlength="2000"'),'Create estimate'));
  }
  function purchasing() {var list=cache.purchases||[];return section('Purchase-order drafts',list.map(function(p){return row((p.supplier||'Supplier not specified')+' · '+money(p.unit_cost*p.quantity),p.status+' · Quantity '+p.quantity+' · Item '+p.item_id.slice(0,8),p.status==='draft'?button('Approve internally','po-approved',p.id)+button('Deny','po-denied',p.id):p.status==='approved'?button('Confirm receipt','po-received',p.id):'');}).join('')||empty('No purchase drafts yet. Use Reorder draft in Inventory or enable low-stock drafts.'),'Approval does not submit an order or authorize a charge. Receiving requires a delivery reference and adds stock atomically.');}
  function finance() {var m=cache.summary||{};return '<div class="ops-health">'+metric('Invoiced records',money(m.invoice_total))+metric('Outstanding invoices',money(m.unpaid_invoices))+metric('Marked paid by owner',money(m.owner_reported_paid))+metric('Provider-verified recovery (USD)',money(m.verified_collections))+metric('Recorded expenses',money(m.expenses))+metric('Unpaid vendor bills',money(m.bills_due))+'</div>'+section('Invoices & payments',row('Finance evidence','Invoice statuses and paid records are owner-reported. Provider-verified recovery is shown separately and may cover only attributed recovery payments.',button('Open documents','goto-documents')))+section('Record expense / vendor bill',form('ops-expense',field('Vendor','vendor','text','','required maxlength="200"')+field('Description','description','text','','maxlength="2000"')+field('Amount ($)','amount','number','','required min="0" step="0.01"')+field('Due date','due_at','date')+'<label>Status<select name="paid"><option value="false">Unpaid bill</option><option value="true">Owner-reported paid expense</option></select></label>','Save expense'))+section('Recent expenses',(cache.expenses||[]).map(function(x){return row(x.vendor+' · '+money(x.amount),(x.paid?'Owner-reported paid':'Unpaid')+(x.due_at?' · Due '+x.due_at:'')+' · '+(x.description||''));}).join('')||empty('No expenses recorded.'));}
  function team() {return section('Workspace team',(cache.team||[]).map(function(m){var assigned=(cache.jobs||[]).filter(function(j){return j.assigned_to===m.user_id&&j.status!=='completed'&&j.status!=='cancelled';});return row(m.user_id.slice(0,8)+' · '+m.role,assigned.length+' open jobs in the latest 50 jobs',button('Open jobs','goto-jobs'));}).join('')||empty('No team membership found.'),'Access follows existing workspace membership. Assign workers in Jobs. Payroll and invitations are not enabled here.');}
  function operations() {var p=cache.policy||{enabled:false,draft_limit:1000,industry:'general'};return section('Owner automation policy',form('ops-policy','<label>Low-stock draft automation<select name="enabled"><option value="false" '+(!p.enabled?'selected':'')+'>Paused (kill switch)</option><option value="true" '+(p.enabled?'selected':'')+'>Enabled: internal drafts only</option></select></label>'+field('Maximum automatic draft value ($)','draft_limit','number',p.draft_limit,'required min="0" step="0.01"')+'<label>Industry context<select name="industry">'+['general','auto_repair','hvac','plumbing','electrical','general_contracting','landscaping','home_services'].map(function(x){return '<option '+(p.industry===x?'selected':'')+' value="'+x+'">'+x.replace(/_/g,' ')+'</option>';}).join('')+'</select></label>','Save policy'),'Backend checks run every minute. The engine observes shortages, checks policy, creates internal drafts and verifies saved records. No supplier ordering, payments or customer sending is enabled. Policy limits control drafting only.')+section('Execution & recovery',(cache.queue||[]).map(function(q){return row(q.status.replace(/_/g,' '),'Attempt '+q.attempts+' · '+(q.error||(q.result&&q.result.outcome)||'Pending backend execution'),q.status==='dead_letter'?button('Retry safely','retry',q.id):'');}).join('')||empty('No operations have run. Enable the policy and add a low-stock item.'))+section('Audit & verified outcomes',(cache.audit||[]).map(function(a){return row(a.action.replace(/_/g,' '),new Date(a.created_at).toLocaleString()+' · '+(a.actor_id?'User action':'Backend action')+' · '+a.entity_id);}).join('')||empty('No operational activity yet.'));}
  function render(view,error) {
    if(!views.includes(view)||current!==view)return;
    var el=document.getElementById('content');if(!el)return;
    var body=error?empty(error):view==='overview'?overview():view==='inventory'?inventory():view==='jobs'?jobs():view==='purchasing'?purchasing():view==='finance'?finance():view==='team'?team():operations();
    el.innerHTML=shell(view,body);bind();
  }
  function modal(title,body) {
    var old=document.getElementById('ops-modal');if(old)old.remove();
    var d=document.createElement('div');d.id='ops-modal';d.className='ops-modal-wrap';d.innerHTML='<section class="ops-modal" role="dialog" aria-modal="true" aria-label="'+esc(title)+'"><h2>'+esc(title)+'</h2>'+button('Close','close-modal')+body+'<p id="ops-modal-error" role="alert"></p></section>';document.body.appendChild(d);
    d.querySelector('[data-ops-action="close-modal"]').onclick=function(){d.remove();};bindForms(d);
    var input=d.querySelector('input,select,button');if(input)input.focus();
    d.addEventListener('keydown',function(e){if(e.key==='Escape')d.remove();if(e.key==='Tab'){var nodes=d.querySelectorAll('input,select,button,textarea'),first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
  }
  async function action(name,id) {
    if(name.indexOf('goto-')===0){go(name.slice(5));return;}
    if(name==='refresh'){load(current);return;}if(name==='next'||name==='previous'){page+=name==='next'?1:-1;load(current);return;}
    var item=(cache.items||[]).find(function(x){return x.id===id;}),job=(cache.jobs||[]).find(function(x){return x.id===id;});
    if(name==='edit-item'){modal('Edit inventory',inventoryForm(item));return;}
    if(name==='stock'){modal('Stock movement',form('ops-stock','<input type="hidden" name="id" value="'+esc(id)+'"><label>Movement<select name="kind"><option value="receipt">Receipt</option><option value="adjustment">Adjustment (+ or −)</option><option value="return">Return to stock</option></select></label>'+field('Quantity','quantity','number','','required step="0.001"')+field('Reason / receipt reference','reason','text','','required maxlength="500"'),'Save movement'));return;}
    if(name==='history'){var ws=workspace;var r=await S.from('inventory_movements').select('*').eq('workspace_id',workspace).eq('item_id',id).order('created_at',{ascending:false}).limit(50);if(r.error)throw r.error;if(ws!==state().workspaceId)return;modal('Inventory history',(r.data||[]).map(function(m){return row(m.kind+' · '+m.quantity,'Balance '+m.balance+' · '+m.reason+' · '+new Date(m.created_at).toLocaleString());}).join('')||empty('No movements yet.'));return;}
    if(name==='allocate'){modal('Allocate stock',form('ops-reserve','<input name="id" type="hidden" value="'+esc(id)+'">'+field('Inventory SKU','sku','text','','required')+field('Reserve quantity','quantity','number','','min="0.001" step="0.001" required'),'Reserve'));return;}
    if(name==='job-edit'){modal('Job notes & completion checklist',form('ops-job-update','<input name="id" type="hidden" value="'+esc(id)+'"><label>Assigned worker<select name="assigned_to">'+workers()+'</select></label>'+field('Notes','notes','text',job.notes,'maxlength="2000"')+'<label>Checklist (one completed item per line)<textarea name="checklist" rows="5">'+esc((job.checklist||[]).map(function(x){return x.title;}).join('\n'))+'</textarea></label>','Save completed checklist'));var select=document.querySelector('#ops-job-update [name="assigned_to"]');select.value=job.assigned_to||'';return;}
    if(name==='job-detail'){var ws2=workspace;var r2=await S.from('job_materials').select('*').eq('workspace_id',workspace).eq('job_id',id).limit(100);if(r2.error)throw r2.error;if(ws2!==state().workspaceId)return;var materials=r2.data||[],cost=materials.reduce(function(n,m){return n+m.quantity*m.unit_cost;},0),sale=materials.reduce(function(n,m){return n+m.quantity*m.unit_price;},0)+Number(job.labor_total);modal(job.title,row('Status: '+job.status,job.notes||'No notes')+row('Estimated margin before labor costs: '+money(sale-cost),'Materials cost '+money(cost)+' · Quoted materials & labor '+money(sale))+row('Approval evidence',job.approval_evidence||'No approval recorded')+(materials.map(function(m){return row(m.item_id.slice(0,8)+' · '+m.quantity,m.state);}).join('')||empty('No materials allocated.'))+(job.invoice_id?row('Invoice draft',job.invoice_id):''));return;}
    if(name==='schedule'){modal('Schedule approved job',form('ops-schedule','<input name="id" type="hidden" value="'+esc(id)+'">'+field('Start (your device time zone)','starts_at','datetime-local','','required')+field('End (your device time zone)','ends_at','datetime-local','','required'),'Save booking'));return;}
    if(name.indexOf('job-')===0){var target=name.slice(4),payload={id:id,status:target};if(target==='approved'){var evidence=window.prompt('Customer approval evidence (email, signed estimate or reference):');if(!evidence)return;payload.approval_evidence=evidence;}if(target==='completed'){if(!window.confirm('Confirm the checklist and work are complete. Reserved materials will be consumed and one invoice draft created.'))return;payload.checklist_confirmed=true;}if(target==='cancelled'&&!window.confirm('Cancel this job and release reserved stock?'))return;await command('job_transition',payload);}
    else if(name==='reorder')await command('purchase_draft',{id:id});
    else if(name==='archive'){if(!window.confirm('Archive this item? Movement history will be retained.'))return;await command('inventory_archive',{id:id});}
    else if(name.indexOf('po-')===0){var status=name.slice(3),p={id:id,status:status};if(status==='received'){var ref=window.prompt('Delivery receipt or packing-slip reference (confirm goods physically received):');if(!ref)return;p.receipt_reference=ref;}await command('purchase_transition',p);}
    else if(name==='retry')await command('queue_retry',{id:id});
    else return;
    toast('Saved and confirmed.');await load(current);
  }
  function bindForms(root) {
    root.querySelectorAll('form[id^="ops-"]').forEach(function(f){f.onsubmit=async function(e){e.preventDefault();var b=f.querySelector('button[type="submit"]');if(b.disabled)return;b.disabled=true;var fd=new FormData(f),p=Object.fromEntries(fd.entries()),key=f.dataset.receipt||(f.dataset.receipt=crypto.randomUUID());try {
      if(f.id==='ops-search'){term=String(p.search||'').replace(/[%_,().]/g,' ').trim().slice(0,100);page=0;await load(current);return;}
      if(f.id==='ops-csv'){await importCSV(fd.get('file'));return;}
      var cmd={ 'ops-item':'inventory_save','ops-job':'job_save','ops-stock':'stock_move','ops-reserve':'reserve_material','ops-policy':'policy_save','ops-expense':'expense_save','ops-schedule':'schedule_job','ops-job-update':'job_update'}[f.id];
      if(f.id==='ops-reserve'){var r=await S.from('inventory_items').select('id').eq('workspace_id',workspace).eq('sku',String(p.sku)).eq('archived',false).single();if(r.error)throw r.error;p.item_id=r.data.id;delete p.sku;}
      if(f.id==='ops-policy'){p.enabled=p.enabled==='true';}
      if(f.id==='ops-expense')p.paid=p.paid==='true';
      if(f.id==='ops-schedule'){p.starts_at=new Date(String(p.starts_at)).toISOString();p.ends_at=new Date(String(p.ends_at)).toISOString();}
      if(f.id==='ops-job-update')p.checklist=String(p.checklist||'').split('\n').map(function(x){return x.trim();}).filter(Boolean).map(function(x){return {title:x,done:true};});
      await command(cmd,p,key);var m=document.getElementById('ops-modal');if(m)m.remove();toast('Saved and confirmed.');await load(current);
    }catch(err){var box=document.getElementById('ops-modal-error')||document.getElementById('ops-error');if(box)box.textContent=err.message||'Save failed. Retry the unchanged form to reconcile the same request.';toast(err.message||'Save failed.');}finally{b.disabled=false;}};
    // Editing after a failed request is a new command; retrying unchanged input reuses its receipt.
    f.addEventListener('input',function(){delete f.dataset.receipt;});});
  }
  function bind() {var el=document.getElementById('ops-page');if(!el)return;el.querySelectorAll('[data-ops-action]').forEach(function(b){b.onclick=async function(){if(b.disabled)return;b.disabled=true;try{await action(b.dataset.opsAction,b.dataset.id);}catch(e){toast(e.message||'Operation failed.');}finally{b.disabled=false;}};});bindForms(el);}
  function parseCSV(text) {
    var rows=[],row=[],cell='',quoted=false;
    text=String(text).replace(/^\uFEFF/,'');
    for(var i=0;i<text.length;i++){var c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(function(x){return x.trim();}))rows.push(row);row=[];cell='';}else cell+=c;}
    if(quoted)throw new Error('CSV has an unclosed quoted field.');row.push(cell);if(row.some(function(x){return x.trim();}))rows.push(row);return rows;
  }
  async function importCSV(file) {
    if(!file||file.size>2000000)throw new Error('Choose an inventory CSV under 2 MB.');
    var text=await file.text(),rows=parseCSV(text),headers=(rows.shift()||[]).map(function(h){return h.trim().toLowerCase();}),seen=new Set(),allowed=['name','sku','barcode','category','description','supplier','location','purchase_cost','selling_price','reorder_threshold','reorder_quantity'];
    if(!headers.includes('name')||!headers.includes('sku')||new Set(headers).size!==headers.length)throw new Error('CSV requires unique name and sku headers.');
    if(rows.length>500)throw new Error('Import up to 500 inventory records per file.');
    var records=rows.map(function(r,i){var p={};headers.forEach(function(h,j){if(allowed.includes(h)&&r[j]!==undefined&&r[j]!=='')p[h]=r[j];});if(!p.name||!p.sku||seen.has(p.sku))throw new Error('Missing name/SKU or duplicate SKU at row '+(i+2));seen.add(p.sku);return p;});
    var digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(function(x){return x.toString(16).padStart(2,'0');}).join(''),count=0,ws=workspace;
    for(var i=0;i<records.length;i++){if(ws!==state().workspaceId)throw new Error('Workspace changed; import stopped.');await command('inventory_save',records[i],'inventory-csv:'+digest+':'+i);count++;var result=document.getElementById('ops-import-result');if(result)result.textContent=count+' / '+records.length+' records confirmed.';}
    toast(count+' inventory records confirmed.');await load(current);
  }
  function chrome() {
    var tag=document.querySelector('.brand-tag');if(tag&&tag.textContent!=='Business Operations OS')tag.textContent='Business Operations OS';
    var nav=document.querySelector('.sidebar nav');if(nav){[['overview','Command Center'],['jobs','Jobs & Estimates'],['inventory','Inventory'],['purchasing','Purchasing'],['finance','Finance'],['team','Team'],['operations','Operations'],['loose','Revenue Intelligence']].forEach(function(x){var b=nav.querySelector('[data-view="'+x[0]+'"]');if(!b){b=document.createElement('button');b.type='button';b.className='nav-item';b.dataset.view=x[0];nav.appendChild(b);}if(b.dataset.opsLabel!==x[1]){b.innerHTML='<span aria-hidden="true">'+({overview:'⌂',jobs:'▤',inventory:'▦',purchasing:'↗',finance:'$',team:'♙',operations:'⚡',loose:'↻'}[x[0]])+'</span>'+x[1];b.dataset.opsLabel=x[1];}});}
    var menu=document.querySelector('.le-more-menu');if(menu){[['jobs','Jobs & Estimates'],['inventory','Inventory'],['purchasing','Purchasing'],['finance','Finance'],['team','Team'],['operations','Operations']].forEach(function(x){if(menu.querySelector('[data-view="'+x[0]+'"]'))return;var mb=document.createElement('button');mb.type='button';mb.className='le-more-item';mb.dataset.view=x[0];mb.setAttribute('role','menuitem');mb.textContent=x[1];menu.appendChild(mb);});}
    var callout=document.querySelector('.sidebar-callout strong');if(callout&&callout.textContent!=='Your Business. Running Smarter.')callout.textContent='Your Business. Running Smarter.';
    document.title='Loose Ends OS — Your Business. Running Smarter.';
  }
  function show(v) {current=v;var st=state();st.view=v;page=0;term='';document.body.classList.toggle('ops-active',views.includes(v));if(views.includes(v)){render(v,'Loading workspace operations…');load(v);}document.querySelectorAll('.nav-item').forEach(function(n){n.classList.toggle('active',n.dataset.view===v);});}
  function sync() {
    chrome();var st=state();
    if(workspace&&workspace!==st.workspaceId){seq++;workspace=null;cache={};var modalEl=document.getElementById('ops-modal');if(modalEl)modalEl.remove();if(views.includes(current))render(current,'Sign in to access your workspace.');}
    if(!views.includes(current))return;
    if(!document.getElementById('ops-page')){render(current,st.workspaceId?'Loading workspace operations…':'Sign in to access your workspace.');if(st.workspaceId&&!loading)load(current);}
    else if(st.workspaceId&&!workspace&&!loading)load(current);
  }
  function boot() {
    if(!window.LE||!S)return;
    var old=window.LE.setView;window.LE.setView=function(v){if(views.includes(v)){show(v);return;}current=v;document.body.classList.remove('ops-active');old(v);};window.setView=window.LE.setView;
    var style=document.createElement('style');style.textContent='.ops-active #launchReadiness,.ops-active .sales-ribbon,.ops-active .value-strip,.ops-active #leAuditBtn,.ops-active #le-launch-panel,.ops-active #le-engine-panel,.ops-active #le-os-layer,.ops-active #leLaunchControl,.ops-active .le-scan,.ops-active #le-verified-collections,.ops-active #le-live-control{display:none!important}.ops-page{max-width:1450px;margin:auto}.ops-page h1{font-size:clamp(23px,3vw,34px);letter-spacing:-.03em;margin:4px 0}.ops-page h2{font-size:17px;margin:0 0 12px}.ops-health{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}.ops-metric{background:linear-gradient(135deg,#102d37,#10202b);border:1px solid #27414d;border-radius:14px;padding:18px}.ops-metric span,.ops-row small,.ops-table small{display:block;color:#b2c2ce;font-size:12px;line-height:1.6}.ops-metric strong{display:block;font-size:26px;color:#f4f8fa;margin-top:7px}.ops-columns{display:grid;grid-template-columns:1.2fr 1fr;gap:16px}.ops-row{display:flex;gap:14px;justify-content:space-between;align-items:center;padding:14px 0;border-bottom:1px solid #23343f}.ops-row>div{min-width:0;overflow-wrap:anywhere}.ops-actions,.ops-departments{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.ops-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:end;margin:14px 0}.ops-form label{display:block;font-size:12px;color:#c1ced8}.ops-form input,.ops-form select,.ops-form textarea{display:block;box-sizing:border-box;width:100%;padding:12px;background:#0b1923;color:#f4f8fb;border:1px solid #38505e;border-radius:8px;margin-top:6px;min-height:44px}.ops-form button,.ops-actions button,.ops-departments button{min-height:44px}.ops-table-wrap{overflow:auto}.ops-table{width:100%;border-collapse:collapse;text-align:left;min-width:700px}.ops-table th,.ops-table td{padding:12px 8px;border-bottom:1px solid #29404d}.ops-table th{font-size:12px;color:#b2c2ce}.ops-warning{color:#ffb375;font-weight:700}.ops-empty{padding:20px;color:#bdcad5}.ops-modal-wrap{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:#020912cc;padding:16px}.ops-modal{background:#10212c;border:1px solid #415665;border-radius:18px;padding:24px;max-width:850px;width:100%;max-height:88vh;overflow:auto;color:#fff}#ops-error,#ops-modal-error{color:#ffb4a7;overflow-wrap:anywhere}body.ops-active #content{min-width:0}body.ops-active #content>.ops-page .section-card{margin-top:16px}.ops-page button:focus-visible,.ops-modal button:focus-visible{outline:3px solid #63d7b6;outline-offset:3px}@media(max-width:750px){.ops-health{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.ops-metric{padding:13px}.ops-metric strong{font-size:21px}.ops-columns{grid-template-columns:1fr}.ops-form{grid-template-columns:1fr}.ops-row{align-items:flex-start;flex-direction:column}.ops-modal{padding:16px}.ops-departments button{flex:1 0 42%}.ops-page .page-head{flex-wrap:wrap}.ops-page .section-card{padding:16px}}';document.head.appendChild(style);
    S.auth.onAuthStateChange(function(event){if(event==='SIGNED_OUT'||event==='SIGNED_IN'){seq++;cache={};workspace=null;loading=false;var m=document.getElementById('ops-modal');if(m)m.remove();if(views.includes(current))render(current,'Loading workspace operations…');}});
    show(state().view||'overview');
    var observer=new MutationObserver(function(){if(window.__opsSyncScheduled)return;window.__opsSyncScheduled=true;setTimeout(function(){window.__opsSyncScheduled=false;sync();},80);});observer.observe(document.getElementById('content'),{childList:true,subtree:false});
    setInterval(sync,2000);
  }
  window.LEOperations={parseCSV:parseCSV,command:command};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
