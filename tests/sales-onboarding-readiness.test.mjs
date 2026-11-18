import assert from 'node:assert/strict'
import { readSrc } from './helpers/load-src-module.mjs'

const checkupPage = readSrc('public/revenue-checkup.html')
const consentPanel = readSrc('src/features/workspaces/pipeline-quotes/ConsentDraftsPanel.tsx')
const verifiedCard = readSrc('src/features/workspaces/command-center/VerifiedRevenueCard.tsx')
const edgeFn = readSrc('src/lib/edgeFunctions.ts')
const html = readSrc('index.html')

assert.match(consentPanel, /requires active channel opt-in before approval/)
assert.match(verifiedCard, /tracked separately from self-reported paid/)
assert.match(edgeFn, /create-subscription-checkout/)
assert.match(edgeFn, /checkout\.stripe\.com/)
assert.match(html, /src="\/src\/main\.tsx"/)
assert.match(checkupPage, /Get up and running in three steps/)

console.log('Sellable onboarding guidance and checkout path validated')
