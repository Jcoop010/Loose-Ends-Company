import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source=readFileSync(new URL('../v3.1/launch-center.js',import.meta.url),'utf8')
assert.doesNotMatch(source, /<span>READY<\/span>/, 'onboarding must not assert unverified integration readiness')
assert.match(source, /Verify workflow execution/, 'automation readiness requires execution verification')
assert.match(source, /verify integrations and automations/i, 'completed onboarding is not integration verification')
assert.match(source, /Use secure checkout to activate the \$199\/month plan/, 'billing launch gate must be explicit')
console.log('Launch readiness honesty checks passed')
