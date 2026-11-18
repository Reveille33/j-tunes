import { app, BrowserWindow, Menu, protocol } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppContext } from './appContext'
import { registerIpcHandlers } from './ipc'
import { createWindow, resolvePreloadPath } from './window'
import { buildApplicationMenu } from './menu'
import { runUpdateSweep } from './ipc/updates.ipc'
import { authorizeLocalFile, parseMediaEpisodeId, serveLocalFile } from './services/mediaAccess'

// Screenshot runs point the app at a throwaway profile. Unset in normal use.
const userDataOverride = process.env.JTUNES_USER_DATA
if (userDataOverride) {
  app.setPath('userData', userDataOverride)
}

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
  protocol.handle('media', async (request) => {
    try {
      const episodeId = parseMediaEpisodeId(request.url)
      if (episodeId == null || !appContext) {
        return new Response('Not found', { status: 404 })
      }

      const episode = appContext.episodes.getById(episodeId)
      if (!episode) return new Response('Not found', { status: 404 })

      const decision = await authorizeLocalFile({
        filePath: episode.file_path,
        downloadDir: appContext.getDownloadDir(),
        imported: episode.is_imported === 1
      })
      if (!decision.ok) {
        const status = decision.status
        return new Response(status === 403 ? 'Forbidden' : 'Not found', { status })
      }

      return serveLocalFile(decision.path, request)
    } catch {
      return new Response('Internal error', { status: 500 })
    }
  })

  bootstrap()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) bootstrap()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
