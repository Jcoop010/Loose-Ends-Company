/// <reference path="./node-ambient.d.ts" />
// scripts/generateOutreachDrafts.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  callOllamaStructured,
  checkOllamaHealth,
  normalizeOllamaBaseUrl,
  type JsonSchemaObject,
} from './lib/ollamaClient';

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
const AUTHORITATIVE_APP_URL = 'https://loose-ends-os.vercel.app';
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'gemma4:e2b';

const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /your-project-ref/i,
  /your-service-role-key/i,
  /your-anon-publishable-key/i,
  /your-workspace-id/i,
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  supabase: SupabaseClient,
  requireWorkspace: boolean
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
  if (requireWorkspace && typedWorkspaces.length === 0) {
    throw new Error('No rows found in public.workspaces.');
  }
  if (requireWorkspace && typedWorkspaces.length > 1) {
    const summary = typedWorkspaces.map((w) => `${w.id} (${w.name})`).join(', ');
    throw new Error(`Multiple workspaces found in public.workspaces: ${summary}. Set DEFAULT_WORKSPACE_ID explicitly.`);
  }
  return { workspaceId: null, workspaceName: null };
}

interface PublicLeadRow {
  id: string;
  workspace_id: string | null;
  business: string | null;
  company_name?: string | null;
  industry: string | null;
  business_type?: string | null;
  location: string | null;
  contact_name: string | null;
  name?: string | null;
  contact_email: string | null;
  email?: string | null;
  phone?: string | null;
  website: string | null;
  notes: string | null;
  status: string;
}

interface ConsentSuppressionRow {
  id: string;
  email?: string | null;
  status?: string | null;
  decision?: string | null;
}

interface CustomerRow {
  id: string;
}

export interface OutreachDraftInput {
  companyName: string;
  contactName: string;
  industry: string;
  location: string;
  website: string;
  notes: string;
  publicAppUrl: string;
  senderName: string;
}

export interface PersonalizedOutreachOutput {
  subject: string;
  body: string;
  detected_angle: string;
}

export interface LocalOllamaProviderStatus {
  enabled: boolean;
  baseUrl: string;
  model: string;
  modeLabel: string;
  reason?: string;
}

export interface GeneratedOutreachDraft {
  subject: string;
  body: string;
  detectedAngle: string;
  provider: string;
}

export const LOCAL_OUTREACH_SCHEMA: JsonSchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'body', 'detected_angle'],
  properties: {
    subject: {
      type: 'string',
      description: 'Short, natural plain-text email subject line without hype or spam.',
    },
    body: {
      type: 'string',
      description:
        'Concise plain-English founder-to-founder email under 110 words referencing the demo link.',
    },
    detected_angle: {
      type: 'string',
      description: 'Primary operational bottleneck angle detected for this business.',
    },
  },
};

// Tailors the operational hook to any small business category
export function buildUniversalHook(industryRaw: string, notes: string): string {
  const industry = industryRaw.toLowerCase();

  if (industry.includes('retail') || industry.includes('e-commerce')) {
    return 'keeping stock counts, supplier purchase orders, and unfulfilled customer orders in sync without spreadsheet drift';
  }
  if (
    industry.includes('dental') ||
    industry.includes('clinic') ||
    industry.includes('wellness') ||
    industry.includes('medical') ||
    industry.includes('biomedical')
  ) {
    return 'reducing unconfirmed appointments, missed follow-up care, and unpaid patient balances';
  }
  if (
    industry.includes('agency') ||
    industry.includes('creative') ||
    industry.includes('marketing') ||
    industry.includes('cfo') ||
    industry.includes('accounting')
  ) {
    return 'preventing approved client proposals and scope add-ons from sitting unbilled at month-end';
  }
  if (
    industry.includes('auto') ||
    industry.includes('repair') ||
    industry.includes('detailing') ||
    industry.includes('fleet') ||
    industry.includes('hydraulics')
  ) {
    return 'linking parts inventory directly to work orders so completed jobs never leave the bay unbilled';
  }
  if (
    industry.includes('food') ||
    industry.includes('catering') ||
    industry.includes('restaurant') ||
    industry.includes('kitchen')
  ) {
    return 'tracking event quotes, ingredient reorders, and deposit collection in one clean workflow';
  }
  if (notes.includes('inventory_stockouts')) {
    return 'preventing low-stock surprises and unapproved supplier reorders';
  }
  if (notes.includes('stale_quotes')) {
    return 'turning open estimates and proposals into confirmed bookings before leads go cold';
  }
  return 'catching unbilled work, open quotes, and overdue invoices in a single daily view';
}

export function normalizePublicAppUrl(rawAppUrl: string | undefined): string {
  const trimmed = (rawAppUrl ?? '').trim();
  if (trimmed && !isPlaceholderValue(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }
  return AUTHORITATIVE_APP_URL;
}

export function validatePersonalizedOutreach(
  raw: unknown,
  publicAppUrl: string
): PersonalizedOutreachOutput | null {
  if (!isPlainRecord(raw)) {
    return null;
  }
  const subject = typeof raw.subject === 'string' ? raw.subject.trim() : '';
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  const detectedAngle =
    typeof raw.detected_angle === 'string' ? raw.detected_angle.trim() : '';

  if (!subject || !body || !detectedAngle) {
    return null;
  }

  const demoUrl = `${normalizePublicAppUrl(publicAppUrl)}/demo`;
  if (!body.includes(demoUrl)) {
    return null;
  }

  return {
    subject,
    body,
    detected_angle: detectedAngle,
  };
}

export function buildDeterministicOutreachDraft(
  params: OutreachDraftInput
): { subject: string; body: string; detectedAngle: string } {
  const hook = buildUniversalHook(params.industry, params.notes);
  const demoUrl = `${normalizePublicAppUrl(params.publicAppUrl)}/demo`;
  const subject = `Quick question for ${params.companyName}`;
  const body = `Hi ${params.contactName},

I came across ${params.companyName}${params.location ? ` in ${params.location}` : ''} and noticed your team is growing in the ${params.industry} space.

Many ${params.industry} owners we speak with mention that ${hook} takes up too much manual admin time every week.

We built Loose Ends as a lightweight Operations OS for small businesses—combining pipeline quotes, scheduling, inventory & purchase orders, and automated revenue-leak checks in one workspace (with human approval gates before anything is sent or billed).

Would you be open to a 5-minute interactive look at how it works for a ${params.industry} business? You can also click through the live sandbox anytime here:
${demoUrl}

Best regards,
${params.senderName}`;

  return {
    subject,
    body,
    detectedAngle: hook,
  };
}

export async function resolveLocalOllamaOutreachProvider(
  env: Record<string, string | undefined> = process.env
): Promise<LocalOllamaProviderStatus> {
  const baseUrl = normalizeOllamaBaseUrl(
    (env.OLLAMA_BASE_URL ?? '').trim() || DEFAULT_OLLAMA_BASE_URL
  );
  const model = (env.OLLAMA_MODEL ?? '').trim() || DEFAULT_OLLAMA_MODEL;

  if ((env.CI ?? '').trim().toLowerCase() === 'true') {
    return {
      enabled: false,
      baseUrl,
      model,
      modeLabel: 'deterministic-fallback',
      reason: 'ci_environment',
    };
  }

  if ((env.OLLAMA_DISABLED ?? '').trim().toLowerCase() === 'true') {
    return {
      enabled: false,
      baseUrl,
      model,
      modeLabel: 'deterministic-fallback',
      reason: 'ollama_disabled',
    };
  }

  const health = await checkOllamaHealth(baseUrl, model, 2000);
  if (health.available && health.hasModel) {
    return {
      enabled: true,
      baseUrl,
      model,
      modeLabel: `local-ollama:${model}`,
    };
  }

  return {
    enabled: false,
    baseUrl,
    model,
    modeLabel: 'deterministic-fallback',
    reason: health.reason ?? 'ollama_unavailable',
  };
}

async function generateLocalOllamaOutreach(
  params: OutreachDraftInput,
  config: { baseUrl: string; model: string; timeoutMs?: number }
): Promise<PersonalizedOutreachOutput | null> {
  const normalizedUrl = normalizePublicAppUrl(params.publicAppUrl);
  const demoUrl = `${normalizedUrl}/demo`;

  return callOllamaStructured<PersonalizedOutreachOutput>(
    {
      baseUrl: config.baseUrl,
      model: config.model,
      temperature: 0.2,
      timeoutMs: config.timeoutMs ?? 45000,
      think: false,
      schema: LOCAL_OUTREACH_SCHEMA,
      messages: [
        {
          role: 'system',
          content:
            'You write concise, plain-English founder-to-founder emails (strictly under 110 words) for Loose Ends Operations OS. Never invent dollar amounts, ROI percentages, fake metrics, or spammy formatting (no ALL CAPS, no excessive exclamation marks). You MUST include the exact demo URL verbatim in the email body: ' +
            demoUrl +
            '. Sign off warmly as ' +
            params.senderName +
            '. Respond strictly as JSON matching the schema.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            business: params.companyName,
            contact_name: params.contactName,
            vertical: params.industry,
            city_state: params.location,
            website: params.website,
            crawled_notes: params.notes,
            required_demo_url: demoUrl,
            sender_name: params.senderName,
          }),
        },
      ],
    },
    (raw: unknown) => validatePersonalizedOutreach(raw, normalizedUrl)
  );
}

// Fail-closed suppression lookup
async function isEmailSuppressed(
  supabase: SupabaseClient,
  email: string
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  try {
    const { data: directEvents, error: directError } = await supabase
      .from('customer_contact_consent_events')
      .select('id, email, status, decision')
      .eq('email', normalizedEmail);

    if (directError) {
      return true;
    }

    const typedDirectEvents = (directEvents ?? []) as ConsentSuppressionRow[];
    const hasDirectSuppression = typedDirectEvents.some(
      (evt) =>
        evt.status === 'opted_out' ||
        evt.status === 'revoked' ||
        evt.decision === 'revoked'
    );
    if (hasDirectSuppression) {
      return true;
    }

    const { data: matchingCustomers, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .ilike('email', normalizedEmail);

    if (customerError) {
      return true;
    }

    const customerIds = ((matchingCustomers ?? []) as CustomerRow[]).map(
      (c) => c.id
    );
    if (customerIds.length === 0) {
      return false;
    }

    const { data: customerEvents, error: customerEventError } = await supabase
      .from('customer_contact_consent_events')
      .select('id, status, decision')
      .in('customer_id', customerIds);

    if (customerEventError) {
      return true;
    }

    const typedCustomerEvents = (customerEvents ?? []) as ConsentSuppressionRow[];
    return typedCustomerEvents.some(
      (evt) =>
        evt.status === 'opted_out' ||
        evt.status === 'revoked' ||
        evt.decision === 'revoked'
    );
  } catch {
    return true;
  }
}

async function resolveOrCreateCustomerForProspect(params: {
  supabase: SupabaseClient;
  workspaceId: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  phone: string;
  website: string;
  notes: string;
}): Promise<string> {
  const {
    supabase,
    workspaceId,
    companyName,
    contactName,
    contactEmail,
    phone,
    website,
    notes,
  } = params;

  if (contactEmail) {
    const { data: existingByEmail } = await supabase
      .from('customers')
      .select('id')
      .eq('workspace_id', workspaceId)
      .ilike('email', contactEmail.trim().toLowerCase())
      .limit(1)
      .maybeSingle();

    const emailRow = existingByEmail as CustomerRow | null;
    if (emailRow?.id) {
      return emailRow.id;
    }
  }

  const { data: existingByCompany } = await supabase
    .from('customers')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('last_name', companyName)
    .limit(1)
    .maybeSingle();

  const existingRow = existingByCompany as CustomerRow | null;
  if (existingRow?.id) {
    return existingRow.id;
  }

  const combinedNotes = [
    website ? `Website: ${website}` : '',
    notes,
  ]
    .filter(Boolean)
    .join(' | ');

  const { data: created, error: createError } = await supabase
    .from('customers')
    .insert({
      workspace_id: workspaceId,
      first_name: contactName.slice(0, 100) || 'Owner / Operations',
      last_name: companyName.slice(0, 100),
      email: contactEmail || null,
      phone: phone || null,
      notes: combinedNotes || null,
    })
    .select('id')
    .single();

  if (createError || !created) {
    throw new Error(
      `Failed to create workspace customer record for "${companyName}": ${
        createError?.message ?? 'unknown error'
      }`
    );
  }

  return (created as CustomerRow).id;
}

interface XaiResponsesPayload {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}

async function generateGrokPersonalizedOutreach(
  params: OutreachDraftInput
): Promise<PersonalizedOutreachOutput | null> {
  const xaiKey = (process.env.XAI_API_KEY ?? '').trim();
  if (!xaiKey || isPlaceholderValue(xaiKey)) {
    return null;
  }
  const xaiModel = (process.env.XAI_MODEL ?? 'grok-4.7').trim() || 'grok-4.7';
  const normalizedUrl = normalizePublicAppUrl(params.publicAppUrl);

  try {
    const response = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${xaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: xaiModel,
        input: [
          {
            role: 'system',
            content:
              'You are the Loose Ends Founder-to-Founder Outreach Bot. Write a concise, natural, non-pushy founder-to-founder email to a small business owner. Focus on their industry operational bottleneck (unbilled field work, stale quotes, stockouts, or overdue invoices). Include the interactive demo link (' +
              normalizedUrl +
              '/demo) and sign off from ' +
              params.senderName +
              '.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              company_name: params.companyName,
              contact_name: params.contactName,
              industry: params.industry,
              location: params.location,
              website: params.website,
              operational_notes: params.notes,
              demo_url: `${normalizedUrl}/demo`,
            }),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'grok_outreach_email',
            strict: true,
            schema: LOCAL_OUTREACH_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as XaiResponsesPayload;
    let rawJson = payload.output_text?.trim() ?? '';
    if (!rawJson) {
      for (const item of payload.output ?? []) {
        for (const part of item.content ?? []) {
          if (part.text?.trim()) {
            rawJson = part.text.trim();
            break;
          }
        }
      }
    }
    if (!rawJson) {
      return null;
    }

    const parsed: unknown = JSON.parse(rawJson);
    return validatePersonalizedOutreach(parsed, normalizedUrl);
  } catch {
    return null;
  }
}

export async function generateOutreachDraftText(
  params: OutreachDraftInput,
  options: {
    localOllama: Pick<LocalOllamaProviderStatus, 'enabled' | 'baseUrl' | 'model'>;
    allowXaiFallback?: boolean;
    timeoutMs?: number;
  }
): Promise<GeneratedOutreachDraft> {
  if (options.localOllama.enabled) {
    const localDraft = await generateLocalOllamaOutreach(params, {
      baseUrl: options.localOllama.baseUrl,
      model: options.localOllama.model,
      timeoutMs: options.timeoutMs,
    });
    if (localDraft) {
      return {
        subject: localDraft.subject,
        body: localDraft.body,
        detectedAngle: localDraft.detected_angle,
        provider: `local-ollama:${options.localOllama.model}`,
      };
    }
    const deterministic = buildDeterministicOutreachDraft(params);
    return {
      ...deterministic,
      provider: 'deterministic-fallback',
    };
  }

  if (options.allowXaiFallback !== false) {
    const grokDraft = await generateGrokPersonalizedOutreach(params);
    if (grokDraft) {
      return {
        subject: grokDraft.subject,
        body: grokDraft.body,
        detectedAngle: grokDraft.detected_angle,
        provider: 'xai-fallback',
      };
    }
  }

  const deterministic = buildDeterministicOutreachDraft(params);
  return {
    ...deterministic,
    provider: 'deterministic-fallback',
  };
}

export async function generateDailyOutreachDrafts(): Promise<void> {
  const supabaseUrl = resolveSupabaseUrl();
  const serviceKeyCheck = resolveServiceRoleKey();

  if (!serviceKeyCheck.valid) {
    console.error(`❌ Cannot generate outreach drafts: ${serviceKeyCheck.reason}`);
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKeyCheck.key, {
    auth: { persistSession: false },
  });

  // Verify database connection and target workspace before querying/mutating
  const { workspaceId: verifiedWorkspaceId, workspaceName } =
    await verifyDatabaseAndWorkspace(supabase, true);

  if (!verifiedWorkspaceId) {
    console.error(
      '❌ No target workspace resolved. Set DEFAULT_WORKSPACE_ID to a valid workspace UUID.'
    );
    process.exit(1);
  }

  const localProvider = await resolveLocalOllamaOutreachProvider(process.env);
  console.log(
    `🔗 Connected to ${supabaseUrl} | Workspace: ${verifiedWorkspaceId} (${
      workspaceName ?? 'verified'
    }) | Draft provider: ${localProvider.modeLabel}${
      localProvider.reason ? ` (${localProvider.reason})` : ''
    }`
  );

  const { data: leads, error: fetchError } = await supabase
    .from('public_leads')
    .select('*')
    .or(`workspace_id.eq.${verifiedWorkspaceId},workspace_id.is.null`)
    .eq('status', 'DRAFT_READY')
    .order('score', { ascending: false })
    .limit(25);

  if (fetchError || !leads) {
    console.error('❌ Failed to fetch DRAFT_READY leads:', fetchError?.message);
    process.exit(1);
  }

  const typedLeads = leads as PublicLeadRow[];
  if (typedLeads.length === 0) {
    console.log('ℹ️ No leads at status DRAFT_READY to process.');
    return;
  }

  const publicAppUrl = normalizePublicAppUrl(process.env.PUBLIC_APP_URL);
  const senderName =
    (process.env.SENDER_NAME ?? '').trim() || 'Loose Ends Operations Team';

  let generatedCount = 0;

  for (const lead of typedLeads) {
    const companyName = (lead.company_name ?? lead.business ?? 'Your Team').trim();
    const contactName = (lead.contact_name ?? lead.name ?? 'there').trim();
    const contactEmail = (lead.contact_email ?? lead.email ?? '').trim();
    const phone = (lead.phone ?? '').trim();
    const website = (lead.website ?? '').trim();
    const industry = (
      lead.industry ??
      lead.business_type ??
      'Small Business Operations'
    ).trim();
    const workspaceId = lead.workspace_id ?? verifiedWorkspaceId;

    // 1. Respect opt-out / consent rules before drafting (fail closed)
    if (contactEmail) {
      const suppressed = await isEmailSuppressed(supabase, contactEmail);
      if (suppressed) {
        console.log(`⏭️ Skipping ${companyName} (opt-out or consent check blocked)`);
        continue;
      }
    }

    // 2. Ensure a linked customer record exists in the target workspace so the
    //    draft renders cleanly in /dashboard/pipeline (Consent & Drafts + Customer 360)
    const customerId = await resolveOrCreateCustomerForProspect({
      supabase,
      workspaceId,
      companyName,
      contactName,
      contactEmail,
      phone,
      website,
      notes: lead.notes ?? '',
    });

    const draftResult = await generateOutreachDraftText(
      {
        companyName,
        contactName,
        industry,
        location: lead.location ?? '',
        website,
        notes: lead.notes ?? '',
        publicAppUrl,
        senderName,
      },
      {
        localOllama: localProvider,
      }
    );

    // 3. Insert into ops_communication_drafts as NOT_SENT (Owner Approval Gate)
    const { error: draftError } = await supabase
      .from('ops_communication_drafts')
      .insert({
        workspace_id: workspaceId,
        customer_id: customerId,
        lead_id: lead.id,
        channel: 'email',
        recipient_email: contactEmail || null,
        recipient_name: contactName,
        company_name: companyName,
        subject: draftResult.subject,
        message: draftResult.body,
        status: 'draft',
        delivery_status: 'not_sent',
        requires_approval: true,
        created_at: new Date().toISOString(),
      });

    if (draftError) {
      console.error(
        `❌ Could not create draft for ${companyName}:`,
        draftError.message
      );
      continue;
    }

    // 4. Mark lead as DRAFT_GENERATED and link workspace_id so we don't duplicate
    const { error: updateError } = await supabase
      .from('public_leads')
      .update({
        status: 'DRAFT_GENERATED',
        workspace_id: workspaceId,
      })
      .eq('id', lead.id);

    if (updateError) {
      console.error(
        `❌ Could not update status for ${companyName}:`,
        updateError.message
      );
      continue;
    }

    generatedCount += 1;
    console.log(
      `📝 Draft queued for owner review (${draftResult.provider}): ${companyName}`
    );
  }

  console.log(
    `\n✅ Outreach draft generation complete. ${generatedCount} draft(s) queued in ops_communication_drafts.`
  );
}

const invokedScript = (process.argv[1] ?? '').replace(/\\/g, '/');
if (
  invokedScript.endsWith('/scripts/generateOutreachDrafts.ts') ||
  invokedScript === 'scripts/generateOutreachDrafts.ts'
) {
  generateDailyOutreachDrafts().catch((err: unknown) => {
    console.error('Fatal error in generateOutreachDrafts:', err);
    process.exit(1);
  });
}
