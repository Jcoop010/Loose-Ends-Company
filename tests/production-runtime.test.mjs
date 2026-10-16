import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setImmediate(resolve))
function runtime(fixtures = {}) {
  const listeners = [], pending = [], writes = [], updates = [], calls = []
  let user = { id: 'account-a' }, delay = false, fail = false
  const S = {
    rpc: async (name, args) => { calls.push({ name, args }); return { data: true } },
    auth: { getUser: async () => ({ data: { user } }), onAuthStateChange: fn => listeners.push(fn) },
    from(table) {
      const query = { update(value) { updates.push({ table, value }); return this }, select() { return this }, eq() { return this }, order() { return this }, in() { return this }, limit() { return this },
        maybeSingle: async () => ({ data: { workspace_id: 'workspace-' + user.id } }),
        then(resolve, reject) {
          const result = { data: fixtures[table] || (table === 'customers' ? [{ id: 'private-a', first_name: 'Private fixture' }] : []), error: fail ? new Error('Network unavailable') : null }
          return (delay ? new Promise(r => pending.push(() => r(result))) : Promise.resolve(result)).then(resolve, reject)
        }
      }
      return query
    }
  }
  const window = { LESupabase: S, scrollTo() {}, prompt: () => '125.50', confirm: () => true }
  const document = { getElementById: () => null, querySelector: () => null }
  runInNewContext(read('v3.1/app.js'), { window, document, localStorage: { getItem: () => null, setItem: (k, v) => writes.push([k, v]) }, console: { ...console, error() {} }, setTimeout, Date, Number, FormData })
  return { window, writes, pending, updates, calls, setUser: value => { user = value }, delay: value => { delay = value }, fail: () => { fail = true }, event: value => listeners.forEach(fn => fn(value)) }
}

const lifecycle = runtime({ loose_ends: [{ id: 'loose-fixture', status: 'in_progress', recovery_stage: 'engaged', amount: 250 }] })
await lifecycle.window.LE.refresh()
assert.equal(lifecycle.window.LE.getState().opportunities[0].status, 'responded')
await lifecycle.window.LE.updateStatus('loose-fixture', 'scheduled')
assert.equal(lifecycle.updates[0].value.status, 'in_progress', 'UI stage must respect the production database status constraint')
assert.equal(lifecycle.updates[0].value.recovery_stage, 'converted')

const collection = runtime({ opportunities: [{ id: 'invoice-fixture', status: 'open', amount: 500 }] })
await collection.window.LE.refresh()
await collection.window.LE.recover('invoice-fixture')
assert.equal(collection.calls.length, 1)
assert.equal(collection.calls[0].name, 'collect_opportunity')
assert.equal(collection.calls[0].args.p_amount, 125.50, 'record actual partial collection, not the projected amount')
assert.equal(collection.updates.length, 0, 'collection must use the atomic database operation')
collection.window.prompt = () => 'Infinity'
await collection.window.LE.recover('invoice-fixture')
assert.equal(collection.calls.length, 1, 'invalid collected amount must not reach the database')
collection.window.prompt = () => null
await collection.window.LE.recover('invoice-fixture')
assert.equal(collection.calls.length, 1, 'canceling must not record collection')

const app = runtime()
await app.window.LE.refresh()
assert.equal(app.window.LE.getState().customers.length, 1)
app.event('SIGNED_OUT')
assert.equal(app.window.LE.getState().customers.length, 0, 'sign-out must synchronously erase customer state')
assert.equal(app.window.LE.getState().workspaceId, null)

app.setUser({ id: 'account-a' }); app.delay(true)
const stale = app.window.LE.refresh()
await tick()
assert.ok(app.pending.length > 0)
app.setUser(null); app.event('SIGNED_OUT')
app.pending.splice(0).forEach(resolve => resolve())
await stale
assert.equal(app.window.LE.getState().customers.length, 0, 'late account A response must not repopulate signed-out state')
assert.equal(app.window.LE.getState().workspaceId, null)

app.delay(false); app.setUser({ id: 'account-b' }); await app.window.LE.refresh()
assert.equal(app.window.LE.getState().workspaceId, 'workspace-account-b')
app.fail(); await app.window.LE.refresh()
assert.equal(app.window.LE.getState().loaded, false)
assert.equal(app.window.LE.getState().customers.length, 0, 'failed refresh must not display stale customer data')
app.window.LE.setView('customers')
assert.ok(app.writes.every(([, value]) => !value.includes('Private fixture')))

// The auth bridge must only clear legacy customer caches, never replace them.
assert.doesNotMatch(read('v3.1/auth-live.js'), /localStorage\.setItem/)

let confirmed = 0
const revenueWindow = { LESupabase: {}, LE: { recover: async id => { assert.equal(id, 'opportunity-fixture'); confirmed++ } } }
runInNewContext(read('v3.1/revenue-engine.js'), { window: revenueWindow, document: { getElementById: () => null }, setInterval: () => 1, clearInterval() {} })
await revenueWindow.LERevenueEngine.recover('opportunity-fixture')
assert.equal(confirmed, 1, 'secondary recovery UI must use the owner-confirmation path')

const productListeners = [], productPending = []
let productDelay = false
const productWindow = { LESupabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'fixture' } } }), onAuthStateChange: fn => productListeners.push(fn) },
  from(table) {
    return { select() { return this }, eq() { return this }, order() { return this }, limit() { return this },
      maybeSingle: async () => ({ data: { workspaces: { id: 'workspace-fixture', name: 'Fixture' } } }),
      then(resolve, reject) {
        const value = { data: table === 'opportunities' ? [{ id: 'fixture', status: 'recovered', amount: 999, recovered_amount: 0 }] : [] }
        return (productDelay ? new Promise(r => productPending.push(() => r(value))) : Promise.resolve(value)).then(resolve, reject)
      }
    }
  }
} }
runInNewContext(read('v3.1/live-product-layer.js'), { window: productWindow, document: { querySelector: () => null, getElementById: () => null }, setTimeout() {}, setInterval() {}, clearInterval() {}, console })
await productWindow.LELiveProduct.refresh()
assert.equal(productWindow.__LELiveData.metrics.recovered, 0, 'estimated opportunity amount must not replace missing collected amount')
productDelay = true
const lateProduct = productWindow.LELiveProduct.refresh()
await tick()
productListeners.forEach(fn => fn('SIGNED_OUT'))
assert.equal(productWindow.__LELiveData, null)
productPending.splice(0).forEach(resolve => resolve())
await lateProduct
assert.equal(productWindow.__LELiveData, null, 'late secondary data must not survive sign-out')

// Exercise the actual sales HTML encoder with hostile customer-supplied text.
const salesPrefix = read('v3.1/sales-crm.js').split('  function load(){')[0]
const salesWindow = {}
runInNewContext(salesPrefix + 'window.encode = esc;})();', { window: salesWindow })
assert.equal(salesWindow.encode('<img src=x onerror="alert(1)"> &'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp;')

const salesListeners = [], salesPending = [], nativeWrites = [], salesSnapshots = [], scheduled = []
class FixtureStorage { setItem(k, v) { nativeWrites.push([k, v]) } removeItem() {} }
const storage = new FixtureStorage()
const salesSyncWindow = { LESalesCRM: { setData: data => salesSnapshots.push(data) }, LESupabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'fixture' } } }), onAuthStateChange: fn => salesListeners.push(fn) },
  from(table) {
    return { select() { return this }, eq() { return this }, order() { return this }, limit() { return this },
      maybeSingle: async () => ({ data: { workspace_id: 'workspace-fixture' } }),
      then(resolve, reject) { return new Promise(r => salesPending.push(() => r({ data: table === 'workspace_records' ? [{ record_key: 'fixture', data: { customer: 'Private sales fixture' } }] : [] }))).then(resolve, reject) }
    }
  }
} }
runInNewContext(read('v3.1/sales-live-sync.js'), { window: salesSyncWindow, location: { pathname: '/dashboard' }, Storage: FixtureStorage, localStorage: storage, document: { getElementById: () => null }, setTimeout: fn => scheduled.push(fn), console })
await tick()
salesListeners.forEach(fn => fn('SIGNED_OUT'))
salesPending.splice(0).forEach(resolve => resolve())
await tick()
assert.ok(salesSnapshots.every(s => s.orders.length === 0), 'late sales hydration must not reveal the previous account')
storage.setItem('loose_ends_sales_crm_v1', JSON.stringify({ orders: [{ customer: 'Private fixture' }], events: [] }))
assert.equal(nativeWrites.length, 0, 'production sales save signals must not cache customer records')

// Calendar reads/writes the same in-memory CRM data after removing the browser cache.
const calendarData = { orders: [], events: [{ id: 'calendar-fixture' }] }
let calendarSaved
const calendarWindow = { LESalesCRM: { getData: () => calendarData, setData: value => { calendarSaved = value } } }
runInNewContext(read('v3.1/calendar-fix.js').split('  function key(d)')[0] + 'window.fixture={load:load,save:save};})();', { window: calendarWindow, location: { pathname: '/dashboard' } })
assert.equal(calendarWindow.fixture.load().events[0].id, 'calendar-fixture')
calendarWindow.fixture.save(calendarData)
assert.equal(calendarSaved, calendarData)

const workflowListeners = [], workflowPending = []
const workflowWindow = { LESupabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'fixture' } } }), getSession: async () => ({ data: {} }), onAuthStateChange: fn => workflowListeners.push(fn) },
  from() { return { select() { return this }, eq() { return this }, order() { return this }, limit() { return this },
    maybeSingle: async () => ({ data: { workspace_id: 'workflow-fixture' } }),
    then(resolve, reject) { return new Promise(r => workflowPending.push(() => r({ data: [{ id: 'private-workflow', name: 'Private fixture' }] }))).then(resolve, reject) }
  } }
} }
const workflowSource = read('v3.1/workflow-engine.js').replace('  window.LEWorkflows=', '  window.fixtureState=function(){return state;};window.LEWorkflows=')
runInNewContext(workflowSource, { window: workflowWindow, location: { pathname: '/dashboard' }, localStorage: { removeItem() {}, getItem() { throw new Error('Production must not load shared workflow cache') } }, document: { getElementById: () => null, querySelector: () => null, readyState: 'loading', addEventListener() {} }, setTimeout() {}, console })
const workflowLoad = workflowWindow.LEWorkflows.load()
await tick()
workflowListeners.forEach(fn => fn('SIGNED_OUT'))
workflowPending.splice(0).forEach(resolve => resolve())
await workflowLoad
assert.equal(workflowWindow.fixtureState().workflows.length, 0, 'late workflow load must not reveal another account configuration')
console.log('Production runtime session, stale-response, network failure, cache, and recovery-path tests passed')
