import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const styleDir = join(process.cwd(), 'src/renderer/src/styles')
const styleFiles = readdirSync(styleDir).filter((f) => f.endsWith('.css'))

/**
 * Modern browsers support native CSS nesting, so a missing closing brace
 * silently nests the rest of the stylesheet instead of raising a parse
 * error. These tests catch that class of bug, which would otherwise leave
 * large parts of the UI unstyled.
 */
describe('stylesheet integrity', () => {
  it('has stylesheets to check', () => {
    expect(styleFiles.length).toBeGreaterThan(0)
  })

  it.each(styleFiles)('%s has balanced braces', (file) => {
    const css = readFileSync(join(styleDir, file), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    )

    let depth = 0
    for (const ch of css) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
      expect(depth).toBeGreaterThanOrEqual(0)
    }
    expect(depth).toBe(0)
  })

  it.each(styleFiles)('%s has no accidentally nested rules', (file) => {
    const css = readFileSync(join(styleDir, file), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    )

    // Match a rule whose body may itself contain one level of nesting.
    const ruleRe = /([^{}]+)\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g
    let match: RegExpExecArray | null
    while ((match = ruleRe.exec(css)) !== null) {
      expect(match[2]).not.toMatch(/&\s*[.:#\[]/)
    }
  })

  it.each(styleFiles)('%s has no declarations outside any rule', (file) => {
    const css = readFileSync(join(styleDir, file), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    )

    // Walk the stylesheet tracking brace depth. A line that looks like a
    // declaration (`name: value`) while at depth 0 is an orphan left behind
    // when a selector's body was deleted — it does nothing and is a smell
    // that a real rule was lost.
    const declRe = /^\s*[a-z-]+\s*:/
    let depth = 0
    const orphans = []
    for (const line of css.split('\n')) {
      for (const ch of line) {
        if (ch === '{') depth++
        else if (ch === '}') depth--
      }
      if (depth === 0 && declRe.test(line)) {
        orphans.push(line.trim().slice(0, 60))
      }
    }
    expect(orphans).toEqual([])
  })

  it.each(styleFiles)('%s has no rule body that is empty', (file) => {
    const css = readFileSync(join(styleDir, file), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ''
    )

    // A selector followed immediately by `}` (allowing whitespace) is a
    // rule that was started but never given any declarations — the selector
    // is silently dropped.
    const emptyRe = /[^{}]*\{\s*\}/g
    const empty = [...css.matchAll(emptyRe)].map((m) => m[0].trim())
    expect(empty).toEqual([])
  })

  it('defines every custom property used by the components', () => {
    const theme = readFileSync(join(styleDir, 'theme.css'), 'utf8')
    const components = readFileSync(join(styleDir, 'components.css'), 'utf8')

    const defined = new Set(
      [...theme.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1])
    )
    const used = new Set([...components.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]))

    // `--progress` is supplied inline by the player components at runtime,
    // so it is not expected to come from the theme.
    const inline = new Set(['--progress'])

    const missing = [...used].filter(
      (name) => !defined.has(name) && !inline.has(name)
    )
    expect(missing).toEqual([])
  })
})
