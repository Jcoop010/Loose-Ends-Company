import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../supabase'

const pageStyle: React.CSSProperties = {
  minHeight: '100vh', background: '#020617', color: '#fff', display: 'flex',
  alignItems: 'center', justifyContent: 'center', padding: 24, boxSizing: 'border-box',
  fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
}
const cardStyle: React.CSSProperties = {
  width: '100%', maxWidth: 440, boxSizing: 'border-box', borderRadius: 28,
  border: '1px solid rgba(255,255,255,.12)', background: 'rgba(15,23,42,.92)',
  padding: 32, boxShadow: '0 30px 80px rgba(0,0,0,.45)', backdropFilter: 'blur(18px)',
}
const labelStyle: React.CSSProperties = {
  color: '#fb923c', fontSize: 12, fontWeight: 800, letterSpacing: '.18em', textTransform: 'uppercase',
}
const titleStyle: React.CSSProperties = { margin: '10px 0 0', fontSize: 32, lineHeight: 1.15, fontWeight: 800, letterSpacing: '-.03em' }
const bodyStyle: React.CSSProperties = { margin: '12px 0 0', color: '#cbd5e1', fontSize: 15, lineHeight: 1.65 }
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', borderRadius: 14, border: '1px solid rgba(255,255,255,.14)',
  background: '#020617', color: '#fff', padding: '15px 16px', fontSize: 16, outline: 'none',
}
const buttonStyle: React.CSSProperties = {
  width: '100%', border: 0, borderRadius: 14, background: '#f97316', color: '#fff',
  padding: '15px 16px', fontSize: 16, fontWeight: 800, cursor: 'pointer',
}

const isLocalDevelopment = import.meta.env.DEV && import.meta.env.VITE_ALLOW_LOCAL_WORKSPACE === 'true'

export function AuthGate({ children }: { children: ReactNode }) {
  const [sessionReady, setSessionReady] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [localMode, setLocalMode] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession()
      .then(({ data }) => { if (mounted) setSessionReady(!!data.session) })
      .catch(() => { if (mounted) setError('Supabase Auth is unavailable right now. Please try again.') })
      .finally(() => { if (mounted) setCheckingSession(false) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) setSessionReady(!!nextSession)
    })
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
          shouldCreateUser: true,
        },
      })
      if (authError) setError(authError.message)
      else setMessage('Check your email for your secure sign-in link.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to contact Supabase Auth.')
    } finally {
      setBusy(false)
    }
  }

  if (sessionReady || localMode) return <>{children}</>

  if (checkingSession) {
    return (
      <div style={pageStyle}>
        <main style={cardStyle} aria-label="Loading Loose Ends">
          <div style={labelStyle}>Loose Ends</div>
          <h1 style={titleStyle}>Revenue Recovery OS</h1>
          <p style={bodyStyle}>Connecting your secure workspace…</p>
        </main>
      </div>
    )
  }

  return (
    <div style={pageStyle}>
      <main style={cardStyle} aria-label="Loose Ends sign in">
        <div style={labelStyle}>Loose Ends</div>
        <h1 style={titleStyle}>Revenue Recovery OS</h1>
        <p style={bodyStyle}>Sign in to keep your customers, opportunities, and recovered revenue synced securely.</p>
        <form onSubmit={sendMagicLink} style={{ marginTop: 28, display: 'grid', gap: 12 }}>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" required autoComplete="email" placeholder="you@company.com" style={inputStyle} />
          <button disabled={busy} type="submit" style={{ ...buttonStyle, opacity: busy ? .6 : 1 }}>{busy ? 'Sending…' : 'Send secure sign-in link'}</button>
        </form>
        {message && <p style={{ marginTop: 16, color: '#86efac', fontSize: 14 }}>{message}</p>}
        {error && <p style={{ marginTop: 16, color: '#fca5a5', fontSize: 14 }}>{error}</p>}
        {isLocalDevelopment && (
          <>
            <button type="button" onClick={() => { setError(''); setLocalMode(true) }} style={{ ...buttonStyle, marginTop: 12, background: 'transparent', border: '1px solid rgba(255,255,255,.16)', color: '#cbd5e1' }}>
              Open local workspace
            </button>
            <p style={{ margin: '14px 0 0', color: '#64748b', fontSize: 11, lineHeight: 1.55 }}>
              Development-only local mode is enabled for this build. It is never available in production.
            </p>
          </>
        )}
        <p style={{ margin: '18px 0 0', color: '#94a3b8', fontSize: 12, lineHeight: 1.6 }}>No password to remember. Your account and workspace are protected by Supabase Auth.</p>
      </main>
    </div>
  )
}
