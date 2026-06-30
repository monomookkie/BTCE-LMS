import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Menu, Bell } from 'lucide-react'
import { LanguageSwitcher } from '../LanguageSwitcher.js'
import { Badge } from '../ui/Badge.js'
import { useAuth } from '../../hooks/useAuth.js'
import type { BadgeVariant } from '../ui/Badge.js'

interface TopBarProps {
  onMenuClick: () => void
  unreadNotifications?: number
}

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard':            'nav.dashboard',
  '/courses':              'nav.courses',
  '/certs':                'nav.certificates',
  '/report':               'nav.myReport',
  '/profile':              'nav.profile',
  '/admin/dashboard':      'nav.adminDashboard',
  '/admin/courses':        'nav.courseManagement',
  '/admin/certificates':   'nav.certEngine',
  '/admin/reports':        'nav.reports',
  '/admin/announcements':  'nav.announcements',
  '/admin/users':          'nav.users',
}

const ROLE_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  ADMIN:   { label: 'Administrator', variant: 'blue' },
  MANAGER: { label: 'Manager',       variant: 'purple' },
  USER:    { label: 'Staff',         variant: 'gray' },
}

export function TopBar({ onMenuClick, unreadNotifications = 0 }: TopBarProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const location = useLocation()

  const titleKey = ROUTE_TITLES[location.pathname]
  const title: string = titleKey ? (t(titleKey as never) as string) : ''
  const roleBadge = user?.role ? ROLE_BADGE[user.role] : undefined

  return (
    <header className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-slate-200 bg-white px-4">
      {/* Left: hamburger (mobile) + status dot + page title */}
      <div className="flex items-center gap-3">
        <button
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
          onClick={onMenuClick}
          aria-label="Open sidebar"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="text-sm font-semibold text-slate-800">{title}</span>
        </div>
      </div>

      {/* Right: lang switcher + bell + role badge */}
      <div className="flex items-center gap-3">
        <LanguageSwitcher isAuthenticated={!!user} />

        <button
          className="relative rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
          aria-label={t('nav.notifications')}
        >
          <Bell size={18} />
          {unreadNotifications > 0 && (
            <span className="absolute right-1 top-1 flex h-2 w-2 rounded-full bg-red-500" />
          )}
        </button>

        {roleBadge && (
          <Badge variant={roleBadge.variant}>{roleBadge.label}</Badge>
        )}
      </div>
    </header>
  )
}
