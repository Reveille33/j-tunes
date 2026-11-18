import { ipcMain } from 'electron'
import { basename, extname } from 'node:path'
import { IPC } from '@shared/ipc'
import { episodeQuerySchema, setPlayedSchema, episodeIdSchema, bulkPlayedSchema } from '@shared/validation'
import { AUDIO_MIME_TYPES } from '@shared/constants'
import { fetchChapters } from '../services/chapterService'
import { authorizeLocalFile, httpMediaUrl, mediaEpisodeUrl } from '../services/mediaAccess'
import type { AppContext } from '../appContext'
import type { Chapter, MediaSource } from '@shared/types'

export function registerEpisodeHandlers(ctx: AppContext): void {
  ipcMain.handle(IPC.EPISODES_QUERY, (_event, raw: unknown) => {
    const query = episodeQuerySchema.parse(raw)
    return ctx.search.query(query)
  })

  ipcMain.handle(IPC.EPISODES_SET_PLAYED, (_event, raw: unknown) => {
    const { episodeId, played } = setPlayedSchema.parse(raw)
    ctx.episodes.setPlayed(episodeId, played)
  })

  ipcMain.handle(IPC.EPISODES_YEARS, () => ctx.episodes.listYears())

  /** Episodes that were started but not finished, for Continue Listening. */
  ipcMain.handle(IPC.EPISODES_IN_PROGRESS, () => ctx.search.listInProgress(8))

  /** Marks many episodes played/unplayed, or a whole podcast in one call. */
  ipcMain.handle(IPC.EPISODES_SET_PLAYED_MANY, (_event, raw: unknown) => {
    const request = bulkPlayedSchema.parse(raw)
    if (request.episodeIds && request.episodeIds.length > 0) {
      ctx.episodes.setPlayedMany(request.episodeIds, request.played)
      return
    }
    if (request.podcastId != null) {
      ctx.episodes.setPlayedForPodcast(
        request.podcastId,
        request.played,
        Boolean(request.onlyUnplayed)
      )
    }
  })

  /**
   * Returns an episode's chapters, fetching and caching the feed's chapters
   * document on first use. Missing or malformed documents yield an empty list
   * rather than an error, so the player degrades gracefully.
   */
  ipcMain.handle(IPC.EPISODES_CHAPTERS, async (_event, raw: unknown): Promise<Chapter[]> => {
    const { episodeId } = episodeIdSchema.parse(raw)

    const cached = ctx.chapters.list(episodeId)
    if (cached.length > 0) return cached

    const url = ctx.episodes.getChaptersUrl(episodeId)
    if (!url) return []

    try {
      const fetched = await fetchChapters(url)
      if (fetched.length > 0) ctx.chapters.replaceForEpisode(episodeId, fetched)
      return ctx.chapters.list(episodeId)
    } catch {
      return []
    }
  })

  /**
   * Hands the renderer a playable URL for an episode.
   *
   * A local file is addressed as `media://episode/<id>`. The protocol handler
   * resolves that id to the stored path and refuses anything outside the
   * download directory, unless the episode is an imported file. Remote
   * playback is limited to http and https URLs.
   */
  ipcMain.handle(IPC.EPISODE_MEDIA_URL, async (_event, raw: unknown): Promise<MediaSource> => {
    const { episodeId } = episodeIdSchema.parse(raw)
    const episode = ctx.episodes.getById(episodeId)
    if (!episode) throw new Error('Episode not found')

    const duration = episode.duration_secs ?? episode.duration_known ?? null

    const local = await authorizeLocalFile({
      filePath: episode.file_path,
      downloadDir: ctx.getDownloadDir(),
      imported: episode.is_imported === 1
    })
    if (local.ok) {
      const extension = extname(local.path).toLowerCase()
      return {
        url: mediaEpisodeUrl(episode.id),
        mime: AUDIO_MIME_TYPES[extension] ?? 'audio/mpeg',
        duration,
        fileName: basename(local.path),
        streaming: false
      }
    }

    const remote = httpMediaUrl(episode.media_url)
    if (remote) {
      let fileName = 'episode'
      try {
        fileName = basename(new URL(remote).pathname) || 'episode'
      } catch {
        // Keep the generic name when the URL has no usable path.
      }
      const extension = extname(fileName).toLowerCase()
      return {
        url: remote,
        mime: AUDIO_MIME_TYPES[extension] ?? episode.media_type ?? 'audio/mpeg',
        duration,
        fileName,
        streaming: true
      }
    }

    throw new Error('This episode has no playable file or stream')
  })
}
