/* Loose Ends Co. — Autonomy Center.
 * Uses only the signed-in workspace's existing records. No external messages,
 * payments, or destructive actions are sent automatically.
 */
(function () {
  'use strict';
  var S = window.LESupabase;
  if (!S) return;

  var state = {
    workspaceId: null,
    opportunities: [],
    tasks: [],
    followUps: [],
    workflows: [],
    runs: [],
    audit: [],
    busy: false,
    error: '',
    notice: '',
    scannedAt: null,
    lastAttemptAt: 0,
    lastView: '',
    lastWorkspace: ''
  };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    return '$' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  function dateLabel(v) {
    if (!v) return 'No due date';
    var d = new Date(v);
    return isNaN(d.getTime()) ? 'No due date' : d.toLocaleString();
  }
  function appState() {
    return window.LE && typeof window.LE.getState === 'function' ? window.LE.getState() : null;
  }
  function currentView() {
    var a = appState();
    return a && a.view ? a.view : (window.state && window.state.view) || 'overview';
  }
  async function workspaceId() {
    var a = appState();
    if (a && a.workspaceId) return a.workspaceId;
    var auth = await S.auth.getUser();
    var user = auth && auth.data && auth.data.user;
    if (!user) return null;
    var m = await S.from('workspace_members').select('workspace_id').eq('user_id', user.id).limit(1).maybeSingle();
    if (m.error) throw m.error;
    return m.data && m.data.workspace_id || null;
  }
  function activeOpp(o) {
    return ['open', 'contacted', 'scheduled', 'responded'].indexOf(String(o.status || 'open')) >= 0;
  }
  function score(o) {
    var amount = Math.max(0, Number(o.amount || 0));
    var created = new Date(o.created_at || Date.now()).getTime();
    var age = Math.max(0, (Date.now() - (isNaN(created) ? Date.now() : created)) / 86400000);
    var text = String((o.title || '') + ' ' + (o.source || '') + ' ' + (o.reason || '')).toLowerCase();
    var n = Math.min(28, amount / 175);
    n += age <= 2 ? 22 : age <= 7 ? 17 : age <= 21 ? 11 : age <= 60 ? 6 : 2;
    if (/missed|call back|callback|inquir|new lead/.test(text)) n += 22;
    if (/estimate|quote|proposal|declin|unsold/.test(text)) n += 18;
    if (/maintenance|service due|rebook|cancel/.test(text)) n += 12;
    if (o.status === 'scheduled') n += 8;
    if (o.status === 'contacted') n -= 4;
    if (o.status === 'responded') n += 4;
    return Math.max(1, Math.min(100, Math.round(n)));
  }
  function probability(o) {
    var p = 0.22;
    var t = String((o.title || '') + ' ' + (o.source || '') + ' ' + (o.reason || '')).toLowerCase();
    var age = Math.max(0, (Date.now() - new Date(o.created_at || Date.now()).getTime()) / 86400000);
    if (/missed|call|lead|inquir/.test(t)) p += 0.18;
    if (/estimate|quote|proposal|declin|unsold/.test(t)) p += 0.14;
    if (age <= 2) p += 0.14;
    else if (age <= 7) p += 0.10;
    else if (age > 60) p -= 0.10;
    if (o.status === 'scheduled') p += 0.12;
    if (o.status === 'contacted') p += 0.03;
    return Math.max(0.05, Math.min(0.78, p));
  }
  function nextAction(o) {
    var t = String((o.title || '') + ' ' + (o.source || '') + ' ' + (o.reason || '')).toLowerCase();
    if (/missed|call|lead|inquir/.test(t)) return 'Return the call or reply to the inquiry';
    if (/estimate|quote|proposal|declin|unsold/.test(t)) return 'Follow up on the estimate';
    if (/maintenance|service due|rebook|cancel/.test(t)) return 'Offer a service or rebooking check-in';
    if (o.status === 'scheduled') return 'Confirm the appointment';
    return 'Review the record and choose the next step';
  }
  function metrics() {
    var active = state.opportunities.filter(activeOpp);
    var risk = active.reduce(function (sum, o) { return sum + Number(o.amount || 0); }, 0);
    var modeled = active.reduce(function (sum, o) { return sum + Number(o.amount || 0) * probability(o); }, 0);
    var overdueTasks = state.tasks.filter(function (t) {
      return t.status !== 'completed' && t.due_at && new Date(t.due_at).getTime() < Date.now();
    });
    var dueFollowUps = state.followUps.filter(function (f) {
      return f.status === 'pending' && f.scheduled_at && new Date(f.scheduled_at).getTime() <= Date.now();
    });
    var recovered = state.opportunities.filter(function (o) { return o.status === 'recovered'; })
      .reduce(function (sum, o) { return sum + Number(o.recovered_amount || 0); }, 0);
    return {
      active: active,
      risk: risk,
      modeled: modeled,
      overdue: overdueTasks.length + dueFollowUps.length,
      overdueTasks: overdueTasks.length,
      dueFollowUps: dueFollowUps.length,
      recovered: recovered,
      enabled: state.workflows.filter(function (w) { return w.enabled !== false; }).length
    };
  }
  function styles() {
    if (document.getElementById('le-autonomy-style')) return;
    var style = document.createElement('style');
    style.id = 'le-autonomy-style';
    style.textContent =
      '.le-autonomy{margin:0 0 16px;padding:18px;border-radius:18px;border:1px solid rgba(86,217,177,.24);background:linear-gradient(135deg,#0b1722,#102b2b);color:#fff;box-shadow:0 18px 44px rgba(0,0,0,.12)}' +
      '.le-aut-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}.le-aut-kicker{font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:900;color:#9db2c6}.le-autonomy h2{font-size:22px;margin:5px 0}.le-aut-sub{font-size:12px;line-height:1.5;color:#b8c8d4;max-width:700px}.le-aut-actions{display:flex;gap:7px;flex-wrap:wrap}.le-autonomy button{border:0;border-radius:10px;padding:10px 12px;font-weight:850;cursor:pointer}.le-aut-primary{background:#56d9b1;color:#062019}.le-aut-secondary{background:rgba(255,255,255,.09);color:#fff;border:1px solid rgba(255,255,255,.12)!important}.le-autonomy button:disabled{opacity:.55;cursor:wait}.le-aut-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:15px 0}.le-aut-stat{padding:12px;border-radius:12px;background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.07)}.le-aut-stat span{display:block;font-size:9px;letter-spacing:.09em;text-transform:uppercase;color:#a9bbc9}.le-aut-stat strong{display:block;font-size:20px;margin-top:5px}.le-aut-columns{display:grid;grid-template-columns:1.25fr .75fr;gap:12px}.le-aut-card{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.045);border-radius:13px;padding:13px;min-width:0}.le-aut-card h3{font-size:13px;margin:0 0 10px}.le-aut-row{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:9px;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08)}.le-aut-row:last-child{border-bottom:0}.le-aut-score{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:rgba(86,217,177,.15);color:#8bf0d0;font-size:11px;font-weight:900}.le-aut-row strong{display:block;font-size:12px;overflow-wrap:anywhere}.le-aut-row small{display:block;font-size:10px;line-height:1.45;color:#b8c8d4;margin-top:3px}.le-aut-row button{padding:7px 9px;font-size:10px}.le-aut-note{font-size:11px;line-height:1.5;color:#c4d1dc;padding:10px;border-radius:10px;background:rgba(255,255,255,.045);margin-top:10px}.le-aut-error{font-size:12px;color:#ffd2c9;padding:10px;border-radius:10px;background:rgba(180,35,24,.15);margin-top:10px}.le-aut-ok{font-size:12px;color:#9df1d5;margin-top:10px}.le-aut-muted{font-size:11px;color:#b8c8d4}.le-aut-empty{padding:12px;color:#b8c8d4;font-size:12px}@media(max-width:760px){.le-aut-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.le-aut-columns{grid-template-columns:1fr}.le-aut-head{flex-direction:column}.le-autonomy h2{font-size:19px}}';
    document.head.appendChild(style);
  }
  function currentPage() {
    var page = document.querySelector('#content .page');
    return page || null;
  }
  function render() {
    var view = currentView();
    if (view !== 'overview' && view !== 'intelligence') {
      var existing = document.getElementById('le-autonomy-center');
      if (existing) existing.remove();
      state.lastView = view;
      return;
    }
    var page = currentPage();
    if (!page) return;
    styles();
    var m = metrics();
    var top = m.active.slice().sort(function (a, b) { return score(b) - score(a); }).slice(0, 4);
    var old = document.getElementById('le-autonomy-center');
    if (old) old.remove();
    var box = document.createElement('section');
    box.id = 'le-autonomy-center';
    box.className = 'le-autonomy';
    box.innerHTML =
      '<div class="le-aut-head"><div><div class="le-aut-kicker">REVENUE RECOVERY INTELLIGENCE · CONTROL PLANE</div><h2>Autonomy Center</h2><div class="le-aut-sub">Continuously prioritize real workspace records, surface the next best action, and let the existing workflow engine process authorized work. Recommendations use transparent rules today; modeled recovery is an estimate, not a promise.</div></div><div class="le-aut-actions"><button class="le-aut-secondary" data-aut-action="scan" ' + (state.busy ? 'disabled' : '') + '>' + (state.busy ? 'Scanning…' : 'Run live scan') + '</button><button class="le-aut-primary" data-aut-action="cycle" ' + (state.busy ? 'disabled' : '') + '>Run workflow cycle</button></div></div>' +
      '<div class="le-aut-grid"><div class="le-aut-stat"><span>Revenue at risk</span><strong>' + money(m.risk) + '</strong></div><div class="le-aut-stat"><span>Modeled recovery</span><strong>' + money(m.modeled) + '</strong></div><div class="le-aut-stat"><span>Open action queue</span><strong>' + (m.active.length + m.overdue) + '</strong></div><div class="le-aut-stat"><span>Confirmed recovered</span><strong>' + money(m.recovered) + '</strong></div></div>' +
      '<div class="le-aut-columns"><div class="le-aut-card"><h3>Highest-value next actions</h3>' +
      (top.length ? top.map(function (o) {
        var customer = o.customers || {};
        var name = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Customer not linked';
        return '<div class="le-aut-row"><div class="le-aut-score">' + score(o) + '</div><div><strong>' + esc(o.title || o.source || 'Revenue opportunity') + '</strong><small>' + esc(name) + ' · ' + money(o.amount) + ' · ' + esc(nextAction(o)) + '</small></div><button class="le-aut-secondary" data-aut-action="task" data-opp="' + esc(o.id) + '">Queue task</button></div>';
      }).join('') : '<div class="le-aut-empty">No active opportunities found in this workspace. Import or add real customer/opportunity records to start.</div>') +
      '<div class="le-aut-actions" style="margin-top:10px"><button class="le-aut-secondary" data-aut-action="queue" ' + (state.busy || !top.length ? 'disabled' : '') + '>Queue top 3 actions</button></div></div>' +
      '<div class="le-aut-card"><h3>Operations pulse</h3><div class="le-aut-row"><div class="le-aut-score">' + m.overdue + '</div><div><strong>Overdue / due follow-ups</strong><small>' + m.overdueTasks + ' overdue tasks · ' + m.dueFollowUps + ' follow-ups due</small></div></div><div class="le-aut-row"><div class="le-aut-score">' + m.enabled + '</div><div><strong>Enabled workflows</strong><small>Existing server-side workflow engine</small></div></div><div class="le-aut-row"><div class="le-aut-score">' + state.runs.filter(function (r) { return r.status === 'waiting_approval'; }).length + '</div><div><strong>Approvals waiting</strong><small>Consequential actions remain under human review</small></div></div><div class="le-aut-note">Execution boundary: this center can queue tasks and run the existing workflow runner. It does not send customer messages, spend money, issue refunds, or make financial trades automatically.</div><div class="le-aut-muted" style="margin-top:10px">Last scan: ' + esc(state.scannedAt ? dateLabel(state.scannedAt) : 'Not run yet') + '</div></div></div>' +
      (state.error ? '<div class="le-aut-error">' + esc(state.error) + '</div>' : '') +
      (state.notice ? '<div class="le-aut-ok">' + esc(state.notice) + '</div>' : '') +
      '<div class="le-aut-muted" style="margin-top:10px">Workspace-scoped live data · rules-based scoring · audit trail enabled where permitted</div>';
    page.insertBefore(box, page.firstChild);
    box.querySelectorAll('[data-aut-action]').forEach(function (button) {
      button.addEventListener('click', function () {
        var action = button.getAttribute('data-aut-action');
        if (action === 'scan') scan();
        else if (action === 'cycle') runCycle();
        else if (action === 'task') queueTask(button.getAttribute('data-opp'));
        else if (action === 'queue') queueTop();
      });
    });
    state.lastView = view;
  }
  async function scan(options) {
    if (state.busy) return;
    state.busy = true;
    state.lastAttemptAt = Date.now();
    state.error = '';
    state.notice = '';
    render();
    try {
      var w = await workspaceId();
      if (!w) throw new Error('Sign in to a workspace before running the intelligence scan.');
      state.workspaceId = w;
      var results = await Promise.all([
        S.from('opportunities').select('id,workspace_id,customer_id,title,source,reason,amount,priority,status,due_at,created_at,updated_at,customers(first_name,last_name,phone)').eq('workspace_id', w).order('updated_at', { ascending: false }).limit(500),
        S.from('tasks').select('id,title,status,due_at,priority,opportunity_id,customer_id').eq('workspace_id', w).order('due_at', { ascending: true }).limit(500),
        S.from('follow_ups').select('id,status,scheduled_at,opportunity_id,customer_id,message,channel').eq('workspace_id', w).order('scheduled_at', { ascending: true }).limit(500),
        S.from('workflows').select('id,name,enabled,mode,trigger_type').eq('workspace_id', w).order('created_at', { ascending: false }).limit(200),
        S.from('workflow_runs').select('id,status,created_at,completed_at,error').eq('workspace_id', w).order('created_at', { ascending: false }).limit(20),
      ]);
      var failed = results.find(function (r) { return r && r.error; });
      if (failed) throw failed.error;
      state.opportunities = results[0].data || [];
      state.tasks = results[1].data || [];
      state.followUps = results[2].data || [];
      state.workflows = results[3].data || [];
      state.runs = results[4].data || [];
      state.scannedAt = new Date().toISOString();
      if (!options || !options.quiet) state.notice = 'Live scan complete. ' + state.opportunities.length + ' opportunities, ' + state.tasks.length + ' tasks, ' + state.workflows.length + ' workflows checked.';
    } catch (error) {
      state.error = error && error.message ? error.message : 'The live intelligence scan failed.';
    } finally {
      state.busy = false;
      render();
    }
  }
  async function logAudit(userId, entityId, action, metadata) {
    if (!state.workspaceId) return;
    var r = await S.from('audit_events').insert({
      workspace_id: state.workspaceId,
      actor_user_id: userId || null,
      entity_type: 'opportunity',
      entity_id: entityId || null,
      action: action,
      metadata: metadata || {}
    });
    if (r.error) console.warn('Autonomy audit event was not recorded:', r.error.message);
  }
  async function queueTask(opportunityId) {
    if (state.busy) return;
    state.busy = true;
    state.error = '';
    state.notice = '';
    render();
    try {
      var userResult = await S.auth.getUser();
      var user = userResult && userResult.data && userResult.data.user;
      var w = await workspaceId();
      var o = state.opportunities.find(function (x) { return x.id === opportunityId; });
      if (!user || !w || !o) throw new Error('The workspace session or opportunity is no longer available. Run a fresh scan.');
      var existing = await S.from('tasks').select('id,status').eq('workspace_id', w).eq('opportunity_id', o.id).neq('status', 'completed').limit(1);
      if (existing.error) throw existing.error;
      if (existing.data && existing.data.length) {
        state.notice = 'An open task already exists for this opportunity; no duplicate was created.';
      } else {
        var inserted = await S.from('tasks').insert({
          workspace_id: w,
          customer_id: o.customer_id || null,
          opportunity_id: o.id,
          title: 'Revenue recovery: ' + String(o.title || o.source || 'Follow up on opportunity').slice(0, 170),
          status: 'open',
          priority: score(o) >= 80 ? 3 : score(o) >= 55 ? 2 : 1,
          due_at: new Date(Date.now() + 2 * 3600000).toISOString()
        }).select('id').single();
        if (inserted.error) throw inserted.error;
        await logAudit(user.id, o.id, 'autonomy_task_created', { task_id: inserted.data && inserted.data.id, score: score(o), amount: Number(o.amount || 0), recommendation: nextAction(o) });
        state.notice = 'Task created for ' + (o.title || 'the selected opportunity') + '. No customer message was sent.';
      }
      state.busy = false;
      await scan({ quiet: true });
    } catch (error) {
      state.error = error && error.message ? error.message : 'Could not queue the recommended task.';
      state.busy = false;
      render();
    }
  }
  async function queueTop() {
    if (state.busy) return;
    state.busy = true;
    state.error = '';
    state.notice = '';
    render();
    try {
      var m = metrics();
      var top = m.active.slice().sort(function (a, b) { return score(b) - score(a); }).slice(0, 3);
      if (!top.length) throw new Error('There are no active opportunities to queue.');
      var userResult = await S.auth.getUser();
      var user = userResult && userResult.data && userResult.data.user;
      if (!user || !state.workspaceId) throw new Error('Sign in to a workspace before queueing tasks.');
      var created = 0, skipped = 0;
      for (var i = 0; i < top.length; i++) {
        var o = top[i];
        var existing = await S.from('tasks').select('id,status').eq('workspace_id', state.workspaceId).eq('opportunity_id', o.id).neq('status', 'completed').limit(1);
        if (existing.error) throw existing.error;
        if (existing.data && existing.data.length) { skipped++; continue; }
        var ins = await S.from('tasks').insert({
          workspace_id: state.workspaceId,
          customer_id: o.customer_id || null,
          opportunity_id: o.id,
          title: 'Revenue recovery: ' + String(o.title || o.source || 'Follow up on opportunity').slice(0, 170),
          status: 'open',
          priority: score(o) >= 80 ? 3 : score(o) >= 55 ? 2 : 1,
          due_at: new Date(Date.now() + 2 * 3600000).toISOString()
        }).select('id').single();
        if (ins.error) throw ins.error;
        created++;
        await logAudit(user.id, o.id, 'autonomy_task_created', { task_id: ins.data && ins.data.id, score: score(o), amount: Number(o.amount || 0), recommendation: nextAction(o) });
      }
      state.notice = created + ' tasks queued; ' + skipped + ' skipped because an open task already existed. No customer messages were sent.';
      await scan({ quiet: true });
    } catch (error) {
      state.error = error && error.message ? error.message : 'Could not queue recommended tasks.';
      state.busy = false;
      render();
    }
  }
  async function runCycle() {
    if (state.busy) return;
    state.busy = true;
    state.error = '';
    state.notice = '';
    render();
    try {
      var auth = await S.auth.getSession();
      var token = auth && auth.data && auth.data.session && auth.data.session.access_token;
      var base = String(window.__LOOSE_ENDS_SUPABASE_URL__ || '').replace(/\/$/, '');
      if (!token || !base) throw new Error('An authenticated session is required to run the workflow cycle.');
      var w = await workspaceId();
      if (!w) throw new Error('Sign in to a workspace before running the workflow cycle.');
      var response = await fetch(base + '/functions/v1/workflow-runner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ workspace_id: w })
      });
      var result = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(result.error || 'The workflow runner returned an error.');
      state.notice = 'Workflow cycle completed. Review recent workflow runs for any approvals or errors.';
      await scan({ quiet: true });
    } catch (error) {
      state.error = error && error.message ? error.message : 'Workflow cycle failed.';
      state.busy = false;
      render();
    }
  }
  function boot() {
    var tries = 0;
    var timer = setInterval(function () {
      var view = currentView();
      if (view !== state.lastView) {
        render();
        if ((view === 'overview' || view === 'intelligence') && !state.scannedAt && !state.busy && Date.now() - state.lastAttemptAt > 15000) scan({ quiet: true });
      }
      if ((view === 'overview' || view === 'intelligence') && !state.scannedAt && !state.busy && Date.now() - state.lastAttemptAt > 15000) scan({ quiet: true });
      if (++tries > 80) clearInterval(timer);
    }, 1200);
    setInterval(function () {
      var view = currentView();
      if ((view === 'overview' || view === 'intelligence') && !state.busy && (!state.scannedAt || Date.now() - new Date(state.scannedAt).getTime() > 60000)) scan({ quiet: true });
    }, 15000);
  }
  window.LEAutonomyCenter = { scan: scan, queueTask: queueTask, queueTop: queueTop, runCycle: runCycle, getState: function () { return state; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();