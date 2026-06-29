import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string | undefined
  header?: ReactNode
  footer?: ReactNode
  noPadding?: boolean | undefined
}

export function Card({ children, className, header, footer, noPadding = false }: CardProps) {
  return (
    <div
      className={['bg-white rounded-xl border border-slate-100 shadow-sm', className]
        .filter(Boolean)
        .join(' ')}
    >
      {header && (
        <div className="border-b border-slate-100 px-5 py-4">{header}</div>
      )}
      <div className={noPadding ? '' : 'p-5'}>{children}</div>
      {footer && (
        <div className="border-t border-slate-100 px-5 py-4">{footer}</div>
      )}
    </div>
  )
}
