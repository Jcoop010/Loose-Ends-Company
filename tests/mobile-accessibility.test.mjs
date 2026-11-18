import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { installDomGlobals, loadSrcModule, readSrc } from './helpers/load-src-module.mjs'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><body><div id="mount"></div></body>', {
  url: 'https://loose-ends-os.vercel.app/dashboard',
  pretendToBeVisual: true,
})
const w = installDomGlobals(dom)

Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', {
  get() {
    return this.hidden || this.getAttribute('type') === 'hidden' ? null : w.document.body
  },
})

const { Dialog } = loadSrcModule('src/components/ui/Dialog.tsx', {
  globals: {
    window: w,
    document: w.document,
    HTMLElement: w.HTMLElement,
    KeyboardEvent: w.KeyboardEvent,
  },
})

function Harness() {
  const [open, setOpen] = React.useState(false)
  return React.createElement(
    'div',
    null,
    React.createElement(
      'button',
      { id: 'opener', type: 'button', onClick: () => setOpen(true) },
      'Open Profile',
    ),
    React.createElement(
      Dialog,
      {
        open,
        onClose: () => setOpen(false),
        title: 'Profile Fixture',
        description: 'Accessible modal fixture',
      },
      React.createElement('input', { type: 'hidden', value: 'ignored' }),
      React.createElement('input', { id: 'note-input', 'aria-label': 'Note' }),
      React.createElement('a', { id: 'history-link', href: '#history' }, 'History'),
    ),
  )
}

const root = createRoot(w.document.getElementById('mount'))
try {
  await act(async () => {
    root.render(React.createElement(Harness))
  })

  const opener = w.document.getElementById('opener')
  opener.focus()
  assert.equal(w.document.activeElement?.id, 'opener')

  await act(async () => {
    opener.click()
  })
  await act(async () => {
    await new Promise(r => setTimeout(r, 20))
  })

  const dialog = w.document.querySelector('[role="dialog"]')
  assert.ok(dialog, 'Dialog role rendered')
  assert.equal(dialog.getAttribute('aria-modal'), 'true')
  assert.equal(w.document.body.style.overflow, 'hidden', 'Background scroll locked while open')

  // First focusable inside Dialog is the Close button (excluding hidden inputs)
  const closeBtn = dialog.querySelector('button[aria-label="Close dialog"]')
  assert.ok(closeBtn, 'Close button rendered')
  assert.equal(
    w.document.activeElement?.getAttribute('aria-label'),
    'Close dialog',
    'Initial focus moves inside dialog to first visible control',
  )

  // Shift+Tab from first focusable wraps to the last focusable link
  w.document.dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
  )
  assert.equal(w.document.activeElement?.id, 'history-link', 'Shift+Tab wraps to last focusable control')

  // Tab from last focusable wraps back to the first focusable button
  w.document.dispatchEvent(
    new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
  )
  assert.equal(
    w.document.activeElement?.getAttribute('aria-label'),
    'Close dialog',
    'Tab wraps to first focusable control',
  )

  // Escape closes Dialog, unlocks scroll, and restores focus to opener
  await act(async () => {
    w.document.dispatchEvent(
      new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
  })
  await act(async () => {
    await new Promise(r => setTimeout(r, 20))
  })

  assert.equal(w.document.querySelector('[role="dialog"]'), null)
  assert.equal(w.document.body.style.overflow, '')
  assert.equal(w.document.activeElement?.id, 'opener', 'Focus restored to trigger element on close')
} finally {
  await act(async () => {
    root.unmount()
  })
  w.close()
}

// Verify public/qa/acceptance.js and acceptance.html invariants
const qa = readSrc('public/qa/acceptance.js')
const qaHtml = readSrc('public/qa/acceptance.html')
for (const check of [
  'No duplicate element IDs',
  'Images have alt attributes',
  'Buttons have accessible names',
  'loose-ends-acceptance.json',
]) {
  assert.ok(qa.includes(check), check)
}
assert.match(qaHtml, /id="export"/)
assert.match(qaHtml, /id="controls"/)
assert.match(qaHtml, /@media\(max-width:650px\)/)
assert.match(qaHtml, /button:disabled/)

console.log('Mobile navigation and modal accessibility regressions passed')
