import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './hooks/useAuth.js'
import { RequireAuth } from './components/auth/RequireAuth.js'
import { RequireRole } from './components/auth/RequireRole.js'
import AppLayout from './components/layout/AppLayout.js'
import LoginPage from './pages/auth/LoginPage.js'
import RegisterPage from './pages/auth/RegisterPage.js'

const UiShowcasePage = lazy(() => import('./pages/UiShowcasePage.js'))
const ProfilePage = lazy(() => import('./pages/profile/ProfilePage.js'))
const UserDashboardPage = lazy(() => import('./pages/user/UserDashboardPage.js'))
const BrowseCoursesPage = lazy(() => import('./pages/user/BrowseCoursesPage.js'))
const CourseDetailPage = lazy(() => import('./pages/user/CourseDetailPage.js'))
const MyCertificatesPage = lazy(() => import('./pages/user/MyCertificatesPage.js'))
const MyReportPage = lazy(() => import('./pages/user/MyReportPage.js'))
const AdminDashboardPage    = lazy(() => import('./pages/admin/AdminDashboardPage.js'))
const CourseManagementPage  = lazy(() => import('./pages/admin/CourseManagementPage.js'))
const CourseDetailAdminPage = lazy(() => import('./pages/admin/CourseDetailAdminPage.js'))
const UserDirectoryPage     = lazy(() => import('./pages/admin/UserDirectoryPage.js'))
const ReportsPage           = lazy(() => import('./pages/admin/ReportsPage.js'))
const CertificateEnginePage = lazy(() => import('./pages/admin/CertificateEnginePage.js'))
const AnnouncementsPage     = lazy(() => import('./pages/admin/AnnouncementsPage.js'))
const CertVerifyPage        = lazy(() => import('./pages/public/CertVerifyPage.js'))
const NotFoundPage          = lazy(() => import('./pages/NotFoundPage.js'))

function RootRedirect() {
  const { user, isLoading } = useAuth()
  if (isLoading) return null
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={user.role === 'USER' ? '/dashboard' : '/admin/dashboard'} replace />
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/verify/:hash"
        element={
          <Suspense fallback={null}>
            <CertVerifyPage />
          </Suspense>
        }
      />

      {/* Dev-only showcase */}
      <Route
        path="/ui-showcase"
        element={
          <Suspense fallback={null}>
            <UiShowcasePage />
          </Suspense>
        }
      />

      {/* Authenticated (any role) — wrapped in AppLayout */}
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route
            path="/dashboard"
            element={
              <Suspense fallback={null}>
                <UserDashboardPage />
              </Suspense>
            }
          />
          <Route
            path="/courses"
            element={
              <Suspense fallback={null}>
                <BrowseCoursesPage />
              </Suspense>
            }
          />
          <Route
            path="/courses/:id"
            element={
              <Suspense fallback={null}>
                <CourseDetailPage />
              </Suspense>
            }
          />
          <Route
            path="/certs"
            element={
              <Suspense fallback={null}>
                <MyCertificatesPage />
              </Suspense>
            }
          />
          <Route
            path="/report"
            element={
              <Suspense fallback={null}>
                <MyReportPage />
              </Suspense>
            }
          />
          <Route
            path="/profile"
            element={
              <Suspense fallback={null}>
                <ProfilePage />
              </Suspense>
            }
          />

          {/* ADMIN */}
          <Route element={<RequireRole roles={['ADMIN']} />}>
            <Route
                path="/admin/dashboard"
                element={
                  <Suspense fallback={null}>
                    <AdminDashboardPage />
                  </Suspense>
                }
              />
            <Route
              path="/admin/courses"
              element={
                <Suspense fallback={null}>
                  <CourseManagementPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/courses/:id"
              element={
                <Suspense fallback={null}>
                  <CourseDetailAdminPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/certificates"
              element={
                <Suspense fallback={null}>
                  <CertificateEnginePage />
                </Suspense>
              }
            />
            <Route
              path="/admin/reports"
              element={
                <Suspense fallback={null}>
                  <ReportsPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/announcements"
              element={
                <Suspense fallback={null}>
                  <AnnouncementsPage />
                </Suspense>
              }
            />

            <Route
              path="/admin/users"
              element={
                <Suspense fallback={null}>
                  <UserDirectoryPage />
                </Suspense>
              }
            />
          </Route>
        </Route>
      </Route>

      {/* Fallback — catch-all, must stay last so it never shadows a real route above */}
      <Route
        path="*"
        element={
          <Suspense fallback={null}>
            <NotFoundPage />
          </Suspense>
        }
      />
    </Routes>
  )
}
