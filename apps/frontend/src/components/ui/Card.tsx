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
      className={['bg-white rounded-md border border-slate-100 shadow-sm', className]
        .filter(Boolean)
        .join(' ')}
    >
      {header && (
        <div className="border-b border-slate-100 px-3.5 py-3">{header}</div>
      )}
      <div className={noPadding ? '' : 'p-3.5'}>{children}</div>
      {footer && (
        <div className="border-t border-slate-100 px-3.5 py-3">{footer}</div>
      )}
    </div>
  )
}
