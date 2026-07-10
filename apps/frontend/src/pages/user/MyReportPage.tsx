import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookOpen, CheckCircle } from 'lucide-react'
import type { EnrollmentResponse } from '@btec-lms/shared'
import { StatCard, StatCardSkeleton } from '../../components/ui/StatCard.js'
import { Card } from '../../components/ui/Card.js'
import { DataTable, type Column } from '../../components/ui/DataTable.js'
import { StatusBadge } from '../../components/ui/StatusBadge.js'
import { ProgressBar } from '../../components/ui/ProgressBar.js'
import { listMyEnrollments } from '../../api/enrollments.js'
import { formatDate } from '../../lib/format.js'

const ENROLLMENTS_ME_KEY = ['enrollments', 'me'] as const

export default function MyReportPage() {
  const { t, i18n } = useTranslation()

  const {
    data: enrollPage,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ENROLLMENTS_ME_KEY,
    queryFn: () => listMyEnrollments(),
    staleTime: 60_000,
  })

  const enrollments = enrollPage?.data ?? []
  const completedCount = enrollments.filter((e) => e.status === 'COMPLETED').length

  const enrollColumns: Column<EnrollmentResponse>[] = [
    {
      key: 'courseTitle',
      header: t('course.label'),
      skeleton: 'text',
      render: (r) => <span className="font-medium text-slate-700">{r.courseTitle}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '130px',
      skeleton: 'pill',
      render: (r) => <StatusBadge type="enrollment" status={r.status} />,
    },
    {
      key: 'progress',
      header: t('enrollment.progress'),
      width: '160px',
      skeleton: 'bar',
      render: (r) => <ProgressBar value={r.progress} showValue />,
    },
    {
      key: 'dueAt',
      header: t('enrollment.dueDate'),
      skeleton: 'text',
      render: (r) => (r.dueAt != null ? formatDate(r.dueAt, i18n.language) : '—'),
    },
    {
      key: 'completedAt',
      header: t('report.completedOn'),
      skeleton: 'text',
      render: (r) =>
        r.completedAt != null ? formatDate(r.completedAt, i18n.language) : '—',
    },
  ]

  if (isError) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-slate-500">{t('common.error')}</p>
        <button
          className="mt-2 text-sm text-brand-500 hover:underline"
          onClick={() => void refetch()}
        >
          {t('common.retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-xl font-semibold text-slate-800">{t('report.title')}</h1>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              label={t('report.totalEnrolled')}
              value={enrollPage?.total ?? 0}
              icon={<BookOpen size={20} />}
            />
            <StatCard
              label={t('report.completedCourses')}
              value={completedCount}
              icon={<CheckCircle size={20} />}
            />
          </>
        )}
      </div>

      {/* Enrollment history */}
      <Card
        header={
          <h2 className="text-sm font-semibold text-slate-700">
            {t('report.enrollmentHistory')}
          </h2>
        }
      >
        <DataTable<EnrollmentResponse>
          columns={enrollColumns}
          data={enrollments}
          keyField="id"
          isLoading={isLoading}
          emptyMessage={t('report.noData')}
        />
      </Card>
    </div>
  )
}
