import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, ChevronLeft, Warehouse, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { buildSidebarMenuGroups, matchesSidebarActive, type SidebarMenuGroup } from './sidebarMenu'

export type SidebarProps = {
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  mobileOpen?: boolean
  onMobileOpenChange?: (open: boolean) => void
}

export default function Sidebar({ collapsed, onCollapsedChange, mobileOpen = false, onMobileOpenChange }: SidebarProps) {
  const location = useLocation()
  const { hasPermission, isSuperAdmin } = useAuth()

  const menuGroups = useMemo(
    () => buildSidebarMenuGroups(hasPermission, isSuperAdmin),
    [hasPermission, isSuperAdmin],
  )

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() =>
    new Set(menuGroups.filter((g) => g.items.length > 0).map((g) => g.id)),
  )

  // Auto-expand the group that contains the currently active route
  useEffect(() => {
    const activeGroup = menuGroups.find((group) =>
      group.items.some((item) => matchesSidebarActive(item.path, location.pathname)),
    )
    if (activeGroup) {
      setExpandedGroups((prev) => {
        if (prev.has(activeGroup.id)) return prev
        const next = new Set(prev)
        next.add(activeGroup.id)
        return next
      })
    }
  }, [location.pathname, menuGroups])

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const isGroupActive = (group: SidebarMenuGroup) =>
    group.items.some((item) => matchesSidebarActive(item.path, location.pathname))

  // Flat items for collapsed icon-only view
  const flatItems = useMemo(() => menuGroups.flatMap((g) => g.items), [menuGroups])

  const navContent = (isMobile: boolean) => {
    const isCollapsedDesktop = !isMobile && collapsed

    return (
      <>
        {/* Header */}
        <div
          className={`sidebar-header flex-shrink-0 border-b transition-all duration-300 ${
            isCollapsedDesktop ? 'px-3 py-3' : 'px-5 py-6'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className={`flex min-w-0 items-center ${isCollapsedDesktop ? 'w-full justify-center' : 'gap-3'}`}>
              <button
                type="button"
                title={isCollapsedDesktop ? '展开菜单' : undefined}
                onClick={() => isCollapsedDesktop && onCollapsedChange(false)}
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--admin-accent-soft)] text-[var(--admin-accent)] transition hover:brightness-[0.98]"
              >
                <Warehouse className="h-7 w-7" aria-hidden />
              </button>
              <div
                className={`min-w-0 overflow-hidden transition-all duration-300 ease-out ${
                  isCollapsedDesktop ? 'w-0 max-w-0 -translate-x-2 opacity-0' : 'w-auto translate-x-0 opacity-100'
                }`}
                style={{ transitionDelay: isCollapsedDesktop ? '0ms' : '140ms' }}
              >
                <h1 className="truncate whitespace-nowrap text-[15px] font-semibold leading-tight tracking-tight text-slate-900">
                  仓库效率管理
                </h1>
                <p className="mt-1 truncate whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">
                  Warehouse Control
                </p>
              </div>
            </div>
            {isMobile ? (
              <button
                type="button"
                aria-label="关闭菜单"
                onClick={() => onMobileOpenChange?.(false)}
                className="rounded-lg p-2 text-slate-500 transition hover:bg-[#eef7fb] hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
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
            )}
          </div>
        </div>

        {/* Nav */}
        <nav
          className={`sidebar-nav flex-1 overflow-y-auto transition-all duration-300 ${
            isCollapsedDesktop ? 'px-2 py-4' : 'px-3 py-4'
          }`}
          aria-label="主导航"
        >
          {isCollapsedDesktop ? (
            /* Collapsed mode: flat icon list */
            <div className="space-y-1">
              {flatItems.map((item) => {
                const Icon = item.icon
                const active = matchesSidebarActive(item.path, location.pathname)
                return (
                  <NavLink
                    key={item.id}
                    to={item.path}
                    title={item.label}
                    className={() =>
                      [
                        'flex justify-center rounded-xl px-2 py-2.5 transition-all duration-200',
                        active
                          ? 'bg-[var(--admin-accent-soft)] text-[#1f6f68] shadow-sm ring-1 ring-[rgba(47,143,135,0.18)]'
                          : 'text-slate-400 hover:bg-[#eef7fb] hover:text-slate-600',
                      ].join(' ')
                    }
                  >
                    <Icon className="h-5 w-5 shrink-0" aria-hidden />
                  </NavLink>
                )
              })}
            </div>
          ) : (
            /* Expanded mode: grouped two-level list */
            <div className="space-y-0.5">
              {menuGroups.map((group, groupIndex) => {
                const GroupIcon = group.icon
                const isExpanded = expandedGroups.has(group.id)
                const hasActive = isGroupActive(group)
                const isEmpty = group.items.length === 0

                return (
                  <div key={group.id} className={groupIndex > 0 ? 'pt-0.5' : ''}>
                    {/* Separator before system group */}
                    {group.id === 'system' && (
                      <div className="mx-1 mb-2 mt-1 border-t" style={{ borderColor: 'var(--admin-line)' }} />
                    )}

                    {/* Group header row */}
                    <button
                      type="button"
                      onClick={() => !isEmpty && toggleGroup(group.id)}
                      aria-expanded={isEmpty ? undefined : isExpanded}
                      className={[
                        'group flex w-full items-center gap-2.5 rounded-lg px-3 py-[7px] text-left transition-all duration-150',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-accent)]/40',
                        isEmpty
                          ? 'cursor-default opacity-65'
                          : 'cursor-pointer hover:bg-[#eef7fb]',
                        hasActive && !isEmpty ? 'text-[#1f6f68]' : 'text-slate-500',
                      ].join(' ')}
                    >
                      <GroupIcon
                        className={[
                          'h-4 w-4 shrink-0',
                          hasActive && !isEmpty
                            ? 'text-[var(--admin-accent)]'
                            : 'text-slate-400 group-hover:text-slate-500',
                        ].join(' ')}
                        aria-hidden
                      />
                      <span
                        className={[
                          'flex-1 truncate text-sm font-semibold',
                          hasActive && !isEmpty
                            ? 'text-[#1f6f68]'
                            : 'text-slate-700 group-hover:text-slate-900',
                        ].join(' ')}
                      >
                        {group.label}
                      </span>
                      {isEmpty ? (
                        <span className="rounded border border-amber-200/70 bg-amber-50 px-1.5 py-[2px] text-[9px] font-semibold leading-tight text-amber-500">
                          即将推出
                        </span>
                      ) : (
                        <ChevronDown
                          className={[
                            'h-3.5 w-3.5 shrink-0 transition-transform duration-200',
                            isExpanded ? 'rotate-0' : '-rotate-90',
                            hasActive
                              ? 'text-[var(--admin-accent)]'
                              : 'text-slate-400 group-hover:text-slate-500',
                          ].join(' ')}
                          aria-hidden
                        />
                      )}
                    </button>

                    {/* Sub-items with CSS grid smooth expand/collapse */}
                    {!isEmpty && (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateRows: isExpanded ? '1fr' : '0fr',
                          transition: 'grid-template-rows 230ms cubic-bezier(0.16,1,0.3,1)',
                        }}
                        aria-hidden={!isExpanded}
                      >
                        <div className="overflow-hidden">
                          <div className="space-y-0.5 px-1 pb-1 pt-0.5">
                            {group.items.map((item) => {
                              const ItemIcon = item.icon
                              const active = matchesSidebarActive(item.path, location.pathname)
                              return (
                                <NavLink
                                  key={item.id}
                                  to={item.path}
                                  onClick={() => isMobile && onMobileOpenChange?.(false)}
                                  tabIndex={isExpanded ? undefined : -1}
                                  className={() =>
                                    [
                                      'group flex items-center gap-2.5 rounded-lg py-2 pl-7 pr-3 text-[13px] transition-all duration-150',
                                      active
                                        ? 'bg-[var(--admin-accent-soft)] font-semibold text-[#1f6f68] shadow-sm ring-1 ring-[rgba(47,143,135,0.18)]'
                                        : 'font-medium text-slate-600 hover:bg-[#eef7fb] hover:text-slate-900',
                                    ].join(' ')
                                  }
                                >
                                  <ItemIcon
                                    className={[
                                      'h-4 w-4 shrink-0',
                                      active
                                        ? 'text-[var(--admin-accent)]'
                                        : 'text-slate-400 group-hover:text-slate-500',
                                    ].join(' ')}
                                    aria-hidden
                                  />
                                  <span className="truncate">{item.label}</span>
                                  {active && (
                                    <span
                                      className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--admin-accent)]"
                                      aria-hidden
                                    />
                                  )}
                                </NavLink>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </nav>

        {/* Footer */}
        <div
          className={`flex-shrink-0 border-t ${isCollapsedDesktop ? 'px-2 py-3 text-center' : 'px-5 py-4'}`}
          style={{ borderColor: 'var(--admin-line)' }}
        >
          <div className="relative overflow-hidden text-xs text-slate-500">
            {!isMobile ? (
              <>
                <span
                  className={`block transition-opacity duration-300 ${
                    collapsed ? 'opacity-100' : 'pointer-events-none absolute inset-0 opacity-0'
                  }`}
                  style={{ transitionDelay: collapsed ? '120ms' : '0ms' }}
                >
                  v1
                </span>
                <span
                  className={`block transition-opacity duration-300 ${
                    collapsed ? 'pointer-events-none absolute inset-0 opacity-0' : 'opacity-100'
                  }`}
                  style={{ transitionDelay: collapsed ? '0ms' : '120ms' }}
                >
                  Warehouse · v1.0.0
                </span>
              </>
            ) : (
              <span>Warehouse · v1.0.0</span>
            )}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`sidebar-root fixed inset-y-0 left-0 z-40 hidden flex-shrink-0 flex-col overflow-hidden border-r transition-[width] duration-300 ease-out lg:flex ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        {navContent(false)}
      </aside>

      {/* Mobile overlay drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="导航菜单"
        >
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => onMobileOpenChange?.(false)}
            aria-hidden
          />
          <aside
            className="sidebar-root absolute inset-y-0 left-0 z-10 flex w-72 flex-col overflow-hidden border-r"
            style={{ animation: 'slideInFromLeft 0.25s cubic-bezier(0.16,1,0.3,1)' }}
          >
            {navContent(true)}
          </aside>
        </div>
      )}
    </>
  )
}
