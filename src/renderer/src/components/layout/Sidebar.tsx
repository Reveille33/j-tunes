import { useUiStore } from '../../state/uiStore'
import { openEpisodePlaylistMenu } from '../../playlistActions'
import { usePodcastStore } from '../../state/podcastStore'
import { useQueueStore } from '../../state/queueStore'
import { usePlaylistStore } from '../../state/playlistStore'
import type { Episode } from '@shared/types'

interface SidebarProps {
  onUnsubscribe: (podcastId: number) => void
  onImport: () => void
  onAddPodcast: () => void
  onPlay: (episode: Episode) => void
}

/**
 * The left sidebar: podcast list, the "Up Next" queue and the library actions.
 */
export function Sidebar({
  onUnsubscribe,
  onImport,
  onAddPodcast,
  onPlay
}: SidebarProps): React.JSX.Element {
  const podcasts = usePodcastStore((s) => s.podcasts)
  const selectedPodcastId = useUiStore((s) => s.selectedPodcastId)
  const selectedPlaylistId = useUiStore((s) => s.selectedPlaylistId)
  const selectPodcast = useUiStore((s) => s.selectPodcast)
  const selectPlaylist = useUiStore((s) => s.selectPlaylist)
  const playlists = usePlaylistStore((s) => s.playlists)
  const searchTerm = useUiStore((s) => s.searchTerm)
  const setStatsOpen = useUiStore((s) => s.setStatsOpen)
  const setStorageOpen = useUiStore((s) => s.setStorageOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const setItunesImportOpen = useUiStore((s) => s.setItunesImportOpen)
  const queueItems = useQueueStore((s) => s.items)
  const removeFromQueue = useQueueStore((s) => s.remove)
  const moveInQueue = useQueueStore((s) => s.move)
  const clearQueue = useQueueStore((s) => s.clear)

  const term = searchTerm.trim().toLowerCase()
  const visible = term
    ? podcasts.filter(
        (p) =>
          p.title.toLowerCase().includes(term) || (p.author ?? '').toLowerCase().includes(term)
      )
    : podcasts

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <button
          className={`sidebar-item${
            selectedPodcastId === null && selectedPlaylistId === null ? ' is-active' : ''
          }`}
          onClick={() => selectPodcast(null)}
        >
          <span className="sidebar-item-label">All Episodes</span>
        </button>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>Subscribed</span>
          <button className="sidebar-add" onClick={onAddPodcast} title="Add a podcast">
            +
          </button>
        </div>

        {visible.length === 0 ? (
          <p className="sidebar-empty">
            {podcasts.length === 0
              ? 'No podcasts yet.'
              : 'No podcasts match your search.'}
          </p>
        ) : (
          <ul className="sidebar-list">
            {visible.map((podcast) => (
              <li key={podcast.id}>
                <div
                  className={`sidebar-item sidebar-podcast${
                    selectedPodcastId === podcast.id ? ' is-active' : ''
                  }`}
                >
                  <button
                    className="sidebar-item-main"
                    onClick={() => selectPodcast(podcast.id)}
                    title={podcast.title}
                  >
                    <span className="sidebar-item-label truncate">{podcast.title}</span>
                    <span className="sidebar-item-count">{podcast.episodeCount}</span>
                  </button>
                  <button
                    className="sidebar-unsubscribe"
                    onClick={() => onUnsubscribe(podcast.id)}
                    title={`Unsubscribe from ${podcast.title}`}
                    aria-label={`Unsubscribe from ${podcast.title}`}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span>Playlists</span>
        </div>
        {playlists.length === 0 ? (
          <p className="sidebar-empty">No playlists yet.</p>
        ) : (
          <ul className="sidebar-list">
            {playlists.map((playlist) => (
              <li key={playlist.id}>
                <button
                  className={`sidebar-item${selectedPlaylistId === playlist.id ? ' is-active' : ''}`}
                  onClick={() => selectPlaylist(playlist.id)}
                  title={playlist.name}
                >
                  <span className="sidebar-item-label truncate">{playlist.name}</span>
                  <span className="sidebar-item-count">{playlist.episodeCount}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {queueItems.length > 0 ? (
        <div className="sidebar-section">
          <div className="sidebar-section-header">
            <span>Up Next</span>
            <button
              className="sidebar-add"
              onClick={() => void clearQueue()}
              title="Clear Up Next"
              aria-label="Clear Up Next"
            >
              ×
            </button>
          </div>

          <ul className="sidebar-list">
            {queueItems.map((item, index) => (
              <li key={item.id}>
                <div
                  className="sidebar-item sidebar-podcast"
                  onContextMenu={(event) => {
                    event.preventDefault()
                    openEpisodePlaylistMenu(item.id, useUiStore.getState().selectedEpisodeIds)
                  }}
                >
                  <button
                    className="sidebar-item-main"
                    onClick={() => onPlay(item)}
                    title={item.title}
                  >
                    <span className="sidebar-item-label truncate">{item.title}</span>
                  </button>
                  <span className="queue-move">
                    <button
                      className="queue-move-button"
                      onClick={() => void moveInQueue(item.id, -1)}
                      disabled={index === 0}
                      title="Move up"
                      aria-label={`Move ${item.title} up`}
                    >
                      ↑
                    </button>
                    <button
                      className="queue-move-button"
                      onClick={() => void moveInQueue(item.id, 1)}
                      disabled={index === queueItems.length - 1}
                      title="Move down"
                      aria-label={`Move ${item.title} down`}
                    >
                      ↓
                    </button>
                  </span>
                  <button
                    className="sidebar-unsubscribe"
                    onClick={() => void removeFromQueue(item.id)}
                    title="Remove from Up Next"
                    aria-label="Remove from Up Next"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="sidebar-section sidebar-section-bottom">
        <button className="sidebar-item" onClick={onImport}>
          <span className="sidebar-item-label">Import Legacy Library…</span>
        </button>
        <button className="sidebar-item" onClick={() => setItunesImportOpen(true)}>
          <span className="sidebar-item-label">Import iTunes Library…</span>
        </button>
        <button className="sidebar-item" onClick={() => setStorageOpen(true)}>
          <span className="sidebar-item-label">Manage Downloads</span>
        </button>
        <button className="sidebar-item" onClick={() => setStatsOpen(true)}>
          <span className="sidebar-item-label">Listening Stats</span>
        </button>
        <button className="sidebar-item" onClick={() => setSettingsOpen(true)}>
          <span className="sidebar-item-label">Settings</span>
        </button>
      </div>
    </aside>
  )
}
