import type { ReactNode } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { Card } from './Card.js'
import { Skeleton } from './Skeleton.js'

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
          <p className="mt-0.5 text-xl font-bold text-slate-800">{value}</p>
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
        <div className="rounded-md bg-brand-50 p-2 text-brand-500">{icon}</div>
      </div>
    </Card>
  )
}

// mirror ของ StatCard เป๊ะ — wrapper/สัดส่วนเดียวกัน (label บรรทัดเล็ก + ตัวเลขบรรทัดใหญ่ + icon box มุมขวาบน)
// เก็บคู่กับ StatCard เพราะ mirror component นี้โดยตรง แก้ StatCard แล้วต้องอัปเดตที่นี่ด้วย
export function StatCardSkeleton({ className }: { className?: string | undefined }) {
  return (
    <Card className={className}>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-6 w-12" />
        </div>
        <Skeleton className="h-9 w-9 rounded-md" />
      </div>
    </Card>
  )
}
