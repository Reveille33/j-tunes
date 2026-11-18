import { describe, it, expect } from 'vitest'
import { isCurrentEpisodePage } from '../src/shared/episodePaging'

describe('episode page loads', () => {
  it('ignores a page when the query or a later load has moved on', () => {
    expect(isCurrentEpisodePage(1, 1, 3, 3)).toBe(true)
    expect(isCurrentEpisodePage(1, 2, 3, 3)).toBe(false)
    expect(isCurrentEpisodePage(1, 1, 3, 4)).toBe(false)
  })
})