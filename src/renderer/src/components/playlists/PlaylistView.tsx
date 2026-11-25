import { useEffect } from 'react'
import { EpisodeRow } from '../episodes/EpisodeRow'
import { usePlaylistStore } from '../../state/playlistStore'
import type { Episode } from '@shared/types'

interface PlaylistViewProps {
  playlistId: number
  onPlay: (episode: Episode) => void
  toolbar?: React.ReactNode
}

/**
 * One saved playlist: its episodes in saved order, with play and remove.
 */
export function PlaylistView({ playlistId, onPlay, toolbar }: PlaylistViewProps): React.JSX.Element {
  const playlists = usePlaylistStore((s) => s.playlists)
  const episodes = usePlaylistStore((s) => s.episodes)
  const openId = usePlaylistStore((s) => s.openId)
  const loading = usePlaylistStore((s) => s.loading)
  const loadEpisodes = usePlaylistStore((s) => s.loadEpisodes)
  const removeEpisode = usePlaylistStore((s) => s.removeEpisode)
  const playlist = playlists.find((item) => item.id === playlistId)
  const count = playlist?.episodeCount ?? episodes.length

  useEffect(() => {
    void loadEpisodes(playlistId)
  }, [loadEpisodes, playlistId])

  return (
    <>
      <header className="podcast-detail">
        <div className="podcast-detail-body">
          <h2 className="podcast-detail-title">{playlist?.name ?? 'Playlist'}</h2>
          <div className="podcast-detail-meta">
            <span>
              {count} {count === 1 ? 'episode' : 'episodes'}
            </span>
          </div>
        </div>
      </header>

      {toolbar}

      {loading || openId !== playlistId ? null : episodes.length === 0 ? (
        <div className="list-placeholder">
          <h3>Nothing in this playlist</h3>
          <p>Right-click an episode and choose Add to playlist.</p>
        </div>
      ) : (
        <div className="playlist-episodes" role="list">
          {episodes.map((episode) => (
            <div key={episode.id} role="listitem">
              <EpisodeRow
                episode={episode}
                onPlay={onPlay}
                onRemove={() => void removeEpisode(playlistId, episode.id)}
              />
            </div>
          ))}
        </div>
      )}
    </>
  )
}
