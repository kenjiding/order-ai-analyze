import { useMemo } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Warehouse, ChevronLeft } from 'lucide-react'
import { buildSidebarMenuItems, matchesSidebarActive } from './sidebarMenu'

export type SidebarProps = {
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

export default function Sidebar({ collapsed, onCollapsedChange }: SidebarProps) {
  const location = useLocation()
  const menuItems = useMemo(() => buildSidebarMenuItems(), [])

  return (
    <aside
      className={`sidebar-root fixed inset-y-0 left-0 z-40 hidden flex-shrink-0 flex-col overflow-hidden border-r transition-[width] duration-300 ease-out lg:flex ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div
        className={`sidebar-header flex-shrink-0 border-b transition-all duration-300 ${collapsed ? 'px-3 py-3' : 'px-5 py-6'}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div
            className={`flex min-w-0 items-center ${collapsed ? 'w-full justify-center' : 'gap-3'}`}
          >
            <button
              type="button"
              title={collapsed ? '展开菜单' : undefined}
              onClick={() => collapsed && onCollapsedChange(false)}
              className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--admin-accent-soft)] text-[var(--admin-accent)] transition hover:brightness-[0.98] ${
                collapsed ? '' : ''
              }`}
            >
              <Warehouse className="h-7 w-7" aria-hidden />
            </button>
            <div
              className={`min-w-0 overflow-hidden transition-all duration-300 ease-out ${
                collapsed ? 'w-0 max-w-0 -translate-x-2 opacity-0' : 'w-auto translate-x-0 opacity-100'
              }`}
              style={{ transitionDelay: collapsed ? '0ms' : '140ms' }}
            >
              <h1 className="truncate whitespace-nowrap text-[15px] font-semibold leading-tight tracking-tight text-slate-900">
                仓库效率管理
              </h1>
              <p className="mt-1 truncate whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">
                Warehouse Control
              </p>
            </div>
          </div>
          <div
            className={`overflow-hidden transition-all duration-300 ease-out ${
              collapsed ? 'w-0 max-w-0 opacity-0' : 'opacity-100'
            }`}
            style={{ transitionDelay: collapsed ? '0ms' : '140ms' }}
          >
            <button
              type="button"
              title="收起菜单"
              onClick={() => onCollapsedChange(true)}
              className="rounded-lg p-2 text-slate-500 transition hover:bg-[#eef7fb] hover:text-slate-800"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <nav
        className={`sidebar-nav flex-1 overflow-y-auto transition-all duration-300 ${collapsed ? 'px-2 py-4' : 'px-3 py-5'}`}
        aria-label="主导航"
      >
        <div className="space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon
            const active = matchesSidebarActive(item.path, location.pathname)

            return (
              <NavLink
                key={item.id}
                to={item.path}
                title={collapsed ? item.label : undefined}
                className={() =>
                  [
                    'group flex items-center rounded-xl text-sm font-medium transition-all duration-200',
                    collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5',
                    active
                      ? 'bg-[var(--admin-accent-soft)] text-[#1f6f68] shadow-sm ring-1 ring-[rgba(47,143,135,0.18)]'
                      : 'text-slate-600 hover:bg-[#eef7fb] hover:text-slate-950',
                  ].join(' ')
                }
              >
                <Icon
                  className={`h-5 w-5 shrink-0 ${active ? 'text-[var(--admin-accent)]' : 'text-slate-400 group-hover:text-slate-600'}`}
                  aria-hidden
                />
                <div
                  className={`min-w-0 flex-1 overflow-hidden transition-all duration-300 ease-out ${
                    collapsed ? 'w-0 max-w-0 -translate-x-2 opacity-0' : 'translate-x-0 opacity-100'
                  }`}
                  style={{ transitionDelay: collapsed ? '0ms' : '150ms' }}
                >
                  <div className="truncate font-semibold">{item.label}</div>
                  <div className="truncate text-xs font-normal leading-snug text-slate-500 group-hover:text-slate-600">
                    {item.description}
                  </div>
                </div>
                <span
                  className={`h-2 w-2 shrink-0 rounded-full transition-opacity duration-300 ${
                    active ? 'bg-[var(--admin-accent)] opacity-100' : 'opacity-0'
                  } ${collapsed ? 'hidden' : ''}`}
                  aria-hidden
                />
              </NavLink>
            )
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className={`border-t flex-shrink-0 ${collapsed ? 'px-2 py-3 text-center' : 'px-5 py-4'}`} style={{ borderColor: 'var(--admin-line)' }}>
        <div className="relative overflow-hidden text-xs text-slate-500">
          <span className={`block transition-opacity duration-300 ${collapsed ? 'opacity-100' : 'pointer-events-none absolute inset-0 opacity-0'}`} style={{ transitionDelay: collapsed ? '120ms' : '0ms' }}>
            v1
          </span>
          <span className={`block transition-opacity duration-300 ${collapsed ? 'pointer-events-none absolute inset-0 opacity-0' : 'opacity-100'}`} style={{ transitionDelay: collapsed ? '0ms' : '120ms' }}>
            Warehouse · v1.0.0
          </span>
        </div>
      </div>
    </aside>
  )
}
