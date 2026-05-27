export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'אישור',
  cancelText = 'ביטול',
  confirmClassName = 'btn-primary',
  onConfirm,
  onCancel,
  loading = false,
}) {
  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={() => !loading && onCancel?.()}>
      <div className="modal request-adjust-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {message && <p className="confirm-message">{message}</p>}
        <div className="request-adjust-actions">
          <button className={confirmClassName} onClick={onConfirm} disabled={loading}>
            {loading ? 'טוען...' : confirmText}
          </button>
          <button className="btn-secondary" onClick={onCancel} disabled={loading}>
            {cancelText}
          </button>
        </div>
      </div>
    </div>
  )
}
