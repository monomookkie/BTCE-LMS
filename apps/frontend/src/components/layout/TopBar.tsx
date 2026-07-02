import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Menu } from 'lucide-react'
import { LanguageSwitcher } from '../LanguageSwitcher.js'
import { Badge } from '../ui/Badge.js'
import { useAuth } from '../../hooks/useAuth.js'
import { NotificationBell } from './NotificationBell.js'
import type { BadgeVariant } from '../ui/Badge.js'

interface TopBarProps {
  onMenuClick: () => void
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

export function TopBar({ onMenuClick }: TopBarProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const location = useLocation()

  const titleKey = ROUTE_TITLES[location.pathname]
  const title: string = titleKey ? (t(titleKey as never) as string) : ''
  const roleBadge = user?.role ? ROLE_BADGE[user.role] : undefined

  return (
    <header className="sticky top-0 z-10 flex h-[52px] items-center justify-between gap-2 border-b border-slate-200 bg-white px-4">
      {/* Left: hamburger (mobile) + status dot + page title */}
      <div className="flex min-w-0 items-center gap-3">
        <button
          className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
          onClick={onMenuClick}
          aria-label="Open sidebar"
        >
          <Menu size={20} />
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="truncate text-sm font-semibold text-slate-800">{title}</span>
        </div>
      </div>

      {/* Right: lang switcher + bell + role badge — role badge hidden below sm: to fit 375px */}
      <div className="flex shrink-0 items-center gap-3">
        <LanguageSwitcher isAuthenticated={!!user} />

        <NotificationBell />

        {roleBadge && (
          <Badge variant={roleBadge.variant} className="hidden sm:inline-flex">{roleBadge.label}</Badge>
        )}
      </div>
    </header>
  )
}
