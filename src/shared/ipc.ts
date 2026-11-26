/**
 * IPC channel names and the typed API surface exposed on `window.api`.
 * Single source of truth for main <-> renderer communication.
 */
import type {
  AppSettings,
  BulkPlayedRequest,
  Chapter,
  DeleteDownloadsRequest,
  DownloadQueueItem,
  Episode,
  EpisodePage,
  EpisodeQuery,
  FeedSearchResult,
  FileAction,
  ImportProgress,
  ImportSummary,
  LibraryStats,
  MediaSource,
  OperationResult,
  OpmlImportProgress,
  OpmlImportSummary,
  PlaylistAddResult,
  PlaylistDetail,
  PlaylistSummary,
  Podcast,
  PodcastFolder,
  StorageSummary,
  Theme,
  UpdateProgress
} from './types'
import type { PlaylistAddInput } from './validation'

export const IPC = {
  // Podcasts
  PODCASTS_LIST: 'podcasts:list',
  PODCAST_SUBSCRIBE: 'podcast:subscribe',
  PODCAST_UNSUBSCRIBE: 'podcast:unsubscribe',
  PODCAST_SET_AUTO_DOWNLOAD: 'podcast:setAutoDownload',
  PODCAST_SEARCH_FEED: 'podcast:searchFeed',
  PODCAST_PREVIEW_FEED: 'podcast:previewFeed',
  PODCAST_FOLDERS_LIST: 'podcast:folders:list',
  PODCAST_FOLDERS_ADD: 'podcast:folders:add',
  PODCAST_FOLDERS_REMOVE: 'podcast:folders:remove',

  // Episodes
  EPISODES_QUERY: 'episodes:query',
  EPISODES_SET_PLAYED: 'episodes:setPlayed',
  EPISODES_SET_PLAYED_MANY: 'episodes:setPlayedMany',
  EPISODES_CHAPTERS: 'episodes:chapters',
  EPISODES_YEARS: 'episodes:years',
  EPISODES_IN_PROGRESS: 'episodes:inProgress',
  EPISODE_MEDIA_URL: 'episode:mediaUrl',

  // Play queue ("Up Next")
  QUEUE_LIST: 'queue:list',
  QUEUE_ADD: 'queue:add',
  QUEUE_ADD_MANY: 'queue:addMany',
  QUEUE_REMOVE: 'queue:remove',
  QUEUE_CLEAR: 'queue:clear',
  QUEUE_REORDER: 'queue:reorder',
  QUEUE_NEXT: 'queue:next',

  // Playlists
  PLAYLISTS_LIST: 'playlists:list',
  PLAYLISTS_GET: 'playlists:get',
  PLAYLISTS_REMOVE: 'playlists:remove',
  PLAYLISTS_ADD: 'playlists:add',
  EPISODES_CONTEXT_MENU: 'episodes:contextMenu',
  PLAYLISTS_ADD_EXISTING: 'playlists:addExisting',
  PLAYLISTS_PROMPT_NEW: 'playlists:promptNew',

  // Updates
  UPDATES_CHECK: 'updates:check',
  UPDATES_PROGRESS: 'updates:progress',
  UPDATES_COMPLETED: 'updates:completed',

  // Downloads
  DOWNLOADS_ENQUEUE: 'downloads:enqueue',
  DOWNLOADS_ENQUEUE_PODCAST: 'downloads:enqueuePodcast',
  DOWNLOADS_PAUSE: 'downloads:pause',
  DOWNLOADS_RESUME: 'downloads:resume',
  DOWNLOADS_CANCEL: 'downloads:cancel',
  DOWNLOADS_DELETE: 'downloads:delete',
  DOWNLOADS_REDOWNLOAD: 'downloads:redownload',
  DOWNLOADS_LIST: 'downloads:list',
  DOWNLOADS_LIST_DONE: 'downloads:listDone',
  DOWNLOADS_DELETE_MANY: 'downloads:deleteMany',
  DOWNLOADS_PROGRESS: 'downloads:progress',

  // Library import
  LIBRARY_PICK_FOLDER: 'library:pickFolder',
  LIBRARY_IMPORT: 'library:import',
  LIBRARY_CANCEL_IMPORT: 'library:cancelImport',
  LIBRARY_IMPORT_PROGRESS: 'library:importProgress',
  LIBRARY_IMPORT_DONE: 'library:importDone',
  LIBRARY_STATS: 'library:stats',
  LIBRARY_STORAGE: 'library:storage',
  LIBRARY_EXPORT_OPML: 'library:exportOpml',
  LIBRARY_IMPORT_OPML: 'library:importOpml',
  LIBRARY_CANCEL_OPML: 'library:cancelOpmlImport',
  LIBRARY_OPML_PROGRESS: 'library:opmlProgress',

  // Player
  PLAYER_SAVE_POSITION: 'player:savePosition',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:getAll',
  APP_SET_THEME: 'app:setTheme',
  APP_OPEN_SETTINGS: 'app:open-settings',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:isMaximized'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** The complete API surface available to the renderer via `window.api`. */
export interface JTunesApi {
  // Podcasts
  listPodcasts(includeInactive?: boolean): Promise<Podcast[]>
  subscribe(feedUrl: string): Promise<Podcast>
  previewFeed(feedUrl: string): Promise<{ title: string; author: string | null; episodeCount: number }>
  unsubscribe(podcastId: number, fileAction: FileAction): Promise<OperationResult>
  setAutoDownload(podcastId: number, autoDownload: boolean): Promise<void>
  searchFeed(query: string, limit?: number): Promise<FeedSearchResult[]>
  listPodcastFolders(podcastId: number): Promise<PodcastFolder[]>
  addPodcastFolder(podcastId: number, path: string): Promise<PodcastFolder>
  removePodcastFolder(folderId: number): Promise<void>

  // Episodes
  queryEpisodes(query: EpisodeQuery): Promise<EpisodePage>
  setPlayed(episodeId: number, played: boolean): Promise<void>
  setPlayedMany(request: BulkPlayedRequest): Promise<void>
  getChapters(episodeId: number): Promise<Chapter[]>
  listYears(): Promise<number[]>
  /** Episodes that were started but not finished, newest activity first. */
  listInProgress(): Promise<Episode[]>
  getMediaSource(episodeId: number): Promise<MediaSource>

  // Play queue
  listQueue(): Promise<Episode[]>
  addToQueue(episodeId: number): Promise<void>
  addManyToQueue(episodeIds: number[]): Promise<void>
  removeFromQueue(episodeId: number): Promise<void>
  clearQueue(): Promise<void>
  reorderQueue(episodeIds: number[]): Promise<void>
  /** Next episode to play after the given one (queue first, then library). */
  autoAdvance(episodeId: number): Promise<Episode | null>

  // Playlists
  /** Saved playlists, oldest first. */
  listPlaylists(): Promise<PlaylistSummary[]>
  /** One playlist and its episodes, in saved order. */
  getPlaylist(playlistId: number): Promise<PlaylistDetail>
  /** Removes one episode from a playlist. */
  removeFromPlaylist(playlistId: number, episodeId: number): Promise<void>
  /** Adds episodes to a playlist. Episodes already in it are skipped. */
  addToPlaylist(input: PlaylistAddInput): Promise<PlaylistAddResult>
  /** Opens the native "Add to playlist" menu for these episodes. */
  showEpisodeMenu(episodeIds: number[]): Promise<void>
  /** The context menu chose an existing playlist. */
  onPlaylistAddExisting(
    cb: (request: { playlistId: number; episodeIds: number[] }) => void
  ): () => void
  /** The context menu chose "New playlist…". */
  onNewPlaylist(cb: (request: { episodeIds: number[] }) => void): () => void

  // Updates
  checkForUpdates(podcastId?: number): Promise<void>

  // Downloads
  enqueueDownload(episodeId: number): Promise<void>
  enqueuePodcastDownloads(podcastId: number): Promise<void>
  pauseDownload(episodeId: number): Promise<void>
  resumeDownload(episodeId: number): Promise<void>
  /** Stops an in-progress or paused download and drops the partial file. */
  cancelDownload(episodeId: number): Promise<void>
  deleteDownload(episodeId: number, fileAction: FileAction): Promise<OperationResult>
  redownloadEpisode(episodeId: number): Promise<void>
  listDownloads(): Promise<DownloadQueueItem[]>
  /** Downloaded episodes, largest first (storage management). */
  listDownloaded(): Promise<Episode[]>
  /** Deletes many downloads, or every download of one podcast. */
  deleteDownloads(request: DeleteDownloadsRequest): Promise<OperationResult>

  // Library import
  pickFolder(): Promise<string[]>
  importLibrary(paths: string[]): Promise<ImportSummary>
  cancelImport(): Promise<void>
  getStats(): Promise<LibraryStats>
  getStorageSummary(): Promise<StorageSummary>
  /** Writes the subscription list to an OPML file chosen by the user. */
  exportOpml(): Promise<OperationResult>
  /** Imports subscriptions from a user-chosen OPML file; null when cancelled. */
  importOpml(): Promise<OpmlImportSummary | null>
  cancelOpmlImport(): Promise<void>

  // Player
  savePlaybackPosition(episodeId: number, position: number, duration: number): Promise<void>

  // Settings
  getSettings(): Promise<AppSettings>
  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void>
  setTheme(theme: Theme): Promise<void>
  /** Raised by the main process when the user chooses Settings from the menu. */
  onSettingsOpen(cb: () => void): () => void

  // Window controls
  minimizeWindow(): Promise<void>
  toggleMaximize(): Promise<void>
  closeWindow(): Promise<void>
  isMaximized(): Promise<boolean>

  // Event subscriptions
  onUpdateProgress(cb: (p: UpdateProgress) => void): () => void
  onUpdatesCompleted(cb: (p: { added: number; feeds: number; errors: number }) => void): () => void
  onDownloadProgress(cb: (p: DownloadQueueItem) => void): () => void
  onImportProgress(cb: (p: ImportProgress) => void): () => void
  onImportDone(cb: (p: ImportSummary) => void): () => void
  onOpmlProgress(cb: (p: OpmlImportProgress) => void): () => void
}

declare global {
  interface Window {
    api: JTunesApi
  }
}

export type { Episode, EpisodePage, EpisodeQuery }
