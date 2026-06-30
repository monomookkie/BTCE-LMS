import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { Card } from '../../components/ui/Card.js'
import { Button } from '../../components/ui/Button.js'
import { Skeleton } from '../../components/ui/Skeleton.js'
import { listPublishedCourses } from '../../api/courses.js'
import { listMyEnrollments, selfEnroll } from '../../api/enrollments.js'
import { ApiError } from '../../lib/api.js'
import { useToast } from '../../hooks/useToast.js'

const COURSES_KEY = ['courses', 'published'] as const
const ENROLLMENTS_ME_KEY = ['enrollments', 'me'] as const

export default function BrowseCoursesPage() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [search, setSearch] = useState('')

  const {
    data: coursePage,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: COURSES_KEY,
    queryFn: () => listPublishedCourses(),
    staleTime: 60_000,
  })

  const { data: enrollPage } = useQuery({
    queryKey: ENROLLMENTS_ME_KEY,
    queryFn: () => listMyEnrollments(),
    staleTime: 60_000,
  })

  const enrolledCourseIds = useMemo(
    () => new Set(enrollPage?.data.map((e) => e.courseId) ?? []),
    [enrollPage],
  )

  const filtered = useMemo(() => {
    const courses = coursePage?.data ?? []
    const q = search.trim().toLowerCase()
    if (!q) return courses
    return courses.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q),
    )
  }, [coursePage, search])

  const enrollMutation = useMutation({
    mutationFn: (courseId: string) => selfEnroll(courseId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ENROLLMENTS_ME_KEY })
      toast.success(t('browse.enrollSuccess'))
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 403) toast.error(t('browse.enrollForbidden'))
        else if (err.status === 409 || err.status === 400) toast.error(t('browse.enrollDuplicate'))
        else toast.error(err.message)
      } else {
        toast.error(t('common.error'))
      }
    },
  })

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
      <h1 className="text-xl font-semibold text-slate-800">{t('course.allCourses')}</h1>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder={t('browse.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
        />
      </div>

      {/* Course grid */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="h-32" />
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">
          {t('browse.noCourses')}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((course) => {
            const isEnrolled = enrolledCourseIds.has(course.id)
            const isEnrolling =
              enrollMutation.isPending && enrollMutation.variables === course.id

            return (
              <Card key={course.id} className="flex flex-col">
                <div className="mb-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-brand-500">
                    {course.category}
                  </span>
                  <h3 className="mt-1 text-sm font-semibold leading-snug text-slate-800">
                    {course.title}
                  </h3>
                  {course.description != null && (
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                      {course.description}
                    </p>
                  )}
                </div>

                <div className="mt-auto space-y-1 text-xs text-slate-500">
                  {course.durationMin != null && (
                    <p>{t('browse.durationMin', { count: course.durationMin })}</p>
                  )}
                  <p>
                    {t('browse.minScore')}: {course.passScore}%
                  </p>
                  {course.expiryMonths != null && (
                    <p>
                      {t('course.expiryMonths')}: {course.expiryMonths} {t('course.months')}
                    </p>
                  )}
                </div>

                <div className="mt-3">
                  {isEnrolled ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                      {t('browse.alreadyEnrolled')}
                    </span>
                  ) : course.allowSelfEnroll ? (
                    <Button
                      size="sm"
                      isLoading={isEnrolling}
                      disabled={enrollMutation.isPending}
                      onClick={() => enrollMutation.mutate(course.id)}
                    >
                      {isEnrolling ? t('browse.enrolling') : t('course.enroll')}
                    </Button>
                  ) : (
                    <span className="text-xs text-slate-400">
                      {t('browse.selfEnrollDisabled')}
                    </span>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
