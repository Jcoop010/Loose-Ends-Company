import React from 'react'
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'
import { captureSentryException } from '../../lib/sentry'

export interface ErrorBoundaryProps {
  children: React.ReactNode
  fallbackTitle?: string
  onReset?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
    }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[LooseEnds ErrorBoundary]', error, info.componentStack)
    captureSentryException(error, { componentStack: info.componentStack })
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null })
    this.props.onReset?.()
  }

  private handleReload = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  override render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    const title = this.props.fallbackTitle ?? 'Workspace view encountered an unexpected error'
    const message =
      this.state.error?.message || 'An unexpected runtime issue interrupted this view.'

    return (
      <div
        role="alert"
        aria-live="assertive"
        className="min-h-[50vh] w-full flex items-center justify-center p-6"
      >
        <div className="exec-surface max-w-lg w-full p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-700 border border-rose-200">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                Your ledger records and workspace state remain safe. You can reset this view or
                reload the application.
              </p>
              <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-slate-900 px-3.5 py-2.5 text-xs text-slate-100 font-mono">
                {message}
              </pre>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={this.handleReset}
                  className="exec-btn-primary touch-target"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Reset View
                </button>
                <button
                  type="button"
                  onClick={this.handleReload}
                  className="exec-btn-secondary touch-target"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Reload App
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
