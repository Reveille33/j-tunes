import { BrowserWindow, ipcMain, Menu } from 'electron'
import { IPC } from '@shared/ipc'
import { addToPlaylistMenu } from '@shared/playlistMenu'
import { episodeContextMenuSchema, playlistAddSchema } from '@shared/validation'
import type { AppContext } from '../appContext'
import { addEpisodesToPlaylist } from '../services/playlistAdd'

/** Electron treats a single ampersand as a mnemonic marker. */
function menuLabel(label: string): string {
  return label.replace(/&/g, '&&')
}

export function registerPlaylistHandlers(ctx: AppContext): void {
  ipcMain.handle(IPC.PLAYLISTS_ADD, (_event, raw: unknown) => {
    const input = playlistAddSchema.parse(raw)
    return addEpisodesToPlaylist(ctx.playlists, input)
  })

  /**
   * Native context menu. Choosing a playlist asks the renderer to call
   * `playlists:add`, so that write stays on the one validated IPC path.
   */
  ipcMain.handle(IPC.EPISODES_CONTEXT_MENU, (event, raw: unknown) => {
    const { episodeIds } = episodeContextMenuSchema.parse(raw)
    const entries = addToPlaylistMenu(ctx.playlists.list())
    const playlists = entries.filter((entry) => entry.playlistId != null)
    const create = entries.find((entry) => entry.playlistId == null)

    const menu = Menu.buildFromTemplate([
      {
        label: 'Add to playlist',
        submenu: [
          ...playlists.map((entry) => ({
            label: menuLabel(entry.label),
            click: () => {
              event.sender.send(IPC.PLAYLISTS_ADD_EXISTING, {
                playlistId: entry.playlistId,
                episodeIds
              })
            }
          })),
          ...(playlists.length > 0 ? ([{ type: 'separator' as const }] ) : []),
          {
            label: create?.label ?? 'New playlist…',
            click: () => {
              event.sender.send(IPC.PLAYLISTS_PROMPT_NEW, { episodeIds })
            }
          }
        ]
      }
    ])

    const window = BrowserWindow.fromWebContents(event.sender)
    menu.popup({ window: window ?? undefined })
  })
}
