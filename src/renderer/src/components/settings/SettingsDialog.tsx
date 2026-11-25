import { useEffect, useState } from 'react'
import { useUiStore } from '../../state/uiStore'
import { usePlayerStore } from '../../state/playerStore'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { PLAYBACK_SPEEDS } from '@shared/constants'
import type { AppSettings, Theme } from '@shared/types'

interface SettingsDialogProps {
  onClose: () => void
}

/**
 * Application settings: appearance, download location and playback defaults.
 *
 * Changes apply immediately (there is no Save button): each control writes
 * through to the database via `setSetting`, and the live stores are updated so
 * the UI reflects the change without a restart.
 */
export function SettingsDialog({ onClose }: SettingsDialogProps): React.JSX.Element {
  useEscapeKey(onClose)

  const showToast = useUiStore((s) => s.showToast)
  const setTheme = useUiStore((s) => s.setTheme)
  const setDescriptionsVisible = useUiStore((s) => s.setDescriptionsVisible)
  const setDescriptionsFull = useUiStore((s) => s.setDescriptionsFull)
  const setRate = usePlayerStore((s) => s.setRate)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const setOpmlImportOpen = useUiStore((s) => s.setOpmlImportOpen)
  const setSettingsDialogOpen = useUiStore((s) => s.setSettingsOpen)

  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [picking, setPicking] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load the current settings when the dialog opens.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const loaded = await window.api.getSettings()
        if (!cancelled) setSettings(loaded)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Persists a single setting and keeps the live UI in step with it. */
  const apply = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setError(null)
    try {
      await window.api.setSetting(key, value)
      setSettings((current) => (current ? { ...current, [key]: value } : current))

      // Mirror the preferences that have a visible effect right away.
      if (key === 'theme') setTheme(value as Theme)
      else if (key === 'globalDescriptionsVisible') setDescriptionsVisible(value as boolean)
      else if (key === 'showFullDescriptions') setDescriptionsFull(value as boolean)
      else if (key === 'lastPlaybackSpeed') setRate(value as number)
      else if (key === 'defaultVolume') setVolume(value as number)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  /** Switches from Settings to the OPML import dialog. */
  const openOpmlImport = (): void => {
    setSettingsDialogOpen(false)
    setOpmlImportOpen(true)
  }

  /** Asks the main process to write an OPML file of every subscription. */
  const exportOpml = async () => {
    setExporting(true)
    try {
      const result = await window.api.exportOpml()
      if (result.ok) {
        showToast(`Exported ${result.fileCount ?? 0} subscription(s)`, 'success')
      } else if (result.message !== 'Export cancelled') {
        showToast(result.message ?? 'Export failed', 'error')
      }
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setExporting(false)
    }
  }

  const chooseDownloadDir = async () => {
    setError(null)
    setPicking(true)
    try {
      const picked = await window.api.pickFolder()
      if (picked.length > 0) {
        await apply('downloadDir', picked[0])
        showToast(`Downloads will be saved to ${picked[0]}`, 'info')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <h2>Settings</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {settings ? (
          <div className="dialog-body">
            {error ? <div className="dialog-error">{error}</div> : null}

            <div className="dialog-section">
              <label className="dialog-label" htmlFor="setting-theme">
                Theme
              </label>
              <select
                id="setting-theme"
                className="dialog-input"
                value={settings.theme}
                onChange={(event) => void apply('theme', event.target.value as Theme)}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>

            <div className="dialog-divider">
              <span>Downloads</span>
            </div>

            <div className="dialog-section">
              <label className="dialog-label" htmlFor="setting-download-dir">
                Download location
              </label>
              <div className="dialog-row">
                <input
                  id="setting-download-dir"
                  className="dialog-input"
                  type="text"
                  readOnly
                  value={settings.downloadDir || '(default: app data folder)'}
                  title={settings.downloadDir || '(default: app data folder)'}
                  aria-label="Download location"
                />
                <button
                  className="button"
                  onClick={() => void chooseDownloadDir()}
                  disabled={picking}
                >
                  {picking ? 'Choosing…' : 'Choose…'}
                </button>
              </div>
              <p className="dialog-hint">
                New episode downloads are saved here. Leave it empty to use the default app data
                folder.
              </p>
            </div>

            <div className="dialog-section">
              <label className="dialog-checkbox">
                <input
                  type="checkbox"
                  checked={settings.autoDownloadDefault}
                  onChange={(event) => void apply('autoDownloadDefault', event.target.checked)}
                />
                Automatically download new episodes when a podcast is updated
              </label>
              <p className="dialog-hint">
                A new subscription, including an OPML import, downloads only the newest episode.
              </p>
            </div>

            <div className="dialog-section">
              <label className="dialog-checkbox">
                <input
                  type="checkbox"
                  checked={settings.checkUpdatesOnStartup}
                  onChange={(event) => void apply('checkUpdatesOnStartup', event.target.checked)}
                />
                Check for new episodes on startup
              </label>
            </div>

            <div className="dialog-section">
              <label className="dialog-checkbox">
                <input
                  type="checkbox"
                  checked={settings.notifyOnNewEpisodes}
                  onChange={(event) => void apply('notifyOnNewEpisodes', event.target.checked)}
                />
                Show a notification when new episodes arrive
              </label>
            </div>

            <div className="dialog-section">
              <label className="dialog-checkbox">
                <input
                  type="checkbox"
                  checked={settings.globalDescriptionsVisible}
                  onChange={(event) =>
                    void apply('globalDescriptionsVisible', event.target.checked)
                  }
                />
                Show descriptions in the episode list
              </label>
            </div>

            <div className="dialog-section">
              <label className="dialog-checkbox">
                <input
                  type="checkbox"
                  checked={settings.showFullDescriptions}
                  onChange={(event) => void apply('showFullDescriptions', event.target.checked)}
                />
                Show full descriptions
              </label>
              <p className="dialog-hint">
                Episode rows and the podcast header show the whole description instead of a
                shortened one.
              </p>
            </div>

            <div className="dialog-divider">
              <span>Subscriptions</span>
            </div>

            <div className="dialog-section">
              <div className="dialog-row">
                <button
                  className="button"
                  onClick={() => void exportOpml()}
                  disabled={exporting}
                >
                  {exporting ? 'Exporting…' : 'Export subscriptions (OPML)…'}
                </button>
                <button className="button" onClick={openOpmlImport}>
                  Import subscriptions (OPML)…
                </button>
              </div>
              <p className="dialog-hint">
                OPML is the standard file format for moving your subscription list between
                podcast apps.
              </p>
            </div>

            <div className="dialog-divider">
              <span>Playback</span>
            </div>

            <div className="dialog-section">
              <label className="dialog-label" htmlFor="setting-speed">
                Default playback speed
              </label>
              <select
                id="setting-speed"
                className="dialog-input"
                value={String(settings.lastPlaybackSpeed)}
                onChange={(event) => void apply('lastPlaybackSpeed', Number(event.target.value))}
              >
                {PLAYBACK_SPEEDS.map((speed) => (
                  <option key={speed} value={String(speed)}>
                    {speed}x
                  </option>
                ))}
              </select>
            </div>

            <div className="dialog-section">
              <label className="dialog-label" htmlFor="setting-volume">
                Default volume
              </label>
              <input
                id="setting-volume"
                className="settings-range"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={settings.defaultVolume}
                onChange={(event) => void apply('defaultVolume', Number(event.target.value))}
                aria-label="Default volume"
              />
              <p className="dialog-hint">{Math.round(settings.defaultVolume * 100)}%</p>
            </div>

            <div className="dialog-actions">
              <button className="button button-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="dialog-body">
            <p className="dialog-hint">Loading…</p>
          </div>
        )}
      </div>
    </div>
  )
}