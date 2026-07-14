import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Users, BookOpen, Upload, CheckCircle2, Percent } from 'lucide-react'
import type { ComplianceRow, CourseCommentRow, UserReportRow, CoursePassedUserRow } from '@btec-lms/shared'
import {
  getDashboardSummary,
  getComplianceList,
  downloadComplianceCsv,
  getCourseReport,
  getCourseComments,
  getCoursePassedUsers,
  getUserReport,
  type EnrollmentStatus,
} from '../../api/reports.js'
import { listAdminCourses } from '../../api/admin-courses.js'
import { listAdminUsers } from '../../api/admin-users.js'
import { useToast } from '../../hooks/useToast.js'
import { ApiError } from '../../lib/api.js'
import { Button } from '../../components/ui/Button.js'
import { Select } from '../../components/ui/Select.js'
import { Card } from '../../components/ui/Card.js'
import { Modal } from '../../components/ui/Modal.js'
import { StatCard, StatCardSkeleton } from '../../components/ui/StatCard.js'
import { StatusBadge } from '../../components/ui/StatusBadge.js'
import type { Column } from '../../components/ui/DataTable.js'
import { DataTable } from '../../components/ui/DataTable.js'
import { PAGE_SIZE } from '../../lib/constants.js'

const STATUSES: EnrollmentStatus[] = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED']

// ─── By Course tab — Enrolled / Passed drill-down modals ───────────────────

interface CourseListModalProps {
  isOpen: boolean
  onClose: () => void
  courseId: string
}

function EnrolledModal({ isOpen, onClose, courseId }: CourseListModalProps) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'by-course', 'enrolled', courseId, page],
    queryFn: () => getComplianceList({ courseId, page, limit: PAGE_SIZE }),
    enabled: isOpen,
  })

  const columns = useMemo<Column<ComplianceRow>[]>(
    () => [
      { key: 'userName', header: t('user.name'), skeleton: 'text' },
      { key: 'enrollmentStatus', header: t('enrollment.label'), width: '25%', skeleton: 'pill',
        render: (r) => <StatusBadge type="enrollment" status={r.enrollmentStatus} /> },
      { key: 'progress', header: t('enrollment.progress'), width: '15%', align: 'right', skeleton: 'text',
        render: (r) => `${r.progress}%` },
    ],
    [t],
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('reports.enrolledListTitle')} size="lg">
      <DataTable<ComplianceRow>
        columns={columns}
        data={data?.data ?? []}
        keyField="enrollmentId"
        isLoading={isLoading}
        emptyMessage={t('reports.noRows')}
        pagination={{ page, pageSize: PAGE_SIZE, total: data?.total ?? 0, onPageChange: setPage }}
      />
    </Modal>
  )
}

function PassedModal({ isOpen, onClose, courseId }: CourseListModalProps) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'by-course', 'passed', courseId, page],
    queryFn: () => getCoursePassedUsers(courseId, { page, limit: PAGE_SIZE }),
    enabled: isOpen,
  })

  const columns = useMemo<Column<CoursePassedUserRow>[]>(
    () => [
      { key: 'userName', header: t('user.name'), skeleton: 'text' },
      { key: 'correctCount', header: t('reports.quizBestScore'), width: '25%', align: 'right', skeleton: 'text',
        render: (r) => r.correctCount != null && r.totalQuestions != null ? `${r.correctCount}/${r.totalQuestions}` : '—' },
    ],
    [t],
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('reports.passedListTitle')} size="lg">
      <DataTable<CoursePassedUserRow>
        columns={columns}
        data={data?.data ?? []}
        keyField="userId"
        isLoading={isLoading}
        emptyMessage={t('reports.noPassedUsers')}
        pagination={{ page, pageSize: PAGE_SIZE, total: data?.total ?? 0, onPageChange: setPage }}
      />
    </Modal>
  )
}

// ─── By Course tab ──────────────────────────────────────────────────────────

function ByCourseTab() {
  const { t } = useTranslation()
  const [courseId, setCourseId] = useState('')
  const [commentsPage, setCommentsPage] = useState(1)
  const [enrolledOpen, setEnrolledOpen] = useState(false)
  const [passedOpen, setPassedOpen] = useState(false)

  const { data: courses } = useQuery({
    queryKey: ['admin', 'courses', 'all-for-filter'],
    queryFn: () => listAdminCourses({ limit: 100 }),
  })

  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ['reports', 'by-course', courseId],
    queryFn: () => getCourseReport(courseId),
    enabled: courseId !== '',
  })

  const { data: comments, isLoading: commentsLoading } = useQuery({
    queryKey: ['reports', 'by-course', 'comments', courseId, commentsPage],
    queryFn: () => getCourseComments(courseId, { page: commentsPage, limit: PAGE_SIZE }),
    enabled: courseId !== '' && report?.hasSurvey === true,
  })

  const commentColumns = useMemo<Column<CourseCommentRow>[]>(
    () => [
      { key: 'questionText', header: t('reports.questionColumn'), width: '35%', skeleton: 'text' },
      { key: 'comment', header: t('reports.commentColumn'), skeleton: 'text' },
    ],
    [t],
  )

  return (
    <div className="space-y-5">
      <Card>
        <Select
          value={courseId}
          onChange={(v) => { setCourseId(v); setCommentsPage(1) }}
          placeholder={t('reports.selectCourse')}
          options={(courses?.data ?? []).map((c) => ({ value: c.id, label: c.titleEn }))}
        />
      </Card>

      {courseId !== '' && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {reportLoading ? (
              Array.from({ length: 3 }).map((_, i) => <StatCardSkeleton key={i} />)
            ) : (
              <>
                <button type="button" className="text-left" onClick={() => setEnrolledOpen(true)}>
                  <StatCard
                    label={t('reports.enrollmentCount')}
                    value={report?.enrollmentCount ?? 0}
                    icon={<Users size={20} />}
                    className="cursor-pointer transition-shadow hover:shadow-md"
                  />
                </button>
                <button type="button" className="text-left" onClick={() => setPassedOpen(true)}>
                  <StatCard
                    label={t('reports.passCount')}
                    value={report?.passCount ?? 0}
                    icon={<CheckCircle2 size={20} />}
                    className="cursor-pointer transition-shadow hover:shadow-md"
                  />
                </button>
                <StatCard
                  label={t('reports.passRate')}
                  value={report?.passRate != null ? `${report.passRate}%` : '—'}
                  icon={<Percent size={20} />}
                />
              </>
            )}
          </div>

          <EnrolledModal isOpen={enrolledOpen} onClose={() => setEnrolledOpen(false)} courseId={courseId} />
          <PassedModal isOpen={passedOpen} onClose={() => setPassedOpen(false)} courseId={courseId} />

          {!reportLoading && report?.hasSurvey && (
            <Card header={<h2 className="font-semibold text-slate-700">{t('reports.satisfaction')}</h2>}>
              <div className="space-y-4">
                {report.ratingStats.map((stat) => {
                  const maxCount = Math.max(1, ...stat.distribution.map((d) => d.count))
                  return (
                    <div key={stat.questionId}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-700">{stat.text}</span>
                        <span className="text-slate-500">
                          {stat.responseCount > 0 ? `${stat.average}/5` : '—'} ({stat.responseCount} {t('reports.responses')})
                        </span>
                      </div>
                      <div className="space-y-1">
                        {stat.distribution.slice().reverse().map((d) => (
                          <div key={d.rating} className="flex items-center gap-2 text-xs text-slate-500">
                            <span className="w-3">{d.rating}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-brand-500"
                                style={{ width: `${(d.count / maxCount) * 100}%` }}
                              />
                            </div>
                            <span className="w-6 text-right">{d.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {!reportLoading && report && !report.hasSurvey && (
            <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">{t('reports.noSurvey')}</p>
          )}

          {!reportLoading && report?.hasSurvey && (
            <Card header={<h2 className="font-semibold text-slate-700">{t('reports.comments')}</h2>} noPadding>
              <DataTable<CourseCommentRow>
                columns={commentColumns}
                data={comments?.data ?? []}
                keyField="comment"
                isLoading={commentsLoading}
                emptyMessage={t('reports.noComments')}
                pagination={{
                  page: commentsPage,
                  pageSize: PAGE_SIZE,
                  total: comments?.total ?? 0,
                  onPageChange: setCommentsPage,
                }}
              />
            </Card>
          )}
        </>
      )}
    </div>
  )
}

// ─── By User tab ────────────────────────────────────────────────────────────

function ByUserTab() {
  const { t } = useTranslation()
  const [userId, setUserId] = useState('')

  const { data: users } = useQuery({
    queryKey: ['admin', 'users', 'all-for-filter'],
    // limit: 100 คือ max ที่ paginationQuerySchema (shared) อนุญาต — ส่งเกินนี้ backend 400 ทันที
    queryFn: () => listAdminUsers({ limit: 100 }),
  })

  const { data: report, isLoading } = useQuery({
    queryKey: ['reports', 'by-user', userId],
    queryFn: () => getUserReport(userId),
    enabled: userId !== '',
  })

  const rowColumns = useMemo<Column<UserReportRow>[]>(
    () => [
      { key: 'courseTitle', header: t('course.label'), width: '30%', skeleton: 'text' },
      { key: 'status', header: t('enrollment.label'), width: '14%', skeleton: 'pill',
        render: (r) => <StatusBadge type="enrollment" status={r.status} /> },
      { key: 'progress', header: t('enrollment.progress'), width: '10%', align: 'right', skeleton: 'text',
        render: (r) => `${r.progress}%` },
      { key: 'quiz', header: t('reports.quizColumn'), width: '18%', skeleton: 'text',
        render: (r) => {
          if (r.quizPassed == null) return <span className="text-slate-400">{t('reports.quizNoQuiz')}</span>
          const label = r.quizPassed ? t('reports.quizPassed') : t('reports.quizNotPassed')
          const score = r.quizCorrectCount != null && r.quizTotalQuestions != null
            ? ` (${r.quizCorrectCount}/${r.quizTotalQuestions})`
            : ''
          return <span className={r.quizPassed ? 'text-emerald-600' : 'text-amber-600'}>{label}{score}</span>
        } },
      { key: 'completedAt', header: t('reports.completedAtColumn'), width: '28%', skeleton: 'text',
        render: (r) => r.completedAt ? new Date(r.completedAt).toLocaleDateString() : '—' },
    ],
    [t],
  )

  return (
    <div className="space-y-5">
      <Card>
        <Select
          value={userId}
          onChange={setUserId}
          placeholder={t('reports.selectUser')}
          options={(users?.data ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
        />
      </Card>

      {userId !== '' && (
        <>
          <Card header={<h2 className="font-semibold text-slate-700">{t('reports.mandatoryCourses')}</h2>} noPadding>
            <DataTable<UserReportRow>
              columns={rowColumns}
              data={report?.mandatory ?? []}
              keyField="enrollmentId"
              isLoading={isLoading}
              emptyMessage={t('reports.noEnrollments')}
            />
          </Card>
          <Card header={<h2 className="font-semibold text-slate-700">{t('reports.optionalCourses')}</h2>} noPadding>
            <DataTable<UserReportRow>
              columns={rowColumns}
              data={report?.optional ?? []}
              keyField="enrollmentId"
              isLoading={isLoading}
              emptyMessage={t('reports.noEnrollments')}
            />
          </Card>
        </>
      )}
    </div>
  )
}

// ─── Compliance tab (existing behavior, extracted) ─────────────────────────

interface ComplianceTabProps {
  courseFilter: string
  setCourseFilter: (v: string) => void
  statusFilter: '' | EnrollmentStatus
  setStatusFilter: (v: '' | EnrollmentStatus) => void
}

function useComplianceExportMutation(courseFilter: string, statusFilter: '' | EnrollmentStatus) {
  const { t } = useTranslation()
  const toast = useToast()
  return useMutation({
    mutationFn: () =>
      downloadComplianceCsv({
        ...(courseFilter ? { courseId: courseFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      }),
    onError: (err) => toast.error(err instanceof ApiError ? err.message : t('common.error')),
  })
}

function ComplianceTab({ courseFilter, setCourseFilter, statusFilter, setStatusFilter }: ComplianceTabProps) {
  const { t } = useTranslation()

  const [page, setPage] = useState(1)

  // Dashboard summary strip
  const { data: summary, isLoading: summaryLoading, isError: summaryError, refetch: refetchSummary } =
    useQuery({ queryKey: ['reports', 'dashboard'], queryFn: getDashboardSummary })

  const { data: courses } = useQuery({
    queryKey: ['admin', 'courses', 'all-for-filter'],
    queryFn: () => listAdminCourses({ limit: 100 }),
  })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['reports', 'compliance', courseFilter, statusFilter, page],
    queryFn: () =>
      getComplianceList({
        ...(courseFilter ? { courseId: courseFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        page,
        limit: PAGE_SIZE,
      }),
  })

  const columns = useMemo<Column<ComplianceRow>[]>(
    () => [
      { key: 'userName', header: t('user.name'), width: '22%', skeleton: 'text' },
      { key: 'courseTitle', header: t('course.label'), width: '24%', skeleton: 'text' },
      { key: 'enrollmentStatus', header: t('enrollment.label'), width: '15%', skeleton: 'pill',
        render: (r) => <StatusBadge type="enrollment" status={r.enrollmentStatus} /> },
      { key: 'progress', header: t('enrollment.progress'), width: '11%', align: 'right', skeleton: 'text',
        render: (r) => `${r.progress}%` },
    ],
    [t],
  )

  return (
    <div className="space-y-5">
      {/* Summary strip — reused dashboard summary */}
      {summaryError ? (
        <div className="flex items-center justify-between rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-600">
          <span>{t('common.error')}</span>
          <button onClick={() => void refetchSummary()} className="font-medium underline hover:no-underline">
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {summaryLoading ? (
            Array.from({ length: 2 }).map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            <>
              <StatCard label={t('adminDash.staffCount')} value={summary?.totalUsers ?? 0} icon={<Users size={20} />} />
              <StatCard label={t('adminDash.publishedCourses')} value={summary?.totalCourses ?? 0} icon={<BookOpen size={20} />} />
            </>
          )}
        </div>
      )}

      {/* Filters */}
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select
            value={courseFilter}
            onChange={(v) => { setCourseFilter(v); setPage(1) }}
            options={[
              { value: '', label: t('reports.allCourses') },
              ...(courses?.data.map((c) => ({ value: c.id, label: c.titleEn })) ?? []),
            ]}
          />

          <Select
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v as typeof statusFilter); setPage(1) }}
            options={[
              { value: '', label: t('reports.allStatus') },
              ...STATUSES.map((s) => ({ value: s, label: t(`status.enrollment.${s}`) })),
            ]}
          />
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

// ─── ReportsPage ─────────────────────────────────────────────────────────────

type ReportTab = 'compliance' | 'byCourse' | 'byUser'

export default function ReportsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<ReportTab>('compliance')
  const [courseFilter, setCourseFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | EnrollmentStatus>('')
  const exportMutation = useComplianceExportMutation(courseFilter, statusFilter)

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-slate-800">{t('reports.title')}</h1>
        {tab === 'compliance' && (
          <Button
            variant="outline"
            leftIcon={<Upload size={15} />}
            isLoading={exportMutation.isPending}
            onClick={() => exportMutation.mutate()}
          >
            {t('reports.exportCsv')}
          </Button>
        )}
      </div>

      <div className="flex gap-1 rounded-xl border border-slate-100 bg-slate-50 p-1">
        {(['compliance', 'byCourse', 'byUser'] as ReportTab[]).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              tab === tb ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tb === 'compliance' ? t('reports.tabCompliance') : tb === 'byCourse' ? t('reports.tabByCourse') : t('reports.tabByUser')}
          </button>
        ))}
      </div>

      {tab === 'compliance' && (
        <ComplianceTab
          courseFilter={courseFilter}
          setCourseFilter={setCourseFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
        />
      )}
      {tab === 'byCourse' && <ByCourseTab />}
      {tab === 'byUser' && <ByUserTab />}
    </div>
  )
}
