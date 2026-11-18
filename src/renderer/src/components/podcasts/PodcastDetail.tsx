import { useState } from 'react'
import { usePodcastStore } from '../../state/podcastStore'
import { useUiStore } from '../../state/uiStore'
import { formatDate } from '../../utils/format'
import type { Podcast } from '@shared/types'

interface PodcastDetailProps {
  podcast: Podcast
  onCheckUpdates: (podcastId: number) => void
  onUnsubscribe: (podcastId: number) => void
  onChanged: () => void
}

/**
 * Header shown above the episode list when a single podcast is selected.
 *
 * Surfaces the artwork, description and the per-podcast actions that only make
 * sense in this context: auto-download, mark-all-played and unsubscribe.
 */
export function PodcastDetail({
  podcast,
  onCheckUpdates,
  onUnsubscribe,
  onChanged
}: PodcastDetailProps): React.JSX.Element {
  const updatePodcast = usePodcastStore((s) => s.updatePodcast)
  const showToast = useUiStore((s) => s.showToast)
  const [busy, setBusy] = useState(false)
  const [queueingAll, setQueueingAll] = useState(false)

  const toggleAutoDownload = async () => {
    const next = !podcast.autoDownload
    updatePodcast({ ...podcast, autoDownload: next })
    try {
      await window.api.setAutoDownload(podcast.id, next)
    } catch (error) {
      updatePodcast(podcast)
      showToast((error as Error).message, 'error')
    }
  }

  /** Queues every not-yet-downloaded episode of this podcast. */
  const downloadAll = async () => {
    setQueueingAll(true)
    try {
      await window.api.enqueuePodcastDownloads(podcast.id)
      showToast('Queued every undownloaded episode', 'success')
    } catch (error) {
      showToast((error as Error).message, 'error')
    } finally {
      setQueueingAll(false)
    }
  }

  const markAllPlayed = async () => {
    setBusy(true)
    try {
      await window.api.setPlayedMany({
        podcastId: podcast.id,
        played: true,
        onlyUnplayed: true
      })
      showToast('Marked all episodes as played', 'success')
      onChanged()
    } catch (error) {
      showToast((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="podcast-detail">
      {podcast.artworkUrl ? (
        <img className="podcast-art" src={podcast.artworkUrl} alt="" />
      ) : (
        <div className="podcast-art podcast-art-placeholder">♪</div>
      )}

      <div className="podcast-detail-body">
        <h2 className="podcast-detail-title">{podcast.title}</h2>

        <div className="podcast-detail-meta">
          {podcast.author ? <span>{podcast.author}</span> : null}
          <span className="dot">·</span>
          <span>{podcast.episodeCount} episodes</span>
          {podcast.lastCheckedAt ? (
            <>
              <span className="dot">·</span>
              <span>Checked {formatDate(podcast.lastCheckedAt)}</span>
            </>
          ) : null}
          {podcast.lastError ? (
            <>
              <span className="dot">·</span>
              <span title={podcast.lastError}>Last refresh failed</span>
            </>
          ) : null}
        </div>

        {podcast.description ? (
          <p className="podcast-detail-description">{podcast.description}</p>
        ) : null}

        <div className="podcast-detail-actions">
          <button className="button" onClick={() => onCheckUpdates(podcast.id)}>
            Check for Updates
          </button>
          <button className="button" onClick={() => void markAllPlayed()} disabled={busy}>
            Mark all played
          </button>
          <button
            className="button"
            onClick={() => void downloadAll()}
            disabled={queueingAll}
            title="Queue every episode of this podcast for download"
          >
            {queueingAll ? 'Queueing…' : 'Download all'}
          </button>
          <label className="podcast-toggle">
            <input
              type="checkbox"
              checked={podcast.autoDownload}
              onChange={() => void toggleAutoDownload()}
            />
            <span>Auto-download</span>
          </label>
          <button className="button button-danger" onClick={() => onUnsubscribe(podcast.id)}>
            Unsubscribe
          </button>
        </div>
      </div>
    </section>
  )
}