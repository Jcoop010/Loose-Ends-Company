import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../revenueEngine.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }
runInNewContext(compiled, { module, exports: module.exports, require: createRequire(import.meta.url), Date, Math, Number, String })
const { scanRevenue } = module.exports

const customer = (id, status, notes = []) => ({ id, name: id, status, notes, lifetimeValue: 1000 })
const base = { customers: [], opportunities: [], salesOrders: [], leads: [] }
const empty = scanRevenue({ ...base, customers: [customer('one', 'Follow-Up Due')] })
assert.equal(empty.opportunities.length, 0, 'generic follow-up must not invent an estimate')

const missed = scanRevenue({ ...base, customers: [customer('one', 'Active', ['Missed call yesterday'])] })
assert.equal(missed.opportunities.length, 1)
assert.equal(missed.opportunities[0].type, 'Missed Call')
assert.equal(missed.opportunities[0].customerId, 'one')

const duplicate = scanRevenue({ ...base, customers: [customer('one', 'Active', ['Missed call yesterday'])], opportunities: [{ ...missed.opportunities[0], id: 'existing' }] })
assert.equal(duplicate.opportunities.length, 0, 'existing open recovery must not be duplicated')

const isolated = scanRevenue({ ...base, customers: [customer('other', 'Active', ['Missed call'])], opportunities: [{ ...missed.opportunities[0], id: 'first-workspace' }] })
assert.equal(isolated.opportunities.length, 1, 'different customers must retain independent recovery signals')

const paid = scanRevenue({ ...base, customers: [customer('one', 'Active')], salesOrders: [{ customerId: 'one', number: 'SO-1', status: 'Invoiced', paymentStatus: 'Paid', items: [{ qty: 1, unitPrice: 500 }] }] })
assert.equal(paid.opportunities.length, 0, 'paid invoice must not be flagged')
const unpaid = scanRevenue({ ...base, customers: [customer('one', 'Active')], salesOrders: [{ customerId: 'one', number: 'SO-2', status: 'Invoiced', paymentStatus: 'Unpaid', items: [{ qty: 2, unitPrice: 250 }] }] })
assert.equal(unpaid.opportunities[0].type, 'Unpaid Invoice')
assert.equal(unpaid.opportunities[0].potentialValue, 500)
console.log('Revenue recovery assertions passed')
