/* Loose Ends Co. — safe CSV opportunity import.
 * Explicit preview and confirmation; imports only into the signed-in current workspace.
 * No messages, payments, or existing-record updates are performed.
 */
(function () {
  'use strict';
  var rows = [], busy = false;
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(v) { return '$' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
  function parse(text) {
    var all = [], row = [], cell = '', quoted = false;
    text = String(text || '').replace(/^\uFEFF/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i], next = text[i + 1];
      if (ch === '"' && quoted && next === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
      else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && next === '\n') i++;
        row.push(cell); if (row.some(function (v) { return String(v).trim(); })) all.push(row);
        row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); if (row.some(function (v) { return String(v).trim(); })) all.push(row); }
    if (all.length < 2) throw new Error('CSV must include a header and at least one data row.');
    var headers = all.shift().map(function (h) { return String(h).trim().toLowerCase().replace(/[ _-]+/g, ' '); });
    function val(r, names) { for (var i = 0; i < names.length; i++) { var at = headers.indexOf(names[i]); if (at >= 0) return String(r[at] || '').trim(); } return ''; }
    var output = [], skipped = 0, seen = Object.create(null);
    all.slice(0, 100).forEach(function (r) {
      var title = val(r, ['title', 'opportunity', 'opportunity title', 'name']);
      var raw = val(r, ['amount', 'value', 'potential value', 'amount at risk']);
      var amount = Number(raw.replace(/[,$\s]/g, ''));
      if (!title || !raw || !isFinite(amount) || amount < 0) { skipped++; return; }
      var key = title.toLowerCase() + '|' + amount;
      if (seen[key]) { skipped++; return; } seen[key] = true;
      output.push({ title: title.slice(0, 200), amount: amount, source: (val(r, ['source', 'category', 'type']) || 'csv_import').slice(0, 80), reason: (val(r, ['reason', 'notes', 'next action', 'description']) || 'Imported from owner-provided CSV; verify before follow-up.').slice(0, 500) });
    });
    return { rows: output, skipped: skipped + Math.max(0, all.length - 100) };
  }
  function getCenter() { return window.LEAutonomyCenter && window.LEAutonomyCenter.getState ? window.LEAutonomyCenter.getState() : null; }
  function render() {
    var engine = document.getElementById('le-recovery-engine');
    if (!engine) { var old = document.getElementById('le-csv-import'); if (old) old.remove(); return; }
    var panel = document.getElementById('le-csv-import');
    if (!panel) { panel = document.createElement('section'); panel.id = 'le-csv-import'; panel.className = 'le-recovery-engine'; engine.insertAdjacentElement('afterend', panel); }
    panel.innerHTML = '<div class="le-recovery-head"><div><div class="le-recovery-kicker">SAFE DATA ONBOARDING</div><h2>Import real opportunities</h2><div class="le-recovery-muted">Upload a CSV with title and amount columns. Optional source and reason columns are supported. Records are previewed first and saved only after you confirm.</div></div><div class="le-recovery-actions"><input type="file" id="le-csv-file" accept=".csv,text/csv" hidden><button class="le-recovery-btn" type="button" data-csv-action="choose">Choose CSV</button></div></div>' +
      (rows.length ? '<div class="le-recovery-note"><strong>Preview: ' + rows.length + ' valid row(s)</strong><div class="le-recovery-muted">' + rows.slice(0, 5).map(function (r) { return esc(r.title) + ' · ' + money(r.amount); }).join(' &nbsp; | &nbsp; ') + '</div><div class="le-recovery-muted" style="margin:6px 0 10px">' + (window.__leCsvSkipped || 0) + ' invalid, duplicate, or over-limit row(s) skipped. Duplicate title + amount records already in the workspace will be skipped.</div><button class="le-recovery-btn primary" type="button" data-csv-action="confirm" ' + (busy ? 'disabled' : '') + '>' + (busy ? 'Importing…' : 'Confirm import') + '</button> <button class="le-recovery-btn" type="button" data-csv-action="cancel">Cancel</button></div>' : '') +
      '<div id="le-csv-message" class="le-recovery-muted" role="status" aria-live="polite"></div>';
  }
  async function confirm() {
    if (busy || !rows.length) return;
    var S = window.LESupabase, state = getCenter(), workspace = state && state.workspaceId;
    if (!S || !workspace) { message('Sign in to a workspace and run a live scan before importing.'); return; }
    busy = true; render();
    try {
      var existing = (state.opportunities || []).map(function (o) { return String(o.title || '').trim().toLowerCase() + '|' + Number(o.amount || 0); });
      var seen = Object.create(null), inserts = [], skipped = 0;
      rows.forEach(function (r) {
        var key = r.title.toLowerCase() + '|' + Number(r.amount || 0);
        if (existing.indexOf(key) >= 0 || seen[key]) { skipped++; return; }
        seen[key] = true;
        inserts.push({ workspace_id: workspace, title: r.title, amount: r.amount, source: r.source, reason: r.reason, status: 'open', recovered_amount: 0, priority: r.amount >= 1000 ? 1 : r.amount >= 500 ? 2 : 3 });
      });
      var count = 0;
      for (var i = 0; i < inserts.length; i += 20) {
        var result = await S.from('opportunities').insert(inserts.slice(i, i + 20)).select('id');
        if (result.error) throw result.error;
        count += (result.data || []).length;
      }
      rows = []; render();
      message('Import complete: ' + count + ' opportunity record(s) created; ' + skipped + ' existing duplicate(s) skipped. Run a live scan to refresh the ledger.');
      if (window.LEAutonomyCenter && window.LEAutonomyCenter.scan) await window.LEAutonomyCenter.scan({ quiet: true });
    } catch (e) { message('Import failed safely. No customer messages were sent. ' + String(e && e.message || 'Check your workspace access and CSV format.').slice(0, 220)); }
    finally { busy = false; render(); }
  }
  function message(value) { var el = document.getElementById('le-csv-message'); if (el) el.textContent = value; }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-csv-action]'); if (!b) return;
    var action = b.getAttribute('data-csv-action');
    if (action === 'choose') { var f = document.getElementById('le-csv-file'); if (f) f.click(); }
    if (action === 'confirm') confirm();
    if (action === 'cancel') { rows = []; render(); }
  });
  document.addEventListener('change', function (e) {
    if (!e.target || e.target.id !== 'le-csv-file' || !e.target.files || !e.target.files[0]) return;
    var reader = new FileReader();
    reader.onload = function () {
      try { var parsed = parse(reader.result); rows = parsed.rows; window.__leCsvSkipped = parsed.skipped; render(); message(rows.length ? 'Review the preview before importing. Nothing has been saved yet.' : 'No valid rows found. Include a title column and a numeric amount column.'); }
      catch (error) { rows = []; render(); message(String(error.message || 'Could not parse CSV.')); }
    };
    reader.onerror = function () { message('Could not read that file.'); };
    reader.readAsText(e.target.files[0]); e.target.value = '';
  });
  function boot() {
    var ticks = 0;
    function tick() { render(); if (++ticks < 100) window.setTimeout(tick, 1800); }
    tick();
    window.setInterval(render, 5000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();