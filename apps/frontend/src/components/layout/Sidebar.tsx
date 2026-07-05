import { NavLink, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  BookOpen,
  Award,
  BarChart3,
  Users,
  Megaphone,
  LogOut,
  Droplets,
} from 'lucide-react'
import { useAuth, useLogoutMutation } from '../../hooks/useAuth.js'
import { Avatar } from '../ui/Avatar.js'
import type { LucideIcon } from 'lucide-react'

interface NavItem {
  path: string
  labelKey: string
  Icon: LucideIcon
}

const userNav: NavItem[] = [
  { path: '/dashboard',  labelKey: 'nav.dashboard',    Icon: LayoutDashboard },
  { path: '/courses',    labelKey: 'nav.courses',       Icon: BookOpen },
  { path: '/certs',      labelKey: 'nav.certificates',  Icon: Award },
  { path: '/report',     labelKey: 'nav.myReport',      Icon: BarChart3 },
]

const adminNav: NavItem[] = [
  { path: '/admin/dashboard',     labelKey: 'nav.adminDashboard',   Icon: LayoutDashboard },
  { path: '/admin/courses',       labelKey: 'nav.courseManagement', Icon: BookOpen },
  { path: '/admin/certificates',  labelKey: 'nav.certEngine',       Icon: Award },
  { path: '/admin/reports',       labelKey: 'nav.reports',          Icon: BarChart3 },
  { path: '/admin/announcements', labelKey: 'nav.announcements',    Icon: Megaphone },
  { path: '/admin/users',         labelKey: 'nav.users',            Icon: Users },
]

interface SidebarProps {
  onNavigate?: () => void
  isCollapsed?: boolean
}

export function Sidebar({ onNavigate, isCollapsed = false }: SidebarProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const logout = useLogoutMutation()

  const isAdmin = user?.role === 'ADMIN'
  const nav = isAdmin ? adminNav : userNav

  const sectionLabel = isAdmin ? t('nav.admin') : t('nav.myLearning')
  const roleLabel = user?.role ? t(`user.roles.${user.role}` as never) as string : ''
  const collapseLabelClass = isCollapsed
    ? 'max-w-0 -translate-x-1 opacity-0'
    : 'max-w-40 translate-x-0 opacity-100'
  const logoLabelClass = isCollapsed
    ? 'max-h-0 max-w-0 -translate-x-1 opacity-0'
    : 'max-h-20 max-w-[11rem] translate-x-0 opacity-100'

  return (
    <aside
      className={[
        'flex h-full flex-col overflow-hidden bg-gradient-to-b from-navy-900 to-navy-800 transition-[width] duration-300 ease-in-out',
        isCollapsed ? 'w-14' : 'w-60',
      ].join(' ')}
    >
      {/* Logo */}
      <div
        className={[
          'flex shrink-0 items-center border-b border-white/10',
          isCollapsed ? 'py-3' : 'py-4',
          isCollapsed ? 'justify-center px-2' : 'gap-3 px-3.5',
        ].join(' ')}
      >
        <div
          className={[
            'flex shrink-0 items-center justify-center rounded-md bg-white transition-[width,height] duration-300 ease-in-out',
            isCollapsed ? 'h-8 w-8' : 'h-9 w-9',
          ].join(' ')}
        >
          <Droplets size={isCollapsed ? 15 : 17} className="text-danger" />
        </div>
        <div
          aria-hidden={isCollapsed}
          className={[
            'min-w-0 overflow-hidden transition-[max-height,max-width,opacity,transform] duration-200 ease-out',
            logoLabelClass,
          ].join(' ')}
        >
          <p className="text-sm font-bold leading-snug text-white">{t('app.name')}</p>
          <p className="mt-1.5 text-xs leading-snug text-white/50">{t('app.subtitle')}</p>
        </div>
      </div>

      {/* Nav */}
      <nav className={['flex-1 overflow-y-auto py-4', isCollapsed ? 'px-1.5' : 'px-2.5'].join(' ')}>
        <p
          aria-hidden={isCollapsed}
          className={[
            'overflow-hidden whitespace-nowrap px-2.5 pb-2.5 text-[11px] font-semibold tracking-wider text-white/40 transition-[max-height,opacity,transform] duration-200 ease-out',
            isCollapsed ? 'max-h-0 -translate-x-1 opacity-0' : 'max-h-8 translate-x-0 opacity-100',
          ].join(' ')}
        >
          {sectionLabel}
        </p>
        <ul className="space-y-1">
          {nav.map((item) => {
            return (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  onClick={onNavigate}
                  title={isCollapsed ? (t(item.labelKey as never) as string) : undefined}
                  className={({ isActive }) =>
                    [
                      'flex items-center overflow-hidden rounded-md py-2 text-sm font-medium transition-colors',
                      isCollapsed ? 'justify-center px-2' : 'gap-2.5 px-3',
                      isActive
                        ? 'bg-brand-500/20 text-white'
                        : 'text-white/70 hover:bg-white/10 hover:text-white',
                    ].join(' ')
                  }
                >
                  <item.Icon size={16} className="shrink-0" />
                  <span
                    aria-hidden={isCollapsed}
                    className={[
                      'overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-200 ease-out',
                      collapseLabelClass,
                    ].join(' ')}
                  >
                    {t(item.labelKey as never) as string}
                  </span>
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* User + Logout */}
      {user && (
        <div className={['shrink-0 border-t border-white/10 py-2.5', isCollapsed ? 'px-2' : 'px-2.5'].join(' ')}>
          <Link
            to="/profile"
            onClick={onNavigate}
            title={isCollapsed ? user.name : undefined}
            className={[
              'flex items-center rounded-md border border-white/10 bg-white/5 py-2 transition-colors hover:border-white/20 hover:bg-white/10',
              isCollapsed ? 'justify-center px-1' : 'gap-2 px-2',
            ].join(' ')}
          >
            <Avatar name={user.name} size="md" />
            <div
              aria-hidden={isCollapsed}
              className={[
                'min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-200 ease-out',
                collapseLabelClass,
              ].join(' ')}
            >
              <p className="truncate text-xs font-semibold text-white">{user.name}</p>
              <p className="truncate text-xs text-white/50">{roleLabel}</p>
            </div>
          </Link>
          <div className="my-2 border-t border-white/10" />
          <button
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            title={isCollapsed ? t('auth.logout') : undefined}
            className={[
              'flex w-full items-center rounded-md py-1.5 text-sm font-medium text-white/60 transition-colors hover:bg-red-500/10 hover:text-red-100 disabled:opacity-60',
              isCollapsed ? 'justify-center px-2' : 'gap-2 px-2.5',
            ].join(' ')}
          >
            <LogOut size={15} />
            <span
              aria-hidden={isCollapsed}
              className={[
                'overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-200 ease-out',
                collapseLabelClass,
              ].join(' ')}
            >
              {t('auth.logout')}
            </span>
          </button>
        </div>
      )}
    </aside>
  )
}
