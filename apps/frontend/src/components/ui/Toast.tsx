import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

// ────────────────────────────────────────────────────────────────── types ──

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastItem {
  id: string
  type: ToastType
  message: string
  duration?: number | undefined
}

type AddToastInput = Omit<ToastItem, 'id'>

// ──────────────────────────────────────────────────────────────── context ──

const ToastContext = createContext<((toast: AddToastInput) => void) | null>(null)

// ─────────────────────────────────────────────────────────────── reducer ──

type Action = { type: 'ADD'; payload: ToastItem } | { type: 'REMOVE'; id: string }

function reducer(state: ToastItem[], action: Action): ToastItem[] {
  switch (action.type) {
    case 'ADD':    return [...state, action.payload]
    case 'REMOVE': return state.filter((t) => t.id !== action.id)
    default:       return state
  }
}

// ──────────────────────────────────────────────────────── single toast ──

const icons = { success: CheckCircle, error: AlertCircle, info: Info, warning: AlertTriangle }

const toastStyles: Record<ToastType, string> = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  error:   'bg-red-50    border-red-200    text-red-800',
  info:    'bg-blue-50   border-blue-200   text-blue-800',
  warning: 'bg-amber-50  border-amber-200  text-amber-800',
}

const iconStyles: Record<ToastType, string> = {
  success: 'text-emerald-500',
  error:   'text-red-500',
  info:    'text-blue-500',
  warning: 'text-amber-500',
}

function SingleToast({ toast, onRemove }: { toast: ToastItem; onRemove: (id: string) => void }) {
  const { t } = useTranslation()
  const Icon = icons[toast.type]

  useEffect(() => {
    const timer = setTimeout(() => onRemove(toast.id), toast.duration ?? 5000)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, onRemove])

  return (
    <div
      className={[
        'flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg',
        toastStyles[toast.type],
      ].join(' ')}
    >
      <Icon size={18} className={['mt-0.5 shrink-0', iconStyles[toast.type]].join(' ')} />
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        aria-label={t('ui.toast.dismiss')}
        className="shrink-0 opacity-60 hover:opacity-100"
      >
        <X size={16} />
      </button>
    </div>
  )
}

// ──────────────────────────────────────────────────────────── provider ──

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, dispatch] = useReducer(reducer, [])

  const addToast = useCallback((toast: AddToastInput) => {
    const id = Math.random().toString(36).slice(2)
    dispatch({ type: 'ADD', payload: { ...toast, id } })
  }, [])

  const removeToast = useCallback((id: string) => {
    dispatch({ type: 'REMOVE', id })
  }, [])

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      {createPortal(
        <div className="fixed right-4 top-4 z-[100] flex w-80 flex-col gap-2">
          {toasts.map((toast) => (
            <SingleToast key={toast.id} toast={toast} onRemove={removeToast} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

// ──────────────────────────────────────────────────────────────── hook ──

export function useToast() {
  const addToast = useContext(ToastContext)
  if (!addToast) throw new Error('useToast must be used within ToastProvider')

  return {
    success: (message: string, duration?: number) =>
      addToast({ type: 'success', message, ...(duration !== undefined ? { duration } : {}) }),
    error: (message: string, duration?: number) =>
      addToast({ type: 'error', message, ...(duration !== undefined ? { duration } : {}) }),
    info: (message: string, duration?: number) =>
      addToast({ type: 'info', message, ...(duration !== undefined ? { duration } : {}) }),
    warning: (message: string, duration?: number) =>
      addToast({ type: 'warning', message, ...(duration !== undefined ? { duration } : {}) }),
  }
}
