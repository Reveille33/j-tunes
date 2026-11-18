import type { SortBy, SortDirection } from './types'

/** Stable default for a sort field. Changing fields must not flip the current direction. */
export function defaultSortDirection(sortBy: SortBy): SortDirection {
  if (sortBy === 'title' || sortBy === 'podcast' || sortBy === 'relevance') return 'asc'
  return 'desc'
}
