import { Navigate, Outlet } from 'react-router-dom'
import type { Role } from '@btec-lms/shared'
import { useAuth } from '../../hooks/useAuth.js'

interface Props {
  roles: Role[]
}

export function RequireRole({ roles }: Props) {
  const { user } = useAuth()

  if (!user || !roles.includes(user.role)) {
    const fallback = user?.role === 'USER' ? '/dashboard' : '/admin/dashboard'
    return <Navigate to={fallback} replace />
  }

  return <Outlet />
}
