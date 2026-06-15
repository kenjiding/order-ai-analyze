import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Layout/Sidebar'
import UserAccountMenu from './Layout/UserAccountMenu'

export default function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="admin-shell">
      <Sidebar
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
        mobileOpen={mobileMenuOpen}
        onMobileOpenChange={setMobileMenuOpen}
      />

      <div
        className={`admin-content transition-[padding] duration-300 ease-out ${
          sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-64'
        }`}
      >
        <header className="admin-topbar">
          <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {/* 移动端汉堡按钮 */}
              <button
                type="button"
                aria-label="打开导航菜单"
                aria-expanded={mobileMenuOpen}
                onClick={() => setMobileMenuOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--admin-line)] bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 lg:hidden"
              >
                <Menu className="h-4.5 w-4.5" aria-hidden />
              </button>
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Operations Console</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-950">企业级仓库管理后台</div>
              </div>
            </div>

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
