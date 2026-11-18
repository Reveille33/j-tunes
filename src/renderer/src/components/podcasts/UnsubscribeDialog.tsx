import { useState } from 'react'
import { usePodcastStore } from '../../state/podcastStore'
import { useUiStore } from '../../state/uiStore'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import type { FileAction } from '@shared/types'

interface UnsubscribeDialogProps {
  podcastId: number
  onClose: () => void
}

/**
 * Confirms an unsubscribe and asks what should happen to the downloaded
 * files: keep them on disk, or move them to the OS recycle bin.
 *
 * The trash option is checked by default because it is the tidier outcome,
 * and trashed files remain recoverable.
 */
export function UnsubscribeDialog({ podcastId, onClose }: UnsubscribeDialogProps): React.JSX.Element {
  useEscapeKey(onClose)

  const podcasts = usePodcastStore((s) => s.podcasts)
  const removePodcast = usePodcastStore((s) => s.removePodcast)
  const showToast = useUiStore((s) => s.showToast)

  const [moveToTrash, setMoveToTrash] = useState(true)
  const [busy, setBusy] = useState(false)

  const podcast = podcasts.find((p) => p.id === podcastId)

  const confirm = async () => {
    setBusy(true)
    const fileAction: FileAction = moveToTrash ? 'trash' : 'keep'
    try {
      const result = await window.api.unsubscribe(podcastId, fileAction)
      removePodcast(podcastId)
      showToast(
        fileAction === 'trash'
          ? `Unsubscribed. ${result.fileCount ?? 0} file(s) moved to the Recycle Bin.`
          : `Unsubscribed. ${result.fileCount ?? 0} file(s) kept on disk.`,
        'success'
      )
      onClose()
    } catch (error) {
      showToast((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog dialog-small" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <h2>Unsubscribe from “{podcast?.title ?? 'this podcast'}”?</h2>
        </div>

        <div className="dialog-body">
          <p className="dialog-text">
            The podcast and its episode list will be removed from j-Tunes.
          </p>

          <label className="dialog-checkbox">
            <input
              type="checkbox"
              checked={moveToTrash}
              onChange={(event) => setMoveToTrash(event.target.checked)}
            />
            <span>
              Move downloaded episode files to the Recycle Bin
              <span className="dialog-hint">
                {moveToTrash
                  ? 'Files can still be recovered from the Recycle Bin.'
                  : 'Files will be left on disk where they are.'}
              </span>
            </span>
          </label>

          <div className="dialog-actions">
            <button className="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="button button-danger" onClick={() => void confirm()} disabled={busy}>
              {busy ? 'Working…' : moveToTrash ? 'Move to Trash & Unsubscribe' : 'Unsubscribe'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
