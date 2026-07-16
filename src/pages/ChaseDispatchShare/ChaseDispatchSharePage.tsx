import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { copyTextToClipboard } from '../../utils/clipboard'
import {
  fetchChaseDispatchShare,
  fetchDispatchAlarmShare,
  type ChaseDispatchShareView,
  type DispatchAlarmShareView,
} from './chaseDispatchShareApi'
import './chaseDispatchSharePage.css'

/**
 * 外部分享落地页：飞书群内链接打开，无登录，查看/复制运单号。
 * 催派推送（/chase-dispatch-share）与 24 小时派签告警（/dispatch-alarm-share）共用同一个组件与视觉设计，
 * 仅按路径区分数据源、归一化成统一的 groups 视图模型渲染。
 */

type ShareKind = 'chase-dispatch' | 'dispatch-alarm'

type ShareRouteGroup = {
  routeCode: string
  waybillNos: string[]
}

type ShareDriverRow = {
  key: string
  name: string
  code: string
  count: number
  waybillNos: string[]
  routes: ShareRouteGroup[]
}

type ShareGroup = {
  key: string
  title: string
  count: number
  drivers: ShareDriverRow[]
}

type ShareViewModel = {
  kind: ShareKind
  brand: string
  vendorName: string
  subtitle: string
  metricLabel: string
  metricValue: number
  groups: ShareGroup[]
  emptyMessage: string
}

const BRAND_BY_KIND: Record<ShareKind, string> = {
  'chase-dispatch': 'Long time - No return warehouse or Overdue Deliveries',
  'dispatch-alarm': '24H Delivery Alert',
}

function resolveKind(pathname: string): ShareKind {
  return pathname.startsWith('/dispatch-alarm-share') ? 'dispatch-alarm' : 'chase-dispatch'
}

/** 按路由码分组运单号，组内保持出现顺序，组间按单量从多到少排序 */
function groupByRoute(waybills: { waybillNo: string; routeCode: string }[]): ShareRouteGroup[] {
  const order: string[] = []
  const nosByRoute = new Map<string, string[]>()
  for (const { waybillNo, routeCode } of waybills) {
    const code = routeCode.trim() || 'Unknown route'
    if (!nosByRoute.has(code)) {
      nosByRoute.set(code, [])
      order.push(code)
    }
    nosByRoute.get(code)!.push(waybillNo)
  }
  return order
    .map((routeCode) => ({ routeCode, waybillNos: nosByRoute.get(routeCode)! }))
    .sort((a, b) => b.waybillNos.length - a.waybillNos.length)
}

function toChaseDispatchViewModel(data: ChaseDispatchShareView): ShareViewModel {
  return {
    kind: 'chase-dispatch',
    brand: BRAND_BY_KIND['chase-dispatch'],
    vendorName: data.vendorName,
    subtitle: `${data.baseDate} ${data.pushTime} · Stagnant parcels pending delivery`,
    metricLabel: 'Total stagnant',
    metricValue: data.totalStagnant,
    groups: data.buckets
      .filter((b) => b.count > 0 && b.drivers.length > 0)
      .map((b) => ({
        key: b.bucket,
        title: `${b.bucket} days`,
        count: b.count,
        drivers: b.drivers.map((d) => ({
          key: d.driverCode,
          name: d.driverName,
          code: d.driverCode,
          count: d.count,
          waybillNos: d.waybills.map((w) => w.waybillNo),
          routes: groupByRoute(d.waybills),
        })),
      })),
    emptyMessage: 'No stagnant parcels — nothing to chase.',
  }
}

function toDispatchAlarmViewModel(data: DispatchAlarmShareView): ShareViewModel {
  const unmetDrivers = data.drivers.filter((d) => d.total - d.met > 0)
  const unmetTotal = data.total - data.met
  const rate = data.total > 0 ? (data.met / data.total) * 100 : 0
  const rateText = data.total > 0 ? `${rate.toFixed(1)}%` : '—'
  return {
    kind: 'dispatch-alarm',
    brand: BRAND_BY_KIND['dispatch-alarm'],
    vendorName: data.vendorName,
    subtitle: `Station ${data.stationCode} · ${data.date} ${data.pushTime} · 24H rate ${rateText} (threshold ${data.alertThresholdPct}%)`,
    metricLabel: 'Not signed within 24H',
    metricValue: unmetTotal,
    groups:
      unmetDrivers.length > 0
        ? [
            {
              key: 'unmet',
              title: 'Not signed within 24H',
              count: unmetTotal,
              drivers: unmetDrivers.map((d) => ({
                key: d.courierCode,
                name: d.courierName,
                code: d.courierCode,
                count: d.total - d.met,
                waybillNos: d.unmetWaybills.map((w) => w.waybillNo),
                routes: groupByRoute(d.unmetWaybills),
              })),
            },
          ]
        : [],
    emptyMessage: 'All waybills signed within 24H.',
  }
}

function collectAllWaybillNos(groups: ShareGroup[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const group of groups) {
    for (const driver of group.drivers) {
      for (const no of driver.waybillNos) {
        const trimmed = no.trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        out.push(trimmed)
      }
    }
  }
  return out
}

function useCopyToast() {
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const show = (message: string) => {
    setToast(message)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), 2200)
  }

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  return { toast, show }
}

export default function ChaseDispatchSharePage() {
  const { token } = useParams<{ token: string }>()
  const location = useLocation()
  const kind = useMemo(() => resolveKind(location.pathname), [location.pathname])

  const [view, setView] = useState<ShareViewModel | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(token ? 'loading' : 'error')
  /** 展开的司机（`${groupKey}::${driverKey}`）；默认全部折叠，仅剩一位司机时自动展开 */
  const [expandedDrivers, setExpandedDrivers] = useState<Set<string>>(() => new Set())
  const { toast, show } = useCopyToast()

  useEffect(() => {
    if (!token) return
    let cancelled = false
    const load =
      kind === 'dispatch-alarm'
        ? fetchDispatchAlarmShare(token).then((r) => (r.ok ? toDispatchAlarmViewModel(r.data) : null))
        : fetchChaseDispatchShare(token).then((r) => (r.ok ? toChaseDispatchViewModel(r.data) : null))
    void load
      .then((vm) => {
        if (cancelled) return
        if (vm) {
          setView(vm)
          const allDriverKeys = vm.groups.flatMap((g) => g.drivers.map((d) => `${g.key}::${d.key}`))
          // 仅一位司机时无需再多点一次展开
          if (allDriverKeys.length === 1) setExpandedDrivers(new Set(allDriverKeys))
          setStatus('ready')
        } else {
          setStatus('error')
        }
      })
      .catch((err) => {
        if (cancelled) return
        // 快照是推送时落库的冻结数据，字段可能早于最新前端代码；渲染失败时要落到错误态而非无限转圈
        console.error('[share] failed to load or render snapshot:', err)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [token, kind])

  // 外部分享页关闭全局后台网格，避免浅色纹理压在明亮画布上
  useEffect(() => {
    document.documentElement.dataset.shareShell = '1'
    return () => {
      delete document.documentElement.dataset.shareShell
    }
  }, [])

  const allNos = useMemo(() => (view ? collectAllWaybillNos(view.groups) : []), [view])

  const toggleDriver = (driverKey: string) => {
    setExpandedDrivers((prev) => {
      const next = new Set(prev)
      if (next.has(driverKey)) next.delete(driverKey)
      else next.add(driverKey)
      return next
    })
  }

  const copyNos = async (nos: string[], label: string) => {
    if (nos.length === 0) {
      show('No waybills to copy')
      return
    }
    const ok = await copyTextToClipboard(nos.join('\n'))
    show(ok ? `Copied ${nos.length} · ${label}` : 'Copy failed')
  }

  if (status === 'loading') {
    return (
      <div className="wbs-share">
        <div className="wbs-share__state" role="status">
          <div className="wbs-share__spinner" aria-hidden />
          <p className="wbs-share__state-hint">Loading waybills…</p>
        </div>
      </div>
    )
  }

  if (status === 'error' || !view) {
    return (
      <div className="wbs-share">
        <div className="wbs-share__state">
          <p className="wbs-share__brand">{BRAND_BY_KIND[kind]}</p>
          <h1 className="wbs-share__state-title">Link unavailable</h1>
          <p className="wbs-share__state-hint">
            This share link is invalid or has expired (links stay open for 3 days). Ask the warehouse team to push again.
          </p>
        </div>
      </div>
    )
  }

  const metricPositive = view.metricValue > 0

  return (
    <div className="wbs-share">
      <div className="wbs-share__frame">
        <header className="wbs-share__hero">
          <p className="wbs-share__brand">{view.brand}</p>
          <h1 className="wbs-share__title">{view.vendorName}</h1>
          <p className="wbs-share__meta">{view.subtitle}</p>
          <div className="wbs-share__stats">
            <div>
              <p className="wbs-share__total-label">{view.metricLabel}</p>
              <p
                className={`wbs-share__total${metricPositive ? ' wbs-share__total--alert' : ' wbs-share__total--ok'}`}
              >
                {view.metricValue}
              </p>
            </div>
            <button
              type="button"
              className="wbs-share__copy-all"
              disabled={allNos.length === 0}
              onClick={() => void copyNos(allNos, 'all')}
            >
              Copy all
            </button>
          </div>
        </header>

        {view.groups.length === 0 && !metricPositive ? (
          <p className="wbs-share__clear">✅ {view.emptyMessage}</p>
        ) : (
          <div className="wbs-share__groups">
            {view.groups.map((group, groupIndex) => (
              <section
                key={group.key}
                className="wbs-share__group"
                style={{ animationDelay: `${0.06 + groupIndex * 0.05}s` }}
              >
                <div className="wbs-share__group-head">
                  <h2 className="wbs-share__group-title">{group.title}</h2>
                  <span className="wbs-share__group-count">{group.count}</span>
                </div>

                <div className="wbs-share__group-body">
                  {group.drivers.map((driver) => {
                    const driverKey = `${group.key}::${driver.key}`
                    const open = expandedDrivers.has(driverKey)
                    const panelId = `wbs-driver-${driverKey}`
                    return (
                      <div key={driverKey} className={`wbs-share__driver${open ? ' wbs-share__driver--open' : ''}`}>
                        <div
                          className="wbs-share__driver-head"
                          role="button"
                          tabIndex={0}
                          aria-expanded={open}
                          aria-controls={panelId}
                          onClick={() => toggleDriver(driverKey)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              toggleDriver(driverKey)
                            }
                          }}
                        >
                          <span className="wbs-share__driver-chevron" aria-hidden />
                          <div className="wbs-share__driver-name">
                            {driver.name}
                            <span className="wbs-share__driver-code">{driver.code}</span>
                          </div>
                          <div className="wbs-share__driver-actions">
                            <span className="wbs-share__pill">{driver.count}</span>
                            <button
                              type="button"
                              className="wbs-share__copy"
                              onClick={(e) => {
                                e.stopPropagation()
                                void copyNos(driver.waybillNos, driver.name)
                              }}
                            >
                              Copy
                            </button>
                          </div>
                        </div>

                        {open ? (
                          <div id={panelId} className="wbs-share__driver-body">
                            {driver.routes.length > 0 ? (
                              driver.routes.map((route) => (
                                <div key={route.routeCode} className="wbs-share__route-group">
                                  <p className="wbs-share__route-label">
                                    {route.routeCode}
                                    <span className="wbs-share__route-count">{route.waybillNos.length}</span>
                                  </p>
                                  <ul className="wbs-share__nos">
                                    {route.waybillNos.map((no) => (
                                      <li key={no} className="wbs-share__no">
                                        {no}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))
                            ) : (
                              <p className="wbs-share__empty-nos">No waybill numbers in this group</p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        <p className="wbs-share__foot">
          Snapshot from the {view.brand.toLowerCase()} push. Copy waybills into your TMS or clipboard as needed. Link
          expires after 3 days.
        </p>
      </div>

      <div
        className={`wbs-share__toast${toast ? ' wbs-share__toast--show' : ''}`}
        role="status"
        aria-live="polite"
      >
        {toast}
      </div>
    </div>
  )
}
