import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { signOutUser } from '../lib/auth'
import { bootstrapWorkspace } from '../lib/edgeFunctions'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type {
  MemberRole,
  Workspace,
  WorkspaceMember,
  WorkspaceSettings,
  WorkspaceSubscription,
} from '../types/domain'

export interface AvailableWorkspace {
  workspace: Workspace
  role: MemberRole
}

interface HydratedWorkspaceBundle {
  availableWorkspaces: AvailableWorkspace[]
  activeWorkspace: Workspace | null
  role: MemberRole | null
  settings: WorkspaceSettings | null
  subscription: WorkspaceSubscription | null
}

const EMPTY_BUNDLE: HydratedWorkspaceBundle = {
  availableWorkspaces: [],
  activeWorkspace: null,
  role: null,
  settings: null,
  subscription: null,
}

export interface SessionContextValue {
  user: User | null
  session: Session | null
  workspace: Workspace | null
  availableWorkspaces: AvailableWorkspace[]
  role: MemberRole | null
  isAdminOrOwner: boolean
  settings: WorkspaceSettings | null
  subscription: WorkspaceSubscription | null
  hasActiveSubscription: boolean
  inPasswordRecovery: boolean
  loading: boolean
  error: string | null
  switchWorkspace: (workspaceId: string) => Promise<void>
  refreshWorkspaceContext: () => Promise<void>
  clearPasswordRecovery: () => void
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

function unwrapWorkspaceJoin(raw: WorkspaceMember['workspaces'], fallbackId: string): Workspace {
  if (Array.isArray(raw) && raw[0]) {
    return raw[0]
  }
  if (raw && !Array.isArray(raw)) {
    return raw
  }
  return { id: fallbackId, name: 'Workspace' }
}

async function fetchWorkspaceMetadata(workspaceId: string): Promise<{
  settings: WorkspaceSettings | null
  subscription: WorkspaceSubscription | null
}> {
  const [settingsRes, subRes] = await Promise.all([
    supabase
      .from('workspace_settings')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    supabase
      .from('workspace_subscriptions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
  ])

  return {
    settings: (settingsRes.data as WorkspaceSettings | null) ?? null,
    subscription: (subRes.data as WorkspaceSubscription | null) ?? null,
  }
}

export function SessionProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [bundle, setBundle] = useState<HydratedWorkspaceBundle>(EMPTY_BUNDLE)
  const [inPasswordRecovery, setInPasswordRecovery] = useState(false)
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured)
  const [error, setError] = useState<string | null>(null)

  // Monotonic generation counter: every auth transition, workspace switch, or sign-out
  // increments this counter so any in-flight async hydration from an older generation
  // is discarded before it can overwrite current state.
  const generationRef = useRef<number>(0)
  const preferredWorkspaceIdRef = useRef<string | null>(null)

  const wipeAllSessionState = useCallback(() => {
    generationRef.current += 1
    preferredWorkspaceIdRef.current = null
    setSession(null)
    setUser(null)
    setBundle(EMPTY_BUNDLE)
    setInPasswordRecovery(false)
    setError(null)
    setLoading(false)
  }, [])

  const hydrateForUser = useCallback(
    async (activeUser: User, targetWorkspaceId?: string | null) => {
      const myGeneration = ++generationRef.current
      const isStale = () => generationRef.current !== myGeneration

      setLoading(true)
      setError(null)

      try {
        const { data: memberRows, error: memberError } = await supabase
          .from('workspace_members')
          .select('workspace_id,user_id,role,created_at,workspaces(id,name,slug,owner_user_id,created_at)')
          .eq('user_id', activeUser.id)
          .order('created_at', { ascending: true })

        if (isStale()) return
        if (memberError) throw memberError

        let memberships = (memberRows ?? []) as WorkspaceMember[]

        if (memberships.length === 0) {
          // Provision initial workspace via Edge Function for newly verified sign-ups
          const fallbackName =
            (activeUser.user_metadata?.business_name as string | undefined) ||
            (activeUser.email ? `${activeUser.email.split('@')[0]}'s Workspace` : 'My Business')
          await bootstrapWorkspace({ name: fallbackName })
          if (isStale()) return

          const retry = await supabase
            .from('workspace_members')
            .select('workspace_id,user_id,role,created_at,workspaces(id,name,slug,owner_user_id,created_at)')
            .eq('user_id', activeUser.id)
            .order('created_at', { ascending: true })

          if (isStale()) return
          if (retry.error) throw retry.error
          memberships = (retry.data ?? []) as WorkspaceMember[]
        }

        const availableWorkspaces: AvailableWorkspace[] = memberships.map(row => ({
          workspace: unwrapWorkspaceJoin(row.workspaces, row.workspace_id),
          role: row.role,
        }))

        if (availableWorkspaces.length === 0) {
          if (isStale()) return
          setBundle(EMPTY_BUNDLE)
          setLoading(false)
          return
        }

        const requestedId = targetWorkspaceId ?? preferredWorkspaceIdRef.current
        const chosen =
          availableWorkspaces.find(entry => entry.workspace.id === requestedId) ??
          availableWorkspaces[0]

        preferredWorkspaceIdRef.current = chosen.workspace.id

        const metadata = await fetchWorkspaceMetadata(chosen.workspace.id)
        if (isStale()) return

        setBundle({
          availableWorkspaces,
          activeWorkspace: chosen.workspace,
          role: chosen.role,
          settings: metadata.settings,
          subscription: metadata.subscription,
        })
      } catch (err) {
        if (isStale()) return
        setError(err instanceof Error ? err.message : 'Unable to load workspace session.')
      } finally {
        if (!isStale()) {
          setLoading(false)
        }
      }
    },
    [],
  )

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return undefined
    }

    let unmounted = false

    void supabase.auth.getSession().then(({ data, error: sessionErr }) => {
      if (unmounted) return
      if (sessionErr || !data.session?.user) {
        wipeAllSessionState()
        return
      }
      setSession(data.session)
      setUser(data.session.user)
      void hydrateForUser(data.session.user)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (unmounted) return

      if (event === 'PASSWORD_RECOVERY') {
        setInPasswordRecovery(true)
      }

      if (event === 'SIGNED_OUT' || !nextSession?.user) {
        wipeAllSessionState()
        return
      }

      setSession(nextSession)
      setUser(nextSession.user)

      if (
        event === 'SIGNED_IN' ||
        event === 'USER_UPDATED' ||
        event === 'INITIAL_SESSION'
      ) {
        void hydrateForUser(nextSession.user, preferredWorkspaceIdRef.current)
      }
    })

    return () => {
      unmounted = true
      generationRef.current += 1
      listener.subscription.unsubscribe()
    }
  }, [hydrateForUser, wipeAllSessionState])

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!user) return
      preferredWorkspaceIdRef.current = workspaceId
      // Clear previous workspace data immediately before hydrating the target workspace
      // so views never render cross-workspace records during transition.
      setBundle(prev => {
        const target = prev.availableWorkspaces.find(w => w.workspace.id === workspaceId)
        return {
          availableWorkspaces: prev.availableWorkspaces,
          activeWorkspace: target?.workspace ?? null,
          role: target?.role ?? null,
          settings: null,
          subscription: null,
        }
      })
      await hydrateForUser(user, workspaceId)
    },
    [hydrateForUser, user],
  )

  const refreshWorkspaceContext = useCallback(async () => {
    if (!user) return
    await hydrateForUser(user, preferredWorkspaceIdRef.current)
  }, [hydrateForUser, user])

  const clearPasswordRecovery = useCallback(() => {
    setInPasswordRecovery(false)
  }, [])

  const signOut = useCallback(async () => {
    // Synchronous full-state wipe BEFORE awaiting network sign-out so zero customer
    // or workspace state lingers in memory if the network is slow or offline.
    wipeAllSessionState()
    if (isSupabaseConfigured) {
      await signOutUser()
    }
  }, [wipeAllSessionState])

  const isAdminOrOwner = bundle.role === 'owner' || bundle.role === 'admin'
  const hasActiveSubscription =
    bundle.subscription?.status === 'active' || bundle.subscription?.status === 'trialing'

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      session,
      workspace: bundle.activeWorkspace,
      availableWorkspaces: bundle.availableWorkspaces,
      role: bundle.role,
      isAdminOrOwner,
      settings: bundle.settings,
      subscription: bundle.subscription,
      hasActiveSubscription,
      inPasswordRecovery,
      loading,
      error,
      switchWorkspace,
      refreshWorkspaceContext,
      clearPasswordRecovery,
      signOut,
    }),
    [
      user,
      session,
      bundle,
      isAdminOrOwner,
      hasActiveSubscription,
      inPasswordRecovery,
      loading,
      error,
      switchWorkspace,
      refreshWorkspaceContext,
      clearPasswordRecovery,
      signOut,
    ],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error('useSession must be used inside <SessionProvider>.')
  }
  return ctx
}
