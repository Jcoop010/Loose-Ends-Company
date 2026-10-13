/* Loose Ends Co. — Recovery Engine upgrade.
 * Evidence-first ledger and playbook filters layered onto the existing V3-style UI.
 * Reads workspace-scoped records from the existing Autonomy Center; does not invent data,
 * mutate financial records, or send customer communications.
 */
(function () {
  'use strict';
  var state = { filter: 'all', query: '', playbook: 'all', lastKey: '' };
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    return '$' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  function status(o) { return String(o.status || 'open').toLowerCase(); }
  function active(o) { return ['recovered', 'dismissed', 'closed', 'won', 'lost', 'converted'].indexOf(status(o)) < 0; }
  function recovered(o) { return status(o) === 'recovered' ? Math.max(0, Number(o.recovered_amount || 0)) : 0; }
  function textOf(o) { return String([o.title, o.source, o.reason, o.status].join(' ')).toLowerCase(); }
  function bucket(o) {
    var t = textOf(o);
    if (/invoice|overdue|past due|receivable|payment/.test(t)) return 'invoice';
    if (/estimate|quote|proposal|declin|unsold/.test(t)) return 'quote';
    if (/missed|call back|callback|inquir|new lead/.test(t)) return 'lead';
    if (/maintenance|service due|rebook|repeat|dormant|inactive|return visit/.test(t)) return 'retention';
    return 'review';
  }
  function labelFor(b) {
    return ({ invoice: 'Overdue invoice', quote: 'Open estimate', lead: 'Unworked inquiry', retention: 'Retention opportunity', review: 'Review opportunity' })[b] || 'Review opportunity';
  }
  function actionFor(o) {
    var b = bucket(o);
    return ({ invoice: 'Verify balance and prepare a respectful payment follow-up', quote: 'Review estimate and follow up with the customer', lead: 'Check inquiry history and respond promptly', retention: 'Check service history and offer a relevant return visit', review: 'Verify the record and choose the next step' })[b];
  }
  function score(o) {
    var amount = Math.max(0, Number(o.amount || 0));
    var created = new Date(o.created_at || Date.now()).getTime();
    var age = Math.max(0, (Date.now() - (isNaN(created) ? Date.now() : created)) / 86400000);
    var b = bucket(o), n = Math.min(28, amount / 175);
    n += age <= 2 ? 22 : age <= 7 ? 17 : age <= 21 ? 11 : age <= 60 ? 6 : 2;
    n += ({ lead: 22, quote: 18, retention: 12, invoice: 16, review: 0 })[b] || 0;
    if (status(o) === 'scheduled') n += 8;
    if (status(o) === 'contacted') n -= 4;
    return Math.max(1, Math.min(100, Math.round(n)));
  }
  function getData() {
    var c = window.LEAutonomyCenter;
    var s = c && typeof c.getState === 'function' ? c.getState() : null;
    return s || { opportunities: [], tasks: [], scannedAt: null };
  }
  function probability(o) {
    var p = 0.22, t = textOf(o);
    var created = new Date(o.created_at || Date.now()).getTime();
    var age = Math.max(0, (Date.now() - (isNaN(created) ? Date.now() : created)) / 86400000);
    if (/missed|call|lead|inquir/.test(t)) p += 0.18;
    if (/estimate|quote|proposal|declin|unsold/.test(t)) p += 0.14;
    if (age <= 2) p += 0.14;
    else if (age <= 7) p += 0.10;
    else if (age > 60) p -= 0.10;
    if (status(o) === 'scheduled') p += 0.12;
    if (status(o) === 'contacted') p += 0.03;
    return Math.max(0.05, Math.min(0.78, p));
  }
  function styles() {
    if (document.getElementById('le-recovery-engine-style')) return;
    var el = document.createElement('style');
    el.id = 'le-recovery-engine-style';
    el.textContent =
      '.le-recovery-engine{margin:16px 0;padding:18px;border:1px solid var(--line,#21364d);border-radius:16px;background:linear-gradient(145deg,rgba(16,34,56,.96),rgba(9,23,38,.96));color:var(--text,#f4f8fb)}' +
      '.le-recovery-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}.le-recovery-kicker{font-size:10px;letter-spacing:.14em;font-weight:900;color:var(--accent,#ff7a1a)}.le-recovery-engine h2{margin:5px 0 6px;font-size:21px}.le-recovery-muted{font-size:12px;color:var(--muted,#8fa4ba);line-height:1.5}.le-recovery-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:14px 0}.le-recovery-stat{padding:12px;border-radius:11px;background:rgba(255,255,255,.035);border:1px solid var(--line,#21364d)}.le-recovery-stat span{display:block;font-size:10px;color:var(--muted,#8fa4ba)}.le-recovery-stat strong{display:block;font-size:21px;margin-top:5px}.le-recovery-controls{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.le-recovery-controls input,.le-recovery-controls select{min-width:140px;flex:1;padding:10px 11px;border-radius:9px;border:1px solid var(--line,#21364d);background:#071321;color:var(--text,#f4f8fb)}.le-recovery-btn{border:1px solid var(--line,#21364d);border-radius:9px;background:rgba(255,255,255,.06);color:var(--text,#f4f8fb);padding:9px 11px;font-weight:800;cursor:pointer}.le-recovery-btn.primary{background:var(--accent,#ff7a1a);border-color:var(--accent,#ff7a1a);color:#101722}.le-recovery-playbooks{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0}.le-recovery-playbook{border:1px solid var(--line,#21364d);background:rgba(255,255,255,.025);border-radius:11px;padding:11px;text-align:left;color:inherit;cursor:pointer;min-width:0}.le-recovery-playbook strong{display:block;font-size:12px;margin-bottom:4px}.le-recovery-playbook span{font-size:10px;line-height:1.4;color:var(--muted,#8fa4ba)}.le-recovery-table-wrap{overflow:auto;border:1px solid var(--line,#21364d);border-radius:11px}.le-recovery-table{width:100%;border-collapse:collapse;min-width:680px;font-size:12px}.le-recovery-table th,.le-recovery-table td{padding:11px;text-align:left;border-bottom:1px solid var(--line,#21364d);vertical-align:top}.le-recovery-table th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#8fa4ba);font-weight:800}.le-recovery-table tr:last-child td{border-bottom:0}.le-recovery-pill{display:inline-block;border-radius:20px;padding:4px 7px;font-size:10px;font-weight:800;background:rgba(255,122,26,.13);color:#ffb274}.le-recovery-pill.verified{background:rgba(70,225,162,.12);color:#76edbb}.le-recovery-empty{padding:18px;text-align:center;color:var(--muted,#8fa4ba);font-size:12px}.le-recovery-foot{margin-top:10px;font-size:10px;color:var(--muted,#8fa4ba);line-height:1.5}@media(max-width:760px){.le-recovery-stats{grid-template-columns:1fr 1fr}.le-recovery-playbooks{grid-template-columns:1fr 1fr}.le-recovery-engine{padding:13px}.le-recovery-engine h2{font-size:19px}}';
    document.head.appendChild(el);
  }
  function filtered(items) {
    return items.filter(function (o) {
      if (state.filter === 'active' && !active(o)) return false;
      if (state.filter === 'recovered' && !recovered(o)) return false;
      if (state.filter === 'needs-task') {
        var s = getData(), hasOpen = (s.tasks || []).some(function (t) {
          return String(t.opportunity_id || '') === String(o.id) && ['completed', 'done', 'cancelled', 'canceled'].indexOf(String(t.status || '').toLowerCase()) < 0;
        });
        if (!active(o) || hasOpen) return false;
      }
      if (state.playbook !== 'all' && bucket(o) !== state.playbook) return false;
      var q = state.query.trim().toLowerCase();
      return !q || textOf(o).indexOf(q) >= 0 || String(o.amount || '').indexOf(q) >= 0;
    });
  }
  function csvCell(v) {
    var value = String(v == null ? '' : v);
    // Prevent spreadsheet formula injection when users open exported data in Excel/Sheets.
    if (typeof v === 'string' && /^[\s]*[=+\-@]/.test(value)) value = "'" + value;
    return '"' + value.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    var s = getData(), rows = filtered(s.opportunities || []);
    var data = [['Opportunity ID', 'Title', 'Source', 'Status', 'Category', 'Amount at risk (estimate)', 'Verified recovered amount', 'Created at', 'Recommended next action', 'Evidence status']];
    rows.forEach(function (o) {
      data.push([o.id, o.title, o.source, status(o), labelFor(bucket(o)), Number(o.amount || 0), recovered(o), o.created_at, actionFor(o), recovered(o) > 0 ? 'Recovered status and recovered_amount recorded; confirm payment evidence in source system' : 'Opportunity estimate; not verified recovered revenue']);
    });
    var csv = '\ufeff' + data.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'loose-ends-recovery-ledger.csv'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function render() {
    var view = window.LE && typeof window.LE.getState === 'function' ? window.LE.getState().view : 'overview';
    var page = document.querySelector('#content .page');
    var existing = document.getElementById('le-recovery-engine');
    if (!page || (view !== 'overview' && view !== 'intelligence')) { if (existing) existing.remove(); return; }
    var auto = document.getElementById('le-autonomy-center');
    if (!auto) { if (existing) existing.remove(); return; }
    styles();
    var s = getData(), items = s.opportunities || [];
    var activeItems = items.filter(active), verified = items.reduce(function (sum, o) { return sum + recovered(o); }, 0);
    var risk = activeItems.reduce(function (sum, o) { return sum + Math.max(0, Number(o.amount || 0)); }, 0);
    var modeled = activeItems.reduce(function (sum, o) { return sum + Math.max(0, Number(o.amount || 0)) * probability(o); }, 0);
    var list = filtered(items).sort(function (a, b) { return (recovered(b) > 0 ? 1 : 0) - (recovered(a) > 0 ? 1 : 0) || score(b) - score(a); }).slice(0, 30);
    var html = '<div class="le-recovery-head"><div><div class="le-recovery-kicker">EVIDENCE-FIRST REVENUE INTELLIGENCE</div><h2>Recovery Ledger & Playbooks</h2><div class="le-recovery-muted">One place to prioritize opportunities, review the evidence, and export a working recovery ledger. Estimates are kept separate from recorded recovered amounts.</div></div><button type="button" class="le-recovery-btn primary" data-recovery-action="export">Export ledger CSV</button></div>' +
      '<div class="le-recovery-stats"><div class="le-recovery-stat"><span>Open opportunity amount · estimate</span><strong>' + money(risk) + '</strong></div><div class="le-recovery-stat"><span>Modeled opportunity value · estimate</span><strong>' + money(modeled) + '</strong></div><div class="le-recovery-stat"><span>Recorded recovered amount</span><strong>' + money(verified) + '</strong></div></div>' +
      '<div class="le-recovery-muted">Playbooks filter your existing workspace opportunities; they do not send messages or change customer records.</div><div class="le-recovery-playbooks">' +
      [['lead','Missed inquiries','Review new leads and callback opportunities.'],['quote','Open estimates','Prioritize estimates awaiting a decision.'],['invoice','Overdue invoices','Verify balances before follow-up.'],['retention','Repeat business','Find customers due for a relevant return visit.']].map(function (p) { return '<button type="button" class="le-recovery-playbook" data-recovery-playbook="' + p[0] + '"><strong>' + p[1] + '</strong><span>' + p[2] + '</span></button>'; }).join('') +
      '</div><div class="le-recovery-controls"><input type="search" id="le-recovery-search" aria-label="Search recovery ledger" placeholder="Search opportunities…" value="' + esc(state.query) + '"><select id="le-recovery-filter" aria-label="Filter opportunity status"><option value="all"' + (state.filter === 'all' ? ' selected' : '') + '>All statuses</option><option value="active"' + (state.filter === 'active' ? ' selected' : '') + '>Open opportunities</option><option value="needs-task"' + (state.filter === 'needs-task' ? ' selected' : '') + '>Needs a task</option><option value="recovered"' + (state.filter === 'recovered' ? ' selected' : '') + '>Recorded recovered</option></select><button type="button" class="le-recovery-btn" data-recovery-action="clear">Clear filters</button></div>' +
      '<div class="le-recovery-table-wrap"><table class="le-recovery-table"><thead><tr><th>Opportunity</th><th>Recovery playbook</th><th>At-risk amount</th><th>Outcome status</th><th>Recommended action</th><th></th></tr></thead><tbody>' +
      (list.length ? list.map(function (o) {
        var rec = recovered(o), c = o.customers || {}, customer = [c.first_name, c.last_name].filter(Boolean).join(' ');
        return '<tr><td><strong>' + esc(o.title || o.source || 'Untitled opportunity') + '</strong><div class="le-recovery-muted">' + esc(customer || 'Customer not linked') + '</div><div class="le-recovery-muted">Priority score ' + score(o) + '/100</div></td><td>' + esc(labelFor(bucket(o))) + '</td><td>' + money(o.amount) + '</td><td><span class="le-recovery-pill' + (rec > 0 ? ' verified' : '') + '">' + (rec > 0 ? 'Recorded recovered' : esc(status(o))) + '</span><div class="le-recovery-muted">' + (rec > 0 ? money(rec) + ' recorded recovered' : 'Estimate only · not verified recovered') + '</div></td><td>' + esc(actionFor(o)) + '</td><td>' + (active(o) ? '<button type="button" class="le-recovery-btn" data-recovery-action="task" data-opp="' + esc(o.id) + '">Queue task</button>' : '—') + '</td></tr>';
      }).join('') : '<tr><td colspan="6"><div class="le-recovery-empty">No matching opportunity records. Clear filters or add/import real workspace records to begin.</div></td></tr>') +
      '</tbody></table></div><div class="le-recovery-foot">Showing up to 30 records. Priority scores are rules-based triage, not a prediction of guaranteed recovery. “Recorded recovered” reflects the existing opportunity status and recovered_amount fields; reconcile against the source payment or accounting system before reporting as confirmed cash.</div>';
    var box = existing || document.createElement('section');
    box.id = 'le-recovery-engine'; box.className = 'le-recovery-engine'; box.innerHTML = html;
    auto.insertAdjacentElement('afterend', box);
  }
  document.addEventListener('click', function (e) {
    var play = e.target.closest && e.target.closest('[data-recovery-playbook]');
    if (play) { state.playbook = play.getAttribute('data-recovery-playbook') || 'all'; render(); return; }
    var button = e.target.closest && e.target.closest('[data-recovery-action]');
    if (!button) return;
    var action = button.getAttribute('data-recovery-action');
    if (action === 'export') { exportCsv(); return; }
    if (action === 'clear') { state.filter = 'all'; state.query = ''; state.playbook = 'all'; render(); return; }
    if (action === 'task') {
      var center = window.LEAutonomyCenter, id = button.getAttribute('data-opp');
      if (center && typeof center.queueTask === 'function') center.queueTask(id);
      else window.alert('The task queue is not available yet. Run a live scan and try again.');
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'le-recovery-search') {
      state.query = e.target.value || '';
      var start = e.target.selectionStart;
      render();
      var next = document.getElementById('le-recovery-search');
      if (next) { next.focus(); try { next.setSelectionRange(start, start); } catch (_) {} }
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'le-recovery-filter') { state.filter = e.target.value || 'all'; render(); }
  });
  function boot() {
    var attempts = 0;
    function tick() {
      var s = getData();
      var key = [s.workspaceId || '', (s.opportunities || []).length, (s.tasks || []).length, s.scannedAt || '', (window.LE && window.LE.getState ? window.LE.getState().view : '')].join('|');
      if (key !== state.lastKey || document.getElementById('le-recovery-engine') === null || (document.getElementById('le-recovery-engine') && document.getElementById('le-recovery-engine').previousElementSibling !== document.getElementById('le-autonomy-center'))) { state.lastKey = key; render(); }
      if (++attempts < 100) window.setTimeout(tick, 1800);
    }
    tick();
    window.setInterval(function () {
      var s = getData(), key = [s.workspaceId || '', (s.opportunities || []).length, (s.tasks || []).length, s.scannedAt || '', (window.LE && window.LE.getState ? window.LE.getState().view : '')].join('|');
      if (key !== state.lastKey || document.getElementById('le-recovery-engine') === null || (document.getElementById('le-recovery-engine') && document.getElementById('le-recovery-engine').previousElementSibling !== document.getElementById('le-autonomy-center'))) { state.lastKey = key; render(); }
    }, 5000);
  }
  window.LERecoveryEngine = { render: render, exportCsv: exportCsv, getState: function () { return state; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();