import React from 'react'
import { AppShell } from './components/shell/AppShell'
import { AuthGate } from './components/shell/AuthGate'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { ToastProvider } from './components/ui/Toast'
import { DemoWorkspacePage } from './features/demo/DemoWorkspacePage'
import { LandingPage } from './features/landing/LandingPage'
import { AutopilotBillingPage } from './features/workspaces/autopilot-billing/AutopilotBillingPage'
import { CommandCenterPage } from './features/workspaces/command-center/CommandCenterPage'
import { DispatchJobsPage } from './features/workspaces/dispatch-jobs/DispatchJobsPage'
import { InventoryPosPage } from './features/workspaces/inventory-pos/InventoryPosPage'
import { PipelineQuotesPage } from './features/workspaces/pipeline-quotes/PipelineQuotesPage'
import { DemoStoreProvider } from './state/DemoStoreContext'
import { RouterProvider, useAppRouter } from './state/RouterContext'
import { SessionProvider } from './state/SessionContext'

function AuthenticatedWorkspaceSwitch(): React.ReactElement {
  const { section } = useAppRouter()

  switch (section) {
    case 'pipeline':
      return <PipelineQuotesPage />
    case 'dispatch':
      return <DispatchJobsPage />
    case 'inventory':
      return <InventoryPosPage />
    case 'autopilot':
      return <AutopilotBillingPage />
    case 'command':
    default:
      return <CommandCenterPage />
  }
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
