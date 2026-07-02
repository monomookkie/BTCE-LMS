import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Users, BookOpen, Award, AlertTriangle, Download } from 'lucide-react'
import type { ComplianceRow } from '@btec-lms/shared'
import {
  getDashboardSummary,
  getComplianceList,
  downloadComplianceCsv,
  type EnrollmentStatus,
} from '../../api/reports.js'
import { listDepartments } from '../../api/departments.js'
import { listAdminCourses } from '../../api/admin-courses.js'
import { useAuth } from '../../hooks/useAuth.js'
import { useToast } from '../../hooks/useToast.js'
import { ApiError } from '../../lib/api.js'
import { Button } from '../../components/ui/Button.js'
import { Card } from '../../components/ui/Card.js'
import { StatCard } from '../../components/ui/StatCard.js'
import { Skeleton } from '../../components/ui/Skeleton.js'
import { StatusBadge } from '../../components/ui/StatusBadge.js'
import type { Column } from '../../components/ui/DataTable.js'
import { DataTable } from '../../components/ui/DataTable.js'

const STATUSES: EnrollmentStatus[] = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED']
const PAGE_SIZE = 20

function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
      <Skeleton className="mb-3 h-4 w-24" />
      <Skeleton className="h-8 w-16" />
    </div>
  )
}

export default function ReportsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const toast = useToast()
  const isAdmin = user?.role === 'ADMIN'

  const [deptFilter, setDeptFilter] = useState('')
  const [courseFilter, setCourseFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | EnrollmentStatus>('')
  const [page, setPage] = useState(1)

  // Dashboard summary strip — reused from FE-4a, already dept-scoped server-side
  const { data: summary, isLoading: summaryLoading, isError: summaryError, refetch: refetchSummary } =
    useQuery({ queryKey: ['reports', 'dashboard'], queryFn: getDashboardSummary })

  // Fetched for both roles: ADMIN uses it to populate the dropdown, MANAGER uses it
  // only to display their own department's name in the fixed (non-editable) label below.
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: listDepartments })

  const { data: courses } = useQuery({
    queryKey: ['admin', 'courses', 'all-for-filter'],
    queryFn: () => listAdminCourses({ limit: 100 }),
  })

  // MANAGER: departmentId filter is never sent — backend ignores/overrides it anyway,
  // but we don't even offer the control so there's nothing to fake-select.
  const effectiveDeptId = isAdmin ? (deptFilter || undefined) : undefined

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['reports', 'compliance', effectiveDeptId, courseFilter, statusFilter, page],
    queryFn: () =>
      getComplianceList({
        ...(effectiveDeptId ? { departmentId: effectiveDeptId } : {}),
        ...(courseFilter ? { courseId: courseFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        page,
        limit: PAGE_SIZE,
      }),
  })

  const exportMutation = useMutation({
    mutationFn: () =>
      downloadComplianceCsv({
        ...(effectiveDeptId ? { departmentId: effectiveDeptId } : {}),
        ...(courseFilter ? { courseId: courseFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })

  const columns = useMemo<Column<ComplianceRow>[]>(
    () => [
      { key: 'userName', header: t('user.name'), width: '18%' },
      { key: 'department', header: t('user.department'), width: '14%',
        render: (r) => r.department ?? '—' },
      { key: 'courseTitle', header: t('course.label'), width: '20%' },
      { key: 'enrollmentStatus', header: t('enrollment.label'), width: '13%',
        render: (r) => <StatusBadge type="enrollment" status={r.enrollmentStatus} /> },
      { key: 'progress', header: t('enrollment.progress'), width: '9%', align: 'right',
        render: (r) => `${r.progress}%` },
      { key: 'certStatus', header: t('certificate.label'), width: '13%',
        render: (r) => r.certStatus
          ? <StatusBadge type="cert" status={r.certStatus} />
          : <span className="text-slate-400">—</span> },
      { key: 'certExpiresAt', header: t('certificate.expires'), width: '13%',
        render: (r) => r.certExpiresAt ? new Date(r.certExpiresAt).toLocaleDateString() : '—' },
    ],
    [t],
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">{t('reports.title')}</h1>
        <Button
          variant="outline"
          leftIcon={<Download size={15} />}
          isLoading={exportMutation.isPending}
          onClick={() => exportMutation.mutate()}
        >
          {t('reports.exportCsv')}
        </Button>
      </div>

      {/* Summary strip — reused dashboard summary, already dept-scoped server-side for MANAGER */}
      {summaryError ? (
        <div className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-600">
          <span>{t('common.error')}</span>
          <button onClick={() => void refetchSummary()} className="font-medium underline hover:no-underline">
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {summaryLoading ? (
            Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            <>
              <StatCard label={t('adminDash.staffCount')} value={summary?.totalUsers ?? 0} icon={<Users size={20} />} />
              <StatCard label={t('adminDash.publishedCourses')} value={summary?.totalCourses ?? 0} icon={<BookOpen size={20} />} />
              <StatCard label={t('adminDash.certsIssued')} value={summary?.certsIssued ?? 0} icon={<Award size={20} />} />
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

      {/* Filters */}
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Department filter — ADMIN only. MANAGER sees a fixed label, no way to pick another dept. */}
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <label htmlFor="report-dept" className="text-sm text-slate-500">{t('adminDash.deptFilter')}</label>
              <select
                id="report-dept"
                value={deptFilter}
                onChange={(e) => { setDeptFilter(e.target.value); setPage(1) }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
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

          <select
            value={courseFilter}
            onChange={(e) => { setCourseFilter(e.target.value); setPage(1) }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          >
            <option value="">{t('reports.allCourses')}</option>
            {courses?.data.map((c) => (
              <option key={c.id} value={c.id}>{c.titleEn}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(1) }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          >
            <option value="">{t('reports.allStatus')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{t(`status.enrollment.${s}`)}</option>
            ))}
          </select>
        </div>
      </Card>

      {isError && (
        <div className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-600">
          <span>{t('common.error')}</span>
          <button onClick={() => void refetch()} className="font-medium underline hover:no-underline">
            {t('common.retry')}
          </button>
        </div>
      )}

      <DataTable<ComplianceRow>
        columns={columns}
        data={data?.data ?? []}
        keyField="enrollmentId"
        isLoading={isLoading}
        emptyMessage={t('reports.noRows')}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.total ?? 0,
          onPageChange: setPage,
        }}
      />
    </div>
  )
}
