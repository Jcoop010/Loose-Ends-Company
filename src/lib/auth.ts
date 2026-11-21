import { useCallback, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { assertSupabaseConfigured, supabase } from './supabase'

const HIBP_RANGE_ENDPOINT = 'https://api.pwnedpasswords.com/range/'
const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 1024

function defaultDashboardRedirect(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/dashboard`
  }
  return 'https://looseendsos.app/dashboard'
}

/**
 * Privacy-preserving k-anonymity password breach check.
 * Computes SHA-1 in-browser via Web Crypto and sends ONLY the 5-char hex prefix to HIBP.
 * Fails closed if the check is unavailable or if the password appears in known breaches.
 */
export async function screenPasswordSafety(password: string): Promise<true> {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`)
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error('Password is too long.')
  }
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error('Secure browser required for password screening.')
  }

  const encoded = new TextEncoder().encode(password)
  const digestBuffer = await globalThis.crypto.subtle.digest('SHA-1', encoded)
  const fullHex = Array.from(new Uint8Array(digestBuffer), b =>
    b.toString(16).padStart(2, '0'),
  )
    .join('')
    .toUpperCase()

  const prefix = fullHex.slice(0, 5)
  const suffix = fullHex.slice(5)

  let response: Response
  try {
    response = await fetch(`${HIBP_RANGE_ENDPOINT}${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    throw new Error('Password safety check is unavailable. Please retry before saving your password.')
  }

  if (!response.ok) {
    throw new Error('Password safety check is unavailable. Please retry before saving your password.')
  }

  const body = await response.text()
  const breached = body.split(/\r?\n/).some(line => {
    const [candidateSuffix, countStr] = line.split(':')
    return candidateSuffix?.trim().toUpperCase() === suffix && Number(countStr) > 0
  })

  if (breached) {
    throw new Error('This password appears in known breaches. Choose a unique password.')
  }

  return true
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ user: User | null; session: Session | null }> {
  assertSupabaseConfigured()
  const normalizedEmail = email.trim()
  if (!normalizedEmail || !password) {
    throw new Error('Email and password are required.')
  }
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  })
  if (error) throw error
  return { user: data.user, session: data.session }
}

export async function signInWithOtp(email: string, emailRedirectTo?: string): Promise<void> {
  assertSupabaseConfigured()
  const normalizedEmail = email.trim()
  if (!normalizedEmail) {
    throw new Error('Email is required.')
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      emailRedirectTo: emailRedirectTo ?? defaultDashboardRedirect(),
      shouldCreateUser: true,
    },
  })
  if (error) throw error
}

export async function signUpWithPassword(
  email: string,
  password: string,
  emailRedirectTo?: string,
): Promise<{ user: User | null; session: Session | null; requiresEmailConfirmation: boolean }> {
  assertSupabaseConfigured()
  const normalizedEmail = email.trim()
  if (!normalizedEmail) {
    throw new Error('Email is required.')
  }
  await screenPasswordSafety(password)

  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      emailRedirectTo: emailRedirectTo ?? defaultDashboardRedirect(),
    },
  })
  if (error) throw error
  return {
    user: data.user,
    session: data.session,
    requiresEmailConfirmation: !data.session,
  }
}

export async function requestPasswordReset(email: string, redirectTo?: string): Promise<void> {
  assertSupabaseConfigured()
  const normalizedEmail = email.trim()
  if (!normalizedEmail) {
    throw new Error('Enter your account email to request a reset link.')
  }
  const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
    redirectTo: redirectTo ?? defaultDashboardRedirect(),
  })
  if (error) throw error
}

export function subscribePasswordRecovery(
  onRecoveryStateChange: (inRecovery: boolean) => void,
): () => void {
  const { data } = supabase.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') {
      onRecoveryStateChange(true)
    } else if (event === 'SIGNED_OUT') {
      onRecoveryStateChange(false)
    }
  })
  return () => {
    data.subscription.unsubscribe()
  }
}

export async function updateRecoveredPassword(
  newPassword: string,
  confirmPassword?: string,
): Promise<void> {
  assertSupabaseConfigured()
  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    throw new Error('Passwords do not match.')
  }
  await screenPasswordSafety(newPassword)

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) {
    throw new Error('Password could not be updated. Request a new recovery link and try again.')
  }
  const signOutResult = await supabase.auth.signOut()
  if (signOutResult.error) {
    throw signOutResult.error
  }
}

export async function signOutUser(): Promise<void> {
  assertSupabaseConfigured()
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export function usePasswordRecoveryMode(): {
  inRecovery: boolean
  clearRecoveryMode: () => void
} {
  const [inRecovery, setInRecovery] = useState(false)
  useEffect(() => subscribePasswordRecovery(setInRecovery), [])
  const clearRecoveryMode = useCallback(() => setInRecovery(false), [])
  return { inRecovery, clearRecoveryMode }
}

export function useSignOut(onBeforeOrAfterSignOut?: () => void): {
  signOut: () => Promise<void>
  signingOut: boolean
} {
  const [signingOut, setSigningOut] = useState(false)

  const signOut = useCallback(async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      onBeforeOrAfterSignOut?.()
      await signOutUser()
    } finally {
      setSigningOut(false)
    }
  }, [onBeforeOrAfterSignOut, signingOut])

  return { signOut, signingOut }
}
