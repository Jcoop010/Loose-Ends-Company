import assert from 'node:assert/strict'
import { loadSrcModule, readSrc } from './helpers/load-src-module.mjs'

const { parseAppLocation } = loadSrcModule('src/state/RouterContext.tsx')
const appRoot = readSrc('src/AppRoot.tsx')

// 1. Strict top-level route separation between landing (/), sandbox (/demo), and live workspaces (/dashboard)
assert.equal(parseAppLocation('/').topRoute, 'landing')
assert.equal(parseAppLocation('/demo').topRoute, 'demo')
assert.equal(parseAppLocation('/demo/inventory').topRoute, 'demo')
assert.equal(parseAppLocation('/demo/inventory').section, 'inventory')
assert.equal(parseAppLocation('/dashboard').topRoute, 'dashboard')
assert.equal(parseAppLocation('/dashboard/autopilot').topRoute, 'dashboard')
assert.equal(parseAppLocation('/dashboard/autopilot').section, 'autopilot')

// 2. DemoStoreProvider mounts exclusively under topRoute === 'demo', never wrapping authenticated /dashboard
const demoBranchIdx = appRoot.indexOf("if (topRoute === 'demo')")
const sessionBranchIdx = appRoot.indexOf('<SessionProvider>')
assert.ok(demoBranchIdx > 0 && sessionBranchIdx > demoBranchIdx)
assert.ok(
  !appRoot.slice(sessionBranchIdx).includes('DemoStoreProvider') &&
    !appRoot.slice(sessionBranchIdx).includes('DemoWorkspacePage'),
  'Authenticated /dashboard tree must never render DemoStoreProvider or demo ribbons',
)

console.log('Live workspace launch panel and demo isolation guards passed')
