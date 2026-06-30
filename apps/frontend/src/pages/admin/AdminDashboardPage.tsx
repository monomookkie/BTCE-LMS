import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Users, BookOpen, Award, AlertTriangle,
  CheckCircle2, Clock, ChevronRight,
} from 'lucide-react'
import type { ComplianceRow } from '@btec-lms/shared'
import { useAuth } from '../../hooks/useAuth.js'
import { getDashboardSummary, getComplianceList } from '../../api/reports.js'
import { listDepartments } from '../../api/departments.js'
import { StatCard } from '../../components/ui/StatCard.js'
import { Card } from '../../components/ui/Card.js'
import { ProgressBar } from '../../components/ui/ProgressBar.js'
import { Skeleton } from '../../components/ui/Skeleton.js'
import { StatusBadge } from '../../components/ui/StatusBadge.js'
import type { Column } from '../../components/ui/DataTable.js'
import { DataTable } from '../../components/ui/DataTable.js'

// ─── Query key factories ───────────────────────────────────────────────────────

const DASH_KEY = ['reports', 'dashboard'] as const
const complianceKey = (deptId: string | undefined) =>
  ['reports', 'compliance', 'preview', deptId ?? 'all'] as const
const DEPTS_KEY = ['departments'] as const

// ─── Compliance preview columns ───────────────────────────────────────────────

function useComplianceColumns(): Column<ComplianceRow>[] {
  const { t } = useTranslation()
  return [
    { key: 'userName',         header: t('user.name'),           width: '22%' },
    { key: 'department',       header: t('user.department'),      width: '18%',
      render: (r) => r.department ?? '—' },
    { key: 'courseTitle',      header: t('course.label'),         width: '24%' },
    { key: 'progress',         header: t('enrollment.progress'),  width: '10%', align: 'right',
      render: (r) => `${r.progress}%` },
    { key: 'enrollmentStatus', header: t('enrollment.label'),     width: '13%',
      render: (r) => <StatusBadge type="enrollment" status={r.enrollmentStatus} /> },
    { key: 'certStatus',       header: t('certificate.label'),    width: '13%',
      render: (r) => r.certStatus
        ? <StatusBadge type="cert" status={r.certStatus} />
        : <span className="text-slate-400">—</span> },
  ]
}

// ─── Skeleton loaders ─────────────────────────────────────────────────────────

function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
      <Skeleton className="mb-3 h-4 w-24" />
      <Skeleton className="h-8 w-16" />
    </div>
  )
}

// ─── AdminDashboardPage ───────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  const [selectedDeptId, setSelectedDeptId] = useState<string | undefined>(undefined)

  // Dashboard summary — always global for ADMIN, dept-scoped for MANAGER (backend)
  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
    refetch: refetchSummary,
  } = useQuery({ queryKey: DASH_KEY, queryFn: getDashboardSummary })

  // Compliance preview — top 5 rows, filtered by dept (ADMIN only)
  const effectiveDeptId = isAdmin ? selectedDeptId : undefined
  const {
    data: compliance,
    isLoading: complianceLoading,
    isError: complianceError,
    refetch: refetchCompliance,
  } = useQuery({
    queryKey: complianceKey(effectiveDeptId),
    queryFn: () => getComplianceList({
      ...(effectiveDeptId !== undefined && { departmentId: effectiveDeptId }),
      limit: 5,
      page: 1,
    }),
  })

  // Department list for dropdown (ADMIN only)
  const { data: departments } = useQuery({
    queryKey: DEPTS_KEY,
    queryFn: listDepartments,
    enabled: isAdmin,
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

        {/* Dept filter — ADMIN: dropdown, MANAGER: label */}
        {isAdmin ? (
          <div className="flex items-center gap-2">
            <label htmlFor="dept-select" className="text-sm text-slate-500">
              {t('adminDash.deptFilter')}
            </label>
            <select
              id="dept-select"
              value={selectedDeptId ?? ''}
              onChange={(e) => setSelectedDeptId(e.target.value || undefined)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            >
              <option value="">{t('adminDash.deptAll')}</option>
              {departments?.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600">
            {t('adminDash.viewingDept')}
            <span className="font-medium text-slate-800">
              {departments?.find((d) => d.id === user?.departmentId)?.name ?? '—'}
            </span>
          </div>
        )}
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
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {summaryLoading ? (
            Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
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
              <StatCard
                label={t('adminDash.certsIssued')}
                value={summary?.certsIssued ?? 0}
                icon={<Award size={20} />}
              />
              <StatCard
                label={t('adminDash.expiringSoon')}
                value={summary?.certsExpiringSoon ?? 0}
                icon={<AlertTriangle size={20} />}
                className={summary?.certsExpiringSoon ? 'border-amber-200' : undefined}
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

          {/* Navy recertification card */}
          <div className="rounded-xl bg-brand-800 p-5 text-white shadow-sm">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-brand-200">
              <AlertTriangle size={15} />
              {t('adminDash.recertTitle')}
            </div>
            {summaryLoading ? (
              <Skeleton className="my-2 h-10 w-16 bg-brand-700" />
            ) : (
              <p className="my-1 text-5xl font-bold">
                {summary?.certsExpiringSoon ?? 0}
              </p>
            )}
            <p className="text-sm text-brand-300">{t('adminDash.recertSubtext')}</p>
            <Link
              to="/admin/reports"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-200 hover:text-white"
            >
              {t('adminDash.viewFullReport')}
              <ChevronRight size={12} />
            </Link>
          </div>

          {/* Learning progress */}
          <Card header={<h2 className="font-semibold text-slate-700">{t('adminDash.progressTitle')}</h2>}>
            {summaryLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-4 w-1/2" />
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
