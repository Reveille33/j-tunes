import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { settingsSetSchema, themeSchema } from '@shared/validation'
import type { AppContext } from '../appContext'
import type { AppSettings, Theme } from '@shared/types'

export function registerSettingsHandlers(ctx: AppContext): void {
  ipcMain.handle(IPC.SETTINGS_GET_ALL, () => ctx.getSettings())

  ipcMain.handle(IPC.SETTINGS_GET, (_event, key: string) => {
    const settings = ctx.getSettings()
    return settings[key as keyof AppSettings]
  })

  ipcMain.handle(IPC.SETTINGS_SET, (_event, raw: unknown) => {
    const { key, value } = settingsSetSchema.parse(raw)
    ctx.settings.set(key as keyof AppSettings, value as AppSettings[keyof AppSettings])

    // Keep the window's native theme in step with the in-app theme.
    if (key === 'theme') {
      const theme = value as Theme
      BrowserWindow.getAllWindows().forEach((win) => {
        win.setTitleBarOverlay?.({
          color: theme === 'dark' ? '#181a1f' : '#f5f6f8',
          symbolColor: theme === 'dark' ? '#e6e8ec' : '#1c1e22',
          height: 36
        })
      })
    }
  })

  ipcMain.handle(IPC.APP_SET_THEME, (_event, raw: unknown) => {
    const theme = themeSchema.parse(raw)
    ctx.settings.set('theme', theme)
  })
}

export function registerWindowHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.WINDOW_MINIMIZE, () => getWindow()?.minimize())
  ipcMain.handle(IPC.WINDOW_MAXIMIZE, () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle(IPC.WINDOW_CLOSE, () => getWindow()?.close())
  ipcMain.handle(IPC.WINDOW_IS_MAXIMIZED, () => getWindow()?.isMaximized() ?? false)
}
