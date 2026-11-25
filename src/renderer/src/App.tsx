import { useCallback, useEffect, useRef, useState } from 'react'
import { TitleBar } from './components/layout/TitleBar'
import { Sidebar } from './components/layout/Sidebar'
import { FilterPanel } from './components/episodes/FilterPanel'
import { EpisodeList } from './components/episodes/EpisodeList'
import { BulkActionsBar } from './components/episodes/BulkActionsBar'
import { PlayerBar } from './components/player/PlayerBar'
import { AddPodcastDialog } from './components/podcasts/AddPodcastDialog'
import { UnsubscribeDialog } from './components/podcasts/UnsubscribeDialog'
import { ImportWizard } from './components/podcasts/ImportWizard'
import { PodcastDetail } from './components/podcasts/PodcastDetail'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { StatsDialog } from './components/stats/StatsDialog'
import { StorageDialog } from './components/storage/StorageDialog'
import { ContinueListening } from './components/episodes/ContinueListening'
import { OpmlImportDialog } from './components/podcasts/OpmlImportDialog'
import { CommandPalette } from './components/CommandPalette'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { NewPlaylistDialog } from './components/playlists/NewPlaylistDialog'
import { commitPlaylistAdd } from './playlistActions'
import { useUiStore } from './state/uiStore'
import { canPersistSetting } from '@shared/settingsPersist'
import { usePodcastStore } from './state/podcastStore'
import { useEpisodeStore } from './state/episodeStore'
import { usePlayerStore } from './state/playerStore'
import { useQueueStore } from './state/queueStore'
import { useEpisodes } from './hooks/useEpisodes'
import { usePlayer } from './hooks/usePlayer'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import type { Episode } from '@shared/types'

export function App(): React.JSX.Element {
  // The audio element is held in state so the player hook can attach its
  // event listeners once the element is mounted.
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null)

  const theme = useUiStore((s) => s.theme)
  const isAddPodcastOpen = useUiStore((s) => s.isAddPodcastOpen)
  const setAddPodcastOpen = useUiStore((s) => s.setAddPodcastOpen)
  const isImportOpen = useUiStore((s) => s.isImportOpen)
  const setImportOpen = useUiStore((s) => s.setImportOpen)
  const toast = useUiStore((s) => s.toast)
  const hideToast = useUiStore((s) => s.hideToast)
  const showToast = useUiStore((s) => s.showToast)

  const setPodcasts = usePodcastStore((s) => s.setPodcasts)
  const setYears = usePodcastStore((s) => s.setYears)

  const [unsubscribeId, setUnsubscribeId] = useState<number | null>(null)
  const [newPlaylistIds, setNewPlaylistIds] = useState<number[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const isSettingsOpen = useUiStore((s) => s.isSettingsOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const isStatsOpen = useUiStore((s) => s.isStatsOpen)
  const setStatsOpen = useUiStore((s) => s.setStatsOpen)
  const isStorageOpen = useUiStore((s) => s.isStorageOpen)
  const setStorageOpen = useUiStore((s) => s.setStorageOpen)
  const isOpmlImportOpen = useUiStore((s) => s.isOpmlImportOpen)
  const setOpmlImportOpen = useUiStore((s) => s.setOpmlImportOpen)
  const isPaletteOpen = useUiStore((s) => s.isPaletteOpen)
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen)
  const isShortcutsOpen = useUiStore((s) => s.isShortcutsOpen)
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen)
  const selectedEpisodeIds = useUiStore((s) => s.selectedEpisodeIds)
  const clearSelection = useUiStore((s) => s.clearSelection)
  const setSelection = useUiStore((s) => s.setSelection)
  const selectedPodcastId = useUiStore((s) => s.selectedPodcastId)
  const podcasts = usePodcastStore((s) => s.podcasts)
  const loadQueue = useQueueStore((s) => s.load)
  const addManyToQueue = useQueueStore((s) => s.addMany)

  const { refresh, loadMore } = useEpisodes()
  const settingsHydrated = useRef(false)

  // A ref lets the stable onEnded callback drive the player without a circular
  // dependency between the hook and the object it returns.
  const playerRef = useRef<ReturnType<typeof usePlayer> | null>(null)

  /** Marks the finished episode played, then continues playback. */
  const handleEnded = useCallback(
    async (episodeId: number) => {
      try {
        await window.api.setPlayed(episodeId, true)
        const finished = useEpisodeStore.getState().episodes.find((e) => e.id === episodeId)
        if (finished) {
          useEpisodeStore.getState().updateEpisode({ ...finished, played: true })
        }

        const next = await window.api.autoAdvance(episodeId)
        void loadQueue()
        if (next) await playerRef.current?.playEpisode(next)
      } catch {
        // End of the queue and nothing unplayed left to continue with.
      }
    },
    [loadQueue]
  )

  const player = usePlayer(audio, { onEnded: handleEnded })
  playerRef.current = player

  /** Reloads podcasts and years from the database. */
  const loadLibrary = useCallback(async () => {
    try {
      const [podcasts, years] = await Promise.all([
        window.api.listPodcasts(true),
        window.api.listYears()
      ])
      setPodcasts(podcasts)
      setYears(years)
    } catch (error) {
      showToast((error as Error).message, 'error')
    }
  }, [setPodcasts, setYears, showToast])

  // Load the library and apply the stored settings on startup.
  useEffect(() => {
    void (async () => {
      try {
        const settings = await window.api.getSettings()
        settingsHydrated.current = true
        useUiStore.setState({
          theme: settings.theme,
          descriptionsVisible: settings.globalDescriptionsVisible,
          descriptionsFull: settings.showFullDescriptions
        })
        usePlayerStore.getState().setRate(settings.lastPlaybackSpeed)
        usePlayerStore.getState().setVolume(settings.defaultVolume)
      } catch {
        // Fall back to the defaults already in the store.
      }
      await loadLibrary()
    })()
  }, [loadLibrary])

  // Apply the theme to the document so CSS variables switch instantly.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Persist the description visibility preference only after the saved
  // value has been loaded. Writing the default first would overwrite it.
  const descriptionsVisible = useUiStore((s) => s.descriptionsVisible)
  const descriptionsFull = useUiStore((s) => s.descriptionsFull)
  useEffect(() => {
    if (!canPersistSetting(settingsHydrated.current)) return
    void window.api.setSetting('globalDescriptionsVisible', descriptionsVisible)
  }, [descriptionsVisible])
  useEffect(() => {
    if (!canPersistSetting(settingsHydrated.current)) return
    void window.api.setSetting('showFullDescriptions', descriptionsFull)
  }, [descriptionsFull])

  // Auto-dismiss the toast.
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(hideToast, 4000)
    return () => clearTimeout(timer)
  }, [toast, hideToast])

  // Listen for download progress so the UI can reflect it.
  useEffect(() => {
    return window.api.onDownloadProgress((item) => {
      const episode = useEpisodeStore.getState().episodes.find((e) => e.id === item.episodeId)
      if (!episode) return
      useEpisodeStore.getState().updateEpisode({
        ...episode,
        downloadState: item.state,
        downloadError: item.error
      })
    })
  }, [])

  // The native File menu (and its accelerator) asks the renderer to open Settings.
  useEffect(() => {
    return window.api.onSettingsOpen(() => setSettingsOpen(true))
  }, [setSettingsOpen])

  // The episode context menu reports the playlist the user picked.
  useEffect(() => {
    return window.api.onPlaylistAddExisting((request) => {
      void commitPlaylistAdd({
        target: 'existing',
        playlistId: request.playlistId,
        episodeIds: request.episodeIds
      })
    })
  }, [])

  useEffect(() => {
    return window.api.onNewPlaylist((request) => setNewPlaylistIds(request.episodeIds))
  }, [])

  // Command palette (Ctrl/Cmd+K) and keyboard help (`?`).
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(!useUiStore.getState().isPaletteOpen)
        return
      }

      if (!typing && event.key === '?') {
        event.preventDefault()
        setShortcutsOpen(true)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setPaletteOpen, setShortcutsOpen])

  // Listen for update progress.
  useEffect(() => {
    return window.api.onUpdateProgress((progress) => {
      if (progress.status === 'checking') {
        setUpdateStatus(`Checking ${progress.podcastTitle}…`)
      }
    })
  }, [])

  useEffect(() => {
    return window.api.onUpdatesCompleted((result) => {
      setChecking(false)
      setUpdateStatus(null)
      showToast(
        `Checked ${result.feeds} podcast(s): ${result.added} new episode(s)` +
          (result.errors > 0 ? `, ${result.errors} error(s)` : ''),
        result.errors > 0 ? 'info' : 'success'
      )
      void loadLibrary()
      void refresh()
    })
  }, [loadLibrary, refresh, showToast])

  const handleCheckUpdates = useCallback(async () => {
    setChecking(true)
    setUpdateStatus('Starting…')
    try {
      await window.api.checkForUpdates()
    } catch (error) {
      setChecking(false)
      setUpdateStatus(null)
      showToast((error as Error).message, 'error')
    }
  }, [showToast])

  const handlePlay = useCallback(
    (episode: Episode) => {
      void player.playEpisode(episode)
    },
    [player]
  )

  const handleUnsubscribe = useCallback((podcastId: number) => {
    setUnsubscribeId(podcastId)
  }, [])

  // Load the persisted Up Next queue on startup.
  useEffect(() => {
    void loadQueue()
  }, [loadQueue])

  const handleBulkPlayed = useCallback(
    async (played: boolean) => {
      const ids = [...useUiStore.getState().selectedEpisodeIds]
      if (ids.length === 0) return
      setBulkBusy(true)
      try {
        await window.api.setPlayedMany({ episodeIds: ids, played })
        ids.forEach((id) => {
          const episode = useEpisodeStore.getState().episodes.find((e) => e.id === id)
          if (episode) useEpisodeStore.getState().updateEpisode({ ...episode, played })
        })
        showToast(`${ids.length} episode(s) marked ${played ? 'played' : 'unplayed'}`, 'success')
        clearSelection()
        void refresh()
      } catch (error) {
        showToast((error as Error).message, 'error')
      } finally {
        setBulkBusy(false)
      }
    },
    [clearSelection, refresh, showToast]
  )

  const handleBulkQueue = useCallback(async () => {
    const ids = [...useUiStore.getState().selectedEpisodeIds]
    if (ids.length === 0) return
    setBulkBusy(true)
    try {
      await addManyToQueue(ids)
      showToast(`${ids.length} episode(s) added to Up Next`, 'success')
      clearSelection()
    } catch (error) {
      showToast((error as Error).message, 'error')
    } finally {
      setBulkBusy(false)
    }
  }, [addManyToQueue, clearSelection, showToast])

  const handleSelectAll = useCallback(() => {
    setSelection(useEpisodeStore.getState().episodes.map((e) => e.id))
  }, [setSelection])

  const selectedPodcast = podcasts.find((p) => p.id === selectedPodcastId) ?? null

  useKeyboardShortcuts({
    onTogglePlay: player.togglePlay,
    onSkip: player.skip,
    onCycleRate: player.cycleRate
  })

  return (
    <div className="app-shell">
      <TitleBar
        onCheckUpdates={handleCheckUpdates}
        checking={checking}
        updateStatus={updateStatus}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="app-body">
        <Sidebar
          onUnsubscribe={handleUnsubscribe}
          onImport={() => setImportOpen(true)}
          onAddPodcast={() => setAddPodcastOpen(true)}
          onPlay={handlePlay}
        />

        <main className="app-main">
          {selectedPodcast ? (
            <PodcastDetail
              podcast={selectedPodcast}
              onCheckUpdates={(podcastId) => {
                setChecking(true)
                setUpdateStatus('Starting…')
                void window.api.checkForUpdates(podcastId)
              }}
              onUnsubscribe={handleUnsubscribe}
              onChanged={() => {
                void loadLibrary()
                void refresh()
              }}
            />
          ) : null}

          {selectedPodcastId === null ? <ContinueListening onPlay={handlePlay} /> : null}

          <FilterPanel />

          {selectedEpisodeIds.size > 0 ? (
            <BulkActionsBar
              count={selectedEpisodeIds.size}
              busy={bulkBusy}
              onMarkPlayed={() => void handleBulkPlayed(true)}
              onMarkUnplayed={() => void handleBulkPlayed(false)}
              onAddToQueue={() => void handleBulkQueue()}
              onSelectAll={handleSelectAll}
              onClear={clearSelection}
            />
          ) : null}

          <EpisodeList onPlay={handlePlay} onLoadMore={loadMore} />
        </main>
      </div>

      <PlayerBar
        onTogglePlay={player.togglePlay}
        onSkip={player.skip}
        onSeek={player.seek}
        onSetRate={player.setRate}
        onSetVolume={player.setVolume}
        onToggleMute={player.toggleMute}
      />

      <audio ref={setAudio} preload="metadata" />

      {isAddPodcastOpen ? (
        <AddPodcastDialog
          onClose={() => setAddPodcastOpen(false)}
          onSubscribed={() => {
            void loadLibrary()
            void refresh()
          }}
        />
      ) : null}
      {isImportOpen ? (
        <ImportWizard
          onClose={() => setImportOpen(false)}
          onImported={() => {
            void loadLibrary()
            void refresh()
          }}
        />
      ) : null}
      {isSettingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
      {isStatsOpen ? <StatsDialog onClose={() => setStatsOpen(false)} /> : null}
      {isStorageOpen ? <StorageDialog onClose={() => setStorageOpen(false)} /> : null}
      {isOpmlImportOpen ? (
        <OpmlImportDialog
          onClose={() => setOpmlImportOpen(false)}
          onImported={() => {
            void loadLibrary()
            void refresh()
          }}
        />
      ) : null}
      {isPaletteOpen ? (
        <CommandPalette onPlay={handlePlay} onClose={() => setPaletteOpen(false)} />
      ) : null}
      {isShortcutsOpen ? <ShortcutsDialog onClose={() => setShortcutsOpen(false)} /> : null}
      {unsubscribeId !== null ? (
        <UnsubscribeDialog podcastId={unsubscribeId} onClose={() => setUnsubscribeId(null)} />
      ) : null}
      {newPlaylistIds !== null ? (
        <NewPlaylistDialog episodeIds={newPlaylistIds} onClose={() => setNewPlaylistIds(null)} />
      ) : null}

      {toast ? (
        <div className={`toast toast-${toast.kind}`} onClick={hideToast}>
          {toast.message}
        </div>
      ) : null}
    </div>
  )
}
