import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Sidebar from './Layout/Sidebar'
import UserAccountMenu from './Layout/UserAccountMenu'
import { GlobalStationSelector } from './Layout/GlobalStationSelector'
import { GlobalCountrySelector } from './Layout/GlobalCountrySelector'
import { useGlobalStationBootstrap } from './Layout/useGlobalStationBootstrap'
import { LocaleSwitcher } from './I18n/LocaleSwitcher'

export default function AppLayout() {
  const { t } = useTranslation('menu')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // 国家选择器变化时立刻重拉责任站点列表（countries 与所选国家联动）
  useGlobalStationBootstrap()

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
          <div className="mx-auto flex max-w-[1680px] items-center">
            <div className="flex shrink-0 items-center gap-3">
              {/* 移动端汉堡按钮 */}
              <button
                type="button"
                aria-label={t('openNav')}
                aria-expanded={mobileMenuOpen}
                onClick={() => setMobileMenuOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--admin-line)] bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 lg:hidden"
              >
                <Menu className="h-4.5 w-4.5" aria-hidden />
              </button>
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">{t('topbarEyebrow')}</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-950">{t('topbarTitle')}</div>
              </div>
            </div>

            <div className="hidden flex-1 items-center justify-end pr-2 md:flex">
              <GlobalStationSelector />
              <GlobalCountrySelector />
              <LocaleSwitcher toolbar />
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <LocaleSwitcher toolbar className="md:hidden" />
              <UserAccountMenu />
            </div>
          </div>
        </header>

        <Outlet />
      </div>
    </div>
  )
}
