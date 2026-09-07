import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
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
