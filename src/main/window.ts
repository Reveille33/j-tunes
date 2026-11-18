import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const currentDir = dirname(fileURLToPath(import.meta.url))

/**
 * Creates the main application window with the security hardening the
 * architecture requires: context isolation on, node integration off and
 * the sandbox enabled.
 */
export function createWindow(options: {
  preloadPath: string
  rendererUrl?: string
  rendererFile?: string
  theme: 'dark' | 'light'
  onMaximizeChange?: (maximized: boolean) => void
}): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: options.theme === 'dark' ? '#181a1f' : '#f5f6f8',
    title: 'j-Tunes',
    autoHideMenuBar: false,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  win.on('maximize', () => options.onMaximizeChange?.(true))
  win.on('unmaximize', () => options.onMaximizeChange?.(false))

  // External links open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const isDevServer = options.rendererUrl && url.startsWith(options.rendererUrl)
    if (!isDevServer) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })

  if (options.rendererUrl) {
    void win.loadURL(options.rendererUrl)
  } else if (options.rendererFile) {
    void win.loadFile(options.rendererFile)
  }

  return win
}

/** Resolves the preload script path in both dev and packaged builds. */
export function resolvePreloadPath(): string {
  return join(currentDir, '../preload/index.cjs')
}
