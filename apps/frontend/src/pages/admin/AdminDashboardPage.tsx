import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Users, BookOpen,
  CheckCircle2, Clock, ChevronRight,
} from 'lucide-react'
import type { ComplianceRow } from '@btec-lms/shared'
import { getDashboardSummary, getComplianceList } from '../../api/reports.js'
import { StatCard, StatCardSkeleton } from '../../components/ui/StatCard.js'
import { Card } from '../../components/ui/Card.js'
import { ProgressBar } from '../../components/ui/ProgressBar.js'
import { StatusBadge } from '../../components/ui/StatusBadge.js'
import { Skeleton } from '../../components/ui/Skeleton.js'
import type { Column } from '../../components/ui/DataTable.js'
import { DataTable } from '../../components/ui/DataTable.js'

// ─── Query key factories ───────────────────────────────────────────────────────

const DASH_KEY = ['reports', 'dashboard'] as const
const COMPLIANCE_PREVIEW_KEY = ['reports', 'compliance', 'preview'] as const

// ─── Compliance preview columns ───────────────────────────────────────────────

function useComplianceColumns(): Column<ComplianceRow>[] {
  const { t } = useTranslation()
  return [
    { key: 'userName',         header: t('user.name'),           width: '28%', skeleton: 'text' },
    { key: 'courseTitle',      header: t('course.label'),         width: '28%', skeleton: 'text' },
    { key: 'progress',         header: t('enrollment.progress'),  width: '11%', align: 'right', skeleton: 'text',
      render: (r) => `${r.progress}%` },
    { key: 'enrollmentStatus', header: t('enrollment.label'),     width: '17%', skeleton: 'pill',
      render: (r) => <StatusBadge type="enrollment" status={r.enrollmentStatus} /> },
  ]
}

// ─── AdminDashboardPage ───────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const { t } = useTranslation()

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    refetch: refetchSummary,
  } = useQuery({ queryKey: DASH_KEY, queryFn: getDashboardSummary })

  // Compliance preview — top 5 rows
  const {
    data: compliance,
    isLoading: complianceLoading,
    isError: complianceError,
    refetch: refetchCompliance,
  } = useQuery({
    queryKey: COMPLIANCE_PREVIEW_KEY,
    queryFn: () => getComplianceList({ limit: 5, page: 1 }),
  })

  const columns = useComplianceColumns()

  // Completion rate
  const total = summary?.totalEnrollments ?? 0
  const completed = summary?.completedEnrollments ?? 0
  const pending = summary?.pendingEnrollments ?? 0
  const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-slate-800">
          {t('adminDash.title')}
        </h1>
      </div>

      {/* ── Stat Cards ── */}
      {summaryError ? (
        <div className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-600">
          <span>{t('common.error')}</span>
          <button
            onClick={() => void refetchSummary()}
            className="font-medium underline hover:no-underline"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {summaryLoading ? (
            Array.from({ length: 2 }).map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            <>
              <StatCard
                label={t('adminDash.staffCount')}
                value={summary?.totalUsers ?? 0}
                icon={<Users size={20} />}
              />
              <StatCard
                label={t('adminDash.publishedCourses')}
                value={summary?.totalCourses ?? 0}
                icon={<BookOpen size={20} />}
              />
            </>
          )}
        </div>
      )}

      {/* ── Main content ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* Compliance preview — 2/3 width */}
        <div className="lg:col-span-2">
          <Card
            header={
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-700">{t('adminDash.compliancePreview')}</h2>
                <Link
                  to="/admin/reports"
                  className="flex items-center gap-1 text-sm font-medium text-brand-500 hover:text-brand-600"
                >
                  {t('adminDash.viewFullReport')}
                  <ChevronRight size={14} />
                </Link>
              </div>
            }
            noPadding
          >
            {complianceError ? (
              <div className="flex items-center justify-between px-5 py-4 text-sm text-red-600">
                <span>{t('common.error')}</span>
                <button
                  onClick={() => void refetchCompliance()}
                  className="font-medium underline hover:no-underline"
                >
                  {t('common.retry')}
                </button>
              </div>
            ) : (
              <DataTable<ComplianceRow>
                columns={columns}
                data={compliance?.data ?? []}
                keyField="enrollmentId"
                isLoading={complianceLoading}
                emptyMessage={t('adminDash.noCompliance')}
              />
            )}
          </Card>
        </div>

        {/* Right column — 1/3 width */}
        <div className="flex flex-col gap-4">

          {/* Learning progress */}
          <Card header={<h2 className="font-semibold text-slate-700">{t('adminDash.progressTitle')}</h2>}>
            {summaryLoading ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-3.5 w-8" />
                  </div>
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <Skeleton className="h-3.5 w-24" />
                      <Skeleton className="h-3.5 w-8" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <ProgressBar
                  value={completionPct}
                  label={t('adminDash.completionRate')}
                  showValue
                />
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-emerald-600">
                      <CheckCircle2 size={14} />
                      <span>{t('adminDash.completed')}</span>
                    </div>
                    <span className="font-semibold text-slate-700">{completed}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-500">
                      <Clock size={14} />
                      <span>{t('adminDash.pending')}</span>
                    </div>
                    <span className="font-semibold text-slate-700">{pending}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-slate-500">
                    <span>{t('adminDash.totalEnrollments')}</span>
                    <span className="font-semibold text-slate-700">{total}</span>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
