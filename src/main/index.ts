import { app, BrowserWindow, Menu, protocol } from 'electron'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, statSync, createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { AUDIO_MIME_TYPES } from '@shared/constants'
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
      let filePath = url.searchParams.get('path')
      if (!filePath) {
        if (url.hostname && /^[a-zA-Z]$/.test(url.hostname)) {
          filePath = `${url.hostname.toUpperCase()}:${decodeURIComponent(url.pathname)}`
        } else {
          filePath = decodeURIComponent(url.pathname)
        }
      }

      if (!filePath || !existsSync(filePath)) {
        return new Response('Not found', { status: 404 })
      }

      const stat = statSync(filePath)
      if (!stat.isFile()) {
        return new Response('Not a file', { status: 404 })
      }

      const fileSize = stat.size
      const ext = extname(filePath).toLowerCase()
      const mimeType = AUDIO_MIME_TYPES[ext] || 'audio/mpeg'
      const range = request.headers.get('range')

      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range)
        if (match) {
          const start = parseInt(match[1], 10)
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1
          if (start < fileSize && end < fileSize && start <= end) {
            const chunkSize = end - start + 1
            const fileStream = createReadStream(filePath, { start, end })
            const webStream = Readable.toWeb(fileStream) as any

            return new Response(webStream, {
              status: 206,
              statusText: 'Partial Content',
              headers: {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': String(chunkSize),
                'Content-Type': mimeType
              }
            })
          }
        }
      }

      const fileStream = createReadStream(filePath)
      const webStream = Readable.toWeb(fileStream) as any
      return new Response(webStream, {
        status: 200,
        statusText: 'OK',
        headers: {
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
          'Content-Type': mimeType
        }
      })
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
