import { useTranslation } from 'react-i18next'
import { Modal } from './Modal.js'
import { Button } from './Button.js'

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title?: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'brand' | 'danger'
  isLoading?: boolean
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'brand',
  isLoading = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation()

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title ?? t('ui.confirmDialog.defaultTitle')} size="sm">
      <p className="mb-6 text-sm text-slate-600">
        {message ?? t('ui.confirmDialog.defaultMessage')}
      </p>
      <div className="flex justify-end gap-3">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={isLoading}>
          {cancelLabel ?? t('common.cancel')}
        </Button>
        <Button variant={variant} size="sm" onClick={onConfirm} isLoading={isLoading}>
          {confirmLabel ?? t('common.confirm')}
        </Button>
      </div>
    </Modal>
  )
}
