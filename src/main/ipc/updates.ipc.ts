import { ipcMain, Notification, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { podcastIdSchema } from '@shared/validation'
import type { AppContext } from '../appContext'
import type { UpdateOutcome } from '../services/updateService'

/** Shows an OS notification when a sweep found new episodes. */
export function notifyNewEpisodes(ctx: AppContext, outcome: UpdateOutcome): void {
  if (outcome.added <= 0) return
  if (!ctx.getSettings().notifyOnNewEpisodes) return
  if (!Notification.isSupported()) return

  // Do not interrupt a user who is already looking at the app.
  if (BrowserWindow.getAllWindows().some((win) => win.isFocused())) return

  const notification = new Notification({
    title: 'j-Tunes',
    body:
      outcome.added === 1
        ? '1 new episode is ready to listen'
        : `${outcome.added} new episodes are ready to listen`
  })
  notification.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  notification.show()
}

/**
 * Runs an update sweep, emits the `updates:completed` event to the renderer,
 * and notifies the user if new episodes were found.
 */
export async function runUpdateSweep(ctx: AppContext, podcastId?: number): Promise<UpdateOutcome> {
  const outcome = await ctx.updates.check(podcastId)
  ctx.emit('updates:completed', outcome)
  notifyNewEpisodes(ctx, outcome)
  return outcome
}

export function registerUpdateHandlers(ctx: AppContext): void {
  /**
   * Checks for new episodes.
   *
   * The check runs in the background so the renderer stays responsive; the
   * `updates:completed` event reports the final tally.
   */
  ipcMain.handle(IPC.UPDATES_CHECK, (_event, raw?: unknown) => {
    const podcastId = raw ? podcastIdSchema.parse(raw).podcastId : undefined
    void runUpdateSweep(ctx, podcastId).catch(() => undefined)
  })
}
