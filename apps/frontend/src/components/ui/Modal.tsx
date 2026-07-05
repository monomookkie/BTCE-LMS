import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type ModalSize = 'sm' | 'md' | 'lg'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  size?: ModalSize
  hideCloseButton?: boolean
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
}

export function Modal({ isOpen, onClose, title, children, size = 'md', hideCloseButton = false }: ModalProps) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={[
          'relative w-full rounded-lg bg-white shadow-xl',
          sizeClasses[size],
        ].join(' ')}
        role="dialog"
        aria-modal="true"
      >
        {(title || !hideCloseButton) && (
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            {title && <h2 className="text-base font-semibold text-slate-800">{title}</h2>}
            {!hideCloseButton && (
              <button
                onClick={onClose}
                aria-label={t('common.close')}
                className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="px-4 py-3.5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
