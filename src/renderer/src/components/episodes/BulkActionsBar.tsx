interface BulkActionsBarProps {
  count: number
  busy: boolean
  onMarkPlayed: () => void
  onMarkUnplayed: () => void
  onAddToQueue: () => void
  onSelectAll: () => void
  onClear: () => void
}

/**
 * The action strip shown while one or more episodes are ticked.
 */
export function BulkActionsBar({
  count,
  busy,
  onMarkPlayed,
  onMarkUnplayed,
  onAddToQueue,
  onSelectAll,
  onClear
}: BulkActionsBarProps): React.JSX.Element {
  return (
    <div className="bulk-bar">
      <span className="bulk-count">
        {count} selected
      </span>

      <div className="bulk-actions">
        <button className="button" onClick={onMarkPlayed} disabled={busy}>
          Mark played
        </button>
        <button className="button" onClick={onMarkUnplayed} disabled={busy}>
          Mark unplayed
        </button>
        <button className="button" onClick={onAddToQueue} disabled={busy}>
          Add to Up Next
        </button>
        <button className="button" onClick={onSelectAll} disabled={busy}>
          Select all loaded
        </button>
        <button className="button" onClick={onClear} disabled={busy}>
          Clear
        </button>
      </div>
    </div>
  )
}