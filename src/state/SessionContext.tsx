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
import type { WorkspaceEntityRecord } from '../lib/autonomousOs/types'
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
  entities: WorkspaceEntityRecord[]
}

const EMPTY_BUNDLE: HydratedWorkspaceBundle = {
  availableWorkspaces: [],
  activeWorkspace: null,
  role: null,
  settings: null,
  subscription: null,
  entities: [],
}

export type ActiveEntityScope = 'consolidated' | string

export interface SessionContextValue {
  user: User | null
  session: Session | null
  workspace: Workspace | null
  availableWorkspaces: AvailableWorkspace[]
  entities: WorkspaceEntityRecord[]
  activeEntityId: ActiveEntityScope
  activeEntity: WorkspaceEntityRecord | null
  role: MemberRole | null
  isAdminOrOwner: boolean
  settings: WorkspaceSettings | null
  subscription: WorkspaceSubscription | null
  hasActiveSubscription: boolean
  inPasswordRecovery: boolean
  loading: boolean
  error: string | null
  switchWorkspace: (workspaceId: string) => Promise<void>
  switchEntity: (entityId: ActiveEntityScope) => void
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

async function fetchWorkspaceEntitiesSafe(
  workspaceId: string,
): Promise<WorkspaceEntityRecord[]> {
  try {
    const res = await supabase
      .from('workspace_entities')
      .select('id,workspace_id,legal_name,ein_last4,entity_type,is_primary,created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
    if (res?.error || !Array.isArray(res?.data)) return []
    const rows = res.data as WorkspaceEntityRecord[]
    return [...rows].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
  } catch {
    return []
  }
}

async function fetchWorkspaceMetadata(workspaceId: string): Promise<{
  settings: WorkspaceSettings | null
  subscription: WorkspaceSubscription | null
  entities: WorkspaceEntityRecord[]
}> {
  const [settingsRes, subRes, entities] = await Promise.all([
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
    fetchWorkspaceEntitiesSafe(workspaceId),
  ])

  return {
    settings: (settingsRes.data as WorkspaceSettings | null) ?? null,
    subscription: (subRes.data as WorkspaceSubscription | null) ?? null,
    entities,
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
  const [activeEntityId, setActiveEntityId] = useState<ActiveEntityScope>('consolidated')
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
    setActiveEntityId('consolidated')
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
          entities: metadata.entities,
        })
        setActiveEntityId(prev =>
          prev === 'consolidated' || metadata.entities.some(e => e.id === prev)
            ? prev
            : 'consolidated',
        )
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
      setActiveEntityId('consolidated')
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
          entities: [],
        }
      })
      await hydrateForUser(user, workspaceId)
    },
    [hydrateForUser, user],
  )

  const switchEntity = useCallback((entityId: ActiveEntityScope) => {
    setActiveEntityId(entityId)
  }, [])

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
  const activeEntity = useMemo(
    () =>
      activeEntityId === 'consolidated'
        ? null
        : bundle.entities.find(e => e.id === activeEntityId) ?? null,
    [bundle.entities, activeEntityId],
  )

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      session,
      workspace: bundle.activeWorkspace,
      availableWorkspaces: bundle.availableWorkspaces,
      entities: bundle.entities,
      activeEntityId,
      activeEntity,
      role: bundle.role,
      isAdminOrOwner,
      settings: bundle.settings,
      subscription: bundle.subscription,
      hasActiveSubscription,
      inPasswordRecovery,
      loading,
      error,
      switchWorkspace,
      switchEntity,
      refreshWorkspaceContext,
      clearPasswordRecovery,
      signOut,
    }),
    [
      user,
      session,
      bundle,
      activeEntityId,
      activeEntity,
      isAdminOrOwner,
      hasActiveSubscription,
      inPasswordRecovery,
      loading,
      error,
      switchWorkspace,
      switchEntity,
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
