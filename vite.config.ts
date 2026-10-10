import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'emit-loose-ends-legacy-runtime',
      generateBundle() {
        const legacyDir = resolve(rootDir, 'v3.1')
        for (const file of readdirSync(legacyDir)) {
          if (!file.endsWith('.js')) continue
          this.emitFile({
            type: 'asset',
            fileName: 'v3.1/' + file,
            source: readFileSync(resolve(legacyDir, file)),
          })
        }
      },
    },
  ],
  server: {
    host: true,
    port: 5173,
  },
})
