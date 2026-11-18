import React from 'react'
import { ArrowLeft } from 'lucide-react'
import { AppShell } from './components/shell/AppShell'
import { AuthGate } from './components/shell/AuthGate'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { EmptyState } from './components/ui/MetricCard'
import { ToastProvider } from './components/ui/Toast'
import { DemoWorkspacePage } from './features/demo/DemoWorkspacePage'
import { LandingPage } from './features/landing/LandingPage'
import { CommandCenterPage } from './features/workspaces/command-center/CommandCenterPage'
import { DispatchJobsPage } from './features/workspaces/dispatch-jobs/DispatchJobsPage'
import { PipelineQuotesPage } from './features/workspaces/pipeline-quotes/PipelineQuotesPage'
import { DemoStoreProvider } from './state/DemoStoreContext'
import { RouterProvider, useAppRouter } from './state/RouterContext'
import { SessionProvider } from './state/SessionContext'

function AuthenticatedWorkspaceSwitch(): React.ReactElement {
  const { section, navigateSection } = useAppRouter()

  if (section === 'command') {
    return <CommandCenterPage />
  }

  if (section === 'pipeline') {
    return <PipelineQuotesPage />
  }

  if (section === 'dispatch') {
    return <DispatchJobsPage />
  }

  const remainingLabels: Record<'inventory' | 'autopilot', string> = {
    inventory: 'Inventory & POs',
    autopilot: 'Autopilot & Billing',
  }

  return (
    <EmptyState
      title={`${remainingLabels[section]} Workspace`}
      description="Scheduled for Phase 3C module assembly. Command Center, Pipeline & Quotes, and Dispatch & Jobs are live."
      action={
        <button
          type="button"
          onClick={() => navigateSection('command')}
          className="exec-btn-primary touch-target"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Command Center
        </button>
      }
    />
  )
}

function RoutedApplication(): React.ReactElement {
  const { topRoute } = useAppRouter()

  if (topRoute === 'landing') {
    return <LandingPage />
  }

  if (topRoute === 'demo') {
    return (
      <DemoStoreProvider>
        <DemoWorkspacePage />
      </DemoStoreProvider>
    )
  }

  return (
    <SessionProvider>
      <AuthGate>
        <AppShell>
          <ErrorBoundary fallbackTitle="Workspace view encountered an error">
            <AuthenticatedWorkspaceSwitch />
          </ErrorBoundary>
        </AppShell>
      </AuthGate>
    </SessionProvider>
  )
}

export function AppRoot(): React.ReactElement {
  return (
    <ErrorBoundary fallbackTitle="Loose Ends OS encountered an unexpected error">
      <ToastProvider>
        <RouterProvider>
          <RoutedApplication />
        </RouterProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}
