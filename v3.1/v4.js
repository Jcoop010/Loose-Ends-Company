/* Loose Ends V4 — resilient production shell */
(function () {
  'use strict';

  var KEY = 'loose_ends_v31_state';
  var SB = window.LESupabase || null;
  var state = {
    view: 'overview', query: '', customers: [], opps: [], loose: [],
    appointments: [], tasks: [], documents: [], recovered: 0,
    loaded: false, workspaceId: null
  };
  var seeded = [
    { id:'seed-1', type:'Declined Work', customer:'Angela Brooks', vehicle:'2017 RAM 1500', amount:1680, priority:'High', reason:'Recommended repair was declined at the last visit.' },
    { id:'seed-2', type:'Declined Work', customer:'Sarah Miller', vehicle:'2021 Chevrolet Silverado', amount:1240, priority:'High', reason:'Brake and rotor recommendation was declined.' },
    { id:'seed-3', type:'Missed Call', customer:'Robert Wilson', vehicle:'2020 Ford Explorer', amount:1100, priority:'High', reason:'Caller could not be reached after an unanswered call.' },
    { id:'seed-4', type:'Dormant Customer', customer:'Lisa Reynolds', vehicle:'2016 Honda CR-V', amount:920, priority:'Medium', reason:'High-value customer has not returned.' },
    { id:'seed-5', type:'Overdue Service', customer:'James Carter', vehicle:'2018 Jeep Wrangler', amount:680, priority:'Medium', reason:'Customer is beyond the recommended service window.' }
  ];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function money(v) { return '$' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
  function total() { return state.opps.reduce(function (n, o) { return n + Number(o.amount || 0); }, 0); }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ opps: state.opps, recovered: state.recovered })); } catch (e) {}
  }
  function seed() { state.opps = seeded.map(function (x) { return Object.assign({}, x); }); }

  function shell() {
    document.body.innerHTML = '' +
      '<div id="v4" class="v4-root"><div class="v4-shell">' +
      '<aside class="v4-side"><div class="v4-brand"><div class="v4-mark">↗</div><div><strong>LOOSE ENDS</strong><small>Revenue Recovery OS</small></div></div>' +
      '<nav class="v4-nav" id="v4nav"></nav>' +
      '<div class="v4-side-bottom"><small>RECOVERABLE NOW</small><div class="money" id="sideMoney">$0</div><small>Live workspace revenue</small></div></aside>' +
      '<main class="v4-main"><header class="v4-top"><div class="v4-search">⌕<input id="v4search" placeholder="Search customers, deals, documents, loose ends…"></div><div class="v4-top-right"><button class="v4-icon" id="settingsBtn" type="button">⚙</button><div class="v4-avatar">LE</div></div></header><section id="v4content"></section></main>' +
      '</div><div id="v4modal" class="v4-modal hidden"></div><div id="v4toast" class="v4-toast" style="display:none"></div></div>';
    var input = document.getElementById('v4search');
    if (input) input.addEventListener('input', function () { state.query = this.value || ''; render(); });
    var settings = document.getElementById('settingsBtn');
    if (settings) settings.addEventListener('click', function () { view('settings'); });
  }

  function nav() {
    var items = [
      ['overview','⌂','Command Center'], ['customers','♙','Customers'], ['sales','↗','Sales'],
      ['calendar','◷','Calendar'], ['documents','▤','Documents'], ['revenue','◈','Revenue'],
      ['loose','⌁','Loose Ends'], ['tasks','✓','Tasks'], ['intelligence','✦','Intelligence'], ['settings','⚙','Settings']
    ];
    var el = document.getElementById('v4nav');
    if (!el) return;
    el.innerHTML = items.map(function (i) {
      return '<button type="button" class="' + (state.view === i[0] ? 'active' : '') + '" data-view="' + i[0] + '"><span class="ico">' + i[1] + '</span><span>' + i[2] + '</span>' +
        (i[0] === 'loose' ? '<span class="badge">' + state.opps.length + '</span>' : '') + '</button>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('[data-view]'), function (b) {
      b.addEventListener('click', function () { view(this.getAttribute('data-view')); });
    });
  }

  function head(a, b, c) {
    return '<div class="v4-head"><div><div class="v4-eyebrow">' + a + '</div><div class="v4-title">' + b + '</div><div class="v4-sub">' + c + '</div></div>' +
      '<div class="v4-date">September 7, 2026 · ' + (state.loaded ? 'LIVE' : 'CONNECTING') + '</div></div>';
  }
  function kpi(icon, label, value, note, trend, warn) {
    return '<div class="v4-card v4-kpi"><div class="v4-kpi-top"><div class="v4-kpi-icon">' + icon + '</div>' + label + '</div><div class="v4-kpi-value">' + value + '</div><div class="v4-kpi-note">' + note + '</div><div class="v4-kpi-trend ' + (warn ? 'warn' : '') + '">' + trend + '</div></div>';
  }
  function filtered(arr) {
    var q = String(state.query || '').toLowerCase();
    if (!q) return arr;
    return arr.filter(function (x) { return JSON.stringify(x).toLowerCase().indexOf(q) >= 0; });
  }
  function oppRows(arr) {
    var rows = arr.slice(0, 8).map(function (o) {
      var id = esc(o.id);
      return '<div class="v4-op"><span class="v4-chip ' + (o.priority === 'High' || o.priority === 'Critical' ? 'red' : '') + '">' + esc(o.type || 'Loose End') + '</span>' +
        '<div><span class="v4-customer">' + esc(o.customer || 'Customer') + '</span><span class="v4-meta">' + esc(o.vehicle || 'Revenue opportunity') + '</span></div>' +
        '<span class="v4-meta">' + esc(o.reason || 'Needs a next action.') + '</span><strong class="v4-amount">' + money(o.amount) + '</strong>' +
        '<span class="v4-priority ' + (o.priority === 'High' || o.priority === 'Critical' ? 'high' : '') + '">' + esc(o.priority || 'Medium') + '</span>' +
        '<button class="v4-btn" type="button" data-open="' + id + '">Take action</button></div>';
    }).join('');
    return rows || '<div class="v4-empty">No matching revenue opportunities.</div>';
  }
  function bindOpen() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-open]'), function (b) {
      b.addEventListener('click', function () { openItem(this.getAttribute('data-open')); });
    });
  }
  function overview() {
    var rec = total();
    return '<div class="v4-page">' + head('REVENUE RECOVERY OS','Run the business. Recover the money.','One command center for customers, sales, appointments, documents, cash, and every unfinished revenue opportunity.') +
      '<div class="v4-kpis">' +
      kpi('◉','Recoverable now',money(rec),'Open opportunity value','↑ Live') +
      kpi('✓','Revenue recovered',money(state.recovered),'Attributed recovery revenue','↑ Tracking') +
      kpi('!','Revenue at risk',money(Math.round(rec * 1.55)),'Estimated workflow leakage','Needs attention',true) +
      kpi('◎','Open opportunities',state.opps.length,'Loose Ends requiring action','Live queue') +
      kpi('◷','Today',state.appointments.length + ' appointments',state.tasks.length + ' open tasks','Live operations') +
      '</div><div class="v4-grid-main"><div class="v4-card v4-section"><div class="v4-section-head"><div><div class="v4-section-title">Priority revenue queue</div><div class="v4-section-sub">The highest-value things you can do right now.</div></div><button class="v4-link" type="button" data-nav="loose">View all →</button></div>' +
      oppRows(state.opps.slice().sort(function (a,b) { return Number(b.amount || 0) - Number(a.amount || 0); })) +
      '</div><div class="v4-card v4-section"><div class="v4-section-title" style="padding:15px 16px 6px">Next best actions</div><div class="v4-actions">' +
      '<div class="v4-action" data-nav="loose"><div class="v4-action-icon">$</div><div><strong>Recover highest-value loose end</strong><small>Start with the most valuable opportunity.</small></div><b>' + money(state.opps[0] ? state.opps[0].amount : 0) + '</b></div>' +
      '<div class="v4-action" data-nav="sales"><div class="v4-action-icon">↗</div><div><strong>Review open sales</strong><small>Move quotes and deals forward.</small></div><b>' + state.opps.length + '</b></div>' +
      '<div class="v4-action" data-nav="customers"><div class="v4-action-icon">♙</div><div><strong>Work Customer 360</strong><small>Customers, activity, revenue and risk.</small></div><b>' + state.customers.length + '</b></div>' +
      '</div></div></div></div>';
  }
  function customersView() {
    var list = filtered(state.customers);
    return '<div class="v4-page">' + head('CRM','Customer 360','Every customer, interaction, and revenue opportunity in one record.') +
      '<div class="v4-card v4-section"><div class="v4-section-head"><div><div class="v4-section-title">Customers</div><div class="v4-section-sub">Live records from this workspace.</div></div><button class="v4-btn" type="button" data-toast="New customer workflow is next.">+ New customer</button></div>' +
      '<div class="v4-table-wrap"><table class="v4-table"><thead><tr><th>Customer</th><th>Phone</th><th>Email</th><th>Created</th></tr></thead><tbody>' +
      list.map(function (c) { return '<tr><td><strong>' + esc((c.first_name || '') + ' ' + (c.last_name || '')) + '</strong><span class="v4-meta">' + esc(c.external_id || 'Customer') + '</span></td><td>' + esc(c.phone || '—') + '</td><td>' + esc(c.email || '—') + '</td><td>' + esc(c.created_at ? new Date(c.created_at).toLocaleDateString() : '—') + '</td></tr>'; }).join('') +
      '</tbody></table></div></div></div>';
  }
  function sales() {
    return '<div class="v4-page">' + head('COMMERCE','Sales Pipeline','Every open opportunity stays connected to the customer and recovery engine.') + '<div class="v4-card v4-panel-pad"><div class="v4-kanban">' +
      ['open','contacted','scheduled','recovered'].map(function (s) { var l = state.opps.filter(function (o) { return String(o.status || 'open').toLowerCase() === s; }); return '<div class="v4-col"><h4>' + s.toUpperCase() + '</h4>' + l.slice(0,5).map(function (d) { return '<div class="v4-deal"><strong>' + esc(d.title || d.type || 'Revenue opportunity') + '</strong><small>' + esc(d.customer || 'Customer') + '</small><b>' + money(d.amount) + '</b></div>'; }).join('') + '</div>'; }).join('') +
      '</div></div></div>';
  }
  function listPage(type, title, desc, data, label) {
    return '<div class="v4-page">' + head(type,title,desc) + '<div class="v4-card v4-section"><div class="v4-section-title" style="padding:15px 16px 6px">' + label + '</div><div class="v4-docs" style="padding:9px">' +
      (data.length ? data.map(function (x) { return '<div class="v4-doc"><div class="v4-doc-icon">' + (type === 'OPERATIONS' ? '◷' : type === 'EXECUTION' ? '✓' : '▤') + '</div><div><strong>' + esc(x.title || x.document_number || x.document_type || 'Record') + '</strong><small>' + esc(x.starts_at ? new Date(x.starts_at).toLocaleString() : x.due_at ? new Date(x.due_at).toLocaleString() : x.status || 'Live record') + '</small></div></div>'; }).join('') : '<div class="v4-empty">No records yet. The live V4 ledger is ready.</div>') +
      '</div></div></div>';
  }
  function render() {
    var content = document.getElementById('v4content');
    if (!content) return;
    nav();
    var side = document.getElementById('sideMoney'); if (side) side.textContent = money(total());
    var h;
    if (state.view === 'overview') h = overview();
    else if (state.view === 'customers') h = customersView();
    else if (state.view === 'sales') h = sales();
    else if (state.view === 'calendar') h = listPage('OPERATIONS','Calendar','Appointments are connected to customers, opportunities, tasks, and revenue.',state.appointments,'Upcoming appointments');
    else if (state.view === 'documents') h = listPage('COMMERCE','Documents','Quotes, orders, purchase orders, invoices, and payments share one customer thread.',state.documents,'Document flow');
    else if (state.view === 'tasks') h = listPage('EXECUTION','Tasks & Follow-ups','Nothing important gets forgotten.',state.tasks,'Open tasks');
    else if (state.view === 'revenue') h = '<div class="v4-page">' + head('MONEY','Revenue OS','Measure identified → actioned → recovered.') + '<div class="v4-bottom-grid">' + kpi('$','Recoverable',money(total()),'Open opportunity value','Live') + kpi('✓','Recovered',money(state.recovered),'Attributed recovery revenue','Live') + kpi('◈','Recovery rate',((total() + state.recovered) ? Math.round(state.recovered / (total() + state.recovered) * 100) : 0) + '%','Recovered / identified','Tracking') + '</div></div>';
    else if (state.view === 'loose') h = '<div class="v4-page">' + head('RECOVERY ENGINE','Loose Ends','Every unfinished revenue event becomes a prioritized next action.') + '<div class="v4-card v4-section">' + oppRows(filtered(state.opps)) + '</div></div>';
    else if (state.view === 'intelligence') h = '<div class="v4-page">' + head('INTELLIGENCE','Revenue Intelligence','Prioritize what is most likely to turn into dollars.') + '<div class="v4-card v4-panel-pad"><div class="v4-section-title">AI revenue operator</div><p class="v4-muted">The recovery engine is ready for approved, customer-specific next actions.</p></div></div>';
    else h = '<div class="v4-page">' + head('CONTROL PLANE','Settings','Workspace configuration, integrations, automation rules, and permissions.') + '<div class="v4-card v4-panel-pad"><div class="v4-section-title">Production foundation</div><p class="v4-muted">Supabase Auth, workspace membership, RLS, live recovery data, and V4 revenue tables are connected.</p><div class="v4-chip">SECURE WORKSPACE</div></div></div>';
    content.innerHTML = h;
    bindOpen();
    Array.prototype.forEach.call(content.querySelectorAll('[data-nav]'), function (b) { b.addEventListener('click', function () { view(this.getAttribute('data-nav')); }); });
    Array.prototype.forEach.call(content.querySelectorAll('[data-toast]'), function (b) { b.addEventListener('click', function () { toast(this.getAttribute('data-toast')); }); });
  }

  function view(v) { state.view = v; render(); }
  function openItem(id) {
    var o = state.opps.find(function (x) { return String(x.id) === String(id); });
    if (!o) return;
    var modal = document.getElementById('v4modal'); if (!modal) return;
    modal.className = 'v4-modal';
    modal.innerHTML = '<div class="v4-modal-card"><div class="v4-modal-head"><div><div class="v4-eyebrow">NEXT BEST ACTION</div><h2>' + esc(o.type || o.title || 'Loose End') + '</h2></div><button class="v4-close" type="button" id="v4close">×</button></div><p>' + esc(o.reason || 'Revenue opportunity requiring attention.') + '</p><div class="v4-big">' + money(o.amount) + '</div><div class="v4-modal-actions"><button class="v4-btn" type="button" id="v4recover">Mark recovered</button><button class="v4-btn" type="button" id="v4follow">Create follow-up</button></div></div>';
    document.getElementById('v4close').onclick = close;
    document.getElementById('v4recover').onclick = function () { recover(id); };
    document.getElementById('v4follow').onclick = function () { toast('Follow-up queued.'); close(); };
  }
  function close() { var m = document.getElementById('v4modal'); if (m) m.className = 'v4-modal hidden'; }
  function toast(msg) { var t = document.getElementById('v4toast'); if (!t) return; t.textContent = msg; t.style.display = 'block'; clearTimeout(window.__v4toast); window.__v4toast = setTimeout(function () { t.style.display = 'none'; }, 2400); }
  function recover(id) {
    var o = state.opps.find(function (x) { return String(x.id) === String(id); }); if (!o) return;
    state.recovered += Number(o.amount || 0);
    if (SB && state.workspaceId && o.db) SB.from('loose_ends').update({status:'recovered',updated_at:new Date().toISOString()}).eq('id',o.id);
    else if (SB && state.workspaceId && !String(o.id).indexOf('seed-')) SB.from('opportunities').update({status:'recovered',recovered_amount:Number(o.amount || 0),recovered_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',o.id);
    state.opps = state.opps.filter(function (x) { return String(x.id) !== String(id); }); save(); close(); render(); toast('Recovery recorded: ' + money(o.amount));
  }

  async function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved) state.recovered = Number(saved.recovered || 0);
    } catch (e) {}
    if (!SB) { seed(); state.loaded = true; render(); return; }
    try {
      var userResult = await SB.auth.getUser();
      var user = userResult && userResult.data ? userResult.data.user : null;
      if (!user) { seed(); state.loaded = true; render(); return; }
      var wm = await SB.from('workspace_members').select('workspace_id').eq('user_id', user.id).limit(1).maybeSingle();
      var wid = wm && wm.data ? wm.data.workspace_id : null;
      if (!wid) { seed(); state.loaded = true; render(); return; }
      state.workspaceId = wid;
      var results = await Promise.all([
        SB.from('customers').select('*').eq('workspace_id',wid).order('updated_at',{ascending:false}).limit(100),
        SB.from('opportunities').select('*,customers(first_name,last_name)').eq('workspace_id',wid).order('priority',{ascending:false}).limit(100),
        SB.from('loose_ends').select('*,customers(first_name,last_name)').eq('workspace_id',wid).eq('status','open').order('score',{ascending:false}).limit(100),
        SB.from('appointments').select('*').eq('workspace_id',wid).order('starts_at',{ascending:true}).limit(50),
        SB.from('tasks').select('*').eq('workspace_id',wid).eq('status','open').order('due_at',{ascending:true}).limit(50),
        SB.from('documents').select('*').eq('workspace_id',wid).order('created_at',{ascending:false}).limit(50)
      ]);
      state.customers = (results[0] && results[0].data) || [];
      state.opps = (results[1] && results[1].data) || [];
      state.loose = (results[2] && results[2].data) || [];
      state.appointments = (results[3] && results[3].data) || [];
      state.tasks = (results[4] && results[4].data) || [];
      state.documents = (results[5] && results[5].data) || [];
      if (state.loose.length) state.opps = state.loose.map(function (o) { var c=o.customers||{}; return {id:o.id,type:o.source_entity,customer:[c.first_name,c.last_name].filter(Boolean).join(' ')||'Customer',amount:o.amount,priority:String(o.priority||'medium').replace(/^./,function(x){return x.toUpperCase();}),reason:o.reason,db:true}; });
      if (!state.opps.length) seed();
    } catch (e) { console.warn('V4 live load failed', e); seed(); }
    state.loaded = true; render();
  }

  window.V4 = { view:view, open:openItem, recover:recover, close:close, toast:toast };
  shell();
  render();
  load();
})();
