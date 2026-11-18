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
