import { describe, it, expect } from 'vitest'
import { sanitiseFileName, fileExtension } from '../src/main/util/fsHelpers'

describe('sanitiseFileName', () => {
  it('replaces illegal filesystem characters with underscores', () => {
    expect(sanitiseFileName('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('removes ASCII control characters', () => {
    expect(sanitiseFileName('hello\u0000world\u001f!')).toBe('helloworld!')
  })

  it('collapses multiple spaces and trims outer whitespace', () => {
    expect(sanitiseFileName('   hello    world   ')).toBe('hello world')
  })

  it('strips trailing dots and spaces', () => {
    expect(sanitiseFileName('episode one...   ')).toBe('episode one')
    expect(sanitiseFileName('show name.')).toBe('show name')
  })

  it('prefixes Windows reserved device names with an underscore', () => {
    expect(sanitiseFileName('CON')).toBe('_CON')
    expect(sanitiseFileName('con.mp3')).toBe('_con.mp3')
    expect(sanitiseFileName('prn')).toBe('_prn')
    expect(sanitiseFileName('AUX.wav')).toBe('_AUX.wav')
    expect(sanitiseFileName('NUL')).toBe('_NUL')
    expect(sanitiseFileName('COM1')).toBe('_COM1')
    expect(sanitiseFileName('com9.m4a')).toBe('_com9.m4a')
    expect(sanitiseFileName('lpt1')).toBe('_lpt1')
    expect(sanitiseFileName('LPT9.ogg')).toBe('_LPT9.ogg')
  })

  it('does not prefix words that only start with reserved prefixes', () => {
    expect(sanitiseFileName('constant')).toBe('constant')
    expect(sanitiseFileName('auxiliary')).toBe('auxiliary')
    expect(sanitiseFileName('community')).toBe('community')
  })

  it('truncates to maxLength and strips any trailing dots or spaces from the slice', () => {
    const longName = 'a'.repeat(99) + '. extra text'
    const cleaned = sanitiseFileName(longName, 100)
    expect(cleaned.length).toBeLessThanOrEqual(100)
    expect(cleaned).not.toMatch(/[. ]$/)
  })

  it('falls back to "untitled" for empty or all-stripped names', () => {
    expect(sanitiseFileName('')).toBe('untitled')
    expect(sanitiseFileName('    ')).toBe('untitled')
    expect(sanitiseFileName('...')).toBe('untitled')
  })
})

describe('fileExtension', () => {
  it('extracts lower-cased extension including dot', () => {
    expect(fileExtension('track.MP3')).toBe('.mp3')
    expect(fileExtension('/path/to/audio.M4A')).toBe('.m4a')
    expect(fileExtension('noext')).toBe('')
  })
})
