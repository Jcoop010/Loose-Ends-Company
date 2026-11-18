import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const nodeRequire = createRequire(import.meta.url)

function loadScriptTsModule(relPath, moduleCache = new Map()) {
  const fullPath = path.resolve(repoRoot, relPath)
  if (moduleCache.has(fullPath)) {
    return moduleCache.get(fullPath).exports
  }

  const rawSource = fs.readFileSync(fullPath, 'utf8')
  const transpiled = ts.transpileModule(rawSource, {
    fileName: fullPath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
  }).outputText

  const mod = { exports: {} }
  moduleCache.set(fullPath, mod)

  const dirName = path.dirname(fullPath)
  const customRequire = specifier => {
    if (specifier === '@supabase/supabase-js') {
      return {
        createClient() {
          throw new Error('Unexpected live Supabase call inside air-gapped unit test')
        },
      }
    }
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const candidateBase = path.resolve(dirName, specifier)
      const targetTs = candidateBase.endsWith('.ts') ? candidateBase : `${candidateBase}.ts`
      const relTarget = path.relative(repoRoot, targetTs).replace(/\\/g, '/')
      return loadScriptTsModule(relTarget, moduleCache)
    }
    return nodeRequire(specifier)
  }

  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', transpiled)
  fn(mod.exports, customRequire, mod, fullPath, dirName)
  return mod.exports
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// 1. Verify zero `any` escapes across all local-AI TypeScript files
for (const relFile of [
  'scripts/node-ambient.d.ts',
  'scripts/lib/ollamaClient.ts',
  'scripts/lib/receiptAudit.ts',
  'scripts/generateOutreachDrafts.ts',
  'scripts/parseReceiptLocal.ts',
]) {
  const codeOnly = stripComments(fs.readFileSync(path.join(repoRoot, relFile), 'utf8'))
  assert.equal(
    /(:\s*any\b|\bas\s+any\b|<any>|Array<\s*any\s*>)/.test(codeOnly),
    false,
    `${relFile} must contain zero TypeScript any types`,
  )
}

const scriptCache = new Map()
const ollamaClient = loadScriptTsModule('scripts/lib/ollamaClient.ts', scriptCache)
const receiptAudit = loadScriptTsModule('scripts/lib/receiptAudit.ts', scriptCache)
const outreachMod = loadScriptTsModule('scripts/generateOutreachDrafts.ts', scriptCache)
const parseReceiptMod = loadScriptTsModule('scripts/parseReceiptLocal.ts', scriptCache)

const originalFetch = globalThis.fetch

try {
  // =========================================================================
  // 2. Test ollamaClient.ts (health checks & strict structured generation)
  // =========================================================================
  {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'http://localhost:11434/api/tags')
      assert.equal(init.method, 'GET')
      return new Response(JSON.stringify({ models: [{ name: 'gemma4:e2b' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const healthy = await ollamaClient.checkOllamaHealth('http://localhost:11434/', 'gemma4:e2b')
    assert.deepEqual(healthy, { available: true, hasModel: true })

    const missingModel = await ollamaClient.checkOllamaHealth('http://localhost:11434', 'gemma4:e4b')
    assert.equal(missingModel.available, true)
    assert.equal(missingModel.hasModel, false)
    assert.match(missingModel.reason, /not_pulled/)
  }

  {
    globalThis.fetch = async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434')
    }
    const offline = await ollamaClient.checkOllamaHealth('http://localhost:11434', 'gemma4:e2b')
    assert.equal(offline.available, false)
    assert.equal(offline.hasModel, false)
    assert.match(offline.reason, /ECONNREFUSED/)
  }

  {
    let capturedBody = null
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'http://localhost:11434/api/chat')
      assert.equal(init.method, 'POST')
      capturedBody = JSON.parse(init.body)
      return new Response(
        JSON.stringify({
          model: 'gemma4:e2b',
          done: true,
          message: {
            role: 'assistant',
            content: '```json\n{"vendor":"Acme Supply","total_cents":4250}\n```',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const validator = raw => {
      if (
        typeof raw === 'object' &&
        raw !== null &&
        typeof raw.vendor === 'string' &&
        Number.isSafeInteger(raw.total_cents)
      ) {
        return { vendor: raw.vendor, total_cents: raw.total_cents }
      }
      return null
    }

    const parsed = await ollamaClient.callOllamaStructured(
      {
        baseUrl: 'http://localhost:11434',
        model: 'gemma4:e2b',
        temperature: 0.1,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['vendor', 'total_cents'],
          properties: {
            vendor: { type: 'string' },
            total_cents: { type: 'integer' },
          },
        },
        messages: [{ role: 'user', content: 'parse', images: ['YmFzZTY0'] }],
      },
      validator,
    )

    assert.deepEqual(parsed, { vendor: 'Acme Supply', total_cents: 4250 })
    assert.equal(capturedBody.stream, false)
    assert.equal(capturedBody.think, false)
    assert.equal(capturedBody.model, 'gemma4:e2b')
    assert.deepEqual(capturedBody.messages[0].images, ['YmFzZTY0'])
    assert.equal(capturedBody.options.temperature, 0.1)

    // Schema mismatch returns null cleanly
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          message: { content: JSON.stringify({ vendor: 'Acme', total_cents: 42.5 }) },
        }),
        { status: 200 },
      )
    const rejectedFloat = await ollamaClient.callOllamaStructured(
      {
        baseUrl: 'http://localhost:11434',
        model: 'gemma4:e2b',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['vendor', 'total_cents'],
          properties: { vendor: { type: 'string' }, total_cents: { type: 'integer' } },
        },
        messages: [{ role: 'user', content: 'parse' }],
      },
      validator,
    )
    assert.equal(rejectedFloat, null)

    // Network timeout returns null cleanly without throwing
    globalThis.fetch = async () => {
      throw new DOMException('The operation timed out', 'TimeoutError')
    }
    const timedOut = await ollamaClient.callOllamaStructured(
      {
        baseUrl: 'http://localhost:11434',
        model: 'gemma4:e2b',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['vendor', 'total_cents'],
          properties: { vendor: { type: 'string' }, total_cents: { type: 'integer' } },
        },
        messages: [{ role: 'user', content: 'parse' }],
      },
      validator,
    )
    assert.equal(timedOut, null)
  }

  // =========================================================================
  // 3. Test receiptAudit.ts (file guards, strict integer math, fees, staging)
  // =========================================================================
  assert.deepEqual(receiptAudit.classifyReceiptFile('/tmp/invoice.PNG', 2048), {
    kind: 'image',
    extension: '.png',
  })
  assert.deepEqual(receiptAudit.classifyReceiptFile('C:\\bills\\vendor.txt', 512), {
    kind: 'text',
    extension: '.txt',
  })
  assert.throws(() => receiptAudit.classifyReceiptFile('invoice.pdf', 1024), /Unsupported receipt extension/)
  assert.throws(() => receiptAudit.classifyReceiptFile('empty.txt', 0), /empty/)
  assert.throws(
    () => receiptAudit.classifyReceiptFile('huge.jpg', receiptAudit.MAX_RECEIPT_FILE_BYTES + 1),
    /exceeds maximum size/,
  )

  // Validate extracted receipt rejects floats & bad ISO dates
  assert.equal(
    receiptAudit.validateExtractedReceipt({
      vendor_name: 'Valley Supply',
      invoice_number: 'INV-10',
      invoice_date: '2026-11-18',
      currency: 'usd',
      line_items: [{ description: 'Pipe', quantity: 2, unit_price_cents: 12.5, line_total_cents: 25 }],
      subtotal_cents: 25,
      tax_cents: 0,
      extracted_total_cents: 25,
      possible_duplicate_or_fee_flags: [],
    }),
    null,
  )
  assert.equal(
    receiptAudit.validateExtractedReceipt({
      vendor_name: 'Valley Supply',
      invoice_number: null,
      invoice_date: '2026-99-99',
      currency: 'USD',
      line_items: [],
      subtotal_cents: 0,
      tax_cents: 0,
      extracted_total_cents: 0,
      possible_duplicate_or_fee_flags: [],
    }),
    null,
  )

  const cleanReceipt = receiptAudit.validateExtractedReceipt({
    vendor_name: 'Tri-State Parts Co.',
    invoice_number: 'INV-8842',
    invoice_date: '2026-11-18',
    currency: 'USD',
    line_items: [
      { description: '40/5 uF Capacitor', quantity: 2, unit_price_cents: 1850, line_total_cents: 3700 },
      { description: 'Contactor 24V', quantity: 1, unit_price_cents: 2400, line_total_cents: 2400 },
    ],
    subtotal_cents: 6100,
    tax_cents: 427,
    extracted_total_cents: 6527,
    possible_duplicate_or_fee_flags: [],
  })
  assert.ok(cleanReceipt)
  const cleanVerification = receiptAudit.verifyReceiptMath(cleanReceipt)
  assert.equal(cleanVerification.computed_subtotal_cents, 6100)
  assert.equal(cleanVerification.computed_total_cents, 6527)
  assert.equal(cleanVerification.discrepancy_cents, 0)
  assert.equal(cleanVerification.has_math_discrepancy, false)
  assert.equal(cleanVerification.all_flags.length, 0)

  const cleanStaged = receiptAudit.buildStagedReceiptAction({
    workspaceId: '1dfa4852-9415-446a-b8c2-6d2263f65998',
    receipt: cleanReceipt,
    verification: cleanVerification,
    sourceFileName: 'clean-bill.txt',
    model: 'gemma4:e2b',
  })
  assert.equal(cleanStaged.action_type, 'expense_receipt')
  assert.equal(cleanStaged.amount_cents, 6527)
  assert.equal(cleanStaged.confidence_score, 0.94)
  assert.equal(cleanStaged.bot_role, 'billing')
  assert.equal(cleanStaged.workspace_domain, 'billing')
  assert.equal(cleanStaged.status, 'pending_approval')

  // Discrepancy + duplicate line item + suspicious fee detection
  const flaggedReceipt = {
    vendor_name: 'Appalachian Freight & Supply',
    invoice_number: 'BILL-771',
    invoice_date: '2026-11-18',
    currency: 'USD',
    line_items: [
      { description: ' Copper Fitting  Pack ', quantity: 1, unit_price_cents: 1500, line_total_cents: 1500 },
      { description: 'copper fitting pack', quantity: 1, unit_price_cents: 1500, line_total_cents: 1500 },
      { description: 'Winter Fuel Surcharge', quantity: 1, unit_price_cents: 2500, line_total_cents: 2500 },
    ],
    subtotal_cents: 5500,
    tax_cents: 300,
    extracted_total_cents: 6800, // Deliberate $10.00 (1000 cents) overcharge
    possible_duplicate_or_fee_flags: [],
  }
  const flaggedVerification = receiptAudit.verifyReceiptMath(flaggedReceipt)
  assert.equal(flaggedVerification.computed_subtotal_cents, 5500)
  assert.equal(flaggedVerification.computed_total_cents, 5800)
  assert.equal(flaggedVerification.discrepancy_cents, 1000)
  assert.equal(flaggedVerification.has_math_discrepancy, true)
  assert.equal(flaggedVerification.duplicate_line_flags.length, 1)
  assert.equal(flaggedVerification.suspicious_fee_flags.length, 1)
  assert.ok(flaggedVerification.all_flags.length >= 3)

  const flaggedStaged = receiptAudit.buildStagedReceiptAction({
    workspaceId: '1dfa4852-9415-446a-b8c2-6d2263f65998',
    receipt: flaggedReceipt,
    verification: flaggedVerification,
    sourceFileName: 'bill-771.txt',
    model: 'gemma4:e2b',
  })
  assert.equal(flaggedStaged.action_type, 'vendor_bill_audit')
  assert.equal(flaggedStaged.amount_cents, 5800, 'amount_cents must use verified computed_total_cents')
  assert.equal(flaggedStaged.payload.extracted_total_cents, 6800)
  assert.equal(flaggedStaged.payload.discrepancy_cents, 1000)
  assert.equal(flaggedStaged.confidence_score, 0.62)

  // Runtime Number.isSafeInteger guard against unsafe inputs bypassing validation
  assert.throws(
    () =>
      receiptAudit.verifyReceiptMath({
        ...flaggedReceipt,
        subtotal_cents: 12.34,
      }),
    /expected non-negative safe integer/,
  )
  assert.throws(
    () =>
      receiptAudit.verifyReceiptMath({
        ...flaggedReceipt,
        tax_cents: Number.NaN,
      }),
    /expected non-negative safe integer/,
  )
  assert.throws(
    () =>
      receiptAudit.verifyReceiptMath({
        ...flaggedReceipt,
        extracted_total_cents: -100,
      }),
    /expected non-negative safe integer/,
  )

  // =========================================================================
  // 4. Test generateOutreachDrafts.ts (local Ollama + clean deterministic fallback)
  // =========================================================================
  const ciSkipped = await outreachMod.resolveLocalOllamaOutreachProvider({ CI: 'true' })
  assert.equal(ciSkipped.enabled, false)
  assert.equal(ciSkipped.modeLabel, 'deterministic-fallback')

  const disabledSkipped = await outreachMod.resolveLocalOllamaOutreachProvider({
    OLLAMA_DISABLED: 'true',
  })
  assert.equal(disabledSkipped.enabled, false)
  assert.equal(disabledSkipped.modeLabel, 'deterministic-fallback')

  globalThis.fetch = async url => {
    if (String(url).endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [{ name: 'gemma4:e2b' }] }), { status: 200 })
    }
    return new Response(
      JSON.stringify({
        message: {
          content: JSON.stringify({
            subject: 'Quick ops question for Kanawha Mechanical',
            body: 'Hi Sam,\n\nI noticed Kanawha Mechanical serves commercial HVAC sites around Charleston. Many teams struggle with unbilled field add-ons slipping past invoice review. Here is our interactive sandbox: https://loose-ends-os.vercel.app/demo\n\nBest,\nLoose Ends Team',
            detected_angle: 'unbilled field work',
          }),
        },
      }),
      { status: 200 },
    )
  }

  const resolvedProvider = await outreachMod.resolveLocalOllamaOutreachProvider({
    OLLAMA_BASE_URL: 'http://localhost:11434',
    OLLAMA_MODEL: 'gemma4:e2b',
  })
  assert.equal(resolvedProvider.enabled, true)
  assert.equal(resolvedProvider.modeLabel, 'local-ollama:gemma4:e2b')

  const sampleLeadInput = {
    companyName: 'Kanawha Mechanical',
    contactName: 'Sam',
    industry: 'HVAC & Mechanical',
    location: 'Charleston, WV',
    website: 'https://kanawha-example.invalid',
    notes: 'commercial service',
    publicAppUrl: 'https://loose-ends-os.vercel.app',
    senderName: 'Loose Ends Operations Team',
  }

  const ollamaDraft = await outreachMod.generateOutreachDraftText(sampleLeadInput, {
    localOllama: resolvedProvider,
    allowXaiFallback: false,
  })
  assert.equal(ollamaDraft.provider, 'local-ollama:gemma4:e2b')
  assert.match(ollamaDraft.body, /https:\/\/loose-ends-os\.vercel\.app\/demo/)

  // Missing /demo link triggers validation rejection and silent fallback
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        message: {
          content: JSON.stringify({
            subject: 'Hello',
            body: 'No demo link included in this message.',
            detected_angle: 'stale quotes',
          }),
        },
      }),
      { status: 200 },
    )
  const fallbackOnMissingLink = await outreachMod.generateOutreachDraftText(sampleLeadInput, {
    localOllama: resolvedProvider,
    allowXaiFallback: false,
  })
  assert.equal(fallbackOnMissingLink.provider, 'deterministic-fallback')
  assert.match(fallbackOnMissingLink.body, /https:\/\/loose-ends-os\.vercel\.app\/demo/)

  // Offline / connection refused fallback returns deterministic template cleanly
  globalThis.fetch = async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:11434')
  }
  const offlineFallback = await outreachMod.generateOutreachDraftText(sampleLeadInput, {
    localOllama: { enabled: false, baseUrl: 'http://localhost:11434', model: 'gemma4:e2b' },
    allowXaiFallback: false,
  })
  assert.equal(offlineFallback.provider, 'deterministic-fallback')
  assert.match(offlineFallback.subject, /Kanawha Mechanical/)
  assert.match(offlineFallback.body, /https:\/\/loose-ends-os\.vercel\.app\/demo/)

  // =========================================================================
  // 5. Test parseReceiptLocal.ts CLI arg parser
  // =========================================================================
  const parsedArgs = parseReceiptMod.parseReceiptCliArgs([
    '--file',
    'receipts/sample.png',
    '--workspace',
    '1dfa4852-9415-446a-b8c2-6d2263f65998',
    '--dry-run',
  ])
  assert.equal(parsedArgs.filePath, 'receipts/sample.png')
  assert.equal(parsedArgs.workspaceId, '1dfa4852-9415-446a-b8c2-6d2263f65998')
  assert.equal(parsedArgs.dryRun, true)

  assert.throws(() => parseReceiptMod.parseReceiptCliArgs([]), /Missing required argument --file/)
  assert.throws(
    () => parseReceiptMod.parseReceiptCliArgs(['--file', 'a.txt', '--workspace', 'not-a-uuid']),
    /Invalid --workspace UUID/,
  )
} finally {
  globalThis.fetch = originalFetch
}

console.log('Local Ollama + Gemma 4 outreach & deterministic receipt audit tests passed')
