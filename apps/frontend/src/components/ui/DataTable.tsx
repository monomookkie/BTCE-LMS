import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Skeleton } from './Skeleton.js'
import { Button } from './Button.js'

// ──────────────────────────────────────────────────────────────── types ──

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => ReactNode
  width?: string
  align?: 'left' | 'center' | 'right'
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
      <div className="overflow-x-auto rounded-xl border border-slate-100">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={[
                    'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500',
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
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-sm text-slate-400"
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
                        'px-4 py-3 text-slate-700',
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
