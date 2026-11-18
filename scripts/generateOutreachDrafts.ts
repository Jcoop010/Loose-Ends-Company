/// <reference path="./node-ambient.d.ts" />
// scripts/generateOutreachDrafts.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  AUTHORITATIVE_APP_URL,
  isPlaceholderValue,
  resolveServiceRoleKey,
  resolveSupabaseUrl,
  verifyDatabaseAndWorkspace,
} from './envValidation';

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

// Tailors the operational hook to any small business category
function buildUniversalHook(industryRaw: string, notes: string): string {
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

async function isEmailSuppressed(
  supabase: SupabaseClient,
  email: string
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  const { data: directEvents } = await supabase
    .from('customer_contact_consent_events')
    .select('id, email, status, decision')
    .eq('email', normalizedEmail);

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

  const { data: matchingCustomers } = await supabase
    .from('customers')
    .select('id')
    .ilike('email', normalizedEmail);

  const customerIds = ((matchingCustomers ?? []) as CustomerRow[]).map(
    (c) => c.id
  );
  if (customerIds.length === 0) {
    return false;
  }

  const { data: customerEvents } = await supabase
    .from('customer_contact_consent_events')
    .select('id, status, decision')
    .in('customer_id', customerIds);

  const typedCustomerEvents = (customerEvents ?? []) as ConsentSuppressionRow[];
  return typedCustomerEvents.some(
    (evt) =>
      evt.status === 'opted_out' ||
      evt.status === 'revoked' ||
      evt.decision === 'revoked'
  );
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

async function generateDailyOutreachDrafts(): Promise<void> {
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

  console.log(
    `🔗 Connected to ${supabaseUrl} | Workspace: ${verifiedWorkspaceId} (${
      workspaceName ?? 'verified'
    })`
  );

  const { data: leads, error: fetchError } = await supabase
    .from('public_leads')
    .select('*')
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

  const rawAppUrl = (process.env.PUBLIC_APP_URL ?? '').trim();
  const publicAppUrl =
    rawAppUrl && !isPlaceholderValue(rawAppUrl)
      ? rawAppUrl.replace(/\/+$/, '')
      : AUTHORITATIVE_APP_URL;

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

    // 1. Respect opt-out / consent rules before drafting
    if (contactEmail) {
      const suppressed = await isEmailSuppressed(supabase, contactEmail);
      if (suppressed) {
        console.log(`⏭️ Skipping ${companyName} (opt-out on file)`);
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

    const hook = buildUniversalHook(industry, lead.notes ?? '');
    const subject = `Quick question for ${companyName}`;
    const body = `Hi ${contactName},

I came across ${companyName}${lead.location ? ` in ${lead.location}` : ''} and noticed your team is growing in the ${industry} space.

Many ${industry} owners we speak with mention that ${hook} takes up too much manual admin time every week.

We built Loose Ends as a lightweight Operations OS for small businesses—combining pipeline quotes, scheduling, inventory & purchase orders, and automated revenue-leak checks in one workspace (with human approval gates before anything is sent or billed).

Would you be open to a 5-minute interactive look at how it works for a ${industry} business? You can also click through the live sandbox anytime here:
${publicAppUrl}/demo

Best regards,
${process.env.SENDER_NAME ?? 'Loose Ends Operations Team'}`;

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
        subject,
        message: body,
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
    console.log(`📝 Draft queued for owner review: ${companyName}`);
  }

  console.log(
    `\n✅ Outreach draft generation complete. ${generatedCount} draft(s) queued in ops_communication_drafts.`
  );
}

generateDailyOutreachDrafts().catch((err: unknown) => {
  console.error('Fatal error in generateOutreachDrafts:', err);
  process.exit(1);
});
