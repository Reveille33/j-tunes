import { useUiStore, type ViewFilter } from '../../state/uiStore'
import { usePodcastStore } from '../../state/podcastStore'
import type { SortBy } from '@shared/types'

const FILTERS: { id: ViewFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unplayed', label: 'Unplayed' },
  { id: 'downloaded', label: 'Downloaded' }
]

const SORTS: { id: SortBy; label: string }[] = [
  { id: 'release_date', label: 'Release date' },
  { id: 'title', label: 'Title' },
  { id: 'duration', label: 'Duration' },
  { id: 'podcast', label: 'Podcast' }
]

/**
 * The toolbar above the episode list: view filters, year filter, sort
 * control and the global description toggle.
 */
export function FilterPanel(): React.JSX.Element {
  const viewFilter = useUiStore((s) => s.viewFilter)
  const setViewFilter = useUiStore((s) => s.setViewFilter)
  const sortBy = useUiStore((s) => s.sortBy)
  const setSortBy = useUiStore((s) => s.setSortBy)
  const direction = useUiStore((s) => s.direction)
  const toggleDirection = useUiStore((s) => s.toggleDirection)
  const year = useUiStore((s) => s.year)
  const setYear = useUiStore((s) => s.setYear)
  const descriptionsVisible = useUiStore((s) => s.descriptionsVisible)
  const setDescriptionsVisible = useUiStore((s) => s.setDescriptionsVisible)
  const descriptionsFull = useUiStore((s) => s.descriptionsFull)
  const setDescriptionsFull = useUiStore((s) => s.setDescriptionsFull)
  const descriptionTerm = useUiStore((s) => s.descriptionTerm)
  const setDescriptionTerm = useUiStore((s) => s.setDescriptionTerm)
  const years = usePodcastStore((s) => s.years)

  return (
    <div className="filter-panel">
      <div className="filter-group filter-tabs">
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            className={`filter-tab${viewFilter === filter.id ? ' is-active' : ''}`}
            onClick={() => setViewFilter(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="filter-group">
        <label className="filter-label" htmlFor="year-filter">
          Year
        </label>
        <select
          id="year-filter"
          className="filter-select"
          value={year ?? ''}
          onChange={(event) => {
            const value = event.target.value
            setYear(value ? Number(value) : null)
          }}
        >
          <option value="">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-label" htmlFor="sort-filter">
          Sort
        </label>
        <select
          id="sort-filter"
          className="filter-select"
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as SortBy)}
        >
          {SORTS.map((sort) => (
            <option key={sort.id} value={sort.id}>
              {sort.label}
            </option>
          ))}
        </select>
        <button
          className="icon-button"
          onClick={toggleDirection}
          title={direction === 'asc' ? 'Ascending' : 'Descending'}
          aria-label={`Sort ${direction === 'asc' ? 'ascending' : 'descending'}`}
        >
          {direction === 'asc' ? '↑' : '↓'}
        </button>
      </div>

      <div className="filter-group filter-group-grow">
        <input
          className="filter-input"
          type="search"
          placeholder="Filter descriptions…"
          value={descriptionTerm}
          onChange={(event) => setDescriptionTerm(event.target.value)}
          aria-label="Filter by description text"
        />
      </div>

      <div className="filter-group">
        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={descriptionsVisible}
            onChange={(event) => setDescriptionsVisible(event.target.checked)}
          />
          <span>Show descriptions</span>
        </label>
        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={descriptionsFull}
            onChange={(event) => setDescriptionsFull(event.target.checked)}
          />
          <span>Show full descriptions</span>
        </label>
      </div>
    </div>
  )
}
