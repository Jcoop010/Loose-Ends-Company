import assert from 'node:assert/strict'
import { loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const { createInitialDemoState } = loadSrcModule('src/state/DemoStoreContext.tsx')
const initial = createInitialDemoState(Date.parse('2026-11-17T12:00:00Z'))

assert.ok(initial.customers.length >= 5, 'Demo pre-seeds trade customers')
assert.ok(initial.jobs.some(j => j.status === 'completed' && !j.invoice_id), 'Demo includes unbilled completed job')
assert.ok(initial.consentEvents.some(e => e.decision === 'revoked'), 'Demo includes revoked consent test case')
assert.ok(initial.purchaseOrders.some(p => p.status === 'draft'), 'Demo includes draft restock PO')

const banner = readSrc('src/features/demo/WalkthroughBanner.tsx')
const demoPage = readSrc('src/features/demo/DemoWorkspacePage.tsx')
const roiModal = readSrc('src/features/demo/RoiAuditCalculatorModal.tsx')
const checkupHtml = readSrc('public/revenue-checkup.html')

assert.match(banner, /Air-Gapped Sandbox · Step/)
assert.match(banner, /Reset Sample Data/)
assert.match(banner, /Zero network or browser storage writes/)
assert.match(demoPage, /Stripe Webhook Verified/)
assert.match(demoPage, /Owner-Reported Paid/)
assert.match(roiModal, /not a guarantee of future collections/)
assert.match(checkupHtml, /href="\/demo"/)

console.log('Guided sales demo invariants passed')
