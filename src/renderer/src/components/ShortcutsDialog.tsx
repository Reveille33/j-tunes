import { SKIP_SECONDS } from '@shared/constants'
import { useEscapeKey } from '../hooks/useEscapeKey'

interface ShortcutsDialogProps {
  onClose: () => void
}

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: 'Ctrl / ⌘ + K', description: 'Open the command palette' },
  { keys: '?', description: 'Show this help' },
  { keys: 'Space', description: 'Play or pause' },
  { keys: '← / →', description: `Skip back / forward ${SKIP_SECONDS} seconds` },
  { keys: ', / .', description: 'Decrease / increase playback speed' },
  { keys: '↑ / ↓', description: 'Move between episode rows' },
  { keys: 'Home / End', description: 'Jump to the first / last row' },
  { keys: 'Enter', description: 'Play the focused episode' },
  { keys: 'Esc', description: 'Close a dialog' }
]

/** Keyboard help, opened with `?`. */
export function ShortcutsDialog({ onClose }: ShortcutsDialogProps): React.JSX.Element {
  useEscapeKey(onClose)

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog dialog-small"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="dialog-body">
          <dl className="shortcut-list">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.keys} className="shortcut-row">
                <dt>
                  <kbd>{shortcut.keys}</kbd>
                </dt>
                <dd>{shortcut.description}</dd>
              </div>
            ))}
          </dl>

          <div className="dialog-actions">
            <button className="button button-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}