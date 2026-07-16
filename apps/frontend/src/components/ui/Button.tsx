import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Tooltip } from './Tooltip.js'

export type ButtonVariant = 'brand' | 'outline' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  isLoading?: boolean
  leftIcon?: ReactNode
}

const variantClasses: Record<ButtonVariant, string> = {
  brand:   'bg-brand-500 text-white hover:bg-brand-600 focus-visible:ring-brand-500 disabled:bg-brand-300',
  outline: 'border border-brand-500 text-brand-600 hover:bg-brand-50 focus-visible:ring-brand-500 disabled:border-slate-200 disabled:text-slate-400',
  ghost:   'text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400 disabled:text-slate-300',
  danger:  'bg-danger text-white hover:bg-red-700 focus-visible:ring-red-500 disabled:bg-red-300',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 text-xs gap-1.5',
  md: 'px-3 py-1.5 text-sm gap-1.5',
}

export function Button({
  variant = 'brand',
  size = 'md',
  isLoading = false,
  leftIcon,
  disabled,
  children,
  className,
  title,
  ...rest
}: ButtonProps) {
  const button = (
    <button
      disabled={disabled ?? isLoading}
      aria-label={title as string | undefined}
      className={[
        'inline-flex items-center justify-center rounded-md font-medium transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {isLoading ? (
        <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin" />
      ) : (
        leftIcon
      )}
      {children}
    </button>
  )

  // ใช้ custom Tooltip (สไตล์เดียวกับตอน sidebar ย่อ) แทน native title attribute ทุกจุดที่มี
  // icon-only action button (edit/disable/delete ฯลฯ) — title เดิมเล็ก/ช้า/ปรับสไตล์ไม่ได้
  if (title) return <Tooltip label={title as string}>{button}</Tooltip>

  return button
}
