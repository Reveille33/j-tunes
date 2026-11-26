import { app, Menu } from 'electron'
import type { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { aboutPanelOptions, applicationMenuTemplate } from './applicationMenu'

/**
 * Builds the application menu and points the native about panel at j-Tunes
 * plus `app.getVersion()`.
 *
 * The macOS app-menu About item calls the panel itself, so the options are
 * set here, not only from the Help item used on other platforms.
 */
export function buildApplicationMenu(
  getWindow: () => BrowserWindow | null
): Menu {
  const openSettings = (): void => {
    getWindow()?.webContents.send(IPC.APP_OPEN_SETTINGS)
  }

  const showAbout = (): void => {
    app.setAboutPanelOptions(aboutPanelOptions(app.getVersion()))
    app.showAboutPanel()
  }

  app.setAboutPanelOptions(aboutPanelOptions(app.getVersion()))

  return Menu.buildFromTemplate(
    applicationMenuTemplate({
      platform: process.platform,
      appName: app.name,
      openSettings,
      showAbout
    })
  )
}
