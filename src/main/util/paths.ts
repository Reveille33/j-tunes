import { app } from 'electron'
import { join } from 'node:path'

/** Root directory for the application database and other app state. */
export function userDataDir(): string {
  return app.getPath('userData')
}

/** Location of the SQLite database file. */
export function databasePath(): string {
  return join(userDataDir(), 'jtunes.db')
}

/**
 * The default directory for downloaded episodes.
 * Defaults to `<userData>/downloads` and is overridable in Settings.
 */
export function defaultDownloadDir(): string {
  return join(userDataDir(), 'downloads')
}
