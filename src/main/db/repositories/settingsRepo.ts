import type { Db } from '../connection'
import type { AppSettings, Theme } from '@shared/types'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  downloadDir: '',
  autoDownloadDefault: true,
  globalDescriptionsVisible: false,
  showFullDescriptions: false,
  lastPlaybackSpeed: 1,
  defaultVolume: 1,
  checkUpdatesOnStartup: true,
  notifyOnNewEpisodes: true
}

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  getRaw(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setRaw(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, Date.now())
  }

  /** Reads all settings, applying defaults for anything unset. */
  getAll(defaults: AppSettings = DEFAULT_SETTINGS): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as {
      key: string
      value: string
    }[]
    const map = new Map(rows.map((r) => [r.key, r.value]))

    const theme = map.get('theme')
    const dir = map.get('downloadDir')
    const descriptions = map.get('globalDescriptionsVisible')
    const fullDescriptions = map.get('showFullDescriptions')
    const speed = map.get('lastPlaybackSpeed')
    const volume = map.get('defaultVolume')
    const checkOnStart = map.get('checkUpdatesOnStartup')
    const autoDownload = map.get('autoDownloadDefault')
    const notify = map.get('notifyOnNewEpisodes')

    return {
      theme: theme === 'light' || theme === 'dark' ? (theme as Theme) : defaults.theme,
      downloadDir: dir ?? defaults.downloadDir,
      autoDownloadDefault:
        autoDownload === undefined ? defaults.autoDownloadDefault : autoDownload === 'true',
      globalDescriptionsVisible:
        descriptions === undefined
          ? defaults.globalDescriptionsVisible
          : descriptions === 'true',
      showFullDescriptions:
        fullDescriptions === undefined
          ? defaults.showFullDescriptions
          : fullDescriptions === 'true',
      lastPlaybackSpeed: speed ? Number(speed) : defaults.lastPlaybackSpeed,
      defaultVolume: volume ? Number(volume) : defaults.defaultVolume,
      checkUpdatesOnStartup:
        checkOnStart === undefined ? defaults.checkUpdatesOnStartup : checkOnStart === 'true',
      notifyOnNewEpisodes:
        notify === undefined ? defaults.notifyOnNewEpisodes : notify === 'true'
    }
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.setRaw(key as string, typeof value === 'boolean' ? String(value) : String(value))
  }
}
