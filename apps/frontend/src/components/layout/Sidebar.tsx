import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  BookOpen,
  Award,
  BarChart3,
  User,
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
  adminOnly?: boolean
}

const userNav: NavItem[] = [
  { path: '/dashboard',  labelKey: 'nav.dashboard',    Icon: LayoutDashboard },
  { path: '/courses',    labelKey: 'nav.courses',       Icon: BookOpen },
  { path: '/certs',      labelKey: 'nav.certificates',  Icon: Award },
  { path: '/report',     labelKey: 'nav.myReport',      Icon: BarChart3 },
  { path: '/profile',    labelKey: 'nav.profile',       Icon: User },
]

const adminNav: NavItem[] = [
  { path: '/admin/dashboard',     labelKey: 'nav.adminDashboard',   Icon: LayoutDashboard },
  { path: '/admin/courses',       labelKey: 'nav.courseManagement', Icon: BookOpen },
  { path: '/admin/certificates',  labelKey: 'nav.certEngine',       Icon: Award },
  { path: '/admin/reports',       labelKey: 'nav.reports',          Icon: BarChart3 },
  { path: '/admin/announcements', labelKey: 'nav.announcements',    Icon: Megaphone },
  { path: '/admin/users',         labelKey: 'nav.users',            Icon: Users, adminOnly: true },
]

interface SidebarProps {
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const logout = useLogoutMutation()

  const isAdmin = user?.role === 'ADMIN'
  const isAdminOrManager = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const nav = isAdminOrManager ? adminNav : userNav

  return (
    <aside className="flex h-full w-[200px] flex-col bg-gradient-to-b from-navy-900 to-navy-800">
      {/* Logo */}
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-white/10 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500">
          <Droplets size={18} className="text-white" />
        </div>
        <span className="text-sm font-bold text-white">BTEC LMS</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {nav.map((item) => {
            if (item.adminOnly && !isAdmin) return null
            return (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    [
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-brand-500/20 text-white'
                        : 'text-white/70 hover:bg-white/10 hover:text-white',
                    ].join(' ')
                  }
                >
                  <item.Icon size={16} className="shrink-0" />
                  {t(item.labelKey as never) as string}
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* User + Logout */}
      {user && (
        <div className="shrink-0 border-t border-white/10 px-3 py-3">
          <div className="mb-2 flex items-center gap-2.5">
            <Avatar name={user.name} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-white">{user.name}</p>
              <p className="truncate text-[10px] text-white/50">{user.email}</p>
            </div>
          </div>
          <button
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut size={13} />
            {t('auth.logout')}
          </button>
        </div>
      )}
    </aside>
  )
}
