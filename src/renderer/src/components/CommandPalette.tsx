import { useEffect, useMemo, useRef, useState } from 'react'
import { useUiStore } from '../state/uiStore'
import { usePodcastStore } from '../state/podcastStore'
import type { Episode } from '@shared/types'

interface CommandPaletteProps {
  onPlay: (episode: Episode) => void
  onClose: () => void
}

interface PaletteItem {
  key: string
  label: string
  hint: string
  run: () => void
}

/**
 * A searchable command palette (Ctrl/Cmd+K).
 *
 * Combines static actions, the user's podcasts and live episode search in one
 * list that is fully keyboard navigable.
 */
export function CommandPalette({ onPlay, onClose }: CommandPaletteProps): React.JSX.Element {
  const podcasts = usePodcastStore((s) => s.podcasts)
  const selectPodcast = useUiStore((s) => s.selectPodcast)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const setStatsOpen = useUiStore((s) => s.setStatsOpen)
  const setStorageOpen = useUiStore((s) => s.setStorageOpen)
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen)
  const setAddPodcastOpen = useUiStore((s) => s.setAddPodcastOpen)
  const setImportOpen = useUiStore((s) => s.setImportOpen)
  const setOpmlImportOpen = useUiStore((s) => s.setOpmlImportOpen)

  const [query, setQuery] = useState('')
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced episode search so typing does not fire a query per keystroke.
  useEffect(() => {
    const term = query.trim()
    if (!term) {
      setEpisodes([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const page = await window.api.queryEpisodes({ filters: { text: term }, limit: 6 })
        if (!cancelled) setEpisodes(page.rows)
      } catch {
        if (!cancelled) setEpisodes([])
      }
    }, 150)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  const items = useMemo<PaletteItem[]>(() => {
    const term = query.trim().toLowerCase()

    const actions: PaletteItem[] = [
      { key: 'add', label: 'Add a podcast', hint: 'Action', run: () => { onClose(); setAddPodcastOpen(true) } },
      { key: 'import', label: 'Import legacy library', hint: 'Action', run: () => { onClose(); setImportOpen(true) } },
      { key: 'opml', label: 'Import subscriptions (OPML)', hint: 'Action', run: () => { onClose(); setOpmlImportOpen(true) } },
      { key: 'settings', label: 'Open settings', hint: 'Action', run: () => { onClose(); setSettingsOpen(true) } },
      { key: 'storage', label: 'Manage downloads', hint: 'Action', run: () => { onClose(); setStorageOpen(true) } },
      { key: 'stats', label: 'Listening stats', hint: 'Action', run: () => { onClose(); setStatsOpen(true) } },
      { key: 'keys', label: 'Keyboard shortcuts', hint: 'Help', run: () => { onClose(); setShortcutsOpen(true) } }
    ].filter((item) => !term || item.label.toLowerCase().includes(term))

    const podcastItems: PaletteItem[] = podcasts
      .filter((podcast) => !term || podcast.title.toLowerCase().includes(term))
      .slice(0, 5)
      .map((podcast) => ({
        key: `podcast-${podcast.id}`,
        label: podcast.title,
        hint: 'Podcast',
        run: () => {
          onClose()
          selectPodcast(podcast.id)
        }
      }))

    const episodeItems: PaletteItem[] = episodes.slice(0, 6).map((episode) => ({
      key: `episode-${episode.id}`,
      label: episode.title,
      hint: episode.podcastTitle,
      run: () => {
        onClose()
        onPlay(episode)
      }
    }))

    return [...actions, ...podcastItems, ...episodeItems]
  }, [
    query,
    podcasts,
    episodes,
    onClose,
    onPlay,
    selectPodcast,
    setAddPodcastOpen,
    setImportOpen,
    setOpmlImportOpen,
    setSettingsOpen,
    setStatsOpen,
    setStorageOpen,
    setShortcutsOpen
  ])

  useEffect(() => {
    setActive(0)
  }, [query])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(items.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      items[active]?.run()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div className="dialog-backdrop palette-backdrop" onClick={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          className="palette-input"
          type="text"
          placeholder="Search podcasts and episodes, or run a command…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Command palette search"
        />

        <div className="palette-results">
          {items.length === 0 ? (
            <div className="palette-empty">No matches</div>
          ) : (
            items.map((item, index) => (
              <button
                key={item.key}
                className={`palette-item${index === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => item.run()}
              >
                <span className="palette-label truncate">{item.label}</span>
                <span className="palette-hint truncate">{item.hint}</span>
              </button>
            ))
          )}
        </div>

        <div className="palette-footer">↑ ↓ to navigate · Enter to select · Esc to close</div>
      </div>
    </div>
  )
}