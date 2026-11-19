import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastItem {
  id: string
  tone: ToastTone
  title: string
  description?: string
}

export interface ToastContextValue {
  toasts: ToastItem[]
  pushToast: (item: Omit<ToastItem, 'id'> & { durationMs?: number }) => string
  success: (title: string, description?: string) => string
  error: (title: string, description?: string) => string
  info: (title: string, description?: string) => string
  dismissToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts(prev => prev.filter(item => item.id !== id))
  }, [])

  const pushToast = useCallback(
    (item: Omit<ToastItem, 'id'> & { durationMs?: number }): string => {
      const id = crypto.randomUUID()
      const duration = item.durationMs ?? (item.tone === 'error' ? 6500 : 4200)
      setToasts(prev => [...prev.slice(-4), { id, tone: item.tone, title: item.title, description: item.description }])

      if (duration > 0) {
        const handle = setTimeout(() => {
          timersRef.current.delete(id)
          setToasts(prev => prev.filter(entry => entry.id !== id))
        }, duration)
        timersRef.current.set(id, handle)
      }
      return id
    },
    [],
  )

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
    }
  }, [])

  const success = useCallback(
    (title: string, description?: string) => pushToast({ tone: 'success', title, description }),
    [pushToast],
  )
  const error = useCallback(
    (title: string, description?: string) => pushToast({ tone: 'error', title, description }),
    [pushToast],
  )
  const info = useCallback(
    (title: string, description?: string) => pushToast({ tone: 'info', title, description }),
    [pushToast],
  )

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      pushToast,
      success,
      error,
      info,
      dismissToast,
    }),
    [toasts, pushToast, success, error, info, dismissToast],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        role="status"
        className="pointer-events-none fixed bottom-20 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2.5 md:bottom-5 md:right-5"
      >
        {toasts.map(item => {
          const isError = item.tone === 'error'
          const isSuccess = item.tone === 'success'
          return (
            <div
              key={item.id}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-white p-3.5 shadow-lg ${
                isError
                  ? 'border-rose-300'
                  : isSuccess
                    ? 'border-emerald-300'
                    : 'border-orange-200'
              }`}
            >
              <span
                className={`mt-0.5 shrink-0 ${
                  isError
                    ? 'text-rose-600'
                    : isSuccess
                      ? 'text-emerald-600'
                      : 'text-[#ea580c]'
                }`}
                aria-hidden="true"
              >
                {isError ? (
                  <AlertCircle className="h-5 w-5" />
                ) : isSuccess ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <Info className="h-5 w-5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">{item.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(item.id)}
                aria-label="Dismiss notification"
                className="touch-target -m-1.5 inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>.')
  }
  return ctx
}
