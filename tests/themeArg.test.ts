import { describe, it, expect, vi } from 'vitest'
import { applyDocumentTheme, themeArgument, themeFromArgv, type ThemeDocument } from '../src/shared/themeArg'

describe('theme argument', () => {
  it('round-trips the saved theme for the preload script', () => {
    expect(themeFromArgv(['electron', themeArgument('light')])).toBe('light')
    expect(themeFromArgv(['electron', themeArgument('dark')])).toBe('dark')
    expect(themeFromArgv(['electron'])).toBeNull()
    expect(themeFromArgv(['--jtunes-theme=blue'])).toBeNull()
  })

  it('sets the theme attribute when the root element already exists', () => {
    const setAttribute = vi.fn()
    const doc: ThemeDocument = {
      documentElement: { setAttribute },
      addEventListener: vi.fn()
    }
    applyDocumentTheme(doc, 'light')
    expect(setAttribute).toHaveBeenCalledWith('data-theme', 'light')
    expect(doc.addEventListener).not.toHaveBeenCalled()
  })

  it('does not throw when a sandboxed preload has no root element yet', () => {
    let listener: (() => void) | undefined
    let eventName = ''
    let options: { once?: boolean } | undefined
    const setAttribute = vi.fn()
    const doc: ThemeDocument = {
      documentElement: null,
      addEventListener: (type, cb, opts) => {
        eventName = type
        listener = cb
        options = opts
      }
    }
    expect(() => applyDocumentTheme(doc, 'light')).not.toThrow()
    expect(eventName).toBe('DOMContentLoaded')
    expect(options).toEqual({ once: true })
    doc.documentElement = { setAttribute }
    listener?.()
    expect(setAttribute).toHaveBeenCalledWith('data-theme', 'light')
  })

  it('still does not throw if the root element is missing when the document loads', () => {
    let listener: (() => void) | undefined
    const doc: ThemeDocument = {
      documentElement: null,
      addEventListener: (_type, cb) => {
        listener = cb
      }
    }
    applyDocumentTheme(doc, 'dark')
    expect(() => listener?.()).not.toThrow()
  })
})