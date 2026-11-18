import assert from 'node:assert/strict'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { readSrc } from './helpers/load-src-module.mjs'

const cssSource = readSrc('src/index.css')
const html = readSrc('index.html')

assert.match(html, /src="\/src\/main\.tsx"/)

for (const required of [
  '--surface-canvas',
  '--surface-rail',
  'font-variant-numeric: tabular-nums',
  ':focus-visible',
  'prefers-reduced-motion',
  'min-height: 44px',
  'overflow-x: clip',
]) {
  assert.ok(cssSource.includes(required), `Expected src/index.css to contain: ${required}`)
}

assert.doesNotMatch(cssSource, /display:\s*none\s*!important/)

// Verify Tailwind v4 PostCSS compilation succeeds cleanly
const compiled = await postcss([tailwindcss()]).process(cssSource, {
  from: 'src/index.css',
})
assert.ok(compiled.css.length > 10_000, 'Compiled CSS bundle contains utility and component layers')
assert.ok(compiled.css.includes('tabular-nums'))

console.log('Executive operations UI, tabular-nums, and 44px touch-target checks passed')
