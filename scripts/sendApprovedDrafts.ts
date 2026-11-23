/// <reference path="./node-ambient.d.ts" />
/**
 * scripts/sendApprovedDrafts.ts
 *
 * Owner-Approved Outreach Email Dispatcher for Loose Ends.
 *
 * Queries `public.ops_communication_drafts` where `status = 'approved'` and
 * `delivery_status = 'not_sent'`, re-verifies `customer_contact_consent_events`
 * to block any opted-out/revoked address, and dispatches the email via
 * Resend (`https://api.resend.com/emails`, `RESEND_API_KEY`) or configured SMTP
 * relay (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`).
 *
 * On successful transmission:
 *   - Updates `ops_communication_drafts` to `delivery_status = 'sent'`, `sent_at = now()`
 *   - Updates the linked `public_leads` row to `status = 'CONTACTED'`
 */

import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  CAN_SPAM_PHYSICAL_ADDRESS,
  isCanSpamFooterCompliant,
  isConsentEventSuppressed,
} from '../src/lib/canSpamGuard.ts';
import {
  assignSenderInbox,
  effectiveDailyCap,
  normalizeInboxForDate,
} from '../src/lib/outbound/sequencerEngine.ts';
import type { OutboundSenderInbox } from '../src/types/domain.ts';

const seenEnvFiles = new Set<string>();
const repoEnvLocal = resolve(
  decodeURIComponent(
    new URL('../.env.local', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  )
);
const repoEnv = resolve(
  decodeURIComponent(
    new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  )
);
for (const candidate of [repoEnvLocal, resolve('.env.local'), repoEnv, resolve('.env')]) {
  if (seenEnvFiles.has(candidate)) continue;
  seenEnvFiles.add(candidate);
  try {
    process.loadEnvFile?.(candidate);
  } catch {
    // Optional env file not present
  }
}

const AUTHORITATIVE_SUPABASE_URL = 'https://uehfvpnnoitgybsmdgef.supabase.co';

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /your-project-ref/i,
  /your-service-role-key/i,
  /your-anon-publishable-key/i,
  /your-workspace-id/i,
  /your-resend-api-key/i,
  /placeholder/i,
  /example/i,
  /todo/i,
  /replace[_-]?me/i,
  /^<.*>$/,
  /^\.+$/,
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPlaceholderValue(raw: string | undefined): boolean {
  const val = (raw ?? '').trim();
  if (!val) return false;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(val));
}

function resolveSupabaseUrl(): string {
  const raw = (process.env.VITE_SUPABASE_URL ?? '').trim();
  if (!raw || isPlaceholderValue(raw)) {
    return AUTHORITATIVE_SUPABASE_URL;
  }
  return raw;
}

function resolveServiceRoleKey(): {
  valid: boolean;
  key: string;
  reason?: string;
} {
  const raw = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!raw) {
    return { valid: false, key: '', reason: 'SUPABASE_SERVICE_ROLE_KEY is missing.' };
  }
  if (isPlaceholderValue(raw)) {
    return { valid: false, key: '', reason: 'SUPABASE_SERVICE_ROLE_KEY contains a literal placeholder value.' };
  }
  if (raw.startsWith('sb_publishable_')) {
    return { valid: false, key: '', reason: 'SUPABASE_SERVICE_ROLE_KEY is set to a publishable/anon key instead of the service_role key.' };
  }
  return { valid: true, key: raw };
}

interface WorkspaceRow {
  id: string;
  name: string;
}

async function verifyDatabaseAndWorkspace(
  supabase: SupabaseClient
): Promise<{ workspaceId: string; workspaceName: string | null }> {
  const configuredWorkspaceId = (process.env.DEFAULT_WORKSPACE_ID ?? '').trim();
  if (configuredWorkspaceId && isPlaceholderValue(configuredWorkspaceId)) {
    throw new Error('DEFAULT_WORKSPACE_ID contains a literal placeholder.');
  }
  if (configuredWorkspaceId && !UUID_REGEX.test(configuredWorkspaceId)) {
    throw new Error(`DEFAULT_WORKSPACE_ID ("${configuredWorkspaceId}") is not a valid UUID.`);
  }
  if (configuredWorkspaceId) {
    const { data, error } = await supabase
      .from('workspaces')
      .select('id, name')
      .eq('id', configuredWorkspaceId)
      .maybeSingle();
    if (error) throw new Error(`Database connectivity check failed: ${error.message}`);
    const row = data as WorkspaceRow | null;
    if (!row) throw new Error(`DEFAULT_WORKSPACE_ID (${configuredWorkspaceId}) does not exist in public.workspaces.`);
    return { workspaceId: row.id, workspaceName: row.name };
  }
  const { data: workspaces, error: listError } = await supabase
    .from('workspaces')
    .select('id, name')
    .order('created_at', { ascending: true })
    .limit(5);
  if (listError) throw new Error(`Database connectivity check failed: ${listError.message}`);
  const typedWorkspaces = (workspaces ?? []) as WorkspaceRow[];
  if (typedWorkspaces.length === 1) {
    return { workspaceId: typedWorkspaces[0].id, workspaceName: typedWorkspaces[0].name };
  }
  if (typedWorkspaces.length === 0) {
    throw new Error('No rows found in public.workspaces. Set DEFAULT_WORKSPACE_ID explicitly.');
  }
  const summary = typedWorkspaces.map((w) => `${w.id} (${w.name})`).join(', ');
  throw new Error(
    `Multiple workspaces found in public.workspaces (${summary}). Set DEFAULT_WORKSPACE_ID explicitly; cross-workspace broadcast is blocked.`
  );
}

interface ApprovedDraftRow {
  id:                 string;
  workspace_id:       string;
  customer_id:        string | null;
  lead_id?:           string | null;
  channel:            string;
  recipient_email?:   string | null;
  recipient_name?:    string | null;
  company_name?:      string | null;
  outreach_lane?:     string | null;
  sequence_step?:     number | null;
  parent_draft_id?:   string | null;
  assigned_sender_id?: string | null;
  scheduled_after?:   string | null;
  auto_paused_reason?: string | null;
  subject:            string;
  message:            string;
  status:             string;
  delivery_status:    string;
}

interface ConsentSuppressionRow {
  id:        string;
  email?:    string | null;
  status?:   string | null;
  decision?: string | null;
}

interface CustomerEmailRow {
  id:         string;
  email:      string | null;
  first_name: string;
  last_name:  string | null;
}

interface ResendSendResponse {
  id?:      string;
  message?: string;
}

async function isRecipientSuppressed(
  supabase: SupabaseClient,
  workspaceId: string,
  email: string,
  customerId: string | null
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();

  if (normalizedEmail) {
    const { data: directEvents, error: directErr } = await supabase
      .from('customer_contact_consent_events')
      .select('id, email, status, decision')
      .eq('workspace_id', workspaceId)
      .ilike('email', normalizedEmail);

    if (directErr) return true;

    const typedDirect = (directEvents ?? []) as ConsentSuppressionRow[];
    if (typedDirect.some((evt) => isConsentEventSuppressed(evt))) {
      return true;
    }
  }

  if (customerId) {
    const { data: custEvents, error: custErr } = await supabase
      .from('customer_contact_consent_events')
      .select('id, status, decision')
      .eq('workspace_id', workspaceId)
      .eq('customer_id', customerId)
      .eq('channel', 'email')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1);

    if (custErr) return true;

    const latestCust = ((custEvents ?? []) as ConsentSuppressionRow[])[0];
    if (isConsentEventSuppressed(latestCust)) {
      return true;
    }
  }

  return false;
}

async function hasGrantedEmailConsent(
  supabase: SupabaseClient,
  workspaceId: string,
  customerId: string | null
): Promise<boolean> {
  if (!customerId) return false;
  const { data } = await supabase
    .from('customer_contact_consent_events')
    .select('id, status, decision')
    .eq('workspace_id', workspaceId)
    .eq('customer_id', customerId)
    .eq('channel', 'email')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);

  const latest = ((data ?? []) as ConsentSuppressionRow[])[0];
  return Boolean(latest && latest.decision === 'granted' && !isConsentEventSuppressed(latest));
}

interface OutboundDraftInspection {
  recipientEmail: string;
  companyLabel: string;
  allowed: boolean;
  basis: 'recorded_consent' | 'can_spam_b2b' | 'blocked';
  shouldAutoReject: boolean;
  reason: string;
}

async function inspectOutboundEmailDraft(
  supabase: SupabaseClient,
  draft: ApprovedDraftRow
): Promise<OutboundDraftInspection> {
  let recipientEmail = (draft.recipient_email ?? '').trim().toLowerCase();
  let companyLabel = (draft.company_name ?? '').trim();

  if ((!recipientEmail || !companyLabel) && draft.customer_id) {
    const { data: custData } = await supabase
      .from('customers')
      .select('id, email, first_name, last_name')
      .eq('workspace_id', draft.workspace_id)
      .eq('id', draft.customer_id)
      .maybeSingle();

    const cust = custData as CustomerEmailRow | null;
    if (cust) {
      if (!recipientEmail && cust.email) {
        recipientEmail = cust.email.trim().toLowerCase();
      }
      if (!companyLabel) {
        companyLabel = (cust.last_name ?? cust.first_name).trim();
      }
    }
  }

  if (!recipientEmail) {
    return {
      recipientEmail: '',
      companyLabel,
      allowed: false,
      basis: 'blocked',
      shouldAutoReject: false,
      reason: 'no recipient email on file',
    };
  }

  const suppressed = await isRecipientSuppressed(supabase, draft.workspace_id, recipientEmail, draft.customer_id);
  if (suppressed) {
    return {
      recipientEmail,
      companyLabel,
      allowed: false,
      basis: 'blocked',
      shouldAutoReject: true,
      reason: 'consent revocation / opt-out recorded',
    };
  }

  const granted = await hasGrantedEmailConsent(supabase, draft.workspace_id, draft.customer_id);
  if (granted) {
    return {
      recipientEmail,
      companyLabel,
      allowed: true,
      basis: 'recorded_consent',
      shouldAutoReject: false,
      reason: 'recorded email opt-in verified',
    };
  }

  if (isCanSpamFooterCompliant(draft.message)) {
    return {
      recipientEmail,
      companyLabel,
      allowed: true,
      basis: 'can_spam_b2b',
      shouldAutoReject: false,
      reason: 'CAN-SPAM B2B physical address + opt-out footer verified',
    };
  }

  return {
    recipientEmail,
    companyLabel,
    allowed: false,
    basis: 'blocked',
    shouldAutoReject: false,
    reason: `missing physical address (${CAN_SPAM_PHYSICAL_ADDRESS}) or opt-out/unsubscribe footer`,
  };
}

async function sendViaResend(params: {
  apiKey: string;
  fromEmail: string;
  replyTo: string;
  toEmail: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.fromEmail,
      reply_to: params.replyTo,
      to: [params.toEmail],
      subject: params.subject,
      text: params.text,
    }),
    signal: AbortSignal.timeout(12000),
  });

  const payload = (await response.json().catch(() => ({}))) as ResendSendResponse;
  if (!response.ok) {
    return {
      ok: false,
      error: payload.message ?? `Resend HTTP ${response.status}`,
    };
  }
  return { ok: true, providerId: payload.id };
}

async function sendViaSmtpConfig(params: {
  smtpHost: string;
  smtpUser: string;
  smtpPass: string;
  fromEmail: string;
  replyTo: string;
  toEmail: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  // Supports HTTPS-bridged SMTP relay endpoints or standard HTTPS mail gateway on SMTP_HOST
  const endpoint = /^https?:\/\//i.test(params.smtpHost)
    ? params.smtpHost
    : `https://${params.smtpHost}/send`;
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    return { ok: false, error: 'Invalid SMTP relay endpoint URL' };
  }
  const isLoopback = parsedEndpoint.hostname === 'localhost' || parsedEndpoint.hostname === '127.0.0.1';
  if (parsedEndpoint.protocol !== 'https:' && !isLoopback) {
    return {
      ok: false,
      error: 'Refusing cleartext HTTP SMTP relay with Basic credentials; configure an https:// SMTP gateway.',
    };
  }
  const authToken = Buffer.from(
    `${params.smtpUser}:${params.smtpPass}`,
    'utf8'
  ).toString('base64');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.fromEmail,
      reply_to: params.replyTo,
      to: params.toEmail,
      subject: params.subject,
      text: params.text,
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    return { ok: false, error: `SMTP relay returned HTTP ${response.status}` };
  }
  return { ok: true, providerId: `smtp-${Date.now()}` };
}

async function isLeadSequencePaused(
  supabase: SupabaseClient,
  workspaceId: string,
  leadId: string | null | undefined,
): Promise<boolean> {
  if (!leadId) return false;
  const { data } = await supabase
    .from('public_leads')
    .select('id, status, auto_paused_reason')
    .eq('workspace_id', workspaceId)
    .eq('id', leadId)
    .maybeSingle();

  const row = data as {
    id: string;
    status?: string | null;
    auto_paused_reason?: string | null;
  } | null;
  if (!row) return false;
  return Boolean(
    row.auto_paused_reason ||
      row.status === 'REPLIED' ||
      row.status === 'BOUNCED' ||
      row.status === 'UNSUBSCRIBED',
  );
}

async function sendApprovedDrafts(): Promise<void> {
  const isLive = process.argv.includes('--live') && !process.argv.includes('--dry-run');
  const isDryRun = !isLive;
  const todayIso = new Date().toISOString().slice(0, 10);
  const supabaseUrl = resolveSupabaseUrl();
  const serviceKeyCheck = resolveServiceRoleKey();

  if (!serviceKeyCheck.valid) {
    console.log(`ℹ️  ${serviceKeyCheck.reason} Exiting 0 cleanly.`);
    return;
  }

  const resendKey = (process.env.RESEND_API_KEY ?? '').trim();
  const smtpHost = (process.env.SMTP_HOST ?? '').trim();
  const smtpUser = (process.env.SMTP_USER ?? '').trim();
  const smtpPass = (process.env.SMTP_PASS ?? '').trim();
  const fallbackFromEmail =
    (process.env.OUTREACH_FROM_EMAIL ?? '').trim() ||
    'Justin Cooper <justin@looseendsos.app>';
  const rawReplyTo = (
    process.env.RESEND_REPLY_TO ??
    process.env.OUTREACH_REPLY_TO ??
    ''
  ).trim();
  const replyTo =
    rawReplyTo && !isPlaceholderValue(rawReplyTo)
      ? rawReplyTo
      : 'jhcoop010@gmail.com';
  const publicAppUrl =
    (process.env.PUBLIC_APP_URL ?? '').trim() || 'https://www.looseendsos.app';

  const hasResend = Boolean(resendKey) && !isPlaceholderValue(resendKey);
  const hasSmtp =
    Boolean(smtpHost) &&
    Boolean(smtpUser) &&
    Boolean(smtpPass) &&
    !isPlaceholderValue(smtpHost);

  if (!isDryRun && !hasResend && !hasSmtp) {
    console.log(
      'ℹ️  Neither RESEND_API_KEY nor SMTP_HOST/SMTP_USER/SMTP_PASS is configured. ' +
      'Approved drafts remain safely queued at delivery_status = not_sent.'
    );
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKeyCheck.key, {
    auth: { persistSession: false },
  });

  const { workspaceId, workspaceName } = await verifyDatabaseAndWorkspace(supabase);

  let inboxQuery = supabase
    .from('outbound_sender_inboxes')
    .select('*')
    .order('created_at', { ascending: true });
  if (workspaceId) {
    inboxQuery = inboxQuery.eq('workspace_id', workspaceId);
  }
  const { data: rawInboxes, error: inboxError } = await inboxQuery;
  if (inboxError) {
    throw new Error(`Failed to query outbound_sender_inboxes: ${inboxError.message}`);
  }

  let inboxPool: OutboundSenderInbox[] = [];
  for (const rawInbox of (rawInboxes ?? []) as OutboundSenderInbox[]) {
    const normalized = normalizeInboxForDate(rawInbox, todayIso);
    if (!isDryRun && rawInbox.last_reset_date !== todayIso) {
      await supabase
        .from('outbound_sender_inboxes')
        .update({
          sent_today: 0,
          last_reset_date: todayIso,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('id', rawInbox.id);
    }
    inboxPool.push(normalized);
  }

  const activeInboxes = inboxPool.filter((i) => i.status === 'active');
  const totalCapToday = activeInboxes.reduce((sum, i) => sum + effectiveDailyCap(i), 0);
  const totalSentToday = activeInboxes.reduce((sum, i) => sum + i.sent_today, 0);

  console.log(
    `🔗 Connected to ${supabaseUrl} | Mode: ${isDryRun ? 'DRY-RUN (pass --live to send)' : 'LIVE DISPATCH'} | Workspace: ${
      workspaceId ? `${workspaceId} (${workspaceName ?? 'verified'})` : '(all workspaces)'
    }`
  );
  console.log(
    `✉️  Sender Pool | Active Inboxes: ${activeInboxes.length}/${inboxPool.length} | Used Today: ${totalSentToday}/${totalCapToday} | Default From: ${fallbackFromEmail} | Reply-To: ${replyTo} | App URL: ${publicAppUrl} | Transport: ${
      hasResend ? 'Resend (configured)' : hasSmtp ? 'SMTP (configured)' : 'RESEND_API_KEY missing'
    }`
  );

  let query = supabase
    .from('ops_communication_drafts')
    .select('*')
    .eq('status', 'approved')
    .eq('delivery_status', 'not_sent')
    .eq('channel', 'email')
    .order('created_at', { ascending: true })
    .limit(50);

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data: drafts, error: fetchError } = await query;

  if (fetchError) {
    console.error('❌ Failed to query approved drafts:', fetchError.message);
    process.exit(1);
  }

  const typedDrafts = (drafts ?? []) as ApprovedDraftRow[];
  const nowMs = Date.now();
  let rrCursor = 0;

  if (isDryRun) {
    let pendingQuery = supabase
      .from('ops_communication_drafts')
      .select('*')
      .eq('status', 'draft')
      .eq('delivery_status', 'not_sent')
      .eq('channel', 'email')
      .order('created_at', { ascending: true })
      .limit(100);
    if (workspaceId) {
      pendingQuery = pendingQuery.eq('workspace_id', workspaceId);
    }
    const { data: pendingRows } = await pendingQuery;
    const pendingDrafts = (pendingRows ?? []) as ApprovedDraftRow[];
    let pendingReadyCount = 0;
    for (const pending of pendingDrafts) {
      const check = await inspectOutboundEmailDraft(supabase, pending);
      if (check.allowed && !pending.auto_paused_reason) pendingReadyCount += 1;
    }

    let readyCount = 0;
    let skippedCount = 0;
    let simulatedPool = [...inboxPool];

    for (const draft of typedDrafts) {
      if (draft.auto_paused_reason || (await isLeadSequencePaused(supabase, draft.workspace_id, draft.lead_id))) {
        skippedCount += 1;
        console.log(
          `⏸️  [DRY-RUN] Auto-paused draft ${draft.id} (${draft.subject}): sequence paused.`
        );
        continue;
      }
      if (draft.scheduled_after && Date.parse(draft.scheduled_after) > nowMs) {
        skippedCount += 1;
        console.log(
          `⏳ [DRY-RUN] Scheduled later (${draft.scheduled_after}) for draft ${draft.id}.`
        );
        continue;
      }
      const check = await inspectOutboundEmailDraft(supabase, draft);
      if (!check.allowed) {
        skippedCount += 1;
        console.log(
          `🛑 [DRY-RUN] Blocked draft ${draft.id} (${check.companyLabel || draft.subject}): ${check.reason}.`
        );
        continue;
      }

      const allocation = assignSenderInbox(simulatedPool, {
        startCursor: rrCursor,
        todayIso,
      });
      if (!allocation) {
        skippedCount += 1;
        console.log(
          `⏸️  [DRY-RUN] Inbox daily cap reached or no active inbox available for draft ${draft.id}.`
        );
        continue;
      }
      simulatedPool = allocation.updated_inboxes;
      rrCursor = allocation.next_cursor;

      readyCount += 1;
      console.log(
        `✅ [DRY-RUN] Ready step ${draft.sequence_step ?? 1} (${draft.outreach_lane ?? 'trades_clinics'}) draft ${draft.id} (${check.basis}) -> <${check.recipientEmail}> via ${allocation.inbox.from_email} [${allocation.next_sent_today}/${allocation.effective_cap}]`
      );
    }

    console.log(
      `\n🧪 DRY-RUN PREFLIGHT PASS | Approved Ready: ${readyCount} | Skipped/Capped: ${skippedCount} | Pending Approval: ${pendingDrafts.length} (${pendingReadyCount} CAN-SPAM/Consent ready) | Live Emails Sent: 0`
    );
    return;
  }

  if (typedDrafts.length === 0) {
    console.log('ℹ️  No approved unsent email drafts in queue.');
    return;
  }

  let sentCount = 0;
  let deferredCapCount = 0;

  for (const draft of typedDrafts) {
    if (draft.auto_paused_reason || (await isLeadSequencePaused(supabase, draft.workspace_id, draft.lead_id))) {
      await supabase
        .from('ops_communication_drafts')
        .update({
          status: 'rejected',
          auto_paused_reason: draft.auto_paused_reason ?? 'manual',
        })
        .eq('workspace_id', draft.workspace_id)
        .eq('id', draft.id);
      console.log(`⏸️  Skipping & cancelling auto-paused draft ${draft.id}.`);
      continue;
    }

    if (draft.scheduled_after && Date.parse(draft.scheduled_after) > nowMs) {
      continue;
    }

    const check = await inspectOutboundEmailDraft(supabase, draft);
    if (!check.allowed) {
      if (check.shouldAutoReject) {
        console.warn(
          `🛑 Consent revocation / opt-out detected for ${check.recipientEmail}. Rejecting draft ${draft.id}.`
        );
        await supabase
          .from('ops_communication_drafts')
          .update({
            status: 'rejected',
            auto_paused_reason: 'unsubscribed',
          })
          .eq('workspace_id', draft.workspace_id)
          .eq('id', draft.id);
      } else {
        console.warn(
          `⏭️  Blocking approved draft ${draft.id} (${check.companyLabel || draft.subject}): ${check.reason}.`
        );
      }
      continue;
    }

    const allocation = assignSenderInbox(inboxPool, {
      startCursor: rrCursor,
      todayIso,
    });
    if (!allocation) {
      deferredCapCount += 1;
      console.warn(
        `⏸️  All active sender inboxes paused or reached daily cap. Deferring remaining drafts safely.`
      );
      break;
    }

    const senderInbox = allocation.inbox;
    const senderHeader = `${senderInbox.from_name} <${senderInbox.from_email}>`;
    const recipientEmail = check.recipientEmail;
    const companyLabel = check.companyLabel;

    const sendResult = hasResend
      ? await sendViaResend({
          apiKey: resendKey,
          fromEmail: senderHeader,
          replyTo,
          toEmail: recipientEmail,
          subject: draft.subject,
          text: draft.message,
        })
      : await sendViaSmtpConfig({
          smtpHost,
          smtpUser,
          smtpPass,
          fromEmail: senderHeader,
          replyTo,
          toEmail: recipientEmail,
          subject: draft.subject,
          text: draft.message,
        });

    if (!sendResult.ok) {
      console.error(
        `❌ Failed to dispatch email to ${recipientEmail} (${companyLabel}): ${
          sendResult.error ?? 'unknown error'
        }`
      );
      continue;
    }

    inboxPool = allocation.updated_inboxes;
    rrCursor = allocation.next_cursor;
    const sentTimestamp = new Date().toISOString();

    const { error: inboxUpdateErr } = await supabase
      .from('outbound_sender_inboxes')
      .update({
        sent_today: allocation.next_sent_today,
        last_reset_date: todayIso,
        updated_at: sentTimestamp,
      })
      .eq('workspace_id', draft.workspace_id)
      .eq('id', senderInbox.id);

    if (inboxUpdateErr) {
      console.error(
        `⚠️  Sent via ${senderInbox.from_email}, but failed to increment sent_today: ${inboxUpdateErr.message}`
      );
    }

    // Update ops_communication_drafts to delivery_status = 'sent', sent_at = now(), assigned_sender_id
    const { error: updateDraftErr } = await supabase
      .from('ops_communication_drafts')
      .update({
        delivery_status: 'sent',
        sent_at: sentTimestamp,
        assigned_sender_id: senderInbox.id,
      })
      .eq('workspace_id', draft.workspace_id)
      .eq('id', draft.id);

    if (updateDraftErr) {
      console.error(
        `⚠️  Email sent to ${recipientEmail}, but could not update delivery_status: ${updateDraftErr.message}`
      );
    }

    // Update corresponding public_leads row to status = 'CONTACTED'
    if (draft.lead_id) {
      await supabase
        .from('public_leads')
        .update({
          status: 'CONTACTED',
          assigned_sender_id: senderInbox.id,
          sequence_step: draft.sequence_step ?? 1,
        })
        .eq('workspace_id', draft.workspace_id)
        .eq('id', draft.lead_id);
    } else if (companyLabel) {
      await supabase
        .from('public_leads')
        .update({ status: 'CONTACTED', assigned_sender_id: senderInbox.id })
        .eq('workspace_id', draft.workspace_id)
        .eq('business', companyLabel);
    }

    sentCount += 1;
    console.log(
      `🚀 Sent step ${draft.sequence_step ?? 1} outreach email via ${senderInbox.from_email} [${allocation.next_sent_today}/${allocation.effective_cap}] to ${companyLabel || recipientEmail} <${recipientEmail}> (provider ref: ${
        sendResult.providerId ?? 'ok'
      })`
    );
  }

  console.log(
    `\n✅ Dispatch run complete. ${sentCount} approved email(s) sent.${
      deferredCapCount > 0 ? ` Remaining drafts deferred due to daily inbox cap.` : ''
    }`
  );
}

sendApprovedDrafts().catch((err: unknown) => {
  console.error('Fatal error in sendApprovedDrafts:', err);
  process.exit(1);
});
