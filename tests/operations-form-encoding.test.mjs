import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { webcrypto } from 'node:crypto'
import { installDomGlobals, loadSrcModule, readSrc } from './helpers/load-src-module.mjs'
import { JSDOM } from 'jsdom'

// 1. Clean production HTML shell loads /src/main.tsx with zero inline scripts or legacy v3.1/CDN scripts
const html = readSrc('index.html')
const parsedHtml = new JSDOM(html)
const scripts = [...parsedHtml.window.document.scripts]
assert.equal(scripts.length, 1, 'index.html loads exactly one module entry script')
assert.equal(scripts[0].getAttribute('type'), 'module')
assert.equal(scripts[0].getAttribute('src'), '/src/main.tsx')
parsedHtml.window.close()

// 2. Hostile XSS payload rendered through FinanceAgingPanel produces zero injected tags or event attributes
const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>', {
  url: 'https://loose-ends-os.vercel.app/dashboard',
})
const w = installDomGlobals(dom)

const cache = new Map()
const opts = {
  moduleOverrides: {
    'src/lib/supabase.ts': {
      isSupabaseConfigured: true,
      assertSupabaseConfigured() {},
      supabase: { async rpc() { return { data: {}, error: null } } },
    },
  },
  globals: { window: w, document: w.document, crypto: webcrypto },
  cache,
}

const { ToastProvider } = loadSrcModule('src/components/ui/Toast.tsx', opts)
const { FinanceAgingPanel } = loadSrcModule(
  'src/features/workspaces/command-center/FinanceAgingPanel.tsx',
  opts,
)

const hostilePayload = '" autofocus onfocus="alert(1)"><img src=x onerror=alert(1)>&\''

const root = createRoot(w.document.getElementById('root'))
try {
  await act(async () => {
    root.render(
      React.createElement(
        ToastProvider,
        null,
        React.createElement(FinanceAgingPanel, {
          workspaceId: '11111111-1111-4111-8111-111111111111',
          agingBuckets: [{ key: 'not_due', label: 'Current', amount: 100 }],
          expenses: [
            {
              id: hostilePayload,
              workspace_id: '11111111-1111-4111-8111-111111111111',
              job_id: null,
              vendor: hostilePayload,
              description: hostilePayload,
              amount: 250,
              due_at: null,
              paid: false,
              created_at: '2026-11-17T00:00:00Z',
            },
          ],
          onExpensesChanged: () => {},
        }),
      ),
    )
  })

  assert.equal(
    w.document.querySelectorAll('img,script,[onfocus],[onerror],[autofocus]').length,
    0,
    'Hostile vendor/description strings must never inject executable DOM elements or attributes',
  )
  assert.ok(w.document.body.textContent.includes(hostilePayload))
} finally {
  await act(async () => {
    root.unmount()
  })
  w.close()
}

console.log('Operations module loading and form attribute/text injection regression passed')
