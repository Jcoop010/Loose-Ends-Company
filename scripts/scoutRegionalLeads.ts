/// <reference path="./node-ambient.d.ts" />
/**
 * scripts/scoutRegionalLeads.ts
 *
 * Automated Regional Lead Scout & Day-1 Draft Stager for Loose Ends OS.
 *
 * Regions supported (`--region`):
 *   columbus_oh | pittsburgh_pa | charleston_wv | morgantown_wv | roanoke_va
 *
 * Lanes supported (`--lane`):
 *   trades_clinics | bookkeepers_cpa | both (default)
 *
 * Safety & Compliance:
 *   - Defaults strictly to `--dry-run`; pass `--stage` to write `status = 'draft'` rows
 *     (`delivery_status = 'not_sent'`, `requires_approval = true`). NEVER sends live emails.
 *   - Hard-capped at 25 prospects/run (`--limit 15` default, max `25`).
 *   - Dedupes strictly against `public_leads` names/emails/domains and suppression events.
 *   - Enforces <75-word Day-1 templates with mandatory CAN-SPAM footer:
 *     `421 Hill Street, Parkersburg, WV 26104 | Reply STOP to opt out.`
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isCanSpamFooterCompliant } from '../src/lib/canSpamGuard.ts';
import {
  buildRegionalDay1Draft,
  extractRootDomain,
  filterAndDedupeRegionalCandidates,
  getCuratedDryRunCandidates,
  parseRegionalScoutArgs,
  REGIONAL_MARKETS,
  type ConcreteRegionalLane,
  type RegionalCandidateInput,
  type RegionalMarketSpec,
} from '../src/lib/growth/regionalScoutEngine.ts';
import { normalizeEmail } from '../src/lib/outbound/sequencerEngine.ts';

try {
  process.loadEnvFile?.('.env.local');
} catch {
  // .env.local optional for --dry-run
}
try {
  process.loadEnvFile?.('.env');
} catch {
  // .env optional
}

const AUTHORITATIVE_SUPABASE_URL = 'https://uehfvpnnoitgybsmdgef.supabase.co';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveSupabaseUrl(): string {
  const raw = (process.env.VITE_SUPABASE_URL ?? '').trim();
  if (!raw || /placeholder|your-project/i.test(raw)) {
    return AUTHORITATIVE_SUPABASE_URL;
  }
  return raw;
}

function resolveServiceRoleKey(): string | null {
  const raw = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!raw || /placeholder|your-service-role/i.test(raw) || raw.startsWith('sb_publishable_')) {
    return null;
  }
  return raw;
}

async function resolveWorkspaceId(supabase: SupabaseClient): Promise<string> {
  const configured = (process.env.DEFAULT_WORKSPACE_ID ?? '').trim();
  if (configured && UUID_REGEX.test(configured)) {
    return configured;
  }
  const { data, error } = await supabase
    .from('workspaces')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data?.id) {
    throw new Error('Could not resolve default workspace_id in public.workspaces.');
  }
  return String(data.id);
}

interface OverpassTagRow {
  tags?: Record<string, string | undefined>;
}

interface OverpassJsonResponse {
  elements?: OverpassTagRow[];
}

function isBusinessEmailCandidate(email: string): boolean {
  const clean = email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,12}$/.test(clean)) return false;
  if (/\.(png|jpg|jpeg|gif|svg|webp|css|js|wixpress)$/i.test(clean)) return false;
  if (/(noreply|no-reply|donotreply|example\.com|sentry\.io|wix\.com)/i.test(clean)) return false;
  return true;
}

async function crawlWebsiteEmail(
  rawWebsite: string,
  fallbackPhone: string | null,
): Promise<{ email: string | null; phone: string | null }> {
  let cleanUrl = rawWebsite.trim();
  if (!cleanUrl) return { email: null, phone: fallbackPhone };
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    cleanUrl = `https://${cleanUrl}`;
  }
  let origin = cleanUrl;
  try {
    origin = new URL(cleanUrl).origin;
  } catch {
    return { email: null, phone: fallbackPhone };
  }

  let phone = fallbackPhone;
  for (const url of [cleanUrl, `${origin}/contact`, `${origin}/contact-us`]) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const html = (await res.text()).slice(0, 150_000).replace(/&#64;/gi, '@');
      if (!phone) {
        const pMatch = /\b(\(\d{3}\)\s*\d{3}[-.\s]\d{4}|\d{3}[-.]\d{3}[-.]\d{4})\b/.exec(html);
        if (pMatch?.[1]) phone = pMatch[1].trim();
      }
      const mailto = /href=["']mailto:([^"'?#\s]+@[^"'?#\s]+)["']/i.exec(html);
      if (mailto?.[1] && isBusinessEmailCandidate(mailto[1])) {
        return { email: mailto[1].toLowerCase(), phone };
      }
      const plain = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12})\b/.exec(html);
      if (plain?.[1] && isBusinessEmailCandidate(plain[1])) {
        return { email: plain[1].toLowerCase(), phone };
      }
    } catch {
      // Ignore individual timeout / TLS errors cleanly
    }
  }
  return { email: null, phone };
}

async function discoverLiveRegionalCandidates(
  market: RegionalMarketSpec,
  lane: ConcreteRegionalLane,
  maxFetch: number,
): Promise<RegionalCandidateInput[]> {
  const bbox = `${market.south},${market.west},${market.north},${market.east}`;
  const query =
    lane === 'bookkeepers_cpa'
      ? `[out:json][timeout:8];(node["office"~"^(accountant|tax_advisor|financial|company)$"]["website"](${bbox});node["office"~"^(accountant|tax_advisor)$"]["contact:website"](${bbox}););out tags 40;`
      : `[out:json][timeout:8];(node["craft"~"^(hvac|plumber|electrician|roofer|carpenter)$"]["website"](${bbox});node["amenity"~"^(dentist|clinic|veterinary)$"]["website"](${bbox}););out tags 40;`;

  let elements: OverpassTagRow[] = [];
  for (const endpoint of [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ]) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'LooseEndsOS-RegionalScout/1.0',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as OverpassJsonResponse;
      if (json.elements && json.elements.length > 0) {
        elements = json.elements;
        break;
      }
    } catch {
      // Offline or rate-limited; try next mirror
    }
  }

  const out: RegionalCandidateInput[] = [];
  for (const el of elements) {
    if (out.length >= maxFetch) break;
    const tags = el.tags ?? {};
    const business = (tags.name ?? '').trim();
    const website = (tags.website ?? tags['contact:website'] ?? '').trim();
    if (!business || !website) continue;

    const rawOsmEmail = normalizeEmail(tags.email ?? tags['contact:email']);
    const osmPhone = (tags.phone ?? tags['contact:phone'] ?? '').trim() || null;

    let email = isBusinessEmailCandidate(rawOsmEmail) ? rawOsmEmail : null;
    let phone = osmPhone;
    if (!email) {
      const crawled = await crawlWebsiteEmail(website, osmPhone);
      email = crawled.email;
      phone = crawled.phone;
    }
    if (!email) continue;

    out.push({
      business,
      contact_name: lane === 'bookkeepers_cpa' ? 'Managing Partner' : 'Owner / Operations',
      email,
      phone,
      website,
      location: market.label,
      industry:
        tags.office?.replace(/_/g, ' ') ||
        tags.craft?.replace(/_/g, ' ') ||
        tags.amenity?.replace(/_/g, ' ') ||
        (lane === 'bookkeepers_cpa' ? 'CPA & Bookkeeping' : 'Trades & Clinic'),
      lane,
      score: lane === 'bookkeepers_cpa' ? 90 : 86,
    });
  }

  return out;
}

async function main(): Promise<void> {
  const opts = parseRegionalScoutArgs(process.argv.slice(2));
  const market = REGIONAL_MARKETS[opts.region];
  const serviceKey = resolveServiceRoleKey();
  const supabaseUrl = resolveSupabaseUrl();

  if (opts.mode === 'stage' && !serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required when running with --stage.');
  }

  const supabase: SupabaseClient | null = serviceKey
    ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    : null;

  const existingBusinesses = new Set<string>();
  const existingEmails = new Set<string>();
  const existingDomains = new Set<string>();
  const suppressedEmails = new Set<string>();
  let workspaceId: string | null = null;

  if (supabase) {
    workspaceId = await resolveWorkspaceId(supabase);
    const [{ data: existingLeads }, { data: suppressedRows }] = await Promise.all([
      supabase
        .from('public_leads')
        .select('business, email, contact_email, website, status, auto_paused_reason'),
      supabase
        .from('customer_contact_consent_events')
        .select('email, decision, status')
        .eq('workspace_id', workspaceId),
    ]);

    for (const row of (existingLeads ?? []) as Array<{
      business?: string | null;
      email?: string | null;
      contact_email?: string | null;
      website?: string | null;
      status?: string | null;
      auto_paused_reason?: string | null;
    }>) {
      const biz = (row.business ?? '').trim().toLowerCase();
      if (biz) existingBusinesses.add(biz);
      const e1 = normalizeEmail(row.email);
      const e2 = normalizeEmail(row.contact_email);
      if (e1) {
        existingEmails.add(e1);
        if (row.status === 'UNSUBSCRIBED' || row.status === 'BOUNCED' || row.auto_paused_reason) {
          suppressedEmails.add(e1);
        }
      }
      if (e2) {
        existingEmails.add(e2);
        if (row.status === 'UNSUBSCRIBED' || row.status === 'BOUNCED' || row.auto_paused_reason) {
          suppressedEmails.add(e2);
        }
      }
      const dom = extractRootDomain(row.website) || extractRootDomain(e1) || extractRootDomain(e2);
      if (dom) existingDomains.add(dom);
    }

    for (const row of (suppressedRows ?? []) as Array<{
      email?: string | null;
      decision?: string | null;
      status?: string | null;
    }>) {
      if (row.decision === 'revoked' || row.status === 'opted_out' || row.status === 'revoked') {
        const clean = normalizeEmail(row.email);
        if (clean) suppressedEmails.add(clean);
      }
    }
  }

  const targetLanes: ConcreteRegionalLane[] =
    opts.lane === 'both' ? ['trades_clinics', 'bookkeepers_cpa'] : [opts.lane];

  let discovered: RegionalCandidateInput[] = [];
  for (const lane of targetLanes) {
    const found = await discoverLiveRegionalCandidates(market, lane, opts.limit);
    discovered = [...discovered, ...found];
  }

  if (discovered.length === 0 && opts.mode === 'dry_run') {
    discovered = getCuratedDryRunCandidates(opts.region, opts.lane);
  }

  const deduped = filterAndDedupeRegionalCandidates({
    candidates: discovered,
    existingBusinesses,
    existingEmails,
    existingDomains,
    suppressedEmails,
    limit: opts.limit,
  });

  console.log(
    JSON.stringify(
      {
        mode: opts.mode,
        region: market.label,
        lane: opts.lane,
        limit: opts.limit,
        discoveredCount: discovered.length,
        acceptedCount: deduped.accepted.length,
        skippedReasons: deduped.skipped_reasons,
      },
      null,
      2,
    ),
  );

  if (opts.mode === 'dry_run') {
    for (const cand of deduped.accepted) {
      const draft = buildRegionalDay1Draft({
        lane: cand.lane,
        companyName: cand.business,
        contactName: cand.contact_name,
      });
      console.log(
        `\n[DRY-RUN] ${cand.business} <${cand.email}> (${cand.lane} · ${draft.word_count} words · CAN-SPAM=${isCanSpamFooterCompliant(draft.message)})`,
      );
      console.log(`  Subject: ${draft.subject}`);
      console.log(`  Body   : ${draft.message.replace(/\n+/g, ' ')}`);
    }
    return;
  }

  if (!supabase || !workspaceId) {
    throw new Error('Supabase client and workspace_id required for --stage.');
  }

  let stagedCount = 0;
  for (const cand of deduped.accepted) {
    const draft = buildRegionalDay1Draft({
      lane: cand.lane,
      companyName: cand.business,
      contactName: cand.contact_name,
    });

    const { data: leadRow, error: leadErr } = await supabase
      .from('public_leads')
      .upsert(
        {
          workspace_id: workspaceId,
          name: cand.contact_name,
          business: cand.business,
          phone: cand.phone ?? null,
          email: cand.email,
          contact_name: cand.contact_name,
          contact_email: cand.email,
          business_type: cand.industry,
          industry: cand.industry,
          location: cand.location,
          website: cand.website ?? null,
          outreach_lane: cand.lane,
          sequence_step: 1,
          status: 'DRAFT_READY',
          score: cand.score,
        },
        { onConflict: 'workspace_id,business' },
      )
      .select('id')
      .single();

    if (leadErr || !leadRow?.id) {
      console.error(`Skipped lead ${cand.business}: ${leadErr?.message ?? 'upsert error'}`);
      continue;
    }

    const { error: draftErr } = await supabase.from('ops_communication_drafts').insert({
      workspace_id: workspaceId,
      customer_id: null,
      lead_id: leadRow.id,
      recipient_email: cand.email,
      recipient_name: cand.contact_name,
      company_name: cand.business,
      channel: 'email',
      outreach_lane: cand.lane,
      sequence_step: 1,
      subject: draft.subject,
      message: draft.message,
      status: 'draft',
      delivery_status: 'not_sent',
      requires_approval: true,
    });

    if (draftErr) {
      console.error(`Skipped draft for ${cand.business}: ${draftErr.message}`);
      continue;
    }
    stagedCount += 1;
  }

  console.log(
    `Staged ${stagedCount} Day-1 regional draft(s) as status='draft', delivery_status='not_sent', requires_approval=true.`,
  );
}

main().catch((err: unknown) => {
  console.error('scoutRegionalLeads failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
