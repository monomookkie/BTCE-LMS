import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { BookOpen, CheckCircle, Megaphone, ChevronLeft, ChevronRight } from 'lucide-react'
import type { AnnouncementPublicResponse } from '@btec-lms/shared'
import { StatCard, StatCardSkeleton } from '../../components/ui/StatCard.js'
import { Card } from '../../components/ui/Card.js'
import { StatusBadge } from '../../components/ui/StatusBadge.js'
import { ProgressBar } from '../../components/ui/ProgressBar.js'
import { Skeleton } from '../../components/ui/Skeleton.js'
import { listMyEnrollments } from '../../api/enrollments.js'
import { listPublicAnnouncements } from '../../api/announcements.js'
import { formatDate } from '../../lib/format.js'

const ENROLLMENTS_ME_KEY = ['enrollments', 'me'] as const
const ANNOUNCEMENTS_BOARD_KEY = ['announcements', 'board'] as const
const AUTO_SLIDE_MS = 5000

// 3:1 ตรงกับ banner ที่แนะนำ admin ให้อัปโหลด (เช่น 1200x400) — ให้ภาพเต็มกรอบพอดีไม่มีขอบว่าง
function AnnouncementCardSkeleton() {
  return <Skeleton className="aspect-[3/1] w-full rounded-lg" />
}

// เลื่อนอัตโนมัติทีละภาพ, หยุดเลื่อนตอน hover, เลื่อนเองได้ผ่านลูกศร/จุด
function AnnouncementCarousel({ announcements }: { announcements: AnnouncementPublicResponse[] }) {
  const { t, i18n } = useTranslation()
  const [index, setIndex] = useState(0)
  const [isPaused, setIsPaused] = useState(false)

  // list เปลี่ยน (เช่น refetch มาแล้วจำนวนอันน้อยลง) — กัน index ค้างเกินขอบ
  useEffect(() => {
    setIndex(0)
  }, [announcements.length])

  useEffect(() => {
    if (announcements.length <= 1 || isPaused) return
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % announcements.length)
    }, AUTO_SLIDE_MS)
    return () => clearInterval(timer)
  }, [announcements.length, isPaused])

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-slate-100"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div
        className="flex transition-transform duration-500 ease-out"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {announcements.map((a) => (
          <div key={a.id} className="w-full shrink-0">
            {a.fileSignedUrl != null && (
              a.link != null ? (
                <a href={a.link} target="_blank" rel="noreferrer">
                  <img
                    src={a.fileSignedUrl}
                    alt={a.title}
                    className="aspect-[3/1] w-full cursor-pointer bg-slate-50 object-contain"
                  />
                </a>
              ) : (
                <img
                  src={a.fileSignedUrl}
                  alt={a.title}
                  className="aspect-[3/1] w-full bg-slate-50 object-contain"
                />
              )
            )}
            {(a.content || a.publishedAt != null) && (
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                {a.content != null && (
                  <p className="whitespace-pre-line text-sm text-slate-600">{a.content}</p>
                )}
                {a.publishedAt != null && (
                  <span className="ml-auto shrink-0 text-xs text-slate-400">
                    {formatDate(a.publishedAt, i18n.language)}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {announcements.length > 1 && (
        <>
          <button
            onClick={() => setIndex((i) => (i - 1 + announcements.length) % announcements.length)}
            aria-label={t('ui.pagination.previous')}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white hover:bg-black/60"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => setIndex((i) => (i + 1) % announcements.length)}
            aria-label={t('ui.pagination.next')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white hover:bg-black/60"
          >
            <ChevronRight size={18} />
          </button>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
            {announcements.map((a, i) => (
              <button
                key={a.id}
                onClick={() => setIndex(i)}
                aria-label={`${i + 1}`}
                className={[
                  'h-1.5 w-1.5 rounded-full transition-colors',
                  i === index ? 'bg-white' : 'bg-white/50',
                ].join(' ')}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

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

  const { data: announcementPage, isLoading: isAnnouncementsLoading } = useQuery({
    queryKey: ANNOUNCEMENTS_BOARD_KEY,
    queryFn: () => listPublicAnnouncements({ limit: 5 }),
    staleTime: 60_000,
  })
  const announcements = announcementPage?.data ?? []

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
    <div className="space-y-4 p-5">
      <h1 className="text-xl font-semibold text-slate-800">{t('nav.dashboard')}</h1>

      {/* ป้ายประกาศ */}
      <Card
        header={
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <Megaphone size={15} className="text-slate-400" />
            {t('dashboard.announcements')}
          </h2>
        }
      >
        {isAnnouncementsLoading ? (
          <AnnouncementCardSkeleton />
        ) : announcements.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            {t('dashboard.emptyAnnouncements')}
          </p>
        ) : (
          <AnnouncementCarousel announcements={announcements} />
        )}
      </Card>

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
