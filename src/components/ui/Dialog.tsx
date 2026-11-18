import React, { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

let openDialogCount = 0
let savedBodyOverflow = ''

function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => undefined
  if (openDialogCount === 0) {
    savedBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  openDialogCount += 1

  return () => {
    openDialogCount = Math.max(0, openDialogCount - 1)
    if (openDialogCount === 0 && typeof document !== 'undefined') {
      document.body.style.overflow = savedBodyOverflow
    }
  }
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  variant?: 'modal' | 'drawer'
  maxWidthClass?: string
  initialFocusRef?: React.RefObject<HTMLElement | null>
  footer?: React.ReactNode
  children: React.ReactNode
}

/**
 * Accessible modal and right-hand slide-over drawer enforcing:
 * - Escape key dismissal
 * - Backdrop click dismissal
 * - Ref-counted background scroll lock
 * - Initial focus placement + Tab focus containment
 * - Automatic focus restoration to the invoking trigger element on close
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  variant = 'modal',
  maxWidthClass = 'max-w-lg',
  initialFocusRef,
  footer,
  children,
}: DialogProps): React.ReactElement | null {
  const titleId = useId()
  const descId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return undefined
    }

    const previousFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const unlockScroll = lockBodyScroll()

    const focusTimer = setTimeout(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus()
        return
      }
      const panel = panelRef.current
      if (!panel) return
      const firstFocusable = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      if (firstFocusable) {
        firstFocusable.focus()
      } else {
        panel.focus()
      }
    }, 0)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }

      if (event.key === 'Tab' && panelRef.current) {
        const focusables = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null)

        if (focusables.length === 0) {
          event.preventDefault()
          return
        }

        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement

        if (event.shiftKey && active === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      unlockScroll()
      if (previousFocused && document.contains(previousFocused)) {
        previousFocused.focus()
      }
    }
  }, [open, initialFocusRef])

  if (!open) {
    return null
  }

  const isDrawer = variant === 'drawer'

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="presentation"
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 bg-slate-950/55 backdrop-blur-[1px] transition-opacity"
      />

      {/* Dialog Container */}
      <div
        className={
          isDrawer
            ? 'relative z-10 ml-auto flex h-full w-full max-w-xl flex-col bg-white shadow-2xl border-l border-slate-200'
            : 'relative z-10 m-auto flex max-h-[90vh] w-[calc(100vw-1.5rem)] flex-col rounded-2xl bg-white shadow-2xl border border-slate-200 ' +
              maxWidthClass
        }
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base sm:text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-xs sm:text-sm text-slate-600">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="touch-target -mr-2 -mt-1 inline-flex items-center justify-center rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6">{children}</div>

        {footer ? (
          <div className="border-t border-slate-200 bg-slate-50/80 px-5 py-3.5 sm:px-6 flex flex-wrap items-center justify-end gap-2.5 rounded-b-2xl">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}
