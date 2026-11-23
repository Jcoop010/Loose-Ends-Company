import { isCanSpamFooterCompliant } from '../canSpamGuard.ts'
import { countWords, isValidOutboundEmail, normalizeEmail } from '../outbound/sequencerEngine.ts'

export type RegionalKey =
  | 'columbus_oh'
  | 'pittsburgh_pa'
  | 'charleston_wv'
  | 'morgantown_wv'
  | 'roanoke_va'

export type RegionalLaneArg = 'trades_clinics' | 'bookkeepers_cpa' | 'both'
export type ConcreteRegionalLane = 'trades_clinics' | 'bookkeepers_cpa'

export const REGIONAL_SCOUT_DEFAULT_LIMIT = 15
export const REGIONAL_SCOUT_HARD_CAP = 25
export const REGIONAL_CAN_SPAM_FOOTER =
  '421 Hill Street, Parkersburg, WV 26104 | Reply STOP to opt out.'

export interface RegionalMarketSpec {
  key: RegionalKey
  label: string
  south: number
  west: number
  north: number
  east: number
}

export const REGIONAL_MARKETS: Readonly<Record<RegionalKey, RegionalMarketSpec>> = {
  columbus_oh: {
    key: 'columbus_oh',
    label: 'Columbus, OH',
    south: 39.9,
    west: -83.12,
    north: 40.12,
    east: -82.88,
  },
  pittsburgh_pa: {
    key: 'pittsburgh_pa',
    label: 'Pittsburgh, PA',
    south: 40.4,
    west: -80.06,
    north: 40.5,
    east: -79.9,
  },
  charleston_wv: {
    key: 'charleston_wv',
    label: 'Charleston, WV',
    south: 38.3,
    west: -81.72,
    north: 38.4,
    east: -81.56,
  },
  morgantown_wv: {
    key: 'morgantown_wv',
    label: 'Morgantown, WV',
    south: 39.6,
    west: -80.02,
    north: 39.68,
    east: -79.9,
  },
  roanoke_va: {
    key: 'roanoke_va',
    label: 'Roanoke, VA',
    south: 37.22,
    west: -80.02,
    north: 37.33,
    east: -79.88,
  },
}

export interface RegionalScoutOptions {
  region: RegionalKey
  lane: RegionalLaneArg
  limit: number
  mode: 'dry_run' | 'stage'
}

function readFlagValue(args: readonly string[], flag: string): string | null {
  const eqPrefix = `--${flag}=`
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg.startsWith(eqPrefix)) {
      return arg.slice(eqPrefix.length).trim()
    }
    if (arg === `--${flag}` && i + 1 < args.length) {
      return args[i + 1].trim()
    }
  }
  return null
}

/**
 * Parses CLI options for scripts/scoutRegionalLeads.ts.
 * Defaults strictly to `--dry-run`, `--limit 15`, hard-capped at `25`.
 */
export function parseRegionalScoutArgs(args: readonly string[]): RegionalScoutOptions {
  const rawRegion = (readFlagValue(args, 'region') ?? 'columbus_oh').toLowerCase()
  if (!(rawRegion in REGIONAL_MARKETS)) {
    throw new Error(
      `Unsupported --region "${rawRegion}". Expected one of: ${Object.keys(REGIONAL_MARKETS).join(', ')}.`,
    )
  }

  const rawLane = (readFlagValue(args, 'lane') ?? 'both').toLowerCase()
  if (rawLane !== 'trades_clinics' && rawLane !== 'bookkeepers_cpa' && rawLane !== 'both') {
    throw new Error(
      `Unsupported --lane "${rawLane}". Expected: trades_clinics, bookkeepers_cpa, or both.`,
    )
  }

  const rawLimit = readFlagValue(args, 'limit')
  let limit = REGIONAL_SCOUT_DEFAULT_LIMIT
  if (rawLimit !== null) {
    const parsed = Number(rawLimit)
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error(`Invalid --limit "${rawLimit}". Expected integer between 1 and ${REGIONAL_SCOUT_HARD_CAP}.`)
    }
    limit = Math.min(REGIONAL_SCOUT_HARD_CAP, Math.trunc(parsed))
  }

  const isStage = args.includes('--stage') && !args.includes('--dry-run')
  return {
    region: rawRegion as RegionalKey,
    lane: rawLane as RegionalLaneArg,
    limit,
    mode: isStage ? 'stage' : 'dry_run',
  }
}

export interface RegionalCandidateInput {
  business: string
  contact_name: string
  email: string
  phone?: string | null
  website?: string | null
  location: string
  industry: string
  lane: ConcreteRegionalLane
  score: number
}

export interface RegionalDay1Draft {
  lane: ConcreteRegionalLane
  subject: string
  message: string
  word_count: number
}

function shortenCompany(name: string): string {
  const tokens = name.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)
  if (tokens.length === 0) return 'your team'
  const picked: string[] = []
  for (const tok of tokens) {
    if (picked.length >= 4) break
    const candidate = [...picked, tok].join(' ')
    if (candidate.length > 36 && picked.length >= 2) break
    picked.push(tok)
  }
  while (picked.length > 1 && /^(&|and|of|the)$/i.test(picked[picked.length - 1])) {
    picked.pop()
  }
  return picked.join(' ') || 'your team'
}

const GENERIC_ROLE_TOKENS = new Set([
  'owner',
  'practice',
  'managing',
  'principal',
  'office',
  'admin',
  'team',
  'partner',
  'manager',
  'operations',
])

function firstGreeting(contactName: string): string {
  const token = contactName
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^A-Za-z0-9'-]/g, '')
    .slice(0, 18)
  if (!token || GENERIC_ROLE_TOKENS.has(token.toLowerCase())) {
    return 'there'
  }
  return token
}

/**
 * Builds plain-text Day 1 outreach drafts under 75 words total (including CAN-SPAM footer),
 * tailored cleanly for `trades_clinics` or `bookkeepers_cpa`.
 */
export function buildRegionalDay1Draft(params: {
  lane: ConcreteRegionalLane
  companyName: string
  contactName: string
}): RegionalDay1Draft {
  const hi = firstGreeting(params.contactName)
  const co = shortenCompany(params.companyName)

  const subject =
    params.lane === 'bookkeepers_cpa'
      ? `${co}: $0.00-variance CPA Audit Packet + 20% partner split`
      : `${co}: 15-min read-only QuickBooks/invoice leak check`

  const body =
    params.lane === 'bookkeepers_cpa'
      ? `Hi ${hi}, at ${co} you can run clients on a $199/mo flat-rate OS with a 1-Click $0.00-variance CPA Audit Packet and earn a 20% recurring ($40/mo) partner cut. Try https://www.looseendsos.app/demo or reply 'send it' for partner terms.`
      : `Hi ${hi}, want a free 15-min read-only Shadow Mode check on a ${co} QuickBooks or invoice CSV? Estimate seat savings at https://www.looseendsos.app/calculator or test https://www.looseendsos.app/demo — reply 'send it' and I will send the template.`

  const message = `${body}\n\n${REGIONAL_CAN_SPAM_FOOTER}`
  const words = countWords(message)
  if (words >= 75) {
    throw new Error(`Regional Day 1 draft exceeded 75 words (${words}).`)
  }
  if (!isCanSpamFooterCompliant(message)) {
    throw new Error('Regional Day 1 draft failed CAN-SPAM physical address / opt-out verification.')
  }

  return {
    lane: params.lane,
    subject,
    message,
    word_count: words,
  }
}

export function extractRootDomain(urlOrEmail: string | null | undefined): string {
  const raw = (urlOrEmail ?? '').trim().toLowerCase()
  if (!raw) return ''
  if (raw.includes('@')) {
    return raw.split('@')[1]?.trim() ?? ''
  }
  try {
    const withProto = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`
    return new URL(withProto).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export interface DedupeResult {
  accepted: RegionalCandidateInput[]
  skipped_reasons: Record<string, number>
}

/**
 * Filters regional scout candidates against suppression lists, existing `public_leads`
 * names/emails/domains, and intra-batch duplicates, strictly enforcing hard cap <= 25.
 */
export function filterAndDedupeRegionalCandidates(params: {
  candidates: readonly RegionalCandidateInput[]
  existingBusinesses: ReadonlySet<string>
  existingEmails: ReadonlySet<string>
  existingDomains: ReadonlySet<string>
  suppressedEmails: ReadonlySet<string>
  limit: number
}): DedupeResult {
  const hardLimit = Math.max(1, Math.min(REGIONAL_SCOUT_HARD_CAP, Math.trunc(params.limit)))
  const seenBiz = new Set<string>(
    Array.from(params.existingBusinesses).map(s => s.trim().toLowerCase()),
  )
  const seenEmails = new Set<string>(
    Array.from(params.existingEmails).map(s => normalizeEmail(s)),
  )
  const seenDomains = new Set<string>(
    Array.from(params.existingDomains).map(s => s.trim().toLowerCase()),
  )
  const suppressed = new Set<string>(
    Array.from(params.suppressedEmails).map(s => normalizeEmail(s)),
  )

  const skipped: Record<string, number> = {}
  const bumpSkip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1
  }

  const accepted: RegionalCandidateInput[] = []
  for (const cand of params.candidates) {
    if (accepted.length >= hardLimit) {
      bumpSkip('limit_cap_reached')
      break
    }
    const email = normalizeEmail(cand.email)
    const bizKey = cand.business.trim().toLowerCase()
    const webDomain = extractRootDomain(cand.website) || extractRootDomain(email)

    if (!isValidOutboundEmail(email)) {
      bumpSkip('invalid_email')
      continue
    }
    if (suppressed.has(email)) {
      bumpSkip('suppressed_opt_out')
      continue
    }
    if (!bizKey || seenBiz.has(bizKey)) {
      bumpSkip('duplicate_business')
      continue
    }
    if (seenEmails.has(email)) {
      bumpSkip('duplicate_email')
      continue
    }
    if (webDomain && seenDomains.has(webDomain)) {
      bumpSkip('duplicate_domain')
      continue
    }

    seenBiz.add(bizKey)
    seenEmails.add(email)
    if (webDomain) seenDomains.add(webDomain)

    accepted.push({
      ...cand,
      email,
    })
  }

  return { accepted, skipped_reasons: skipped }
}

/**
 * Deterministic offline sample candidates used exclusively for `--dry-run` preview when
 * offline or sandboxed without outbound Overpass/Places access. Never written in `--stage` mode.
 */
export function getCuratedDryRunCandidates(
  region: RegionalKey,
  lane: RegionalLaneArg,
): RegionalCandidateInput[] {
  const loc = REGIONAL_MARKETS[region].label
  const domainTag = region.replace(/_/g, '-')
  const all: RegionalCandidateInput[] = [
    {
      business: `${loc.split(',')[0]} Climate Mechanical LLC`,
      contact_name: 'Owner / Operations',
      email: `dispatch@${domainTag}-climate.example.org`,
      phone: '614-555-0142',
      website: `https://${domainTag}-climate.example.org`,
      location: loc,
      industry: 'HVAC & Mechanical',
      lane: 'trades_clinics',
      score: 88,
    },
    {
      business: `${loc.split(',')[0]} Family Dental Partners`,
      contact_name: 'Practice Manager',
      email: `office@${domainTag}-dental.example.org`,
      phone: '614-555-0168',
      website: `https://${domainTag}-dental.example.org`,
      location: loc,
      industry: 'Dental Clinic',
      lane: 'trades_clinics',
      score: 86,
    },
    {
      business: `${loc.split(',')[0]} Valley Plumbing & Drain`,
      contact_name: 'Owner / Operations',
      email: `service@${domainTag}-plumbing.example.org`,
      phone: '614-555-0181',
      website: `https://${domainTag}-plumbing.example.org`,
      location: loc,
      industry: 'Plumbing & Service Trades',
      lane: 'trades_clinics',
      score: 84,
    },
    {
      business: `${loc.split(',')[0]} Ledger & Tax Advisory CPA`,
      contact_name: 'Managing Partner',
      email: `partners@${domainTag}-cpa.example.org`,
      phone: '614-555-0193',
      website: `https://${domainTag}-cpa.example.org`,
      location: loc,
      industry: 'CPA & Bookkeeping',
      lane: 'bookkeepers_cpa',
      score: 91,
    },
    {
      business: `${loc.split(',')[0]} Small Business Bookkeeping Co`,
      contact_name: 'Principal Bookkeeper',
      email: `hello@${domainTag}-books.example.org`,
      phone: '614-555-0199',
      website: `https://${domainTag}-books.example.org`,
      location: loc,
      industry: 'Bookkeeping Firm',
      lane: 'bookkeepers_cpa',
      score: 89,
    },
  ]

  if (lane === 'both') return all
  return all.filter(item => item.lane === lane)
}
