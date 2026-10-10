import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-loose-ends-legacy-runtime',
      closeBundle() {
        cpSync(resolve(rootDir, 'v3.1'), resolve(rootDir, 'dist', 'v3.1'), { recursive: true })
        console.log('Copied Loose Ends legacy runtime assets to dist/v3.1')
      },
    },
  ],
  server: {
    host: true,
    port: 5173,
  },
})
