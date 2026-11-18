import { useEffect, useRef } from 'react'
import { isSupabaseConfigured, supabase } from './supabase'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const DEFAULT_REALTIME_DEBOUNCE_MS = 500

export function workspaceRealtimeChannelName(workspaceId: string): string {
  return `loose-ends-live-${workspaceId}`
}

/**
 * Subscribes to workspace-scoped changes on `opportunities` and `recovery_events`
 * over channel `loose-ends-live-${workspaceId}` with a 500ms trailing debounce
 * and deterministic channel + timer teardown.
 */
export function useWorkspaceRealtime(
  workspaceId: string | null | undefined,
  onInvalidate: () => void,
  debounceMs: number = DEFAULT_REALTIME_DEBOUNCE_MS,
): void {
  const callbackRef = useRef(onInvalidate)
  callbackRef.current = onInvalidate

  useEffect(() => {
    if (!isSupabaseConfigured || !workspaceId || !UUID_PATTERN.test(workspaceId)) {
      return undefined
    }

    let timer: ReturnType<typeof setTimeout> | null = null
    let disposed = false

    const scheduleInvalidate = () => {
      if (disposed) return
      if (timer !== null) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        timer = null
        if (!disposed) {
          callbackRef.current()
        }
      }, Math.max(50, debounceMs))
    }

    const filter = `workspace_id=eq.${workspaceId}`
    const channel = supabase
      .channel(workspaceRealtimeChannelName(workspaceId))
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'opportunities',
          filter,
        },
        scheduleInvalidate,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'recovery_events',
          filter,
        },
        scheduleInvalidate,
      )
      .subscribe()

    return () => {
      disposed = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      void supabase.removeChannel(channel)
    }
  }, [workspaceId, debounceMs])
}
