/// <reference path="./node-ambient.d.ts" />
// scripts/generateOutreachDrafts.ts
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

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

// Tailors the operational hook to any small business category
function buildUniversalHook(industryRaw: string, notes: string): string {
  const industry = industryRaw.toLowerCase();

  if (industry.includes('retail') || industry.includes('e-commerce')) {
    return 'keeping stock counts, supplier purchase orders, and unfulfilled customer orders in sync without spreadsheet drift';
  }
  if (industry.includes('dental') || industry.includes('clinic') || industry.includes('wellness') || industry.includes('medical') || industry.includes('biomedical')) {
    return 'reducing unconfirmed appointments, missed follow-up care, and unpaid patient balances';
  }
  if (industry.includes('agency') || industry.includes('creative') || industry.includes('marketing') || industry.includes('cfo') || industry.includes('accounting')) {
    return 'preventing approved client proposals and scope add-ons from sitting unbilled at month-end';
  }
  if (industry.includes('auto') || industry.includes('repair') || industry.includes('detailing') || industry.includes('fleet') || industry.includes('hydraulics')) {
    return 'linking parts inventory directly to work orders so completed jobs never leave the bay unbilled';
  }
  if (industry.includes('food') || industry.includes('catering') || industry.includes('restaurant') || industry.includes('kitchen')) {
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

async function isEmailSuppressed(email: string): Promise<boolean> {
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

  const customerIds = (matchingCustomers ?? []).map(
    (c: { id: string }) => c.id
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

async function generateDailyOutreachDrafts(): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      '❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.'
    );
    process.exit(1);
  }

  const { data: leads, error: fetchError } = await supabase
    .from('public_leads')
    .select('*')
    .eq('status', 'DRAFT_READY')
    .limit(25);

  if (fetchError || !leads) {
    console.error('❌ Failed to fetch DRAFT_READY leads:', fetchError?.message);
    return;
  }

  const typedLeads = leads as PublicLeadRow[];

  for (const lead of typedLeads) {
    const companyName = (lead.company_name ?? lead.business ?? 'Your Team').trim();
    const contactName = (lead.contact_name ?? lead.name ?? 'there').trim();
    const contactEmail = (lead.contact_email ?? lead.email ?? '').trim();
    const industry = (lead.industry ?? lead.business_type ?? 'Small Business Operations').trim();
    const workspaceId = lead.workspace_id ?? process.env.DEFAULT_WORKSPACE_ID ?? null;

    // 1. Respect opt-out / consent rules before drafting
    if (contactEmail) {
      const suppressed = await isEmailSuppressed(contactEmail);
      if (suppressed) {
        console.log(`⏭️ Skipping ${companyName} (opt-out on file)`);
        continue;
      }
    }

    const hook = buildUniversalHook(industry, lead.notes ?? '');
    const subject = `Quick question for ${companyName}`;
    const body = `Hi ${contactName},

I came across ${companyName}${lead.location ? ` in ${lead.location}` : ''} and noticed your team is growing in the ${industry} space.

Many ${industry} owners we speak with mention that ${hook} takes up too much manual admin time every week.

We built Loose Ends as a lightweight Operations OS for small businesses—combining pipeline quotes, scheduling, inventory & purchase orders, and automated revenue-leak checks in one workspace (with human approval gates before anything is sent or billed).

Would you be open to a 5-minute interactive look at how it works for a ${industry} business? You can also click through the live sandbox anytime here:
${process.env.PUBLIC_APP_URL ?? 'https://loose-ends-co.vercel.app'}/demo

Best regards,
${process.env.SENDER_NAME ?? 'Loose Ends Operations Team'}`;

    // 2. Insert into ops_communication_drafts as NOT_SENT (Owner Approval Gate)
    const { error: draftError } = await supabase.from('ops_communication_drafts').insert({
      workspace_id: workspaceId,
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
      console.error(`❌ Could not create draft for ${companyName}:`, draftError.message);
      continue;
    }

    // 3. Mark lead as DRAFT_GENERATED so we don't duplicate tomorrow
    const { error: updateError } = await supabase
      .from('public_leads')
      .update({ status: 'DRAFT_GENERATED' })
      .eq('id', lead.id);

    if (updateError) {
      console.error(`❌ Could not update status for ${companyName}:`, updateError.message);
      continue;
    }

    console.log(`📝 Draft queued for owner review: ${companyName}`);
  }
}

generateDailyOutreachDrafts().catch((err: unknown) => {
  console.error('Fatal error in generateOutreachDrafts:', err);
  process.exit(1);
});
