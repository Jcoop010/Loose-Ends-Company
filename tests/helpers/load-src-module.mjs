import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { webcrypto } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(__dirname, '../..')
const cacheRoot = path.join(repoRoot, 'node_modules', '.cache', 'le-test-src')
const esmRoot = path.join(cacheRoot, 'esm')
const cjsRoot = path.join(cacheRoot, 'cjs')
const stampPath = path.join(cacheRoot, '.stamp.json')
const nodeRequire = createRequire(import.meta.url)

function ensurePrecompiled() {
  if (!fs.existsSync(stampPath)) {
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts', 'precompile-test-src.mjs')], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
  }
}

// Run check immediately when helper is imported (before JSDOM instantiation)
ensurePrecompiled()

function toNormalizedSrcTsKey(relFromRepo) {
  const clean = relFromRepo.replace(/\\/g, '/').replace(/\.(ts|tsx|js|jsx)$/, '')
  for (const ext of ['.ts', '.tsx']) {
    if (fs.existsSync(path.join(repoRoot, `${clean}${ext}`))) {
      return `${clean}${ext}`
    }
  }
  return relFromRepo.replace(/\\/g, '/')
}

function toCompiledRelJs(relFromRepo) {
  const clean = relFromRepo.replace(/\\/g, '/').replace(/\.(ts|tsx|js|jsx)$/, '')
  const direct = `${clean}.js`
  if (fs.existsSync(path.join(cjsRoot, direct))) {
    return direct
  }
  const indexJs = `${clean}/index.js`
  if (fs.existsSync(path.join(cjsRoot, indexJs))) {
    return indexJs
  }
  throw new Error(`Precompiled module not found for "${relFromRepo}" in ${cjsRoot}`)
}

/**
 * Dynamically imports a pre-compiled ESM `.js` module from `node_modules/.cache/le-test-src/esm/`.
 */
export async function importSrcModule(relPath) {
  const compiledRel = toCompiledRelJs(relPath)
  const targetUrl = pathToFileURL(path.join(esmRoot, compiledRel)).href
  return import(targetUrl)
}

/**
 * Loads a pre-compiled `.js` module from `node_modules/.cache/le-test-src/cjs/` in-process
 * without importing `typescript`, spawning `esbuild`, or allocating extra V8 VM contexts.
 */
export function loadSrcModule(
  relPath,
  { moduleOverrides = {}, globals = {}, cache = new Map() } = {},
) {
  const overrideKey = toNormalizedSrcTsKey(relPath)
  if (Object.prototype.hasOwnProperty.call(moduleOverrides, overrideKey)) {
    return moduleOverrides[overrideKey]
  }

  const compiledRel = toCompiledRelJs(relPath)
  const compiledFull = path.join(cjsRoot, compiledRel)

  if (cache.has(compiledFull)) {
    return cache.get(compiledFull).exports
  }

  const compiledCode = fs.readFileSync(compiledFull, 'utf8')
  const mod = { exports: {} }
  cache.set(compiledFull, mod)

  const compiledDir = path.dirname(compiledFull)
  const customRequire = specifier => {
    if (specifier === 'lucide-react') {
      const React = nodeRequire('react')
      return new Proxy(
        { __esModule: true },
        {
          get(target, prop) {
            if (prop in target) return target[prop]
            return function MockLucideIcon(props) {
              return React.createElement('svg', {
                ...props,
                'data-lucide-icon': String(prop),
              })
            }
          },
        },
      )
    }
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const targetCompiled = path.resolve(compiledDir, specifier)
      const targetRel = path.relative(cjsRoot, targetCompiled).replace(/\\/g, '/')
      return loadSrcModule(targetRel, { moduleOverrides, globals, cache })
    }
    return nodeRequire(specifier)
  }

  const effectiveGlobals = {
    crypto: webcrypto,
    ...globals,
  }
  const globalKeys = Object.keys(effectiveGlobals).filter(k => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k))
  const globalValues = globalKeys.map(k => effectiveGlobals[k])

  const fn = new Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    ...globalKeys,
    compiledCode,
  )
  fn(mod.exports, customRequire, mod, compiledFull, compiledDir, ...globalValues)
  return mod.exports
}

export function readSrc(relPath) {
  return fs.readFileSync(path.resolve(repoRoot, relPath), 'utf8')
}

export function installDomGlobals(dom) {
  const w = dom.window
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.window = w
  globalThis.document = w.document
  globalThis.HTMLElement = w.HTMLElement
  globalThis.Element = w.Element
  globalThis.Node = w.Node
  globalThis.Event = w.Event
  globalThis.KeyboardEvent = w.KeyboardEvent
  globalThis.MouseEvent = w.MouseEvent
  if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', {
      value: w.navigator,
      configurable: true,
    })
  }
  return w
}
