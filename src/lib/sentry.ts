/**
 * Lightweight Sentry Browser Telemetry Initializer (`VITE_SENTRY_DSN`).
 * Strictly no-op when `import.meta.env.VITE_SENTRY_DSN` is unset so local dev
 * and CI tests never emit external telemetry requests.
 */

interface ParsedSentryDsn {
  envelopeUrl: string
  publicKey: string
  projectId: string
}

let activeDsn: ParsedSentryDsn | null = null

export function parseSentryDsn(rawDsn: string | undefined): ParsedSentryDsn | null {
  const trimmed = (rawDsn ?? '').trim()
  if (!trimmed || !trimmed.startsWith('https://')) {
    return null
  }
  try {
    const parsed = new URL(trimmed)
    const publicKey = parsed.username
    const pathSegments = parsed.pathname.split('/').filter(Boolean)
    const projectId = pathSegments[pathSegments.length - 1] ?? ''
    if (!publicKey || !projectId) {
      return null
    }
    const envelopeUrl = `${parsed.protocol}//${parsed.host}/api/${projectId}/envelope/?sentry_key=${encodeURIComponent(publicKey)}&sentry_version=7`
    return {
      envelopeUrl,
      publicKey,
      projectId,
    }
  } catch {
    return null
  }
}

export function captureSentryException(error: unknown, context?: Record<string, unknown>): void {
  if (!activeDsn || typeof fetch !== 'function') {
    return
  }
  const eventId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now()}0000000000000000000`.slice(0, 32)
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined

  const header = JSON.stringify({
    event_id: eventId,
    sent_at: new Date().toISOString(),
  })
  const itemHeader = JSON.stringify({ type: 'event' })
  const payload = JSON.stringify({
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    environment: import.meta.env?.MODE ?? 'production',
    level: 'error',
    message,
    extra: {
      stack,
      ...context,
    },
  })

  const envelope = `${header}\n${itemHeader}\n${payload}`
  void fetch(activeDsn.envelopeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-sentry-envelope' },
    body: envelope,
    keepalive: true,
  }).catch(() => {
    // Telemetry is best-effort
  })
}

export function initSentryTelemetry(): boolean {
  const rawDsn = import.meta.env?.VITE_SENTRY_DSN as string | undefined
  const parsed = parseSentryDsn(rawDsn)
  if (!parsed) {
    activeDsn = null
    return false
  }
  activeDsn = parsed

  if (typeof window !== 'undefined') {
    window.addEventListener('error', event => {
      captureSentryException(event.error ?? event.message, {
        filename: event.filename,
        lineno: event.lineno,
      })
    })
    window.addEventListener('unhandledrejection', event => {
      captureSentryException(event.reason, { type: 'unhandledrejection' })
    })
  }
  return true
}
