import type { MenuItemConstructorOptions } from 'electron'
import { APP_NAME } from '@shared/constants'

/** Label for the Help menu item on Windows and Linux. */
export const ABOUT_MENU_LABEL = `About ${APP_NAME}`

/**
 * Name and version shown by the native about panel.
 * Callers pass `app.getVersion()`, which reads package.json.
 */
export function aboutPanelOptions(version: string): {
  applicationName: string
  applicationVersion: string
} {
  return {
    applicationName: APP_NAME,
    applicationVersion: version
  }
}

export interface ApplicationMenuActions {
  platform: NodeJS.Platform
  /** macOS app-menu title. Packaged builds use the product name. */
  appName: string
  openSettings: () => void
  showAbout: () => void
}

/**
 * Menu template.
 *
 * Settings asks the focused window's renderer to open the Settings dialog via
 * `app:open-settings`. It lives in the app menu on macOS and in File elsewhere.
 *
 * About uses the native about panel. On macOS it stays the standard app-menu
 * item (`role: 'about'`). Other platforms get a Help menu, so About is not
 * listed twice.
 */
export function applicationMenuTemplate(
  actions: ApplicationMenuActions
): MenuItemConstructorOptions[] {
  const { platform, appName, openSettings, showAbout } = actions
  const isMac = platform === 'darwin'

  return [
    ...(isMac
      ? ([
          {
            label: appName,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: openSettings
              },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: openSettings
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? ([{ type: 'separator' }, { role: 'front' }] satisfies MenuItemConstructorOptions[])
          : ([{ role: 'close' }] satisfies MenuItemConstructorOptions[]))
      ]
    },
    ...(isMac
      ? []
      : ([
          {
            label: 'Help',
            submenu: [{ label: ABOUT_MENU_LABEL, click: showAbout }]
          }
        ] satisfies MenuItemConstructorOptions[]))
  ]
}
