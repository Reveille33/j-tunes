import { getDb, type Db } from './db/connection'
import { PodcastRepo } from './db/repositories/podcastRepo'
import { EpisodeRepo } from './db/repositories/episodeRepo'
import { SearchRepo } from './db/repositories/searchRepo'
import { SettingsRepo, DEFAULT_SETTINGS } from './db/repositories/settingsRepo'
import { ImportJobRepo } from './db/repositories/importJobRepo'
import { ChapterRepo } from './db/repositories/chapterRepo'
import { QueueRepo } from './db/repositories/queueRepo'
import { PlaylistRepo } from './db/repositories/playlistRepo'
import { PodcastFolderRepo } from './db/repositories/podcastFolderRepo'
import { StatsRepo } from './db/repositories/statsRepo'
import { UpdateService } from './services/updateService'
import { DownloadManager } from './services/downloadManager'
import { Importer } from './services/importer'
import { PlaybackService } from './services/playbackService'
import { autoDownloadEnabled } from './services/initialDownload'
import { scanPodcastFolders } from './services/folderScan'
import { OpmlImportService } from './services/opmlImportService'
import { defaultDownloadDir } from './util/paths'
import { IPC } from '@shared/ipc'
import type { AppSettings, DownloadQueueItem, UpdateProgress } from '@shared/types'

/**
 * The application context wires together the database, repositories and
 * services. It is created once at startup and shared by every IPC handler.
 */
export class AppContext {
  readonly db: Db
  readonly podcasts: PodcastRepo
  readonly episodes: EpisodeRepo
  readonly search: SearchRepo
  readonly settings: SettingsRepo
  readonly importJobs: ImportJobRepo
  readonly chapters: ChapterRepo
  readonly queue: QueueRepo
  readonly playlists: PlaylistRepo
  readonly folders: PodcastFolderRepo
  readonly stats: StatsRepo
  readonly playback: PlaybackService
  readonly opmlImporter: OpmlImportService
  readonly updates: UpdateService
  readonly downloads: DownloadManager
  readonly importer: Importer

  constructor(private readonly emitToRenderer: (channel: string, payload: unknown) => void) {
    this.db = getDb()
    this.podcasts = new PodcastRepo(this.db)
    this.episodes = new EpisodeRepo(this.db)
    this.search = new SearchRepo(this.db)
    this.settings = new SettingsRepo(this.db)
    this.importJobs = new ImportJobRepo(this.db)
    this.chapters = new ChapterRepo(this.db)
    this.queue = new QueueRepo(this.db)
    this.playlists = new PlaylistRepo(this.db)
    this.folders = new PodcastFolderRepo(this.db)
    this.stats = new StatsRepo(this.db)
    this.playback = new PlaybackService({
      queue: this.queue,
      episodes: this.episodes,
      search: this.search
    })

    this.opmlImporter = new OpmlImportService({
      podcasts: this.podcasts,
      episodes: this.episodes,
      onProgress: (progress) => this.emit('library:opmlProgress', progress),
      initialDownload: {
        autoDownloadDefault: () => this.getSettings().autoDownloadDefault,
        enqueue: (episodeId) => this.downloads.enqueue(episodeId)
      }
    })

    this.updates = new UpdateService({
      podcasts: this.podcasts,
      episodes: this.episodes,
      onProgress: (progress: UpdateProgress) => this.emit('updates:progress', progress),
      scanFolders: (podcastId) =>
        scanPodcastFolders(
          {
            episodes: this.episodes,
            folders: this.folders,
            podcasts: this.podcasts,
            onProgress: (progress) => this.emit(IPC.SCAN_PROGRESS, progress)
          },
          podcastId
        ),
      onNewEpisodes: (podcast, episodeIds) => {
        // Every episode that is new since the last check, when both flags are on.
        const settings = this.getSettings()
        if (!autoDownloadEnabled(settings.autoDownloadDefault, podcast.autoDownload)) return
        for (const id of episodeIds) {
          try {
            this.downloads.enqueue(id)
          } catch {
            // An episode without a media URL cannot be downloaded.
          }
        }
      }
    })

    this.downloads = new DownloadManager({
      episodes: this.episodes,
      podcasts: this.podcasts,
      getDownloadDir: () => this.getDownloadDir(),
      onProgress: (item: DownloadQueueItem) => this.emit('downloads:progress', item)
    })

    this.importer = new Importer({
      episodes: this.episodes,
      podcasts: this.podcasts,
      jobs: this.importJobs,
      onProgress: (progress) => this.emit('library:importProgress', progress)
    })
  }

  /** All settings, with the download directory resolved to a real path. */
  getSettings(): AppSettings {
    const settings = this.settings.getAll(DEFAULT_SETTINGS)
    if (!settings.downloadDir) {
      settings.downloadDir = defaultDownloadDir()
    }
    return settings
  }

  /** The directory downloads are written to. */
  getDownloadDir(): string {
    return this.getSettings().downloadDir || defaultDownloadDir()
  }

  /** Sends an event to the renderer. */
  emit(channel: string, payload: unknown): void {
    this.emitToRenderer(channel, payload)
  }
}
