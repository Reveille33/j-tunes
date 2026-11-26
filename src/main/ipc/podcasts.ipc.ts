import { ipcMain, dialog, shell } from 'electron'
import { join } from 'node:path'
import { realpath } from 'node:fs/promises'
import { IPC } from '@shared/ipc'
import {
  subscribeSchema,
  unsubscribeSchema,
  setAutoDownloadSchema,
  searchFeedSchema,
  podcastFoldersListSchema,
  podcastFolderAddSchema,
  podcastFolderRemoveSchema,
  addLocalPodcastSchema
} from '@shared/validation'
import { sanitiseFileName } from '../util/fsHelpers'
import { unsubscribeTrashPlan } from '../services/sourceFolders'
import { canonicaliseFeedUrl, fetchFeed } from '../services/feedService'
import { queueNewestSubscribedEpisode } from '../services/initialDownload'
import { subscribeToFeed } from '../services/subscriptionService'
import { searchFeeds } from '../services/feedSearchService'
import { addLocalPodcast } from '../services/localPodcast'
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

    // Download only the newest episode. The update path still queues every
    // episode that arrives later, using the same two flags.
    queueNewestSubscribedEpisode({
      podcast,
      autoDownloadDefault: ctx.getSettings().autoDownloadDefault,
      episodeIds: newEpisodeIds,
      episodes: ctx.episodes,
      enqueue: (id) => ctx.downloads.enqueue(id)
    })

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
    const sourceFolders = ctx.folders.list(podcastId).map((folder) => folder.path)
    const plan = unsubscribeTrashPlan({
      filePaths,
      sourceFolders,
      downloadFolder: join(ctx.getDownloadDir(), sanitiseFileName(podcast.title))
    })

    if (fileAction === 'trash') {
      const trashed = plan.trash.length > 0 ? await trashFiles(plan.trash) : 0
      // Never remove a source folder, or a download folder that contains one.
      if (plan.removeDownloadFolder) {
        await removeEmptyPodcastFolder(podcast.title, ctx.getDownloadDir())
      }
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

  ipcMain.handle(IPC.PODCAST_FOLDERS_LIST, (_event, raw: unknown) => {
    const { podcastId } = podcastFoldersListSchema.parse(raw)
    return ctx.folders.list(podcastId)
  })

  ipcMain.handle(IPC.PODCAST_FOLDERS_ADD, async (_event, raw: unknown) => {
    const { podcastId, path } = podcastFolderAddSchema.parse(raw)
    let stored = path
    try {
      stored = await realpath(path)
    } catch {
      stored = path
    }
    return ctx.folders.add(podcastId, stored)
  })

  ipcMain.handle(IPC.PODCAST_FOLDERS_REMOVE, (_event, raw: unknown) => {
    const { folderId } = podcastFolderRemoveSchema.parse(raw)
    ctx.folders.remove(folderId)
  })

  ipcMain.handle(IPC.PODCAST_ADD_LOCAL, async (_event, raw: unknown) => {
    const input = addLocalPodcastSchema.parse(raw)
    return addLocalPodcast(
      { podcasts: ctx.podcasts, folders: ctx.folders, episodes: ctx.episodes },
      input
    )
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
    const { readdir, rmdir } = await import('node:fs/promises')
    const dir = join(downloadDir, sanitiseFileName(podcastTitle))
    const entries = await readdir(dir)
    if (entries.length === 0) await rmdir(dir)
  } catch {
    // The folder may not exist or may still contain files - that is fine.
  }
}
