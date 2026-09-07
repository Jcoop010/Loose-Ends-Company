import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '../store', replacement: path.resolve(__dirname, 'store.tsx') },
      { find: '../data', replacement: path.resolve(__dirname, 'data.ts') },
      { find: '../types', replacement: path.resolve(__dirname, 'types.ts') },
      { find: '../utils', replacement: path.resolve(__dirname, 'utils.ts') },
      { find: '../router', replacement: path.resolve(__dirname, 'router.tsx') },
      { find: '../components/ui', replacement: path.resolve(__dirname, 'ui.tsx') },
      { find: './components/ErrorBoundary', replacement: path.resolve(__dirname, 'ErrorBoundary.tsx') },
    ],
  },
  server: {
    host: true,
    port: 5173,
  },
})
