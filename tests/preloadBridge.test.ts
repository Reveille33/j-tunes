import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const preloadPath = join(root, 'src/preload/index.ts')

/**
 * Modules a sandboxed preload is allowed to load. Anything else (node builtins,
 * zod, database drivers) is either externalised and missing inside the sandbox,
 * or throws while the script is loading, and `window.api` never appears.
 */
const ALLOWED_PACKAGES = new Set(['electron'])

function sourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path))
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) files.push(path)
  }
  return files
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function valueImportSpecifiers(source: string): string[] {
  const text = stripComments(source)
  const specs: string[] = []
  for (const match of text.matchAll(/import\s+(type\s+)?[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g)) {
    if (match[1]) continue
    const spec = match[2]
    if (spec) specs.push(spec)
  }
  return specs
}

function resolveLocal(fromFile: string, spec: string): string | null {
  if (spec.startsWith('@shared/')) {
    return join(root, 'src/shared', `${spec.slice('@shared/'.length)}.ts`)
  }
  if (spec.startsWith('.')) return resolve(dirname(fromFile), `${spec}.ts`)
  return null
}

function preloadImportGraph(): string[] {
  const seen = new Set<string>()
  const external: string[] = []
  const visit = (file: string): void => {
    if (seen.has(file)) return
    seen.add(file)
    for (const spec of valueImportSpecifiers(readFileSync(file, 'utf8'))) {
      const local = resolveLocal(file, spec)
      if (local) visit(local)
      else external.push(spec)
    }
  }
  visit(preloadPath)
  return external
}

function rendererApiMethods(): string[] {
  const methods = new Set<string>()
  for (const file of sourceFiles(join(root, 'src/renderer'))) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/window\.api\??\.([A-Za-z0-9_]+)/g)) {
      const name = match[1]
      if (name) methods.add(name)
    }
  }
  return [...methods].sort()
}

function preloadApiMethods(source: string): string[] {
  const start = source.indexOf('const api = {')
  const end = source.indexOf('export type JTunesApi')
  const body = source.slice(start, end)
  return [...body.matchAll(/^\s{2}([A-Za-z0-9_]+)\s*(?::|\()/gm)]
    .map((match) => match[1])
    .filter((name): name is string => Boolean(name))
}

describe('preload bridge', () => {
  const source = readFileSync(preloadPath, 'utf8')

  it('exposes window.api before it touches the document', () => {
    const expose = source.indexOf("contextBridge.exposeInMainWorld('api'")
    const apply = source.indexOf('applyDocumentTheme(')
    expect(expose).toBeGreaterThan(-1)
    expect(apply).toBeGreaterThan(expose)
    expect(source).not.toContain('documentElement.setAttribute')
  })

  it('exposes every method the renderer calls', () => {
    const exposed = new Set(preloadApiMethods(source))
    const missing = rendererApiMethods().filter((method) => !exposed.has(method))
    expect(missing).toEqual([])
  })

  it('does not import modules the sandbox cannot load', () => {
    const external = preloadImportGraph()
    const disallowed = external.filter((spec) => !ALLOWED_PACKAGES.has(spec))
    expect(disallowed).toEqual([])
  })
})
