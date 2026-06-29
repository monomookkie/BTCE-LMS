import type { ReactNode } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { Card } from './Card.js'

interface Trend {
  value: number
  label?: string
}

interface StatCardProps {
  label: string
  value: string | number
  icon: ReactNode
  trend?: Trend | undefined
  className?: string | undefined
}

export function StatCard({ label, value, icon, trend, className }: StatCardProps) {
  return (
    <Card className={className}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-3xl font-bold text-slate-800">{value}</p>
          {trend && (
            <div
              className={[
                'mt-1 flex items-center gap-1 text-xs font-medium',
                trend.value >= 0 ? 'text-emerald-600' : 'text-red-500',
              ].join(' ')}
            >
              {trend.value >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              <span>
                {trend.value >= 0 ? '+' : ''}
                {trend.value}
                {trend.label ? ` ${trend.label}` : ''}
              </span>
            </div>
          )}
        </div>
        <div className="rounded-xl bg-brand-50 p-3 text-brand-500">{icon}</div>
      </div>
    </Card>
  )
}
