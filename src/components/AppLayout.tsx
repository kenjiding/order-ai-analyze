import { useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Sidebar from './Layout/Sidebar'
import UserAccountMenu from './Layout/UserAccountMenu'
import { buildSidebarMenuItems, matchesSidebarActive } from './Layout/sidebarMenu'

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const location = useLocation()
  const { hasPermission, isSuperAdmin } = useAuth()
  const mobileMenu = useMemo(
    () => buildSidebarMenuItems(hasPermission, isSuperAdmin),
    [hasPermission, isSuperAdmin],
  )

  return (
    <div className="admin-shell">
      <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} />

      <div
        className={`admin-content transition-[padding] duration-300 ease-out ${
          sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-64'
        }`}
      >
        <header className="admin-topbar">
          <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Operations Console</div>
              <div className="mt-0.5 text-sm font-semibold text-slate-950">企业级仓库管理后台</div>
            </div>

            <nav className="flex max-h-[42vh] w-full max-w-full flex-wrap gap-1.5 overflow-y-auto lg:hidden" aria-label="主导航（移动端）">
              {mobileMenu.map((item) => {
                const Icon = item.icon
                const hit = matchesSidebarActive(item.path, location.pathname)
                return (
                  <NavLink
                    key={item.id}
                    to={item.path}
                    className={() =>
                      [
                        'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
                        hit
                          ? 'bg-[var(--admin-accent-soft)] text-[#1f6f68] ring-1 ring-[rgba(47,143,135,0.18)]'
                          : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                      ].join(' ')
                    }
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                )
              })}
            </nav>

            <div className="flex flex-shrink-0 items-center">
              <UserAccountMenu />
            </div>
          </div>
        </header>

        <Outlet />
      </div>
    </div>
  )
}
