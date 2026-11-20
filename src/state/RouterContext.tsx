import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type DashboardSection =
  | 'command'
  | 'pipeline'
  | 'quotes'
  | 'invoices'
  | 'autonomy'
  | 'dispatch'
  | 'inventory'
  | 'bookkeeping'
  | 'vault'
  | 'sops'
  | 'autopilot'

export type AppTopRoute = 'landing' | 'demo' | 'dashboard' | 'portal'

export const DASHBOARD_ROUTES: Record<DashboardSection, string> = {
  command: '/dashboard',
  pipeline: '/dashboard/pipeline',
  quotes: '/dashboard/quotes',
  invoices: '/dashboard/invoices',
  autonomy: '/dashboard/autonomy',
  dispatch: '/dashboard/dispatch',
  inventory: '/dashboard/inventory',
  bookkeeping: '/dashboard/bookkeeping',
  vault: '/dashboard/vault',
  sops: '/dashboard/sops',
  autopilot: '/dashboard/autopilot',
}

export interface ParsedRoute {
  pathname: string
  search: string
  topRoute: AppTopRoute
  section: DashboardSection
  portalToken: string | null
}

export function normalizePathname(rawPathname: string): string {
  const trimmed = (rawPathname || '/').replace(/\/+$/, '')
  return trimmed.length === 0 ? '/' : trimmed
}

export function parseAppLocation(pathname: string, search = ''): ParsedRoute {
  const cleanPath = normalizePathname(pathname)

  if (cleanPath.startsWith('/portal/')) {
    const rawToken = cleanPath.slice('/portal/'.length).split('/')[0] ?? ''
    const portalToken = decodeURIComponent(rawToken).trim() || null
    if (portalToken) {
      return {
        pathname: cleanPath,
        search,
        topRoute: 'portal',
        section: 'command',
        portalToken,
      }
    }
  }

  if (cleanPath === '/demo' || cleanPath.startsWith('/demo/')) {
    const sub = cleanPath.slice('/demo'.length).replace(/^\/+/, '').split('/')[0]
    const section = isDashboardSection(sub) ? sub : 'command'
    return {
      pathname: cleanPath,
      search,
      topRoute: 'demo',
      section,
      portalToken: null,
    }
  }

  if (cleanPath === '/dashboard' || cleanPath.startsWith('/dashboard/')) {
    const sub = cleanPath.slice('/dashboard'.length).replace(/^\/+/, '').split('/')[0]
    const section = isDashboardSection(sub) ? sub : 'command'
    return {
      pathname: cleanPath,
      search,
      topRoute: 'dashboard',
      section,
      portalToken: null,
    }
  }

  return {
    pathname: cleanPath,
    search,
    topRoute: 'landing',
    section: 'command',
    portalToken: null,
  }
}

function isDashboardSection(candidate: string): candidate is DashboardSection {
  return (
    candidate === 'command' ||
    candidate === 'pipeline' ||
    candidate === 'quotes' ||
    candidate === 'invoices' ||
    candidate === 'autonomy' ||
    candidate === 'dispatch' ||
    candidate === 'inventory' ||
    candidate === 'bookkeeping' ||
    candidate === 'vault' ||
    candidate === 'sops' ||
    candidate === 'autopilot'
  )
}

function readBrowserLocation(): { pathname: string; search: string } {
  if (typeof window === 'undefined') {
    return { pathname: '/', search: '' }
  }
  return {
    pathname: window.location.pathname || '/',
    search: window.location.search || '',
  }
}

export interface AppRouterContextValue extends ParsedRoute {
  searchParams: URLSearchParams
  getParam: (key: string) => string | null
  setParams: (
    updates: Record<string, string | number | boolean | null | undefined>,
    options?: { replace?: boolean },
  ) => void
  navigate: (to: string, options?: { replace?: boolean; preserveSearch?: boolean }) => void
  navigateSection: (section: DashboardSection, options?: { demo?: boolean; replace?: boolean }) => void
}

const RouterContext = createContext<AppRouterContextValue | null>(null)

export function RouterProvider({
  initialPath,
  children,
}: {
  initialPath?: string
  children: React.ReactNode
}): React.ReactElement {
  const [loc, setLoc] = useState<{ pathname: string; search: string }>(() => {
    if (initialPath) {
      const qIdx = initialPath.indexOf('?')
      if (qIdx >= 0) {
        return {
          pathname: initialPath.slice(0, qIdx) || '/',
          search: initialPath.slice(qIdx),
        }
      }
      return { pathname: initialPath, search: '' }
    }
    return readBrowserLocation()
  })

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onPopState = () => {
      setLoc(readBrowserLocation())
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback(
    (to: string, options?: { replace?: boolean; preserveSearch?: boolean }) => {
      const qIdx = to.indexOf('?')
      const rawPath = qIdx >= 0 ? to.slice(0, qIdx) : to
      const nextPathname = normalizePathname(rawPath || '/')
      const nextSearch =
        qIdx >= 0 ? to.slice(qIdx) : options?.preserveSearch ? loc.search : ''

      if (typeof window !== 'undefined' && window.history) {
        const nextUrl = `${nextPathname}${nextSearch}`
        if (options?.replace) {
          window.history.replaceState(null, '', nextUrl)
        } else {
          window.history.pushState(null, '', nextUrl)
        }
        window.scrollTo?.({ top: 0, behavior: 'auto' })
      }

      setLoc({ pathname: nextPathname, search: nextSearch })
    },
    [loc.search],
  )

  const setParams = useCallback(
    (
      updates: Record<string, string | number | boolean | null | undefined>,
      options?: { replace?: boolean },
    ) => {
      const params = new URLSearchParams(loc.search)
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === '') {
          params.delete(key)
        } else {
          params.set(key, String(value))
        }
      }
      const queryString = params.toString()
      const nextSearch = queryString ? `?${queryString}` : ''

      if (typeof window !== 'undefined' && window.history) {
        const nextUrl = `${loc.pathname}${nextSearch}`
        if (options?.replace !== false) {
          window.history.replaceState(null, '', nextUrl)
        } else {
          window.history.pushState(null, '', nextUrl)
        }
      }

      setLoc(prev => ({ pathname: prev.pathname, search: nextSearch }))
    },
    [loc.pathname, loc.search],
  )

  const parsed = useMemo(() => parseAppLocation(loc.pathname, loc.search), [loc.pathname, loc.search])
  const searchParams = useMemo(() => new URLSearchParams(loc.search), [loc.search])

  const getParam = useCallback(
    (key: string): string | null => searchParams.get(key),
    [searchParams],
  )

  const navigateSection = useCallback(
    (section: DashboardSection, options?: { demo?: boolean; replace?: boolean }) => {
      const isDemo = options?.demo ?? parsed.topRoute === 'demo'
      if (isDemo) {
        const target = section === 'command' ? '/demo' : `/demo/${section}`
        navigate(target, { replace: options?.replace })
        return
      }
      navigate(DASHBOARD_ROUTES[section], { replace: options?.replace })
    },
    [navigate, parsed.topRoute],
  )

  const value = useMemo<AppRouterContextValue>(
    () => ({
      ...parsed,
      searchParams,
      getParam,
      setParams,
      navigate,
      navigateSection,
    }),
    [parsed, searchParams, getParam, setParams, navigate, navigateSection],
  )

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useAppRouter(): AppRouterContextValue {
  const ctx = useContext(RouterContext)
  if (!ctx) {
    throw new Error('useAppRouter must be used inside <RouterProvider>.')
  }
  return ctx
}
