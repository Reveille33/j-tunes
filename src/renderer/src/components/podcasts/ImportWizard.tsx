import { useEffect, useState } from 'react'
import { useUiStore } from '../../state/uiStore'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import type { ImportProgress } from '@shared/types'

interface ImportWizardProps {
  onClose: () => void
  onImported?: () => void
}

/**
 * Imports a legacy on-disk podcast library.
 *
 * Files are matched against existing episodes where possible; anything
 * unmatched is added as a new episode so nothing in the library is lost.
 */
export function ImportWizard({ onClose, onImported }: ImportWizardProps): React.JSX.Element {
  const showToast = useUiStore((s) => s.showToast)

  const [paths, setPaths] = useState<string[]>([])
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [running, setRunning] = useState(false)

  useEscapeKey(onClose, !running)

  useEffect(() => {
    return window.api.onImportProgress(setProgress)
  }, [])

  const chooseFolder = async () => {
    try {
      const picked = await window.api.pickFolder()
      if (picked.length > 0) setPaths(picked)
    } catch (error) {
      showToast((error as Error).message, 'error')
    }
  }

  const startImport = async () => {
    if (paths.length === 0) return
    setRunning(true)
    try {
      const summary = await window.api.importLibrary(paths)
      showToast(
        `Import finished: ${summary.filesMatched} matched, ${summary.filesAdded} added, ${summary.filesSkipped} skipped.`,
        'success'
      )
      onImported?.()
      onClose()
    } catch (error) {
      showToast((error as Error).message, 'error')
    } finally {
      setRunning(false)
    }
  }

  const percent =
    progress && progress.filesSeen > 0
      ? Math.round(
          ((progress.filesMatched + progress.filesAdded + progress.filesSkipped) /
            progress.filesSeen) *
            100
        )
      : 0

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <h2>Import legacy library</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="dialog-body">
          <p className="dialog-text">
            Choose the folder(s) containing your existing podcast files. MP3, M4A and WAV files
            are scanned recursively.
          </p>

          <div className="dialog-row">
            <button className="button" onClick={() => void chooseFolder()} disabled={running}>
              Choose folder…
            </button>
            {paths.length > 0 ? (
              <span className="dialog-hint truncate">
                {paths.length === 1 ? paths[0] : `${paths.length} folders selected`}
              </span>
            ) : null}
          </div>

          {progress ? (
            <div className="import-progress">
              <div className="import-progress-bar">
                <div className="import-progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="import-progress-stats">
                {progress.filesSeen} files · {progress.filesMatched} matched ·{' '}
                {progress.filesAdded} added · {progress.filesSkipped} skipped
              </div>
              {progress.currentFile ? (
                <div className="import-progress-file truncate">{progress.currentFile}</div>
              ) : null}
            </div>
          ) : null}

          <div className="dialog-actions">
            <button
              className="button"
              onClick={() => {
                if (running) void window.api.cancelImport()
                else onClose()
              }}
            >
              {running ? 'Stop import' : 'Cancel'}
            </button>
            <button
              className="button button-primary"
              onClick={() => void startImport()}
              disabled={paths.length === 0 || running}
            >
              {running ? 'Importing…' : 'Start import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
