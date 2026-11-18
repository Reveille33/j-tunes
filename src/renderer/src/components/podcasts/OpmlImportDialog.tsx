import { useEffect, useState } from 'react'
import { useUiStore } from '../../state/uiStore'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import type { OpmlImportProgress, OpmlImportSummary } from '@shared/types'

interface OpmlImportDialogProps {
  onClose: () => void
  /** Called once an import finishes so the caller can refresh its data. */
  onImported: () => void
}

/**
 * Imports subscriptions from an OPML file, showing live progress.
 *
 * The import runs in the main process, so closing this dialog does not stop it;
 * the summary arrives when the await resolves.
 */
export function OpmlImportDialog({
  onClose,
  onImported
}: OpmlImportDialogProps): React.JSX.Element {
  const showToast = useUiStore((s) => s.showToast)
  const [progress, setProgress] = useState<OpmlImportProgress | null>(null)
  const [summary, setSummary] = useState<OpmlImportSummary | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEscapeKey(onClose, !running)

  useEffect(() => {
    return window.api.onOpmlProgress(setProgress)
  }, [])

  const start = async () => {
    setRunning(true)
    setError(null)
    setSummary(null)
    setProgress(null)
    try {
      const result = await window.api.importOpml()
      if (result) {
        setSummary(result)
        onImported()
        showToast(
          `Imported ${result.added} subscription(s)` +
            (result.failed > 0 ? `, ${result.failed} could not be added` : ''),
          result.failed > 0 ? 'info' : 'success'
        )
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const percent =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="dialog-backdrop" onClick={running ? undefined : onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <h2>Import subscriptions</h2>
          {!running ? (
            <button className="icon-button" onClick={onClose} aria-label="Close">
              ×
            </button>
          ) : null}
        </div>

        <div className="dialog-body">
          <p className="dialog-text">
            Choose an OPML file exported from another podcast app. Every feed in it is
            subscribed to; feeds you already have are skipped.
          </p>

          {error ? <div className="dialog-error">{error}</div> : null}

          {progress ? (
            <div className="import-progress">
              <div className="import-progress-bar">
                <div className="import-progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="import-progress-stats">
                {progress.done} / {progress.total} feeds · {progress.added} added ·{' '}
                {progress.skipped} skipped · {progress.failed} failed
              </div>
              {progress.currentFeed ? (
                <div className="import-progress-file truncate">{progress.currentFeed}</div>
              ) : null}
            </div>
          ) : null}

          {summary ? (
            <p className="dialog-text">
              Finished: {summary.added} added, {summary.skipped} already subscribed,{' '}
              {summary.failed} failed.
            </p>
          ) : null}

          <div className="dialog-actions">
            {running ? (
              <button className="button" onClick={() => void window.api.cancelOpmlImport()}>
                Stop
              </button>
            ) : (
              <button className="button" onClick={onClose}>
                Close
              </button>
            )}
            <button
              className="button button-primary"
              onClick={() => void start()}
              disabled={running}
            >
              {running ? 'Importing…' : summary ? 'Import another file…' : 'Choose OPML file…'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}