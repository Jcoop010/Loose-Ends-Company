/* Loose Ends Co. — evidence-based Revenue Leak Scanner.
   Derives actionable signals only from records already in the signed-in workspace.
   Estimates are not represented as recovered revenue. */
(function () {
  'use strict';
  var STYLE_ID = 'le-leak-scanner-style';
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function money(v) { return '$' + Number(v || 0).toLocaleString(undefined, {maximumFractionDigits: 0}); }
  function getState() { return window.LE && window.LE.getState ? window.LE.getState() : null; }
  function nameOf(c) { return c ? ([c.first_name, c.last_name].filter(Boolean).join(' ') || c.name || 'Customer') : 'Customer'; }
  function dayDiff(date) { var t = date ? new Date(date).getTime() : 0; return t ? Math.floor((Date.now() - t) / 86400000) : 0; }
  function style() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style'); s.id = STYLE_ID;
    s.textContent = '.le-scan{margin:0 0 16px;padding:20px;border:1px solid rgba(255,122,26,.25);border-radius:16px;background:linear-gradient(135deg,#111e2a,#0c1721);color:#f8fafc;box-shadow:0 12px 30px rgba(0,0,0,.12)}.le-scan-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}.le-scan-kicker{font-size:10px;font-weight:900;letter-spacing:.13em;color:#ff984d;text-transform:uppercase}.le-scan-title{font-size:21px;font-weight:850;margin:5px 0}.le-scan-sub{font-size:12px;line-height:1.5;color:#a8b6c4;max-width:650px}.le-scan-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:17px 0}.le-scan-stat{padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035)}.le-scan-stat span{display:block;color:#9fb0bf;text-transform:uppercase;letter-spacing:.08em;font-size:9px;font-weight:800}.le-scan-stat strong{display:block;margin-top:5px;font-size:20px}.le-scan-list{display:grid;gap:8px}.le-scan-row{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:11px;align-items:center;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.025)}.le-scan-icon{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:rgba(255,122,26,.13);color:#ff984d;font-weight:900}.le-scan-row strong{display:block;font-size:13px}.le-scan-row small{display:block;margin-top:3px;color:#9fb0bf;font-size:11px;line-height:1.45}.le-scan-value{text-align:right;white-space:nowrap;font-weight:850;font-size:14px}.le-scan-value button{display:block;margin-top:7px;border:0;border-radius:8px;background:#ff7a1a;color:#1c120a;font-size:11px;font-weight:900;padding:8px 10px;cursor:pointer}.le-scan-empty{padding:15px;border-radius:12px;background:rgba(255,255,255,.04);color:#bdc8d2;font-size:12px}.le-scan-foot{margin-top:12px;color:#7f91a1;font-size:10px;line-height:1.5}@media(max-width:650px){.le-scan{padding:15px}.le-scan-head{flex-direction:column}.le-scan-stats{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.le-scan-stat{padding:9px}.le-scan-stat strong{font-size:16px}.le-scan-row{grid-template-columns:30px minmax(0,1fr)}.le-scan-value{grid-column:2;display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left}.le-scan-value button{margin-top:0}.le-scan-value .le-scan-amount{font-size:13px}}';
    document.head.appendChild(s);
  }
  function confidence(kind) { return kind === 'OVERDUE INVOICE' ? 95 : kind === 'STALE QUOTE' ? 82 : kind === 'STALE OPPORTUNITY' ? 72 : kind === 'APPOINTMENT OUTCOME' ? 70 : 60; }
  function scan(st) {
    var now = Date.now(), customers = {}, signals = [], docs = st.documents || [], opps = st.opportunities || [], tasks = st.tasks || [], followUps = st.followUps || [], appointments = st.appointments || [];
    (st.customers || []).forEach(function (c) { customers[c.id] = c; });
    function customer(id) { return nameOf(customers[id]); }
    function add(s) {
      // Do not keep asking the owner to create a task that already exists.
      // This makes recovery actions idempotent across refreshes and repeat scans.
      if (s.task && s.task.title) {
        var targetTitle = String(s.task.title).trim().toLowerCase();
        var alreadyQueued = tasks.some(function (t) {
          var status = String(t.status || 'open').toLowerCase();
          var title = String(t.title || '').trim().toLowerCase();
          var sameCustomer = String(t.customer_id || '') === String(s.task.customer_id || '');
          var sameOpportunity = String(t.opportunity_id || '') === String(s.task.opportunity_id || '');
          return title === targetTitle && sameCustomer && sameOpportunity &&
            ['open','pending','in_progress','in progress','todo','to do'].indexOf(status) >= 0;
        });
        if (alreadyQueued) return;
      }
      signals.push(s);
    }
    docs.forEach(function (d) {
      var type = String(d.document_type || '').toLowerCase(), status = String(d.status || 'draft').toLowerCase();
      var due = d.due_at ? new Date(d.due_at).getTime() : 0, amount = Number(d.total || 0);
      if (type === 'invoice' && status !== 'paid' && status !== 'cancelled' && due && due < now) {
        add({key:'invoice:'+d.id,opportunityId:d.opportunity_id||null,confidence:confidence('OVERDUE INVOICE'),kind:'OVERDUE INVOICE',title:(d.document_number || 'Invoice') + ' is overdue',detail:customer(d.customer_id) + ' · ' + Math.max(1,Math.floor((now-due)/86400000)) + ' days past due. Confirm the balance, then send a payment reminder.',amount:amount,priority:100 + Math.min(30,Math.floor((now-due)/86400000)),action:'Create follow-up task',task:{title:'Follow up on overdue invoice ' + (d.document_number || ''),customer_id:d.customer_id || null,opportunity_id:d.opportunity_id || null}});
      }
      if (type === 'quote' && status === 'sent' && dayDiff(d.created_at) >= 5) {
        var hasActive = followUps.some(function (f) { return f.opportunity_id === d.opportunity_id && ['pending','scheduled','open'].indexOf(String(f.status||'').toLowerCase()) >= 0 && (!f.scheduled_at || new Date(f.scheduled_at).getTime() >= now); });
        if (!hasActive) add({key:'quote:'+d.id,opportunityId:d.opportunity_id||null,confidence:confidence('STALE QUOTE'),kind:'STALE QUOTE',title:(d.document_number || 'Sent quote') + ' may need a follow-up',detail:customer(d.customer_id) + ' · sent at least 5 days ago with no upcoming follow-up recorded.',amount:amount,priority:65 + Math.min(20,dayDiff(d.created_at)),action:'Create follow-up task',task:{title:'Follow up on quote ' + (d.document_number || ''),customer_id:d.customer_id || null,opportunity_id:d.opportunity_id || null}});
      }
    });
    opps.forEach(function (o) {
      if (String(o.status || 'open').toLowerCase() === 'recovered' || String(o.status || 'open').toLowerCase() === 'closed') return;
      var age = dayDiff(o.created_at);
      if (age < 7) return;
      var hasActive = followUps.some(function (f) { return f.opportunity_id === o.id && ['pending','scheduled','open'].indexOf(String(f.status||'').toLowerCase()) >= 0 && (!f.scheduled_at || new Date(f.scheduled_at).getTime() >= now); });
      if (!hasActive) add({key:'opp:'+o.id,opportunityId:o.id,confidence:confidence('STALE OPPORTUNITY'),kind:'STALE OPPORTUNITY',title:o.title || o.source || 'Open opportunity needs attention',detail:customer(o.customer_id) + ' · open for ' + age + ' days with no upcoming follow-up recorded.',amount:Number(o.amount||0),priority:55 + Math.min(25,age),action:'Create follow-up task',opportunityId:o.id,task:{title:'Follow up on ' + (o.title || o.source || 'open opportunity'),customer_id:o.customer_id || null,opportunity_id:o.id}});
    });
    tasks.forEach(function (t) {
      var due = t.due_at ? new Date(t.due_at).getTime() : 0;
      if (String(t.status || 'open').toLowerCase() === 'open' && due && due < now) add({key:'task:'+t.id,confidence:confidence('OVERDUE TASK'),kind:'OVERDUE TASK',title:t.title || 'Task past due',detail:'Due ' + new Date(t.due_at).toLocaleDateString() + '. Completing this may unblock a customer or revenue action.',amount:0,priority:45 + Math.min(20,Math.floor((now-due)/86400000)),action:'Review task',taskId:t.id});
    });
    appointments.forEach(function (a) {
      var starts = a.starts_at ? new Date(a.starts_at).getTime() : 0, status = String(a.status || 'scheduled').toLowerCase();
      if (starts && starts < now && ['scheduled','booked','confirmed'].indexOf(status) >= 0) add({key:'appointment:'+a.id,opportunityId:a.opportunity_id||null,confidence:confidence('APPOINTMENT OUTCOME'),kind:'APPOINTMENT OUTCOME',title:a.title || 'Past appointment needs an outcome',detail:customer(a.customer_id) + ' · scheduled for ' + new Date(a.starts_at).toLocaleString() + '. Confirm completed, canceled, or needs rebooking.',amount:0,priority:50,action:'Create follow-up task',task:{title:'Confirm outcome of appointment: ' + (a.title || 'customer appointment'),customer_id:a.customer_id || null,opportunity_id:a.opportunity_id || null}});
    });
    signals.sort(function(a,b){return b.priority-a.priority;});
    // Estimate exposure once per opportunity. Related documents use the largest observed amount.
    var exposureBySource = {};
    signals.forEach(function(s) {
      if (!(s.amount > 0)) return;
      var id = s.opportunityId ? 'opp:' + s.opportunityId : s.key;
      exposureBySource[id] = Math.max(exposureBySource[id] || 0, s.amount);
    });
    var exposure = Object.keys(exposureBySource).reduce(function(total, id) { return total + exposureBySource[id]; }, 0);
    return {signals:signals,exposure:exposure,overdueInvoices:signals.filter(function(s){return s.kind==='OVERDUE INVOICE';}).length,priority:signals.filter(function(s){return s.priority>=80;}).length};
  }
  function render() {
    var st=getState(), content=document.getElementById('content');
    if (!st || !content || !st.loaded || st.error || st.view !== 'overview') return;
    style();
    var page=content.querySelector('.page'); if(!page)return;
    var old=document.getElementById('le-revenue-leak-scanner');if(old)old.remove();
    var result=scan(st), top=result.signals.slice(0,3);
    var box=document.createElement('section');box.id='le-revenue-leak-scanner';box.className='le-scan';
    box.innerHTML='<div class="le-scan-head"><div><div class="le-scan-kicker">Evidence-based scan · live workspace</div><div class="le-scan-title">Revenue leaks to close</div><div class="le-scan-sub">Find overdue invoices, stale quotes, neglected opportunities, overdue tasks, and appointments that need an outcome. Every alert is tied to an existing record.</div></div><div class="le-scan-kicker">'+result.signals.length+' SIGNALS</div></div><div class="le-scan-stats"><div class="le-scan-stat"><span>Estimated exposure</span><strong>'+money(result.exposure)+'</strong></div><div class="le-scan-stat"><span>Overdue invoices</span><strong>'+result.overdueInvoices+'</strong></div><div class="le-scan-stat"><span>Urgent signals</span><strong>'+result.priority+'</strong></div></div><div class="le-scan-list">'+(top.length?top.map(function(s,i){return '<div class="le-scan-row"><div class="le-scan-icon">'+(s.kind==='OVERDUE INVOICE'?'$':s.kind==='STALE QUOTE'?'Q':s.kind==='OVERDUE TASK'?'!':s.kind==='APPOINTMENT OUTCOME'?'◷':'↗')+'</div><div><strong>'+esc(s.title)+'</strong><small>'+esc(s.kind)+' · '+esc(s.detail)+' Confidence: '+esc(String(s.confidence||confidence(s.kind)))+'%.'+'</small></div><div class="le-scan-value"><span class="le-scan-amount">'+(s.amount?money(s.amount):'Action needed')+'</span><button type="button" data-le-scan-action="'+esc(s.key)+'">'+esc(s.action)+'</button></div></div>';}).join(''):'<div class="le-scan-empty">No actionable leaks were detected in the records currently connected. Add real invoices, quotes, appointments, tasks, and opportunities to improve scan coverage.</div>')+'</div><div class="le-scan-foot">Estimated exposure is not guaranteed recovery and may overlap with related records. Amounts linked to the same opportunity are counted once using the largest observed amount. Confidence reflects signal strength, not the probability of collection. This scan only evaluates records available in this workspace; it does not scan external inboxes, call logs, or accounting systems. No messages are sent automatically.</div>';
    page.insertBefore(box,page.children.length>1?page.children[1]:null);
    box.querySelectorAll('[data-le-scan-action]').forEach(function(btn){btn.addEventListener('click',function(){act(btn.getAttribute('data-le-scan-action'));});});
  }
  var actionsInFlight = {};
  async function act(key) {
    if (actionsInFlight[key]) return;
    actionsInFlight[key] = true;
    var st=getState();if(!st)return;
    var result=scan(st), signal=result.signals.find(function(s){return s.key===key;});if(!signal){delete actionsInFlight[key];return;}
    if(!signal.task && signal.opportunityId && window.LE && window.LE.openOpp){delete actionsInFlight[key];window.LE.openOpp(signal.opportunityId);return;}
    if(signal.taskId){delete actionsInFlight[key];if(window.LE&&window.LE.setView)window.LE.setView('tasks');return;}
    if(!signal.task || !window.LESupabase || !st.workspaceId){delete actionsInFlight[key];var toast=document.getElementById('toast');if(toast){toast.textContent='Sign in to create a follow-up task';toast.className='toast show';}return;}
    var task={workspace_id:st.workspaceId,title:signal.task.title,status:'open',priority:signal.priority>=80?3:2,due_at:new Date(Date.now()+86400000).toISOString(),customer_id:signal.task.customer_id||null,opportunity_id:signal.task.opportunity_id||null};
    var res=await window.LESupabase.from('tasks').insert(task);
    if(res.error){delete actionsInFlight[key];var e=document.getElementById('toast');if(e){e.textContent='Task could not be created: '+res.error.message;e.className='toast show';}return;}
    var t=document.getElementById('toast');if(t){t.textContent='Follow-up task created';t.className='toast show';}
    if(window.LE&&window.LE.refresh)await window.LE.refresh();
    if(window.LE&&window.LE.setView)window.LE.setView('tasks');
    delete actionsInFlight[key];
  }
  function boot(){
    var content=document.getElementById('content');if(!content)return;
    var queued=false;
    function schedule(){if(queued)return;queued=true;setTimeout(function(){queued=false;render();},80);}
    new MutationObserver(schedule).observe(content,{childList:true,subtree:false});
    schedule();
    if(window.LE&&window.LE.refresh&&!window.LE.refresh.__leScanWrapped){
      var original=window.LE.refresh;
      var wrapped=async function(){var r=await original.apply(this,arguments);schedule();return r;};
      wrapped.__leScanWrapped=true;window.LE.refresh=wrapped;
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();