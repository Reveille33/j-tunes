import { describe, it, expect } from 'vitest'
import { defaultSortDirection } from '../src/shared/sortDirection'
import type { SortDirection } from '../src/shared/types'

describe('sort direction', () => {
  it('uses a stable default instead of flipping the current direction', () => {
    expect(defaultSortDirection('release_date')).toBe('desc')
    expect(defaultSortDirection('duration')).toBe('desc')
    expect(defaultSortDirection('title')).toBe('asc')
    expect(defaultSortDirection('podcast')).toBe('asc')
    expect(defaultSortDirection('relevance')).toBe('asc')

    let direction: SortDirection = 'desc'
    direction = defaultSortDirection('duration')
    expect(direction).toBe('desc')

    direction = 'asc'
    direction = defaultSortDirection('release_date')
    expect(direction).toBe('desc')

    direction = defaultSortDirection('title')
    expect(direction).toBe('asc')
  })
})