import type { Theme } from './types'

const THEME_ARG = '--jtunes-theme='

export function themeArgument(theme: Theme): string {
  return `${THEME_ARG}${theme}`
}

/** Reads the theme the main process passed in before the first paint. */
export function themeFromArgv(argv: readonly string[]): Theme | null {
  const match = argv.find((arg) => arg.startsWith(THEME_ARG))
  const value = match?.slice(THEME_ARG.length)
  return value === 'light' || value === 'dark' ? value : null
}

interface ThemeRoot {
  setAttribute(name: string, value: string): void
}

/**
 * The document the preload can see. A sandboxed preload runs while the
 * parser is still in `loading`, so `documentElement` is null and calling
 * `setAttribute` on it throws.
 */
export interface ThemeDocument {
  documentElement: ThemeRoot | null
  addEventListener(
    type: string,
    listener: () => void,
    options?: { once?: boolean }
  ): void
}

/**
 * Sets `data-theme` on the page root. When the root does not exist yet,
 * waits until the parser creates it. Never throws if the element is missing.
 */
export function applyDocumentTheme(doc: ThemeDocument, theme: Theme): void {
  const apply = (): void => {
    doc.documentElement?.setAttribute('data-theme', theme)
  }
  if (doc.documentElement) {
    apply()
    return
  }
  doc.addEventListener('DOMContentLoaded', apply, { once: true })
}
