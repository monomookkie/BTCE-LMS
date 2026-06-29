import type { ReactNode } from 'react'

export type BadgeVariant = 'blue' | 'green' | 'red' | 'amber' | 'purple' | 'gray'

interface BadgeProps {
  variant?: BadgeVariant | undefined
  children: ReactNode
  className?: string | undefined
}

const variantClasses: Record<BadgeVariant, string> = {
  blue:   'bg-blue-50   text-blue-700   border-blue-100',
  green:  'bg-emerald-50 text-emerald-700 border-emerald-100',
  red:    'bg-red-50    text-red-700    border-red-100',
  amber:  'bg-amber-50  text-amber-700  border-amber-100',
  purple: 'bg-purple-50 text-purple-700 border-purple-100',
  gray:   'bg-slate-50  text-slate-600  border-slate-200',
}

export function Badge({ variant = 'gray', children, className }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </span>
  )
}
