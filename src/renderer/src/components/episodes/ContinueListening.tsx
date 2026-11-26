import { useEffect, useState } from 'react'
import { useEpisodeStore } from '../../state/episodeStore'
import { usePlayerStore } from '../../state/playerStore'
import { formatDuration } from '../../utils/format'
import { openEpisodePlaylistMenu } from '../../playlistActions'
import { useUiStore } from '../../state/uiStore'
import type { Episode } from '@shared/types'

interface ContinueListeningProps {
  onPlay: (episode: Episode) => void
}

/**
 * A horizontal strip of partially-played episodes.
 *
 * Refreshes when the loaded episode list changes and whenever playback stops,
 * which is exactly when a new position has been flushed to the database.
 */
export function ContinueListening({ onPlay }: ContinueListeningProps): React.JSX.Element | null {
  const [items, setItems] = useState<Episode[]>([])
  const episodesVersion = useEpisodeStore((s) => s.episodes.length)
  const playing = usePlayerStore((s) => s.playing)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const found = await window.api.listInProgress()
        if (!cancelled) setItems(found)
      } catch {
        // Non-critical: the strip simply stays hidden.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [episodesVersion, playing])

  if (items.length === 0) return null

  return (
    <section className="continue-listening" aria-label="Continue listening">
      <h2 className="continue-title">Continue Listening</h2>
      <div className="continue-items">
        {items.map((episode) => {
          const duration = episode.durationSecs ?? 0
          const percent =
            duration > 0 ? Math.min(100, Math.round((episode.playPosition / duration) * 100)) : 0
          const art = episode.artworkUrl ?? episode.podcastArtworkUrl
          return (
            <button
              key={episode.id}
              className="continue-card"
              onClick={() => onPlay(episode)}
              onContextMenu={(event) => {
                event.preventDefault()
                openEpisodePlaylistMenu(episode.id, useUiStore.getState().selectedEpisodeIds)
              }}
              title={episode.title}
            >
              {art ? (
                <img className="continue-art" src={art} alt="" />
              ) : (
                <div className="continue-art continue-art-placeholder">♪</div>
              )}
              <div className="continue-body">
                <span className="continue-episode-title truncate">{episode.title}</span>
                <span className="continue-podcast truncate">{episode.podcastTitle}</span>
                <span className="continue-progress">
                  <span className="continue-progress-fill" style={{ width: `${percent}%` }} />
                </span>
                <span className="continue-meta">
                  {percent}% · {formatDuration(episode.playPosition)} in
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}