/** Application-wide constants shared by main and renderer. */

export const APP_NAME = 'j-Tunes'

/** Playback speeds offered in the player menu. */
export const PLAYBACK_SPEEDS = [1, 1.2, 1.5, 2] as const
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

/** Skip amount, in seconds, for the player's forward/back buttons. */
export const SKIP_SECONDS = 30

/** Sleep-timer presets, in minutes. */
export const SLEEP_TIMER_MINUTES = [15, 30, 45, 60] as const

/** Audio extensions the player and downloader accept. */
export const SUPPORTED_AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.wav'] as const

export const AUDIO_MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav'
}

/** How many episodes are fetched per IPC request. */
export const PAGE_SIZE = 200

/** Maximum rows the renderer will hold in memory at once. */
export const MAX_LOADED_EPISODES = 5000

/** Debounce, in ms, before a keystroke triggers a search. */
export const SEARCH_DEBOUNCE_MS = 120

/** How often the playback position is flushed to the database, in ms. */
export const POSITION_SAVE_INTERVAL_MS = 5000

/** Concurrent feed fetches during an update sweep. */
export const UPDATE_CONCURRENCY = 4

/** Concurrent downloads. */
export const DOWNLOAD_CONCURRENCY = 3

/** Per-feed request timeout, in ms. */
export const FEED_TIMEOUT_MS = 20_000

/** Largest feed document that will be parsed. Larger responses are aborted. */
export const MAX_FEED_BYTES = 10 * 1024 * 1024

/** Largest Podcast 2.0 chapters document that will be parsed. */
export const MAX_CHAPTER_BYTES = 2 * 1024 * 1024

/** Per-download request timeout, in ms. */
export const DOWNLOAD_TIMEOUT_MS = 30 * 60_000

/** Resume playback only if the stored position is beyond this many seconds. */
export const RESUME_MIN_SECONDS = 10

/** Treat playback as finished if within this many seconds of the end. */
export const RESUME_TAIL_SECONDS = 15

/** Minimum interval between download progress events, in ms. */
export const PROGRESS_THROTTLE_MS = 250

/** The built-in podcast directory search provider. */
export const FEED_SEARCH_ENDPOINT = 'https://itunes.apple.com/search'
export const FEED_LOOKUP_ENDPOINT = 'https://itunes.apple.com/lookup'

/**
 * Largest iTunes Library.xml the picker should open.
 * The parser refuses text above this size as well.
 */
export const ITUNES_LIBRARY_MAX_BYTES = 200 * 1024 * 1024
