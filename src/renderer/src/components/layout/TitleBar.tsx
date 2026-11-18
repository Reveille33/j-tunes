import { useUiStore } from '../../state/uiStore'

interface TitleBarProps {
  onCheckUpdates: () => void
  checking: boolean
  updateStatus: string | null
  onOpenSettings: () => void
}

/**
 * The top bar: the search field, the manual update button and the theme
 * toggle.
 */
export function TitleBar({
  onCheckUpdates,
  checking,
  updateStatus,
  onOpenSettings
}: TitleBarProps): React.JSX.Element {
  const searchTerm = useUiStore((s) => s.searchTerm)
  const setSearchTerm = useUiStore((s) => s.setSearchTerm)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    void window.api.setTheme(next)
  }

  return (
    <header className="title-bar">
      <div className="title-bar-brand">
        <span className="brand-mark">♪</span>
        <span className="brand-name">j-Tunes</span>
      </div>

      <div className="title-bar-search">
        <input
          className="search-input"
          type="search"
          placeholder="Search titles, descriptions and file names…"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          aria-label="Search episodes"
        />
      </div>

      <div className="title-bar-actions">
        {updateStatus ? <span className="update-status">{updateStatus}</span> : null}

        <button
          className="button"
          onClick={onCheckUpdates}
          disabled={checking}
          title="Check all podcasts for new episodes"
        >
          {checking ? 'Checking…' : 'Check for Updates'}
        </button>

        <button
          className="icon-button theme-toggle"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>

        <button
          className="icon-button"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
        >
          ⚙
        </button>
      </div>
    </header>
  )
}
