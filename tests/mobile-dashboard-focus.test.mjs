import assert from 'node:assert/strict'
import { readSrc } from './helpers/load-src-module.mjs'

const css = readSrc('src/index.css')
const shell = readSrc('src/components/shell/AppShell.tsx')
const commandCenter = readSrc('src/features/workspaces/command-center/CommandCenterPage.tsx')
const html = readSrc('index.html')

assert.match(css, /@media\s*\(max-width:\s*768px\)/)
assert.match(css, /min-height:\s*44px/)
assert.match(css, /overflow-x:\s*clip/)
assert.match(shell, /aria-label="Mobile workspace navigation"/)
assert.match(shell, /grid-cols-5/)
assert.match(commandCenter, /grid-cols-2\s+gap-3\s+sm:grid-cols-3\s+lg:grid-cols-6/)
assert.match(html, /name="viewport"\s+content="width=device-width,\s*initial-scale=1\.0"/)

console.log('Mobile dashboard focus regression checks passed')
