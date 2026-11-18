import { ipcMain, dialog, shell } from 'electron'
import { IPC } from '@shared/ipc'
import {
  subscribeSchema,
  unsubscribeSchema,
  setAutoDownloadSchema,
  searchFeedSchema
} from '@shared/validation'
import { canonicaliseFeedUrl, fetchFeed } from '../services/feedService'
import { subscribeToFeed } from '../services/subscriptionService'
import { searchFeeds } from '../services/feedSearchService'
import type { AppContext } from '../appContext'
import type { OperationResult } from '@shared/types'

/**
 * Moves files to the OS recycle bin where possible.
 *
 * `shell.trashItem` is used rather than an unlink so the user can recover
 * a deleted library. If it fails (for example on a network drive) the file
 * is deleted outright.
 */
async function trashFiles(paths: string[]): Promise<number> {
  let trashed = 0
  for (const path of paths) {
    try {
      await shell.trashItem(path)
      trashed += 1
    } catch {
      try {
        const { unlink } = await import('node:fs/promises')
        await unlink(path)
        trashed += 1
      } catch {
        // The file could not be removed; leave it in place.
      }
    }
  }
  return trashed
}

export function registerPodcastHandlers(ctx: AppContext): void {
  ipcMain.handle(IPC.PODCASTS_LIST, (_event, includeInactive?: boolean) =>
    ctx.podcasts.list(Boolean(includeInactive))
  )

  ipcMain.handle(IPC.PODCAST_SUBSCRIBE, async (_event, raw: unknown) => {
    const { feedUrl } = subscribeSchema.parse(raw)
    const { podcast, newEpisodeIds } = await subscribeToFeed(ctx, feedUrl)

    // Auto-download the back catalogue when auto-download is on.
    const settings = ctx.getSettings()
    if (settings.autoDownloadDefault) {
      for (const id of newEpisodeIds) {
        try {
          ctx.downloads.enqueue(id)
        } catch {
          // Skip episodes with no media URL.
        }
      }
    }

    return podcast
  })

  ipcMain.handle(IPC.PODCAST_PREVIEW_FEED, async (_event, raw: unknown) => {
    const { feedUrl } = subscribeSchema.parse(raw)
    const canonical = canonicaliseFeedUrl(feedUrl)
    const result = await fetchFeed(canonical)
    if (!result.feed) throw new Error('Feed returned no content')
    return {
      title: result.feed.title,
      author: result.feed.author,
      episodeCount: result.feed.episodes.length
    }
  })

  ipcMain.handle(IPC.PODCAST_UNSUBSCRIBE, async (_event, raw: unknown): Promise<OperationResult> => {
    const { podcastId, fileAction } = unsubscribeSchema.parse(raw)

    const podcast = ctx.podcasts.getById(podcastId)
    if (!podcast) throw new Error('Podcast not found')

    ctx.downloads.cancelPodcast(podcastId)
    const filePaths = ctx.podcasts.getDownloadedFilePaths(podcastId)

    if (fileAction === 'trash' && filePaths.length > 0) {
      const trashed = await trashFiles(filePaths)
      // Remove the now-empty podcast folder as well.
      await removeEmptyPodcastFolder(podcast.title, ctx.getDownloadDir())
      ctx.podcasts.remove(podcastId)
      return { ok: true, fileCount: trashed }
    }

    // "keep": the files stay on disk, only the database rows are removed.
    ctx.podcasts.remove(podcastId)
    return { ok: true, fileCount: filePaths.length }
  })

  ipcMain.handle(IPC.PODCAST_SET_AUTO_DOWNLOAD, (_event, raw: unknown) => {
    const { podcastId, autoDownload } = setAutoDownloadSchema.parse(raw)
    ctx.podcasts.setAutoDownload(podcastId, autoDownload)
  })

  ipcMain.handle(IPC.PODCAST_SEARCH_FEED, async (_event, raw: unknown) => {
    const { query, limit } = searchFeedSchema.parse(raw)
    return searchFeeds(query, limit)
  })

  ipcMain.handle(IPC.LIBRARY_PICK_FOLDER, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections']
    })
    return result.canceled ? [] : result.filePaths
  })
}

/** Removes a podcast's download folder when it no longer contains files. */
async function removeEmptyPodcastFolder(podcastTitle: string, downloadDir: string): Promise<void> {
  try {
    const { join } = await import('node:path')
    const { sanitiseFileName } = await import('../util/fsHelpers')
    const { readdir, rmdir } = await import('node:fs/promises')
    const dir = join(downloadDir, sanitiseFileName(podcastTitle))
    const entries = await readdir(dir)
    if (entries.length === 0) await rmdir(dir)
  } catch {
    // The folder may not exist or may still contain files - that is fine.
  }
}
