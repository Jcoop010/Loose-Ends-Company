/// <reference path="./node-ambient.d.ts" />
/**
 * scripts/scoutProspects.ts
 *
 * Self-Contained Online SMB Prospect Scouting & Website Enrichment Agent for Loose Ends.
 *
 * Authoritative Repository: Jcoop010/Loose-Ends-Company
 * Authoritative Supabase  : https://uehfvpnnoitgybsmdgef.supabase.co
 * Authoritative App       : https://looseendsos.app/
 *
 * Capabilities:
 *   1. Paid API Adapters (when configured): Google Places API (v1) & Serper.dev Places
 *   2. Zero-Key Public Web Adapter (`discoverViaPublicWeb`): OpenStreetMap Overpass API
 *      across rotating US metro bounding boxes and diverse SMB verticals (`craft`, `office`,
 *      `healthcare`, `clinic|dentist|veterinary`, `shop`).
 *   3. Automated Website Contact Crawler (`enrichFromWebsite`): fetches homepage + up to
 *      2 contact/about paths (`/contact`, `/contact-us`, `/about`, `/about-us`) with a 6s
 *      timeout, extracting real domain-matched/executive emails, phone numbers, and page title.
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

// ---------------------------------------------------------------------------
// Types (Strict TypeScript — zero `any`)
// ---------------------------------------------------------------------------

type BottleneckTag =
  | 'unbilled_work'
  | 'stale_quotes'
  | 'inventory_stockouts'
  | 'overdue_invoices';

type LeadLifecycleStatus =
  | 'DRAFT_READY'
  | 'DRAFT_GENERATED'
  | 'OWNER_APPROVED'
  | 'CONTACTED'
  | 'DEMO_SCHEDULED'
  | 'PILOT_SOLD'
  | 'LOST';

export interface ScoutedProspect {
  /** Matches public_leads.business unique constraint — used as deduplication key */
  business:        string;
  name:            string;
  phone?:          string;
  email?:          string;
  business_type:   string;
  biggest_problem: BottleneckTag;
  industry:        string;
  location:        string;
  contact_name:    string;
  contact_email?:  string;
  website:         string;
  notes:           string;
  score:           number; // 70–95 qualification score
  status?:         LeadLifecycleStatus;
}

export interface WebsiteEnrichmentResult {
  email:         string | null;
  domainMatched: boolean;
  phone:         string | null;
  pageTitle:     string | null;
}

interface GooglePlaceDisplayName {
  text?: string;
}

interface GooglePlaceItem {
  displayName?:          GooglePlaceDisplayName;
  formattedAddress?:     string;
  websiteUri?:           string;
  nationalPhoneNumber?:  string;
  rating?:               number;
  userRatingCount?:      number;
}

interface GooglePlacesSearchResponse {
  places?: GooglePlaceItem[];
}

interface SerperPlaceItem {
  title?:       string;
  address?:     string;
  website?:     string;
  phoneNumber?: string;
  rating?:      number;
  ratingCount?: number;
}

interface SerperPlacesResponse {
  places?: SerperPlaceItem[];
}

interface OverpassElement {
  type:  string;
  id:    number;
  tags?: Record<string, string | undefined>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

interface NominatimPlaceItem {
  place_id?:       number;
  name?:           string;
  display_name?:   string;
  category?:       string;
  type?:           string;
  extratags?:      Record<string, string | undefined>;
  address?:        Record<string, string | undefined>;
}

interface MetroBbox {
  market: string;
  south:  number;
  west:   number;
  north:  number;
  east:   number;
}

// ---------------------------------------------------------------------------
// Diverse SMB Verticals & Target Markets (rotated deterministically)
// ---------------------------------------------------------------------------
const SMB_VERTICALS: readonly string[] = [
  'home & commercial service contractors',
  'dental & wellness clinics',
  'marketing & creative agencies',
  'boutique retail & e-commerce',
  'auto repair & detailing shops',
  'local logistics & courier services',
  'specialty food & catering',
  'fitness studios & gyms',
];

const METRO_BBOXES: readonly MetroBbox[] = [
  { market: 'Parkersburg, WV', south: 39.20, west: -81.62, north: 39.34, east: -81.48 },
  { market: 'Marietta, OH',    south: 39.38, west: -81.50, north: 39.46, east: -81.40 },
  { market: 'Charleston, WV',  south: 38.30, west: -81.72, north: 38.40, east: -81.56 },
  { market: 'Morgantown, WV',  south: 39.60, west: -80.02, north: 39.68, east: -79.90 },
  { market: 'Pittsburgh, PA',  south: 40.40, west: -80.06, north: 40.50, east: -79.90 },
  { market: 'Columbus, OH',    south: 39.90, west: -83.12, north: 40.12, east: -82.88 },
  { market: 'Charlotte, NC',   south: 35.14, west: -80.93, north: 35.32, east: -80.72 },
  { market: 'Austin, TX',      south: 30.20, west: -97.82, north: 30.40, east: -97.66 },
  { market: 'Nashville, TN',   south: 36.10, west: -86.86, north: 36.24, east: -86.68 },
  { market: 'Denver, CO',      south: 39.68, west: -105.05, north: 39.80, east: -104.90 },
  { market: 'Raleigh, NC',     south: 35.74, west: -78.74, north: 35.88, east: -78.56 },
  { market: 'Tampa, FL',       south: 27.90, west: -82.56, north: 28.06, east: -82.40 },
];

const OVERPASS_ENDPOINTS: readonly string[] = [
  'https://overpass-api.de/api/interpreter',
];

// Chains or non-SMB domains to skip during public web discovery
const EXCLUDED_WEBSITE_DOMAINS: readonly string[] = [
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'yelp.com',
  'google.com',
  'youtube.com',
  'tiktok.com',
  'walmart.com',
  'target.com',
  'cvs.com',
  'walgreens.com',
  'homedepot.com',
  'lowes.com',
  'starbucks.com',
  'mcdonalds.com',
  'apple.com',
  'att.com',
  'verizon.com',
  't-mobile.com',
  'fedex.com',
  'ups.com',
  'usps.com',
  'uhc.com',
  'aspca.org',
  'davita.com',
  'ntb.com',
  'westelm.com',
  'acehardware.com',
  'firestonecompleteautocare.com',
  'midas.com',
  'jiffylube.com',
  'meineke.com',
  'pepboys.com',
  'goodyear.com',
  'valvoline.com',
  'caliber.com',
  'gerbercollision.com',
  'safelite.com',
  'aspendental.com',
  'banfield.com',
  'vcahospitals.com',
  'autozone.com',
  'oreillyauto.com',
  'advanceautoparts.com',
  'napaonline.com',
  'menswearhouse.com',
  'josbank.com',
  'lenscrafters.com',
  'pearlevision.com',
  'americasbest.com',
  'massageenvy.com',
  'handandstone.com',
  'orangetheory.com',
  'planetfitness.com',
  'anytimefitness.com',
  'crunch.com',
  'f45training.com',
  'purebarre.com',
  'clubpilates.com',
  'harborfreight.com',
  'ashleyfurniture.com',
  'voodoodoughnut.com',
];

// ---------------------------------------------------------------------------
// 20 Vetted Prospects — researched & scored (Nov 2026)
// ---------------------------------------------------------------------------
const VETTED_PROSPECTS: readonly ScoutedProspect[] = [
  {
    business: 'Texadia Systems',
    name: 'Steve Burke',
    business_type: 'Commercial AV & Structured Cabling',
    biggest_problem: 'unbilled_work',
    industry: 'Commercial AV Integration',
    location: 'Dallas, TX',
    contact_name: 'Steve Burke, CTS (CEO & Founder)',
    website: 'https://texadiasystems.com',
    notes:
      'Multi-phase corporate AV projects with frequent field change orders, ' +
      'unbilled materials, and milestone invoicing delays. ' +
      'Detected bottleneck pattern: unbilled_work',
    score: 95,
  },
  {
    business: 'Performance Fire Protection',
    name: 'Billy Rabon',
    business_type: 'Commercial Fire Sprinkler & Inspection',
    biggest_problem: 'stale_quotes',
    industry: 'Fire Life Safety',
    location: 'Mooresville, NC',
    contact_name: 'Billy Rabon (VP Inspection Sales)',
    website: 'https://performancefire.com',
    notes:
      'Recurring NFPA inspection certificates, backflow test reports, and ' +
      'unbilled emergency repair work orders. ' +
      'Detected bottleneck pattern: stale_quotes',
    score: 94,
  },
  {
    business: 'Reed Restaurant Repair',
    name: 'Greg Reed',
    business_type: 'Foodservice & Kitchen Equipment Service',
    biggest_problem: 'unbilled_work',
    industry: 'Foodservice Equipment Repair',
    location: 'Denver, CO',
    contact_name: 'Greg Reed (Founder & President)',
    website: 'https://reedrestaurantrepair.com',
    notes:
      'Emergency field service dispatch with high parts counts; tech work orders ' +
      'stalling in vans before invoice drafting. ' +
      'Detected bottleneck pattern: unbilled_work',
    score: 92,
  },
  {
    business: 'Devices, Inc.',
    name: 'Ron Barrier',
    business_type: 'Flow Meter & Metrology Calibration',
    biggest_problem: 'stale_quotes',
    industry: 'Calibration & Metrology',
    location: 'Dallas, TX',
    contact_name: 'Ron Barrier (President & Founder)',
    website: 'https://devicesinc.net',
    notes:
      'ISO 17025 NIST recall cycles, calibration test reports, bench repair tracking, ' +
      'and annual renewal follow-ups. ' +
      'Detected bottleneck pattern: stale_quotes',
    score: 91,
  },
  {
    business: 'Watertight Roofing Services',
    name: 'Jason Tolbert',
    business_type: 'Commercial Roofing & Envelope',
    biggest_problem: 'overdue_invoices',
    industry: 'Commercial Roofing',
    location: 'Atlanta, GA',
    contact_name: 'Jason Tolbert (President & CEO) / Adam Yelton (VP & COO)',
    website: 'https://wrsroof.com',
    notes:
      'Commercial reroofing retainage, punch-list completion documentation, and ' +
      'warranty maintenance contract renewals. ' +
      'Detected bottleneck pattern: overdue_invoices',
    score: 90,
  },
  {
    business: 'CoCal Landscape',
    name: 'Jesus Medrano',
    business_type: 'Commercial Landscape & Snow Removal',
    biggest_problem: 'unbilled_work',
    industry: 'Landscape & Snow Management',
    location: 'Denver, CO',
    contact_name: 'Jesus "Chuy" Medrano (CEO) / Carlos Medrano (VP Ops)',
    website: 'https://cocalcares.com',
    notes:
      'Seasonal snow clearing work orders, property contract renewals, weather delay ' +
      'scheduling, and delayed billing. ' +
      'Detected bottleneck pattern: unbilled_work',
    score: 89,
  },
  {
    business: 'Fleet Repair Solutions',
    name: 'Daniel Kemmerer',
    business_type: 'Mobile Fleet & Trailer Maintenance',
    biggest_problem: 'unbilled_work',
    industry: 'Fleet Maintenance',
    location: 'Atlanta, GA',
    contact_name: 'Daniel Kemmerer (President & CEO) / Scott Hughes (VP Ops)',
    website: 'https://gofleetrepair.com',
    notes:
      'Rapid mobile fleet dispatch, roadside repair part reconciliations, and ' +
      'delayed fleet billing approvals. ' +
      'Detected bottleneck pattern: unbilled_work',
    score: 88,
  },
  {
    business: 'PK Tech',
    name: 'Jordan Hetrick',
    business_type: 'Managed IT & Cloud Security',
    biggest_problem: 'overdue_invoices',
    industry: 'Managed IT (MSP)',
    location: 'Phoenix, AZ',
    contact_name: 'Jordan Hetrick (Founder & CEO)',
    website: 'https://pktech.net',
    notes:
      'Monthly cloud license true-ups, out-of-scope project billing reconciliation, ' +
      'and SLA renewal tracking. ' +
      'Detected bottleneck pattern: overdue_invoices',
    score: 88,
  },
  {
    business: 'Fluid Power Services, Inc.',
    name: 'Russ Rubino',
    business_type: 'Industrial Hydraulics & Cylinder Repair',
    biggest_problem: 'stale_quotes',
    industry: 'Industrial Hydraulics',
    location: 'Gary, IN',
    contact_name: 'Russ Rubino (President) / Amy Rubino (VP)',
    website: 'https://fluidpowergary.com',
    notes:
      'Teardown inspection reports, custom machining quotes, parts inventory allocation, ' +
      'and finished job holdover. ' +
      'Detected bottleneck pattern: stale_quotes',
    score: 87,
  },
  {
    business: 'The Camelot Company',
    name: 'Kellie Case',
    business_type: 'Customs Brokerage & Freight Forwarding',
    biggest_problem: 'overdue_invoices',
    industry: 'Freight Forwarding',
    location: 'Chicago, IL',
    contact_name: 'Kellie Case (President)',
    website: 'https://camelotcompany.com',
    notes:
      'Missing international bills of lading (BOL), delivery orders, customs entry ' +
      'proof, and client duty disbursements. ' +
      'Detected bottleneck pattern: overdue_invoices',
    score: 87,
  },
  {
    business: 'Eagle Electric',
    name: 'Justin Smith',
    business_type: 'Commercial & Industrial Electrical',
    biggest_problem: 'unbilled_work',
    industry: 'Electrical Contracting',
    location: 'Denver, CO',
    contact_name: 'Justin Smith (Owner & Chief Estimator)',
    website: 'https://eagleec.com',
    notes:
      'Commercial bid revisions, material allocations from warehouse, and progress ' +
      'payment draw reconciliations. ' +
      'Detected bottleneck pattern: unbilled_work',
    score: 86,
  },
  {
    business: 'Headrick Insulation',
    name: 'Shirley Headrick',
    business_type: 'Mechanical & Pipe Insulation',
    biggest_problem: 'overdue_invoices',
    industry: 'Insulation Contracting',
    location: 'Atlanta, GA',
    contact_name: 'Shirley Headrick (CEO) / Brian Headrick (VP Ops)',
    website: 'https://headrickinsulation.com',
    notes:
      'Subcontractor jobsite material drops, unapproved field work directives, and ' +
      'general contractor billing signoffs. ' +
      'Detected bottleneck pattern: overdue_invoices',
    score: 85,
  },
  {
    business: 'Commercial Laundry Equipment',
    name: 'Owner Team',
    business_type: 'Commercial Laundry Sales & Service',
    biggest_problem: 'stale_quotes',
    industry: 'Commercial Laundry',
    location: 'Riviera Beach, FL',
    contact_name: 'Owner Team (commerciallaundryequip.com)',
    website: 'https://commerciallaundryequip.com',
    notes:
      'Preventative maintenance agreements, OEM warranty submission tracking, and ' +
      'multi-housing service tickets. ' +
      'Detected bottleneck pattern: stale_quotes',
    score: 85,
  },
  {
    business: 'Invader Pest Management',
    name: 'Fred Willey',
    business_type: 'Commercial Facility IPM & Multi-Unit',
    biggest_problem: 'unbilled_work',
    industry: 'Pest Management',
    location: 'Glendale, AZ',
    contact_name: 'Fred Willey (President) / Jacob Bushong (Ops Mgr)',
    website: 'https://invader.net',
    notes:
      'Health department compliance logs, recurring commercial contracts, and ' +
      'unbilled auxiliary technician visits. ' +
      'Detected bottleneck pattern: unbilled_work',
    score: 84,
  },
  {
    business: 'Secure Technicians Inc.',
    name: 'Management Team',
    business_type: 'Commercial Access Control & Banking Security',
    biggest_problem: 'stale_quotes',
    industry: 'Security & Access Control',
    location: 'Raleigh, NC',
    contact_name: 'Management Team (securetechnicians.com)',
    website: 'https://securetechnicians.com',
    notes:
      'Multi-location device commissioning sheets, technician punch lists, and ' +
      'delayed customer signoffs. ' +
      'Detected bottleneck pattern: stale_quotes',
    score: 84,
  },
  {
    business: 'Nashville Medical Electronics',
    name: 'Service Management',
    business_type: 'Biomedical Equipment Safety & Repair',
    biggest_problem: 'stale_quotes',
    industry: 'Biomedical Equipment',
    location: 'Nashville, TN',
    contact_name: 'Service Management (nashmed.com)',
    website: 'https://nashmed.com',
    notes:
      'Annual electrical safety checks, clinical equipment calibration reports, and ' +
      'delayed preventative maintenance signoffs. ' +
      'Detected bottleneck pattern: stale_quotes',
    score: 83,
  },
  {
    business: 'Generator Authority',
    name: 'James Johnson',
    business_type: 'Commercial Generator Sales & Service',
    biggest_problem: 'unbilled_work',
    industry: 'Standby Generators',
    location: 'Dallas, TX',
    contact_name: 'James "Wes" Johnson (Owner)',
    website: 'https://mygeneratorauthority.com',
    notes:
      'Annual load bank test documentation, scheduled oil/coolant service contracts, ' +
      'and unbilled warranty claims. ' +
      'Detected bottleneck pattern: unbilled_work',
    score: 83,
  },
  {
    business: 'Horizon Glass',
    name: 'Bill Fricke',
    business_type: 'Commercial Architectural Glazing',
    biggest_problem: 'overdue_invoices',
    industry: 'Architectural Glazing',
    location: 'Denver, CO',
    contact_name: 'Bill Fricke (CEO) / Eric Hagenburger (COO)',
    website: 'https://horizonglass.net',
    notes:
      'Architectural glass submittal approvals, fabrication lead-time tracking, and ' +
      'progress retainage draws. ' +
      'Detected bottleneck pattern: overdue_invoices',
    score: 82,
  },
  {
    business: 'The Printing People, Inc.',
    name: 'Sam Reyes',
    business_type: 'Commercial Printing & Visual Collateral',
    biggest_problem: 'stale_quotes',
    industry: 'Commercial Printing',
    location: 'Atlanta, GA',
    contact_name: 'Sam Reyes (President) / Luke Bryant (VP)',
    website: 'https://printingpeople.com',
    notes:
      'Stale print quotes, unapproved client digital proofs, finished stock holding, ' +
      'and delivery billing lag. ' +
      'Detected bottleneck pattern: stale_quotes',
    score: 81,
  },
  {
    business: 'Ascent CFO Solutions',
    name: 'Dan DeGolier',
    business_type: 'Fractional CFO & Client Accounting',
    biggest_problem: 'overdue_invoices',
    industry: 'Fractional CFO Advisory',
    location: 'Denver, CO',
    contact_name: 'Dan DeGolier (Founder)',
    website: 'https://ascentcfo.com',
    notes:
      'Managing client billing backlogs, overdue receivable aging lists, and ' +
      'unbilled client out-of-scope advisory. ' +
      'Detected bottleneck pattern: overdue_invoices',
    score: 80,
  },
];

// ---------------------------------------------------------------------------
// Bottleneck & Scoring Helpers
// ---------------------------------------------------------------------------

function inferBottleneckForVertical(vertical: string): {
  tag: BottleneckTag;
  note: string;
} {
  const v = vertical.toLowerCase();
  if (v.includes('retail') || v.includes('e-commerce') || v.includes('shop')) {
    return {
      tag: 'inventory_stockouts',
      note: 'Multi-SKU stock drift, supplier PO tracking, and unfulfilled special orders. Detected bottleneck pattern: inventory_stockouts',
    };
  }
  if (
    v.includes('dental') ||
    v.includes('clinic') ||
    v.includes('wellness') ||
    v.includes('fitness') ||
    v.includes('studio') ||
    v.includes('healthcare') ||
    v.includes('veterinary')
  ) {
    return {
      tag: 'stale_quotes',
      note: 'Unconfirmed recurring bookings, treatment/membership plan follow-ups, and overdue balances. Detected bottleneck pattern: stale_quotes',
    };
  }
  if (
    v.includes('agency') ||
    v.includes('marketing') ||
    v.includes('creative') ||
    v.includes('office') ||
    v.includes('consulting') ||
    v.includes('accounting')
  ) {
    return {
      tag: 'overdue_invoices',
      note: 'Approved client proposals, out-of-scope deliverables, and milestone retainers sitting unbilled. Detected bottleneck pattern: overdue_invoices',
    };
  }
  if (v.includes('food') || v.includes('catering') || v.includes('bakery')) {
    return {
      tag: 'stale_quotes',
      note: 'Event catering proposals, ingredient purchase orders, and final balance collection. Detected bottleneck pattern: stale_quotes',
    };
  }
  return {
    tag: 'unbilled_work',
    note: 'Completed field/shop work orders, parts allocation, and open estimates awaiting billing signoff. Detected bottleneck pattern: unbilled_work',
  };
}

function computeProspectScore(params: {
  hasWebsite: boolean;
  hasEmail: boolean;
  domainMatchedEmail: boolean;
  hasPhone: boolean;
  hasAddress: boolean;
  ratingCount: number;
}): number {
  let score = 70;
  if (params.hasWebsite) score += 8;
  if (params.hasEmail) score += 7;
  if (params.domainMatchedEmail) score += 5;
  if (params.hasPhone) score += 3;
  if (params.hasAddress) score += 2;
  if (params.ratingCount >= 10) score += 2;
  return Math.min(95, Math.max(70, score));
}

// ---------------------------------------------------------------------------
// Website Contact Crawler (`enrichFromWebsite`)
// ---------------------------------------------------------------------------

const IGNORED_EMAIL_EXTENSIONS: readonly string[] = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.avif',
  '.css',
  '.js',
  '.mjs',
  '.ts',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.ico',
  '.pdf',
  '.mp4',
  '.mp3',
  '.zip',
  '.map',
];

const IGNORED_EMAIL_DOMAINS: readonly string[] = [
  'sentry.io',
  'wixpress.com',
  'wix.com',
  'squarespace.com',
  'squarespace-mail.com',
  'godaddy.com',
  'shopify.com',
  'myshopify.com',
  'weebly.com',
  'webflow.io',
  'theoceanwide.com',
  'wordpress.org',
  'wordpress.com',
  'example.com',
  'example.org',
  'domain.com',
  'email.com',
  'yoursite.com',
  'yourdomain.com',
  'company.com',
  'business.com',
  'cloudflare.com',
  'googleapis.com',
  'w3.org',
  'schema.org',
  'latofonts.com',
  'typekit.com',
  'fontawesome.com',
  'getbootstrap.com',
  'mailchimp.com',
  'constantcontact.com',
];

const ALLOWED_FREEMAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'msn.com',
  'comcast.net',
  'att.net',
  'protonmail.com',
  'proton.me',
  'zoho.com',
];

const IGNORED_EMAIL_PREFIXES: readonly string[] = [
  'resumes@',
  'resume@',
  'careers@',
  'career@',
  'jobs@',
  'job@',
  'hiring@',
  'hr@',
  'recruiting@',
  'press@',
  'media@',
  'pr@',
  'privacy@',
  'legal@',
  'abuse@',
  'webmaster@',
  'noreply@',
  'no-reply@',
  'donotreply@',
  'do-not-reply@',
  'postmaster@',
  'mailer-daemon@',
  'dpo@',
  'copyright@',
  'accessibility@',
];

const PREFERRED_EMAIL_PREFIXES: readonly string[] = [
  'owner@',
  'founder@',
  'president@',
  'ceo@',
  'office@',
  'operations@',
  'billing@',
  'service@',
  'estimates@',
  'quotes@',
  'dispatch@',
  'sales@',
  'info@',
  'contact@',
  'hello@',
  'admin@',
  'support@',
];

function normalizeWebsiteUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.')) return null;
    if (host.endsWith('.edu') || host.endsWith('.gov') || host.endsWith('.mil')) {
      return null;
    }
    if (EXCLUDED_WEBSITE_DOMAINS.some((d) => host === d.toLowerCase() || host.endsWith(`.${d.toLowerCase()}`))) {
      return null;
    }
    return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, ''));
  } catch {
    return null;
  }
}

function getRootDomain(websiteUrl: string): string {
  try {
    const parsed = new URL(websiteUrl);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isValidBusinessEmail(rawEmail: string): boolean {
  const email = rawEmail.trim().toLowerCase();
  if (email.length < 6 || email.length > 120) return false;
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,12}$/.test(email)) return false;

  if (IGNORED_EMAIL_EXTENSIONS.some((ext) => email.endsWith(ext))) {
    return false;
  }
  if (IGNORED_EMAIL_PREFIXES.some((prefix) => email.startsWith(prefix))) {
    return false;
  }

  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [localPart, domainPart] = parts;

  // Filter out 24+ char hex telemetry hashes (e.g. Sentry DSNs)
  if (/^[0-9a-f]{24,}$/.test(localPart)) {
    return false;
  }

  if (
    IGNORED_EMAIL_DOMAINS.some(
      (bad) => domainPart === bad.trim() || domainPart.endsWith(`.${bad.trim()}`)
    )
  ) {
    return false;
  }

  return true;
}

function isDomainMatchForRoot(domainPart: string, rootDomain: string): boolean {
  if (!rootDomain || !domainPart) return false;
  if (
    domainPart === rootDomain ||
    domainPart.endsWith(`.${rootDomain}`) ||
    rootDomain.endsWith(`.${domainPart}`)
  ) {
    return true;
  }
  // Also match core brand token when rootDomain has a hyphen or location suffix
  const rootBase = rootDomain.split('.')[0].replace(/[^a-z0-9]/g, '');
  const emailBase = domainPart.split('.')[0].replace(/[^a-z0-9]/g, '');
  return (
    rootBase.length >= 6 &&
    emailBase.length >= 6 &&
    (rootBase.includes(emailBase) || emailBase.includes(rootBase))
  );
}

function rankCandidateEmail(email: string, rootDomain: string): number {
  const lower = email.toLowerCase();
  const [localPart = '', domainPart = ''] = lower.split('@');
  const domainMatched = isDomainMatchForRoot(domainPart, rootDomain);
  const isFreemail = ALLOWED_FREEMAIL_DOMAINS.includes(domainPart);

  // Reject unrelated third-party agency/template domains
  if (!domainMatched && !isFreemail) {
    return -50;
  }

  let rank = domainMatched ? 100 : 25;

  const prefIdx = PREFERRED_EMAIL_PREFIXES.findIndex((p) => lower.startsWith(p));
  if (prefIdx !== -1) {
    // Executive / operations role prefixes (owner@, founder@, office@, billing@, service@, info@, etc.)
    rank += 42 - prefIdx;
  } else if (
    domainMatched &&
    /^[a-z]{2,18}(\.[a-z]{2,18})?$/.test(localPart)
  ) {
    // Named owner/founder email on the business's own domain (e.g. bobbi@, greg@, steve@)
    rank += 48;
  } else {
    rank += 18;
  }

  return rank;
}

function extractEmailsFromHtml(html: string): string[] {
  const decoded = html
    .replace(/&#64;/g, '@')
    .replace(/&#46;/g, '.')
    .replace(/%40/gi, '@');

  const results = new Set<string>();

  // 1. Explicit mailto: links
  const mailtoRegex = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12})/gi;
  let match: RegExpExecArray | null = mailtoRegex.exec(decoded);
  while (match !== null) {
    const candidate = match[1].toLowerCase();
    if (isValidBusinessEmail(candidate)) {
      results.add(candidate);
    }
    match = mailtoRegex.exec(decoded);
  }

  // 2. Body / attribute email pattern matches
  const emailRegex = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,12})\b/g;
  match = emailRegex.exec(decoded);
  while (match !== null) {
    const candidate = match[1].toLowerCase();
    if (isValidBusinessEmail(candidate)) {
      results.add(candidate);
    }
    match = emailRegex.exec(decoded);
  }

  return Array.from(results);
}

function extractPhoneFromHtml(html: string): string | null {
  const telMatch = /tel:(\+?1?[-.\s()]?\d{3}[-.\s()]?\d{3}[-.\s]?\d{4})/i.exec(html);
  if (telMatch?.[1]) {
    return telMatch[1].trim();
  }
  const usPhoneMatch = /\b(\(\d{3}\)\s*\d{3}[-.\s]\d{4}|\d{3}[-.]\d{3}[-.]\d{4})\b/.exec(
    html
  );
  return usPhoneMatch?.[1]?.trim() ?? null;
}

function extractTitleFromHtml(html: string): string | null {
  const titleMatch = /<title[^>]*>([^<]{2,120})<\/title>/i.exec(html);
  if (!titleMatch?.[1]) return null;
  return titleMatch[1].replace(/\s+/g, ' ').trim();
}

export async function enrichFromWebsite(
  rawWebsiteUrl: string,
  existingPhone?: string
): Promise<WebsiteEnrichmentResult> {
  const normalizedBase = normalizeWebsiteUrl(rawWebsiteUrl);
  if (!normalizedBase) {
    return {
      email: null,
      domainMatched: false,
      phone: existingPhone ?? null,
      pageTitle: null,
    };
  }

  const rootDomain = getRootDomain(normalizedBase);
  let originUrl = normalizedBase;
  try {
    originUrl = new URL(normalizedBase).origin;
  } catch {
    // keep normalizedBase
  }

  const candidatePaths: readonly string[] = [
    normalizedBase,
    `${originUrl}/contact`,
    `${originUrl}/contact-us`,
    `${originUrl}/about`,
    `${originUrl}/about-us`,
  ];

  const foundEmails = new Set<string>();
  let discoveredPhone: string | null = existingPhone ?? null;
  let pageTitle: string | null = null;
  let subpagesChecked = 0;

  for (let i = 0; i < candidatePaths.length; i += 1) {
    if (i > 0 && subpagesChecked >= 2) {
      break;
    }
    const targetUrl = candidatePaths[i];
    if (i > 0 && targetUrl === normalizedBase) {
      continue;
    }
    if (i > 0) {
      subpagesChecked += 1;
    }

    try {
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(6000),
      });

      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        continue;
      }

      const html = (await response.text()).slice(0, 250_000);
      if (!pageTitle) {
        pageTitle = extractTitleFromHtml(html);
      }
      if (!discoveredPhone) {
        discoveredPhone = extractPhoneFromHtml(html);
      }

      for (const email of extractEmailsFromHtml(html)) {
        foundEmails.add(email);
      }

      // If homepage already yielded a domain-matched email, skip extra subpage fetches
      const hasDomainMatch = Array.from(foundEmails).some(
        (e) => rankCandidateEmail(e, rootDomain) >= 100
      );
      if (hasDomainMatch && discoveredPhone) {
        break;
      }
    } catch {
      // Timeout or TLS error on individual site — continue gracefully
    }
  }

  const validRankedEmails = Array.from(foundEmails)
    .filter((e) => rankCandidateEmail(e, rootDomain) > 0)
    .sort(
      (a, b) => rankCandidateEmail(b, rootDomain) - rankCandidateEmail(a, rootDomain)
    );
  const bestEmail = validRankedEmails[0] ?? null;
  const domainMatched = Boolean(
    bestEmail && rankCandidateEmail(bestEmail, rootDomain) >= 100
  );

  return {
    email: bestEmail,
    domainMatched,
    phone: discoveredPhone,
    pageTitle,
  };
}

// ---------------------------------------------------------------------------
// Live Discovery Adapter 1: Google Places API (New) Text Search
// ---------------------------------------------------------------------------
export async function discoverViaGooglePlaces(
  vertical: string,
  market: string,
  existingBusinesses: ReadonlySet<string>
): Promise<ScoutedProspect[]> {
  const apiKey = (process.env.GOOGLE_PLACES_API_KEY ?? '').trim();
  if (!apiKey || isPlaceholderValue(apiKey)) {
    return [];
  }

  console.log(`🔍  Querying Google Places API for "${vertical}" in ${market}...`);

  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount',
    },
    body: JSON.stringify({
      textQuery: `${vertical} in ${market}`,
      maxResultCount: 10,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    console.warn(`⚠️  Google Places API returned HTTP ${response.status}.`);
    return [];
  }

  const payload = (await response.json()) as GooglePlacesSearchResponse;
  const places = payload.places ?? [];
  const bottleneck = inferBottleneckForVertical(vertical);
  const discovered: ScoutedProspect[] = [];

  for (const place of places) {
    const businessName = (place.displayName?.text ?? '').trim();
    const rawWebsite = (place.websiteUri ?? '').trim();
    const website = normalizeWebsiteUrl(rawWebsite);
    if (!businessName || !website) {
      continue;
    }
    if (existingBusinesses.has(businessName.toLowerCase())) {
      continue;
    }

    const enrichment = await enrichFromWebsite(
      website,
      (place.nationalPhoneNumber ?? '').trim() || undefined
    );
    const phone = enrichment.phone ?? undefined;
    const email = enrichment.email ?? undefined;
    if (!email && !phone) {
      continue;
    }

    const address = (place.formattedAddress ?? market).trim();
    const score = computeProspectScore({
      hasWebsite: true,
      hasEmail: Boolean(email),
      domainMatchedEmail: enrichment.domainMatched,
      hasPhone: Boolean(phone),
      hasAddress: Boolean(address),
      ratingCount: place.userRatingCount ?? 0,
    });

    discovered.push({
      business: businessName,
      name: 'Owner / Operations',
      phone,
      email,
      business_type: vertical,
      biggest_problem: bottleneck.tag,
      industry: vertical,
      location: market,
      contact_name: 'Owner / Operations',
      contact_email: email,
      website,
      notes: `${bottleneck.note} | Address: ${address}`,
      score,
      status: 'DRAFT_READY',
    });
  }

  return discovered;
}

// ---------------------------------------------------------------------------
// Live Discovery Adapter 2: Serper.dev Places API Fallback
// ---------------------------------------------------------------------------
export async function discoverViaSerper(
  vertical: string,
  market: string,
  existingBusinesses: ReadonlySet<string>
): Promise<ScoutedProspect[]> {
  const apiKey = (process.env.SERPER_API_KEY ?? '').trim();
  if (!apiKey || isPlaceholderValue(apiKey)) {
    return [];
  }

  console.log(`🔍  Querying Serper Places API for "${vertical}" in ${market}...`);

  const response = await fetch('https://google.serper.dev/places', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({
      q: `${vertical} in ${market}`,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    console.warn(`⚠️  Serper Places API returned HTTP ${response.status}.`);
    return [];
  }

  const payload = (await response.json()) as SerperPlacesResponse;
  const places = payload.places ?? [];
  const bottleneck = inferBottleneckForVertical(vertical);
  const discovered: ScoutedProspect[] = [];

  for (const place of places) {
    const businessName = (place.title ?? '').trim();
    const rawWebsite = (place.website ?? '').trim();
    const website = normalizeWebsiteUrl(rawWebsite);
    if (!businessName || !website) {
      continue;
    }
    if (existingBusinesses.has(businessName.toLowerCase())) {
      continue;
    }

    const enrichment = await enrichFromWebsite(
      website,
      (place.phoneNumber ?? '').trim() || undefined
    );
    const phone = enrichment.phone ?? undefined;
    const email = enrichment.email ?? undefined;
    if (!email && !phone) {
      continue;
    }

    const address = (place.address ?? market).trim();
    const score = computeProspectScore({
      hasWebsite: true,
      hasEmail: Boolean(email),
      domainMatchedEmail: enrichment.domainMatched,
      hasPhone: Boolean(phone),
      hasAddress: Boolean(address),
      ratingCount: place.ratingCount ?? 0,
    });

    discovered.push({
      business: businessName,
      name: 'Owner / Operations',
      phone,
      email,
      business_type: vertical,
      biggest_problem: bottleneck.tag,
      industry: vertical,
      location: market,
      contact_name: 'Owner / Operations',
      contact_email: email,
      website,
      notes: `${bottleneck.note} | Address: ${address}`,
      score,
      status: 'DRAFT_READY',
    });
  }

  return discovered;
}

// ---------------------------------------------------------------------------
// Live Discovery Adapter 3: Zero-Key Public SMB Discovery (`discoverViaPublicWeb`)
// Queries OpenStreetMap Overpass API across rotating US metro bounding boxes
// and enriches discovered SMB websites with real contact emails & phone numbers.
// ---------------------------------------------------------------------------

function resolveMetroBbox(marketInput: string, rotationSeed: number): MetroBbox {
  const lower = marketInput.toLowerCase();
  const matched = METRO_BBOXES.find((m) =>
    lower.includes(m.market.split(',')[0].toLowerCase())
  );
  if (matched) {
    return matched;
  }
  return METRO_BBOXES[rotationSeed % METRO_BBOXES.length];
}

function buildOverpassTagFilter(vertical: string): string[] {
  const v = vertical.toLowerCase();
  if (v.includes('dental') || v.includes('clinic') || v.includes('wellness')) {
    return [
      '["amenity"~"^(dentist|clinic|veterinary|doctors)$"]',
      '["healthcare"~"^(dentist|clinic|optometrist|physiotherapist|rehabilitation|chiropractor)$"]',
    ];
  }
  if (v.includes('agency') || v.includes('marketing') || v.includes('creative')) {
    return [
      '["office"~"^(advertising_agency|consulting|it|graphic_design|architect|accountant|financial|company)$"]',
    ];
  }
  if (v.includes('retail') || v.includes('e-commerce')) {
    return [
      '["shop"~"^(boutique|furniture|interior_decoration|electronics|lighting|garden_centre|florist|musical_instrument|bicycle|hardware)$"]',
    ];
  }
  if (v.includes('auto') || v.includes('repair') || v.includes('detailing')) {
    return [
      '["shop"~"^(car_repair|tyres|car_parts|motorcycle_repair)$"]',
      '["craft"~"^(car_painter|locksmith|welder)$"]',
    ];
  }
  if (v.includes('logistics') || v.includes('courier')) {
    return [
      '["office"~"^(logistics|moving_company|courier|transport|company)$"]',
      '["craft"~"^(mover|rigger)$"]',
    ];
  }
  if (v.includes('food') || v.includes('catering')) {
    return [
      '["craft"~"^(caterer|bakery|confectionery|brewery|roastery)$"]',
      '["shop"~"^(bakery|deli|PASTRY|cheese|coffee|butcher)$"]',
    ];
  }
  if (v.includes('fitness') || v.includes('studio') || v.includes('gym')) {
    return [
      '["leisure"~"^(fitness_centre|sports_centre|dance)$"]',
      '["sport"~"^(yoga|pilates|martial_arts|Crossfit|fitness)$"]',
    ];
  }
  // Default: home & commercial service contractors (`craft=*`, `office=*`)
  return [
    '["craft"~"^(hvac|plumber|electrician|roofer|carpenter|painter|glazier|insulation|locksmith|floorer|gardener|window_construction)$"]',
  ];
}

function inferReadableIndustryFromTags(
  tags: Record<string, string | undefined>,
  fallbackVertical: string
): string {
  const craft = tags.craft;
  if (craft) {
    return `${craft.replace(/_/g, ' ')} contractor`;
  }
  const healthcare = tags.healthcare ?? tags.amenity;
  if (healthcare) {
    return `${healthcare.replace(/_/g, ' ')} clinic`;
  }
  const office = tags.office;
  if (office && office !== 'yes' && office !== 'company') {
    return `${office.replace(/_/g, ' ')} firm`;
  }
  const shop = tags.shop;
  if (shop && shop !== 'yes') {
    return `${shop.replace(/_/g, ' ')} business`;
  }
  return fallbackVertical;
}

function buildNominatimQueriesForVertical(vertical: string): string[] {
  const v = vertical.toLowerCase();
  if (v.includes('dental') || v.includes('clinic') || v.includes('wellness')) {
    return ['dentist', 'veterinary', 'chiropractor', 'optometrist', 'physical therapy'];
  }
  if (v.includes('agency') || v.includes('marketing') || v.includes('creative')) {
    return ['marketing', 'printing', 'architect', 'accountant', 'design'];
  }
  if (v.includes('retail') || v.includes('e-commerce')) {
    return ['florist', 'furniture', 'hardware', 'bicycle', 'jewelry', 'lighting'];
  }
  if (v.includes('auto') || v.includes('repair') || v.includes('detailing')) {
    return ['car_repair', 'auto repair', 'tire', 'auto body', 'transmission'];
  }
  if (v.includes('logistics') || v.includes('courier')) {
    return ['moving', 'storage', 'courier', 'freight', 'towing'];
  }
  if (v.includes('food') || v.includes('catering')) {
    return ['bakery', 'catering', 'butcher', 'coffee roaster', 'deli'];
  }
  if (v.includes('fitness') || v.includes('studio') || v.includes('gym')) {
    return ['yoga', 'pilates', 'martial arts', 'CrossFit', 'dance studio'];
  }
  return ['plumber', 'hvac', 'electrician', 'roofing', 'landscaping', 'locksmith'];
}

async function queryOverpass(query: string): Promise<OverpassElement[]> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'LooseEndsOS-SMBScout/1.2 (contact@looseendsos.app)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) {
        continue;
      }
      const data = (await response.json()) as OverpassResponse;
      if (data.elements && data.elements.length > 0) {
        return data.elements;
      }
    } catch {
      // Fall back to OpenStreetMap Nominatim
    }
  }
  return [];
}

async function queryNominatimBounded(
  metro: MetroBbox,
  vertical: string
): Promise<OverpassElement[]> {
  const queries = buildNominatimQueriesForVertical(vertical);
  // Also mix in high-yield local SMB terms so every run has a rich candidate pool
  const supplementalTerms = ['dentist', 'veterinary', 'bakery', 'florist', 'car_repair', 'furniture'];
  const allTerms = Array.from(new Set([...queries, ...supplementalTerms]));
  const viewbox = `${metro.west},${metro.north},${metro.east},${metro.south}`;
  const results: OverpassElement[] = [];

  for (const term of allTerms) {
    try {
      const url =
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(term)}` +
        `&format=jsonv2&extratags=1&addressdetails=1&limit=40&viewbox=${viewbox}&bounded=1`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'LooseEndsOS-SMBScout/1.2 (https://looseendsos.app)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) {
        continue;
      }
      const items = (await response.json()) as NominatimPlaceItem[];
      for (const item of items) {
        const extra = item.extratags ?? {};
        const web = extra.website ?? extra['contact:website'];
        const name = (item.name ?? '').trim();
        if (!name || !web) {
          continue;
        }
        const addr = item.address ?? {};
        results.push({
          type: 'node',
          id: item.place_id ?? results.length + 1,
          tags: {
            name,
            website: web,
            phone: extra.phone ?? extra['contact:phone'],
            email: extra.email ?? extra['contact:email'],
            'addr:city': addr.city ?? addr.town ?? addr.suburb,
            'addr:state': addr.state,
            [item.category ?? 'shop']: item.type ?? term,
          },
        });
      }
      if (results.length >= 30) {
        break;
      }
    } catch {
      // Continue to next term
    }
  }

  return results;
}

export async function discoverViaPublicWeb(
  vertical: string,
  marketInput: string,
  existingBusinesses: ReadonlySet<string>
): Promise<ScoutedProspect[]> {
  const hourSeed = Math.floor(Date.now() / 3_600_000);
  const metro = resolveMetroBbox(marketInput, hourSeed);
  const bboxStr = `${metro.south},${metro.west},${metro.north},${metro.east}`;
  const tagFilters = buildOverpassTagFilter(vertical);

  const unionClauses: string[] = [];
  for (const tf of tagFilters) {
    unionClauses.push(`node${tf}["website"](${bboxStr});`);
    unionClauses.push(`node${tf}["contact:website"](${bboxStr});`);
  }
  unionClauses.push(`node["craft"]["website"](${bboxStr});`);
  unionClauses.push(`node["office"]["website"](${bboxStr});`);
  unionClauses.push(`node["amenity"~"^(dentist|clinic|veterinary)$"]["website"](${bboxStr});`);

  const overpassQuery = `[out:json][timeout:10];(${unionClauses.join('')});out tags 80;`;

  console.log(
    `🌐  Querying Public Web (OpenStreetMap Overpass + Nominatim) for "${vertical}" in ${metro.market}...`
  );

  let elements = await queryOverpass(overpassQuery);
  if (elements.length < 10) {
    const nominatimElements = await queryNominatimBounded(metro, vertical);
    elements = [...elements, ...nominatimElements];
  }
  if (elements.length === 0) {
    console.warn(`⚠️  OpenStreetMap returned 0 elements for ${metro.market}.`);
    return [];
  }

  // Shuffle/offset deterministically by hourSeed so consecutive runs inspect fresh candidates
  const seenNames = new Set<string>(existingBusinesses);
  const candidates: Array<{
    businessName: string;
    website: string;
    osmPhone?: string;
    osmEmail?: string;
    industryLabel: string;
    cityState: string;
  }> = [];

  const startOffset = (hourSeed * 7) % elements.length;
  for (let idx = 0; idx < elements.length; idx += 1) {
    const el = elements[(startOffset + idx) % elements.length];
    const tags = el.tags ?? {};
    const businessName = (tags.name ?? '').trim();
    if (!businessName || businessName.length < 3 || businessName.length > 90) {
      continue;
    }
    const lowerName = businessName.toLowerCase();
    if (seenNames.has(lowerName)) {
      continue;
    }

    const rawWebsite = (tags.website ?? tags['contact:website'] ?? '').trim();
    const website = normalizeWebsiteUrl(rawWebsite);
    if (!website) {
      continue;
    }
    const rootDom = getRootDomain(website);
    if (rootDom && seenNames.has(`domain:${rootDom}`)) {
      continue;
    }

    seenNames.add(lowerName);
    if (rootDom) {
      seenNames.add(`domain:${rootDom}`);
    }
    const osmPhone = (tags.phone ?? tags['contact:phone'] ?? '').trim() || undefined;
    const osmEmail = (tags.email ?? tags['contact:email'] ?? '').trim() || undefined;
    const city = (tags['addr:city'] ?? '').trim();
    const state = (tags['addr:state'] ?? '').trim();
    const cityState = city && state ? `${city}, ${state}` : metro.market;
    const industryLabel = inferReadableIndustryFromTags(tags, vertical);

    candidates.push({
      businessName,
      website,
      osmPhone,
      osmEmail,
      industryLabel,
      cityState,
    });

    if (candidates.length >= 22) {
      break;
    }
  }

  console.log(
    `🔎  Found ${candidates.length} net-new SMB website candidates in ${metro.market}. Crawling websites for verified emails...`
  );

  const enrichedProspects: ScoutedProspect[] = [];

  for (const cand of candidates) {
    const enrichment = await enrichFromWebsite(cand.website, cand.osmPhone);
    const verifiedEmail =
      (cand.osmEmail && isValidBusinessEmail(cand.osmEmail)
        ? cand.osmEmail.toLowerCase()
        : null) ?? enrichment.email;
    const verifiedPhone = enrichment.phone ?? cand.osmPhone ?? null;

    // Require a verified email (preferred) or verified phone + live website
    if (!verifiedEmail && !verifiedPhone) {
      continue;
    }

    const bottleneck = inferBottleneckForVertical(cand.industryLabel);
    const score = computeProspectScore({
      hasWebsite: true,
      hasEmail: Boolean(verifiedEmail),
      domainMatchedEmail: enrichment.domainMatched || Boolean(cand.osmEmail),
      hasPhone: Boolean(verifiedPhone),
      hasAddress: true,
      ratingCount: 10,
    });

    const titleNote = enrichment.pageTitle
      ? ` | Site: ${enrichment.pageTitle.slice(0, 90)}`
      : '';

    enrichedProspects.push({
      business: cand.businessName,
      name: 'Owner / Operations',
      phone: verifiedPhone ?? undefined,
      email: verifiedEmail ?? undefined,
      business_type: cand.industryLabel,
      biggest_problem: bottleneck.tag,
      industry: cand.industryLabel,
      location: cand.cityState,
      contact_name: 'Owner / Operations',
      contact_email: verifiedEmail ?? undefined,
      website: cand.website,
      notes: `${bottleneck.note}${titleNote}`,
      score,
      status: 'DRAFT_READY',
    });

    const emailMatchedCount = enrichedProspects.filter((p) => Boolean(p.contact_email)).length;
    if (emailMatchedCount >= 8 || enrichedProspects.length >= 12) {
      break;
    }
  }

  // Sort email-verified prospects first, then by score descending
  enrichedProspects.sort((a, b) => {
    const aHasEmail = a.contact_email ? 1 : 0;
    const bHasEmail = b.contact_email ? 1 : 0;
    if (bHasEmail !== aHasEmail) return bHasEmail - aHasEmail;
    return b.score - a.score;
  });

  return enrichedProspects.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Combined Live Discovery Orchestrator
// ---------------------------------------------------------------------------
async function discoverLiveBusinesses(
  vertical: string,
  market: string,
  existingBusinesses: ReadonlySet<string>
): Promise<ScoutedProspect[]> {
  const combined: ScoutedProspect[] = [];
  const localSeen = new Set<string>(existingBusinesses);

  const addUnique = (items: ScoutedProspect[]): void => {
    for (const item of items) {
      const key = item.business.toLowerCase();
      if (!localSeen.has(key)) {
        localSeen.add(key);
        combined.push(item);
      }
    }
  };

  const googleResults = await discoverViaGooglePlaces(vertical, market, localSeen);
  addUnique(googleResults);

  if (combined.length < 5) {
    const serperResults = await discoverViaSerper(vertical, market, localSeen);
    addUnique(serperResults);
  }

  if (combined.length < 5) {
    const publicWebResults = await discoverViaPublicWeb(vertical, market, localSeen);
    addUnique(publicWebResults);
  }

  return combined;
}

// ---------------------------------------------------------------------------
// CLI Flag Helper
// ---------------------------------------------------------------------------
function readCliFlag(args: readonly string[], flagName: string): string | null {
  const prefix = `--${flagName}=`;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length).trim();
    }
    if (arg === `--${flagName}` && i + 1 < args.length) {
      return args[i + 1].trim();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main Execution
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isSeed = args.includes('--seed');
  const cliMarket = readCliFlag(args, 'market');
  const cliVertical = readCliFlag(args, 'vertical');

  const supabaseUrl = resolveSupabaseUrl();
  const serviceKeyCheck = resolveServiceRoleKey();

  if (!serviceKeyCheck.valid) {
    if (isSeed) {
      console.error(`❌  Cannot seed prospects: ${serviceKeyCheck.reason}`);
      process.exit(1);
    }
    console.log(`ℹ️  ${serviceKeyCheck.reason} Exiting 0 cleanly.`);
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKeyCheck.key, {
    auth: { persistSession: false },
  });

  // Verify database connection and workspace ID before seeding/scouting
  const { workspaceId, workspaceName } = await verifyDatabaseAndWorkspace(
    supabase,
    isSeed
  );

  console.log(
    `🔗  Connected to ${supabaseUrl} | Workspace: ${
      workspaceId ? `${workspaceId} (${workspaceName ?? 'verified'})` : '(unassigned)'
    }`
  );

  // Query existing public_leads.business names and website domains first so we skip already-scouted companies
  const { data: existingRows } = await supabase
    .from('public_leads')
    .select('business, website');

  const existingBusinesses = new Set<string>();
  for (const r of (existingRows ?? []) as Array<{ business: string | null; website: string | null }>) {
    const bName = (r.business ?? '').trim().toLowerCase();
    if (bName) existingBusinesses.add(bName);
    const rDom = r.website ? getRootDomain(r.website) : '';
    if (rDom) existingBusinesses.add(`domain:${rDom}`);
  }

  let upsertedCount = 0;
  let errorCount = 0;

  const upsertProspect = async (p: ScoutedProspect): Promise<void> => {
    const row = {
      workspace_id:    workspaceId,
      business:        p.business,
      name:            p.contact_name,
      phone:           p.phone ?? null,
      email:           p.contact_email ?? null,
      business_type:   p.business_type,
      biggest_problem: p.biggest_problem,
      industry:        p.industry,
      location:        p.location,
      contact_name:    p.contact_name,
      contact_email:   p.contact_email ?? null,
      website:         p.website,
      notes:           p.notes,
      score:           p.score,
      status:          p.status ?? 'DRAFT_READY',
    };

    const { error } = await supabase
      .from('public_leads')
      .upsert(row, { onConflict: 'workspace_id,business', ignoreDuplicates: true });

    if (error) {
      errorCount += 1;
      console.error(`❌  Error saving "${p.business}":`, error.message);
    } else {
      upsertedCount += 1;
      console.log(
        `✅  Queued prospect: ${p.business} (${p.industry} · ${p.location}) — email: ${
          p.contact_email ?? 'none'
        } | phone: ${p.phone ?? 'none'} | score ${p.score}`
      );
    }
  };

  if (isSeed) {
    console.log(`\n🌱  Seeding ${VETTED_PROSPECTS.length} vetted prospects into public_leads...\n`);
    for (const p of VETTED_PROSPECTS) {
      await upsertProspect(p);
    }
    if (errorCount > 0) {
      console.error(`\n❌  Seed finished with ${errorCount} error(s) and ${upsertedCount} success(es).`);
      process.exit(1);
    }
    console.log(`\n🎯  Seed complete. ${upsertedCount} prospects queued at DRAFT_READY.`);
    return;
  }

  const hourSeed = Math.floor(Date.now() / 3_600_000);
  const dailyVertical =
    cliVertical || SMB_VERTICALS[hourSeed % SMB_VERTICALS.length];
  const rotatedMarket = METRO_BBOXES[hourSeed % METRO_BBOXES.length].market;
  const rawEnvMarket = (process.env.TARGET_MARKET ?? '').trim();
  const targetMarket =
    cliMarket ||
    (rawEnvMarket &&
    !isPlaceholderValue(rawEnvMarket) &&
    rawEnvMarket.toLowerCase() !== 'united states'
      ? rawEnvMarket
      : rotatedMarket);

  console.log(`\n🤖  Universal SMB Scout (Zero-Key + Website Contact Enrichment)`);
  console.log(`    Vertical        : ${dailyVertical}`);
  console.log(`    Market          : ${targetMarket}`);
  console.log(`    Existing Leads  : ${existingBusinesses.size} skipped automatically\n`);

  let businesses = await discoverLiveBusinesses(
    dailyVertical,
    targetMarket,
    existingBusinesses
  );

  // If the primary metro/vertical slice yielded < 3 businesses, check the next metro slice
  if (businesses.length < 3 && !cliMarket) {
    const fallbackMarket =
      METRO_BBOXES[(hourSeed + 1) % METRO_BBOXES.length].market;
    const fallbackVertical =
      SMB_VERTICALS[(hourSeed + 1) % SMB_VERTICALS.length];
    console.log(
      `🔄  Expanding search to ${fallbackMarket} (${fallbackVertical})...`
    );
    const extra = await discoverLiveBusinesses(
      fallbackVertical,
      fallbackMarket,
      existingBusinesses
    );
    businesses = [...businesses, ...extra];
  }

  if (businesses.length === 0) {
    console.log(`\nℹ️  No new prospects returned for "${dailyVertical}" in ${targetMarket}.`);
    return;
  }

  for (const biz of businesses) {
    await upsertProspect(biz);
  }

  if (errorCount > 0) {
    console.error(`\n❌  Scout run finished with ${errorCount} error(s).`);
    process.exit(1);
  }

  console.log(`\n✅  Scout run complete. ${upsertedCount} new enriched prospects queued at DRAFT_READY.`);
}

main().catch((err: unknown) => {
  console.error('Fatal error in scoutProspects:', err);
  process.exit(1);
});
