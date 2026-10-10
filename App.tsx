import { StoreProvider } from './store'
import { RouterProvider, useRouter } from './router'
import { LandingPage } from './pages/Landing'
import { DashboardLayout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { CRM } from './pages/CRM'
import { SalesOrders } from './pages/SalesOrders'
import { CalendarPage } from './pages/CalendarPage'
import { Customers } from './pages/Customers'
import { RevenueRecovery } from './pages/RevenueRecovery'
import { Alerts } from './pages/Alerts'
import { FollowUpCenter } from './pages/FollowUpCenter'
import { Marketing } from './pages/Marketing'
import { BusinessRequests } from './pages/Requests'
import { AskAssistant } from './pages/Ask'
import { SettingsPage } from './pages/Settings'
import { ErrorBoundary } from './ErrorBoundary'
import { AuthGate } from './components/AuthGate'

function DashboardRoutes() {
  const { route } = useRouter()

  let page
  if (route === '/dashboard') page = <Dashboard />
  else if (route === '/dashboard/crm') page = <CRM />
  else if (route.startsWith('/dashboard/customers')) page = <Customers />
  else if (route === '/dashboard/sales' || route.startsWith('/dashboard/orders')) page = <SalesOrders />
  else if (route.startsWith('/dashboard/calendar')) page = <CalendarPage />
  else if (route.startsWith('/dashboard/documents')) page = <BusinessRequests />
  else if (route.startsWith('/dashboard/loose-ends')) page = <RevenueRecovery />
  else if (route.startsWith('/dashboard/revenue-recovery') || route === '/dashboard/revenue') page = <RevenueRecovery />
  else if (route.startsWith('/dashboard/tasks')) page = <FollowUpCenter />
  else if (route.startsWith('/dashboard/intelligence')) page = <AskAssistant />
  else if (route.startsWith('/dashboard/alerts')) page = <Alerts />
  else if (route.startsWith('/dashboard/follow-ups')) page = <FollowUpCenter />
  else if (route.startsWith('/dashboard/marketing')) page = <Marketing />
  else if (route.startsWith('/dashboard/requests')) page = <BusinessRequests />
  else if (route.startsWith('/dashboard/ask')) page = <AskAssistant />
  else if (route.startsWith('/dashboard/settings')) page = <SettingsPage />
  else page = <Dashboard />

  return <DashboardLayout currentPath={route}>{page}</DashboardLayout>
}

function Routes() {
  const { route } = useRouter()

  // Keep the marketing site public. Authentication is only required for the
  // private operating system so prospects can view the product and submit
  // the free-audit form without creating an account first.
  if (route === '/' || route === '/home') return <LandingPage />

  if (route.startsWith('/dashboard')) {
    return (
      <AuthGate>
        <DashboardRoutes />
      </AuthGate>
    )
  }

  return <LandingPage />
}

export default function App() {
  return (
    <ErrorBoundary>
      <StoreProvider>
        <RouterProvider>
          <Routes />
        </RouterProvider>
      </StoreProvider>
    </ErrorBoundary>
  )
}
