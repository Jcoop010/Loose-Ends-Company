import type {
  CommunicationDraftChannel,
  ConsentChannel,
} from '../types/domain'

export const CAN_SPAM_PHYSICAL_ADDRESS = '421 Hill Street, Parkersburg, WV 26104'
export const CAN_SPAM_B2B_EVIDENCE_REF = 'CAN-SPAM-B2B-FOOTER-VERIFIED'

const NORMALIZED_PHYSICAL_ADDRESS = CAN_SPAM_PHYSICAL_ADDRESS.toLowerCase()
const UNSUBSCRIBE_OR_OPTOUT_REGEX = /\b(unsubscribe|opt[\s-]?out)\b/i

export interface ConsentStatusLike {
  decision?: string | null
  status?: string | null
  evidence_reference?: string | null
}

export type DraftComplianceBasis =
  | 'recorded_consent'
  | 'can_spam_b2b'
  | 'blocked_opt_out'
  | 'blocked_missing_footer'
  | 'blocked_missing_opt_in'

export interface DraftComplianceEvaluation {
  allowed: boolean
  basis: DraftComplianceBasis
  badgeLabel: string
  badgeTone: 'emerald' | 'rose'
  blockReason: string | null
}

/**
 * Checks whether an outreach body includes the required physical business address.
 */
export function hasPhysicalMailingAddress(message: string): boolean {
  const normalized = message.toLowerCase().replace(/\s+/g, ' ')
  return normalized.includes(NORMALIZED_PHYSICAL_ADDRESS)
}

/**
 * Checks whether an outreach body includes an explicit unsubscribe or opt-out notice.
 */
export function hasUnsubscribeInstruction(message: string): boolean {
  return UNSUBSCRIBE_OR_OPTOUT_REGEX.test(message)
}

/**
 * Returns true only when both the physical mailing address and opt-out instruction are present.
 */
export function isCanSpamFooterCompliant(message: string): boolean {
  return hasPhysicalMailingAddress(message) && hasUnsubscribeInstruction(message)
}

/**
 * Returns true when a consent or suppression record revokes or opts out future outreach.
 */
export function isConsentEventSuppressed(
  ev: Pick<ConsentStatusLike, 'decision' | 'status'> | null | undefined,
): boolean {
  if (!ev) return false
  return (
    ev.decision === 'revoked' ||
    ev.status === 'opted_out' ||
    ev.status === 'revoked'
  )
}

/**
 * Evaluates channel-specific compliance rules for outbound communication drafts:
 * - Any channel is hard-blocked if the customer or recipient email opted out / revoked.
 * - SMS and call strictly require prior recorded `granted` opt-in.
 * - Email allows B2B cold outreach without prior opt-in when CAN-SPAM footer requirements hold.
 */
export function evaluateDraftCompliance(params: {
  channel: CommunicationDraftChannel | ConsentChannel
  message: string
  latestConsent?: ConsentStatusLike | null
  emailSuppressed?: boolean
}): DraftComplianceEvaluation {
  const { channel, message, latestConsent, emailSuppressed = false } = params
  const channelUpper = channel.toUpperCase()

  if (emailSuppressed || isConsentEventSuppressed(latestConsent)) {
    const refSuffix = latestConsent?.evidence_reference
      ? ` (${latestConsent.evidence_reference})`
      : ''
    return {
      allowed: false,
      basis: 'blocked_opt_out',
      badgeLabel: 'Consent Revoked',
      badgeTone: 'rose',
      blockReason: `Blocked: Customer or recipient ${channelUpper} consent was revoked / opted out${refSuffix}`,
    }
  }

  if (latestConsent?.decision === 'granted') {
    return {
      allowed: true,
      basis: 'recorded_consent',
      badgeLabel: 'Consent Granted',
      badgeTone: 'emerald',
      blockReason: null,
    }
  }

  if (channel === 'email') {
    if (isCanSpamFooterCompliant(message)) {
      return {
        allowed: true,
        basis: 'can_spam_b2b',
        badgeLabel: 'CAN-SPAM Ready (B2B)',
        badgeTone: 'emerald',
        blockReason: null,
      }
    }

    const missingParts: string[] = []
    if (!hasPhysicalMailingAddress(message)) {
      missingParts.push(`physical address (${CAN_SPAM_PHYSICAL_ADDRESS})`)
    }
    if (!hasUnsubscribeInstruction(message)) {
      missingParts.push('unsubscribe / opt-out instruction')
    }
    return {
      allowed: false,
      basis: 'blocked_missing_footer',
      badgeLabel: 'CAN-SPAM Footer Missing',
      badgeTone: 'rose',
      blockReason: `Blocked: B2B email missing ${missingParts.join(' and ')} (or recorded EMAIL opt-in)`,
    }
  }

  return {
    allowed: false,
    basis: 'blocked_missing_opt_in',
    badgeLabel: 'Consent Missing',
    badgeTone: 'rose',
    blockReason: `Blocked: No recorded ${channelUpper} opt-in on file`,
  }
}
