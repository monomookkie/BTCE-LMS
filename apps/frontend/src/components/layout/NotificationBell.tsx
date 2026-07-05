import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'
import type { NotificationResponse } from '@btec-lms/shared'
import { listMyNotifications, markNotificationRead, markAllNotificationsRead } from '../../api/notifications.js'
import { Skeleton } from '../ui/Skeleton.js'
import { Transition } from '../ui/Transition.js'

const NOTIFICATIONS_KEY = ['notifications', 'me'] as const

// mirror ของแถว notification จริง — title + subtitle เรียงกัน
function NotificationRowSkeleton() {
  return (
    <li className="px-4 py-3">
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </li>
  )
}

export function NotificationBell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => listMyNotifications({ limit: 20 }),
    refetchOnWindowFocus: true,
  })

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  })

  const markAllReadMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  })

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const unreadCount = data?.unreadCount ?? 0

  const handleRowClick = (n: NotificationResponse) => {
    if (n.readAt === null) markReadMutation.mutate(n.id)
    if (n.link) {
      setOpen(false)
      navigate(n.link)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        className="relative rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
        aria-label={t('nav.notifications')}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-2 w-2 rounded-full bg-red-500" />
        )}
      </button>

      <Transition
        show={open}
        variant="popover"
        className="absolute right-0 z-20 mt-2 w-80 origin-top-right rounded-xl border border-slate-100 bg-white shadow-lg"
      >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold text-slate-800">{t('notification.title')}</span>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllReadMutation.mutate()}
                disabled={markAllReadMutation.isPending}
                className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50"
              >
                {t('notification.markAllRead')}
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <ul className="divide-y divide-slate-100">
                {Array.from({ length: 3 }).map((_, i) => <NotificationRowSkeleton key={i} />)}
              </ul>
            ) : !data || data.data.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">{t('notification.empty')}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.data.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => handleRowClick(n)}
                      className={[
                        'block w-full px-4 py-3 text-left text-sm hover:bg-slate-50',
                        n.readAt === null ? 'bg-brand-50/40' : '',
                      ].join(' ')}
                    >
                      <div className="flex items-start gap-2">
                        {n.readAt === null && (
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className={n.readAt === null ? 'font-medium text-slate-800' : 'text-slate-600'}>
                            {n.title}
                          </p>
                          {n.body && <p className="mt-0.5 truncate text-xs text-slate-400">{n.body}</p>}
                          <p className="mt-1 text-xs text-slate-400">
                            {new Date(n.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
      </Transition>
    </div>
  )
}
