import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useLocation, useParams } from 'react-router-dom'
import { copyTextToClipboard } from '../../utils/clipboard'
import {
  fetchChaseDispatchShare,
  fetchDispatchAlarmShare,
  fetchDispatchAlarmDriverMap,
  type ChaseDispatchShareView,
  type DispatchAlarmShareDriver,
  type DispatchAlarmShareView,
} from './chaseDispatchShareApi'
import { PublicDriverMapSection } from '../../components/DriverMap'
import './chaseDispatchSharePage.css'

/**
 * 外部分享落地页：飞书群内链接打开，无登录，查看/复制运单号。
 * 催派推送（/chase-dispatch-share）与 24 小时派签告警（/dispatch-alarm-share）共用同一个组件与视觉设计，
 * 仅按路径区分数据源、归一化成统一的 groups 视图模型渲染。
 */

type ShareKind = 'chase-dispatch' | 'dispatch-alarm'

type ShareWaybill = {
  no: string
  /** 未完成派送的「本地件优先客户」包裹，橙色标出 */
  priority: boolean
}

type ShareRouteGroup = {
  routeCode: string
  waybills: ShareWaybill[]
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
  /** 'alert' 时分组标题/计数用红色区别于其它分组（如问题件） */
  tone?: 'alert'
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
  showDriverMap: boolean
}


function brandLabel(kind: ShareKind, t: TFunction<'chaseDispatchShare'>): string {
  return kind === 'chase-dispatch' ? t('brand.chaseDispatch') : t('brand.dispatchAlarm')
}

function resolveKind(pathname: string): ShareKind {
  return pathname.startsWith('/dispatch-alarm-share') ? 'dispatch-alarm' : 'chase-dispatch'
}

/**
 * 按路由码分组运单号，组内保持出现顺序，组间按单量从多到少排序。
 * markPriority 只对「未签收」分组开启——橙色标记的语义是「优先客户的件还没派完」，
 * 已签收/问题件分组即使命中优先客户也不标，避免误读成待处理。
 */
function groupByRoute(
  waybills: { waybillNo: string; routeCode: string; isPriority?: boolean }[],
  markPriority = false,
  unknownRouteLabel = 'Unknown route',
): ShareRouteGroup[] {
  const order: string[] = []
  const nosByRoute = new Map<string, ShareWaybill[]>()
  for (const { waybillNo, routeCode, isPriority } of waybills) {
    const code = routeCode.trim() || unknownRouteLabel
    if (!nosByRoute.has(code)) {
      nosByRoute.set(code, [])
      order.push(code)
    }
    nosByRoute.get(code)!.push({ no: waybillNo, priority: markPriority && isPriority === true })
  }
  return order
    .map((routeCode) => ({ routeCode, waybills: nosByRoute.get(routeCode)! }))
    .sort((a, b) => b.waybills.length - a.waybills.length)
}

function toChaseDispatchViewModel(data: ChaseDispatchShareView, t: TFunction<'chaseDispatchShare'>): ShareViewModel {
  return {
    kind: 'chase-dispatch',
    brand: t('brand.chaseDispatch'),
    vendorName: data.vendorName,
    subtitle: t('chaseSubtitle', { baseDate: data.baseDate, pushTime: data.pushTime }),
    metricLabel: t('metricTotalStagnant'),
    metricValue: data.totalStagnant,
    groups: data.buckets
      .filter((b) => b.count > 0 && b.drivers.length > 0)
      .map((b) => ({
        key: b.bucket,
        title: t('groupDays', { days: b.bucket }),
        count: b.count,
        drivers: b.drivers.map((d) => ({
          key: d.driverCode,
          name: d.driverName,
          code: d.driverCode,
          count: d.count,
          waybillNos: d.waybills.map((w) => w.waybillNo),
          routes: groupByRoute(d.waybills, false, t('unknownRoute')),
        })),
      })),
    emptyMessage: t('emptyChase'),
    showDriverMap: false,
  }
}

const driverRowKey = (d: DispatchAlarmShareDriver): string => d.courierCode || 'unassigned'
const driverRowName = (d: DispatchAlarmShareDriver, t: TFunction<'chaseDispatchShare'>): string =>
  d.courierName || t('unassignedDriver')

function toDispatchAlarmViewModel(data: DispatchAlarmShareView, t: TFunction<'chaseDispatchShare'>): ShareViewModel {
  // 未派件的单没有 courierCode，不在 drivers 里；不并进来落地页就少了这部分未达标运单号
  const allDrivers = data.unassigned ? [...data.drivers, data.unassigned] : data.drivers
  const neverSignedDrivers = allDrivers.filter((d) => d.neverSignedWaybills.length > 0)
  const lateSignedDrivers = allDrivers.filter((d) => d.lateSignedWaybills.length > 0)
  const problemDrivers = allDrivers.filter((d) => d.problemCount > 0)
  const unmetTotal = data.total - data.met
  const rate = data.total > 0 ? (data.met / data.total) * 100 : 0
  const rateText = data.total > 0 ? `${rate.toFixed(1)}%` : '—'

  const groups: ShareGroup[] = []
  if (neverSignedDrivers.length > 0) {
    groups.push({
      key: 'never-signed',
      title: t('groupNotSigned'),
      count: neverSignedDrivers.reduce((sum, d) => sum + d.neverSignedWaybills.length, 0),
      drivers: neverSignedDrivers.map((d) => ({
        key: driverRowKey(d),
        name: driverRowName(d, t),
        code: d.courierCode,
        count: d.neverSignedWaybills.length,
        waybillNos: d.neverSignedWaybills.map((w) => w.waybillNo),
          routes: groupByRoute(d.neverSignedWaybills, true, t('unknownRoute')),
      })),
    })
  }
  if (lateSignedDrivers.length > 0) {
    groups.push({
      key: 'late-signed',
      title: t('groupSignedLate'),
      count: lateSignedDrivers.reduce((sum, d) => sum + d.lateSignedWaybills.length, 0),
      drivers: lateSignedDrivers.map((d) => ({
        key: driverRowKey(d),
        name: driverRowName(d, t),
        code: d.courierCode,
        count: d.lateSignedWaybills.length,
        waybillNos: d.lateSignedWaybills.map((w) => w.waybillNo),
          routes: groupByRoute(d.lateSignedWaybills, false, t('unknownRoute')),
      })),
    })
  }
  if (problemDrivers.length > 0) {
    groups.push({
      key: 'problem',
      title: t('groupProblem'),
      count: data.problemCount,
      tone: 'alert',
      drivers: problemDrivers.map((d) => ({
        key: driverRowKey(d),
        name: driverRowName(d, t),
        code: d.courierCode,
        count: d.problemCount,
        waybillNos: d.problemWaybills.map((w) => w.waybillNo),
          routes: groupByRoute(d.problemWaybills, false, t('unknownRoute')),
      })),
    })
  }

  return {
    kind: 'dispatch-alarm',
    brand: t('brand.dispatchAlarm'),
    vendorName: data.vendorName,
    subtitle: t('dispatchSubtitle', {
      stationCode: data.stationCode,
      date: data.date,
      pushTime: data.pushTime,
      rate: rateText,
      threshold: data.alertThresholdPct,
    }),
    metricLabel: t('metricNotMet24h'),
    metricValue: unmetTotal,
    groups,
    emptyMessage: t('emptyDispatch'),
    showDriverMap: data.showDriverMap,
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
  const { t } = useTranslation('chaseDispatchShare')
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
        ? fetchDispatchAlarmShare(token).then((r) => (r.ok ? toDispatchAlarmViewModel(r.data, t) : null))
        : fetchChaseDispatchShare(token).then((r) => (r.ok ? toChaseDispatchViewModel(r.data, t) : null))
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
  }, [token, kind, t])

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
      show(t('noWaybillsToCopy'))
      return
    }
    const ok = await copyTextToClipboard(nos.join('\n'))
    show(ok ? t('copied', { count: nos.length, label }) : t('copyFailed'))
  }

  if (status === 'loading') {
    return (
      <div className="wbs-share">
        <div className="wbs-share__state" role="status">
          <div className="wbs-share__spinner" aria-hidden />
          <p className="wbs-share__state-hint">{t('loading')}</p>
        </div>
      </div>
    )
  }

  if (status === 'error' || !view) {
    return (
      <div className="wbs-share">
        <div className="wbs-share__state">
          <p className="wbs-share__brand">{brandLabel(kind, t)}</p>
          <h1 className="wbs-share__state-title">{t('linkUnavailable')}</h1>
          <p className="wbs-share__state-hint">{t('linkExpiredHint')}</p>
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
              {t('copyAll')}
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
                className={`wbs-share__group${group.tone === 'alert' ? ' wbs-share__group--alert' : ''}`}
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
                              {t('copy')}
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
                                    <span className="wbs-share__route-count">{route.waybills.length}</span>
                                  </p>
                                  <ul className="wbs-share__nos">
                                    {route.waybills.map(({ no, priority }) => (
                                      <li
                                        key={no}
                                        className={`wbs-share__no${priority ? ' wbs-share__no--priority' : ''}`}
                                        title={priority ? t('priorityParcel') : undefined}
                                      >
                                        {no}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))
                            ) : (
                              <p className="wbs-share__empty-nos">{t('noWaybillsInGroup')}</p>
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

        {kind === 'dispatch-alarm' && token && view.showDriverMap && (
          <PublicDriverMapSection token={token} fetchPoints={fetchDispatchAlarmDriverMap} />
        )}

        <p className="wbs-share__foot">
          {t('footer', { brand: view.brand.toLowerCase() })}
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
