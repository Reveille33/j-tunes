import { memo } from 'react'
import { useUiStore } from '../../state/uiStore'
import { useEpisodeStore } from '../../state/episodeStore'
import { useQueueStore } from '../../state/queueStore'
import { formatDate, formatDuration } from '../../utils/format'
import type { DownloadState, Episode } from '@shared/types'

interface EpisodeRowProps {
  episode: Episode
  onPlay: (episode: Episode) => void
}

/**
 * A single row in the episode list.
 *
 * Descriptions are shown briefly by default and can be expanded per episode
 * by clicking them; a global toggle controls whether descriptions appear at
 * all.
 */
export const EpisodeRow = memo(function EpisodeRow({ episode, onPlay }: EpisodeRowProps) {
  const descriptionsVisible = useUiStore((s) => s.descriptionsVisible)
  const expanded = useUiStore((s) => s.expandedEpisodes.has(episode.id))
  const toggleEpisodeExpanded = useUiStore((s) => s.toggleEpisodeExpanded)
  const showToast = useUiStore((s) => s.showToast)
  const updateEpisode = useEpisodeStore((s) => s.updateEpisode)
  const selected = useUiStore((s) => s.selectedEpisodeIds.has(episode.id))
  const toggleSelected = useUiStore((s) => s.toggleEpisodeSelected)
  const addToQueue = useQueueStore((s) => s.add)

  const isDownloaded = episode.downloadState === 'done'
  const isExpanded = descriptionsVisible && expanded
  /** Per-episode art when the feed has one, otherwise the show's artwork. */
  const artworkUrl = episode.artworkUrl ?? episode.podcastArtworkUrl
  /** Streamable when it has a remote URL, even if it was never downloaded. */
  const playable = isDownloaded || Boolean(episode.mediaUrl)

  const handlePlay = () => {
    if (!playable) {
      showToast('This episode has no playable audio', 'info')
      return
    }
    onPlay(episode)
  }

  const handleTogglePlayed = async () => {
    const played = !episode.played
    updateEpisode({ ...episode, played })
    try {
      await window.api.setPlayed(episode.id, played)
    } catch {
      updateEpisode({ ...episode, played: !played })
    }
  }

  const handleDownload = async () => {
    const state = episode.downloadState
    try {
      if (state === 'done') {
        await window.api.deleteDownload(episode.id, 'trash')
        updateEpisode({
          ...episode,
          downloadState: 'none',
          filePath: null,
          fileSize: null
        })
        showToast('Download removed', 'success')
        return
      }
      if (state === 'downloading') {
        await window.api.pauseDownload(episode.id)
        updateEpisode({ ...episode, downloadState: 'paused' })
        return
      }
      if (state === 'paused') {
        await window.api.resumeDownload(episode.id)
        updateEpisode({ ...episode, downloadState: 'queued', downloadError: null })
        return
      }
      if (state === 'error') {
        await window.api.redownloadEpisode(episode.id)
        updateEpisode({ ...episode, downloadState: 'queued', downloadError: null, filePath: null, fileSize: null })
        return
      }
      if (state === 'queued') {
        await window.api.cancelDownload(episode.id)
        updateEpisode({ ...episode, downloadState: 'none', downloadError: null })
        return
      }
      await window.api.enqueueDownload(episode.id)
      updateEpisode({ ...episode, downloadState: 'queued', downloadError: null })
    } catch (error) {
      showToast((error as Error).message, 'error')
    }
  }

  const handleCancelDownload = async () => {
    try {
      await window.api.cancelDownload(episode.id)
      updateEpisode({ ...episode, downloadState: 'none', downloadError: null })
    } catch (error) {
      showToast((error as Error).message, 'error')
    }
  }

  const handleQueue = async () => {
    try {
      await addToQueue(episode.id)
      showToast('Added to Up Next', 'success')
    } catch (error) {
      showToast((error as Error).message, 'error')
    }
  }

  return (
    <div className={`episode-row${episode.played ? ' is-played' : ''}`}>
      <label className="episode-row-select" onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => toggleSelected(episode.id)}
          aria-label={selected ? 'Deselect episode' : 'Select episode'}
        />
      </label>

      <button
        className="episode-row-play"
        onClick={handlePlay}
        aria-label={`Play ${episode.title}`}
        title={isDownloaded ? 'Play' : 'Stream'}
      >
        {episode.played ? <span className="icon-play-done">✓</span> : <span className="icon-play" />}
      </button>

      {artworkUrl ? <img className="episode-row-art" src={artworkUrl} alt="" /> : null}

      <div className="episode-row-main">
        <div className="episode-row-title" title={episode.title}>
          {episode.title}
        </div>

        <div className="episode-row-meta">
          <span className="episode-row-podcast" title={episode.podcastTitle}>
            {episode.podcastTitle}
          </span>
          <span className="dot">·</span>
          <span>{formatDate(episode.releaseDate)}</span>
          {episode.durationSecs ? (
            <>
              <span className="dot">·</span>
              <span>{formatDuration(episode.durationSecs)}</span>
            </>
          ) : null}
          {episode.playPosition > 0 && isDownloaded ? (
            <>
              <span className="dot">·</span>
              <span className="episode-row-progress">
                {formatDuration(episode.playPosition)} played
              </span>
            </>
          ) : null}
        </div>

        {descriptionsVisible && episode.description ? (
          <div
            className={`episode-row-description${isExpanded ? ' is-expanded' : ''}`}
            onClick={(event) => {
              event.stopPropagation()
              toggleEpisodeExpanded(episode.id)
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                toggleEpisodeExpanded(episode.id)
              }
            }}
            title={isExpanded ? undefined : 'Click to expand'}
          >
            {isExpanded ? (
              <div className="episode-row-description-full">
                {episode.description}
              </div>
            ) : (
              <div className="description-brief">{episode.description}</div>
            )}
          </div>
        ) : null}
      </div>

      <div
        className={`episode-row-actions${
          episode.downloadState === 'queued' ||
          episode.downloadState === 'downloading' ||
          episode.downloadState === 'paused' ||
          episode.downloadState === 'error'
            ? ' is-visible'
            : ''
        }`}
      >
        <button
          className="icon-button"
          onClick={() => void handleQueue()}
          title="Add to Up Next"
          aria-label="Add to Up Next"
        >
          ＋
        </button>

        <button
          className="icon-button"
          onClick={handleTogglePlayed}
          title={episode.played ? 'Mark as unplayed' : 'Mark as played'}
          aria-label={episode.played ? 'Mark as unplayed' : 'Mark as played'}
          aria-pressed={episode.played}
        >
          {episode.played ? '●' : '○'}
        </button>

        <button
          className="icon-button"
          onClick={() => void handleDownload()}
          title={downloadButtonTitle(episode.downloadState, episode.downloadError)}
          aria-label={downloadButtonTitle(episode.downloadState, episode.downloadError)}
        >
          {downloadButtonIcon(episode.downloadState)}
        </button>
        {episode.downloadState === 'downloading' || episode.downloadState === 'paused' ? (
          <button
            className="icon-button"
            onClick={() => void handleCancelDownload()}
            title="Cancel download"
            aria-label="Cancel download"
          >
            ✕
          </button>
        ) : null}
      </div>
    </div>
  )
})

function downloadButtonTitle(state: DownloadState, error: string | null): string {
  switch (state) {
    case 'done':
      return 'Delete download'
    case 'downloading':
      return 'Pause download'
    case 'paused':
      return 'Resume download'
    case 'error':
      return error ? `Retry download: ${error}` : 'Retry download'
    case 'queued':
      return 'Cancel download'
    default:
      return 'Download'
  }
}

function downloadButtonIcon(state: DownloadState): string {
  switch (state) {
    case 'done':
      return '🗑'
    case 'downloading':
      return '⏸'
    case 'paused':
      return '⏵'
    case 'error':
      return '↻'
    case 'queued':
      return '✕'
    default:
      return '⬇'
  }
}
