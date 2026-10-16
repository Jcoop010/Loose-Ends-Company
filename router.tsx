import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

interface RouterContextValue {
  route: string
  search: string
  navigate: (path: string) => void
}

const RouterContext = createContext<RouterContextValue | null>(null)

export function RouterProvider({ children }: { children: ReactNode }) {
  const normalize = (path: string) => {
    const clean = path.split('?')[0].split('#')[0] || '/'
    return clean.length > 1 ? clean.replace(/\/$/, '') : '/'
  }

  const [route, setRoute] = useState(() => normalize(window.location.pathname || '/'))
  const [search, setSearch] = useState(() => window.location.search)

  useEffect(() => {
    const handler = () => { setRoute(normalize(window.location.pathname)); setSearch(window.location.search) }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  const navigate = (path: string) => {
    const normalized = normalize(path)
    if (path !== window.location.pathname + window.location.search + window.location.hash) window.history.pushState({}, '', path)
    setRoute(normalized)
    setSearch(window.location.search)
    window.scrollTo(0, 0)
  }

  return <RouterContext.Provider value={{ route, search, navigate }}>{children}</RouterContext.Provider>
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error('useRouter must be used within RouterProvider')
  return ctx
}
