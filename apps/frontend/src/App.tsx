import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './hooks/useAuth.js'
import { RequireAuth } from './components/auth/RequireAuth.js'
import { RequireRole } from './components/auth/RequireRole.js'
import LoginPage from './pages/auth/LoginPage.js'

function RootRedirect() {
  const { user, isLoading } = useAuth()
  if (isLoading) return null
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={user.role === 'USER' ? '/dashboard' : '/admin/dashboard'} replace />
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <p className="text-slate-400">{label}</p>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/verify/:hash" element={<Placeholder label="Verify Page — FE-5" />} />

      {/* Authenticated (any role) */}
      <Route element={<RequireAuth />}>
        <Route path="/dashboard" element={<Placeholder label="User Dashboard — FE-3" />} />
        <Route path="/courses" element={<Placeholder label="Browse Courses — FE-3" />} />
        <Route path="/courses/:id" element={<Placeholder label="Course Detail — FE-3" />} />
        <Route path="/certs" element={<Placeholder label="My Certificates — FE-3" />} />
        <Route path="/report" element={<Placeholder label="My Report — FE-3" />} />
        <Route path="/profile" element={<Placeholder label="Profile — FE-3" />} />

        {/* ADMIN + MANAGER */}
        <Route element={<RequireRole roles={['ADMIN', 'MANAGER']} />}>
          <Route path="/admin/dashboard" element={<Placeholder label="Admin Dashboard — FE-4" />} />
          <Route path="/admin/courses" element={<Placeholder label="Course Management — FE-4" />} />
          <Route path="/admin/certificates" element={<Placeholder label="Certificate Engine — FE-4" />} />
          <Route path="/admin/reports" element={<Placeholder label="Reports — FE-4" />} />
          <Route path="/admin/announcements" element={<Placeholder label="Announcements — FE-4" />} />

          {/* ADMIN only */}
          <Route element={<RequireRole roles={['ADMIN']} />}>
            <Route path="/admin/users" element={<Placeholder label="Users — FE-4" />} />
          </Route>
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
