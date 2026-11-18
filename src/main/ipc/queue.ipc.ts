import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { episodeIdSchema, queueAddManySchema, queueReorderSchema } from '@shared/validation'
import type { AppContext } from '../appContext'
import type { Episode } from '@shared/types'

export function registerQueueHandlers(ctx: AppContext): void {
  ipcMain.handle(IPC.QUEUE_LIST, (): Episode[] => ctx.search.listByIds(ctx.queue.ids()))

  ipcMain.handle(IPC.QUEUE_ADD, (_event, raw: unknown) => {
    const { episodeId } = episodeIdSchema.parse(raw)
    ctx.queue.add(episodeId)
  })

  ipcMain.handle(IPC.QUEUE_ADD_MANY, (_event, raw: unknown) => {
    const { episodeIds } = queueAddManySchema.parse(raw)
    ctx.queue.addMany(episodeIds)
  })

  ipcMain.handle(IPC.QUEUE_REMOVE, (_event, raw: unknown) => {
    const { episodeId } = episodeIdSchema.parse(raw)
    ctx.queue.remove(episodeId)
  })

  ipcMain.handle(IPC.QUEUE_CLEAR, () => ctx.queue.clear())

  ipcMain.handle(IPC.QUEUE_REORDER, (_event, raw: unknown) => {
    const { episodeIds } = queueReorderSchema.parse(raw)
    ctx.queue.reorder(episodeIds)
  })

  /**
   * Chooses the next episode to play when the current one ends.
   *
   * The "Up Next" queue wins; otherwise the next unplayed episode in the
   * library (newest-first) is returned so playback flows continuously.
   */
  ipcMain.handle(IPC.QUEUE_NEXT, (_event, raw: unknown): Episode | null => {
    const { episodeId } = episodeIdSchema.parse(raw)
    return ctx.playback.next(episodeId)
  })
}