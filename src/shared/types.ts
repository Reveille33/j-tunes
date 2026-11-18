/**
 * Shared domain types for j-Tunes.
 * Imported by both the Electron main process and the React renderer.
 */

/** Download lifecycle for a single episode. */
export type DownloadState = 'none' | 'queued' | 'downloading' | 'paused' | 'done' | 'error'

/** What to do with files on disk when they are removed. */
export type FileAction = 'keep' | 'trash'

export type Theme = 'dark' | 'light'

export type SortBy = 'release_date' | 'title' | 'duration' | 'podcast' | 'relevance'

export type SortDirection = 'asc' | 'desc'

/** A subscribed podcast. */
export interface Podcast {
  id: number
  feedUrl: string
  title: string
  author: string | null
  description: string | null
  descriptionHtml: string | null
  artworkUrl: string | null
  category: string | null
  language: string | null
  link: string | null
  lastCheckedAt: number | null
  /** Set when the latest feed refresh failed. Cleared on the next success. */
  lastError: string | null
  lastEpisodeAt: number | null
  episodeCount: number
  subscribedAt: number
  autoDownload: boolean
  isActive: boolean
  sortOrder: number
}

/** An episode row as surfaced to the renderer. */
export interface Episode {
  id: number
  podcastId: number
  podcastTitle: string
  guid: string
  title: string
  description: string | null
  descriptionHtml: string | null
  mediaUrl: string | null
  mediaType: string | null
  durationSecs: number | null
  releaseDate: number | null
  episodeNumber: number | null
  seasonNumber: number | null
  artworkUrl: string | null
  /** The podcast's artwork, used when the episode has no image of its own. */
  podcastArtworkUrl: string | null
  filePath: string | null
  fileSize: number | null
  downloadState: DownloadState
  downloadError: string | null
  played: boolean
  playPosition: number
  isImported: boolean
}

export interface EpisodeQueryFilters {
  podcastId?: number | null
  /** Only episodes released within this calendar year (local time). */
  year?: number | null
  played?: boolean | null
  downloadState?: DownloadState | null
  /** Substring match against the episode description. */
  descriptionTerm?: string | null
  /** Free-text search across title, description and local filename. */
  text?: string | null
}

export interface EpisodeQuery {
  filters?: EpisodeQueryFilters
  sortBy?: SortBy
  direction?: SortDirection
  limit?: number
  offset?: number
}

export interface EpisodePage {
  rows: Episode[]
  total: number
  hasMore: boolean
}

/** A normalised feed, independent of RSS or Atom. */
export interface ParsedFeed {
  title: string
  author: string | null
  description: string | null
  descriptionHtml: string | null
  artworkUrl: string | null
  category: string | null
  language: string | null
  link: string | null
  episodes: ParsedEpisode[]
}

export interface ParsedEpisode {
  guid: string
  title: string
  description: string | null
  descriptionHtml: string | null
  mediaUrl: string | null
  mediaType: string | null
  mediaLength: number | null
  durationSecs: number | null
  releaseDate: number | null
  episodeNumber: number | null
  seasonNumber: number | null
  artworkUrl: string | null
  /** Link to a Podcast 2.0 chapters document, when the feed advertises one. */
  chaptersUrl?: string | null
}

/** A chapter marker inside an episode. */
export interface Chapter {
  id: number
  episodeId: number
  /** Offset from the start of the episode, in seconds. */
  startSecs: number
  title: string
}

/** Per-podcast listening totals for the stats view. */
export interface PodcastStat {
  podcastId: number
  title: string
  played: number
  total: number
  seconds: number
}

export interface LibraryStats {
  totalEpisodes: number
  playedEpisodes: number
  downloadedEpisodes: number
  downloadedBytes: number
  /** Approximate seconds of audio actually listened to. */
  totalListeningSeconds: number
  /** Number of distinct days with listening activity. */
  daysListened: number
  /** Consecutive days up to today with listening activity. */
  currentStreak: number
  byPodcast: PodcastStat[]
  /** Listening seconds for the last 14 days, oldest first. */
  recentDays: { day: string; seconds: number }[]
}

/** A bulk "mark played/unplayed" request. */
export interface BulkPlayedRequest {
  /** Restrict to one podcast, or the whole library when null/omitted. */
  podcastId?: number | null
  /** Explicit episode ids; takes precedence over podcastId when present. */
  episodeIds?: number[] | null
  played: boolean
  /** When true, only flip episodes that are not already in the target state. */
  onlyUnplayed?: boolean
}

/** A request to delete downloaded files. */
export interface DeleteDownloadsRequest {
  /** Explicit episode ids to delete. */
  episodeIds?: number[] | null
  /** Delete every download belonging to this podcast instead. */
  podcastId?: number | null
  fileAction: FileAction
}

/** Result of searching the built-in podcast directory. */
export interface FeedSearchResult {
  feedUrl: string
  title: string
  author: string | null
  artworkUrl: string | null
  category: string | null
  episodeCount: number | null
}

export interface DownloadQueueItem {
  episodeId: number
  podcastId: number
  episodeTitle: string
  podcastTitle: string
  state: DownloadState
  progress: number
  bytesDone: number
  totalBytes: number | null
  error: string | null
}

export interface UpdateProgress {
  podcastId: number
  podcastTitle: string
  done: number
  total: number
  found: number
  added: number
  status: 'checking' | 'done' | 'error'
  message?: string
}

export interface ImportProgress {
  jobId: number
  filesSeen: number
  filesMatched: number
  filesAdded: number
  filesSkipped: number
  currentFile: string | null
  status: 'running' | 'completed' | 'failed' | 'cancelled'
}

export interface ImportSummary {
  jobId: number
  filesSeen: number
  filesMatched: number
  filesAdded: number
  filesSkipped: number
}

/** Progress of an OPML subscription import. */
export interface OpmlImportProgress {
  done: number
  total: number
  added: number
  skipped: number
  failed: number
  currentFeed: string | null
}

export interface OpmlImportSummary {
  added: number
  skipped: number
  failed: number
}

/** A playable media source handed to the renderer. */
export interface MediaSource {
  url: string
  mime: string
  duration: number | null
  fileName: string
  /** True when the episode is streamed from its remote URL rather than disk. */
  streaming: boolean
}

/** Storage used by downloaded episodes, grouped by podcast. */
export interface PodcastStorage {
  podcastId: number
  title: string
  episodes: number
  bytes: number
}

export interface StorageSummary {
  totalEpisodes: number
  totalBytes: number
  byPodcast: PodcastStorage[]
}

export interface PlayerState {
  episodeId: number | null
  playing: boolean
  position: number
  duration: number
  rate: number
  volume: number
  buffered: number
}

export interface AppSettings {
  theme: Theme
  downloadDir: string
  autoDownloadDefault: boolean
  globalDescriptionsVisible: boolean
  lastPlaybackSpeed: number
  defaultVolume: number
  checkUpdatesOnStartup: boolean
  /** Show an OS notification when a sweep finds new episodes. */
  notifyOnNewEpisodes: boolean
}

export interface UnsubscribeChoice {
  podcastId: number
  fileAction: FileAction
}

export interface OperationResult {
  ok: boolean
  message?: string
  /** Number of files affected by a trash/keep operation. */
  fileCount?: number
}
