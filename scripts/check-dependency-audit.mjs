import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function validateAudit(report, mode) {
  if (!['full', 'runtime'].includes(mode)) throw new Error('Audit mode must be full or runtime')
  const counts = report?.metadata?.vulnerabilities
  if (report?.error || !counts || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null || Array.isArray(report.vulnerabilities)) {
    throw new Error('Audit did not return a complete vulnerability report')
  }
  for (const level of ['info', 'low', 'moderate', 'high', 'critical', 'total']) {
    if (!Number.isSafeInteger(counts[level]) || counts[level] < 0) throw new Error('Invalid audit count: ' + level)
  }
  if (counts.total !== counts.info + counts.low + counts.moderate + counts.high + counts.critical) throw new Error('Inconsistent audit totals')
  if (counts.critical || (mode === 'runtime' && counts.high)) throw new Error('Dependency audit exceeds the ' + mode + ' security threshold')
  return counts
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const counts = validateAudit(JSON.parse(readFileSync(process.argv[2], 'utf8')), process.argv[3])
    console.log('Verified dependency audit:', JSON.stringify(counts))
  } catch (error) {
    console.error('Dependency audit failed:', error.message)
    process.exitCode = 1
  }
}
