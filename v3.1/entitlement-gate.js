/* Loose Ends entitlement gate (DRAFT 2026-11-15 — development branch only).
 * Shows a workspace-blocking banner when the workspace subscription is not in an
 * entitled state. Fail-closed for premium access, fail-open-read for the billing
 * page (so an unentitled owner can still reach checkout/portal).
 * Not wired to any live environment here; requires owner-approved deploy.
 */
(function (root) {
  'use strict';

  var ENTITLED = ['trialing', 'active'];
  var GRACE = ['past_due']; // grace until Stripe final-fails; owner decision flagged in PR
  var BLOCKED = ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'];

  // Pure, testable decision. row may be null/undefined, or the workspace_subscriptions row.
  function evaluate(row, opts) {
    opts = opts || {};
    var now = typeof opts.now === 'number' ? opts.now : Date.now();
    var allowGrace = opts.allowPastDue === true;
    var reason, status = row && row.status ? String(row.status) : null;
    var periodEnd = row && row.current_period_end ? new Date(row.current_period_end).getTime() : NaN;

    if (!row || !status) {
      return { entitled: false, status: null, reason: 'no_subscription', billingCta: true };
    }
    if (ENTITLED.indexOf(status) !== -1) {
      if (isFinite(periodEnd) && periodEnd <= now) {
        return { entitled: false, status: status, reason: 'period_ended', billingCta: true };
      }
      return { entitled: true, status: status, reason: 'ok', billingCta: false };
    }
    if (GRACE.indexOf(status) !== -1) {
      if (isFinite(periodEnd) && periodEnd <= now) {
        return { entitled: false, status: status, reason: 'period_ended', billingCta: true };
      }
      return allowGrace
        ? { entitled: true, status: status, reason: 'past_due_grace', billingCta: true }
        : { entitled: false, status: status, reason: 'past_due', billingCta: true };
    }
    if (BLOCKED.indexOf(status) !== -1) {
      return { entitled: false, status: status, reason: status, billingCta: true };
    }
    return { entitled: false, status: status, reason: 'unknown_status', billingCta: true };
  }

  function renderBlock(target, decision) {
    if (!target) return;
    var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
    target.innerHTML =
      '<div class="page entitlement-block" style="padding:32px;max-width:560px">' +
      '<div class="eyebrow">SUBSCRIPTION REQUIRED</div>' +
      '<h2>This workspace does not have an active Loose Ends plan</h2>' +
      '<p>Status: <b>' + esc(decision.reason) + '</b>. To keep using Loose Ends OS ($199/month), open Billing and start or resume the subscription.</p>' +
      '<button class="le-btn" id="le-entitlement-billing">Go to Billing</button>' +
      '</div>';
    var btn = document.getElementById('le-entitlement-billing');
    if (btn) btn.onclick = function () {
      if (root.LELive && root.LELive.openView) root.LELive.openView('settings');
      else window.location.assign('/dashboard');
    };
  }

  var api = { evaluate: evaluate, renderBlock: renderBlock, ENTITLED: ENTITLED, GRACE: GRACE, BLOCKED: BLOCKED };
  root.LEEntitlement = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
