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

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

try {
  process.loadEnvFile?.('.env.local');
} catch {
  // .env.local not present
}
try {
  process.loadEnvFile?.('.env');
} catch {
  // .env not present
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
): Promise<{ workspaceId: string | null; workspaceName: string | null }> {
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
  return { workspaceId: null, workspaceName: null };
}

interface ApprovedDraftRow {
  id:              string;
  workspace_id:    string;
  customer_id:     string | null;
  lead_id?:        string | null;
  channel:         string;
  recipient_email?: string | null;
  recipient_name?: string | null;
  company_name?:   string | null;
  subject:         string;
  message:         string;
  status:          string;
  delivery_status: string;
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
  email: string,
  customerId: string | null
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();

  if (normalizedEmail) {
    const { data: directEvents } = await supabase
      .from('customer_contact_consent_events')
      .select('id, email, status, decision')
      .eq('email', normalizedEmail);

    const typedDirect = (directEvents ?? []) as ConsentSuppressionRow[];
    if (
      typedDirect.some(
        (evt) =>
          evt.status === 'opted_out' ||
          evt.status === 'revoked' ||
          evt.decision === 'revoked'
      )
    ) {
      return true;
    }
  }

  if (customerId) {
    const { data: custEvents } = await supabase
      .from('customer_contact_consent_events')
      .select('id, status, decision')
      .eq('customer_id', customerId)
      .eq('channel', 'email')
      .order('created_at', { ascending: false })
      .limit(1);

    const latestCust = ((custEvents ?? []) as ConsentSuppressionRow[])[0];
    if (
      latestCust &&
      (latestCust.status === 'opted_out' ||
        latestCust.status === 'revoked' ||
        latestCust.decision === 'revoked')
    ) {
      return true;
    }
  }

  return false;
}

async function sendViaResend(params: {
  apiKey: string;
  fromEmail: string;
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
  toEmail: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; providerId?: string; error?: string }> {
  // Supports HTTP-bridged SMTP relay endpoints or standard HTTPS mail gateway on SMTP_HOST
  const endpoint = /^https?:\/\//i.test(params.smtpHost)
    ? params.smtpHost
    : `https://${params.smtpHost}/send`;
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

async function sendApprovedDrafts(): Promise<void> {
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
  const fromEmail =
    (process.env.OUTREACH_FROM_EMAIL ?? '').trim() ||
    'Loose Ends Operations <operations@looseendsos.app>';

  const hasResend = Boolean(resendKey) && !isPlaceholderValue(resendKey);
  const hasSmtp =
    Boolean(smtpHost) &&
    Boolean(smtpUser) &&
    Boolean(smtpPass) &&
    !isPlaceholderValue(smtpHost);

  if (!hasResend && !hasSmtp) {
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

  console.log(
    `🔗 Connected to ${supabaseUrl} | Workspace: ${
      workspaceId ? `${workspaceId} (${workspaceName ?? 'verified'})` : '(all workspaces)'
    }`
  );

  let query = supabase
    .from('ops_communication_drafts')
    .select('*')
    .eq('status', 'approved')
    .eq('delivery_status', 'not_sent')
    .eq('channel', 'email')
    .order('created_at', { ascending: true })
    .limit(25);

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data: drafts, error: fetchError } = await query;

  if (fetchError) {
    console.error('❌ Failed to query approved drafts:', fetchError.message);
    process.exit(1);
  }

  const typedDrafts = (drafts ?? []) as ApprovedDraftRow[];
  if (typedDrafts.length === 0) {
    console.log('ℹ️  No approved unsent email drafts in queue.');
    return;
  }

  let sentCount = 0;

  for (const draft of typedDrafts) {
    let recipientEmail = (draft.recipient_email ?? '').trim().toLowerCase();
    let companyLabel = (draft.company_name ?? '').trim();

    if ((!recipientEmail || !companyLabel) && draft.customer_id) {
      const { data: custData } = await supabase
        .from('customers')
        .select('id, email, first_name, last_name')
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
      console.warn(
        `⏭️  Skipping approved draft ${draft.id} (${companyLabel || draft.subject}): no recipient email on file.`
      );
      continue;
    }

    // Re-verify consent events before sending
    const suppressed = await isRecipientSuppressed(
      supabase,
      recipientEmail,
      draft.customer_id
    );
    if (suppressed) {
      console.warn(
        `🛑 Consent revocation / opt-out detected for ${recipientEmail}. Rejecting draft ${draft.id}.`
      );
      await supabase
        .from('ops_communication_drafts')
        .update({ status: 'rejected' })
        .eq('id', draft.id);
      continue;
    }

    const sendResult = hasResend
      ? await sendViaResend({
          apiKey: resendKey,
          fromEmail,
          toEmail: recipientEmail,
          subject: draft.subject,
          text: draft.message,
        })
      : await sendViaSmtpConfig({
          smtpHost,
          smtpUser,
          smtpPass,
          fromEmail,
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

    const sentTimestamp = new Date().toISOString();

    // Update ops_communication_drafts to delivery_status = 'sent', sent_at = now()
    const { error: updateDraftErr } = await supabase
      .from('ops_communication_drafts')
      .update({
        delivery_status: 'sent',
        sent_at: sentTimestamp,
      })
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
        .update({ status: 'CONTACTED' })
        .eq('id', draft.lead_id);
    } else if (companyLabel) {
      await supabase
        .from('public_leads')
        .update({ status: 'CONTACTED' })
        .eq('business', companyLabel);
    }

    sentCount += 1;
    console.log(
      `🚀 Sent approved outreach email to ${companyLabel || recipientEmail} <${recipientEmail}> (provider ref: ${
        sendResult.providerId ?? 'ok'
      })`
    );
  }

  console.log(`\n✅ Dispatch run complete. ${sentCount} approved email(s) sent.`);
}

sendApprovedDrafts().catch((err: unknown) => {
  console.error('Fatal error in sendApprovedDrafts:', err);
  process.exit(1);
});
