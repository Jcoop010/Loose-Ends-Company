import assert from 'node:assert/strict'
import { validateAudit } from '../scripts/check-dependency-audit.mjs'

const clean = { vulnerabilities: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } }
assert.equal(validateAudit(clean, 'runtime').total, 0)
for (const report of [{}, { error: { code: 'ENOTFOUND' } }, { ...clean, error: { code: 'E401' } }, { ...clean, vulnerabilities: null }, { ...clean, metadata: { vulnerabilities: {} } }]) {
  assert.throws(() => validateAudit(report, 'runtime'), 'failed/incomplete audits must not pass the runtime gate')
}
for (const count of [-1, '0', NaN, Infinity]) {
  assert.throws(() => validateAudit({ ...clean, metadata: { vulnerabilities: { ...clean.metadata.vulnerabilities, high: count } } }, 'runtime'))
}
const high = { ...clean, metadata: { vulnerabilities: { ...clean.metadata.vulnerabilities, high: 1, total: 1 } } }
assert.throws(() => validateAudit(high, 'runtime'))
assert.equal(validateAudit(high, 'full').high, 1)
const critical = { ...clean, metadata: { vulnerabilities: { ...clean.metadata.vulnerabilities, critical: 1, total: 1 } } }
assert.throws(() => validateAudit(critical, 'runtime'))
assert.throws(() => validateAudit(critical, 'full'))
assert.throws(() => validateAudit({ ...clean, metadata: { vulnerabilities: { ...clean.metadata.vulnerabilities, total: 2 } } }, 'runtime'))
assert.throws(() => validateAudit(clean, 'unknown'))
console.log('Dependency audit failure-mode regression tests passed')
