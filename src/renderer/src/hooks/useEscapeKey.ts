import { useEffect } from 'react'

/**
 * Attaches a global keydown listener for the Escape key to close modal dialogs.
 */
export function useEscapeKey(onClose: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, enabled])
}
