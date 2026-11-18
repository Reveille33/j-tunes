import { useEscapeKey } from '../hooks/useEscapeKey'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A small yes/no confirmation, used for destructive bulk actions.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  useEscapeKey(onCancel, !busy)

  return (
    <div className="dialog-backdrop confirm-backdrop" onClick={onCancel}>
      <div
        className="dialog dialog-small"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2 id="confirm-dialog-title">{title}</h2>
        </div>

        <div className="dialog-body">
          <p className="dialog-text">{message}</p>

          <div className="dialog-actions">
            <button className="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button className="button button-danger" onClick={onConfirm} disabled={busy}>
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}