import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { LanguageSwitcher } from '../LanguageSwitcher.js'
import { useAuth } from '../../hooks/useAuth.js'

interface TopBarProps {
  onMenuClick: () => void
  isSidebarCollapsed: boolean
  onSidebarToggle: () => void
}

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard':            'nav.dashboard',
  '/courses':              'nav.courses',
  '/certs':                'nav.certificates',
  '/report':               'nav.myReport',
  '/profile':              'nav.profile',
  '/admin/dashboard':      'nav.adminDashboard',
  '/admin/courses':        'nav.courseManagement',
  '/admin/reports':        'nav.reports',
  '/admin/announcements':  'nav.announcements',
  '/admin/users':          'nav.users',
}

export function TopBar({ onMenuClick, isSidebarCollapsed, onSidebarToggle }: TopBarProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const location = useLocation()

  const titleKey = ROUTE_TITLES[location.pathname]
  const title: string = titleKey ? (t(titleKey as never) as string) : ''

  return (
    <header
      className="sticky top-0 z-10 flex min-h-12 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3.5"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* Left: hamburger (mobile) + status dot + page title */}
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
          onClick={onMenuClick}
          aria-label={t('common.openSidebar')}
        >
          <Menu size={18} />
        </button>
        <button
          className="hidden shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 md:inline-flex"
          onClick={onSidebarToggle}
          aria-label={isSidebarCollapsed ? t('common.expandSidebar') : t('common.collapseSidebar')}
          title={isSidebarCollapsed ? t('common.expandSidebar') : t('common.collapseSidebar')}
        >
          {isSidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="truncate text-sm font-semibold text-slate-800">{title}</span>
        </div>
      </div>

      {/* Right: lang switcher */}
      <div className="flex shrink-0 items-center gap-2.5">
        <LanguageSwitcher isAuthenticated={!!user} />
      </div>
    </header>
  )
}
