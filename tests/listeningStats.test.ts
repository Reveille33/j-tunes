import { describe, it, expect } from 'vitest'
import { listeningIncrement } from '../src/main/services/listeningStats'

describe('listening increment', () => {
  it('counts a normal step once', () => {
    expect(listeningIncrement(40, 45, false)).toBe(5)
  })

  it('does not recount the playhead after mark-played clears the position', () => {
    expect(listeningIncrement(0, 55, true)).toBe(0)
  })

  it('still counts the start of a replay', () => {
    expect(listeningIncrement(0, 5, true)).toBe(5)
  })

  it('ignores seeks', () => {
    expect(listeningIncrement(10, 200, false)).toBe(0)
  })
})