import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import { applyDocumentTheme, themeFromArgv } from '@shared/themeArg'
import type { ThemeDocument } from '@shared/themeArg'
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
  ItunesImportSummary,
  ItunesLibraryPreview,
  LibraryStats,
  MediaSource,
  OperationResult,
  OpmlImportProgress,
  OpmlImportSummary,
  PlaylistAddResult,
  ScanProgress,
  PlaylistDetail,
  PlaylistSummary,
  Podcast,
  PodcastFolder,
  StorageSummary,
  Theme,
  UpdateProgress
} from '@shared/types'
import type { PlaylistAddInput } from '@shared/validation'

const initialTheme = themeFromArgv(process.argv) ?? 'dark'
contextBridge.exposeInMainWorld('jTunesInitialTheme', initialTheme)

/**
 * Subscribes to a main-process event and returns an unsubscribe function.
 * The raw IpcRendererEvent is never exposed to the renderer.
 */
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api = {
  // Podcasts
  listPodcasts: (includeInactive = false): Promise<Podcast[]> =>
    ipcRenderer.invoke(IPC.PODCASTS_LIST, includeInactive),
  subscribe: (feedUrl: string): Promise<Podcast> =>
    ipcRenderer.invoke(IPC.PODCAST_SUBSCRIBE, { feedUrl }),
  previewFeed: (feedUrl: string): Promise<{ title: string; author: string | null; episodeCount: number }> =>
    ipcRenderer.invoke(IPC.PODCAST_PREVIEW_FEED, { feedUrl }),
  unsubscribe: (podcastId: number, fileAction: FileAction): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.PODCAST_UNSUBSCRIBE, { podcastId, fileAction }),
  setAutoDownload: (podcastId: number, autoDownload: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.PODCAST_SET_AUTO_DOWNLOAD, { podcastId, autoDownload }),
  searchFeed: (query: string, limit?: number): Promise<FeedSearchResult[]> =>
    ipcRenderer.invoke(IPC.PODCAST_SEARCH_FEED, { query, limit }),
  listPodcastFolders: (podcastId: number): Promise<PodcastFolder[]> =>
    ipcRenderer.invoke(IPC.PODCAST_FOLDERS_LIST, { podcastId }),
  addPodcastFolder: (podcastId: number, path: string): Promise<PodcastFolder> =>
    ipcRenderer.invoke(IPC.PODCAST_FOLDERS_ADD, { podcastId, path }),
  removePodcastFolder: (folderId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.PODCAST_FOLDERS_REMOVE, { folderId }),
  addLocalPodcast: (title: string, path: string): Promise<Podcast> =>
    ipcRenderer.invoke(IPC.PODCAST_ADD_LOCAL, { title, path }),

  // Episodes
  queryEpisodes: (query: EpisodeQuery): Promise<EpisodePage> =>
    ipcRenderer.invoke(IPC.EPISODES_QUERY, query),
  setPlayed: (episodeId: number, played: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.EPISODES_SET_PLAYED, { episodeId, played }),
  setPlayedMany: (request: BulkPlayedRequest): Promise<void> =>
    ipcRenderer.invoke(IPC.EPISODES_SET_PLAYED_MANY, request),
  getChapters: (episodeId: number): Promise<Chapter[]> =>
    ipcRenderer.invoke(IPC.EPISODES_CHAPTERS, { episodeId }),
  listYears: (podcastId?: number | null): Promise<number[]> =>
    ipcRenderer.invoke(IPC.EPISODES_YEARS, podcastId ?? null),
  listInProgress: (): Promise<Episode[]> => ipcRenderer.invoke(IPC.EPISODES_IN_PROGRESS),
  getMediaSource: (episodeId: number): Promise<MediaSource> =>
    ipcRenderer.invoke(IPC.EPISODE_MEDIA_URL, { episodeId }),

  // Play queue
  listQueue: (): Promise<Episode[]> => ipcRenderer.invoke(IPC.QUEUE_LIST),
  addToQueue: (episodeId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.QUEUE_ADD, { episodeId }),
  addManyToQueue: (episodeIds: number[]): Promise<void> =>
    ipcRenderer.invoke(IPC.QUEUE_ADD_MANY, { episodeIds }),
  removeFromQueue: (episodeId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.QUEUE_REMOVE, { episodeId }),
  clearQueue: (): Promise<void> => ipcRenderer.invoke(IPC.QUEUE_CLEAR),
  reorderQueue: (episodeIds: number[]): Promise<void> =>
    ipcRenderer.invoke(IPC.QUEUE_REORDER, { episodeIds }),
  autoAdvance: (episodeId: number): Promise<Episode | null> =>
    ipcRenderer.invoke(IPC.QUEUE_NEXT, { episodeId }),

  // Playlists
  listPlaylists: (): Promise<PlaylistSummary[]> => ipcRenderer.invoke(IPC.PLAYLISTS_LIST),
  getPlaylist: (playlistId: number): Promise<PlaylistDetail> =>
    ipcRenderer.invoke(IPC.PLAYLISTS_GET, { playlistId }),
  removeFromPlaylist: (playlistId: number, episodeId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.PLAYLISTS_REMOVE, { playlistId, episodeId }),
  addToPlaylist: (input: PlaylistAddInput): Promise<PlaylistAddResult> =>
    ipcRenderer.invoke(IPC.PLAYLISTS_ADD, input),
  showEpisodeMenu: (episodeIds: number[]): Promise<void> =>
    ipcRenderer.invoke(IPC.EPISODES_CONTEXT_MENU, { episodeIds }),
  onPlaylistAddExisting: (cb: (request: { playlistId: number; episodeIds: number[] }) => void) =>
    subscribe(IPC.PLAYLISTS_ADD_EXISTING, cb),
  onNewPlaylist: (cb: (request: { episodeIds: number[] }) => void) =>
    subscribe(IPC.PLAYLISTS_PROMPT_NEW, cb),

  // Updates
  checkForUpdates: (podcastId?: number): Promise<void> =>
    ipcRenderer.invoke(IPC.UPDATES_CHECK, podcastId ? { podcastId } : undefined),

  // Downloads
  enqueueDownload: (episodeId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.DOWNLOADS_ENQUEUE, { episodeId }),
  enqueuePodcastDownloads: (podcastId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.DOWNLOADS_ENQUEUE_PODCAST, { podcastId }),
  pauseDownload: (episodeId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.DOWNLOADS_PAUSE, { episodeId }),
  resumeDownload: (episodeId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.DOWNLOADS_RESUME, { episodeId }),
  cancelDownload: (episodeId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.DOWNLOADS_CANCEL, { episodeId }),
  deleteDownload: (episodeId: number, fileAction: FileAction): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.DOWNLOADS_DELETE, { episodeId, fileAction }),
  redownloadEpisode: (episodeId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.DOWNLOADS_REDOWNLOAD, { episodeId }),
  listDownloads: (): Promise<DownloadQueueItem[]> => ipcRenderer.invoke(IPC.DOWNLOADS_LIST),
  listDownloaded: (): Promise<Episode[]> => ipcRenderer.invoke(IPC.DOWNLOADS_LIST_DONE),
  deleteDownloads: (request: DeleteDownloadsRequest): Promise<OperationResult> =>
    ipcRenderer.invoke(IPC.DOWNLOADS_DELETE_MANY, request),

  // Library import
  pickFolder: (): Promise<string[]> => ipcRenderer.invoke(IPC.LIBRARY_PICK_FOLDER),
  importLibrary: (paths: string[]): Promise<ImportSummary> =>
    ipcRenderer.invoke(IPC.LIBRARY_IMPORT, { paths }),
  cancelImport: (): Promise<void> => ipcRenderer.invoke(IPC.LIBRARY_CANCEL_IMPORT),
  getStats: (): Promise<LibraryStats> => ipcRenderer.invoke(IPC.LIBRARY_STATS),
  getStorageSummary: (): Promise<StorageSummary> => ipcRenderer.invoke(IPC.LIBRARY_STORAGE),
  exportOpml: (): Promise<OperationResult> => ipcRenderer.invoke(IPC.LIBRARY_EXPORT_OPML),
  importOpml: (): Promise<OpmlImportSummary | null> =>
    ipcRenderer.invoke(IPC.LIBRARY_IMPORT_OPML),
  cancelOpmlImport: (): Promise<void> => ipcRenderer.invoke(IPC.LIBRARY_CANCEL_OPML),
  previewItunesLibrary: (): Promise<ItunesLibraryPreview | null> =>
    ipcRenderer.invoke(IPC.LIBRARY_ITUNES_PREVIEW),
  importItunesLibrary: (filePath: string): Promise<ItunesImportSummary> =>
    ipcRenderer.invoke(IPC.LIBRARY_ITUNES_IMPORT, { filePath }),

  // Player
  savePlaybackPosition: (episodeId: number, position: number, duration: number): Promise<void> =>
    ipcRenderer.invoke(IPC.PLAYER_SAVE_POSITION, { episodeId, position, duration }),

  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET_ALL),
  setSetting: async <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ): Promise<void> => {
    await ipcRenderer.invoke(IPC.SETTINGS_SET, { key, value })
  },
  setTheme: (theme: Theme): Promise<void> => ipcRenderer.invoke(IPC.APP_SET_THEME, theme),

  // Window controls
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
  toggleMaximize: (): Promise<void> => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE),
  closeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.WINDOW_CLOSE),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED),

  // Event subscriptions
  onUpdateProgress: (cb: (p: UpdateProgress) => void) => subscribe(IPC.UPDATES_PROGRESS, cb),
  onUpdatesCompleted: (cb: (p: { added: number; feeds: number; errors: number }) => void) =>
    subscribe(IPC.UPDATES_COMPLETED, cb),
  onDownloadProgress: (cb: (p: DownloadQueueItem) => void) =>
    subscribe(IPC.DOWNLOADS_PROGRESS, cb),
  onImportProgress: (cb: (p: ImportProgress) => void) =>
    subscribe(IPC.LIBRARY_IMPORT_PROGRESS, cb),
  onImportDone: (cb: (p: ImportSummary) => void) => subscribe(IPC.LIBRARY_IMPORT_DONE, cb),
  onOpmlProgress: (cb: (p: OpmlImportProgress) => void) =>
    subscribe(IPC.LIBRARY_OPML_PROGRESS, cb),
  onScanProgress: (cb: (p: ScanProgress) => void) => subscribe(IPC.SCAN_PROGRESS, cb),
  onSettingsOpen: (cb: () => void) => subscribe(IPC.APP_OPEN_SETTINGS, cb),
}

export type JTunesApi = typeof api

contextBridge.exposeInMainWorld('api', api)

// The preload project is typechecked without the DOM lib. Apply the theme
// only after the bridge exists, and only once the root element is there.
const page = globalThis as typeof globalThis & { document: ThemeDocument }
applyDocumentTheme(page.document, initialTheme)
