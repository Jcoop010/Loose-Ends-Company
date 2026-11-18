import assert from 'node:assert/strict'
import { readSrc } from './helpers/load-src-module.mjs'

const checkupPage = readSrc('public/revenue-checkup.html')
const landingPage = readSrc('src/features/landing/LandingPage.tsx')
const edgeFunctions = readSrc('src/lib/edgeFunctions.ts')

for (const phrase of [
  'Create your business workspace',
  'Choose the $199/month plan',
  'Import and review opportunities',
  'No automated customer messages',
]) {
  assert.ok(checkupPage.includes(phrase), phrase)
}

assert.match(checkupPage, /href="\/demo"/)
assert.match(checkupPage, /href="\/dashboard"/)
assert.match(landingPage, /\$199/)
assert.match(landingPage, /navigate\('\/demo'\)/)
assert.match(landingPage, /navigate\('\/dashboard'\)/)
assert.match(edgeFunctions, /create-subscription-checkout/)
assert.match(edgeFunctions, /checkout\.stripe\.com/)

console.log('Sales journey copy and secure checkout link guards passed')
