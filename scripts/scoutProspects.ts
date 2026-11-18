/**
 * scripts/scoutProspects.ts
 *
 * Universal SMB Prospect Scouting Agent for Loose Ends.
 *
 * Usage:
 *   npx tsx scripts/scoutProspects.ts              # rotate today's vertical
 *   npx tsx scripts/scoutProspects.ts --seed        # load 20 vetted prospects into DB
 *   TARGET_MARKET="Dallas, TX" npx tsx scripts/scoutProspects.ts
 *
 * Required env vars:
 *   VITE_SUPABASE_URL          Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  Service-role key (bypasses RLS; never expose client-side)
 *
 * Optional env vars:
 *   DEFAULT_WORKSPACE_ID       Workspace UUID to associate discovered leads
 *   TARGET_MARKET              Override location string (default: "United States")
 *
 * To wire in live discovery, implement discoverLiveBusinesses() below using
 * Google Places API, Serper.dev, Hunter.io, or Apollo.io.
 */

import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    '❌  Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
    '    Copy .env.example → .env.local and fill in your Supabase credentials.'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BottleneckTag =
  | 'unbilled_work'
  | 'stale_quotes'
  | 'inventory_stockouts'
  | 'overdue_invoices';

interface ScoutedProspect {
  /** Must match public_leads.business unique constraint — used as upsert key */
  business:        string;
  name:            string;   // primary decision-maker name (contact_name in DB)
  phone?:          string;
  email?:          string;
  business_type:   string;   // maps to industry
  biggest_problem: BottleneckTag;
  industry:        string;
  location:        string;
  contact_name:    string;
  contact_email?:  string;
  website:         string;
  notes:           string;
  score:           number;   // 0–100 qualification score
  status?:         'DRAFT_READY' | 'OWNER_APPROVED' | 'CONTACTED' | 'DEMO_SCHEDULED' | 'PILOT_SOLD' | 'LOST';
}

// ---------------------------------------------------------------------------
// Broad SMB categories — rotated daily for organic outreach diversity
// ---------------------------------------------------------------------------
const SMB_VERTICALS = [
  'boutique retail & e-commerce',
  'dental & wellness clinics',
  'marketing & creative agencies',
  'auto repair & detailing shops',
  'local logistics & courier services',
  'specialty food & catering',
  'home & commercial service contractors',
  'fitness studios & gyms',
];

// ---------------------------------------------------------------------------
// 20 Vetted Prospects — researched & scored (Nov 2026)
// Status DRAFT_READY: awaiting owner approval before any outreach is sent.
// ---------------------------------------------------------------------------
const VETTED_PROSPECTS: ScoutedProspect[] = [
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
// Live discovery adapter — connect your preferred API here
// ---------------------------------------------------------------------------
async function discoverLiveBusinesses(
  vertical: string,
  location: string
): Promise<ScoutedProspect[]> {
  // -------------------------------------------------------------------------
  // Replace this stub with a live API call, e.g.:
  //
  //   Google Places Text Search:
  //     const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(vertical + ' in ' + location)}&key=${process.env.GOOGLE_PLACES_API_KEY}`;
  //
  //   Serper.dev (web search):
  //     const res = await fetch('https://google.serper.dev/search', {
  //       method: 'POST',
  //       headers: { 'X-API-KEY': process.env.SERPER_API_KEY!, 'Content-Type': 'application/json' },
  //       body: JSON.stringify({ q: `${vertical} ${location} contact email` }),
  //     });
  //
  //   Hunter.io (domain-to-email):
  //     const res = await fetch(`https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${process.env.HUNTER_API_KEY}`);
  // -------------------------------------------------------------------------
  console.log(`🔍  [stub] Live discovery for "${vertical}" in ${location} — no API key configured.`);
  console.log(`    Wire in Google Places, Serper, or Hunter.io in discoverLiveBusinesses().`);
  return [];
}

// ---------------------------------------------------------------------------
// DB upsert
// ---------------------------------------------------------------------------
async function upsertProspect(p: ScoutedProspect): Promise<void> {
  const workspaceId = process.env.DEFAULT_WORKSPACE_ID ?? null;

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
    .upsert(row, { onConflict: 'business' });

  if (error) {
    console.error(`❌  Error saving "${p.business}":`, error.message);
  } else {
    console.log(`✅  Queued prospect: ${p.business} (${p.industry}) — score ${p.score}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isSeed = args.includes('--seed');

  if (isSeed) {
    // --seed: load all 20 vetted prospects into the DB
    console.log(`\n🌱  Seeding ${VETTED_PROSPECTS.length} vetted prospects into public_leads...\n`);
    for (const p of VETTED_PROSPECTS) {
      await upsertProspect(p);
    }
    console.log(`\n🎯  Seed complete. ${VETTED_PROSPECTS.length} prospects at DRAFT_READY.`);
    console.log(`    Open the revenue-acquisition-mission artifact for outreach playbooks.`);
    return;
  }

  // Default: rotate verticals and run live discovery
  const targetLocation = process.env.TARGET_MARKET ?? 'United States';
  const dailyVertical  = SMB_VERTICALS[new Date().getDay() % SMB_VERTICALS.length];

  console.log(`\n🤖  Universal SMB Scout`);
  console.log(`    Vertical : ${dailyVertical}`);
  console.log(`    Market   : ${targetLocation}`);
  console.log(`    Workspace: ${process.env.DEFAULT_WORKSPACE_ID ?? '(none — set DEFAULT_WORKSPACE_ID)'}\n`);

  const businesses = await discoverLiveBusinesses(dailyVertical, targetLocation);

  if (businesses.length === 0) {
    console.log(`\nℹ️   No live prospects discovered.`);
    console.log(`    Run with --seed to load the 20 pre-vetted prospects, or`);
    console.log(`    implement discoverLiveBusinesses() with a live API key.`);
    return;
  }

  for (const biz of businesses) {
    await upsertProspect(biz);
  }

  console.log(`\n✅  Scout run complete. ${businesses.length} prospects queued.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
