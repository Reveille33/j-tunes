import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '../../state/uiStore'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { scanProgressLabel } from '@shared/scanProgress'
import type { ItunesImportSummary, ItunesLibraryPreview } from '@shared/types'

interface ItunesImportDialogProps {
  onClose: () => void
  /** Called after a confirmed import so the library views can reload. */
  onImported: () => void
}

/**
 * Imports an iTunes Library.xml.
 *
 * Opening the dialog starts the native file picker. The main process checks
 * the file size, parses it, and returns a preview. Confirm runs the import;
 * Cancel closes without writing.
 */
export function ItunesImportDialog({
  onClose,
  onImported
}: ItunesImportDialogProps): React.JSX.Element | null {
  const showToast = useUiStore((s) => s.showToast)
  const [preview, setPreview] = useState<ItunesLibraryPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [scanLine, setScanLine] = useState<string | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEscapeKey(onClose, (preview !== null || error !== null) && !importing)

  useEffect(() => {
    return window.api.onScanProgress((progress) => {
      if (progress.kind !== 'itunes' || progress.phase === 'done') return
      setScanLine(scanProgressLabel(progress))
    })
  }, [])

  useEffect(() => {
    let active = true
    void window.api.previewItunesLibrary().then(
      (result) => {
        if (!active) return
        if (!result) {
          onCloseRef.current()
          return
        }
        setPreview(result)
      },
      (err: unknown) => {
        if (!active) return
        setError(messageOf(err))
      }
    )
    return () => {
      active = false
    }
  }, [])

  const confirm = async (): Promise<void> => {
    if (!preview || importing) return
    setImporting(true)
    setScanLine(null)
    setError(null)
    try {
      const result = await window.api.importItunesLibrary(preview.filePath)
      onImported()
      showToast(resultMessage(result), 'success')
      onClose()
    } catch (err) {
      setError(messageOf(err))
      setImporting(false)
    }
  }

  if (!preview && !error) return null

  return (
    <div className="dialog-backdrop" onClick={importing ? undefined : onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <h2>Import iTunes Library</h2>
          {!importing ? (
            <button className="icon-button" onClick={onClose} aria-label="Close">
              ×
            </button>
          ) : null}
        </div>

        <div className="dialog-body">
          {error ? <div className="dialog-error">{error}</div> : null}

          {preview ? (
            <>
              <p className="dialog-text">
                New shows come in as local-only. Feed URLs are counted and are not subscribed.
              </p>
              <ul className="dialog-summary">
                <li>
                  Shows: {preview.summary.showsCreated} new, {preview.summary.showsMatched} matched
                </li>
                <li>
                  Episodes: {preview.summary.episodesCreated} new,{' '}
                  {preview.summary.episodesMatched} matched
                </li>
                <li>Played: {preview.summary.played}</li>
                <li>Missing files: {preview.summary.missingFiles}</li>
                <li>
                  {preview.summary.feedUrlsSeen}{' '}
                  {preview.summary.feedUrlsSeen === 1 ? 'show had' : 'shows had'} a feed URL
                </li>
              </ul>
            </>
          ) : null}

          {importing ? (
            <p className="scan-progress">{scanLine ?? 'Importing…'}</p>
          ) : null}

          <div className="dialog-actions">
            <button className="button" onClick={onClose} disabled={importing}>
              {preview ? 'Cancel' : 'Close'}
            </button>
            {preview ? (
              <button
                className="button button-primary"
                onClick={() => void confirm()}
                disabled={importing}
              >
                {importing ? (scanLine ?? 'Importing…') : 'Import'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'That file could not be read as an iTunes library.'
}

function resultMessage(result: ItunesImportSummary): string {
  const shows = result.showsCreated === 1 ? '1 new show' : `${result.showsCreated} new shows`
  const episodes =
    result.episodesCreated === 1 ? '1 new episode' : `${result.episodesCreated} new episodes`
  return `Imported ${shows} and ${episodes}`
}
