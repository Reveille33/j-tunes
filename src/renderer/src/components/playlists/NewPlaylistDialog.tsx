import { useState } from 'react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { commitPlaylistAdd } from '../../playlistActions'

interface NewPlaylistDialogProps {
  episodeIds: number[]
  onClose: () => void
}

/**
 * Names a playlist, then adds the episodes from the context menu to it.
 */
export function NewPlaylistDialog({
  episodeIds,
  onClose
}: NewPlaylistDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  useEscapeKey(onClose, !busy)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    await commitPlaylistAdd({ target: 'new', name: trimmed, episodeIds })
    onClose()
  }

  return (
    <div className="dialog-backdrop confirm-backdrop" onClick={onClose}>
      <div
        className="dialog dialog-small"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-playlist-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 id="new-playlist-title">New playlist</h2>
        </div>
        <form
          className="dialog-body"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="dialog-row">
            <input
              className="dialog-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Playlist name"
              aria-label="Playlist name"
              autoFocus
              disabled={busy}
              maxLength={200}
            />
          </div>
          <div className="dialog-actions">
            <button className="button" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="button button-primary" type="submit" disabled={busy || name.trim() === ''}>
              {busy ? 'Adding…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
