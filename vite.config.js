import { defineConfig } from 'vite';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    {
      name: 'copy-standalone-runtime',
      closeBundle() {
        const source = resolve(process.cwd(), 'v3.1');
        const destination = resolve(process.cwd(), 'dist', 'v3.1');
        if (!existsSync(source)) return;
        mkdirSync(destination, { recursive: true });
        cpSync(source, destination, { recursive: true });
      }
    }
  ]
});
