import { app, BrowserWindow, Menu, protocol, net } from 'electron'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname } from 'node:path'
import { AppContext } from './appContext'
import { registerIpcHandlers } from './ipc'
import { createWindow, resolvePreloadPath } from './window'
import { buildApplicationMenu } from './menu'
import { runUpdateSweep } from './ipc/updates.ipc'

const currentDir = dirname(fileURLToPath(import.meta.url))

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      bypassCSP: true,
      stream: true,
      supportFetchAPI: true
    }
  }
])

let mainWindow: BrowserWindow | null = null
let appContext: AppContext | null = null

/** Only one instance of j-Tunes may run at a time. */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function bootstrap(): void {
  appContext = new AppContext((channel, payload) => {
    mainWindow?.webContents.send(channel, payload)
  })

  const settings = appContext.getSettings()

  mainWindow = createWindow({
    preloadPath: resolvePreloadPath(),
    rendererUrl: process.env['ELECTRON_RENDERER_URL'],
    rendererFile: join(currentDir, '../renderer/index.html'),
    theme: settings.theme
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  registerIpcHandlers(appContext, () => mainWindow)

  // The native File menu (and its Cmd/Ctrl+, accelerator) asks the renderer to
  // open the Settings dialog.
  Menu.setApplicationMenu(buildApplicationMenu(() => mainWindow))

  // Check for new episodes once the window is visible, so startup is not
  // blocked by a large library's worth of feed requests.
  mainWindow.once('ready-to-show', () => {
    if (!settings.checkUpdatesOnStartup) return
    setTimeout(() => {
      if (appContext) {
        void runUpdateSweep(appContext).catch(() => undefined)
      }
    }, 1500)
  })
}

app.whenReady().then(() => {
  protocol.handle('media', (request) => {
    try {
      const url = new URL(request.url)
      const paramPath = url.searchParams.get('path')
      if (paramPath) {
        return net.fetch(pathToFileURL(paramPath).href)
      }
      if (url.hostname && /^[a-zA-Z]$/.test(url.hostname)) {
        const fullPath = `${url.hostname.toUpperCase()}:${decodeURIComponent(url.pathname)}`
        return net.fetch(pathToFileURL(fullPath).href)
      }
      const directPath = decodeURIComponent(url.pathname)
      if (directPath) {
        return net.fetch(pathToFileURL(directPath).href)
      }
    } catch {
      // Fall through to 404
    }
    return new Response('Not found', { status: 404 })
  })

  bootstrap()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) bootstrap()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
