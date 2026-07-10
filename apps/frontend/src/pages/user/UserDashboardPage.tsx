import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { BookOpen, CheckCircle } from 'lucide-react'
import { StatCard, StatCardSkeleton } from '../../components/ui/StatCard.js'
import { Card } from '../../components/ui/Card.js'
import { StatusBadge } from '../../components/ui/StatusBadge.js'
import { ProgressBar } from '../../components/ui/ProgressBar.js'
import { Skeleton } from '../../components/ui/Skeleton.js'
import { listMyEnrollments } from '../../api/enrollments.js'
import { formatDate } from '../../lib/format.js'

const ENROLLMENTS_ME_KEY = ['enrollments', 'me'] as const

// mirror ของแถว enrollment ใน "Recent Progress" — ชื่อคอร์ส+badge บรรทัดบน, progress bar บรรทัดล่าง
function ProgressListRowSkeleton() {
  return (
    <li className="py-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-2 w-full rounded-full" />
    </li>
  )
}

export default function UserDashboardPage() {
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

  const inProgressCount = enrollments.filter(
    (e) => e.status === 'IN_PROGRESS' || e.status === 'ASSIGNED',
  ).length
  const completedCount = enrollments.filter((e) => e.status === 'COMPLETED').length

  const activeEnrollments = enrollments
    .filter((e) => e.status === 'IN_PROGRESS' || e.status === 'ASSIGNED')
    .slice(0, 5)

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
      <h1 className="text-xl font-semibold text-slate-800">{t('nav.dashboard')}</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              label={t('dashboard.inProgress')}
              value={inProgressCount}
              icon={<BookOpen size={20} />}
            />
            <StatCard
              label={t('dashboard.completed')}
              value={completedCount}
              icon={<CheckCircle size={20} />}
            />
          </>
        )}
      </div>

      {/* Course Progress */}
      <Card
        header={
          <h2 className="text-sm font-semibold text-slate-700">
            {t('dashboard.recentProgress')}
          </h2>
        }
      >
        {isLoading ? (
          <ul className="divide-y divide-slate-100">
            {Array.from({ length: 3 }).map((_, i) => <ProgressListRowSkeleton key={i} />)}
          </ul>
        ) : activeEnrollments.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            {t('dashboard.emptyEnrollments')}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {activeEnrollments.map((e) => (
              <li key={e.id}>
                <Link
                  to={`/courses/${e.courseId}`}
                  className="block rounded-lg py-3 transition-colors hover:bg-slate-50"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-700">
                      {e.courseTitle}
                    </span>
                    <StatusBadge type="enrollment" status={e.status} />
                  </div>
                  <ProgressBar value={e.progress} showValue />
                  {e.dueAt != null && (
                    <p className="mt-1 text-xs text-slate-400">
                      {t('enrollment.dueDate')}: {formatDate(e.dueAt, i18n.language)}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
