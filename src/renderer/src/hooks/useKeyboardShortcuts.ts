import { useEffect } from 'react'
import { SKIP_SECONDS } from '@shared/constants'

interface ShortcutHandlers {
  onTogglePlay: () => void
  onSkip: (seconds: number) => void
  onCycleRate?: (direction: -1 | 1) => void
}

/**
 * Global keyboard shortcuts.
 *
 * Space toggles playback, the arrow keys skip 30 seconds, and the comma and
 * period keys change the playback speed. Shortcuts are ignored while a text
 * field has focus.
 */
export function useKeyboardShortcuts({
  onTogglePlay,
  onSkip,
  onCycleRate
}: ShortcutHandlers): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

  if (event.ctrlKey || event.metaKey || event.altKey) return

      switch (event.key) {
        case ' ':
        case 'k':
          event.preventDefault()
          onTogglePlay()
          break
        case 'ArrowLeft':
          event.preventDefault()
          onSkip(-SKIP_SECONDS)
          break
        case 'ArrowRight':
          event.preventDefault()
          onSkip(SKIP_SECONDS)
          break
        case ',':
        case '<':
          event.preventDefault()
          onCycleRate?.(-1)
          break
        case '.':
        case '>':
          event.preventDefault()
          onCycleRate?.(1)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onTogglePlay, onSkip, onCycleRate])
}
