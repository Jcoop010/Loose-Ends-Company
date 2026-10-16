import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source=readFileSync(new URL('../v3.1/launch-center.js',import.meta.url),'utf8')
assert.doesNotMatch(source, /<span>READY<\/span>/, 'onboarding must not assert unverified integration readiness')
assert.match(source, /Verify workflow execution/, 'automation readiness requires execution verification')
assert.match(source, /Verify integrations and automations/, 'completed onboarding is not integration verification')
console.log('Launch readiness honesty checks passed')
