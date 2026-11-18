import type { BrowserWindow } from 'electron'
import type { AppContext } from '../appContext'
import { registerPodcastHandlers } from './podcasts.ipc'
import { registerEpisodeHandlers } from './episodes.ipc'
import { registerDownloadHandlers } from './downloads.ipc'
import { registerUpdateHandlers } from './updates.ipc'
import { registerLibraryHandlers } from './library.ipc'
import { registerQueueHandlers } from './queue.ipc'
import { registerSettingsHandlers, registerWindowHandlers } from './settings.ipc'

/** Registers every IPC handler exactly once. */
export function registerIpcHandlers(ctx: AppContext, getWindow: () => BrowserWindow | null): void {
  registerPodcastHandlers(ctx)
  registerEpisodeHandlers(ctx)
  registerDownloadHandlers(ctx)
  registerUpdateHandlers(ctx)
  registerLibraryHandlers(ctx)
  registerQueueHandlers(ctx)
  registerSettingsHandlers(ctx)
  registerWindowHandlers(getWindow)
}
