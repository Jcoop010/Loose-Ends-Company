import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../supabase'

export function AuthGate({ children }: { children: ReactNode }) {
  const [sessionReady, setSessionReady] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSessionReady(!!data.session)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) setSessionReady(!!nextSession)
    })
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true); setError(''); setMessage('')
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    if (authError) setError(authError.message)
    else setMessage('Check your email for your secure sign-in link.')
    setBusy(false)
  }

  if (!sessionReady) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.06] p-8 shadow-2xl">
          <div className="text-sm font-semibold tracking-[0.2em] text-orange-400 uppercase">Loose Ends</div>
          <h1 className="mt-3 text-3xl font-bold">Revenue Recovery OS</h1>
          <p className="mt-3 text-slate-300">Sign in to keep your customers, opportunities, and recovered revenue synced securely.</p>
          <form onSubmit={sendMagicLink} className="mt-7 space-y-3">
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" required placeholder="you@company.com" className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-orange-400" />
            <button disabled={busy} className="w-full rounded-xl bg-orange-500 px-4 py-3 font-semibold text-white disabled:opacity-60">{busy ? 'Sending…' : 'Send secure sign-in link'}</button>
          </form>
          {message && <p className="mt-4 text-sm text-emerald-300">{message}</p>}
          {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
          <p className="mt-6 text-xs text-slate-400">No password to remember. Your account and workspace are protected by Supabase Auth.</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
