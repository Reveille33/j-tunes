import { ipcMain, dialog } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { IPC } from '@shared/ipc'
import { importSchema, savePositionSchema } from '@shared/validation'
import { listeningIncrement } from '../services/listeningStats'
import { buildOpml, exportableCount, parseOpml } from '../services/opml'
import type { AppContext } from '../appContext'
import type { OperationResult, OpmlImportSummary } from '@shared/types'

export function registerLibraryHandlers(ctx: AppContext): void {
  /**
   * Imports a legacy podcast library from disk.
   *
   * The import runs to completion before the call resolves so the renderer
   * receives a final summary it can display; progress is streamed live via
   * the `library:importProgress` event.
   */
  ipcMain.handle(IPC.LIBRARY_IMPORT, async (_event, raw: unknown) => {
    const { paths } = importSchema.parse(raw)
    const summary = await ctx.importer.run(paths)
    ctx.emit('library:importDone', summary)
    return summary
  })

  ipcMain.handle(IPC.LIBRARY_IMPORT_PROGRESS, () => {
    // Progress is delivered via the event channel; this invoke is a no-op
    // that lets the renderer await the current state.
  })

  /** Cancels an in-flight legacy-library import. */
  ipcMain.handle(IPC.LIBRARY_CANCEL_IMPORT, () => {
    ctx.importer.cancel()
  })

  /** Aggregated listening / library statistics. */
  ipcMain.handle(IPC.LIBRARY_STATS, () => ctx.stats.summary())

  /** Disk usage of downloaded episodes, grouped by podcast. */
  ipcMain.handle(IPC.LIBRARY_STORAGE, () => ctx.stats.storageSummary())

  /**
   * Exports the subscription list as OPML, the format every other podcast app
   * can import. Locally imported podcasts are skipped: they have no real feed
   * URL to write.
   */
  ipcMain.handle(IPC.LIBRARY_EXPORT_OPML, async (): Promise<OperationResult> => {
    const podcasts = ctx.podcasts.list(false)
    const count = exportableCount(podcasts)
    if (count === 0) {
      return { ok: false, message: 'There are no subscriptions to export' }
    }

    const result = await dialog.showSaveDialog({
      title: 'Export subscriptions',
      defaultPath: 'j-tunes-subscriptions.opml',
      filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }]
    })
    if (result.canceled || !result.filePath) {
      return { ok: false, message: 'Export cancelled' }
    }

    try {
      await writeFile(result.filePath, buildOpml(podcasts), 'utf8')
      return { ok: true, fileCount: count, message: result.filePath }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  })

  /**
   * Imports subscriptions from a user-chosen OPML file.
   *
   * The file is parsed first, so an empty or malformed document fails
   * immediately; each feed is then subscribed to with bounded concurrency and
   * progress streams over `library:opmlProgress`.
   */
  ipcMain.handle(IPC.LIBRARY_IMPORT_OPML, async (): Promise<OpmlImportSummary | null> => {
    const picked = await dialog.showOpenDialog({
      title: 'Import subscriptions',
      properties: ['openFile'],
      filters: [{ name: 'OPML', extensions: ['opml', 'xml'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return null

    const xml = await readFile(picked.filePaths[0], 'utf8')
    const feeds = parseOpml(xml)
    if (feeds.length === 0) {
      throw new Error('No subscriptions were found in that file')
    }

    return ctx.opmlImporter.import(feeds)
  })

  /** Asks the running OPML import to stop after the current feed. */
  ipcMain.handle(IPC.LIBRARY_CANCEL_OPML, () => {
    ctx.opmlImporter.cancel()
  })

  ipcMain.handle(IPC.PLAYER_SAVE_POSITION, (_event, raw: unknown) => {
    const { episodeId, position, duration } = savePositionSchema.parse(raw)

    // Accumulate real listening time: only forward movement counts, and a
    // large jump is treated as a seek rather than listening.
    const previous = ctx.episodes.getById(episodeId)
    const previousPosition = previous?.play_position ?? 0
    const increment = listeningIncrement(previousPosition, position, previous?.played === 1)
    ctx.episodes.setPlayPosition(episodeId, position, duration)
    if (increment > 0) ctx.stats.addListeningSeconds(increment)
  })
}
