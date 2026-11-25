import { useEffect, useState } from 'react'
import { useUiStore } from '../../state/uiStore'
import { useEpisodeStore } from '../../state/episodeStore'
import { formatBytes, formatDate } from '../../utils/format'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { ConfirmDialog } from '../ConfirmDialog'
import { openEpisodePlaylistMenu } from '../../playlistActions'
import type { Episode, PodcastStorage, StorageSummary } from '@shared/types'

interface StorageDialogProps {
  onClose: () => void
}

/** What the user is about to delete, pending confirmation. */
type PendingDelete =
  | { kind: 'selection'; ids: number[] }
  | { kind: 'podcast'; podcastId: number; title: string; episodes: number }

/** Clears the dangling resume point on the episode being removed. */
const DETACHED = { downloadState: 'none' as const, filePath: null, fileSize: null }

/**
 * Manages downloaded episodes: shows disk usage per podcast and lets the user
 * delete individual downloads, a selection, or an entire podcast's files.
 */
export function StorageDialog({ onClose }: StorageDialogProps): React.JSX.Element {
  const showToast = useUiStore((s) => s.showToast)
  const [summary, setSummary] = useState<StorageSummary | null>(null)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingDelete | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEscapeKey(onClose, !pending)

  const load = async () => {
    try {
      const [storage, list] = await Promise.all([
        window.api.getStorageSummary(),
        window.api.listDownloaded()
      ])
      setSummary(storage)
      setEpisodes(list)
      setSelected(new Set())
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const maxBytes =
    summary && summary.byPodcast.length > 0
      ? Math.max(1, ...summary.byPodcast.map((p) => p.bytes))
      : 1

  const detach = (ids: number[]) => {
    const store = useEpisodeStore.getState()
    for (const id of ids) {
      const episode = store.episodes.find((e) => e.id === id)
      if (episode) store.updateEpisode({ ...episode, ...DETACHED })
    }
  }

  const detachPodcast = (podcastId: number) => {
    const store = useEpisodeStore.getState()
    for (const episode of store.episodes) {
      if (episode.podcastId === podcastId && episode.downloadState === 'done') {
        store.updateEpisode({ ...episode, ...DETACHED })
      }
    }
  }

  const requestRemoveSelected = () => {
    const ids = [...selected]
    if (ids.length > 0) setPending({ kind: 'selection', ids })
  }

  const requestRemovePodcast = (podcast: PodcastStorage) => {
    setPending({
      kind: 'podcast',
      podcastId: podcast.podcastId,
      title: podcast.title,
      episodes: podcast.episodes
    })
  }

  /** Runs the deletion the user confirmed. */
  const confirmDelete = async () => {
    if (!pending) return
    setBusy(true)
    try {
      if (pending.kind === 'selection') {
        const result = await window.api.deleteDownloads({
          episodeIds: pending.ids,
          fileAction: 'trash'
        })
        detach(pending.ids)
        if (!result.ok && result.message) showToast(result.message, 'error')
        else showToast(`Removed ${result.fileCount ?? pending.ids.length} download(s)`, 'success')
      } else {
        const result = await window.api.deleteDownloads({
          podcastId: pending.podcastId,
          fileAction: 'trash'
        })
        detachPodcast(pending.podcastId)
        if (!result.ok && result.message) showToast(result.message, 'error')
        else showToast(`Removed ${result.fileCount ?? 0} download(s)`, 'success')
      }
      setPending(null)
      await load()
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const visible = episodes.slice(0, 100)

  // Wording for the confirmation prompt, derived from what is pending.
  const confirmMessage = !pending
    ? ''
    : pending.kind === 'selection'
      ? `Move ${pending.ids.length} downloaded file(s) to the Recycle Bin?`
      : `Move all ${pending.episodes} downloaded file(s) from “${pending.title}” to the Recycle Bin?`

  const confirmLabel = !pending
    ? 'Delete'
    : pending.kind === 'selection'
      ? `Delete ${pending.ids.length} file(s)`
      : `Delete ${pending.episodes} file(s)`

  return (
    <>
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <h2>Manage downloads</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="dialog-body">
          {error ? <div className="dialog-error">{error}</div> : null}

          <div className="storage-total">
            <span className="storage-total-value">
              {summary ? formatBytes(summary.totalBytes) || '0 B' : '—'}
            </span>
            <span className="storage-total-label">
              {summary
                ? `${summary.totalEpisodes.toLocaleString()} downloaded episodes`
                : 'Loading…'}
            </span>
          </div>

          {summary && summary.byPodcast.length > 0 ? (
            <div className="storage-list">
              {summary.byPodcast.map((p) => (
                <div key={p.podcastId} className="storage-row">
                  <div className="storage-row-main">
                    <div className="storage-row-title truncate" title={p.title}>
                      {p.title}
                    </div>
                    <div className="storage-row-meta">
                      {p.episodes} episodes · {formatBytes(p.bytes)}
                    </div>
                    <div className="storage-bar">
                      <div
                        className="storage-bar-fill"
                        style={{ width: `${Math.round((p.bytes / maxBytes) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <button
                    className="button"
                    onClick={() => requestRemovePodcast(p)}
                    disabled={busy}
                  >
                    Delete files
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="dialog-divider">
            <span>Largest downloads</span>
          </div>

          <div className="storage-toolbar">
            <span className="bulk-count">{selected.size} selected</span>
            <button
              className="button"
              onClick={() => setSelected(new Set(visible.map((e) => e.id)))}
              disabled={busy}
            >
              Select all shown
            </button>
            <button
              className="button button-danger"
              onClick={requestRemoveSelected}
              disabled={busy || selected.size === 0}
            >
              Delete selected
            </button>
          </div>

          <div className="storage-downloads">
            {visible.map((episode) => (
              <label
                key={episode.id}
                className="storage-download"
                onContextMenu={(event) => {
                  event.preventDefault()
                  openEpisodePlaylistMenu(episode.id, selected)
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(episode.id)}
                  onChange={() => toggle(episode.id)}
                />
                <span className="storage-download-main">
                  <span className="storage-download-title truncate" title={episode.title}>
                    {episode.title}
                  </span>
                  <span className="storage-download-meta">
                    {episode.podcastTitle} · {formatDate(episode.releaseDate)}
                  </span>
                </span>
                <span className="storage-download-size">{formatBytes(episode.fileSize)}</span>
              </label>
            ))}
            {visible.length === 0 ? (
              <p className="dialog-hint">No downloaded episodes.</p>
            ) : null}
          </div>

          {episodes.length > visible.length ? (
            <p className="dialog-hint">
              Showing the {visible.length} largest of {episodes.length}.
            </p>
          ) : null}

          <div className="dialog-actions">
            <button className="button" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>

    {pending ? (
      <ConfirmDialog
        title="Delete downloads?"
        message={confirmMessage}
        confirmLabel={confirmLabel}
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPending(null)}
      />
    ) : null}
    </>
  )
}