import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar.js'
import { TopBar } from './TopBar.js'

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop sidebar — fixed left */}
      <div className="hidden md:fixed md:inset-y-0 md:flex md:w-[200px]">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-20 bg-black/40 md:hidden"
            aria-hidden="true"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-30 w-[200px] md:hidden">
            <Sidebar onNavigate={() => setSidebarOpen(false)} />
          </div>
        </>
      )}

      {/* Main content — min-w-0 required: this is a flex item of the row above, and without it
          the default min-width:auto lets deeply-nested content (long select options, etc.) force
          the whole column wider than the viewport instead of wrapping/scrolling internally. */}
      <div className="flex min-w-0 flex-1 flex-col md:ml-[200px]">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
