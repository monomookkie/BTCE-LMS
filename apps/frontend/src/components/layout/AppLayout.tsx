import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar.js'
import { TopBar } from './TopBar.js'

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const desktopSidebarWidth = sidebarCollapsed ? 'md:w-14' : 'md:w-60'
  const desktopContentMargin = sidebarCollapsed ? 'md:ml-14' : 'md:ml-60'
  const mobileOverlayState = sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
  const mobileDrawerState = sidebarOpen ? 'translate-x-0' : '-translate-x-full'

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop sidebar — fixed left */}
      <div
        className={[
          'hidden md:fixed md:inset-y-0 md:flex overflow-hidden transition-[width] duration-300 ease-in-out',
          desktopSidebarWidth,
        ].join(' ')}
      >
        <Sidebar isCollapsed={sidebarCollapsed} />
      </div>

      {/* Mobile drawer */}
      <div
        className={[
          'fixed inset-0 z-20 bg-black/40 transition-opacity duration-300 ease-out md:hidden',
          mobileOverlayState,
        ].join(' ')}
        aria-hidden="true"
        onClick={() => setSidebarOpen(false)}
      />
      <div
        className={[
          'fixed inset-y-0 left-0 z-30 w-60 transform transition-transform duration-300 ease-out md:hidden',
          mobileDrawerState,
        ].join(' ')}
        aria-hidden={!sidebarOpen}
      >
        <Sidebar onNavigate={() => setSidebarOpen(false)} />
      </div>

      {/* Main content — min-w-0 required: this is a flex item of the row above, and without it
          the default min-width:auto lets deeply-nested content (long select options, etc.) force
          the whole column wider than the viewport instead of wrapping/scrolling internally. */}
      <div
        className={[
          'flex min-w-0 flex-1 flex-col transition-[margin-left] duration-300 ease-in-out',
          desktopContentMargin,
        ].join(' ')}
      >
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          isSidebarCollapsed={sidebarCollapsed}
          onSidebarToggle={() => setSidebarCollapsed((value) => !value)}
        />
        <main className="flex-1 p-3.5 md:p-4">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
