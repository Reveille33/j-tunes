import { useEffect, useState } from 'react'
import { usePodcastStore } from '../../state/podcastStore'
import { useUiStore } from '../../state/uiStore'
import { formatDate } from '../../utils/format'
import { podcastDescriptionClamped } from '@shared/descriptionDisplay'
import { showFeedDownloads } from '@shared/podcastFeed'
import type { Podcast, PodcastFolder } from '@shared/types'

interface PodcastDetailProps {
  podcast: Podcast
  onCheckUpdates: (podcastId: number) => void
  onUnsubscribe: (podcastId: number) => void
  onChanged: () => void
}

/**
 * Header shown above the episode list when a single podcast is selected.
 *
 * Surfaces the artwork, description, source folders, and the actions that
 * belong on this page. Download all and auto-download stay hidden when the
 * show has no feed.
 */
export function PodcastDetail({
  podcast,
  onCheckUpdates,
  onUnsubscribe,
  onChanged
}: PodcastDetailProps): React.JSX.Element {
  const updatePodcast = usePodcastStore((s) => s.updatePodcast)
  const showToast = useUiStore((s) => s.showToast)
  const descriptionsFull = useUiStore((s) => s.descriptionsFull)
  const [busy, setBusy] = useState(false)
  const [queueingAll, setQueueingAll] = useState(false)
  const [folders, setFolders] = useState<PodcastFolder[] | null>(null)
  const [foldersBusy, setFoldersBusy] = useState(false)
  const hasFeed = showFeedDownloads(podcast.feedUrl)

  const loadFolders = async () => {
    try {
      setFolders(await window.api.listPodcastFolders(podcast.id))
    } catch (error) {
      showToast((error as Error).message, 'error')
    }
  }

  useEffect(() => {
    let cancelled = false
    setFolders(null)
    void window.api
      .listPodcastFolders(podcast.id)
      .then((rows) => {
        if (!cancelled) setFolders(rows)
      })
      .catch((error: Error) => {
        if (!cancelled) showToast(error.message, 'error')
      })
    return () => {
      cancelled = true
    }
  }, [podcast.id, showToast])

  const addFolder = async () => {
    setFoldersBusy(true)
    try {
      const picked = await window.api.pickFolder()
      for (const path of picked) {
        await window.api.addPodcastFolder(podcast.id, path)
      }
      if (picked.length > 0) await loadFolders()
    } catch (error) {
      showToast((error as Error).message, 'error')
      await loadFolders()
    } finally {
      setFoldersBusy(false)
    }
  }

  const removeFolder = async (folder: PodcastFolder) => {
    setFoldersBusy(true)
    try {
      await window.api.removePodcastFolder(folder.id)
      setFolders((current) => (current ?? []).filter((row) => row.id !== folder.id))
    } catch (error) {
      showToast((error as Error).message, 'error')
    } finally {
      setFoldersBusy(false)
    }
  }

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
          <p
            className={`podcast-detail-description${
              podcastDescriptionClamped(descriptionsFull) ? '' : ' is-full'
            }`}
          >
            {podcast.description}
          </p>
        ) : null}

        <div className="podcast-detail-actions">
          <button className="button" onClick={() => onCheckUpdates(podcast.id)}>
            Check for Updates
          </button>
          <button className="button" onClick={() => void markAllPlayed()} disabled={busy}>
            Mark all played
          </button>
          {hasFeed ? (
            <button
              className="button"
              onClick={() => void downloadAll()}
              disabled={queueingAll}
              title="Queue every episode of this podcast for download"
            >
              {queueingAll ? 'Queueing…' : 'Download all'}
            </button>
          ) : null}
          {hasFeed ? (
            <label className="podcast-toggle">
              <input
                type="checkbox"
                checked={podcast.autoDownload}
                onChange={() => void toggleAutoDownload()}
              />
              <span>Auto-download</span>
            </label>
          ) : null}
          <button className="button button-danger" onClick={() => onUnsubscribe(podcast.id)}>
            Unsubscribe
          </button>
        </div>

        <div className="podcast-folders">
          <div className="podcast-folders-head">
            <span>Folders</span>
            <button className="button" onClick={() => void addFolder()} disabled={foldersBusy}>
              Add folder
            </button>
          </div>
          {folders === null ? null : folders.length === 0 ? (
            <p className="podcast-folders-empty">No extra folders.</p>
          ) : (
            <ul className="podcast-folder-list">
              {folders.map((folder) => (
                <li key={folder.id} className="podcast-folder-row">
                  <span className="podcast-folder-path truncate" title={folder.path}>
                    {folder.path}
                  </span>
                  <button
                    className="button"
                    onClick={() => void removeFolder(folder)}
                    disabled={foldersBusy}
                    title="Stop watching this folder. Files stay on disk."
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}