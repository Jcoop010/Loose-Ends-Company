import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { hasError: boolean; message: string }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }
  static getDerivedStateFromError(error: Error): State { return { hasError: true, message: error.message || 'Unexpected application error.' } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Loose Ends Co. UI error', error, info) }
  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="card max-w-lg w-full p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-error-50 text-error-600 flex items-center justify-center mx-auto mb-4">!</div>
          <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
          <p className="text-sm text-slate-500 mt-2">The workspace hit an unexpected UI error. Your locally saved data is still preserved.</p>
          <p className="text-xs text-slate-400 mt-3 break-words">{this.state.message}</p>
          <button onClick={() => window.location.reload()} className="btn-primary mt-6">Reload Workspace</button>
        </div>
      </div>
    )
  }
}
