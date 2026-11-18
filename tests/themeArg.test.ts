import { describe, it, expect } from 'vitest'
import { themeArgument, themeFromArgv } from '../src/shared/themeArg'

describe('theme argument', () => {
  it('round-trips the saved theme for the preload script', () => {
    expect(themeFromArgv(['electron', themeArgument('light')])).toBe('light')
    expect(themeFromArgv(['electron', themeArgument('dark')])).toBe('dark')
    expect(themeFromArgv(['electron'])).toBeNull()
    expect(themeFromArgv(['--jtunes-theme=blue'])).toBeNull()
  })
})