import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

interface RouterContextValue {
  route: string
  navigate: (path: string) => void
}

const RouterContext = createContext<RouterContextValue | null>(null)

export function RouterProvider({ children }: { children: ReactNode }) {
  const normalize = (path: string) => {
    const clean = path.split('?')[0].split('#')[0] || '/'
    return clean.length > 1 ? clean.replace(/\/$/, '') : '/'
  }

  const [route, setRoute] = useState(() => normalize(window.location.pathname || '/'))

  useEffect(() => {
    const handler = () => setRoute(normalize(window.location.pathname))
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  const navigate = (path: string) => {
    const normalized = normalize(path)
    if (normalized !== window.location.pathname) window.history.pushState({}, '', normalized)
    setRoute(normalized)
    window.scrollTo(0, 0)
  }

  return <RouterContext.Provider value={{ route, navigate }}>{children}</RouterContext.Provider>
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error('useRouter must be used within RouterProvider')
  return ctx
}
