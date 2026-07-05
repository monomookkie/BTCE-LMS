import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './Button.js'
import { Skeleton } from './Skeleton.js'

// ──────────────────────────────────────────────────────────────── types ──

// รูปทรง skeleton ต่อคอลัมน์ตอนโหลด — ต้องตรงกับสิ่งที่ column นั้น render จริง ไม่ใช่แท่งเหมือนกันทุกคอลัมน์
// 'text' (ค่าเริ่มต้น): บรรทัดเดียว, 'text-sub': ชื่อ+บรรทัดรอง (เช่น name+email), 'pill': ตรงกับ Badge/StatusBadge,
// 'bar': ตรงกับ ProgressBar, 'icons': ตรงกับกลุ่มปุ่มไอคอนในคอลัมน์ actions, 'none': ไม่ต้องมี skeleton
export type ColumnSkeleton = 'text' | 'text-sub' | 'pill' | 'bar' | 'icons' | 'none'

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => ReactNode
  width?: string
  align?: 'left' | 'center' | 'right'
  skeleton?: ColumnSkeleton
}

export interface PaginationConfig {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

interface DataTableProps<T extends object> {
  columns: Column<T>[]
  data: T[]
  keyField: keyof T
  isLoading?: boolean | undefined
  emptyMessage?: string | undefined
  pagination?: PaginationConfig | undefined
  className?: string | undefined
}

// ─────────────────────────────────────────────────────── skeleton cells ──

// ความกว้าง text วนตามแถว ให้ดูเป็นข้อความยาวไม่เท่ากันจริง ไม่ใช่แท่งเต็มความกว้างซ้ำทุกแถว
const TEXT_WIDTHS = ['w-4/5', 'w-full', 'w-3/5', 'w-5/6']

function SkeletonCell({ type, rowIndex }: { type: ColumnSkeleton; rowIndex: number }) {
  if (type === 'none') return null
  if (type === 'pill') return <Skeleton className="h-5 w-16 rounded-full" />
  if (type === 'icons') {
    return (
      <div className="flex gap-2">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-4" />
      </div>
    )
  }
  if (type === 'bar') {
    return (
      <div className="space-y-1">
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-3 w-8" />
      </div>
    )
  }

  const widthClass = TEXT_WIDTHS[rowIndex % TEXT_WIDTHS.length]
  if (type === 'text-sub') {
    return (
      <div className="space-y-1.5">
        <Skeleton className={`h-4 ${widthClass}`} />
        <Skeleton className="h-3 w-2/3" />
      </div>
    )
  }
  return <Skeleton className={`h-4 ${widthClass}`} />
}

// ──────────────────────────────────────────────────────── align helpers ──

const thAlign: Record<string, string> = {
  left: 'text-left', center: 'text-center', right: 'text-right',
}
const tdAlign: Record<string, string> = {
  left: 'text-left', center: 'text-center', right: 'text-right',
}

// ─────────────────────────────────────────────────────────── component ──

export function DataTable<T extends object>({
  columns,
  data,
  keyField,
  isLoading = false,
  emptyMessage,
  pagination,
  className,
}: DataTableProps<T>) {
  const { t } = useTranslation()

  const totalPages = pagination ? Math.ceil(pagination.total / pagination.pageSize) : 1
  const from = pagination ? (pagination.page - 1) * pagination.pageSize + 1 : 1
  const to = pagination
    ? Math.min(pagination.page * pagination.pageSize, pagination.total)
    : data.length

  return (
    <div className={className}>
      <div className="overflow-x-auto rounded-md border border-slate-100">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={[
                    'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500',
                    thAlign[col.align ?? 'left'],
                  ].join(' ')}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {isLoading ? (
              Array.from({ length: pagination?.pageSize ?? 5 }).map((_, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-2">
                      <SkeletonCell type={col.skeleton ?? 'text'} rowIndex={i} />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-sm text-slate-400"
                >
                  {emptyMessage ?? t('ui.table.empty')}
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr
                  key={String(row[keyField])}
                  className="transition-colors hover:bg-slate-50"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={[
                        'px-3 py-2 text-slate-700',
                        tdAlign[col.align ?? 'left'],
                      ].join(' ')}
                    >
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>
            {t('ui.pagination.showing', {
              from,
              to,
              total: pagination.total,
            })}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              leftIcon={<ChevronLeft size={14} />}
            >
              {t('ui.pagination.previous')}
            </Button>
            <span className="px-3">
              {t('ui.pagination.pageOf', {
                current: pagination.page,
                total: totalPages,
              })}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={pagination.page >= totalPages}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              {t('ui.pagination.next')}
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
