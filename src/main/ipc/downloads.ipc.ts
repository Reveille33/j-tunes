import { ipcMain, shell } from 'electron'
import { unlink } from 'node:fs/promises'
import { IPC } from '@shared/ipc'
import {
  episodeIdSchema,
  podcastIdSchema,
  deleteDownloadSchema,
  deleteDownloadsSchema
} from '@shared/validation'
import type { AppContext } from '../appContext'
import type { FileAction, OperationResult } from '@shared/types'

/**
 * Disposes of a detached file according to the user's choice.
 *
 * `trash` sends it to the OS recycle bin (recoverable) and falls back to a
 * permanent delete; `keep` leaves the file on disk and only removes the
 * download record.
 */
async function disposeFile(filePath: string | null, action: FileAction): Promise<boolean> {
  if (!filePath || action !== 'trash') return true
  try {
    await shell.trashItem(filePath)
    return true
  } catch {
    try {
      await unlink(filePath)
      return true
    } catch {
      return false
    }
  }
}

export function registerDownloadHandlers(ctx: AppContext): void {
  ipcMain.handle(IPC.DOWNLOADS_ENQUEUE, (_event, raw: unknown) => {
    const { episodeId } = episodeIdSchema.parse(raw)
    ctx.downloads.enqueue(episodeId)
  })

  ipcMain.handle(IPC.DOWNLOADS_ENQUEUE_PODCAST, (_event, raw: unknown) => {
    const { podcastId } = podcastIdSchema.parse(raw)
    ctx.downloads.enqueuePodcast(podcastId)
  })

  ipcMain.handle(IPC.DOWNLOADS_PAUSE, (_event, raw: unknown) => {
    const { episodeId } = episodeIdSchema.parse(raw)
    ctx.downloads.pause(episodeId)
  })

  ipcMain.handle(IPC.DOWNLOADS_RESUME, (_event, raw: unknown) => {
    const { episodeId } = episodeIdSchema.parse(raw)
    ctx.downloads.resume(episodeId)
  })

  /**
   * Deletes a downloaded file.
   *
   * `trash` moves the file to the OS recycle bin so it can be recovered;
   * `keep` removes the download record but leaves the file on disk.
   */
  ipcMain.handle(IPC.DOWNLOADS_DELETE, async (_event, raw: unknown): Promise<OperationResult> => {
    const { episodeId, fileAction } = deleteDownloadSchema.parse(raw)
    const filePath = ctx.downloads.clearDownload(episodeId)

    const disposed = await disposeFile(filePath, fileAction)
    if (!disposed) return { ok: false, message: 'The file could not be removed' }
    return { ok: true, fileCount: filePath ? 1 : 0 }
  })

  ipcMain.handle(IPC.DOWNLOADS_REDOWNLOAD, async (_event, raw: unknown) => {
    const { episodeId } = episodeIdSchema.parse(raw)
    await ctx.downloads.redownload(episodeId)
  })

  ipcMain.handle(IPC.DOWNLOADS_LIST, () => ctx.downloads.list())

  /** Downloaded episodes for the storage manager, largest first. */
  ipcMain.handle(IPC.DOWNLOADS_LIST_DONE, () => ctx.search.listDownloaded())

  /**
   * Deletes many downloads at once - either an explicit list of episode ids or
   * every download belonging to one podcast.
   */
  ipcMain.handle(
    IPC.DOWNLOADS_DELETE_MANY,
    async (_event, raw: unknown): Promise<OperationResult> => {
      const { episodeIds, podcastId, fileAction } = deleteDownloadsSchema.parse(raw)

      const ids =
        episodeIds && episodeIds.length > 0
          ? episodeIds
          : podcastId != null
            ? ctx.episodes.listDownloadedIdsForPodcast(podcastId)
            : []

      let removed = 0
      let failed = 0
      for (const id of ids) {
        const filePath = ctx.downloads.clearDownload(id)
        if (await disposeFile(filePath, fileAction)) removed += 1
        else failed += 1
      }

      return failed > 0
        ? {
            ok: false,
            message: `${removed} removed, ${failed} could not be deleted`,
            fileCount: removed
          }
        : { ok: true, fileCount: removed }
    }
  )
}
