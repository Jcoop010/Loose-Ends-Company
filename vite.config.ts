import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: './pages/Landing', replacement: path.join(root, 'Landing.tsx') },
      { find: './pages/Dashboard', replacement: path.join(root, 'Dashboard.tsx') },
      { find: './pages/Customers', replacement: path.join(root, 'Customers.tsx') },
      { find: './pages/RevenueRecovery', replacement: path.join(root, 'RevenueRecovery.tsx') },
      { find: './pages/Alerts', replacement: path.join(root, 'Alerts.tsx') },
      { find: './pages/FollowUpCenter', replacement: path.join(root, 'FollowUpCenter.tsx') },
      { find: './pages/Marketing', replacement: path.join(root, 'Marketing.tsx') },
      { find: './pages/Requests', replacement: path.join(root, 'Requests.tsx') },
      { find: './pages/Ask', replacement: path.join(root, 'Ask.tsx') },
      { find: './pages/Settings', replacement: path.join(root, 'Settings.tsx') },
      { find: './components/Layout', replacement: path.join(root, 'Layout.tsx') },
      { find: '../store', replacement: path.join(root, 'store.tsx') },
      { find: '../data', replacement: path.join(root, 'data.ts') },
      { find: '../types', replacement: path.join(root, 'types.ts') },
      { find: '../utils', replacement: path.join(root, 'utils.ts') },
      { find: '../router', replacement: path.join(root, 'router.tsx') },
      { find: '../components/ui', replacement: path.join(root, 'ui.tsx') },
      { find: './components/ErrorBoundary', replacement: path.join(root, 'ErrorBoundary.tsx') },
    ],
  },
  server: {
    host: true,
    port: 5173,
  },
})
