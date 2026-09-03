import { StoreProvider } from './store'
import { RouterProvider, useRouter } from './router'
import { LandingPage } from './pages/Landing'
import { DashboardLayout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Customers } from './pages/Customers'
import { RevenueRecovery } from './pages/RevenueRecovery'
import { Alerts } from './pages/Alerts'
import { FollowUpCenter } from './pages/FollowUpCenter'
import { Marketing } from './pages/Marketing'
import { BusinessRequests } from './pages/Requests'
import { AskAssistant } from './pages/Ask'
import { SettingsPage } from './pages/Settings'

function Routes() {
  const { route } = useRouter()

  if (route === '/' || route === '') return <LandingPage />

  if (route.startsWith('/dashboard')) {
    let page
    if (route === '/dashboard') page = <Dashboard />
    else if (route.startsWith('/dashboard/customers')) page = <Customers />
    else if (route.startsWith('/dashboard/revenue-recovery')) page = <RevenueRecovery />
    else if (route.startsWith('/dashboard/alerts')) page = <Alerts />
    else if (route.startsWith('/dashboard/follow-ups')) page = <FollowUpCenter />
    else if (route.startsWith('/dashboard/marketing')) page = <Marketing />
    else if (route.startsWith('/dashboard/requests')) page = <BusinessRequests />
    else if (route.startsWith('/dashboard/ask')) page = <AskAssistant />
    else if (route.startsWith('/dashboard/settings')) page = <SettingsPage />
    else page = <Dashboard />

    return <DashboardLayout currentPath={route}>{page}</DashboardLayout>
  }

  return <LandingPage />
}

export default function App() {
  return (
    <StoreProvider>
      <RouterProvider>
        <Routes />
      </RouterProvider>
    </StoreProvider>
  )
}
