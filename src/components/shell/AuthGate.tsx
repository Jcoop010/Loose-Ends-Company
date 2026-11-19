import React, { useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Lock,
  Mail,
  Play,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import {
  requestPasswordReset,
  screenPasswordSafety,
  signInWithOtp,
  signInWithPassword,
  signUpWithPassword,
  updateRecoveredPassword,
} from '../../lib/auth'
import { bootstrapWorkspace } from '../../lib/edgeFunctions'
import { isSupabaseConfigured } from '../../lib/supabase'
import { useAppRouter } from '../../state/RouterContext'
import { useSession } from '../../state/SessionContext'
import { Badge } from '../ui/MetricCard'
import { useToast } from '../ui/Toast'

type AuthTab = 'signin' | 'signup' | 'otp' | 'forgot'

export function AuthGate({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const {
    user,
    workspace,
    inPasswordRecovery,
    loading,
    error: sessionError,
    refreshWorkspaceContext,
    clearPasswordRecovery,
    signOut,
  } = useSession()
  const { navigate } = useAppRouter()
  const toast = useToast()

  const [tab, setTab] = useState<AuthTab>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [screeningState, setScreeningState] = useState<'idle' | 'checking' | 'safe' | 'unsafe'>('idle')
  const [screeningMessage, setScreeningMessage] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const runLiveBreachCheck = async (candidate: string) => {
    if (candidate.length < 12) {
      setScreeningState('unsafe')
      setScreeningMessage('Use at least 12 characters for your password.')
      return
    }
    setScreeningState('checking')
    setScreeningMessage(null)
    try {
      await screenPasswordSafety(candidate)
      setScreeningState('safe')
      setScreeningMessage('Verified clean against k-anonymity breach corpus (5-char SHA-1 prefix only).')
    } catch (err) {
      setScreeningState('unsafe')
      setScreeningMessage(err instanceof Error ? err.message : 'Password screening failed.')
    }
  }

  // 1. Dedicated PASSWORD_RECOVERY Reset Flow
  if (inPasswordRecovery) {
    const handleRecoverySubmit = async (event: React.FormEvent) => {
      event.preventDefault()
      setFormError(null)
      setNotice(null)
      setSubmitting(true)
      try {
        await updateRecoveredPassword(password, confirmPassword)
        clearPasswordRecovery()
        setPassword('')
        setConfirmPassword('')
        toast.success(
          'Password updated securely',
          'Sign in with your new password to open your workspace.',
        )
        setTab('signin')
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Password update failed.')
      } finally {
        setSubmitting(false)
      }
    }

    return (
      <div className="min-h-screen flex items-center justify-center p-4 sm:p-6 bg-slate-100/80">
        <div className="exec-surface w-full max-w-md p-6 sm:p-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#c2410c] border border-[#ea580c] text-white">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <Badge tone="amber">Password Recovery Active</Badge>
              <h1 className="mt-1 text-lg font-bold text-slate-900">Set a New Account Password</h1>
            </div>
          </div>

          <p className="mt-3 text-xs sm:text-sm text-slate-600 leading-relaxed">
            Choose a unique 12+ character password. Your browser checks only a 5-character SHA-1
            prefix against known breach lists before updating your credentials.
          </p>

          {formError ? (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
            >
              {formError}
            </div>
          ) : null}

          <form onSubmit={handleRecoverySubmit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="recovery-new-password" className="exec-label">
                New password (12+ characters)
              </label>
              <input
                id="recovery-new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                onChange={e => {
                  setPassword(e.target.value)
                  setScreeningState('idle')
                }}
                onBlur={() => {
                  if (password.length > 0) void runLiveBreachCheck(password)
                }}
                className="exec-input"
              />
              {screeningMessage ? (
                <p
                  className={`mt-1.5 text-xs ${
                    screeningState === 'safe' ? 'text-emerald-700' : 'text-amber-800'
                  }`}
                >
                  {screeningMessage}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="recovery-confirm-password" className="exec-label">
                Confirm new password
              </label>
              <input
                id="recovery-confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="exec-input"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="exec-btn-primary w-full touch-target"
            >
              {submitting ? 'Screening & Updating…' : 'Save New Password'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // 2. Session Hydrating State
  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="min-h-screen flex flex-col items-center justify-center gap-3 p-6"
      >
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
        <p className="text-sm font-medium text-slate-700">Verifying workspace session…</p>
      </div>
    )
  }

  // 3. Authenticated User with Active Workspace
  if (user && workspace) {
    return <>{children}</>
  }

  // 4. Authenticated User without Provisioned Workspace (Bootstrap Recovery)
  if (user && !workspace) {
    const handleManualBootstrap = async (e: React.FormEvent) => {
      e.preventDefault()
      setFormError(null)
      setSubmitting(true)
      try {
        await bootstrapWorkspace({ name: businessName.trim() || 'My Service Workspace' })
        await refreshWorkspaceContext()
        toast.success('Workspace provisioned', 'Your operational ledger is ready.')
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Unable to initialize workspace.')
      } finally {
        setSubmitting(false)
      }
    }

    return (
      <div className="min-h-screen flex items-center justify-center p-4 sm:p-6">
        <div className="exec-surface w-full max-w-md p-6 sm:p-8">
          <Badge tone="brand">Signed in as {user.email}</Badge>
          <h1 className="mt-2 text-xl font-bold text-slate-900">Initialize Your Workspace</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Create your isolated company workspace to unlock quotes, inventory, dispatch, and
            owner-approved revenue recovery.
          </p>

          {sessionError || formError ? (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800"
            >
              {formError || sessionError}
            </div>
          ) : null}

          <form onSubmit={handleManualBootstrap} className="mt-5 space-y-4">
            <div>
              <label htmlFor="bootstrap-business-name" className="exec-label">
                Company / Workspace Name
              </label>
              <input
                id="bootstrap-business-name"
                type="text"
                required
                placeholder="e.g., Ridgeway HVAC & Mechanical"
                value={businessName}
                onChange={e => setBusinessName(e.target.value)}
                className="exec-input"
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="submit"
                disabled={submitting}
                className="exec-btn-primary flex-1 touch-target"
              >
                {submitting ? 'Provisioning…' : 'Create Workspace'}
              </button>
              <button
                type="button"
                onClick={() => void signOut()}
                className="exec-btn-secondary touch-target"
              >
                Sign Out
              </button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  // 5. Public Unauthenticated Gate (Sign In / Sign Up / Magic Link / Forgot Password)
  const switchTab = (next: AuthTab) => {
    setTab(next)
    setFormError(null)
    setNotice(null)
    setScreeningState('idle')
    setScreeningMessage(null)
  }

  const handleAuthSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)
    setNotice(null)
    setSubmitting(true)

    try {
      if (tab === 'signin') {
        await signInWithPassword(email, password)
        toast.success('Signed in', 'Loading your workspace ledger.')
      } else if (tab === 'otp') {
        await signInWithOtp(email)
        setNotice(
          `One-time sign-in link sent to ${email.trim()}. Open the link in your inbox to continue.`,
        )
      } else if (tab === 'forgot') {
        await requestPasswordReset(email)
        setNotice(
          `If an account exists for ${email.trim()}, a password recovery link has been sent.`,
        )
      } else if (tab === 'signup') {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.')
        }
        const result = await signUpWithPassword(email, password)
        setScreeningState('safe')
        if (result.session && businessName.trim()) {
          await bootstrapWorkspace({ name: businessName.trim() })
          await refreshWorkspaceContext()
        } else if (result.requiresEmailConfirmation) {
          setNotice(
            `Verification email sent to ${email.trim()}. Confirm your email to initialize your workspace.`,
          )
        }
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Authentication request could not complete.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-100/70 p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between py-2">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="exec-btn-secondary !py-1.5 !px-3 text-xs touch-target"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Public Overview
        </button>
        <button
          type="button"
          onClick={() => navigate('/demo')}
          className="exec-btn-primary !py-1.5 !px-3.5 text-xs touch-target"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          Launch Interactive Sandbox
        </button>
      </div>

      <div className="mx-auto my-6 grid w-full max-w-4xl grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl lg:grid-cols-12">
        {/* Left Security & Value Column */}
        <div className="exec-rail flex flex-col justify-between p-6 sm:p-8 lg:col-span-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#fb923c]/40 bg-[rgba(234,88,12,0.14)] px-3 py-1 text-xs font-semibold text-[#fdba74]">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Single-Ledger Operations OS
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-white">
              Loose Ends Workspace Access
            </h1>
            <p className="mt-2.5 text-sm text-slate-300 leading-relaxed">
              Quotes, technician dispatch, part reservations, invoice aging, and consent-verified
              revenue recovery in one isolated workspace.
            </p>

            <ul className="mt-6 space-y-3 text-xs text-slate-300">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                <span>Row-level workspace isolation with owner/admin role enforcement</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                <span>Zero customer records cached in browser storage</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                <span>K-anonymity SHA-1 prefix password breach screening before account creation</span>
              </li>
            </ul>
          </div>

          <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-xs text-slate-400">
            <p className="font-semibold text-slate-200">Evaluating Loose Ends first?</p>
            <p className="mt-1">
              Test all 5 workspaces with pre-seeded HVAC quotes, dispatch jobs, and POs—no sign-up
              required.
            </p>
            <button
              type="button"
              onClick={() => navigate('/demo')}
              className="mt-3 inline-flex items-center gap-1.5 font-semibold text-[#fb923c] hover:text-[#fdba74]"
            >
              Open Live Sandbox (/demo) →
            </button>
          </div>
        </div>

        {/* Right Form Column */}
        <div className="p-6 sm:p-8 lg:col-span-7">
          {!isSupabaseConfigured ? (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900"
            >
              Supabase environment credentials are not configured in this build. Use the air-gapped{' '}
              <button
                type="button"
                onClick={() => navigate('/demo')}
                className="font-semibold underline"
              >
                /demo sandbox
              </button>{' '}
              or configure <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
            </div>
          ) : null}

          <div
            role="tablist"
            aria-label="Authentication method"
            className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-100 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'signin'}
              onClick={() => switchTab('signin')}
              className={`touch-target rounded-lg px-2.5 py-2 text-xs font-semibold transition ${
                tab === 'signin'
                  ? 'bg-[#c2410c] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Password
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'otp'}
              onClick={() => switchTab('otp')}
              className={`touch-target rounded-lg px-2.5 py-2 text-xs font-semibold transition ${
                tab === 'otp'
                  ? 'bg-[#c2410c] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Magic Link
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'signup'}
              onClick={() => switchTab('signup')}
              className={`touch-target rounded-lg px-2.5 py-2 text-xs font-semibold transition ${
                tab === 'signup'
                  ? 'bg-[#c2410c] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Start Workspace
            </button>
          </div>

          <div className="mt-5">
            <h2 className="text-lg font-bold text-slate-900">
              {tab === 'signin'
                ? 'Sign in to your workspace'
                : tab === 'otp'
                  ? 'Email me a one-time magic link'
                  : tab === 'signup'
                    ? 'Create your workspace owner account'
                    : 'Reset your account password'}
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              {tab === 'signin'
                ? 'Enter your work email and password.'
                : tab === 'otp'
                  ? 'Passwordless sign-in link delivered straight to your inbox.'
                  : tab === 'signup'
                    ? 'Automatically provisions an isolated workspace via bootstrap-workspace.'
                    : 'We will email a secure recovery link to set a new password.'}
            </p>
          </div>

          {formError ? (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
            >
              {formError}
            </div>
          ) : null}

          {notice ? (
            <div
              role="status"
              className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs font-medium text-emerald-900"
            >
              {notice}
            </div>
          ) : null}

          <form onSubmit={handleAuthSubmit} className="mt-5 space-y-4">
            {tab === 'signup' ? (
              <div>
                <label htmlFor="auth-business-name" className="exec-label">
                  Business Name
                </label>
                <input
                  id="auth-business-name"
                  type="text"
                  placeholder="e.g., Blue Ridge Plumbing & Heating"
                  value={businessName}
                  onChange={e => setBusinessName(e.target.value)}
                  className="exec-input"
                />
              </div>
            ) : null}

            <div>
              <label htmlFor="auth-email" className="exec-label">
                Work Email
              </label>
              <div className="relative">
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="owner@company.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="exec-input pl-9"
                />
                <Mail
                  className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400"
                  aria-hidden="true"
                />
              </div>
            </div>

            {tab === 'signin' || tab === 'signup' ? (
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="auth-password" className="exec-label">
                    {tab === 'signup' ? 'Password (12+ characters)' : 'Password'}
                  </label>
                  {tab === 'signin' ? (
                    <button
                      type="button"
                      onClick={() => switchTab('forgot')}
                      className="mb-1 text-xs font-semibold text-[#c2410c] hover:text-[#9a3412]"
                    >
                      Forgot password?
                    </button>
                  ) : null}
                </div>
                <div className="relative">
                  <input
                    id="auth-password"
                    type="password"
                    autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
                    required
                    minLength={tab === 'signup' ? 12 : 1}
                    value={password}
                    onChange={e => {
                      setPassword(e.target.value)
                      if (tab === 'signup') setScreeningState('idle')
                    }}
                    onBlur={() => {
                      if (tab === 'signup' && password.length > 0) {
                        void runLiveBreachCheck(password)
                      }
                    }}
                    className="exec-input pl-9"
                  />
                  <Lock
                    className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400"
                    aria-hidden="true"
                  />
                </div>

                {tab === 'signup' ? (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span
                      className={`text-xs ${
                        screeningState === 'safe'
                          ? 'text-emerald-700 font-medium'
                          : screeningState === 'unsafe'
                            ? 'text-rose-700 font-medium'
                            : 'text-slate-500'
                      }`}
                    >
                      {screeningState === 'checking'
                        ? 'Checking k-anonymity breach range…'
                        : screeningMessage ??
                          'Screened locally via Web Crypto SHA-1 5-char prefix.'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void runLiveBreachCheck(password)}
                      className="shrink-0 text-xs font-semibold text-slate-700 underline hover:text-slate-900"
                    >
                      Verify safety
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {tab === 'signup' ? (
              <div>
                <label htmlFor="auth-confirm-password" className="exec-label">
                  Confirm Password
                </label>
                <input
                  id="auth-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="exec-input"
                />
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="exec-btn-primary w-full touch-target"
            >
              {submitting ? (
                'Processing…'
              ) : tab === 'signin' ? (
                'Sign In to Workspace'
              ) : tab === 'otp' ? (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  Send Magic Sign-In Link
                </>
              ) : tab === 'signup' ? (
                'Screen Password & Create Workspace'
              ) : (
                'Send Password Recovery Link'
              )}
            </button>

            {tab === 'forgot' ? (
              <button
                type="button"
                onClick={() => switchTab('signin')}
                className="exec-btn-secondary w-full touch-target"
              >
                Back to Password Sign-In
              </button>
            ) : null}
          </form>
        </div>
      </div>

      <p className="text-center text-xs text-slate-500 py-2">
        Loose Ends Co. · Single-Ledger Operations & Owner-Approved Revenue Recovery
      </p>
    </div>
  )
}
