import { defineConfig, loadEnv } from 'vite';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveBrowserConfig, injectBrowserConfig } from './scripts/preview-config.mjs';

export default defineConfig(({ mode }) => {
  const browserConfig = resolveBrowserConfig({ ...loadEnv(mode, process.cwd(), ''), ...process.env });
  return {
  plugins: [
    {
      name: 'isolated-browser-backend',
      transformIndexHtml: { order: 'pre', handler: (html) => injectBrowserConfig(html, browserConfig) },
    },
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
  };
});
