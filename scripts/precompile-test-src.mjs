import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const srcRoot = path.join(repoRoot, 'src')
const cacheRoot = path.join(repoRoot, 'node_modules', '.cache', 'le-test-src')
const esmRoot = path.join(cacheRoot, 'esm')
const cjsRoot = path.join(cacheRoot, 'cjs')

function collectSourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc)
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.d.ts')
    ) {
      acc.push(full)
    }
  }
  return acc
}

function resolveRelativeJsSpecifier(fromSrcDir, spec) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) {
    return spec
  }
  const cleanSpec = spec.replace(/\.(ts|tsx|js|jsx)$/, '')
  const candidateBase = path.resolve(fromSrcDir, cleanSpec)
  if (
    fs.existsSync(path.join(candidateBase, 'index.ts')) ||
    fs.existsSync(path.join(candidateBase, 'index.tsx'))
  ) {
    return `${cleanSpec.replace(/\/$/, '')}/index.js`
  }
  return `${cleanSpec}.js`
}

function rewriteRelativeImports(code, fromSrcDir) {
  return code
    .replace(
      /(\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"])(\.\.?\/[^'"]+)(['"])/g,
      (_m, pre, spec, post) => `${pre}${resolveRelativeJsSpecifier(fromSrcDir, spec)}${post}`,
    )
    .replace(
      /(\brequire\(\s*['"])(\.\.?\/[^'"]+)(['"]\s*\))/g,
      (_m, pre, spec, post) => `${pre}${resolveRelativeJsSpecifier(fromSrcDir, spec)}${post}`,
    )
}

fs.rmSync(cacheRoot, { recursive: true, force: true })
fs.mkdirSync(esmRoot, { recursive: true })
fs.mkdirSync(cjsRoot, { recursive: true })
fs.writeFileSync(path.join(esmRoot, 'package.json'), JSON.stringify({ type: 'module' }, null, 2))
fs.writeFileSync(path.join(cjsRoot, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2))

const files = collectSourceFiles(srcRoot)

for (const fullPath of files) {
  const relFromRepo = path.relative(repoRoot, fullPath).replace(/\\/g, '/')
  const outRelJs = relFromRepo.replace(/\.(ts|tsx)$/, '.js')
  const fromSrcDir = path.dirname(fullPath)
  const raw = fs
    .readFileSync(fullPath, 'utf8')
    .replace(/\bimport\.meta\.env\b/g, '(globalThis.__VITE_ENV__ || {})')

  const esmOut = ts.transpileModule(raw, {
    fileName: fullPath,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
  }).outputText

  const cjsOut = ts.transpileModule(raw, {
    fileName: fullPath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
  }).outputText

  const esmTarget = path.join(esmRoot, outRelJs)
  const cjsTarget = path.join(cjsRoot, outRelJs)
  fs.mkdirSync(path.dirname(esmTarget), { recursive: true })
  fs.mkdirSync(path.dirname(cjsTarget), { recursive: true })

  fs.writeFileSync(esmTarget, rewriteRelativeImports(esmOut, fromSrcDir))
  fs.writeFileSync(cjsTarget, rewriteRelativeImports(cjsOut, fromSrcDir))
}

fs.writeFileSync(
  path.join(cacheRoot, '.stamp.json'),
  JSON.stringify({ compiledAt: new Date().toISOString(), fileCount: files.length }),
)
console.log(`Precompiled ${files.length} src modules into node_modules/.cache/le-test-src`)
